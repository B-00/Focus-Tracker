// Runnable self-check for the pure drain loop in `flusher.ts`.
//
// Run with:
//   node --experimental-strip-types apps/extension/src/background/flusher.check.ts
//
// Not bundled into the extension — only the flusher.ts side. This file
// only imports the pure `runDrain` + its types, both of which are I/O-
// agnostic. Fakes for outbox + uploader are in-memory.
//
// If any assertion trips, the process exits non-zero.
//
// Covers the branches that actually matter:
//   1. Multi-chunk drain — outbox with > BATCH_SIZE events; verify each
//      chunk is uploaded and acked, exit reason = 'empty'.
//   2. Transient failure mid-drain — first chunk succeeds, second returns
//      transient. Second chunk must remain in outbox, first must be acked,
//      exit reason = 'transient'.
//   3. Auth rejection — first chunk returns 401. Nothing acked, and
//      `onAuthRejected` was called exactly once. Exit reason = 'auth_rejected'.
//   4. Permanent reject — first chunk returns 4xx. Batch dropped from
//      outbox anyway (v1 dead-letter). Loop continues to the next chunk.
//   5. Not paired — `getPaired` returns null. No upload attempted at all.

import type { TelemetryEvent } from '@focus-tracker/shared';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

import {
  BATCH_SIZE,
  runDrain,
  type FlushDeps,
  type PairedIdentity,
  type UploadResult,
} from './drain.ts';

const PAIRED: PairedIdentity = {
  deviceId: '00000000-0000-4000-8000-000000000000',
  apiKey: 'ft_live_test',
};

/** In-memory outbox that satisfies the `FlushDeps` I/O contract. */
function fakeOutbox(events: TelemetryEvent[]): {
  getBatch: FlushDeps['getBatch'];
  removeMany: FlushDeps['removeMany'];
  remaining: () => TelemetryEvent[];
} {
  const store = [...events];
  return {
    getBatch: async (limit) => store.slice(0, limit),
    removeMany: async (ids) => {
      const idSet = new Set(ids);
      for (let i = store.length - 1; i >= 0; i--) {
        const e = store[i];
        if (e && idSet.has(e.id)) store.splice(i, 1);
      }
    },
    remaining: () => [...store],
  };
}

/** Scripted uploader — one behaviour per invocation. */
function scriptedUploader(script: UploadResult[]): {
  upload: FlushDeps['upload'];
  callCount: () => number;
} {
  let i = 0;
  return {
    upload: async () => {
      const r = script[i++];
      assert(r !== undefined, 'scripted uploader ran out of responses');
      return r;
    },
    callCount: () => i,
  };
}

const silentLog = { info: () => {}, warn: () => {}, error: () => {} };

function makeEvent(id: string): TelemetryEvent {
  return {
    id,
    kind: 'focus_change',
    source: 'browser',
    target: { domain: 'example.com' },
    startedAt: '2026-01-01T00:00:00.000Z',
    clientVersion: '0.0.1',
  };
}

