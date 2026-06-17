# Focus Tracker — Authentication & Authorization (Spec)

> Two parallel auth paths: **user/JWT** for the web app, **per-device API key** for the source clients. One spec because they share guards, key shapes, and the `User` row, even though the credentials and lifetimes differ.

**Status:** Specification in progress. v1 first batch (see `PROJECT.md` §6 / §9).

---

## 1. Overview

Auth is infrastructure, not a user-facing feature — but every feature spec touches it (login, password change, sign-out, source-client pairing, the API guards that protect every endpoint). This document consolidates the decisions previously listed as TBD in `PROJECT.md` §9 and the source-client auth fragments in `PROJECT.md` §12.3 / `Sources Markdown/Extension.md` §9 / `Sources Markdown/DesktopApp.md` (pairing flow).

Two distinct credentials authenticate against this API:

| Path | Credential | Holder | Lifetime | Scope |
| --- | --- | --- | --- | --- |
| **User/JWT** | Access token (short JWT) + refresh token (opaque, rotated) | The human user, in the web app | Access 15min · refresh 30 days sliding | Full user data (tasks, sessions, etc.) |
| **Source-client API key** | One long opaque token prefixed `ft_live_` | A paired device (browser extension or desktop app) | Long-lived; revoked manually | `telemetry:write` only |

The two paths share the `User` row (every credential is bound to a user) and use the same `Authorization: Bearer <token>` header, but they go through **different guards** on the server — discrimination happens at the guard, based on token shape (JWT vs `ft_live_` prefix). See §3.

### What this spec is NOT
- A multi-user / RBAC design — single-user v1 (per `PROJECT.md` §1.1). Schema is multi-user-ready but no role / permission system ships in v1.
- A full OAuth or SSO design — out of scope (`PROJECT.md` §9).
- A password reset design — explicitly deferred (`PROJECT.md` §9); v1 uses a CLI reset command (§7.3).
- A 2FA design — deferred to v2.

---

## 2. Goals & Non-Goals

### Goals
- One clear story for "how does anyone talk to this API" covering both human and machine credentials.
- Per-use refresh token rotation (a leaked refresh token gets revoked the next time either party uses the chain).
- A single source of truth for password handling, hashing, and strength requirements.
- A CLI bootstrap path that works on a fresh deploy with no UI.
- Rate limiting on every credential-touching endpoint.
- An honest write-up of the localStorage trade-off and the compensating controls.

### Non-Goals (v1)
- Self-service signup or password reset via email (no SMTP plumbing in v1).
- OAuth providers, magic links, WebAuthn / passkeys, 2FA.
- Per-route fine-grained permissions beyond the two scopes (`user:*` vs `telemetry:write`).
- Session inspection UI ("here's every active session, on each device, revoke any" — deferred; v1 only exposes "Sign out everywhere").
- A token introspection endpoint (`POST /oauth/introspect` style) — internal verification only.

---

## 3. The two auth paths (overview)

```
┌─────────────────────────────────────────────────────────────────────┐
│                     Focus Tracker API surface                        │
│                                                                      │
│  ┌────────────────────────┐     ┌─────────────────────────────────┐ │
│  │ JwtAuthGuard           │     │ ApiKeyAuthGuard                 │ │
│  │ (verifies access JWT)  │     │ (verifies ft_live_… key)        │ │
│  │ — protects everything  │     │ — protects only ingest +        │ │
│  │   except /auth/* and   │     │   pairing-code polling endpoints│ │
│  │   /v1/devices/pairing- │     │                                 │ │
│  │   codes/{code}/claim   │     │                                 │ │
│  │   needs JWT itself     │     │                                 │ │
│  └────────────────────────┘     └─────────────────────────────────┘ │
│            ▲                                        ▲                │
│            │ Authorization: Bearer <JWT>            │ Authorization: │
│            │                                        │ Bearer ft_live_│
│  ┌─────────┴──────────┐               ┌─────────────┴──────────────┐ │
│  │ Web app (browser)  │               │ Source clients             │ │
│  │ Holds:             │               │ (browser ext + desktop app)│ │
│  │ • accessToken (LS) │               │ Hold: ft_live_… key only   │ │
│  │ • refreshToken (LS)│               │ (issued per device)        │ │
│  └────────────────────┘               └────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

Token-type discrimination is by **prefix**:
- A token matching `^ft_live_[A-Za-z0-9_-]+$` is treated as an API key.
- Anything else is parsed as a JWT.
- A guard mismatch returns `401 token_wrong_type` so the client knows the issue isn't auth failure but wrong credential class.

Same `Authorization: Bearer ...` header for both — the only HTTP-level difference is which guard the route is decorated with on the server.

---

## 4. User authentication (JWT path)

### 4.1 Login flow

```
POST /v1/auth/login                  { email, password }
  ├─ 200 → { accessToken, refreshToken, accessExpiresAt, refreshExpiresAt, user }
  ├─ 401 → { error: "invalid_credentials" }   ← same response for "no user" and "wrong password"
  └─ 503 → { error: "no_user_seeded", hint: "Run pnpm api:seed-user …" }  ← only in DEV mode (§6.2)
