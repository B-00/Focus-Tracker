// @focus-tracker/shared — public surface
//
// Anything imported by both `apps/web` and `apps/api` (or the source clients)
// should land here. The Rust desktop client hand-mirrors equivalent shapes
// in `apps/desktop/src-tauri/src/events.rs` once it lands (see PROJECT.md §4.1).
//
// NOTE: Explicit named re-exports (not `export *`) so Rollup / Vite can
// statically trace symbols during prod tree-shaking. TypeScript's CJS output
// for `export *` uses an opaque `__exportStar` helper that bundlers can't
// follow, leading to "X is not exported by …" build errors.

// ---------------------------------------------------------------------------
//  Enums (mirror Prisma)
// ---------------------------------------------------------------------------
export {
  DEVICE_SOURCES,
  TELEMETRY_EVENT_KINDS,
  TASK_KINDS,
  TASK_PRIORITIES,
  TASK_PRIORITY_WEIGHT,
  FOCUS_SESSION_STATES,
  FOCUS_SESSION_MODES,
  FOCUS_SESSION_END_REASONS,
  API_KEY_SCOPES,
} from './enums.js';
export type {
  DeviceSource,
  TelemetryEventKind,
  TaskKind,
  TaskPriority,
  FocusSessionState,
  FocusSessionMode,
  FocusSessionEndReason,
  ApiKeyScope,
} from './enums.js';

// ---------------------------------------------------------------------------
//  Telemetry wire protocol
// ---------------------------------------------------------------------------
export {
  browserFocusTargetSchema,
  desktopFocusTargetSchema,
  telemetryEventSchema,
  telemetryBatchSchema,
  telemetryBatchResponseSchema,
} from './telemetry.js';
export type {
  TelemetryEvent,
  TelemetryBatch,
  TelemetryBatchResponse,
  BrowserFocusTarget,
  DesktopFocusTarget,
} from './telemetry.js';

// ---------------------------------------------------------------------------
//  Generic API
// ---------------------------------------------------------------------------
export type { ApiError, HealthResponse } from './api.js';

// ---------------------------------------------------------------------------
//  Auth (Auth.md)
// ---------------------------------------------------------------------------
export {
  authUserSchema,
  authTokensSchema,
  loginRequestSchema,
  loginResponseSchema,
  refreshRequestSchema,
  logoutRequestSchema,
  changePasswordRequestSchema,
  passwordSchema,
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
  AUTH_ERROR_CODES,
} from './auth.js';
export type {
  AuthUser,
  AuthTokens,
  LoginRequest,
  LoginResponse,
  RefreshRequest,
  RefreshResponse,
  LogoutRequest,
  ChangePasswordRequest,
  AuthErrorCode,
} from './auth.js';

// ---------------------------------------------------------------------------
//  Activity (Activity.md §6)
// ---------------------------------------------------------------------------
export {
  ACTIVITY_RANGES,
  ACTIVITY_BUCKET_GRAINS,
  ACTIVITY_TOP_N,
  ACTIVITY_RECENT_DEFAULT_LIMIT,
  ACTIVITY_RECENT_MAX_LIMIT,
  activitySummaryQuerySchema,
  activityTargetTotalSchema,
  activityBucketSchema,
  activitySummaryResponseSchema,
  activityRecentQuerySchema,
  activityRecentEventSchema,
  activityRecentResponseSchema,
} from './activity.js';
export type {
  ActivityRange,
  ActivityBucketGrain,
  ActivitySummaryQuery,
  ActivityTargetTotal,
  ActivityBucket,
  ActivitySummaryResponse,
  ActivityRecentQuery,
  ActivityRecentEvent,
  ActivityRecentResponse,
} from './activity.js';

// ---------------------------------------------------------------------------
//  Profile (Settings.md §4.1 + §6.3)
// ---------------------------------------------------------------------------
export {
  meProfileResponseSchema,
  updateMeProfileRequestSchema,
} from './me.js';
export type {
  MeProfileResponse,
  UpdateMeProfileRequest,
} from './me.js';

// ---------------------------------------------------------------------------
//  Pairing + Devices (Auth.md §5)
// ---------------------------------------------------------------------------
export {
  deviceProposalSchema,
  pairingCodeCreateRequestSchema,
  pairingCodeCreateResponseSchema,
  pairingCodeClaimResponseSchema,
  deviceListItemSchema,
  PAIRING_ERROR_CODES,
} from './pairing.js';
export type {
  DeviceProposal,
  PairingCodeCreateRequest,
  PairingCodeCreateResponse,
  PairingCodePollResponse,
  PairingCodeClaimResponse,
  DeviceListItem,
  PairingErrorCode,
} from './pairing.js';
