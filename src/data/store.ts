'use client';
// One store for every surface. Local adapter: localStorage + BroadcastChannel, so the POS, KDS, customer display,
// self-order and dashboards open in different tabs stay in sync live (the production adapter is live updates from PostgreSQL,
// see db/migrations and remoteStore.ts, used when REMOTE). Every write goes through commit() → audit log + realtime broadcast.
import { useSyncExternalStore } from 'react';
import type { DB } from './schema.ts';
import { DB_VERSION, seed } from './seed.ts';
import { REMOTE } from './remote.ts';
import { remoteCommit, remoteGet, remoteRestart, remoteSnapshot, remoteSubscribe, type CommitOpts } from './remoteStore.ts';

const KEY = 'borniz-db';
let db: DB | null = null;
const subs = new Set<() => void>();
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('borniz') : null;
(channel as { unref?: () => void } | null)?.unref?.(); // Node (tests, server): never keeps the process alive

const isHistory = (id: string) => id.startsWith('h');
function persist(d: DB) {
  const slim = { ...d, orders: d.orders.filter(o => !isHistory(o.id)), payments: d.payments.filter(p => !isHistory(p.id)) };
  try { localStorage.setItem(KEY, JSON.stringify(slim)); } catch { /* storage full or blocked: keep working in memory */ }
}
function load(): DB {
  const fresh = seed();
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null') as DB | null;
    if (saved && saved.v === DB_VERSION) {
      return { ...saved, orders: [...fresh.orders.filter(o => isHistory(o.id)), ...saved.orders], payments: [...fresh.payments.filter(p => isHistory(p.id)), ...saved.payments] };
    }
  } catch { /* corrupted: reseed */ }
  persist(fresh);
  return fresh;
}
function reload() { db = load(); subs.forEach(f => f()); }
if (channel) channel.onmessage = reload;
if (typeof window !== 'undefined') window.addEventListener('storage', e => { if (e.key === KEY) reload(); });

function get(): DB { if (!db) db = load(); return db; }
const serverSnap = () => null;
const subscribe = REMOTE ? remoteSubscribe : (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };

/** Returns null during server render and hydration (and while the remote adapter loads); templates show their loading skeleton. */
export function useDB(): DB | null { return useSyncExternalStore(subscribe, REMOTE ? remoteGet : get, serverSnap); }
export function useDBSelect<T>(pick: (d: DB) => T): T | null { const d = useDB(); return d ? pick(d) : null; }
export const snapshot = (): DB => onServer ?? (REMOTE ? remoteSnapshot() : get());

/** The automation worker (src/integrations/server/worker.ts) runs the app's own rules on one business's data inside the
 *  server process: while `fn` runs, commit() and snapshot() work on `d` alone (no browser storage, no broadcast). */
let onServer: DB | null = null;
export async function onServerDB(d: DB, fn: () => unknown | Promise<unknown>): Promise<DB> {
  onServer = d;
  try { await fn(); return onServer; } finally { onServer = null; }
}

export const uid = (p = '') => p + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);

/** The only way to change data. `actor` and `action` land in the audit log (never edited or deleted).
    `opts` only matter with the database: `expect` = server precondition on a document, `quiet` = no toast when the server refuses. */
export function commit(action: string, actor: string, mutate: (d: DB) => void, subject = '', outletId?: string, opts?: CommitOpts) {
  if (onServer) { const next = structuredClone(onServer); mutate(next); onServer = next; return; }
  if (REMOTE) return remoteCommit(action, actor, mutate, subject, outletId, opts);
  const next = structuredClone(get());
  mutate(next);
  // Offline: keep the same sync queue the server adapter keeps, so the offline count and "synced N" read the same here.
  if (!next.device.online && actor !== 'device') next.device.queue.push({ id: uid('q'), action, at: Date.now() });
  next.audit.unshift({ id: uid('au'), actor, action, subject, at: Date.now(), outletId });
  if (next.audit.length > 800) next.audit.length = 800;
  db = next;
  persist(next);
  channel?.postMessage(action);
  subs.forEach(f => f());
}
export function resetDemo() { if (REMOTE) { remoteRestart(); return; } localStorage.removeItem(KEY); reload(); channel?.postMessage('reset'); }
