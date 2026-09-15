// "Not paired yet" popup screen.
//
// State machine:
//   loading   → checking storage / asking the API for a fresh code
//   waiting   → showing the code + countdown, polling every POLL_INTERVAL_MS
//   error     → something exploded; show it, offer a retry button
//   claimed   → hand off to the caller which will re-check storage and
//               swap us out for the Stats view
//
// Firefox popups are destroyed the instant the user clicks anywhere
// outside them — including switching to the web dashboard tab to enter
// the code. If we generated a fresh code on every popup open, the
// second attempt would 409 (`device_already_paired`) because the web
// app's claim already created the Device row. So we persist the
// outstanding code to browser.storage.local and resume polling on it
// when the popup reopens. Only once the code has expired (or the user
// hits "Try again") do we ask the API for a new one.

import { useEffect, useState } from 'preact/hooks';
import type { JSX } from 'preact';

import { PairingApiError, createPairingCode, pollPairingCode } from '../api/pairing';
import {
  clearPendingPairing,
  getOrCreateDeviceId,
  getPendingPairing,
  savePairedDevice,
  savePendingPairing,
} from '../storage/device';

const POLL_INTERVAL_MS = 2000;

type Phase =
  | { name: 'loading' }
  | { name: 'error'; message: string; kind: 'transient' | 'already_paired' }
  | { name: 'waiting'; code: string; expiresAt: Date; label: string }
  | { name: 'claimed' };

interface PairingViewProps {
  onClaimed: () => void;
}

export function PairingView({ onClaimed }: PairingViewProps): JSX.Element {
  const [phase, setPhase] = useState<Phase>({ name: 'loading' });
  const [nowTick, setNowTick] = useState(Date.now());

  // Ask the API for a fresh code on mount (and whenever the user hits Retry).
  // If there's already an unexpired pending code in storage, reuse it so
  // pairing survives popup close/reopen.
  const [retryToken, setRetryToken] = useState(0);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const label = defaultLabel();
        const pending = await getPendingPairing();
        if (pending !== null) {
          if (cancelled) return;
          setPhase({
            name: 'waiting',
            code: pending.code,
            expiresAt: new Date(pending.expiresAt),
            label,
          });
          return;
        }

        const deviceId = await getOrCreateDeviceId();
        const res = await createPairingCode({
          deviceId,
          source: 'browser',
          platform: navigator.userAgent,
          label,
          clientVersion: browser.runtime.getManifest().version,
        });
        await savePendingPairing({ code: res.code, expiresAt: res.expiresAt });
        if (cancelled) return;
        setPhase({
          name: 'waiting',
          code: res.code,
          expiresAt: new Date(res.expiresAt),
          label,
        });
      } catch (err) {
        if (cancelled) return;
        setPhase(phaseFromError(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [retryToken]);

  // While waiting, poll the API and tick a countdown timer.
  useEffect(() => {
    if (phase.name !== 'waiting') return;

    const tickId = window.setInterval(() => setNowTick(Date.now()), 1000);
    const pollId = window.setInterval(async () => {
      try {
        const res = await pollPairingCode(phase.code);
        if (res.status === 'claimed') {
          await savePairedDevice({ apiKey: res.apiKey, label: res.device.label });
          await clearPendingPairing();
          setPhase({ name: 'claimed' });
          onClaimed();
        } else if (res.status === 'expired') {
          await clearPendingPairing();
          setPhase({
            name: 'error',
            kind: 'transient',
            message: 'Code expired. Try again.',
          });
        }
        // status === 'pending' → keep waiting
      } catch (err) {
        setPhase(phaseFromError(err));
      }
    }, POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(tickId);
      window.clearInterval(pollId);
    };
  }, [phase.name === 'waiting' ? phase.code : null]);

  // ─── Render ─────────────────────────────────────────────────────────
  if (phase.name === 'loading') {
    return <div class="pair-loading">Requesting pairing code…</div>;
  }

  if (phase.name === 'claimed') {
    return <div class="pair-claimed">Paired! Loading…</div>;
  }

  if (phase.name === 'error') {
    return (
      <div class="pair-error">
        {phase.kind === 'already_paired' ? (
          <>
            <p class="pair-error__msg">
              This browser was previously paired but the local API key is
              missing (usually because the popup closed mid-pairing).
            </p>
            <p class="pair-error__msg">
              Open the web dashboard → <em>Settings → Devices</em>, click
              <strong> Revoke</strong> next to this Firefox, then hit
              Try&nbsp;again.
            </p>
          </>
        ) : (
          <p class="pair-error__msg">{phase.message}</p>
        )}
        <button
          class="pair-btn"
          onClick={async () => {
            await clearPendingPairing();
            setPhase({ name: 'loading' });
            setRetryToken((n) => n + 1);
          }}
        >
          Try again
        </button>
      </div>
    );
  }

  // phase.name === 'waiting'
  const secondsLeft = Math.max(0, Math.floor((phase.expiresAt.getTime() - nowTick) / 1000));
  const mm = Math.floor(secondsLeft / 60);
  const ss = (secondsLeft % 60).toString().padStart(2, '0');

  return (
    <div class="pair-wait">
      <p class="pair-instructions">Enter this code on the web dashboard:</p>
      <div class="pair-code">{phase.code}</div>
      <p class="pair-hint">
        Settings → Devices → <em>Add device</em>
      </p>
      <div class="pair-status">
        <span class="pair-dot" />
        Waiting for confirmation… ({mm}:{ss})
      </div>
    </div>
  );
}

function phaseFromError(err: unknown): Phase {
  if (err instanceof PairingApiError && err.code === 'device_already_paired') {
    return {
      name: 'error',
      kind: 'already_paired',
      message: err.message,
    };
  }
  const message = err instanceof Error ? err.message : String(err);
  return { name: 'error', kind: 'transient', message };
}

/**
 * Best-effort default device label. Firefox's UA string includes the
 * platform + version we care about; the user can rename it later from
 * the web dashboard.
 */
function defaultLabel(): string {
  const ua = navigator.userAgent;
  const match = /Firefox\/(\d+)/.exec(ua);
  if (match) return `Firefox ${match[1]}`;
  return 'Firefox';
}
