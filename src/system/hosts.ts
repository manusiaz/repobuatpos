// Domains, subdomains and subfolders. One deployment serves every host (owner decision Oct 2026, over the spec's
// app./pos./kds./display./order. split): everything of one business lives on its own subdomain.
//   bornis.id          marketing                      app.bornis.id    sign up / sign in, then off to <slug>.bornis.id
//   <slug>.bornis.id   that business: / = QR menu (/t/07 binds table 07), /kiosk, /owner, /manager, /studios, /pos,
//                      /pic, /online, /waiter, /kds, /display (+ /account sign-in on the business's own host)
//   admin.bornis.id    super admin
//   old pos./kds./display. links → app.bornis.id; old order.bornis.id/<slug>/… → <slug>.bornis.id/…
//   a merchant's own domain (Menu Studio → advanced) serves its guest pages (QR menu, kiosk)
// Mode "path" (default, any single domain or preview URL) keeps the internal paths as the public paths (subfolders).
// A host map (NEXT_PUBLIC_BORNIZ_HOSTS: {"": …, "app": …, "admin": …, "tenant": …}) renames the hosts before a domain is
// bought (free vercel.app aliases cannot have subdomains: "tenant" is then one host for the default business).
// Pure functions: used by proxy.ts (request → internal page) and by publicUrl() (internal page → link, QR, receipt).
import { PAGES, pageAt } from './registry.ts';

export type Routing = 'subdomain' | 'path';
export interface HostConfig { routing: Routing; root: string; protocol: string; tenant: string; customDomains: Record<string, string>; hosts: Record<string, string> }

interface HostRule { sub: string; serves: string[]; strip?: string; tenant?: boolean }
/** Which internal path prefixes each host serves. `strip` = the prefix that disappears from public URLs. */
export const HOSTS: HostRule[] = [
  { sub: 'app', serves: ['/account', '/graph', '/system'], strip: '/account' },
  { sub: '*', serves: ['/owner', '/manager', '/studios', '/pos', '/pic', '/online', '/waiter', '/kds', '/display', '/order', '/kiosk', '/system/mobile'], tenant: true },
  { sub: 'admin', serves: ['/admin'], strip: '/admin' },
  { sub: '', serves: ['/'] }, // marketing: everything else
];
/** Hosts from before every business had its own subdomain: kept as redirects. */
const LEGACY = ['pos', 'kds', 'display', 'order'];
/** Guest pages: the only ones a merchant's own domain serves; /order is the business host's root. */
const GUEST = ['/order', '/kiosk'];
/** Names a business can never take as its <slug>.bornis.id: the platform's own hosts and spec names. */
export const RESERVED = new Set(['www', 'app', 'pos', 'kds', 'display', 'order', 'admin', 'go', 'status', 'preview', 'menu', 'mail', 'api', 'cdn', 'static', 'help', 'docs', 'blog']);
export const isTenantSlug = (s: string) => /^[a-z0-9][a-z0-9-]{1,40}$/.test(s) && !RESERVED.has(s);
const under = (p: string, prefix: string) => prefix === '/' || p === prefix || p.startsWith(prefix + '/');
/** The host that serves a page: the longest matching prefix wins (/system/mobile is the business's, /system the platform's). */
export const ruleFor = (internal: string) => {
  let best: HostRule | undefined, len = 0;
  for (const h of HOSTS) for (const s of h.serves) if (s !== '/' && under(internal, s) && s.length > len) { best = h; len = s.length; }
  return best ?? HOSTS[HOSTS.length - 1];
};

// Literal process.env.NEXT_PUBLIC_* reads so Next inlines them into the browser bundle.
const ENV: Record<string, string | undefined> = {
  NEXT_PUBLIC_BORNIZ_ROUTING: process.env.NEXT_PUBLIC_BORNIZ_ROUTING, NEXT_PUBLIC_BORNIZ_ROOT_DOMAIN: process.env.NEXT_PUBLIC_BORNIZ_ROOT_DOMAIN,
  NEXT_PUBLIC_BORNIZ_PROTOCOL: process.env.NEXT_PUBLIC_BORNIZ_PROTOCOL, NEXT_PUBLIC_BORNIZ_DEFAULT_TENANT: process.env.NEXT_PUBLIC_BORNIZ_DEFAULT_TENANT,
  NEXT_PUBLIC_BORNIZ_CUSTOM_DOMAINS: process.env.NEXT_PUBLIC_BORNIZ_CUSTOM_DOMAINS, NEXT_PUBLIC_BORNIZ_HOSTS: process.env.NEXT_PUBLIC_BORNIZ_HOSTS,
};
const json = (v: string | undefined): Record<string, string> => { try { return JSON.parse(v || '{}'); } catch { return {}; } };
export function config(env: Record<string, string | undefined> = ENV): HostConfig {
  const hosts = json(env.NEXT_PUBLIC_BORNIZ_HOSTS);
  return { routing: env.NEXT_PUBLIC_BORNIZ_ROUTING === 'subdomain' || Object.keys(hosts).length ? 'subdomain' : 'path', root: env.NEXT_PUBLIC_BORNIZ_ROOT_DOMAIN || 'bornis.id',
    protocol: env.NEXT_PUBLIC_BORNIZ_PROTOCOL || 'https', tenant: env.NEXT_PUBLIC_BORNIZ_DEFAULT_TENANT || 'kopibiru', customDomains: json(env.NEXT_PUBLIC_BORNIZ_CUSTOM_DOMAINS), hosts };
}
/** A Host this deployment serves: the root and its subdomains, host-map aliases, merchant domains, local dev.
 *  The server trusts no other Host header (password-reset links are built from it). */