```

- Server verifies the email exists and the password matches via argon2id (§7.1).
- On success, mints a new access JWT and a new refresh token, persists the refresh token's hash (never the raw value) in `RefreshToken` (§10.2), and returns both to the client.
- On failure, returns `401` with a constant-time message so brute-force can't time-discriminate "wrong password" from "no user." (In dev mode only, the no-user case returns `503` with a hint — see §6.2.)
- The `user` field in the success response is a minimal projection: `{ id, email, displayName }`. Everything else the web app needs comes from `/v1/me/profile` (Settings §4.1).

### 4.2 Token storage (web app)

| Token | Storage | Lifetime | Why |
| --- | --- | --- | --- |
| Access JWT | `localStorage.accessToken` | 15 min | Survives reloads; cleared on logout. Per-tab access from `useAuthStore` / Axios interceptor (§12.2). |
| Refresh token | `localStorage.refreshToken` | 30 days sliding | Survives reloads; not auto-sent (no cookie) so the only path to use it is the explicit `/v1/auth/refresh` call. |

**The trade-off:** localStorage is readable by any JavaScript running in the origin. The chosen mitigation is to make sure **no untrusted JavaScript ever runs in this origin** (§9). At personal-use scale (single user, self-hosted), this is acceptable. If the threat model ever expands (multi-user SaaS, third-party scripts, user-generated HTML), this should be revisited — see §9.4.

Tokens are NEVER:
- Logged to console in production builds.
- Placed in URLs (no `?token=...` query params; no fragment auth).
- Sent to any third-party domain.

### 4.3 Access token

A standard signed JWT.

| Claim | Value |
| --- | --- |
| `sub` | `user.id` |
| `iat` | issue time (epoch seconds) |
| `exp` | issue time + 15 min |
| `jti` | unique id (random) — useful for tracing but not for revocation (see below) |
| `scope` | `"user"` — to distinguish from API-key requests at the guard level |

- **Algorithm:** HS256 with a server-side secret (rotated manually via env var — operational concern documented in §13).
- **No DB lookup on every request** — verification is signature + `exp` check only. This is the entire point of using JWTs for access.
- **Not revocable individually.** A compromised access token is valid for up to 15 minutes regardless of any server-side action. Compensating control: short TTL + refresh-token revocation breaks the renewal cycle within minutes.
- **Refreshed silently** before expiry (the web app's Axios interceptor retries any `401 token_expired` once by calling `/v1/auth/refresh` first — §12.3).

### 4.4 Refresh token + rotation

Refresh tokens are **opaque random strings** (32 bytes base64url, ~43 chars). Not JWTs — they carry no claims, just a lookup key.

```
RefreshToken row:
  id          = cuid
  userId      = user.id
  tokenHash   = sha256(rawToken)  // never store raw
  issuedAt    = now()
  expiresAt   = now() + 30 days
  revokedAt   = null
  userAgent   = req headers       // for future "active sessions" UI
  ip          = req remote address
```

**Rotation rule:** every successful call to `/v1/auth/refresh` does this atomically:
1. Look up the row by `tokenHash`.
2. If not found, or `revokedAt != null`, or `expiresAt < now()` → `401 refresh_invalid` (don't distinguish the three cases in the response; same posture as the constant-time login).
3. Otherwise: mark this row `revokedAt = now()`; insert a fresh row with a new random token and fresh `expiresAt`. Mint a fresh access JWT. Return both.

**Sliding window:** because each rotation issues a fresh 30-day refresh, an active user effectively stays logged in indefinitely. An idle user past 30 days is logged out.

**On leaked refresh tokens:** if an attacker uses a stolen refresh once, they get a new pair and the legit user's next refresh fails (the old token is revoked) — forcing the user back to login. The user logging in again invalidates nothing the attacker holds; the user must explicitly hit "Sign out everywhere" (§4.6) to revoke the attacker's stolen-and-rotated token. This is the personal-use trade-off vs. enterprise-style family / reuse-detection machinery: simpler implementation, smaller blast radius if the user is paying attention to "Hey, I got logged out for no reason — let me sign out everywhere just in case."

### 4.5 Refresh endpoint

```
POST /v1/auth/refresh                { refreshToken }
  ├─ 200 → { accessToken, refreshToken, accessExpiresAt, refreshExpiresAt }
  └─ 401 → { error: "refresh_invalid" }   ← covers "not found", "revoked", "expired"
