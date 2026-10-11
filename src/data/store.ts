'use client';
// One store for every surface. Local adapter: localStorage + BroadcastChannel, so the POS, KDS, customer display,
// self-order and dashboards open in different tabs stay in sync live (the production adapter is Supabase realtime,
// see supabase/migrations). Every write goes through commit() → audit log + realtime broadcast.
import { useSyncExternalStore } from 'react';
import type { DB } from './schema.ts';
import { DB_VERSION, seed } from './seed.ts';

const KEY = 'borniz-db';
let db: DB | null = null;
const subs = new Set<() => void>();
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('borniz') : null;

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
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };

/** Returns null during server render and hydration; templates show their loading skeleton. */
export function useDB(): DB | null { return useSyncExternalStore(subscribe, get, serverSnap); }
export function useDBSelect<T>(pick: (d: DB) => T): T | null { const d = useDB(); return d ? pick(d) : null; }
export const snapshot = () => get();

export const uid = (p = '') => p + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);

/** The only way to change data. `actor` and `action` land in the audit log (never edited or deleted). */
export function commit(action: string, actor: string, mutate: (d: DB) => void, subject = '', outletId?: string) {
  const next = structuredClone(get());
  mutate(next);
  next.audit.unshift({ id: uid('au'), actor, action, subject, at: Date.now(), outletId });
  if (next.audit.length > 800) next.audit.length = 800;
  db = next;
  persist(next);
  channel?.postMessage(action);
  subs.forEach(f => f());
}
export function resetDemo() { localStorage.removeItem(KEY); reload(); channel?.postMessage('reset'); }
