import {
  ConflictException,
  GoneException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomBytes, randomInt } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import type {
  DeviceProposal,
  PairingCodeClaimResponse,
  PairingCodeCreateResponse,
  PairingCodePollResponse,
} from '@focus-tracker/shared';
import { PrismaService } from '../prisma/prisma.service';

/// Auth.md §5.1 — the three-step pairing handshake.
/// All three steps are stateful around the `PairingCode` row:
///
///   create()  → POST /v1/devices/pairing-codes              (no auth)
///   poll()    → GET  /v1/devices/pairing-codes/:code        (no auth)
///   claim()   → POST /v1/devices/pairing-codes/:code/claim  (JWT)
///
/// The minted API key lives in plaintext on the PairingCode row for the
/// brief window between claim and the device's next poll; the row is
/// deleted immediately after the device successfully retrieves it.
@Injectable()
export class PairingService {
  private readonly logger = new Logger(PairingService.name);
  private static readonly CODE_TTL_MS = 5 * 60 * 1000;
  /// Probability of generating a duplicate 6-digit code while at most a few
  /// codes are outstanding is microscopic; the loop is just defence in depth.
  private static readonly MAX_CODE_GEN_RETRIES = 5;
  /// One API key per device; this is the prefix the ApiKeyAuthGuard will
  /// look for on the Authorization header (see Auth.md §5.2 / §5.3).
  private static readonly API_KEY_PREFIX = 'ft_live_';
  private static readonly API_KEY_BYTE_LEN = 24; // → 32 base64url chars

  constructor(private readonly prisma: PrismaService) {}

  // -------------------------------------------------------------------------
  //  Step 1 — Device requests a fresh code (no auth)
  // -------------------------------------------------------------------------

