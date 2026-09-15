// Monotonic ULID generator (Crockford base32, 26 chars, time-sortable).
//
// Format: <10-char timestamp><16-char randomness>
//   * timestamp = ms since Unix epoch, big-endian, 48 bits → 10 base32 chars
//   * randomness = 80 bits from crypto.getRandomValues → 16 base32 chars
//
// Monotonicity: if two calls land in the same millisecond, we increment the
// randomness by 1 instead of re-drawing. That keeps IDs sortable in
// insertion order even when the clock hasn't ticked — important because
// IndexedDB uses the ULID as its primary key and we scan events in
// chronological order.
//
// Matches the ULID crate the desktop client uses (`apps/desktop/src-tauri/src/events.rs`).
// ponytail: 40-LOC custom impl instead of the ulidx npm dep — trivial to
// audit and one fewer dependency to update.

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

let lastMs = 0;
let lastRandom = 0n; // packed 80-bit randomness, mutable for monotonic bump

function encodeTime(ms: number): string {
  // 48-bit timestamp → 10 base32 chars (5 bits per char = 50 bits, top 2 unused).
  let s = '';
  let n = ms;
  for (let i = 0; i < 10; i++) {
    s = CROCKFORD[n & 31] + s;
    n = Math.floor(n / 32);
  }
  return s;
}

function encodeRandom(n: bigint): string {
  // 80-bit random → 16 base32 chars.
  let s = '';
  let x = n;
  for (let i = 0; i < 16; i++) {
    s = CROCKFORD[Number(x & 31n)] + s;
    x >>= 5n;
  }
  return s;
}

function drawRandom(): bigint {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  return n;
}

/**
 * Generate a new ULID. Monotonic within a millisecond; time-sortable across.
 */
export function ulid(): string {
  const now = Date.now();
  if (now === lastMs) {
    // Same ms: bump the randomness. 80-bit overflow is astronomically unlikely
    // (10^24 events in one ms), but if it did happen we'd wrap and lose
    // monotonicity for exactly that batch. Not worth a special case.
    lastRandom = (lastRandom + 1n) & ((1n << 80n) - 1n);
  } else {
    lastMs = now;
    lastRandom = drawRandom();
  }
  return encodeTime(now) + encodeRandom(lastRandom);
}

// Self-check lives in `ulid.check.ts` so it doesn't ship in the extension
// bundle. Run it with:
//   node --experimental-strip-types apps/extension/src/id/ulid.check.ts

// Kept internal so `ulid.check.ts` can import it without widening the public
// surface. (Only `ulid()` is meant for consumers.)
export const _internal = { CROCKFORD };
