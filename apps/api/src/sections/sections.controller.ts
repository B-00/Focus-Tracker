import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  createSectionRequestSchema,
  updateSectionRequestSchema,
  SECTION_DELETE_MODES,
  type CreateSectionRequest,
  type SectionDeleteMode,
  type SectionResponse,
  type UpdateSectionRequest,
} from '@focus-tracker/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtRequestContext } from '../auth/token.service';
import { ZodBodyPipe } from '../common/pipes/zod-body.pipe';
import { SectionsService } from './sections.service';

/// Routes under `/v1/sections/*`. JWT-only — Tasks is user data.
@Controller('sections')
@UseGuards(JwtAuthGuard)
export class SectionsController {
  constructor(private readonly sections: SectionsService) {}

  @Get()
  list(@CurrentUser() user: JwtRequestContext): Promise<SectionResponse[]> {
    return this.sections.list(user.userId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentUser() user: JwtRequestContext,
    @Body(new ZodBodyPipe(createSectionRequestSchema)) body: CreateSectionRequest,
  ): Promise<SectionResponse> {
    return this.sections.create(user.userId, body);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: JwtRequestContext,
    @Param('id') id: string,
    @Body(new ZodBodyPipe(updateSectionRequestSchema)) body: UpdateSectionRequest,
  ): Promise<SectionResponse> {
    return this.sections.update(user.userId, id, body);
  }

  /// DELETE /v1/sections/:id?mode=inbox|cascade
  /// Tasks.md §5.3 requires an explicit choice — no implicit default.
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUser() user: JwtRequestContext,
    @Param('id') id: string,
    @Query('mode') mode: string | undefined,
  ): Promise<void> {
    if (!mode || !(SECTION_DELETE_MODES as readonly string[]).includes(mode)) {
      throw new BadRequestException({
        error: 'section_delete_mode_required',
        message: `?mode= is required and must be one of ${SECTION_DELETE_MODES.join(', ')}`,
      });
    }
    await this.sections.remove(user.userId, id, mode as SectionDeleteMode);
  }
}
