// Decode-only JWT helpers. The server is the source of truth on signature
// validity; the web client only ever inspects `exp` locally to decide
// whether to optimistically render a protected route (Auth.md §12.4).
//
// NEVER use these to "trust" a token. If the signature is forged or the
// secret has rotated, the access JWT will fail server-side and the Axios
// interceptor will refresh / boot the user back to /login.

interface DecodedAccessToken {
  sub: string;
  exp: number; // epoch seconds
  iat: number;
  scope: 'user';
  jti?: string;
}

/// Returns the payload claims of a JWT, or `null` if the token is malformed.
/// Does NOT verify the signature.
export function decodeJwt(token: string): DecodedAccessToken | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const payloadSegment = parts[1];
  if (!payloadSegment) return null;
  try {
    const normalized = payloadSegment.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    const json = atob(padded);
    const obj = JSON.parse(json) as Partial<DecodedAccessToken>;
    if (typeof obj.sub !== 'string' || typeof obj.exp !== 'number') return null;
    return obj as DecodedAccessToken;
  } catch {
    return null;
  }
}

/// True iff the token decodes successfully AND `exp` is in the future.
/// Treats malformed tokens as expired (safe default).
///
/// `skewSeconds` is subtracted from `exp` so we don't try to use a token
/// that's about to expire mid-request. Default 5s.
export function isJwtValid(token: string | null, skewSeconds = 5): boolean {
  if (!token) return false;
  const claims = decodeJwt(token);
  if (!claims) return false;
  const nowSec = Math.floor(Date.now() / 1000);
  return claims.exp - skewSeconds > nowSec;
}
