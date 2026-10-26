// Thin typed wrappers around `/v1/tasks/*` and `/v1/sections/*`.
//
// Co-located because the two resources are always used together (every
// task list hits both), and the TasksPage query keys invalidate across
// both after a section delete. Keeping them in one file keeps the
// invalidate-cascade story simple.
//
// Shared query-key factories here keep every component that mutates
// tasks or sections invalidating with a stable key.

import type {
  CreateSectionRequest,
  CreateTaskRequest,
  SectionDeleteMode,
  SectionResponse,
  TaskResponse,
  UpdateSectionRequest,
  UpdateTaskRequest,
} from '@focus-tracker/shared';
import { api } from './api';

// ---------------------------------------------------------------------------
//  Query keys
// ---------------------------------------------------------------------------

export const tasksQueryKeys = {
  all: ['tasks'] as const,
  list: (filters?: TaskListFilters) =>
    [...tasksQueryKeys.all, 'list', filters ?? {}] as const,
};

export const sectionsQueryKeys = {
  all: ['sections'] as const,
  list: () => [...sectionsQueryKeys.all, 'list'] as const,
};

export interface TaskListFilters {
  kind?: 'dated' | 'ongoing' | 'routine';
  sectionId?: string;
  backlog?: boolean;
  archived?: boolean;
}

// ---------------------------------------------------------------------------
//  Sections
// ---------------------------------------------------------------------------

export async function listSections(): Promise<SectionResponse[]> {
  const res = await api.get<SectionResponse[]>('/v1/sections');
  return res.data;
}

export async function createSection(
  body: CreateSectionRequest,
): Promise<SectionResponse> {
  const res = await api.post<SectionResponse>('/v1/sections', body);
  return res.data;
}

export async function updateSection(
  id: string,
  body: UpdateSectionRequest,
): Promise<SectionResponse> {
  const res = await api.patch<SectionResponse>(
    `/v1/sections/${encodeURIComponent(id)}`,
    body,
  );
  return res.data;
}

export async function deleteSection(
  id: string,
  mode: SectionDeleteMode,
): Promise<void> {
  await api.delete(
    `/v1/sections/${encodeURIComponent(id)}?mode=${encodeURIComponent(mode)}`,
  );
}

// ---------------------------------------------------------------------------
//  Tasks
// ---------------------------------------------------------------------------

export async function listTasks(filters?: TaskListFilters): Promise<TaskResponse[]> {
  const params: Record<string, string> = {};
  if (filters?.kind) params.kind = filters.kind;
  if (filters?.sectionId !== undefined) params.sectionId = filters.sectionId;
  if (filters?.backlog === true) params.backlog = 'true';
  if (filters?.archived === true) params.archived = 'true';
  const res = await api.get<TaskResponse[]>('/v1/tasks', { params });
  return res.data;
}

export async function createTask(body: CreateTaskRequest): Promise<TaskResponse> {
  const res = await api.post<TaskResponse>('/v1/tasks', body);
  return res.data;
}

export async function updateTask(
  id: string,
  body: UpdateTaskRequest,
): Promise<TaskResponse> {
  const res = await api.patch<TaskResponse>(
    `/v1/tasks/${encodeURIComponent(id)}`,
    body,
  );
  return res.data;
}

export async function deleteTask(id: string): Promise<void> {
  await api.delete(`/v1/tasks/${encodeURIComponent(id)}`);
}

// ---------------------------------------------------------------------------
//  Shortcut mutations used by multiple surfaces
// ---------------------------------------------------------------------------

/// Toggle completion by setting / clearing `completedAt`. Used by the
/// task-list checkbox, the dashboard "Today's Tasks" widget, and the
/// future Backlog panel.
export function toggleTaskCompletion(
  id: string,
  nextCompleted: boolean,
): Promise<TaskResponse> {
  return updateTask(id, {
    completedAt: nextCompleted ? new Date().toISOString() : null,
  });
}
