// Thin wrappers for `/v1/me/dashboard-prefs`. Kept separate from
// `charts-api.ts` / `tasks-api.ts` because dashboard prefs are read + written
// through a module-level store (widget-order.ts) rather than react-query,
// so there are no shared query keys to co-locate.

import type {
  DashboardPrefsResponse,
  UpdateDashboardPrefsRequest,
} from '@focus-tracker/shared';
import { api } from './api';

export async function fetchDashboardPrefs(): Promise<DashboardPrefsResponse> {
  const { data } = await api.get<DashboardPrefsResponse>('/v1/me/dashboard-prefs');
  return data;
}

export async function updateDashboardPrefs(
  body: UpdateDashboardPrefsRequest,
): Promise<DashboardPrefsResponse> {
  const { data } = await api.put<DashboardPrefsResponse>(
    '/v1/me/dashboard-prefs',
    body,
  );
  return data;
}
