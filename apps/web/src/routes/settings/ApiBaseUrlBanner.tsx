import { useState } from 'react';

// A copy-the-URL pill used by both #devices (as a convenience during the
// pairing flow) and #telemetry (as the sole content of that tab —
// Settings.md §4.5). One component, one source of truth for the copy
// UX and the "where do the clients talk to" message.

interface Props {
  url: string;
}

export function ApiBaseUrlBanner({ url }: Props) {
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