```

- No JWT auth required (the refresh token IS the credential).

### 4.6 Logout

Two endpoints; the UI in Settings §4.1 calls one based on user intent.

```
POST /v1/auth/logout              (JWT-auth required) { refreshToken }
  └─ 204 → revokes the supplied refresh token row

POST /v1/auth/logout-all          (JWT-auth required)
  └─ 204 → revokes every non-revoked RefreshToken row for the current userId
```

`logout` takes the refresh token in the body because the access JWT only proves identity, not which row to revoke.

**Client-side on logout:**
1. Call `/v1/auth/logout` (or `/auth/logout-all`). Don't await — fire-and-forget is fine; even if the network call fails, step 2 still happens.
2. Clear `localStorage.accessToken` and `localStorage.refreshToken`.
3. Reset the auth Zustand store.
4. Redirect to `/login`.

**If logout was offline / failed:** the access token still expires in ≤15 min and the refresh token is gone from localStorage. The server-side row stays valid until its `expiresAt`. Acceptable trade-off for the offline case — not a real security exposure since the credential is already gone from the only device that had it.

**Other open tabs in the same browser** will keep working until their access token expires (≤15 min), then fail their next refresh because the refresh token is gone from localStorage. They redirect to `/login` at that point. No multi-tab sync in v1.

### 4.7 Password change

`POST /v1/me/password` is the only credential-rotation endpoint for users.

```
POST /v1/me/password              (JWT-auth required)
{
  currentPassword: string,
  newPassword: string,
  signOutOtherDevices: boolean,   // defaults to true on the UI
  refreshToken: string            // identifies the current device so it isn't logged out by signOutOtherDevices
}
  ├─ 204 → success
  ├─ 400 → { error: "weak_password", reason }   ← see §7.2
  └─ 401 → { error: "current_password_wrong" }
```

Server steps:
1. Re-verify `currentPassword` via argon2id (independent of the JWT — JWT proves "this user", current-password proves "actually this user, right now").
2. Hash `newPassword` with argon2id; update `User.passwordHash`.
3. If `signOutOtherDevices === true`: revoke every `RefreshToken` row for this `userId` EXCEPT the one identified by the body's `refreshToken` (the device performing the change keeps its session alive).
4. If `signOutOtherDevices === false`: leave all existing refresh tokens alone.
5. Return `204`.

The current device's access token continues to work until its natural `exp`; that's fine, the password change doesn't suddenly invalidate proof-of-identity for the device that just performed the change.

---

## 5. Source-client authentication (API-key path)

This section formalises and consolidates what `PROJECT.md` §12.3 + §12.6 and `Sources Markdown/Extension.md` §9 already sketch.

### 5.1 Pairing flow (recap)

Cross-references: `PROJECT.md` §12.6 (endpoint inventory), `Sources Markdown/Extension.md` §9.1 (sequence diagram). The flow is unchanged by this spec — restating only the auth-relevant beats:

1. Device → `POST /v1/devices/pairing-codes { deviceId, platform, label }` — **no auth** (this is the bootstrap; the device has no credentials yet). Server creates a `PairingCode` row with `code` (6 numeric digits, server-generated), `expiresAt = now() + 5min`, `claimedByUserId = null`, and returns `{ code, expiresAt }`.
2. User reads the code from the device's UI, types it into Settings → Devices, web app calls `POST /v1/devices/pairing-codes/{code}/claim` — **JWT-auth required** (this is what binds the device to the right user).
3. Server validates the code (`claimedByUserId == null`, `expiresAt > now()`); on success, mints an API key (§5.2), creates a `Device` row, persists the API-key hash on the `ApiKey` row, sets `PairingCode.claimedByUserId = currentUserId` and `claimedAt = now()`.
4. Device polls `GET /v1/devices/pairing-codes/{code}` every 3s — **no auth required** (still bootstrap). Returns `202 { status: "pending" }` until claimed, then `200 { apiKey: "ft_live_…", device: {…} }` exactly once. After return, the `PairingCode` row is deleted (one-shot).

**Rate limiting on the unauthenticated bootstrap endpoints** is critical (§8.1).

### 5.2 API key format and minting

```
ft_live_<32 url-safe base64 chars>
```

- `ft_live_` is the production prefix. A future `ft_test_` prefix could distinguish staging keys; not used in v1.
- The 32-char tail is random (24 bytes from `crypto.randomBytes`, base64url-encoded).
- The full token is shown to the device **exactly once** (in the pairing-code-poll response). The server stores only `sha256(token)` in `ApiKey.tokenHash`.

```
ApiKey row:
  id          = cuid
  userId      = the user who claimed the pairing
  deviceId    = the Device row created at the same moment
  tokenHash   = sha256(rawToken)
  scope       = "telemetry:write"
  createdAt   = now()
  revokedAt   = null