export function ownsHost(host: string, cfg = config()): boolean {
  const h = host.split(':')[0].toLowerCase();
  return h === cfg.root || h.endsWith('.' + cfg.root) || Object.values(cfg.hosts).includes(h) || h in cfg.customDomains || h === 'localhost' || h === '127.0.0.1';
}
/** The hostname that serves a platform surface ('' = marketing). */
export const hostOf = (sub: string, cfg: HostConfig) => cfg.hosts[sub] ?? (sub ? sub + '.' : '') + cfg.root;
/** Where one business lives: its own subdomain (or the host map's one shared host). */
const tenantOrigin = (tenant: string, cfg: HostConfig) => `${cfg.protocol}://${cfg.hosts.tenant ?? tenant + '.' + cfg.root}`;
const isGuest = (p: string) => GUEST.some(g => under(p, g));
/** A guest page on the business host: /order → /, /order?t=07 → /t/07, /order/qr-menu/cart → /qr-menu/cart. */
function guestPath(path: string, query: string) {
  const q = new URLSearchParams(query), t = path === '/order' ? q.get('t') : null;
  if (t) q.delete('t');
  const pub = t ? '/t/' + encodeURIComponent(t) : path.replace(/^\/order(?=\/|$)/, '');
  return (pub === '/' ? '' : pub) + (q.toString() ? '?' + q.toString() : '');
}

/** Internal page path (+ optional query) → the public URL people see, scan and share. */
export function publicUrl(internal: string, cfg: HostConfig, tenant = cfg.tenant, origin = '', own = ''): string {
  const [path, query = ''] = internal.split('?');
  const h = ruleFor(path);
  if (cfg.routing === 'path') return own && h.tenant && isGuest(path) ? `${cfg.protocol}://${own}${internal}` : origin + internal;
  if (h.tenant) return isGuest(path) ? (own ? `${cfg.protocol}://${own}` : tenantOrigin(tenant, cfg)) + guestPath(path, query)
    : tenantOrigin(tenant, cfg) + path + (query ? '?' + query : '');
  const pub = h.strip && under(path, h.strip) ? path.slice(h.strip.length) || '/' : path;
  return `${cfg.protocol}://${hostOf(h.sub, cfg)}${pub}${query ? '?' + query : ''}`;
}

export type Resolution = { type: 'next' } | { type: 'rewrite'; path: string; query: Record<string, string> } | { type: 'redirect'; url: string };
const next: Resolution = { type: 'next' };
const go = (url: string): Resolution => ({ type: 'redirect', url });
const serve = (path: string, query: Record<string, string> = {}): Resolution => ({ type: 'rewrite', path, query });

/** Incoming host + path → which internal page serves it (proxy.ts). Unknown paths fall through to the 404 page. */
export function resolve(hostHeader: string, pathname: string, cfg: HostConfig, exists: (p: string) => boolean = p => !!pageAt(p)): Resolution {
  if (cfg.routing === 'path') return next;
  const host = hostHeader.toLowerCase().split(':')[0], P = cfg.protocol;
  const path = pathname.replace(/\/+$/, '') || '/';
  if (host === 'www.' + cfg.root) return go(`${P}://${hostOf('', cfg)}${path}`);
  const mapped = Object.entries(cfg.hosts).find(([, h]) => h === host)?.[0];
  const label = host === cfg.root ? '' : host.endsWith('.' + cfg.root) ? host.slice(0, -cfg.root.length - 1) : null;
  const own = cfg.customDomains[host];
  // The business this host belongs to: its own domain, its <slug>.<root>, or the host map's shared business host.
  const tenant = own ?? (mapped === 'tenant' ? cfg.tenant : mapped === undefined && label && isTenantSlug(label) ? label : undefined);
  if (tenant) {
    if (path === '/') return serve('/order', { tenant });
    const [, a, b] = path.split('/');
    if (a === 't' && b) return serve('/order', { tenant, t: b });
    if (exists(path)) {
      const owner = ruleFor(path);
      if (owner.sub === '' || owner.sub === 'admin') return go(publicUrl(path, cfg)); // marketing, super admin
      if (own && owner.tenant && !isGuest(path)) return go(publicUrl(path, cfg, tenant)); // staff work on <slug>.<root>
      return serve(path, { tenant }); // this business's pages, and /account sign-in on its own host
    }
    return exists('/order' + path) ? serve('/order' + path, { tenant }) : next;
  }
  const sub = mapped ?? label;
  if (sub === null) return next; // preview URLs, localhost: subfolder mode
  if (LEGACY.includes(sub)) {
    if (sub !== 'order') return go(`${P}://${hostOf('app', cfg)}/`); // which business is unknown: the account door picks it
    const [, first = '', ...rest] = path.split('/');
    return go(isTenantSlug(first) ? `${P}://${first}.${cfg.root}${rest.length ? '/' + rest.join('/') : ''}` : `${P}://${hostOf('', cfg)}/`);
  }
  const rule = HOSTS.find(h => h.sub === sub);
  if (!rule) return next;
  // An internal path (every in-app link is one): serve it here, or send it to the host that owns it.
  if (path !== '/' && exists(path)) {
    const owner = ruleFor(path);
    if (owner === rule) return next;
    return go(owner.tenant ? `${P}://${hostOf('app', cfg)}/` : publicUrl(path, cfg));
  }
  const internal = rule.strip ? (path === '/' ? rule.strip : rule.strip + path) : path;
  return exists(internal) ? serve(internal) : next;
}

