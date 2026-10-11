'use client';
// Who is using this tab. Shared devices (POS, KDS, display) sign in with a PIN; owner/manager with account + 2FA.
// Per tab (sessionStorage) so one browser can run the POS, the KDS and the owner dashboard side by side.
import { useEffect, useState } from 'react';
import type { Surface } from './system/registry.ts';
import type { Role } from './data/schema.ts';

export interface SessionUser { id: string; role: Role; outletId: string }
const DEFAULT: Partial<Record<Surface, SessionUser>> = {
  owner: { id: 'budi', role: 'owner', outletId: 'sen' }, backoffice: { id: 'budi', role: 'owner', outletId: 'sen' }, studios: { id: 'budi', role: 'owner', outletId: 'sen' },
  menu: { id: 'budi', role: 'owner', outletId: 'sen' }, brand: { id: 'budi', role: 'owner', outletId: 'sen' }, loyalty: { id: 'budi', role: 'owner', outletId: 'sen' }, roles: { id: 'budi', role: 'owner', outletId: 'sen' },
  ownerMobile: { id: 'budi', role: 'owner', outletId: 'sen' }, manager: { id: 'andi', role: 'manager', outletId: 'sen' }, shifts: { id: 'andi', role: 'manager', outletId: 'sen' },
  pic: { id: 'maya', role: 'pic', outletId: 'sen' }, pos: { id: 'tono', role: 'cashier', outletId: 'sen' }, online: { id: 'tono', role: 'cashier', outletId: 'sen' },
  kds: { id: 'dimas', role: 'kitchen', outletId: 'sen' }, waiter: { id: 'joko', role: 'waiter', outletId: 'sen' }, admin: { id: 'admin', role: 'admin', outletId: 'sen' },
};
const KEY = 'borniz-session';
const subs = new Set<() => void>();
export function getSession(surface: Surface, pathRole?: string): SessionUser {
  try { const s = JSON.parse(sessionStorage.getItem(KEY) || 'null'); if (s) return s; } catch { /* first visit */ }
  if (pathRole === 'manager') return DEFAULT.manager!;
  return DEFAULT[surface] ?? { id: 'guest', role: 'customer', outletId: 'sen' };
}
export function setSession(u: SessionUser | null) { if (u) sessionStorage.setItem(KEY, JSON.stringify(u)); else sessionStorage.removeItem(KEY); subs.forEach(f => f()); }
export function useSession(surface: Surface, pathRole?: string): SessionUser | null {
  const [u, setU] = useState<SessionUser | null>(null);
  useEffect(() => { const f = () => setU(getSession(surface, pathRole)); f(); subs.add(f); return () => { subs.delete(f); }; }, [surface, pathRole]);
  return u;
}