```

No `expiresAt` — API keys are long-lived. The user's only recovery from leak is `DELETE /v1/devices/{deviceId}` (Settings §4.5), which sets `revokedAt = now()` on the row.

### 5.3 Request format

```
POST /v1/telemetry/batch HTTP/1.1
Authorization: Bearer ft_live_a1b2c3d4e5...
Content-Type:  application/json
X-Client:      focus-tracker-extension/1.0.0
```

- The `ApiKeyAuthGuard` recognises the `ft_live_` prefix, hashes the incoming token, looks up the row by hash, verifies `revokedAt == null`, attaches `{ userId, deviceId, scope }` to the request context, and bumps `Device.lastSeen = now()` (per `PROJECT.md` §12.5 / `Settings.md` §4.4).
- Lookup is a single indexed query on `ApiKey.tokenHash`. At one-user scale this is sub-millisecond.

### 5.4 Scope enforcement

API keys are scoped `telemetry:write`. The `ApiKeyAuthGuard` accepts ONLY:
- `POST /v1/telemetry/batch`
- `POST /v1/telemetry/diagnostics` (future; client-side error reports — see `PROJECT.md` §12.8)

Any other route returns `403 insufficient_scope` if hit with an API key. Conversely, the `JwtAuthGuard` rejects any `ft_live_…` token with `401 token_wrong_type`.

### 5.5 Revocation

`DELETE /v1/devices/{deviceId}` (Settings §4.5) sets `revokedAt = now()` on the device's `ApiKey` row. The next request from the source client fails with `401 api_key_revoked`. The client's documented behavior on `401` is to:
- Halt flushing (don't drop events; outbox is preserved per `Sources Markdown/Extension.md` §9.3).
- Surface a "Re-pair device" CTA in the popup / system tray.

There is no "rotate this device's API key without re-pairing" affordance in v1 — re-pair is the only recovery. Documented as an open question in §13.

---

## 6. Initial user seeding (CLI)

### 6.1 The CLI command

```
pnpm api:seed-user --email <email> [--password <password>] [--display-name <name>]
```

- Defined as a NestJS standalone command (`@nestjs/common` `CommandFactory` or the lightweight `nest-commander` package — pick at implementation time).
- If `--password` is omitted, the command prompts interactively with hidden input (`process.stdin` in tty mode).
- If `--display-name` is omitted, defaults to the local-part of the email.
- Validates email format (`zod.string().email()`) and password strength (§7.2).
- Errors if a user with the same email already exists. The reset command (§7.3) handles that case explicitly.
- Creates the `User` row with `passwordHash = argon2id(password)`.

Idempotency / safety:
- The command is safe to run from CI/CD bootstrap scripts (read both args from env vars: `SEED_USER_EMAIL`, `SEED_USER_PASSWORD`).
- The command never prints the password (even on success).
- The command exits non-zero on any validation failure.

### 6.2 What `/login` does when no user exists

- **Production mode:** `POST /v1/auth/login` returns `401 invalid_credentials` (same as wrong password). The `/login` page shows the standard error message. This is the secure default — never disclose user existence.
- **Dev mode** (`NODE_ENV === "development"` AND no users in DB): returns `503 no_user_seeded` with a `hint` field containing the seed command. The `/login` page renders the hint inline:
  > *"No user account exists yet. Run on the server: `pnpm api:seed-user --email <your-email>`"*

This dev-only escape hatch avoids the "I just ran `pnpm dev` and the login screen is opaque" frustration without exposing user enumeration in production.

### 6.3 Password reset CLI

```
pnpm api:reset-password --email <email> [--password <new-password>]
```

- Same validation rules as seeding (§7.2).
- Updates `User.passwordHash`.
- **Always** revokes every refresh token for the user (no opt-out — if you're resetting via CLI, you've already lost normal access; sign every device out).
- Companion: `pnpm api:list-users` prints `id, email, displayName, createdAt` for debugging. No passwords or hashes are ever printed.

---

## 7. Password handling

### 7.1 Hashing — argon2id

- Library: [`argon2`](https://www.npmjs.com/package/argon2) (Node bindings; wraps the C reference implementation). Chosen over bcrypt because it's the OWASP-recommended algorithm in 2026.
- Variant: **argon2id** (resistant to both side-channel and GPU attacks).
- Parameters (initial defaults; tune to ~250 ms per hash on the deployment machine):
  - `timeCost: 3`
  - `memoryCost: 65536` (64 MiB)
  - `parallelism: 4`
  - `hashLength: 32`
- The full parameterised hash string (which embeds `$argon2id$v=19$m=65536,t=3,p=4$<salt>$<hash>`) is stored in `User.passwordHash`. argon2's verifier reads parameters from the stored string, so tuning the params later doesn't break existing hashes — they're re-hashed transparently on next login (`needs_rehash`-style check).

### 7.2 Strength requirements

| Rule | Value |
| --- | --- |
| Minimum length | 8 characters |
| Maximum length | 256 characters (DOS guard — argon2 cost grows with input length) |
| Disallowed | Whitespace-only; nothing else |
| Strength indicator (UI hint, not enforcement) | `zxcvbn` score ≥ 2 recommended; warning shown if below, but not blocking |

The conscious choice: **no complexity rules** (no "must contain a digit + symbol + uppercase + lowercase" pattern). Per NIST SP 800-63B revision 4, length matters more than mixed-character requirements; complexity rules nudge users toward worse passwords ("Password1!"). The strength indicator (powered by `zxcvbn`) is shown to the user but doesn't block submission.

Validation runs both client-side (immediate feedback) AND server-side (the only enforcement that matters).

### 7.3 Verification

Login (§4.1) and password change (§4.7) both verify the same way:
1. Look up the user by email.
2. Call `argon2.verify(user.passwordHash, providedPassword)`.
3. On success, also call `argon2.needsRehash(user.passwordHash, currentDefaults)` — if true, transparently re-hash and update `User.passwordHash` in the same transaction. This lets parameter tuning roll out across the user base without anyone noticing.

Timing: argon2.verify is intentionally slow (~250 ms). The login endpoint's rate limiter (§8) bounds the attack rate; the slow hash bounds the attempts-per-second-per-IP further.

---

## 8. Rate limiting

**Not in v1.** Single-user, local-first; the API runs on localhost or behind a VPN. No `@nestjs/throttler` wiring, no per-IP / per-account limits.

Add `@nestjs/throttler` later if/when the API is ever exposed publicly. The natural endpoints to limit then are `POST /v1/auth/login`, `POST /v1/auth/refresh`, `POST /v1/me/password`, and the unauthenticated pairing bootstrap endpoints — especially `POST /v1/devices/pairing-codes/{code}/claim` (6-digit numeric code = 1M brute-force space; the 5-min expiry helps but rate limiting closes the gap).

Compensating control today: the slow argon2 verify in §7.3 (~250 ms per attempt) bounds attempts-per-second even without explicit rate limiting. Pairing codes are one-shot (consumed on first successful claim).

---

## 9. Security posture

### 9.1 XSS hardening (the localStorage trade-off)

Because both tokens live in localStorage (per §4.2 shaping decision), an XSS exploit on this origin is a total auth compromise. Compensating controls:

| Control | Detail |
| --- | --- |
| **Strict CSP** | `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' <API_BASE_URL>; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`. No `unsafe-eval`, no `unsafe-inline` for scripts, no `*` anywhere. |
| **No `dangerouslySetInnerHTML`** | Lint rule (`eslint-plugin-react/no-danger` set to `error`) bans it project-wide. Any future exception requires explicit reviewer waiver + DOMPurify wrap. |
| **All user-rendered text** | Goes through React's default escaping. Display names, milestone labels, task titles, etc. are never inserted as raw HTML. |
| **No third-party scripts** | No analytics, no CDN-loaded libs, no widgets. Everything bundled. (Future analytics, if added, would need its own threat-model review.) |
| **HTTPS in any non-localhost deployment** | Documented as deployment concern (§13). |
| **Subresource integrity (SRI)** | n/a in v1 (no CDN assets). Document for future. |
| **`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: same-origin`** | Standard headers; set globally. |

