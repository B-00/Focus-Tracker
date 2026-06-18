import type {
  ActivityRange,
  ActivityRecentResponse,
  ActivitySummaryResponse,
} from '@focus-tracker/shared';
import { api } from './api';

// Thin typed wrappers around `/v1/activity/*`. Owned by the Activity
// feature (`Activity.md` §6) and reused by the dashboard's
// "Today's activity" widget.
//
// Query keys are co-located so the 60s background poll and the manual
// refresh button share the same cache slot.

export const activityQueryKeys = {
  all: ['activity'] as const,
  summary: (range: ActivityRange) => [...activityQueryKeys.all, 'summary', range] as const,
  recent: (limit: number) => [...activityQueryKeys.all, 'recent', limit] as const,
};

export async function fetchActivitySummary(
  range: ActivityRange,
): Promise<ActivitySummaryResponse> {
  const res = await api.get<ActivitySummaryResponse>('/v1/activity/summary', {
    params: { range },
  });
  return res.data;
}

export async function fetchActivityRecent(
  limit: number,
): Promise<ActivityRecentResponse> {
  const res = await api.get<ActivityRecentResponse>('/v1/activity/recent', {
    params: { limit },
  });
  return res.data;
}
