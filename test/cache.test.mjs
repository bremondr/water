import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createCache } from '../cache.mjs';

const tmp = async () => pathToFileURL((await mkdtemp(join(tmpdir(), 'cache-test-'))) + '/');
const wait = ms => new Promise(r => setTimeout(r, ms));
const quiet = async fn => { const orig = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = orig; } };

test('first get builds, second get is served from memory', async () => {
  const dir = await tmp(); let calls = 0;
  const c = createCache({ name: 'a', ttl: 60_000, dir, build: async () => ({ n: ++calls }) });
  assert.deepEqual(JSON.parse(await c.get()), { n: 1 });
  assert.deepEqual(JSON.parse(await c.get()), { n: 1 });
  assert.equal(calls, 1);
  await rm(dir, { recursive: true });
});

test('a restart serves the last good value from disk without waiting for a rebuild', async () => {
  const dir = await tmp();
  const first = createCache({ name: 'b', ttl: 60_000, dir, build: async () => ({ v: 'old' }) });
  await first.get(); await wait(100);                       // let the disk write finish
  let release; const gate = new Promise(r => { release = r; });
  const second = createCache({ name: 'b', ttl: 0, dir, build: async () => { await gate; return { v: 'new' }; } });
  assert.deepEqual(JSON.parse(await second.get()), { v: 'old' });   // stale and instant while the rebuild is blocked
  release(); await wait(100);
  assert.deepEqual(JSON.parse(await second.get()), { v: 'new' });
  await rm(dir, { recursive: true });
});

test('a failed refresh keeps the previous value and passes it to the next build', async () => {
  const dir = await tmp(); let fail = false; let seenPrev;
  const c = createCache({ name: 'c', ttl: 0, dir, build: async prev => { seenPrev = prev; if (fail) throw new Error('boom'); return { ok: true }; } });
  await c.get(); fail = true;
  await quiet(async () => { assert.deepEqual(JSON.parse(await c.get()), { ok: true }); await wait(100); });
  assert.deepEqual(JSON.parse(await c.get()), { ok: true });
  assert.deepEqual(seenPrev, { ok: true });
  await rm(dir, { recursive: true });
});

test('get() rejects when there is no data at all and the first build fails', async () => {
  const dir = await tmp();
  const c = createCache({ name: 'd', ttl: 1000, dir, build: async () => { throw new Error('down'); } });
  await quiet(() => assert.rejects(c.get(), /no data available/));
  await rm(dir, { recursive: true });
});

test('ensureFresh: waits for a rebuild when stale, serves the saved value when fresh, keeps it when the rebuild fails', async () => {
  const dir = await tmp(); let calls = 0, fail = false;
  const make = ttl => createCache({ name: 'e', ttl, dir, build: async () => { if (fail) throw new Error('down'); return { n: ++calls }; } });
  assert.deepEqual(JSON.parse(await make(60_000).ensureFresh()), { n: 1 });
  assert.deepEqual(JSON.parse(await make(60_000).ensureFresh()), { n: 1 }, 'a new process reuses the disk value');
  assert.equal(calls, 1);
  await wait(5);
  fail = true;
  await quiet(async () => assert.deepEqual(JSON.parse(await make(1).ensureFresh()), { n: 1 }, 'stale value kept after a failed rebuild'));
  fail = false;
  assert.deepEqual(JSON.parse(await make(1).ensureFresh()), { n: 2 });
  await rm(dir, { recursive: true });
});
