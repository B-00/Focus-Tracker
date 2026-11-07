// `/v1/me/dashboard-prefs` contract shared by the API and the web app.
//
// Owner: Features Markdown/Dashboard.md §9 (per-user prefs) backed by the
// `UserDashboardPrefs` Prisma model.
//
// v1 scope ships only `widgetOrder`. The `hiddenWidgets` + `collapsedWidgets`
// arrays are reserved in the schema (and persisted when sent) so adding the
// hide/show and collapse UI later doesn't require a wire change.

import { z } from 'zod';

// ---------------------------------------------------------------------------
//  Shared
// ---------------------------------------------------------------------------

/// Widget IDs are free-form strings on the wire — the client owns the enum
/// of valid IDs and filters unknown values on load. This keeps the server
/// from needing a redeploy every time the dashboard sprouts a new widget.
const widgetIdList = z.array(z.string().min(1).max(64)).max(64);

// ---------------------------------------------------------------------------
//  GET /v1/me/dashboard-prefs
// ---------------------------------------------------------------------------

export const dashboardPrefsResponseSchema = z.object({
  widgetOrder: widgetIdList,
  hiddenWidgets: widgetIdList,
  collapsedWidgets: widgetIdList,
});
export type DashboardPrefsResponse = z.infer<typeof dashboardPrefsResponseSchema>;

// ---------------------------------------------------------------------------
//  PUT /v1/me/dashboard-prefs
// ---------------------------------------------------------------------------

/// Full replace (not partial patch) — the whole prefs row is a single
/// "customisation blob" and the client always has the full state in hand
/// when it writes. Simpler semantics, no merge races.
export const updateDashboardPrefsRequestSchema = z.object({
  widgetOrder: widgetIdList,
  hiddenWidgets: widgetIdList.optional(),      // defaults to [] on the server
  collapsedWidgets: widgetIdList.optional(),   // defaults to [] on the server
});
export type UpdateDashboardPrefsRequest = z.infer<
  typeof updateDashboardPrefsRequestSchema
>;
