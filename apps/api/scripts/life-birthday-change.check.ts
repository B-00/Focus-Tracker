// Guard for the Life/Memento Mori ghost-cell regression (Nov 2026).
//
// Symptom: changing a user's birthday left stale `week_activity_minutes`
// rows at the OLD weekIndex positions, painting ghost heatmap tiles on
// the /life grid that didn't match any real data.
//
// Fix has two parts, both pinned here:
//   1. LifeService.refreshForUser rewrites the user's rows (delete +
//      insert in one tx) instead of upserting, so repeat runs leave no
//      orphans.
//   2. UsersService.updateProfile deletes the user's rows on birthday
//      change so the next GET /v1/life/grid re-aggregates cleanly.
//
// Run from repo root:
//   pnpm --filter @focus-tracker/api exec tsx \
//     scripts/life-birthday-change.check.ts
//
// Exits non-zero on failure; leaves no rows behind.

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
}

async function main() {
  const email = `life-birthday-check-${Date.now()}@test.local`;
  const user = await prisma.user.create({
    data: { email, timezone: 'UTC', passwordHash: 'x' },
    select: { id: true },
  });

  try {
    // Seed one activity_minute_rollup row. Pick a minute 10 weeks after
    // a hypothetical "early" birthday so the weekIndex falls at a
    // predictable spot.
    const earlyBirthday = new Date('2000-01-01T00:00:00.000Z');
    const minuteBucket = new Date(
      earlyBirthday.getTime() + 10 * 7 * 24 * 3600 * 1000,
    );
    await prisma.user.update({
      where: { id: user.id },
      data: { birthday: earlyBirthday },
    });
    await prisma.activityMinuteRollup.create({
      data: {
        userId: user.id,
        minuteBucket,
        source: 'browser',
        target: 'probe-target',
        durationMs: 60_000,
      },
    });

    const { LifeService } = await import('../src/life/life.service');
    const life = new LifeService(prisma as never);
    const { UsersService } = await import('../src/users/users.service');
    const users = new UsersService(prisma as never);

    // Refresh under the early birthday — expect one row at weekIndex=10.
    await life.refreshForUser(user.id);
    const afterFirst = await prisma.weekActivityMinutes.findMany({
      where: { userId: user.id },
      orderBy: { weekIndex: 'asc' },
    });
    assert(
      afterFirst.length === 1 && afterFirst[0]!.weekIndex === 10,
      `expected one row at weekIndex=10 under early birthday, got ${JSON.stringify(afterFirst)}`,
    );
    console.log('ok  first refresh: 1 row at weekIndex=10');

    // Move birthday 5 weeks LATER. Under the new birthday, the same
    // rollup minute is now at weekIndex = 10 - 5 = 5. The stale row at
    // weekIndex=10 must be gone.
    const laterBirthday = new Date(
      earlyBirthday.getTime() + 5 * 7 * 24 * 3600 * 1000,
    );
    await users.updateProfile(user.id, {
      birthday: laterBirthday.toISOString().slice(0, 10),
    });

    // Part 2: the birthday-change hook deleted the stale rows. Grid is
    // empty right now; a refresh re-populates against the new birthday.
    const afterDelete = await prisma.weekActivityMinutes.findMany({
      where: { userId: user.id },
    });
    assert(
      afterDelete.length === 0,
      `updateProfile must wipe week_activity_minutes on birthday change (found ${afterDelete.length} rows)`,
    );
    console.log('ok  updateProfile: cleared rows on birthday change');

    // Part 1: refreshForUser rewrites cleanly under the new birthday —
    // expect exactly one row at weekIndex=5, no ghost at 10.
    await life.refreshForUser(user.id);
    const afterSecond = await prisma.weekActivityMinutes.findMany({
      where: { userId: user.id },
      orderBy: { weekIndex: 'asc' },
    });
    assert(
      afterSecond.length === 1 && afterSecond[0]!.weekIndex === 5,
      `expected one row at weekIndex=5 after birthday change + refresh, got ${JSON.stringify(afterSecond)}`,
    );
    console.log('ok  refresh after birthday change: single clean row at weekIndex=5');

    // Part 1b: re-running refresh must not duplicate.
    await life.refreshForUser(user.id);
    const afterThird = await prisma.weekActivityMinutes.findMany({
      where: { userId: user.id },
    });
    assert(
      afterThird.length === 1,
      `refreshForUser must stay idempotent (found ${afterThird.length} rows)`,
    );
    console.log('ok  refresh idempotence: still 1 row after rerun');
  } finally {
    // Cascade cleans up everything under this user.
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.$disconnect();
  }
  console.log('\nall good — life-grid stays clean across birthday changes');
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
