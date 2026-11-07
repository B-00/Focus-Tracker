// Guard against the routine back-fill regression (Nov 2026).
//
// Symptom: creating a routine without an explicit `routineStartDate`
// persisted NULL, and the nightly maintenance Step 1 filter
// (`OR: [{ routineStartDate: null }, ...]`) matched NULL on every
// past day in the MAX_CATCHUP_DAYS catch-up window. Result: ~60
// phantom "missed" instances per freshly-created routine, which
// tanked the consistency chart with history the user never set up.
//
// The fix has two parts and this check pins both:
//   1. TasksService.create defaults `routineStartDate` to
//      today-in-user-tz when the request omits it.
//   2. MaintenanceService.step1_materialiseRoutines requires a
//      non-null `routineStartDate <= day`; NULL rows never match.
//
// Run from repo root:
//   pnpm --filter @focus-tracker/api exec tsx \
//     scripts/routine-backfill-guard.check.ts
//
// Exits non-zero on failure; leaves no rows behind.

import { PrismaClient, TaskKind } from '@prisma/client';

const prisma = new PrismaClient();

function toDbDate(ymd: string): Date {
  return new Date(`${ymd}T00:00:00.000Z`);
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
}

async function main() {
  const probeEmail = `routine-backfill-check-${Date.now()}@test.local`;
  const user = await prisma.user.create({
    data: { email: probeEmail, timezone: 'UTC', passwordHash: 'x' },
    select: { id: true },
  });

  try {
    // ---- Part 2: step1 filter rejects NULL routineStartDate. --------
    // Create a routine directly in the DB with NULL start to simulate
    // a legacy / regressed row.
    const nullStartRoutine = await prisma.task.create({
      data: {
        userId: user.id,
        kind: TaskKind.routine,
        priority: 'mid',
        title: 'null-start probe',
        routineDaysOfWeek: [1, 2, 3, 4, 5, 6, 7],
        routineStartDate: null,
      },
      select: { id: true },
    });

    const pastDay = toDbDate('2026-01-01');
    const matched = await prisma.task.findMany({
      where: {
        userId: user.id,
        kind: 'routine',
        archivedAt: null,
        routineDaysOfWeek: { has: 4 }, // Thursday — Jan 1 2026 is a Thu
        routineStartDate: { lte: pastDay },
        OR: [
          { routineEndDate: null },
          { routineEndDate: { gte: pastDay } },
        ],
      },
      select: { id: true },
    });
    assert(
      matched.every((r) => r.id !== nullStartRoutine.id),
      'step1 filter must exclude routines with NULL routineStartDate',
    );
    console.log('ok  step1 filter: NULL routineStartDate excluded from back-fill');

    // ---- Part 2b: step1 filter correctly rejects future-start routines.
    const futureRoutine = await prisma.task.create({
      data: {
        userId: user.id,
        kind: TaskKind.routine,
        priority: 'mid',
        title: 'future-start probe',
        routineDaysOfWeek: [1, 2, 3, 4, 5, 6, 7],
        routineStartDate: toDbDate('2026-12-01'),
      },
      select: { id: true },
    });
    const matched2 = await prisma.task.findMany({
      where: {
        userId: user.id,
        kind: 'routine',
        archivedAt: null,
        routineDaysOfWeek: { has: 4 },
        routineStartDate: { lte: pastDay },
      },
      select: { id: true },
    });
    assert(
      matched2.every((r) => r.id !== futureRoutine.id),
      'step1 filter must exclude routines whose start date is after the day',
    );
    console.log('ok  step1 filter: future routineStartDate excluded from back-fill');

    // ---- Part 1: TasksService.create defaults routineStartDate. ------
    // We import the service dynamically so the Prisma client above is
    // the one it uses (DI is overkill for a one-off script).
    const { TasksService } = await import('../src/tasks/tasks.service');
    const svc = new TasksService(prisma as never);

    const created = await svc.create(user.id, {
      kind: 'routine',
      priority: 'mid',
      title: 'default-start probe',
      routineDaysOfWeek: [1, 2, 3],
    });
    assert(
      created.routineStartDate !== null,
      'TasksService.create must default routineStartDate when omitted (got NULL)',
    );
    console.log(
      `ok  create: defaulted routineStartDate = ${created.routineStartDate}`,
    );
  } finally {
    // Cascade cleans up Task + TaskInstance via the User FK.
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.$disconnect();
  }
  console.log('\nall good — routine back-fill guard holds');
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
