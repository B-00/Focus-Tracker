import { Injectable, NotFoundException } from '@nestjs/common';
import type { DeviceListItem } from '@focus-tracker/shared';
import { PrismaService } from '../prisma/prisma.service';

/// Settings.md §4.4 / Auth.md §5.5 — user-facing CRUD on their paired
/// devices. NEVER exposes the API key (raw or hashed); the user shouldn't
/// see or need it. Revocation hard-deletes the Device row, which cascades
/// to ApiKey (per the schema's `onDelete: Cascade`). Telemetry events
/// retain a soft reference (`deviceId` set to null) so historical activity
/// survives device removal — see schema.prisma TelemetryEvent.
@Injectable()
export class DevicesService {
  constructor(private readonly prisma: PrismaService) {}

  // -------------------------------------------------------------------------
  //  GET /v1/devices
  // -------------------------------------------------------------------------

  async listForUser(userId: string): Promise<DeviceListItem[]> {
    const rows = await this.prisma.device.findMany({
      where: { userId },
      orderBy: { pairedAt: 'desc' },
      select: {
        id: true,
        source: true,
        label: true,
        platform: true,
        clientVersion: true,
        pairedAt: true,
        lastSeen: true,
        lastSuccessfulIngestAt: true,
      },
    });

    return rows.map((d) => ({
      id: d.id,
      source: d.source,
      label: d.label,
      platform: d.platform,
      clientVersion: d.clientVersion,
      pairedAt: d.pairedAt.toISOString(),
      lastSeen: d.lastSeen?.toISOString() ?? null,
      lastSuccessfulIngestAt: d.lastSuccessfulIngestAt?.toISOString() ?? null,
    }));
  }

  // -------------------------------------------------------------------------
  //  DELETE /v1/devices/:deviceId
  // -------------------------------------------------------------------------

  /// Idempotent at the user level: revoking your own device twice is fine.
  /// 404 only when the device doesn't exist OR belongs to a different user
  /// (we don't leak the distinction — feels more correct security-wise
  /// even at single-user scale).
  async revoke(userId: string, deviceId: string): Promise<void> {
    const existing = await this.prisma.device.findFirst({
      where: { id: deviceId, userId },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException({ error: 'device_not_found' });
    }
    await this.prisma.device.delete({ where: { id: deviceId } });
  }
}
