import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { logoutAll as apiLogoutAll } from '../lib/auth-api';
import { useAuthStore } from '../stores/auth-store';
import { DevicesSection } from './settings/DevicesSection';

// /settings — left-rail tab layout per Settings.md §3.1.
// Each tab has a kebab-case `#anchor` ID; loading /settings#devices lands
// the user directly on Devices. Hash updates use replaceState so back
// button isn't cluttered (per spec).
//
// v1-of-this-slice scope: only the Devices tab is implemented. The other
// five tabs (Profile, Memento Mori, Dashboard, Telemetry, About) are
// stub panels with a "Coming soon" message so the rail looks right and
// future slices can swap them in without re-laying-out the page.

type SectionId =
  | 'profile'
  | 'memento-mori'
  | 'dashboard'
  | 'devices'
  | 'telemetry'
  | 'about';

interface SectionDef {
  id: SectionId;
  label: string;
}

const SECTIONS: ReadonlyArray<SectionDef> = [
  { id: 'profile', label: 'Profile' },
  { id: 'memento-mori', label: 'Memento Mori' },
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'devices', label: 'Devices' },
  { id: 'telemetry', label: 'Telemetry' },
  { id: 'about', label: 'About' },
];

const DEFAULT_SECTION: SectionId = 'profile';

function parseHash(hash: string): SectionId {
  const stripped = hash.startsWith('#') ? hash.slice(1) : hash;
  if (SECTIONS.some((s) => s.id === stripped)) return stripped as SectionId;
  return DEFAULT_SECTION;
}

export function SettingsPage() {
  const [activeId, setActiveId] = useState<SectionId>(() =>
    parseHash(typeof window !== 'undefined' ? window.location.hash : ''),
  );
  const [signingOutAll, setSigningOutAll] = useState(false);
  const navigate = useNavigate();
  const resetSession = useAuthStore((s) => s.resetSession);
  const email = useAuthStore((s) => s.user?.email ?? null);

  async function handleLogOutOfAll(): Promise<void> {
    // Settings.md §4.1: Profile is the home for the "sign everywhere out"
    // escape hatch (the day-to-day Sign Out in the nav logs out of this
    // browser only). Best-effort server call then wipe local state so
    // the user isn't trapped half-authed if the API blips.
    setSigningOutAll(true);
    try {
      await apiLogoutAll();
    } catch {
      // intentional — fall through to the local reset
    } finally {
      resetSession();
      setSigningOutAll(false);
      void navigate({ to: '/login' });
    }
  }

  // Sync to URL changes (back/forward, manual edit, deep-link from other
  // pages). We use a native hashchange listener instead of TanStack Router
  // hash because the spec wants replaceState (no history pollution) and
  // both ergonomics + behaviour are simpler with the platform API here.
  useEffect(() => {
    function onHashChange(): void {
      setActiveId(parseHash(window.location.hash));
    }
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  function selectSection(id: SectionId): void {
    if (id === activeId) return;
    // replaceState per Settings.md §3.1: tab switches don't pollute history.
    const url = new URL(window.location.href);
    url.hash = id;
    window.history.replaceState(null, '', url.toString());
    setActiveId(id);
  }

  const activeLabel = useMemo(
    () => SECTIONS.find((s) => s.id === activeId)?.label ?? 'Settings',
    [activeId],
  );

  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
          <p className="mt-1 text-sm text-neutral-400">
            Preferences, account, and paired devices.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void handleLogOutOfAll()}
          disabled={signingOutAll}
          title="Revoke every active session for your account across all browsers and devices."
          className="shrink-0 rounded-md border border-red-500/40 bg-red-500/5 px-3 py-1.5 text-xs text-red-300 transition hover:bg-red-500/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400 disabled:opacity-50"
        >
          {signingOutAll ? 'Signing out…' : 'Log out of all'}
        </button>
      </header>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-[180px_1fr]">
        {/* Left rail */}
        <nav aria-label="Settings sections" className="md:sticky md:top-16 md:self-start">
          <ul className="flex gap-1 overflow-x-auto md:flex-col md:gap-0.5 md:overflow-visible">
            {SECTIONS.map((s) => {
              const active = s.id === activeId;
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => selectSection(s.id)}
                    aria-current={active ? 'page' : undefined}
                    className={`w-full whitespace-nowrap rounded-md px-3 py-2 text-left text-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 ${
                      active
                        ? 'bg-neutral-800 font-medium text-neutral-100'
                        : 'text-neutral-400 hover:bg-neutral-900 hover:text-neutral-200'
                    }`}
                  >
                    {s.label}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Right pane */}
        <section
          id={activeId}
          aria-label={activeLabel}
          className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-5"
        >
          {activeId === 'devices' ? (
            <DevicesSection />
          ) : activeId === 'profile' ? (
            <ProfileStub email={email} />
          ) : (
            <StubSection label={activeLabel} />
          )}
        </section>
      </div>
    </main>
  );
}

function StubSection({ label }: { label: string }) {
  return (
    <div>
      <h2 className="text-lg font-semibold tracking-tight">{label}</h2>
      <p className="mt-2 text-sm text-neutral-400">
        Not implemented yet. Tracking in <span className="font-mono text-neutral-300">Settings.md</span>.
      </p>
    </div>
  );
}

// Partial Profile section — the full form (birthday, lifespan, timezone,
// password per Settings.md §4.1) lands in a future slice. For now we show
// the one piece of profile data we actually have hydrated: the account
// email, moved here from the nav bar.
function ProfileStub({ email }: { email: string | null }) {
  return (
    <div>
      <h2 className="text-lg font-semibold tracking-tight">Profile</h2>
      <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
        <dt className="text-neutral-500">Signed in as</dt>
        <dd className="font-mono text-neutral-200">{email ?? '—'}</dd>
      </dl>
      <p className="mt-4 text-xs text-neutral-500">
        Birthday, lifespan, timezone, and password editing are tracked in{' '}
        <span className="font-mono text-neutral-400">Settings.md</span> and
        land in a future slice.
      </p>
    </div>
  );
}
