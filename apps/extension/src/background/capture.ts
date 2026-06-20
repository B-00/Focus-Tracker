// Focus-event capture from the browser's tab/window/idle APIs.
//
// Slice 1: emit a log line on every "what is the user looking at now?"
// transition. Slice 2 swaps the log for an outbox append + ULID id +
// session/idle bracketing.
//
// Three sources of truth, in priority order:
//   1. `windows.onFocusChanged(WINDOW_ID_NONE)` — browser lost OS focus.
//      User switched to another app entirely. Current focus becomes null.
//   2. `tabs.onActivated` — user switched to a different tab inside an
//      already-focused window. Current focus becomes the new tab's URL.
//   3. `tabs.onUpdated` (status === "complete" OR url change on the
//      active tab) — same tab navigated to a new URL. Current focus
//      changes domain.
//
// `idle.onStateChanged` bounds the current event but does not, itself,
// ship a wire event (Extension.md §6.1).

import { setCurrentFocus, type FocusTarget } from './state';

const IDLE_THRESHOLD_SECONDS = 60;

export function initCapture(): void {
  // The idle detector kicks in after this many seconds of no input.
  // Firefox throttles state changes after the threshold, so we only get
  // an `idle` event when the user has been gone for a full minute — no
  // chatter on every micro-pause.
  browser.idle.setDetectionInterval(IDLE_THRESHOLD_SECONDS);

  browser.windows.onFocusChanged.addListener(handleWindowFocusChanged);
  browser.tabs.onActivated.addListener(handleTabActivated);
  browser.tabs.onUpdated.addListener(handleTabUpdated);
  browser.idle.onStateChanged.addListener(handleIdleStateChanged);

  // Wake-time bootstrap: there's already a focused window and active
  // tab when the event page wakes, but we missed the events that put
  // them there. Query the current state once.
  void primeCurrentFocus();
}

async function primeCurrentFocus(): Promise<void> {
  try {
    const window = await browser.windows.getLastFocused({ populate: true });
    if (window.id === undefined || window.focused === false) return;
    const activeTab = window.tabs?.find((t) => t.active === true);
    if (!activeTab) return;
    transitionTo(deriveTarget(activeTab));
  } catch (err) {
    console.warn('[focus-tracker] primeCurrentFocus failed', err);
  }
}

function handleWindowFocusChanged(windowId: number): void {
  if (windowId === browser.windows.WINDOW_ID_NONE) {
    // Browser-level defocus: the user switched to another app. The
    // desktop client picks up that app's focus event, so we just have
    // to close out our in-flight browser event.
    transitionTo(null);
    return;
  }
  // A different browser window came into focus. Resolve its active tab.
  void browser.tabs
    .query({ active: true, windowId })
    .then((tabs) => {
      const tab = tabs[0];
      if (!tab) return;
      transitionTo(deriveTarget(tab));
    })
    .catch((err: unknown) => {
      console.warn('[focus-tracker] window-focus tab lookup failed', err);
    });
}

function handleTabActivated(info: browser.tabs._OnActivatedActiveInfo): void {
  void browser.tabs
    .get(info.tabId)
    .then((tab) => transitionTo(deriveTarget(tab)))
    .catch((err: unknown) => {
      console.warn('[focus-tracker] tab-activated lookup failed', err);
    });
}

function handleTabUpdated(
  _tabId: number,
  changeInfo: browser.tabs._OnUpdatedChangeInfo,
  tab: browser.tabs.Tab,
): void {
  // Only the active tab's navigations matter for the focus stream. A
  // background tab loading a new URL doesn't change what the user is
  // currently looking at.
  if (tab.active !== true) return;
  // We care about two transitions:
  //   - URL change (domain might have changed even on same-page navs)
  //   - status reaching "complete" (title finally resolved)
  if (changeInfo.url === undefined && changeInfo.status !== 'complete') return;
  transitionTo(deriveTarget(tab));
}

function handleIdleStateChanged(state: browser.idle.IdleState): void {
  // Firefox's IdleState is only `"active" | "idle"` — it doesn't emit
  // `"locked"` the way Chrome does (the OS screen-lock signal isn't
  // surfaced to the WebExtensions API on Firefox). Treating "anything
  // not active" as AFK keeps us forward-compatible if Firefox ever
  // gains a third state.
  if (state !== 'active') {
    transitionTo(null);
    return;
  }
  // User came back. Re-resolve the focused window/tab.
  void primeCurrentFocus();
}

function transitionTo(next: FocusTarget | null): void {
  const previous = setCurrentFocus(next);
  if (sameTarget(previous, next)) return;
  console.log(
    `[focus-tracker] focus transition: ${formatTarget(previous)} → ${formatTarget(next)}`,
  );
}

function deriveTarget(tab: browser.tabs.Tab): FocusTarget | null {
  // Privacy hard rule (Extension.md §10): never capture in incognito.
  // `tab.incognito` is set by Firefox for private-window tabs.
  if (tab.incognito === true) return null;

  const rawUrl = tab.url;
  if (typeof rawUrl !== 'string' || rawUrl.length === 0) return null;

  let domain: string | null = null;
  try {
    const parsed = new URL(rawUrl);
    // Drop schemes we can't meaningfully attribute to a "site":
    // about:, moz-extension:, file:, javascript:, data:. The desktop
    // client tracks Firefox the application; these in-browser surfaces
    // shouldn't double-count there.
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    domain = parsed.hostname.replace(/^www\./, '');
  } catch {
    return null;
  }

  if (!domain) return null;

  return {
    domain,
    // Tab title is captured for slice 2's wire payload (Extension.md §6.2
    // → `tabTitle`). Stored alongside the domain here so the same
    // transition decision sees both.
    tabTitle: typeof tab.title === 'string' ? tab.title : null,
  };
}

function sameTarget(
  a: FocusTarget | null,
  b: FocusTarget | null,
): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return a.domain === b.domain && a.tabTitle === b.tabTitle;
}

function formatTarget(t: FocusTarget | null): string {
  return t === null ? '(none)' : t.domain;
}