/** Every page's public URL in the current mode (deploy checks, sitemap.xml, the page map). */
export const allPublicUrls = (cfg: HostConfig) => PAGES.map(p => ({ path: p.path, url: publicUrl(p.path, cfg) }));

/** A merchant's own domain once this deployment serves it (NEXT_PUBLIC_BORNIZ_CUSTOM_DOMAINS, switched on with
 *  deploy/add-domain.sh): QR codes, receipts and shared links use it. A domain only asked for in Studios is not live yet. */
export const liveDomain = (tenant?: string, cfg = config()) => (tenant && Object.keys(cfg.customDomains).find(h => cfg.customDomains[h] === tenant)) || '';
/** Public link for a page in this deployment (QR codes, receipts, WhatsApp, embeds). */
export const linkTo = (internal: string, tenant?: string) => {
  const t = tenant || hostTenant(), cfg = config(); // on the server (worker) there is no page: the deployment's own address
  return publicUrl(internal, cfg, t, typeof location !== 'undefined' ? location.origin : `${cfg.protocol}://${cfg.root}`, liveDomain(t));
};
/** Where a merchant points their own domain (CNAME). */
export const cnameTarget = () => { const c = config(); return c.routing === 'subdomain' ? hostOf('menu', c) : (typeof location !== 'undefined' ? location.host : c.root); };
/** In-app navigation that has to change host (sign-in on app. → the business's own subdomain, or the reverse):
 *  the full URL to load, or null when the page is served right here (client only). */
export function leaveFor(internal: string, tenant?: string): string | null {
  const cfg = config();
  if (cfg.routing === 'path' || typeof location === 'undefined') return null;
  if (hostTenant() && ruleFor(internal.split('?')[0]).sub === 'app') return null; // sign-in and PIN login stay on the business's own host
  const t = tenant || hostTenant(), url = publicUrl(internal, cfg, t, location.origin, liveDomain(t, cfg));
  return new URL(url).origin === location.origin ? null : url;
}
/** The same page on a business's own host, for sign-up and sign-in moving there; null when already on it (or subfolder mode). */
export function onBusinessHost(internal: string, slug: string): string | null {
  const cfg = config();
  if (cfg.routing === 'path' || typeof location === 'undefined' || !slug) return null;
  const origin = tenantOrigin(slug, cfg);
  return origin === location.origin ? null : origin + internal;
}
/** The business whose host this page is on (client only), so links stay on that business. */
export const hostTenant = () => (typeof location === 'undefined' ? undefined : (resolve(location.host, location.pathname, config()) as { query?: Record<string, string> }).query?.tenant);
/** Query values the proxy derived from the public path (tenant, table) plus the real query string. Client-only. */
export function routeQuery(): Record<string, string> {
  if (typeof location === 'undefined') return {};
  const r = resolve(location.host, location.pathname, config());
  return { ...(r.type === 'rewrite' ? r.query : {}), ...Object.fromEntries(new URLSearchParams(location.search)) };
}

/** Domains businesses asked for in Studios that are not live yet, as rows the console can turn into a root command: only a
 *  host name, never a BorNiz host (admin., app., a business's own <slug>.), and flagged when two businesses ask for the same. */
export function domainRequests(asks: { slug: string; domain?: string | null }[], live: Record<string, string>): { host: string; slug: string; problem?: string }[] {
  const rows = asks.map(a => ({ host: (a.domain ?? '').trim().toLowerCase(), slug: a.slug }))
    .filter(r => /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(r.host) && !ownsHost(r.host) && !live[r.host]);
  return rows.map(r => { const n = rows.filter(x => x.host === r.host).length; return n > 1 ? { ...r, problem: `asked by ${n} businesses` } : r; });
}
