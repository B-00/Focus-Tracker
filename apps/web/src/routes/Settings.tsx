import { useEffect, useMemo, useState } from 'react';
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
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-neutral-400">
          Preferences, account, and paired devices.
        </p>
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
