// Guard for cross-device UI prefs (`User.uiPrefs`, PATCH /v1/me/ui-prefs).
//
// Pins: (1) PATCH merges at the top level — one store's write must not
// wipe another store's slice; (2) a sent slice replaces wholesale;
// (3) the zod schema rejects junk at the trust boundary.
//
// Run from repo root:
//   pnpm --filter @focus-tracker/api exec tsx scripts/ui-prefs-merge.check.ts
//
// Exits non-zero on failure; leaves no rows behind.

import { PrismaClient } from '@prisma/client';
import { uiPrefsSchema } from '@focus-tracker/shared';
import { UsersService } from '../src/users/users.service';

const prisma = new PrismaClient();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const users = new UsersService(prisma as any);

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
}

async function main() {
  const user = await prisma.user.create({
    data: { email: `ui-prefs-check-${Date.now()}@test.local`, passwordHash: 'x' },
    select: { id: true },
  });
  try {
    assert(JSON.stringify(await users.getUiPrefs(user.id)) === '{}', 'fresh user = {}');

    await users.patchUiPrefs(user.id, { lifeSize: 'xl' });
    await users.patchUiPrefs(user.id, { priorityColors: { low: '#112233', high: '#445566' } });
    let p = await users.getUiPrefs(user.id);
    assert(p.lifeSize === 'xl', 'lifeSize survives a different-key PATCH');
    assert(p.priorityColors?.low === '#112233', 'priorityColors stored');

    await users.patchUiPrefs(user.id, { priorityColors: { mid: '#abcdef' } });
    p = await users.getUiPrefs(user.id);
    assert(p.priorityColors?.mid === '#abcdef', 'slice replaced');
    assert(p.priorityColors?.low === undefined, 'slice replaced wholesale, not deep-merged');
    assert(p.lifeSize === 'xl', 'untouched slice kept');

    for (const bad of [
      { lifeSize: 'huge' },
      { priorityColors: { low: 'red' } },
      { priorityIcons: { low: '<script>' } },
      { lifeColors: { lived: 'nope' } },
      { somethingElse: 1 },
    ]) {
      assert(!uiPrefsSchema.safeParse(bad).success, `schema rejects ${JSON.stringify(bad)}`);
    }
    assert(
      uiPrefsSchema.safeParse({ lifeColors: { lived: '#404040', m3: '#f59e0b' } }).success,
      'schema accepts a valid lifeColors slice',
    );
    console.log('OK: ui-prefs merge + validation');
  } finally {
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.$disconnect();
  }
}

void main();
