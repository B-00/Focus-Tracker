import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import type { DeviceListItem } from '@focus-tracker/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtRequestContext } from '../auth/token.service';
import { DevicesService } from './devices.service';

/// Routes under `/v1/devices/*`. JWT-only — these are the web app's
/// "Settings → Devices" management surface.
///
/// Pairing endpoints live in a sibling controller (`PairingController`)
/// because their auth posture is different (the bootstrap calls are
/// unauthenticated).
@Controller('devices')
@UseGuards(JwtAuthGuard)
export class DevicesController {
  constructor(private readonly devices: DevicesService) {}

  @Get()
  list(@CurrentUser() user: JwtRequestContext): Promise<DeviceListItem[]> {
    return this.devices.listForUser(user.userId);
  }

  @Delete(':deviceId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revoke(
    @CurrentUser() user: JwtRequestContext,
    @Param('deviceId', new ParseUUIDPipe()) deviceId: string,
  ): Promise<void> {
    await this.devices.revoke(user.userId, deviceId);
  }
}
