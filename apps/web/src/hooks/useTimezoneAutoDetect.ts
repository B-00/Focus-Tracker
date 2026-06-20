import { useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { activityQueryKeys } from '../lib/activity-api';
import { fetchMeProfile, meQueryKeys, updateMeProfile } from '../lib/me-api';
import { useAuthStore } from '../stores/auth-store';

// Silent timezone backfill from the browser, mounted by the protected
// AppShell so it runs once per authenticated session.
//
// Owner: Settings.md §4.1.1 ("Timezone auto-detect + override").
//
// Behaviour:
//   * Fetch the current profile (`/v1/me/profile`).
//   * If the user has NOT manually overridden (`timezoneOverridden = false`)
//     AND the stored value differs from `Intl.DateTimeFormat().resolvedOptions().timeZone`,
//     PATCH the profile with `{ timezone, autoDetect: true }`.
//   * On success, invalidate Activity queries so every "today" / hourly
//     view re-fetches against the correct local boundaries.
//
// We deliberately do NOT flip the override flag here — that's the manual
// path. A user who clears their browser data and signs back in from a new
// timezone WILL have their TZ auto-updated, which matches the spec intent.

export function useTimezoneAutoDetect(): void {
  const isAuthed = useAuthStore((s) => Boolean(s.user));
  const queryClient = useQueryClient();
  const ranRef = useRef(false);

  const profileQuery = useQuery({
    queryKey: meQueryKeys.profile(),
    queryFn: fetchMeProfile,
    enabled: isAuthed,
    staleTime: Infinity, // The profile changes via explicit user action, not background polling.
  });

  const mutation = useMutation({
    mutationFn: updateMeProfile,
    onSuccess: (updated) => {
      queryClient.setQueryData(meQueryKeys.profile(), updated);
      // Activity bucketing depends on tz — refetch every range so the user
      // sees correct boundaries immediately, not on the next 60s poll.
      void queryClient.invalidateQueries({ queryKey: activityQueryKeys.all });
    },
  });

  useEffect(() => {
    if (ranRef.current) return;
    if (!isAuthed) return;

    const profile = profileQuery.data;
    if (!profile) return;

    // Honour a prior manual override — silent backfill never wins over that.
    if (profile.timezoneOverridden) {
      ranRef.current = true;
      return;
    }

    const detected = detectBrowserTimezone();
    if (!detected || detected === profile.timezone) {
      ranRef.current = true;
      return;
    }

    ranRef.current = true;
    mutation.mutate({ timezone: detected, autoDetect: true });
  }, [isAuthed, profileQuery.data, mutation]);
}

/// Returns the browser's IANA timezone, or null if unavailable. `resolvedOptions`
/// is supposed to always return a `timeZone` per ECMA-402, but some headless
/// envs and older mobile WebViews omit it.
function detectBrowserTimezone(): string | null {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof tz === 'string' && tz.length > 0 ? tz : null;
  } catch {
    return null;
  }
}
