// Runnable self-check for ulid.ts. Not part of the extension bundle.
//
// Run with:
//   node --experimental-strip-types apps/extension/src/id/ulid.check.ts
//
// Verifies length, alphabet, and monotonicity of a 1000-id burst.

import { ulid, _internal } from './ulid.ts';

const { CROCKFORD } = _internal;

const ids = Array.from({ length: 1000 }, () => ulid());

for (const id of ids) {
  if (id.length !== 26) throw new Error(`bad length: ${id}`);
  for (const ch of id) {
    if (!CROCKFORD.includes(ch)) throw new Error(`bad char '${ch}' in ${id}`);
  }
}

const sorted = [...ids].sort();
for (let i = 0; i < ids.length; i++) {
  if (ids[i] !== sorted[i]) {
    throw new Error(`not monotonic at index ${i}: got ${ids[i]}, sorted ${sorted[i]}`);
  }
}

console.log(`ulid self-check: ${ids.length} ids OK`);
console.log('sample:', ids[0], ids[500], ids[999]);
