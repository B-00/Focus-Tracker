import { VacationButton } from '../components/VacationButton';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { logout as apiLogout, logoutAll as apiLogoutAll } from '../lib/auth-api';
import { tokenStorage } from '../lib/token-storage';
import { useAuthStore } from '../stores/auth-store';
import { AboutSection } from './settings/AboutSection';
import { DashboardSection } from './settings/DashboardSection';
import { DevicesSection } from './settings/DevicesSection';
import { MementoMoriSection } from './settings/MementoMoriSection';
import { ProfileSection } from './settings/ProfileSection';

// /settings — left-rail tab layout per Settings.md §3.1.
// Each tab has a kebab-case `#anchor` ID; loading /settings#devices lands
// the user directly on Devices. Hash updates use replaceState so back
// button isn't cluttered (per spec).
//
// All five tabs are implemented: Profile, Memento Mori, Dashboard,
// Devices, About. Each section component lives under ./settings/ and
// owns its own data + save semantics. (The spec's #telemetry tab was
// removed as redundant — DevicesSection already surfaces the API base
// URL via the same ApiBaseUrlBanner during the pairing flow.)

type SectionId =
  | 'profile'
  | 'memento-mori'
  | 'dashboard'
  | 'devices'
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

  /// This-browser-only sign out (mirror of the header button, which is
  /// hidden on mobile). Best-effort server revoke, then always wipe local.
  async function handleSignOut(): Promise<void> {
    setSigningOutAll(true);
    try {
      const refresh = tokenStorage.getRefreshToken();
      if (refresh) await apiLogout(refresh);
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
        <div className="flex shrink-0 flex-col items-end gap-2">
          <VacationButton />
          {/* Mobile-only: the header hides its Sign out below md. */}
          <button
            type="button"
            onClick={() => void handleSignOut()}
            disabled={signingOutAll}
            className="whitespace-nowrap rounded-md border border-neutral-700 px-3 py-1.5 text-xs text-neutral-200 transition hover:bg-neutral-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 disabled:opacity-50 md:hidden"
          >
            Sign out
          </button>
          <button
            type="button"
            onClick={() => void handleLogOutOfAll()}
            disabled={signingOutAll}
            title="Revoke every active session for your account across all browsers and devices."
            className="whitespace-nowrap rounded-md border border-red-500/40 bg-red-500/5 px-3 py-1.5 text-xs text-red-300 transition hover:bg-red-500/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400 disabled:opacity-50"
          >
            {signingOutAll ? 'Signing out…' : 'Log out of all'}
          </button>
        </div>
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
            <ProfileSection email={email} />
          ) : activeId === 'memento-mori' ? (
            <MementoMoriSection />
          ) : activeId === 'dashboard' ? (
            <DashboardSection />
          ) : activeId === 'about' ? (
            <AboutSection />
          ) : null}
        </section>
      </div>
    </main>
  );
}

