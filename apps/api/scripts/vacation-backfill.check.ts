// Pins vacation mode + late routine check-ins against the nightly scorer.
//
// Run from repo root:
//   cd apps/api && npx tsx scripts/vacation-backfill.check.ts
//
// Exits non-zero on failure; deletes its probe user either way.

import { PrismaClient, TaskKind } from '@prisma/client';

const prisma = new PrismaClient();

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const db = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);
const ymd = (d: Date) => d.toISOString().slice(0, 10);

async function main() {
  const { MaintenanceService } = await import('../src/tasks/maintenance.service');
  const { InstancesService } = await import('../src/tasks/instances.service');
  const maint = new MaintenanceService(prisma as never);
  const inst = new InstancesService(prisma as never, maint);

  const user = await prisma.user.create({
    data: { email: `vac-check-${Date.now()}@test.local`, timezone: 'UTC', passwordHash: 'x' },
    select: { id: true },
  });
  try {
    const today = await maint.todayForUser(user.id);
    const d = (n: number) => ymd(new Date(db(today).getTime() + n * 86_400_000));
    const [day3, day2] = [d(-3), d(-2)];

    await prisma.task.create({
      data: {
        userId: user.id,
        kind: TaskKind.routine,
        priority: 'mid',
        title: 'daily probe',
        routineDaysOfWeek: [1, 2, 3, 4, 5, 6, 7],
        routineStartDate: db(day3),
      },
    });
    // Vacation over day-2 BEFORE the nightly run.
    const vac = await prisma.vacation.create({
      data: { userId: user.id, startDate: db(day2), endDate: db(day2) },
    });
    await maint.runForUser(user.id, 'UTC');

    const scoreOn = (day: string) =>
      prisma.routineSectionDailyScore.findFirst({ where: { userId: user.id, date: db(day) } });

    assert((await scoreOn(day3))?.completedCount === 0, 'day-3 scored as missed');
    assert((await scoreOn(day2)) === null, 'vacation day has no score row');
    assert(
      (await prisma.taskInstance.count({
        where: { scheduledDate: db(day2), task: { userId: user.id } },
      })) === 0,
      'no missed instance created on a vacation day',
    );
    console.log('ok  vacation day skipped by nightly');

    // Late check-in for day-3 flips its score.
    const i3 = await prisma.taskInstance.findFirstOrThrow({ where: { scheduledDate: db(day3), task: { userId: user.id } } });
    const before = Number((await scoreOn(day3))!.score);
    const res = await inst.update(user.id, i3.id, { completedAt: new Date().toISOString() });
    assert(res.completedAt?.startsWith(day3), 'late tick stamped on its own day');
    const after = await scoreOn(day3);
    assert(after?.completedCount === 1 && Number(after.score) > before, 'late tick re-scored the day');
    console.log('ok  late check-in re-scores the day');

    // Out-of-window edit is rejected.
    const old = await prisma.taskInstance.create({
      data: { taskId: i3.taskId, scheduledDate: db(d(-30)), priority: 'mid' },
    });
    let rejected = false;
    try {
      await inst.update(user.id, old.id, { completedAt: new Date().toISOString() });
    } catch {
      rejected = true;
    }
    assert(rejected, 'edits older than the backfill window are rejected');
    console.log('ok  backfill window enforced');

    // Removing the vacation re-scores day-2 as a normal (missed) day.
    await prisma.vacation.delete({ where: { id: vac.id } });
    await maint.reprocessRange(user.id, day2, day2);
    assert((await scoreOn(day2))?.completedCount === 0, 'removed vacation day gets scored');
    console.log('ok  removing a vacation re-scores its days');

    // Adding a vacation retroactively clears its score rows.
    await maint.clearScoresInRange(user.id, day3, day3);
    assert((await scoreOn(day3)) === null, 'retro vacation clears score');
    console.log('ok  retro vacation clears existing scores');
  } finally {
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.$disconnect();
  }
  console.log('\nall good — vacation + backfill hold');
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
