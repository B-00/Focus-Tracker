import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { DeviceListItem, PairingCodeClaimResponse } from '@focus-tracker/shared';
import { devicesQueryKeys, listDevices } from '../../lib/devices-api';
import { isStale, relativeTime } from '../../lib/relative-time';
import { PairDeviceModal } from './PairDeviceModal';
import { RevokeDeviceModal } from './RevokeDeviceModal';

// /settings#devices — paired-device list + pair + revoke flows.
// Spec: Settings.md §4.4.

const STALE_INGEST_THRESHOLD_HOURS = 24;
const API_BASE_URL =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:3000';

export function DevicesSection() {
  const [pairOpen, setPairOpen] = useState(false);
  const [revoking, setRevoking] = useState<DeviceListItem | null>(null);
  const [justPairedId, setJustPairedId] = useState<string | null>(null);

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: devicesQueryKeys.list(),
    queryFn: listDevices,
  });

  // Highlight the freshly-paired row briefly so the user can spot it.
  useEffect(() => {
    if (!justPairedId) return;
    const id = window.setTimeout(() => setJustPairedId(null), 4000);
    return () => window.clearTimeout(id);
  }, [justPairedId]);

  function handlePaired(device: PairingCodeClaimResponse): void {
    setJustPairedId(device.deviceId);
  }

  return (
    <div className="space-y-5">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Devices</h2>
          <p className="mt-1 text-sm text-neutral-400">
            Browser extensions and desktop apps paired with this account.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setPairOpen(true)}
          className="rounded-md bg-emerald-500 px-3 py-1.5 text-xs font-medium text-emerald-950 transition hover:bg-emerald-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
        >
          Pair new device
        </button>
      </header>

      <ApiBaseUrlBanner url={API_BASE_URL} />

      {isLoading && (
        <p className="rounded-md border border-neutral-800 bg-neutral-900 p-4 text-sm text-neutral-400">
          Loading devices…
        </p>
      )}

      {isError && (
        <div
          role="alert"
          className="rounded-md border border-red-900 bg-red-950/40 p-3 text-sm text-red-200"
        >
          <p className="font-medium">Couldn't load devices.</p>
          <p className="mt-1 text-red-300/80">
            {error instanceof Error ? error.message : 'Unknown error.'}
          </p>
          <button
            type="button"
            onClick={() => void refetch()}
            disabled={isFetching}
            className="mt-2 rounded-md border border-red-900 px-2.5 py-1 text-xs text-red-200 hover:bg-red-950"
          >
            {isFetching ? 'Retrying…' : 'Retry'}
          </button>
        </div>
      )}

      {!isLoading && !isError && data && data.length === 0 && (
        <EmptyState onPair={() => setPairOpen(true)} />
      )}

      {!isLoading && !isError && data && data.length > 0 && (
        <ul className="divide-y divide-neutral-800 overflow-hidden rounded-md border border-neutral-800">
          {data.map((d) => (
            <DeviceRow
              key={d.id}
              device={d}
              highlighted={d.id === justPairedId}
              onRevoke={() => setRevoking(d)}
            />
          ))}
        </ul>
      )}

      <PairDeviceModal
        open={pairOpen}
        onClose={() => setPairOpen(false)}
        onPaired={handlePaired}
      />
      <RevokeDeviceModal device={revoking} onClose={() => setRevoking(null)} />
    </div>
  );
}

// ---------------------------------------------------------------------------
//  Row
// ---------------------------------------------------------------------------

interface DeviceRowProps {
  device: DeviceListItem;
  highlighted: boolean;
  onRevoke: () => void;
}

