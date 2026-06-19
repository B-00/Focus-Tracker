import type {
  MeProfileResponse,
  UpdateMeProfileRequest,
} from '@focus-tracker/shared';
import { api } from './api';

// Typed wrappers around `/v1/me/profile`. Owned by Settings.md §4.1 /
// §6.3 — the Settings UI will lean on `updateProfile` for manual edits,
// and the auto-detect hook (see `useTimezoneAutoDetect`) uses it on every
// authenticated session boot.

export const meQueryKeys = {
  all: ['me'] as const,
  profile: () => [...meQueryKeys.all, 'profile'] as const,
};

export async function fetchMeProfile(): Promise<MeProfileResponse> {
  const res = await api.get<MeProfileResponse>('/v1/me/profile');
  return res.data;
}

export async function updateMeProfile(
  body: UpdateMeProfileRequest,
): Promise<MeProfileResponse> {
  const res = await api.patch<MeProfileResponse>('/v1/me/profile', body);
  return res.data;
}