### 9.2 CSRF posture

Not applicable in v1: no cookies are used for auth, so the browser never auto-attaches credentials to cross-site requests. The `Authorization` header must be explicitly attached by JavaScript, which a malicious cross-origin page cannot do.

If the spec ever migrates to httpOnly cookie storage (§4.2 trade-off note), CSRF protection becomes required.

### 9.3 Token leakage scenarios

| Scenario | Impact | Mitigation |
| --- | --- | --- |
| Access JWT leaks (logged, intercepted) | Attacker reads/writes as user for ≤15 min | Short TTL. No further mitigation in v1. |
| Refresh token leaks AND attacker uses it once | Attacker gets new pair; legit user's next refresh fails (old token revoked) → user back to login. User must explicitly "Sign out everywhere" to revoke attacker's rotated token | Per-use rotation (§4.4); user vigilance for the "Sign out everywhere" step |
| Refresh token leaks AND legitimate user is inactive | Attacker can refresh indefinitely until either party uses-then-the-other-uses | Inevitable consequence; the only true mitigation is shorter refresh TTL. 30 days is the chosen pragmatic compromise. |
| API key leaks | Attacker can write telemetry events as that device until revoked | Manual revoke from Settings → Devices |
| User's localStorage dumped (physical access to unlocked machine) | Full credential compromise | Out of scope; physical access defeats most controls |
| XSS exploit | Full credential compromise | §9.1 hardening |