function DeviceRow({ device, highlighted, onRevoke }: DeviceRowProps) {
  const [expanded, setExpanded] = useState(false);
  const stale = isStale(device.lastSuccessfulIngestAt, STALE_INGEST_THRESHOLD_HOURS);

  return (
    <li
      className={`flex flex-col px-4 py-3 transition-colors ${
        highlighted ? 'bg-emerald-950/40' : 'bg-neutral-900/40'
      }`}
    >
      <div className="flex items-center gap-3">
        <SourceIcon source={device.source} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-medium text-neutral-100">{device.label}</p>
            {stale && (
              <span className="rounded-full border border-amber-700/60 bg-amber-950/60 px-1.5 py-0.5 text-[0.65rem] font-medium text-amber-200">
                No recent ingest
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-neutral-400">
            Last seen {relativeTime(device.lastSeen)}
            {device.clientVersion && (
              <>
                {' · '}
                <span className="font-mono">v{device.clientVersion}</span>
              </>
            )}
          </p>
        </div>

        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-controls={`device-detail-${device.id}`}
          className="rounded-md p-1 text-neutral-500 transition hover:bg-neutral-800 hover:text-neutral-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
          aria-label={expanded ? 'Collapse device details' : 'Expand device details'}
        >
          <Chevron expanded={expanded} />
        </button>

        <button
          type="button"
          onClick={onRevoke}
          className="rounded-md border border-neutral-700 px-2.5 py-1 text-xs text-neutral-300 transition hover:border-red-700 hover:bg-red-950/40 hover:text-red-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
        >
          Revoke
        </button>
      </div>

      {expanded && (
        <dl
          id={`device-detail-${device.id}`}
          className="mt-3 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 border-t border-neutral-800 pt-3 text-xs"
        >
          <dt className="text-neutral-500">Device ID</dt>
          <dd className="break-all font-mono text-neutral-300">{device.id}</dd>

          <dt className="text-neutral-500">Source</dt>
          <dd className="font-mono text-neutral-300">{device.source}</dd>

          <dt className="text-neutral-500">Platform</dt>
          <dd className="text-neutral-300">{device.platform ?? '—'}</dd>

          <dt className="text-neutral-500">Paired</dt>
          <dd className="text-neutral-300">{relativeTime(device.pairedAt)}</dd>

          <dt className="text-neutral-500">Last successful ingest</dt>
          <dd className={stale ? 'text-amber-300' : 'text-neutral-300'}>
            {relativeTime(device.lastSuccessfulIngestAt)}
          </dd>
        </dl>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
//  Sub-components
// ---------------------------------------------------------------------------

function SourceIcon({ source }: { source: DeviceListItem['source'] }) {
  // Spec calls for emoji icons (🌐 / 🖥️) but real glyphs render
  // inconsistently across platforms — stick to a tinted text badge that
  // looks the same everywhere until we have a real icon system.
  const isDesktop = source === 'desktop';
  return (
    <span
      aria-hidden
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md border text-[0.65rem] font-semibold uppercase tracking-wider ${
        isDesktop
          ? 'border-sky-900 bg-sky-950/50 text-sky-300'
          : 'border-violet-900 bg-violet-950/50 text-violet-300'
      }`}
    >
      {isDesktop ? 'Dsk' : 'Web'}
    </span>
  );
}

function Chevron({ expanded }: { expanded: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`transition-transform ${expanded ? 'rotate-180' : ''}`}
      aria-hidden
    >
      <polyline points="6 8 10 12 14 8" />
    </svg>
  );
}

function EmptyState({ onPair }: { onPair: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-md border border-dashed border-neutral-800 bg-neutral-900/40 px-6 py-10 text-center">
      <p className="text-sm text-neutral-300">No devices paired yet.</p>
      <p className="max-w-xs text-xs text-neutral-500">
        Install the browser extension or desktop app, then pair it here to start
        seeing your activity.
      </p>
      <button
        type="button"
        onClick={onPair}
        className="mt-1 rounded-md bg-emerald-500 px-3 py-1.5 text-xs font-medium text-emerald-950 transition hover:bg-emerald-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
      >
        Pair your first device
      </button>
    </div>
  );
}

function ApiBaseUrlBanner({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API may be unavailable in non-secure contexts (e.g. http://
      // on a non-localhost host). Fall through silently — the user can still
      // select + copy the text manually.
    }
  }

  return (
    <div className="flex items-center gap-3 rounded-md border border-neutral-800 bg-neutral-950/60 px-3 py-2 text-xs">
      <div className="min-w-0 flex-1">
        <p className="text-neutral-400">
          Paste this into your extension and desktop app when pairing.
        </p>
        <p className="mt-0.5 font-mono text-neutral-200">{url}</p>
      </div>
      <button
        type="button"
        onClick={() => void handleCopy()}
        className="rounded-md border border-neutral-700 px-2.5 py-1 text-xs text-neutral-200 transition hover:bg-neutral-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
      >
        {copied ? 'Copied!' : 'Copy'}
      </button>
    </div>
  );
}
