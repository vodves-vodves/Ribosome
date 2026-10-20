import { browser } from 'wxt/browser';
import type { ProviderResult } from './providers/types';
import type { Cache } from './translator';

type Entry = { v: ProviderResult; t: number };

/**
 * Translation cache in `storage.session`: lives until the browser closes and survives service worker restarts.
 * Holds `limit` entries, evicting the oldest. Each entry is its own key so the whole cache is never rewritten.
 */
export function sessionCache(limit = 500): Cache {
  const area = browser.storage.session;
  let mem: Promise<Map<string, Entry>> | undefined;
  const load = () =>
    (mem ??= area.get(null).then(
      (all) => new Map(Object.entries(all as Record<string, Entry>).filter(([k]) => k.startsWith('c:')).sort((a, b) => a[1].t - b[1].t)),
    ));
  const evict = async (m: Map<string, Entry>, n: number) => {
    const old = [...m.keys()].slice(0, n);
    old.forEach((k) => m.delete(k));
    if (old.length) await area.remove(old);
  };
  return {
    async get(key) {
      return (await load()).get(`c:${key}`)?.v;
    },
    async set(key, v) {
      const m = await load();
      const k = `c:${key}`;
      const e = { v, t: Date.now() };
      m.delete(k);
      if (m.size >= limit) await evict(m, m.size - limit + 1);
      try {
        await area.set({ [k]: e });
      } catch {
        // session storage quota: free some room and retry; if that fails too, go on without this entry
        await evict(m, 50);
        try {
          await area.set({ [k]: e });
        } catch {
          return;
        }
      }
      m.set(k, e);
    },
  };
}
