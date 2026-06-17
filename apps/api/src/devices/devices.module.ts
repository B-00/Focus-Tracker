import { Module } from '@nestjs/common';
import { DevicesController } from './devices.controller';
import { DevicesService } from './devices.service';
import { PairingController } from './pairing.controller';
import { PairingService } from './pairing.service';

/// Owns:
///  - /v1/devices/*                              → DevicesController (JWT)
///  - /v1/devices/pairing-codes/*                → PairingController (mixed)
///
/// Slice 2 will add `ApiKeyAuthGuard` here so the future telemetry module
/// can lean on the same module's lookup logic.
@Module({
  controllers: [DevicesController, PairingController],
  providers: [DevicesService, PairingService],
  exports: [DevicesService, PairingService],
})
export class DevicesModule {}
