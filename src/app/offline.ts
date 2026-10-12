'use client';
// Installable and offline: public/sw.js keeps the app shell, and the browser's real connection drives db.device.online,
// so every surface's offline banner, the QRIS pause and the sync queue follow it.
import { useEffect } from 'react';
import { snapshot } from '../data/store.ts';
import { setDeviceOnline } from '../data/actions.ts';

const FLAG = 'borniz-net-off'; // the connection (not the register's Online switch) took this device offline

/** What the connection asks for: go 'off', come back 'on' (only if the connection took it off), or nothing. */
export function netChange(browserOnline: boolean, deviceOnline: boolean, byConnection: boolean): 'off' | 'on' | null {
  if (!browserOnline) return deviceOnline ? 'off' : null;
  return byConnection && !deviceOnline ? 'on' : null;
}

/** `warm` loads the lazy screens of the key surfaces, so they open offline even if this device never showed them online. */
export function useOffline(ready: boolean, warm: () => Promise<unknown>[]) {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').then(() => navigator.serviceWorker.ready).then(async r => {
      await Promise.allSettled(warm());
      // Files this page loaded before the worker controlled it (first visit) go into its cache too.
      r.active?.postMessage({ cache: performance.getEntriesByType('resource').map(e => e.name) });
    }).catch(() => {});
  }, [warm]);
  useEffect(() => {
    if (!ready) return;
    const byConnection = () => { try { return localStorage.getItem(FLAG) === '1'; } catch { return false; } };
    const mark = (off: boolean) => { try { if (off) localStorage.setItem(FLAG, '1'); else localStorage.removeItem(FLAG); } catch { /* blocked */ } };
    const sync = () => {
      const c = netChange(navigator.onLine, snapshot().device.online, byConnection());
      if (c === 'off' || navigator.onLine) mark(c === 'off');
      if (c) setDeviceOnline(c === 'on');
    };
    sync();
    addEventListener('online', sync); addEventListener('offline', sync);
    return () => { removeEventListener('online', sync); removeEventListener('offline', sync); };
  }, [ready]);
}
