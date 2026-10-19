// The installable apps ("Add to home screen" on a register, kitchen tablet, waiter phone, customer display, kiosk): each
// screen links its own manifest (app/[[...slug]]/page.tsx → /api/app-manifest?app=…), so an installed KDS opens the KDS,
// a kiosk the kiosk and the owner's phone the dashboard, on the host it was installed from.
import { HOME } from './access.ts';
import type { Surface } from './registry.ts';

export const APPS = {
  pos: { name: 'BorNiz POS', start: HOME.cashier },
  pic: { name: 'BorNiz PIC', start: HOME.pic },
  kds: { name: 'BorNiz Kitchen', start: HOME.kitchen },
  waiter: { name: 'BorNiz Waiter', start: HOME.waiter },
  display: { name: 'BorNiz Customer Display', start: '/display' },
  kiosk: { name: 'Self-order kiosk', start: '/kiosk' },
  order: { name: 'Order', start: '/order' },
  owner: { name: 'BorNiz Owner', start: HOME.owner },
  manager: { name: 'BorNiz Manager', start: HOME.manager },
  admin: { name: 'BorNiz Admin', start: HOME.admin },
  bornis: { name: 'BorNiz', start: '/' },
} as const;
export type App = keyof typeof APPS;

const OF: Partial<Record<Surface, App>> = {
  pos: 'pos', online: 'pos', pic: 'pic', kds: 'kds', waiter: 'waiter', display: 'display', kiosk: 'kiosk', selforder: 'order',
  owner: 'owner', ownerMobile: 'owner', backoffice: 'owner', studios: 'owner', menu: 'owner', brand: 'owner', loyalty: 'owner', roles: 'owner', shifts: 'owner',
  manager: 'manager', admin: 'admin',
};
/** The app a page belongs to: back-office pages under /manager install the manager app, the rest the owner's. */
export const appOf = (surface: Surface, path: string): App => (path.startsWith('/manager') ? 'manager' : OF[surface] ?? 'bornis');
