// Domains, subdomains and subfolders. One deployment serves every host in the sitemap (spec bn-sitemap.js "host"):
//   bornis.id            marketing            app.bornis.id      account (/login …) + /owner + /manager back office
//   pos.bornis.id        register, PIC, online orders, waiter    kds.bornis.id   kitchen     display.bornis.id   customer display
//   order.bornis.id/<tenant>/…  QR menu, kiosk, customer links (/<tenant>/t/07 binds table 07)   admin.bornis.id   super admin
//   a merchant's own domain (Menu Studio → advanced) = their order.bornis.id/<tenant>
// Mode "path" (default, any single domain or preview URL) keeps the internal paths as the public paths (subfolders).
// A host map (NEXT_PUBLIC_BORNIZ_HOSTS) gives any surface its own hostname, e.g. pos → pos-soft-ajie-pos.vercel.app
// before a domain is bought, or a host on a separate server later; unmapped surfaces use <sub>.<root>.
// Pure functions: used by proxy.ts (request → internal page) and by publicUrl() (internal page → link, QR, receipt).
import { PAGES, pageAt } from './registry.ts';

export type Routing = 'subdomain' | 'path';
export interface HostConfig { routing: Routing; root: string; protocol: string; tenant: string; customDomains: Record<string, string>; hosts: Record<string, string> }

interface HostRule { sub: string; serves: string[]; strip?: string; tenant?: boolean }
/** Which internal path prefixes each host serves. `strip` = the prefix that disappears from public URLs. */
export const HOSTS: HostRule[] = [
  { sub: 'app', serves: ['/account', '/owner', '/manager', '/studios', '/graph', '/system'], strip: '/account' },
  { sub: 'pos', serves: ['/pos', '/pic', '/online', '/waiter'], strip: '/pos' },
  { sub: 'kds', serves: ['/kds'], strip: '/kds' },
  { sub: 'display', serves: ['/display'], strip: '/display' },
  { sub: 'order', serves: ['/order', '/kiosk'], tenant: true },
  { sub: 'admin', serves: ['/admin'], strip: '/admin' },
  { sub: '', serves: ['/'] }, // marketing: everything else
];
const under = (p: string, prefix: string) => prefix === '/' || p === prefix || p.startsWith(prefix + '/');
export const ruleFor = (internal: string) => HOSTS.find(h => h.serves.some(s => s !== '/' && under(internal, s))) ?? HOSTS[HOSTS.length - 1];

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
/** The hostname that serves a surface ('' = marketing). */
export const hostOf = (sub: string, cfg: HostConfig) => cfg.hosts[sub] ?? (sub ? sub + '.' : '') + cfg.root;

/** Internal page path (+ optional query) → the public URL people see, scan and share. */
export function publicUrl(internal: string, cfg: HostConfig, tenant = cfg.tenant, origin = '', own = ''): string {
  const [path, query = ''] = internal.split('?');
  // The merchant's own domain (Studios › Custom domain) serves its QR menu, kiosk and customer links: no tenant segment.
  if (own && ruleFor(path).tenant) return cfg.routing === 'path' ? `${cfg.protocol}://${own}${internal}`
    : publicUrl(internal, cfg, tenant).replace(`${cfg.protocol}://${hostOf('order', cfg)}/${tenant}`, `${cfg.protocol}://${own}`);
  if (cfg.routing === 'path') return origin + internal;
  const h = ruleFor(path);
  let pub = path;
  if (h.tenant) {
    const q = new URLSearchParams(query), t = q.get('t');
    pub = '/' + tenant + (path === '/order' && t ? '/t/' + encodeURIComponent(t) : path.replace(/^\/order/, ''));
    if (path === '/order' && t) q.delete('t');
    const rest = q.toString();
    return `${cfg.protocol}://${hostOf('order', cfg)}${pub}${rest ? '?' + rest : ''}`;
  }
  if (h.strip && under(path, h.strip)) pub = path.slice(h.strip.length) || '/';
  return `${cfg.protocol}://${hostOf(h.sub, cfg)}${pub}${query ? '?' + query : ''}`;
}