async function main(): Promise<void> {
  // ─── 1. Multi-chunk drain ────────────────────────────────────────────
  {
    const events = Array.from({ length: BATCH_SIZE * 2 + 3 }, (_, i) =>
      makeEvent(`e${i.toString().padStart(3, '0')}`),
    );
    const ob = fakeOutbox(events);
    const up = scriptedUploader([
      { status: 'ok', response: { acceptedCount: BATCH_SIZE, duplicateCount: 0 } },
      { status: 'ok', response: { acceptedCount: BATCH_SIZE, duplicateCount: 0 } },
      { status: 'ok', response: { acceptedCount: 3, duplicateCount: 0 } },
    ]);
    const summary = await runDrain({
      getPaired: async () => PAIRED,
      getBatch: ob.getBatch,
      removeMany: ob.removeMany,
      upload: up.upload,
      onAuthRejected: async () => assert.fail('should not have called auth-rejected'),
      log: silentLog,
    });
    assert.equal(summary.exitReason, 'empty', 'multi-chunk drain exit');
    assert.equal(summary.chunksSent, 3, 'multi-chunk drain chunks');
    assert.equal(summary.eventsAcked, BATCH_SIZE * 2 + 3, 'multi-chunk drain acked count');
    assert.equal(ob.remaining().length, 0, 'multi-chunk drain empties outbox');
    assert.equal(up.callCount(), 3, 'exactly one upload per chunk');
  }

  // ─── 2. Transient mid-drain ──────────────────────────────────────────
  {
    const events = Array.from({ length: BATCH_SIZE + 5 }, (_, i) => makeEvent(`t${i}`));
    const ob = fakeOutbox(events);
    const up = scriptedUploader([
      { status: 'ok', response: { acceptedCount: BATCH_SIZE, duplicateCount: 0 } },
      { status: 'transient', message: 'simulated 503' },
    ]);
    const summary = await runDrain({
      getPaired: async () => PAIRED,
      getBatch: ob.getBatch,
      removeMany: ob.removeMany,
      upload: up.upload,
      onAuthRejected: async () => assert.fail('should not have called auth-rejected'),
      log: silentLog,
    });
    assert.equal(summary.exitReason, 'transient', 'transient exit reason');
    assert.equal(summary.chunksSent, 1, 'only the first chunk succeeded');
    assert.equal(
      ob.remaining().length,
      5,
      'transient must leave the failing chunk in the outbox',
    );
  }

  // ─── 3. Auth rejection ───────────────────────────────────────────────
  {
    const events = [makeEvent('a1'), makeEvent('a2')];
    const ob = fakeOutbox(events);
    const up = scriptedUploader([{ status: 'auth_rejected', message: '401 token_invalid' }]);
    let authCalls = 0;
    const summary = await runDrain({
      getPaired: async () => PAIRED,
      getBatch: ob.getBatch,
      removeMany: ob.removeMany,
      upload: up.upload,
      onAuthRejected: async () => {
        authCalls++;
      },
      log: silentLog,
    });
    assert.equal(summary.exitReason, 'auth_rejected');
    assert.equal(authCalls, 1, 'onAuthRejected called exactly once');
    assert.equal(
      ob.remaining().length,
      2,
      'auth-rejected events stay queued for post-re-pair flush',
    );
  }

  // ─── 4. Permanent reject drops batch, loop continues ────────────────
  {
    const events = [makeEvent('p1'), makeEvent('p2'), makeEvent('p3')];
    const ob = fakeOutbox(events);
    const up = scriptedUploader([
      { status: 'permanent', message: '400 bad shape' },
      // After the dropped batch, outbox is empty → runDrain exits with 'empty'.
    ]);
    const summary = await runDrain({
      getPaired: async () => PAIRED,
      getBatch: ob.getBatch,
      removeMany: ob.removeMany,
      upload: up.upload,
      onAuthRejected: async () => assert.fail('should not have called auth-rejected'),
      log: silentLog,
      batchSize: 3,
    });
    assert.equal(summary.exitReason, 'empty', 'after dropping the only chunk, outbox is empty');
    assert.equal(summary.eventsDropped, 3, 'permanent reject counts dropped events');
    assert.equal(ob.remaining().length, 0, 'permanent reject drops from outbox');
  }

  // ─── 5. Not paired short-circuits ────────────────────────────────────
  {
    const ob = fakeOutbox([makeEvent('n1')]);
    const up = scriptedUploader([]);
    const summary = await runDrain({
      getPaired: async () => null,
      getBatch: ob.getBatch,
      removeMany: ob.removeMany,
      upload: up.upload,
      onAuthRejected: async () => assert.fail('should not have called auth-rejected'),
      log: silentLog,
    });
    assert.equal(summary.exitReason, 'not_paired');
    assert.equal(up.callCount(), 0, 'unpaired must not upload');
    assert.equal(ob.remaining().length, 1, 'unpaired must not touch outbox');
  }

  console.log('flusher self-check: all assertions passed');
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
