import type { LifeGridResponse } from '@focus-tracker/shared';
import { api } from './api';

// Typed wrapper around `/v1/life/grid`. Owned by MementoMori.md §6.1 /
// §7 — Memento Mori grid loads the whole response in one request.

export const lifeQueryKeys = {
  all: ['life'] as const,
  grid: () => [...lifeQueryKeys.all, 'grid'] as const,
};

export async function fetchLifeGrid(): Promise<LifeGridResponse> {
  const res = await api.get<LifeGridResponse>('/v1/life/grid');
  return res.data;
}
