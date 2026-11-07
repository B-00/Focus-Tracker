import { ApiBaseUrlBanner } from './ApiBaseUrlBanner';

// /settings#telemetry — read-only panel showing the API base URL the
// source clients should point at (Settings.md §4.5). No per-user
// configuration here in v1 — capture controls live inside each source
// client (extension / desktop app).

const API_BASE_URL =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:3000';

export function TelemetrySection() {
  return (
    <div className="space-y-5">
      <header>
        <h2 className="text-lg font-semibold tracking-tight">Telemetry</h2>
        <p className="mt-1 text-sm text-neutral-400">
          The URL your source clients ingest to. Set at deployment time; not
          per-user editable.
        </p>
      </header>

      <ApiBaseUrlBanner url={API_BASE_URL} />

      <p className="text-xs text-neutral-500">
        Capture controls — which apps and domains get sent to the server at all —
        live inside the extension and desktop app themselves. There's no
        display-side filter on the web app in v1.
      </p>
    </div>
  );
}