### 9.4 If the threat model changes

A future migration to httpOnly cookie storage would touch:
- `/v1/auth/login` response: set cookies instead of returning tokens in the body.
- `/v1/auth/refresh`: no body, just rely on cookie.
- `/v1/auth/logout`: clear cookies.
- Add CSRF protection (`SameSite=Strict` cookies + custom header check on state-changing routes).
- Web app: drop `localStorage` reads/writes; `withCredentials: true` on the Axios instance.
- The CSP `script-src` can relax slightly (since XSS no longer leaks tokens via `document.cookie` if `HttpOnly` is set).

Not v1 work; documented so it's not an unknown later.

---

## 10. Data model

### 10.1 `User` (new field)

```prisma
model User {
  // ...existing fields per PROJECT.md §5 and Settings.md §6.1...
  email        String   @unique
  passwordHash String   // argon2id parameterised hash string (§7.1)
}
```

`email` is already implicit from `PROJECT.md` §9; `passwordHash` is new and replaces any prior assumption that auth was unspecified.

### 10.2 `RefreshToken`

```prisma
model RefreshToken {
  id         String    @id @default(cuid())
  userId     String
  user       User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  tokenHash  String    @unique  // sha256 of raw token, hex
  issuedAt   DateTime  @default(now())
  expiresAt  DateTime
  revokedAt  DateTime?
  userAgent  String?            // recorded for future "active sessions" UI, unused in v1 UI
  ip         String?

  @@index([userId, revokedAt])
  @@index([expiresAt])           // for the cleanup job in §13
}
```

### 10.3 `ApiKey`

```prisma
enum ApiKeyScope {
  telemetry_write
}

model ApiKey {
  id         String       @id @default(cuid())
  userId     String
  user       User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  deviceId   String       @unique  // one key per device
  device     Device       @relation(fields: [deviceId], references: [id], onDelete: Cascade)
  tokenHash  String       @unique  // sha256 of raw token, hex
  scope      ApiKeyScope  @default(telemetry_write)
  createdAt  DateTime     @default(now())
  revokedAt  DateTime?

  @@index([userId, revokedAt])
}
```

### 10.4 `PairingCode`

```prisma
model PairingCode {
  id              String    @id @default(cuid())
  code            String    @unique  // 6 numeric digits, server-generated
  deviceProposal  Json      // { deviceId (client-proposed), platform, label }
  claimedByUserId String?
  claimedByUser   User?     @relation(fields: [claimedByUserId], references: [id], onDelete: SetNull)
  claimedAt       DateTime?
  createdAt       DateTime  @default(now())
  expiresAt       DateTime  // createdAt + 5 min

  @@index([expiresAt])      // cleanup job in §13
}
```

Cross-reference: `Device` itself is defined in `PROJECT.md` §5 / `Settings.md` §6.2. Created exactly when a `PairingCode` is successfully claimed.

---

## 11. API surface (sketch — full shape goes in `PROJECT.md` §7)

### 11.1 User auth (JWT)

