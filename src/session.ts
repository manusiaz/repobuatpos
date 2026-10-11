'use client';
// Who is using this tab. Shared devices (POS, KDS, display) sign in with a PIN; owner/manager with account + 2FA.
// Per tab (sessionStorage) so one browser can run the POS, the KDS and the owner dashboard side by side.
// On Supabase the browser is signed in once with the owner/manager account; a tab starts as that person unless the device is
// shared (a staff PIN was used on it), and switching to anyone else needs their PIN (grantSession after bn_check_login_pin).
import { useEffect, useState } from 'react';
import type { Surface } from './system/registry.ts';
import type { Role } from './data/schema.ts';
import { REMOTE } from './data/remote.ts';
import { remoteInfo, remoteSnapshot, remoteSubscribe } from './data/supabaseStore.ts';

export interface SessionUser { id: string; role: Role; outletId: string }
const DEFAULT: Partial<Record<Surface, SessionUser>> = {
  owner: { id: 'budi', role: 'owner', outletId: 'sen' }, backoffice: { id: 'budi', role: 'owner', outletId: 'sen' }, studios: { id: 'budi', role: 'owner', outletId: 'sen' },
  menu: { id: 'budi', role: 'owner', outletId: 'sen' }, brand: { id: 'budi', role: 'owner', outletId: 'sen' }, loyalty: { id: 'budi', role: 'owner', outletId: 'sen' }, roles: { id: 'budi', role: 'owner', outletId: 'sen' },
  ownerMobile: { id: 'budi', role: 'owner', outletId: 'sen' }, manager: { id: 'andi', role: 'manager', outletId: 'sen' }, shifts: { id: 'andi', role: 'manager', outletId: 'sen' },
  pic: { id: 'maya', role: 'pic', outletId: 'sen' }, pos: { id: 'tono', role: 'cashier', outletId: 'sen' }, online: { id: 'tono', role: 'cashier', outletId: 'sen' },
  kds: { id: 'dimas', role: 'kitchen', outletId: 'sen' }, waiter: { id: 'joko', role: 'waiter', outletId: 'sen' }, admin: { id: 'admin', role: 'admin', outletId: 'sen' },
};
const KEY = 'borniz-session', SHARED = 'borniz-shared-device';
const PUBLIC: Surface[] = ['landing', 'auth', 'selforder', 'kiosk', 'states', 'graph'];
const subs = new Set<() => void>();
const granted = new Map<string, number>();
const GUEST: SessionUser = { id: 'guest', role: 'customer', outletId: 'sen' };

function remoteDefault(surface: Surface): SessionUser | null {
  const { mode, member } = remoteInfo();
  if (mode === 'boot') return null;
  const d = remoteSnapshot(), out = d.device.outletId || d.outlets[0]?.id || '';
  if (mode === 'member' && member) {
    let shared = false; try { shared = localStorage.getItem(SHARED) === '1'; } catch { /* blocked */ }
    if (shared && !PUBLIC.includes(surface)) return null;
    const e = d.employees.find(x => x.id === member.employeeId);
    return { id: member.employeeId, role: member.role === 'owner' || member.role === 'manager' ? member.role : e?.role ?? 'cashier', outletId: e?.outlets.includes(out) ? out : e?.outlets[0] ?? out };
  }
  return { ...GUEST, outletId: out };
}
export function getSession(surface: Surface, pathRole?: string): SessionUser {
  try { const s = JSON.parse(sessionStorage.getItem(KEY) || 'null'); if (s) return s; } catch { /* first visit */ }
  if (REMOTE) return remoteDefault(surface) ?? GUEST;
  if (pathRole === 'manager') return DEFAULT.manager!;
  return DEFAULT[surface] ?? { id: 'guest', role: 'customer', outletId: 'sen' };
}
/** Remote mode: the next setSession for this employee was proven (account password or their PIN on the server). */
export function grantSession(employeeId: string, shared: boolean) {
  granted.set(employeeId, Date.now() + 120e3);
  try { if (shared) localStorage.setItem(SHARED, '1'); else localStorage.removeItem(SHARED); } catch { /* blocked */ }
}
export function setSession(u: SessionUser | null) {
  if (REMOTE && u && (granted.get(u.id) ?? 0) < Date.now() && u.id !== getSession('landing').id) {
    import('./ui/kit.tsx').then(k => k.toast('Switch staff with their PIN')).catch(() => {});
    location.assign('/account/cashier-pin-login');
    return;
  }
  if (u) sessionStorage.setItem(KEY, JSON.stringify(u)); else sessionStorage.removeItem(KEY);
  subs.forEach(f => f());
}
export function useSession(surface: Surface, pathRole?: string): SessionUser | null {
  const [u, setU] = useState<SessionUser | null>(null);
  useEffect(() => {
    const f = () => {
      if (!REMOTE) return setU(getSession(surface, pathRole));
      let s: SessionUser | null = null;
      try { s = JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch { /* first visit */ }
      s ??= remoteDefault(surface);
      if (remoteInfo().mode !== 'boot' && !PUBLIC.includes(surface) && (!s || s.role === 'customer')) {
        location.assign(remoteInfo().mode === 'member' ? '/account/cashier-pin-login' : '/account/login');
        return;
      }
      setU(remoteInfo().mode === 'boot' ? null : s);
    };
    f(); subs.add(f);
    const off = REMOTE ? remoteSubscribe(f) : () => {};
    return () => { subs.delete(f); off(); };
  }, [surface, pathRole]);
  return u;
}
