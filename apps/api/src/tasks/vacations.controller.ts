import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  createVacationRequestSchema,
  type CreateVacationRequest,
  type Vacation,
} from '@focus-tracker/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtRequestContext } from '../auth/token.service';
import { ZodBodyPipe } from '../common/pipes/zod-body.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { MaintenanceService } from './maintenance.service';

/// `/v1/vacations` — date ranges skipped by the nightly scorer.
/// ponytail: tiny CRUD lives in the controller; no service layer needed.
@Controller('vacations')
@UseGuards(JwtAuthGuard)
export class VacationsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly maintenance: MaintenanceService,
  ) {}

  @Get()
  async list(@CurrentUser() user: JwtRequestContext): Promise<Vacation[]> {
    const rows = await this.prisma.vacation.findMany({
      where: { userId: user.userId },
      orderBy: { startDate: 'desc' },
    });
    return rows.map(toVacation);
  }

  /// Adding a range retroactively also wipes scores already written in it.
  @Post()
  async create(
    @CurrentUser() user: JwtRequestContext,
    @Body(new ZodBodyPipe(createVacationRequestSchema)) body: CreateVacationRequest,
  ): Promise<Vacation> {
    const row = await this.prisma.vacation.create({
      data: {
        userId: user.userId,
        startDate: new Date(`${body.startDate}T00:00:00.000Z`),
        endDate: new Date(`${body.endDate}T00:00:00.000Z`),
      },
    });
    await this.maintenance.clearScoresInRange(user.userId, body.startDate, body.endDate);
    return toVacation(row);
  }

  /// Removing a range re-scores any of its days the nightly job already passed.
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUser() user: JwtRequestContext,
    @Param('id') id: string,
  ): Promise<void> {
    const row = await this.prisma.vacation.findFirst({
      where: { id, userId: user.userId },
    });
    if (!row) throw new NotFoundException({ error: 'vacation_not_found' });
    await this.prisma.vacation.delete({ where: { id } });
    const v = toVacation(row);
    await this.maintenance.reprocessRange(user.userId, v.startDate, v.endDate);
  }
}

function toVacation(row: { id: string; startDate: Date; endDate: Date }): Vacation {
  return {
    id: row.id,
    startDate: row.startDate.toISOString().slice(0, 10),
    endDate: row.endDate.toISOString().slice(0, 10),
  };
}
