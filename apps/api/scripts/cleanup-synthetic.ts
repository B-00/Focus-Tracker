// One-off cleanup script: surgically remove the synthetic telemetry that
// the `post-telemetry` CLI command left behind during Slice 5 testing.
//
// Identified by `clientVersion = 'cli/0.0.1'` (the synthetic CLI's marker;
// real desktop events use the actual semver of the desktop app). For each
// synthetic event we replay the same minute-bucket splitter that
// TelemetryService uses on ingest, then subtract those contributions from
// the rollup. Rollup rows that drop to 0 get deleted. Finally the synthetic
// raw events themselves are removed.
//
// Run:
//   pnpm --filter @focus-tracker/api cleanup-synthetic
//
// Safe to re-run: it's a no-op once there are no synthetic events left, so
// it pairs naturally with the `post-telemetry` CLI for dev/testing loops.

import { PrismaClient } from '@prisma/client';

interface SyntheticEvent {
  userId: string;
  source: 'browser' | 'desktop';
  target: unknown;
  startedAt: Date;
  endedAt: Date | null;
  durationMs: number | null;
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const synthetic = await prisma.telemetryEvent.findMany({
      where: { clientVersion: 'cli/0.0.1', kind: 'focus_change' },
      select: {
        userId: true,
        source: true,
        target: true,
        startedAt: true,
        endedAt: true,
        durationMs: true,
      },
    });
    console.log(`Found ${synthetic.length} synthetic focus_change events.`);

    if (synthetic.length === 0) {
      console.log('Nothing to clean up. Exiting.');
      return;
    }

    let rowsDecremented = 0;
    let rowsSkipped = 0;
    await prisma.$transaction(async (tx) => {
      for (const event of synthetic as SyntheticEvent[]) {
        const target = deriveRollupTarget(event.source, event.target);
        if (!target) continue;

        const buckets = splitAcrossMinutes(event);
        for (const bucket of buckets) {
          if (bucket.durationMs <= 0) continue;
          try {
            await tx.activityMinuteRollup.update({
              where: {
                userId_source_target_minuteBucket: {
                  userId: event.userId,
                  source: event.source,
                  target,
                  minuteBucket: bucket.minuteBucket,
                },
              },
              data: { durationMs: { decrement: bucket.durationMs } },
            });
            rowsDecremented++;
          } catch {
            // Rollup row wasn't there — already cleaned up or never written.
            // Safe to ignore for an idempotent script.
            rowsSkipped++;
          }
        }
      }

      // Drop any rollup row that's now zero/negative — these were
      // wholly-synthetic (e.g. Spotify, Notion, Slack, bare Firefox).
      const deletedRollup = await tx.activityMinuteRollup.deleteMany({
        where: { durationMs: { lte: 0 } },
      });

      // Finally remove the synthetic raw events.
      const deletedEvents = await tx.telemetryEvent.deleteMany({
        where: { clientVersion: 'cli/0.0.1' },
      });

      console.log(`Decremented ${rowsDecremented} rollup rows.`);
      console.log(`Skipped ${rowsSkipped} (already gone).`);
      console.log(`Deleted ${deletedRollup.count} zeroed rollup rows.`);
      console.log(`Deleted ${deletedEvents.count} raw synthetic events.`);
    });
  } finally {
    await prisma.$disconnect();
  }
}

// Mirrors TelemetryService.splitAcrossMinutes exactly so the subtraction
// is symmetric with the original ingest contribution.
function splitAcrossMinutes(
  event: { startedAt: Date; endedAt: Date | null; durationMs: number | null },
): Array<{ minuteBucket: Date; durationMs: number }> {
  const startedAtMs = event.startedAt.getTime();
  const durationMs =
    event.durationMs ??
    (event.endedAt ? Math.max(event.endedAt.getTime() - startedAtMs, 0) : 0);

  if (durationMs <= 0) {
    return [{ minuteBucket: truncateToMinute(startedAtMs), durationMs: 0 }];
  }

  const buckets: Array<{ minuteBucket: Date; durationMs: number }> = [];
  let cursor = startedAtMs;
  let remaining = durationMs;
  while (remaining > 0) {
    const bucketStartMs = Math.floor(cursor / 60_000) * 60_000;
    const bucketEndMs = bucketStartMs + 60_000;
    const msInBucket = Math.min(remaining, bucketEndMs - cursor);
    buckets.push({
      minuteBucket: new Date(bucketStartMs),
      durationMs: msInBucket,
    });
    cursor = bucketEndMs;
    remaining -= msInBucket;
  }
  return buckets;
}

function truncateToMinute(ms: number): Date {
  return new Date(Math.floor(ms / 60_000) * 60_000);
}

// Mirrors TelemetryService.deriveRollupTarget — browser source uses `domain`,
// desktop source uses `appName`.
function deriveRollupTarget(
  source: 'browser' | 'desktop',
  target: unknown,
): string | null {
  if (!target || typeof target !== 'object' || Array.isArray(target)) return null;
  const obj = target as Record<string, unknown>;
  const value = source === 'browser' ? obj.domain : obj.appName;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
