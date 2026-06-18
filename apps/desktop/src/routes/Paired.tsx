import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { unpairLocal, type DesktopState } from '../lib/tauri';
import { relativeTime } from '../lib/relative-time';

interface PairedProps {
  state: DesktopState;
}

export function Paired({ state }: PairedProps) {
  const qc = useQueryClient();
  const [confirming, setConfirming] = useState(false);

  const unpairMutation = useMutation({
    mutationFn: unpairLocal,
    onSuccess: () => {
      setConfirming(false);
      void qc.invalidateQueries({ queryKey: ['desktop-state'] });
    },
  });

  return (
    <section className="mx-auto flex max-w-md flex-col gap-5 px-6 py-7">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Connected</h1>
        <p className="mt-1 text-xs text-neutral-400">
          This device is paired with Focus Tracker. Activity will be sent in
          the background once the capture loop is enabled.
        </p>
      </header>

      <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1.5 rounded-md border border-neutral-800 bg-neutral-900/40 p-4 text-xs">
        <dt className="text-neutral-500">Label</dt>
        <dd className="text-right text-neutral-300" data-selectable>
          {state.label}
        </dd>

        <dt className="text-neutral-500">API base URL</dt>
        <dd className="truncate text-right font-mono text-neutral-300" data-selectable>
          {state.apiBaseUrl}
        </dd>

        <dt className="text-neutral-500">Device ID</dt>
        <dd className="truncate text-right font-mono text-[0.65rem] text-neutral-400" data-selectable>
          {state.deviceId}
        </dd>

        <dt className="text-neutral-500">Last flush</dt>
        <dd className="text-right text-neutral-400">{relativeTime(state.lastFlushAt)}</dd>
      </dl>

      <div className="rounded-md border border-amber-900/60 bg-amber-950/30 p-3 text-xs text-amber-200">
        <p className="font-medium">Capture loop not implemented yet</p>
        <p className="mt-1 text-amber-200/80">
          The Rust focus-capture loop ships in the next slice. Pairing works
          end-to-end; ingest doesn't yet.
        </p>
      </div>

      {!confirming && (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="self-center rounded-md border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 transition hover:border-red-700 hover:bg-red-950/40 hover:text-red-200"
        >
          Unpair this device
        </button>
      )}

      {confirming && (
        <div className="space-y-3 rounded-md border border-red-900/60 bg-red-950/30 p-3 text-xs">
          <p className="text-red-200">
            Remove the API key from this device? You'll need a new pairing
            code to reconnect. Also revoke the device in the web app's
            Settings → Devices if you want to invalidate the API key
            server-side.
          </p>
          {unpairMutation.isError && (
            <p className="text-red-300">
              Couldn't unpair: {unpairMutation.error.message}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={unpairMutation.isPending}
              className="rounded-md border border-neutral-700 px-2.5 py-1 text-[0.7rem] text-neutral-300 hover:bg-neutral-800 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => unpairMutation.mutate()}
              disabled={unpairMutation.isPending}
              className="rounded-md bg-red-600 px-2.5 py-1 text-[0.7rem] font-medium text-white transition hover:bg-red-500 disabled:bg-red-600/40"
            >
              {unpairMutation.isPending ? 'Unpairing…' : 'Unpair'}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
