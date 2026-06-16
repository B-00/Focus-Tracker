// Cross-app API contract bits used by both the web client and the API.
// Concrete per-feature DTOs live alongside their feature in apps/api/src/<feature>/dto
// and are re-exported through here once they stabilise.

/// Standard error envelope returned by every non-2xx response.
/// PROJECT.md §7.3.
export interface ApiError {
  error: string; // machine-readable code, e.g. "invalid_credentials"
  message?: string; // human-readable; may be omitted in production
  details?: unknown; // structured extras (Zod field issues, conflicting session id, ...)
  hint?: string; // dev-mode-only helpers (Auth.md §6.2)
}

/// Health endpoint response. PROJECT.md §7.7.
export interface HealthResponse {
  status: 'ok';
  apiVersion: string;
  uptime: number; // seconds since process start
  now: string; // ISO 8601 UTC server time
}