| Method | Path                          | Guard | Purpose                                                       |
| ------ | ----------------------------- | ----- | ------------------------------------------------------------- |
| POST   | `/v1/auth/login`              | none  | Issue access + refresh on email/password                      |
| POST   | `/v1/auth/refresh`            | none  | Rotate refresh token; issue new access                        |
| POST   | `/v1/auth/logout`             | JWT   | Revoke the supplied refresh token row                         |
| POST   | `/v1/auth/logout-all`         | JWT   | Revoke every refresh token row for this user                  |
| POST   | `/v1/me/password`             | JWT   | Change password; optionally sign out other devices            |

### 11.2 Device pairing / API keys

| Method | Path                                          | Guard | Purpose                                                       |
| ------ | --------------------------------------------- | ----- | ------------------------------------------------------------- |
| POST   | `/v1/devices/pairing-codes`                   | none  | Device requests a 6-digit code                                |
| GET    | `/v1/devices/pairing-codes/{code}`            | none  | Device polls for completed pairing → returns API key once     |
| POST   | `/v1/devices/pairing-codes/{code}/claim`      | JWT   | Web app confirms a pairing code for the current user          |
| GET    | `/v1/devices`                                 | JWT   | List user's paired devices (drives Settings §4.5)             |
| DELETE | `/v1/devices/{deviceId}`                      | JWT   | Revoke a device's API key + delete the Device row             |

### 11.3 Ingest (API-key)

| Method | Path                          | Guard      | Purpose                                                       |
| ------ | ----------------------------- | ---------- | ------------------------------------------------------------- |
| POST   | `/v1/telemetry/batch`         | API key    | Batch ingest of raw focus events                              |

(Full shape, validation, and error envelopes per `PROJECT.md` §7 / §12.)

### 11.4 Response shapes (sketch)

```ts
// Login / refresh success
{
  accessToken: string;          // JWT
  refreshToken: string;         // opaque, base64url, 43 chars
  accessExpiresAt: string;      // ISO 8601
  refreshExpiresAt: string;     // ISO 8601
  user?: {                      // included on login, omitted on refresh
    id: string;
    email: string;
    displayName: string;
  };
}

// Pairing-code claim success (returns to the web app)
{
  device: {
    id: string;
    label: string;
    source: "browser" | "desktop";
    createdAt: string;
  };
  // Note: the API key itself is NOT returned to the web app —
  // only the device sees it via the pairing-code poll (§5.1).
}

// Pairing-code poll success (returns to the device)
{
  status: "claimed";
  apiKey: string;               // "ft_live_..." — shown exactly once
  device: { id, label, source };
}

// Standard error envelope
{
  error: string;                // machine code, e.g. "invalid_credentials", "refresh_invalid"
  message?: string;             // human-readable, may be omitted in prod
  hint?: string;                // dev mode helpers, only present in non-production
}
```

---

## 12. Frontend integration

### 12.1 `/login` route

Single-page form with email + password fields, submit button, and inline error region.

Behavior:
- On mount: if `accessToken` exists in localStorage AND is not expired (decode `exp` claim locally without verifying signature), redirect to `/` immediately.
- On submit: `POST /v1/auth/login`; on 200, store both tokens in localStorage, populate the auth Zustand store, redirect to `/` (or to a stored `?next=` query param if present).
- On 401: show "Invalid email or password" (constant message).
- On 503 + `no_user_seeded`: show the dev hint inline (§6.2).

### 12.2 Axios instance (Bearer header)

A single configured Axios instance lives in `apps/web/src/lib/api.ts`:
- Base URL from env (`VITE_API_BASE_URL`).
- Request interceptor: read `localStorage.accessToken`, attach `Authorization: Bearer ${token}` if present.
- Response interceptor: see §12.3.

### 12.3 Refresh-on-401 logic

```
1. Original request gets 401 token_expired.
2. Interceptor checks: is there a refreshToken in localStorage?
   No → reject, propagate to caller (which redirects to /login).
3. Is a refresh already in-flight? If yes, queue this request behind the in-flight promise. If no, start one:
   POST /v1/auth/refresh { refreshToken }
4. On refresh success: store new tokens, retry the original request (and any queued requests) with the new access token.
5. On refresh failure (any 4xx): clear localStorage, reset auth store, redirect to /login.
```

The in-flight queue is essential: without it, N parallel requests that all see 401 would each fire their own refresh, racing to rotate the same refresh token — only one would succeed and the others would 401 with `refresh_invalid`, dropping the user to login for no reason.

Implementation note: a single module-level `Promise<TokenPair> | null` variable named `refreshInFlight` is the cheapest correct implementation.

