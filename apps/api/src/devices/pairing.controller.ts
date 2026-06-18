import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  pairingCodeCreateRequestSchema,
  type PairingCodeClaimResponse,
  type PairingCodeCreateRequest,
  type PairingCodeCreateResponse,
  type PairingCodePollResponse,
} from '@focus-tracker/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ZodBodyPipe } from '../common/pipes/zod-body.pipe';
import type { JwtRequestContext } from '../auth/token.service';
import { PairingService } from './pairing.service';

/// Routes under `/v1/devices/pairing-codes/*`. Auth posture matches
/// Auth.md §5.1 exactly:
///
/// | Endpoint                          | Auth        | Caller           |
/// | --------------------------------- | ----------- | ---------------- |
/// | POST   /pairing-codes             | (none)      | source client    |
/// | GET    /pairing-codes/:code       | (none)      | source client    |
/// | POST   /pairing-codes/:code/claim | JWT         | web app          |
@Controller('devices/pairing-codes')
export class PairingController {
  constructor(private readonly pairing: PairingService) {}

  // ------------------------------------------------------------------
  //  POST /v1/devices/pairing-codes
  // ------------------------------------------------------------------
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body(new ZodBodyPipe(pairingCodeCreateRequestSchema)) body: PairingCodeCreateRequest,
  ): Promise<PairingCodeCreateResponse> {
    return this.pairing.create(body);
  }

  // ------------------------------------------------------------------
  //  GET /v1/devices/pairing-codes/:code
  // ------------------------------------------------------------------
  @Get(':code')
  poll(@Param('code') code: string): Promise<PairingCodePollResponse> {
    return this.pairing.poll(code);
  }

  // ------------------------------------------------------------------
  //  POST /v1/devices/pairing-codes/:code/claim
  // ------------------------------------------------------------------
  @Post(':code/claim')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  claim(
    @Param('code') code: string,
    @CurrentUser() user: JwtRequestContext,
  ): Promise<PairingCodeClaimResponse> {
    return this.pairing.claim(code, user.userId);
  }
}
