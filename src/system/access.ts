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
/** Where each role starts: after a PIN or account sign-in, and on a device nobody pointed at a page. */
export const HOME: Record<Role, string> = { owner: '/owner', manager: '/manager', pic: '/pic', cashier: '/pos/selling/register-order', kitchen: '/kds', waiter: '/waiter', admin: '/admin', customer: '/order', public: '/' };
/** After sign-in: the page that was asked for (a notification link, the device's screen) when this role may open it, else its own start. */
export const startFor = (role: Role, next?: string | null) => (next && /^\/(?!\/)/.test(next) && canReach(role, next) ? next : HOME[role]);
/** Manager on an owner-gated action: "Send to owner" instead of Save/Publish (Roles, lg-menu). */
export const GATED = /(price|publish|payroll|refund|billing|plan|bank|withdraw|royalt|delete|profit|p&l|supplier|points adjustment|limits|franchise|lock|api key)/i;
export const isGated = (role: Role, page: Page) => role === 'manager' && GATED.test(page.name);
