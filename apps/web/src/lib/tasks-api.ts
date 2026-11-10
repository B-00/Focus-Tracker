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
  BacklogGroupBy,
  BacklogListResponse,
  CreateSectionRequest,
  CreateVacationRequest,
  Vacation,
  CreateTaskRequest,
  RedateRequest,
  SectionDeleteMode,
  SectionResponse,
  TaskInstanceResponse,
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

export const instancesQueryKeys = {
  all: ['instances'] as const,
  today: () => [...instancesQueryKeys.all, 'today'] as const,
};

export const backlogQueryKeys = {
  all: ['backlog'] as const,
  list: (filters?: BacklogListFilters) =>
    [...backlogQueryKeys.all, 'list', filters ?? {}] as const,
};

export interface BacklogListFilters {
  groupBy?: BacklogGroupBy;
  /// CSV-encoded on the wire; arrays here for ergonomics.
  priority?: Array<'extreme' | 'high' | 'mid' | 'low'>;
}

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

// ---------------------------------------------------------------------------
//  Task instances (routines)
// ---------------------------------------------------------------------------

/// Fetches (and server-side lazily materialises) today's routine
/// instances for the authenticated user. Returns one row per routine
/// that's scheduled for today and within its active window.
export async function listTodayInstances(): Promise<TaskInstanceResponse[]> {
  const res = await api.get<TaskInstanceResponse[]>('/v1/instances/today');
  return res.data;
}

export async function updateInstance(
  id: string,
  body: { completedAt: string | null },
): Promise<TaskInstanceResponse> {
  const res = await api.patch<TaskInstanceResponse>(
    `/v1/instances/${encodeURIComponent(id)}`,
    body,
  );
  return res.data;
}

/// Past-day instances for the "forgot to tick it" flow (last N days only).
export async function listInstancesForDay(ymd: string): Promise<TaskInstanceResponse[]> {
  const res = await api.get<TaskInstanceResponse[]>(
    `/v1/instances/day/${encodeURIComponent(ymd)}`,
  );
  return res.data;
}

// ---------------------------------------------------------------------------
//  Vacations
// ---------------------------------------------------------------------------

export const vacationsQueryKeys = { all: ['vacations'] as const };

export async function listVacations(): Promise<Vacation[]> {
  return (await api.get<Vacation[]>('/v1/vacations')).data;
}

export async function createVacation(body: CreateVacationRequest): Promise<Vacation> {
  return (await api.post<Vacation>('/v1/vacations', body)).data;
}

export async function deleteVacation(id: string): Promise<void> {
  await api.delete(`/v1/vacations/${encodeURIComponent(id)}`);
}

/// Mirror of toggleTaskCompletion for a routine instance.
export function toggleInstanceCompletion(
  id: string,
  nextCompleted: boolean,
): Promise<TaskInstanceResponse> {
  return updateInstance(id, {
    completedAt: nextCompleted ? new Date().toISOString() : null,
  });
}

// ---------------------------------------------------------------------------
//  Backlog + redate
// ---------------------------------------------------------------------------

export async function listBacklog(
  filters?: BacklogListFilters,
): Promise<BacklogListResponse> {
  const params: Record<string, string> = {};
  if (filters?.groupBy) params.groupBy = filters.groupBy;
  if (filters?.priority && filters.priority.length > 0) {
    params.priority = filters.priority.join(',');
  }
  const res = await api.get<BacklogListResponse>('/v1/backlog', { params });
  return res.data;
}

/// Pulls a backlogged task back into the active Dated panel. `date` is
/// either a `YYYY-MM-DD` string or the literal `"today"` (server-side
/// tz-aware). Invalidates both the backlog and tasks queries so both
/// surfaces repaint without a stale frame.
export async function redateTask(
  id: string,
  body: RedateRequest,
): Promise<TaskResponse> {
  const res = await api.post<TaskResponse>(
    `/v1/tasks/${encodeURIComponent(id)}/redate`,
    body,
  );
  return res.data;
}
