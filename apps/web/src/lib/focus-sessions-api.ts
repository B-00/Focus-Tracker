// Thin wrappers for `/v1/focus-sessions/*`. See FocusSession.md §10.
//
// Query keys are shared by the dashboard widget, the /focus route, and the
// (slice 3) cross-route sticky bar — same 5s poll key everywhere so
// TanStack Query coalesces the request into one even with multiple surfaces
// mounted (dashboard widget + sticky bar + /focus).

import {
  focusSessionCurrentResponseSchema,
  focusSessionListResponseSchema,
  focusSessionResponseSchema,
  sessionAlreadyActiveResponseSchema,
  type FocusSessionCurrentResponse,
  type FocusSessionListQuery,
  type FocusSessionListResponse,
  type FocusSessionResponse,
  type SessionAlreadyActiveResponse,
  type StartFocusSessionRequest,
} from '@focus-tracker/shared';
import { AxiosError } from 'axios';
import { api } from './api';

// ---------------------------------------------------------------------------
//  Query keys
// ---------------------------------------------------------------------------

export const focusSessionsQueryKeys = {
  all: ['focus-sessions'] as const,
  current: () => [...focusSessionsQueryKeys.all, 'current'] as const,
  list: (query?: FocusSessionListQuery) =>
    [...focusSessionsQueryKeys.all, 'list', query ?? {}] as const,
  detail: (id: string) => [...focusSessionsQueryKeys.all, 'detail', id] as const,
};

// ---------------------------------------------------------------------------
//  Error — 409 session_already_active
// ---------------------------------------------------------------------------

/// Thrown by `startSession()` when the server returns the §9.1 409 body.
/// Carries the full `existingSession` summary so the UI can render the
/// confirm modal without a second round-trip.
export class SessionAlreadyActiveError extends Error {
  readonly body: SessionAlreadyActiveResponse;
  constructor(body: SessionAlreadyActiveResponse) {
    super('A focus session is already active');
    this.name = 'SessionAlreadyActiveError';
    this.body = body;
  }
}

// ---------------------------------------------------------------------------
//  Endpoints
// ---------------------------------------------------------------------------

export async function fetchCurrentSession(): Promise<FocusSessionCurrentResponse> {
  const { data } = await api.get('/v1/focus-sessions/current');
  return focusSessionCurrentResponseSchema.parse(data);
}

export async function startSession(
  body: StartFocusSessionRequest,
): Promise<FocusSessionResponse> {
  try {
    const { data } = await api.post('/v1/focus-sessions', body);
    return focusSessionResponseSchema.parse(data);
  } catch (err) {
    if (err instanceof AxiosError && err.response?.status === 409) {
      const parsed = sessionAlreadyActiveResponseSchema.safeParse(err.response.data);
      if (parsed.success) throw new SessionAlreadyActiveError(parsed.data);
    }
    throw err;
  }
}

export async function pauseSession(id: string): Promise<FocusSessionResponse> {
  const { data } = await api.post(`/v1/focus-sessions/${id}/pause`);
  return focusSessionResponseSchema.parse(data);
}

export async function resumeSession(id: string): Promise<FocusSessionResponse> {
  const { data } = await api.post(`/v1/focus-sessions/${id}/resume`);
  return focusSessionResponseSchema.parse(data);
}

export async function stopSession(id: string): Promise<FocusSessionResponse> {
  const { data } = await api.post(`/v1/focus-sessions/${id}/stop`);
  return focusSessionResponseSchema.parse(data);
}

export async function listSessions(
  query: FocusSessionListQuery = {},
): Promise<FocusSessionListResponse> {
  const { data } = await api.get('/v1/focus-sessions', { params: query });
  return focusSessionListResponseSchema.parse(data);
}

export async function fetchSession(id: string): Promise<FocusSessionResponse> {
  const { data } = await api.get(`/v1/focus-sessions/${id}`);
  return focusSessionResponseSchema.parse(data);
}
