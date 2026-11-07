import type {
  CreateMilestoneRequest,
  Milestone,
  UpdateMilestoneRequest,
} from '@focus-tracker/shared';
import { api } from './api';

// Typed wrappers around /v1/milestones. Owned by MementoMori.md §7.
//
// Query keys sit under the shared 'life' root so a life-grid refresh
// invalidation cascades here too — milestones and the grid describe
// the same calendar.

export const milestoneQueryKeys = {
  all: ['life', 'milestones'] as const,
  list: () => [...milestoneQueryKeys.all, 'list'] as const,
};

export async function fetchMilestones(): Promise<Milestone[]> {
  const res = await api.get<Milestone[]>('/v1/milestones');
  return res.data;
}

export async function createMilestone(
  input: CreateMilestoneRequest,
): Promise<Milestone> {
  const res = await api.post<Milestone>('/v1/milestones', input);
  return res.data;
}

export async function updateMilestone(
  id: string,
  input: UpdateMilestoneRequest,
): Promise<Milestone> {
  const res = await api.patch<Milestone>(`/v1/milestones/${id}`, input);
  return res.data;
}

export async function deleteMilestone(id: string): Promise<void> {
  await api.delete(`/v1/milestones/${id}`);
}
