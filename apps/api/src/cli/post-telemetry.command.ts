import { randomUUID } from 'node:crypto';
import { Command, CommandRunner, Option } from 'nest-commander';
import type { TelemetryEvent } from '@focus-tracker/shared';
import { PrismaService } from '../prisma/prisma.service';
import { TelemetryService } from '../telemetry/telemetry.service';

interface PostTelemetryOptions {
  email?: string;
  deviceLabel?: string;
  count?: number;
  spreadMinutes?: number;
  app?: string;
}

const DEFAULT_APPS = [
  'Cursor',
  'Spotify',
  'Slack',
  'Notion',
  'Firefox',
  'Terminal',
];

/// `pnpm --filter @focus-tracker/api post-telemetry [--count 50] [--spread-minutes 60] [--email me@x.com]`
///
/// Side-loads a synthetic batch of `focus_change` events directly through
/// `TelemetryService.ingest`, bypassing the HTTP layer. Use cases:
///
///   * Seed the dashboard / Memento Mori / Activity widgets with realistic
///     data while building UI.
///   * Regression-test the per-minute rollup splitter without spinning up
///     the desktop daemon.
///   * Repro reports of duplicate handling (run twice with the same
///     `--seed-prefix` to verify duplicateCount).
///
/// Doesn't need the API server running — it talks to the DB through the
/// same Nest providers the controller uses. Auth is fabricated locally
/// from the picked user + device.
@Command({
  name: 'post-telemetry',
  description:
    'Inject synthetic focus_change events for the picked user/device. ' +
    'Bypasses HTTP — talks straight to TelemetryService.',
})
export class PostTelemetryCommand extends CommandRunner {
  constructor(
    private readonly prisma: PrismaService,
    private readonly telemetry: TelemetryService,
  ) {
    super();
  }

  async run(_args: string[], rawOptions: PostTelemetryOptions): Promise<void> {
    const opts = this.normaliseOptions(rawOptions);

    const user = await this.pickUser(opts.email);
    if (!user) {
      throw new Error(
        opts.email
          ? `No user with email "${opts.email}". Did you run seed-user?`
          : 'No users in the DB. Run `pnpm --filter @focus-tracker/api seed-user` first.',
      );
    }

    const device = await this.pickDevice(user.id, opts.deviceLabel);
    if (!device) {
      throw new Error(
        opts.deviceLabel
          ? `No device labelled "${opts.deviceLabel}" for ${user.email}.`
          : `${user.email} has no devices yet. Pair the desktop or browser source first.`,
      );
    }

    const events = this.buildEvents(opts, device.source);
    const batchesOf50 = chunk(events, 50);

    let totalAccepted = 0;
    let totalDuplicates = 0;
    for (const batch of batchesOf50) {
      const res = await this.telemetry.ingest(
        { userId: user.id, deviceId: device.id, scope: 'telemetry_write' },
        { deviceId: device.id, events: batch },
      );
      totalAccepted += res.acceptedCount;
      totalDuplicates += res.duplicateCount;
    }

    // eslint-disable-next-line no-console
    console.log(
      `\nPosted ${events.length} synthetic events:` +
        `\n  user:       ${user.email}` +
        `\n  device:     ${device.label} (${device.source}, ${device.id})` +
        `\n  accepted:   ${totalAccepted}` +
        `\n  duplicates: ${totalDuplicates}` +
        `\n  spread:     last ${opts.spreadMinutes}m` +
        '\n',
    );
  }

  // -------------------------------------------------------------------

  private normaliseOptions(raw: PostTelemetryOptions): {
    email?: string;
    deviceLabel?: string;
    count: number;
    spreadMinutes: number;
    app?: string;
  } {
    const count = clampInt(raw.count ?? 50, 1, 5_000);
    const spreadMinutes = clampInt(raw.spreadMinutes ?? 60, 1, 60 * 24 * 30);
    return {
      email: raw.email?.trim()?.toLowerCase() || undefined,
      deviceLabel: raw.deviceLabel?.trim() || undefined,
      count,
      spreadMinutes,
      app: raw.app?.trim() || undefined,
    };
  }

  private async pickUser(email: string | undefined) {
    if (email) return this.prisma.user.findUnique({ where: { email } });
    return this.prisma.user.findFirst({ orderBy: { createdAt: 'asc' } });
  }

  private async pickDevice(userId: string, label: string | undefined) {
    if (label) {
      return this.prisma.device.findFirst({ where: { userId, label } });
    }
    // `revokedAt` lives on `ApiKey`, not `Device` — but for a synthetic
    // telemetry seeder we don't care about key state; the ingest path goes
    // straight through TelemetryService.ingest and skips the API-key guard.
    return this.prisma.device.findFirst({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });
  }

  /// Builds N events spread evenly backwards from `now` over `spreadMinutes`,
  /// rotating through `DEFAULT_APPS` (or the single `--app` value if set).
  /// Each event has a 30-90s duration, capped at the next event's start so
  /// the rollup splitter sees realistic, non-overlapping spans.
  private buildEvents(
    opts: { count: number; spreadMinutes: number; app?: string },
    deviceSource: 'desktop' | 'browser',
  ): TelemetryEvent[] {
    const apps = opts.app ? [opts.app] : DEFAULT_APPS;
    const now = Date.now();
    const start = now - opts.spreadMinutes * 60_000;
    const step = Math.max(1_000, Math.floor((now - start) / opts.count));

    const out: TelemetryEvent[] = [];
    for (let i = 0; i < opts.count; i++) {
      const startedAt = new Date(start + i * step);
      const minDur = 30_000;
      const maxDur = 90_000;
      const desiredDuration =
        minDur + Math.floor(Math.random() * (maxDur - minDur));
      // Cap at the next event's start to keep events non-overlapping.
      const ceilingMs = start + (i + 1) * step;
      const durationMs = Math.min(desiredDuration, ceilingMs - startedAt.getTime());
      const endedAt = new Date(startedAt.getTime() + durationMs);
      const app = apps[i % apps.length] ?? 'Unknown';

      const target =
        deviceSource === 'browser'
          ? { domain: app.toLowerCase().replace(/[^a-z]/g, '') + '.com' }
          : { appName: app };

      out.push({
        id: randomUUID(),
        kind: 'focus_change',
        source: deviceSource,
        target,
        startedAt: startedAt.toISOString(),
        endedAt: endedAt.toISOString(),
        durationMs,
        clientVersion: 'cli/0.0.1',
      });
    }
    return out;
  }

  // ----- option parsers ---------------------------------------------

  @Option({
    flags: '-e, --email <email>',
    description: 'User email to attribute events to (default: first user).',
  })
  parseEmail(value: string): string {
    return value;
  }

  @Option({
    flags: '-d, --device-label <label>',
    description: 'Device label to attribute events to (default: first device).',
  })
  parseDeviceLabel(value: string): string {
    return value;
  }

  @Option({
    flags: '-c, --count <n>',
    description: 'How many events to inject (default 50, max 5000).',
  })
  parseCount(value: string): number {
    return Number.parseInt(value, 10);
  }

  @Option({
    flags: '-s, --spread-minutes <n>',
    description: 'Spread events evenly across the last N minutes (default 60).',
  })
  parseSpreadMinutes(value: string): number {
    return Number.parseInt(value, 10);
  }

  @Option({
    flags: '-a, --app <name>',
    description: 'Fixed app/domain to use (default rotates through a small set).',
  })
  parseApp(value: string): string {
    return value;
  }
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.floor(value)));
}
