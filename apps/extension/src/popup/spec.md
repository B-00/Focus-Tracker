# `apps/extension/src/popup/` — Toolbar popup UI

Co-located spec for the popup surface Firefox opens when the user clicks the extension's toolbar icon.

Parent spec: `Sources Markdown/Extension.md` §4 (Pairing UX), §7 (Popup).

## Purpose

Two jobs, gated by whether the extension is paired:

1. **Unpaired** — walk the user through the 6-digit pairing flow so the API can eventually mint an API key.
2. **Paired** — show today's browsing at a glance (donut + top-N list), computed entirely from the local IndexedDB outbox so it works offline and before Slice 4's flusher runs.

## Files

| File               | Responsibility                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------ |
| `index.tsx`        | Popup root. Reads `browser.storage.local` for a paired device and mounts PairingView or StatsView. |
| `PairingView.tsx`  | State machine: request code → show + poll → save API key on `status: 'claimed'`.                 |
| `StatsView.tsx`    | Reads the outbox, sums today's `focus_change` durations per domain, renders donut + list.        |
| `Donut.tsx`        | Compact SVG donut. Track ring in `OTHER_COLOR`, segments painted with `PALETTE[i]`.              |
| `palette.ts`       | Copy of `apps/web/src/routes/activity/palette.ts`. Same 5 hex values → same visual identity.     |
| `popup.css`        | Dark-theme styles. No Tailwind — a single popup doesn't earn the tooling weight.                 |

## Pairing state machine

`PairingView.tsx`:

```
mount
  ├── getPendingPairing()
  │     ├── unexpired hit → phase = 'waiting' (resume the same code)
  │     └── miss/expired  → POST /v1/devices/pairing-codes  (deviceId + platform + label)
  │                            ├── success   → savePendingPairing() → phase = 'waiting'
  │                            ├── 409 device_already_paired → phase = 'error' (revoke-first hint)
  │                            └── other err → phase = 'error' + [Try again]
  │
  └── phase = 'waiting':
        every 2s: GET /v1/devices/pairing-codes/:code
          ├── { status: 'pending' } → keep waiting
          ├── { status: 'claimed', apiKey, device } →
          │        savePairedDevice() → clearPendingPairing() → phase = 'claimed' → onClaimed()
          └── { status: 'expired' } | 404 → clearPendingPairing() → phase = 'error'
```

`onClaimed` is a callback into `index.tsx` which re-checks storage and swaps `PairingView` for `StatsView`.

### Why we persist the pending code

Firefox destroys the popup the instant it loses focus — including when the user switches to the web dashboard tab to enter the code. If we minted a fresh code on every popup open, the second attempt would collide:

- Popup 1 open  → create code A → user clicks web tab, popup dies.
- Web claim on A → server creates the Device row + stashes the API key on code A's row.
- Popup 2 open  → we never retrieved the key from code A → local storage still has no `apiKey`.
- If we call `POST /pairing-codes` again with the same `deviceId`, `PairingService.create()` throws `409 device_already_paired` because a Device row already exists.

So we save `{code, expiresAt}` to `browser.storage.local` on successful create, and resume the same code on next mount. Reopening the popup after the claim lets the very next poll return `{ status: 'claimed', apiKey }`, and we finish the handshake.

If a user somehow gets into the wedged state (paired server-side, no local key), the `409 device_already_paired` branch renders a friendly "revoke and retry" message rather than a raw JSON error.

## Stats aggregation

`StatsView.tsx` calls `sumTodayByDomain()` from `../storage/outbox.ts`:

1. Scan every event in the outbox where `kind === 'focus_change'` and `startedAt >= startOfLocalDay(now)`.
2. Group by `target.domain`, sum `durationMs`.
3. Sort desc, take top 5.
4. Anything beyond top 5 rolls up into "Other".

Heartbeats and session events are ignored — heartbeats have no durations of their own and would double-count against the parent focus_change.

**Currently in-flight focus** (the tab the user is on RIGHT NOW, no close-out event emitted yet) is NOT interpolated in Slice 3 — the number rounds up on the next transition. Slice 4 or 5 can add real-time interpolation by reading the in-memory `getCurrentFocus()` state via a message.

## CORS

Both pairing endpoints (`POST /v1/devices/pairing-codes`, `GET /v1/devices/pairing-codes/:code`) are unauthenticated by design (Auth.md §5.1), and the extension calls them via `fetch()` from the popup. Firefox bypasses CORS enforcement for extension-originated requests whose target matches `host_permissions` — ours declares `<all_urls>`, so this works out of the box.

If the API later moves to strict server-side Origin checking that rejects extension origins, the pattern flips: popup → `browser.runtime.sendMessage` → background page fetches → messages back the result. Background contexts truly bypass CORS in every browser.

## Testing notes

Slice 3 verification:

1. `pnpm dev` from `apps/extension/`.
2. Reload the extension in `about:debugging`.
3. Click the toolbar puzzle-piece icon → **Focus Tracker**. Popup opens showing a 6-digit code.
4. On the web dashboard (`http://localhost:5173`), go to Settings → Devices → Add device, enter the code. This causes the popup to close.
5. Reopen the popup — the persisted pending code resumes polling and switches to the Stats view within ~2 seconds.
6. Browse for a minute; reopen the popup. Donut and top-N list populate.
