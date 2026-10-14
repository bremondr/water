// Tiny stale-while-revalidate cache that survives restarts.
// - get() never blocks on a refresh when any previous value exists (memory or disk), it just kicks one off.
// - a failed refresh keeps the previous value and logs the error.
// - the last good value is written to disk, so a restart serves instantly instead of waiting for a rebuild.
import { readFile, writeFile, mkdir } from 'node:fs/promises';

export function createCache({ name, ttl, build, dir = new URL('./.cache/', import.meta.url) }) {
  const file = new URL(`${name}.json`, dir);
  let value = null;          // { at, body (JSON string), data }
  let loading = null;

  const restore = readFile(file, 'utf8').then(text => {
    const saved = JSON.parse(text);
    value ??= { at: saved.at, body: JSON.stringify(saved.data), data: saved.data };
  }).catch(() => { /* no usable disk cache yet */ });

  function refresh() {
    loading ??= (async () => {
      await restore;
      const data = await build(value?.data ?? null);
      value = { at: Date.now(), body: JSON.stringify(data), data };
      mkdir(dir, { recursive: true }).then(() => writeFile(file, JSON.stringify({ at: value.at, data })))
        .catch(e => console.error(`[${name}] could not write disk cache: ${e.message}`));
    })().catch(e => console.error(`[${name}] refresh failed${value ? ' (keeping previous data)' : ''}: ${e.message}`))
      .finally(() => { loading = null; });
    return loading;
  }

  return {
    refresh,
    async get() {
      await restore;
      if (!value) { await refresh(); if (!value) throw new Error(`${name}: no data available yet`); }
      else if (Date.now() - value.at > ttl) refresh();      // serve stale, refresh behind the scenes
      return value.body;
    },
    // Call once at startup: refreshes now if stale, then keeps the data fresh even when nobody is asking.
    async start() {
      await restore;
      if (!value || Date.now() - value.at > ttl) refresh();
      setInterval(refresh, ttl).unref();
    },
  };
}