  async create(proposal: DeviceProposal): Promise<PairingCodeCreateResponse> {
    const expiresAt = new Date(Date.now() + PairingService.CODE_TTL_MS);
    // Defensive: if a Device with this UUID already exists for any user,
    // refuse the pairing attempt rather than silently shadowing it. The
    // user should explicitly DELETE the old device first (their key was
    // compromised, or they're moving installs, etc).
    const existingDevice = await this.prisma.device.findUnique({
      where: { id: proposal.deviceId },
      select: { id: true, label: true },
    });
    if (existingDevice) {
      throw new ConflictException({
        error: 'device_already_paired',
        hint:
          `A device with id "${proposal.deviceId}" is already paired ` +
          `(label: "${existingDevice.label}"). Revoke it first.`,
      });
    }

    for (let attempt = 0; attempt < PairingService.MAX_CODE_GEN_RETRIES; attempt++) {
      const code = this.generateCode();
      try {
        await this.prisma.pairingCode.create({
          data: {
            code,
            deviceProposal: proposal satisfies DeviceProposal as Prisma.InputJsonValue,
            expiresAt,
          },
        });
        return { code, expiresAt: expiresAt.toISOString() };
      } catch (err) {
        if (this.isUniqueViolation(err, 'code')) {
          this.logger.warn(`Pairing code collision on "${code}", retrying (attempt ${attempt + 1})`);
          continue;
        }
        throw err;
      }
    }
    throw new HttpException(
      { error: 'pairing_code_generation_failed' },
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }

  // -------------------------------------------------------------------------
  //  Step 2 — User claims the code (JWT-auth'd, called from web app)
  // -------------------------------------------------------------------------

  /// Atomic: in a single transaction we (a) verify the code is unclaimed +
  /// unexpired, (b) mint the API key, (c) create Device + ApiKey, (d) mark
  /// the PairingCode as claimed and stash the raw key for the device's
  /// next poll.
  async claim(code: string, userId: string): Promise<PairingCodeClaimResponse> {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.pairingCode.findUnique({ where: { code } });
      if (!row) {
        throw new NotFoundException({ error: 'pairing_code_invalid' });
      }
      const now = new Date();
      if (row.expiresAt <= now) {
        throw new GoneException({ error: 'pairing_code_invalid' });
      }
      if (row.claimedByUserId !== null) {
        throw new ConflictException({ error: 'pairing_code_already_claimed' });
      }

      const proposal = row.deviceProposal as unknown as DeviceProposal;

      // Mint the raw key + its hash. Server NEVER sees the plaintext again
      // after this point apart from echoing it through the next poll.
      const rawKey = `${PairingService.API_KEY_PREFIX}${randomBytes(
        PairingService.API_KEY_BYTE_LEN,
      ).toString('base64url')}`;
      const tokenHash = this.hashKey(rawKey);

      // Create Device first so the ApiKey FK can resolve.
      const device = await tx.device.create({
        data: {
          id: proposal.deviceId,
          userId,
          source: proposal.source,
          label: proposal.label,
          platform: proposal.platform,
          clientVersion: proposal.clientVersion ?? null,
        },
      });

      await tx.apiKey.create({
        data: {
          userId,
          deviceId: device.id,
          tokenHash,
          scope: 'telemetry_write',
        },
      });

      await tx.pairingCode.update({
        where: { id: row.id },
        data: {
          claimedByUserId: userId,
          claimedAt: now,
          mintedApiKey: rawKey,
        },
      });

      return { deviceId: device.id, label: device.label };
    });
  }

  // -------------------------------------------------------------------------
  //  Step 3 — Device polls until claimed (no auth)
  // -------------------------------------------------------------------------

  async poll(code: string): Promise<PairingCodePollResponse> {
    const row = await this.prisma.pairingCode.findUnique({
      where: { code },
      select: {
        id: true,
        expiresAt: true,
        claimedAt: true,
        mintedApiKey: true,
        deviceProposal: true,
      },
    });

    if (!row) {
      // Two equivalent reasons we'd see a missing row:
      //   1. The device successfully polled once already → we deleted it.
      //   2. The code was never created or expired and was reaped.
      // Either way the client should start over.
      throw new NotFoundException({ error: 'pairing_code_invalid' });
    }

    if (row.claimedAt === null) {
      if (row.expiresAt <= new Date()) {
        return { status: 'expired' };
      }
      return { status: 'pending' };
    }

    // Claimed but somehow no minted key (shouldn't happen — claim() always
    // sets both atomically). Defensive: surface as invalid so the client
    // retries with a new code rather than getting stuck.
    if (row.mintedApiKey === null) {
      this.logger.error(
        `PairingCode ${row.id} is claimed but has no mintedApiKey; deleting and treating as invalid.`,
      );
      await this.prisma.pairingCode.delete({ where: { id: row.id } }).catch(() => {});
      throw new NotFoundException({ error: 'pairing_code_invalid' });
    }

    const proposal = row.deviceProposal as unknown as DeviceProposal;
    const rawKey = row.mintedApiKey;

    // One-shot: delete the row so subsequent polls 404. We do this AFTER
    // we've assembled the response payload but BEFORE we return it — if
    // the delete fails we'd rather return an error than leak the key on
    // future polls.
    await this.prisma.pairingCode.delete({ where: { id: row.id } });

    return {
      status: 'claimed',
      apiKey: rawKey,
      device: { id: proposal.deviceId, label: proposal.label },
    };
  }

  // -------------------------------------------------------------------------
  //  Helpers
  // -------------------------------------------------------------------------

  /// 6 numeric digits with leading zeros preserved. `randomInt(0, 1_000_000)`
  /// yields a uniform distribution across the full 000000..999999 range.
  private generateCode(): string {
    return randomInt(0, 1_000_000).toString().padStart(6, '0');
  }

  private hashKey(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }

  /// Matches Prisma's P2002 (unique constraint) on a specific column.
  /// We use this to distinguish "code collision, retry" from any other
  /// write error during pairing-code creation.
  private isUniqueViolation(err: unknown, column: string): boolean {
    if (typeof err !== 'object' || err === null) return false;
    const e = err as { code?: string; meta?: { target?: unknown } };
    if (e.code !== 'P2002') return false;
    const target = e.meta?.target;
    if (Array.isArray(target)) return target.includes(column);
    if (typeof target === 'string') return target.includes(column);
    return false;
  }
}