### 12.4 Route guard

The TanStack Router (per `PROJECT.md` §2.1) supports `beforeLoad` per-route. The root layout's `beforeLoad`:
- If `accessToken` is missing in localStorage → redirect to `/login?next=${currentPath}`.
- If `accessToken` exists but is expired (decode `exp`, compare to now) → don't redirect; the Axios interceptor will refresh on the first API call. (Optimistic; avoids a redirect flash for the common case.)
- If `accessToken` exists and is valid → render the route.

The `/login` route itself has `beforeLoad` that redirects to `/` if a valid access token exists (so logged-in users don't see the login form).

### 12.5 Zustand auth store

Tiny store; just enough to drive UI updates without prop-drilling:

```ts
type AuthState = {
  user: { id: string; email: string; displayName: string } | null;
  isAuthenticated: boolean;
  login: (tokens, user) => void;
  logout: (scope: "this" | "all") => Promise<void>;
  reset: () => void;  // called by storage event from another tab
};
```

The store does NOT hold the access/refresh tokens themselves (those live in localStorage, single source of truth). The store holds the cached `user` object so components don't re-fetch it on every render.

---

## 13. Operational concerns

- **JWT signing secret rotation.** `JWT_SECRET` is an env var; rotating it invalidates every outstanding access JWT (forcing a refresh round-trip) but does NOT invalidate refresh tokens (they're random + DB-backed, not signed). A planned rotation = restart the server with the new secret; users with active sessions get auto-refreshed seamlessly.
- **Cleanup job for expired rows.** A nightly `@nestjs/schedule` cron (`0 4 * * *`):
  - Deletes `RefreshToken` rows where `expiresAt < now() - 7 days`.
  - Deletes `PairingCode` rows where `expiresAt < now()` and `claimedAt IS NULL`.
- **HTTPS.** Required for any non-localhost deployment. Localhost dev runs HTTP for ergonomic reasons; production should be HTTPS or the spec's security posture is meaningless.

---

## 14. Accessibility

- `/login` form: real `<form>` element, `<label for>` linkages, `aria-invalid` + `aria-describedby` on the error region.
- Submit button is `<button type="submit">`; pressing Enter in either field submits.
- Error region uses `role="alert" aria-live="assertive"` so screen readers announce login failures immediately.
- The dev hint banner (§6.2) uses `role="note"` to avoid interrupting.
- Strength indicator (§7.2) on the password change form is `aria-live="polite"` and uses both color and a text label ("Weak / Fair / Good / Strong").
- All buttons have visible focus rings.

---

## 15. Mobile / Responsive

- `/login` form is single-column, max-width 360px, centered vertically and horizontally.
- Email input uses `type="email" inputmode="email" autocomplete="username"`.
- Password input uses `type="password" autocomplete="current-password"`. The password change form uses `autocomplete="new-password"`.
- Touch targets ≥ 44pt.
- No layout difference between mobile and desktop for the login form — it's already minimal.

---

## 16. Dependencies

- **`argon2`** (Node) — password hashing (§7.1). New dep.
- **`@nestjs/jwt`** + **`passport`** + **`passport-jwt`** — already in `PROJECT.md` §9. JWT signing / verification, guards.
- **`nest-commander`** OR raw `CommandFactory` — CLI commands (§6). Pick at implementation time.
- **`zod`** (already in stack) — request body validation on every auth endpoint.
- **`zxcvbn`** (frontend only) — password strength indicator (§7.2). Optional; the spec works without it.

---

## 17. Open Questions / TODOs

- **API key rotation without re-pairing.** Currently `DELETE /v1/devices/{id}` is the only revocation path; the user must re-run pairing. A future `POST /v1/devices/{id}/rotate-key` could mint a new key for the same device (returned exactly once, like pairing) so the user can refresh keys on suspicion without going through the 6-digit dance again. Defer.
- **Pairing-code collision.** 6-digit codes have a 1-in-1M collision rate per active code; with personal-scale concurrent pairings the collision rate is negligible. On collision the server should just retry the random pick up to a few times before erroring.
- **CSRF if storage migrates.** Already documented as a "what changes if" in §9.4. Make sure any future PR that proposes httpOnly cookies pulls in CSRF protection in the same change.
- **Argon2 parameter tuning.** Initial defaults (§7.1) are conservative. On the deployment machine, time `argon2.hash(...)` and tune to ~250 ms (verifies bound the login rate; >1 s feels sluggish, <100 ms is too fast).
