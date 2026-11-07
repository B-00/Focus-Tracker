import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchMeProfile, meQueryKeys, updateMeProfile } from '../../lib/me-api';

// /settings#profile — Profile tab.
//
// v1 scope for this slice: the Memento Mori configuration fields
// (`birthday` + `lifeExpectancyYears` from MementoMori.md §3.3). Email is
// shown read-only. The rest of Settings.md §4.1 (displayName editing,
// timezone override UI, change-password flow) lands in later slices.
//
// ponytail: single-form UX. Dirty-tracking is a flag per field pair; no
// form library. If/when displayName + timezone override controls land
// this is small enough to keep inline; promote to react-hook-form only
// if we add 5+ fields.

const LIFE_YEARS_MIN = 60;
const LIFE_YEARS_MAX = 110;
const LIFE_YEARS_DEFAULT = 80;

interface Props {
  email: string | null;
}

export function ProfileSection({ email }: Props) {
  const qc = useQueryClient();
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: meQueryKeys.profile(),
    queryFn: fetchMeProfile,
  });

  // Local draft — seeded from the server copy, then owned by the form.
  const [birthday, setBirthday] = useState<string>('');
  const [lifeYears, setLifeYears] = useState<number>(LIFE_YEARS_DEFAULT);
  const [justSaved, setJustSaved] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (!data) return;
    setBirthday(data.birthday ?? '');
    setLifeYears(data.lifeExpectancyYears);
  }, [data]);

  const mutation = useMutation({
    mutationFn: updateMeProfile,
    onSuccess: (fresh) => {
      // Push into the query cache so other hooks (useTimezoneAutoDetect,
      // future /life page) pick up the new values without a refetch.
      qc.setQueryData(meQueryKeys.profile(), fresh);
      setJustSaved(true);
      setLocalError(null);
      window.setTimeout(() => setJustSaved(false), 2500);
    },
    onError: (err: unknown) => {
      setLocalError(err instanceof Error ? err.message : 'Failed to save');
    },
  });

  function handleSubmit(e: React.FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    setLocalError(null);

    // Client-side validation — the server re-validates, this is just for UX.
    const trimmed = birthday.trim();
    if (trimmed && !/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      setLocalError('Birthday must be a valid date');
      return;
    }
    if (
      !Number.isInteger(lifeYears) ||
      lifeYears < LIFE_YEARS_MIN ||
      lifeYears > LIFE_YEARS_MAX
    ) {
      setLocalError(`Life expectancy must be an integer between ${LIFE_YEARS_MIN} and ${LIFE_YEARS_MAX}`);
      return;
    }

    mutation.mutate({
      birthday: trimmed ? trimmed : null,
      lifeExpectancyYears: lifeYears,
    });
  }

  const dirty =
    !!data &&
    ((data.birthday ?? '') !== birthday || data.lifeExpectancyYears !== lifeYears);

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-lg font-semibold tracking-tight">Profile</h2>
        <p className="mt-1 text-sm text-neutral-400">
          Account basics. Birthday and life expectancy power the{' '}
          <a href="/life" className="text-emerald-300 hover:underline">
            Memento Mori
          </a>{' '}
          life calendar.
        </p>
      </header>

      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
        <dt className="text-neutral-500">Signed in as</dt>
        <dd className="font-mono text-neutral-200">{email ?? '—'}</dd>
      </dl>

      {isLoading ? (
        <p className="text-sm text-neutral-500">Loading profile…</p>
      ) : isError ? (
        <div className="rounded-md border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-300">
          <p>Failed to load profile: {error instanceof Error ? error.message : 'unknown error'}</p>
          <button
            type="button"
            onClick={() => void refetch()}
            className="mt-2 rounded-md border border-red-500/40 px-2 py-1 text-xs hover:bg-red-500/10"
          >
            Retry
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="block text-xs font-medium uppercase tracking-wide text-neutral-400">
                Birthday
              </span>
              <input
                type="date"
                value={birthday}
                onChange={(e) => setBirthday(e.target.value)}
                className="mt-1 w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-100 focus:border-emerald-400 focus:outline-none focus:ring-1 focus:ring-emerald-400"
              />
              <span className="mt-1 block text-xs text-neutral-500">
                Anchors the life-grid week numbering.
              </span>
            </label>

            <label className="block">
              <span className="block text-xs font-medium uppercase tracking-wide text-neutral-400">
                Life expectancy (years)
              </span>
              <input
                type="number"
                min={LIFE_YEARS_MIN}
                max={LIFE_YEARS_MAX}
                step={1}
                value={lifeYears}
                onChange={(e) => setLifeYears(Number(e.target.value))}
                className="mt-1 w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-100 focus:border-emerald-400 focus:outline-none focus:ring-1 focus:ring-emerald-400"
              />
              <span className="mt-1 block text-xs text-neutral-500">
                {LIFE_YEARS_MIN}–{LIFE_YEARS_MAX}. Sets the total rows in the life grid.
              </span>
            </label>
          </div>

          {localError && (
            <p className="text-sm text-red-300">{localError}</p>
          )}

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={!dirty || mutation.isPending}
              className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-sm text-emerald-200 transition hover:bg-emerald-500/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {mutation.isPending ? 'Saving…' : 'Save changes'}
            </button>
            {justSaved && (
              <span className="text-xs text-emerald-300">Saved ✓</span>
            )}
            {isFetching && !mutation.isPending && !justSaved && (
              <span className="text-xs text-neutral-500">Refreshing…</span>
            )}
          </div>
        </form>
      )}

      <p className="text-xs text-neutral-500">
        Timezone, display name, and password editing are tracked in{' '}
        <span className="font-mono text-neutral-400">Settings.md</span> and
        land in a future slice.
      </p>
    </div>
  );
}
