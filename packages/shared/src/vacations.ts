// Vacation ranges: days inside one are skipped by the nightly scorer, so
// dated + routine tasks due then don't count for or against consistency.

import { z } from 'zod';
import { YMD_REGEX } from './milestones.js';

/// ponytail: one vacation can't exceed a year; keeps a typo'd year
/// (2062 instead of 2026) from silently muting scoring for decades.
export const VACATION_MAX_DAYS = 366;

/// How far back a missed routine check-in can be ticked after the fact.
export const ROUTINE_BACKFILL_DAYS = 7;

export const vacationSchema = z.object({
  id: z.string(),
  startDate: z.string().regex(YMD_REGEX),
  endDate: z.string().regex(YMD_REGEX),
});
export type Vacation = z.infer<typeof vacationSchema>;

export const createVacationRequestSchema = z
  .object({
    startDate: z.string().regex(YMD_REGEX),
    endDate: z.string().regex(YMD_REGEX),
  })
  .refine((v) => v.endDate >= v.startDate, {
    path: ['endDate'],
    message: 'endDate must be ≥ startDate',
  })
  .refine(
    (v) =>
      (Date.parse(v.endDate) - Date.parse(v.startDate)) / 86_400_000 <
      VACATION_MAX_DAYS,
    { path: ['endDate'], message: `max ${VACATION_MAX_DAYS} days` },
  );
export type CreateVacationRequest = z.infer<typeof createVacationRequestSchema>;
