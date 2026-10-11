// The sitemap is the router. Every page in spec/bn-sitemap.js becomes exactly one route here; nothing is hand-listed.
// Add a page to the sitemap in the design system, run `npm run spec`, and it exists (Design Notes: "Back office").
import spec from './pages.json' with { type: 'json' };

export type Mode = 'screen' | 'studio' | 'edit' | 'settings' | 'read' | 'record' | 'incoming' | 'approve';
export type Template = 'list' | 'detail' | 'form' | 'report' | 'settings' | 'flow' | 'template' | 'device';
/** Dedicated screens = the prototypes in spec/ that are built for one job. Everything else renders from a template. */
export type Surface = 'landing' | 'auth' | 'owner' | 'manager' | 'backoffice' | 'pic' | 'pos' | 'display' | 'kds' | 'selforder' | 'kiosk' | 'waiter'
  | 'admin' | 'states' | 'ownerMobile' | 'shifts' | 'loyalty' | 'online' | 'studios' | 'brand' | 'menu' | 'roles' | 'graph';
export type Shell = 'public' | 'backoffice' | 'pos' | 'kds' | 'guest' | 'device' | 'admin' | 'mobile' | 'bare';

export interface Page {
  path: string; slug: string; name: string; title: string;
  role: string; host: string; area: string; group: string;
  mode: Mode; template: Template | null; surface: Surface; shell: Shell; object: string | null;
  prototype: string; extra?: boolean;
}

