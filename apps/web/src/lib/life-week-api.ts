import type {
  LifeWeekDetail,
  LifeWeekNote,
  LifeWeekNoteUpsert,
} from '@focus-tracker/shared';
import { api } from './api';
import { lifeQueryKeys } from './life-api';

// Typed wrappers around `/v1/life/weeks/:weekIndex` (detail) and
// `/v1/life/weeks/:weekIndex/note` (upsert). Owned by MementoMori.md
// §5.1 / §7.
//
// Query keys sit under the shared `lifeQueryKeys.all` root so a cache
// invalidation at the "life" level (e.g. after a grid refresh) also
// drops any cached per-week detail. The grid list and the per-week
// detail are read from different endpoints but both describe the same
// user's calendar — co-locating keys keeps staleness honest.

export const lifeWeekQueryKeys = {
  all: ['life', 'week'] as const,
  detail: (weekIndex: number) =>
    [...lifeWeekQueryKeys.all, weekIndex] as const,
};

export async function fetchLifeWeek(weekIndex: number): Promise<LifeWeekDetail> {
  const res = await api.get<LifeWeekDetail>(`/v1/life/weeks/${weekIndex}`);
  return res.data;
}

export async function upsertLifeWeekNote(
  weekIndex: number,
  body: string,
): Promise<LifeWeekNote | null> {
  const payload: LifeWeekNoteUpsert = { body };
  const res = await api.put<LifeWeekNote | null>(
    `/v1/life/weeks/${weekIndex}/note`,
    payload,
  );
  return res.data;
}

// Re-export so Life.tsx can invalidate both the grid and per-week caches
// via one import if it ever needs to.
export { lifeQueryKeys };
