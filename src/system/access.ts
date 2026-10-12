import type { Role } from '../data/schema.ts';
import { pageAt, type Page, type Surface } from './registry.ts';

// Who may open which surface. Mirrors the launcher role lists in spec/bn-launcher.js (APPS).
const ALL = 'all' as const;
const ACCESS: Record<Surface, readonly Role[] | typeof ALL> = {
  landing: ALL, auth: ALL, selforder: ALL, kiosk: ALL, display: ALL, states: ALL, graph: ALL,
  owner: ['owner'], ownerMobile: ['owner', 'manager'], backoffice: ['owner', 'manager'], studios: ['owner', 'manager'], menu: ['owner', 'manager'], brand: ['owner', 'manager'],
  loyalty: ['owner', 'manager'], roles: ['owner', 'manager'], manager: ['owner', 'manager', 'pic'], shifts: ['owner', 'manager', 'pic', 'cashier', 'kitchen', 'waiter'],
  pic: ['owner', 'manager', 'pic'], pos: ['owner', 'manager', 'pic', 'cashier'], online: ['owner', 'manager', 'pic', 'cashier', 'kitchen'], kds: ['owner', 'manager', 'pic', 'kitchen'],
  waiter: ['owner', 'manager', 'pic', 'waiter'], admin: ['admin'],
};
export function canOpen(role: Role, page: Page) {
  const a = ACCESS[page.surface];
  if (a === ALL) return true;
  if (page.surface === 'backoffice' && page.role === 'system' && role !== 'owner' && role !== 'manager') return false;
  return a.includes(role);
}
/** A link is shown only if this role can open where it goes. */
export const canReach = (role: Role, path: string) => { const p = pageAt(path.split(/[?#]/)[0]); return !!p && canOpen(role, p); };
/** Manager on an owner-gated action: "Send to owner" instead of Save/Publish (Roles, lg-menu). */
export const GATED = /(price|publish|payroll|refund|billing|plan|bank|withdraw|royalt|delete|profit|p&l|supplier|points adjustment|limits|franchise|lock|api key)/i;
export const isGated = (role: Role, page: Page) => role === 'manager' && GATED.test(page.name);