export const slugify = (s: string) => s.toLowerCase().replace(/\(([^)]*)\)/g, ' $1 ').replace(/&/g, ' and ').replace(/\+/g, ' plus ')
  .replace(/[“”"'’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/-+/g, '-').slice(0, 70).replace(/-+$/, '');
const shortSlug = (s: string) => slugify(s.replace(/\([^)]*\)/g, ''));

export const PROTOTYPE: Record<Surface, string> = {
  landing: 'Landing', auth: 'Auth', owner: 'Owner Dashboard', manager: 'Manager Dashboard', backoffice: 'Back Office', pic: 'PIC', pos: 'POS Register',
  display: 'Customer Display', kds: 'Kitchen Display', selforder: 'Self Order', kiosk: 'Kiosk', waiter: 'Waiter', admin: 'Super Admin', states: 'States Gallery',
  ownerMobile: 'Owner Mobile', shifts: 'Shifts', loyalty: 'Loyalty', online: 'Online Orders', studios: 'Studios', brand: 'Brand Studio', menu: 'Menu Studio', roles: 'Roles', graph: 'Connections',
};
const SHELL: Record<Surface, Shell> = {
  landing: 'public', auth: 'public', owner: 'backoffice', manager: 'backoffice', backoffice: 'backoffice', pic: 'pos', pos: 'pos', display: 'device', kds: 'kds',
  selforder: 'guest', kiosk: 'device', waiter: 'mobile', admin: 'admin', states: 'bare', ownerMobile: 'mobile', shifts: 'backoffice', loyalty: 'backoffice',
  online: 'pos', studios: 'backoffice', brand: 'backoffice', menu: 'backoffice', roles: 'backoffice', graph: 'bare',
};
const SCREEN_SURFACE: Record<string, Surface> = { Shifts: 'shifts', Loyalty: 'loyalty', 'Manager Dashboard': 'manager', 'Menu Studio': 'menu', 'Brand Studio': 'brand', Studios: 'studios' };

function surfaceOf(p: { role: string; host: string; group: string; name: string; screen: string | null }): Surface {
  if (p.screen && p.role !== 'customer') return SCREEN_SURFACE[p.screen]; // a guest link is never an editor
  const n = p.name;
  switch (p.role) {
    case 'Public': return p.host === 'bornis.id' ? 'landing' : 'auth';
    case 'pic': return 'pic';
    case 'cashier': return /(online & qr orders|ride-hailing orders)/i.test(n) ? 'online' : 'pos';
    case 'kitchen': return 'kds';
    case 'admin': return 'admin';
    case 'customer': return p.host.startsWith('display') ? 'display' : p.group === 'Kiosk' ? 'kiosk' : 'selforder';
    case 'system': return p.group === 'Mobile' ? 'ownerMobile' : p.group === 'States' ? 'states' : 'backoffice';
  }
  if (/^live monitor \(all outlets\)/i.test(n)) return 'owner';
  if (/^(live monitor \(outlet\)|outlet overview)/i.test(n)) return 'manager';
  if (/(delivery order kanban|ride-hailing integrations)/i.test(n)) return 'online';
  if (/^roles & permissions matrix/i.test(n)) return 'roles';
  return 'backoffice';
}

function templateOf(mode: Mode, name: string, group: string): Template {
  const n = name.toLowerCase();
  if (group === 'Templates' || /(template$|templates$|^waba template|printed receipt|kitchen ticket print)/.test(n)) return 'template';
  if (/(menu board|queue \/ call numbers|kiosk management)/.test(n)) return mode === 'settings' ? 'settings' : 'device';
  if (mode === 'settings') return 'settings';
  if (mode === 'read') return 'report';
  if (/(^import|bulk edit|opname$|stock opname|daily cash reconciliation|merge duplicates|import \/ export)/.test(n)) return 'flow';
  if (/(detail|profile & security)/.test(n)) return 'detail';
  if (mode === 'edit' && /(form|^new |^add |^invite|adjustment \(manual|entry$|^purchase request|request$|generator)/.test(n)) return 'form';
  return 'list';
}

const ROLE_PREFIX: Record<string, string> = { owner: '/owner', manager: '/manager', pic: '/pic', cashier: '/pos', kitchen: '/kds', admin: '/admin', system: '/system' };
function basePath(p: { role: string; host: string; group: string }) {
  if (p.role === 'Public') return p.host === 'bornis.id' ? '' : '/account';
  if (p.role === 'customer') return p.host.startsWith('display') ? '/display' : p.group === 'Kiosk' ? '/kiosk' : '/order';
  return ROLE_PREFIX[p.role];
}
const SINGLE_GROUP = new Set(['/kds', '/display', '/kiosk', '/admin', '']);

type Raw = { role: string; host: string; area: string; group: string; name: string; mode: Mode; object: string | null; screen: string | null };
const used = new Set<string>();
function build(r: Raw): Page {
  const base = basePath(r);
  let slug = r.role === 'Public' && r.name === 'Home' ? '' : shortSlug(r.name) || slugify(r.name);
  const groupSlug = SINGLE_GROUP.has(base) || base === '/account' ? '' : shortSlug(r.group);
  let path = [base, groupSlug, slug].filter(Boolean).join('/') || '/';
  if (!path.startsWith('/')) path = '/' + path;
  for (let i = 2; used.has(path); i++) path = path.replace(/-\d+$/, '') + '-' + i;
  used.add(path);
  const surface = surfaceOf(r);
  const mode: Mode = surface === 'backoffice' ? r.mode : r.mode === 'studio' ? 'studio' : 'screen';
  return {
    path, slug: path.split('/').pop() || 'home', name: r.name, title: r.name.replace(/\s*\([^)]*\)\s*$/, ''),
    role: r.role.toLowerCase(), host: r.host, area: r.area, group: r.group, mode, object: r.object,
    template: surface === 'backoffice' ? templateOf(r.mode, r.name, r.group) : null,
    surface, shell: surface === 'online' && (r.role === 'owner' || r.role === 'manager') ? 'backoffice' : SHELL[surface], prototype: PROTOTYPE[surface],
  };
}

const sitemap: Page[] = (spec.pages as Raw[]).map(build);

/** Roots for surfaces the sitemap has no page for (gaps in the sitemap, kept explicit so they show up in the graph). */
const EXTRA: Page[] = [
  { path: '/owner', name: 'Owner dashboard', surface: 'owner', role: 'owner', group: 'Monitor' },
  { path: '/manager', name: 'Manager dashboard', surface: 'manager', role: 'manager', group: 'Monitor' },
  { path: '/waiter', name: 'Waiter app', surface: 'waiter', role: 'waiter', group: 'Waiter' },
  { path: '/online', name: 'Online orders', surface: 'online', role: 'cashier', group: 'Selling' },
  { path: '/studios', name: 'Customization studios', surface: 'studios', role: 'owner', group: 'Studios' },
  { path: '/graph', name: 'Knowledge graph', surface: 'graph', role: 'system', group: 'System' },
  // Surface roots, so every app has a short address (the screen opens its default view).
  { path: '/pos', name: 'POS register', surface: 'pos', role: 'cashier', group: 'Selling' },
  { path: '/pic', name: 'PIC home', surface: 'pic', role: 'pic', group: 'My shift' },
  { path: '/kds', name: 'Kitchen display', surface: 'kds', role: 'kitchen', group: 'Screens' },
  { path: '/display', name: 'Customer display', surface: 'display', role: 'customer', group: 'Screens' },
  { path: '/order', name: 'QR menu', surface: 'selforder', role: 'customer', group: 'QR menu' },
  { path: '/kiosk', name: 'Kiosk', surface: 'kiosk', role: 'customer', group: 'Kiosk' },
  { path: '/admin', name: 'BorNiz admin', surface: 'admin', role: 'admin', group: 'Platform' },
  { path: '/account', name: 'Account', surface: 'auth', role: 'public', group: 'Auth' },
  // Sitemap gap: counting is done on the PIC tablet (Authority, CLAUDE.md opname rules) but the PIC sitemap has no page for it.
  { path: '/pic/floor/stock-opname', name: 'Stock opname (blind count)', surface: 'pic', role: 'pic', group: 'Floor' },
].map(x => ({ ...x, slug: x.path.slice(1), title: x.name, host: '', area: PROTOTYPE[x.surface as Surface], mode: 'screen' as Mode, object: null, template: null,
  surface: x.surface as Surface, shell: SHELL[x.surface as Surface], prototype: PROTOTYPE[x.surface as Surface], extra: true }));

export const PAGES: Page[] = [...sitemap, ...EXTRA];
const BY_PATH = new Map(PAGES.map(p => [p.path, p]));
export const pageAt = (path: string) => BY_PATH.get(path.replace(/\/+$/, '') || '/');
export const pagesOf = (s: Surface) => PAGES.filter(p => p.surface === s);
export const sitemapCount = sitemap.length;

/** First page of a surface, used by launcher tiles. */
export const surfaceHome = (s: Surface) => PAGES.find(p => p.surface === s && p.extra)?.path ?? pagesOf(s)[0]?.path ?? '/';