export type Resolution = { type: 'next' } | { type: 'rewrite'; path: string; query: Record<string, string> } | { type: 'redirect'; url: string };

/** Incoming host + path → which internal page serves it (proxy.ts). Unknown paths fall through to the 404 page. */
export function resolve(hostHeader: string, pathname: string, cfg: HostConfig, exists: (p: string) => boolean = p => !!pageAt(p)): Resolution {
  if (cfg.routing === 'path') return { type: 'next' };
  const host = hostHeader.toLowerCase().split(':')[0];
  const path = pathname.replace(/\/+$/, '') || '/';
  if (host === 'www.' + cfg.root) return { type: 'redirect', url: `${cfg.protocol}://${hostOf('', cfg)}${path}` };
  const custom = cfg.customDomains[host];
  const mapped = Object.entries(cfg.hosts).find(([, h]) => h === host)?.[0];
  const sub = custom ? 'order' : mapped ?? (host === cfg.root ? '' : host.endsWith('.' + cfg.root) ? host.slice(0, -cfg.root.length - 1) : null);
  if (sub === null) return { type: 'next' }; // preview URLs, localhost: subfolder mode
  const rule = HOSTS.find(h => h.sub === sub);
  if (!rule) return { type: 'next' };

  // An internal path (every in-app link is one): serve it here, or send it to the host that owns it.
  if (path !== '/' && exists(path)) {
    const owner = ruleFor(path);
    if (owner === rule) return { type: 'next' };
    return { type: 'redirect', url: publicUrl(path, cfg, custom ?? cfg.tenant) };
  }
  if (rule.tenant) {
    const [, first = '', ...rest] = path.split('/');
    const tenant = custom ?? first;
    const tail = custom ? path.split('/').slice(1) : rest;
    if (!tenant) return { type: 'redirect', url: `${cfg.protocol}://${hostOf('', cfg)}/` };
    if (tail[0] === 't' && tail[1]) return { type: 'rewrite', path: '/order', query: { tenant, t: tail[1] } };
    const internal = tail[0] === 'kiosk' ? '/' + tail.join('/') : '/order' + (tail.length ? '/' + tail.join('/') : '');
    return { type: 'rewrite', path: internal.replace(/\/$/, ''), query: { tenant } };
  }
  const internal = rule.strip ? (path === '/' ? rule.strip : rule.strip + path) : path;
  if (exists(internal)) return { type: 'rewrite', path: internal, query: {} };
  return { type: 'next' };
}

/** Every page's public URL in the current mode (deploy checks, sitemap.xml, the page map). */
export const allPublicUrls = (cfg: HostConfig) => PAGES.map(p => ({ path: p.path, url: publicUrl(p.path, cfg) }));

let ownHost = '';
/** The custom menu domain the merchant published (set by the app shell from src/system/tools.ts menuDomain). */
export const setOwnHost = (h: string) => { ownHost = h.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, ''); };
/** Public link for a page in this deployment (QR codes, receipts, WhatsApp, embeds). */
export const linkTo = (internal: string, tenant?: string) =>
  publicUrl(internal, config(), tenant, typeof location !== 'undefined' ? location.origin : '', ownHost);
/** Where a merchant points their own domain (CNAME). */
export const cnameTarget = () => { const c = config(); return c.routing === 'subdomain' ? hostOf('order', c) : (typeof location !== 'undefined' ? location.host : c.root); };
/** Query values the proxy derived from the public path (tenant, table) plus the real query string. Client-only. */
export function routeQuery(): Record<string, string> {
  if (typeof location === 'undefined') return {};
  const r = resolve(location.host, location.pathname, config());
  return { ...(r.type === 'rewrite' ? r.query : {}), ...Object.fromEntries(new URLSearchParams(location.search)) };
}
