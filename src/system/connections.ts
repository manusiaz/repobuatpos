// How real pages connect, from the rules in the design system — never invented here:
// design links = LINKS / linked-pages panels in spec "BorNiz Connections", data links = shared authority objects
// (spec bn-authority.js), event links = service events (graph.ts EVENTS, from spec "Diagrams").
import catalog from './catalog.json' with { type: 'json' };
import authority from './authority.json' with { type: 'json' };
import { PAGES, type Surface } from './registry.ts';
import { FEATURES, REAL, RELEASES, featuresOf, type RealPage, type Release } from './pagemap.ts';
import { EVENTS } from './events.ts';

export interface Link { to: RealPage; kind: 'design' | 'data' | 'event'; why: string }
const LINKS = catalog.links as unknown as Record<string, [string, string][]>;
const OBJ = new Map(authority.objects.map(o => [o.id, o]));
const surfaceOf = new Map(PAGES.map(p => [p.path, p.surface]));
const WRITE_MODES = new Set(['edit', 'settings', 'approve', 'incoming', 'screen', 'studio']);

/** Data objects a real page touches, split into what it writes and what it only reads. */
export function objectsOf(rp: RealPage) {
  const reads = new Set<string>(), writes = new Set<string>();
  for (const f of featuresOf(rp.id)) {
    const p = PAGES.find(x => x.path === f.path)!;
    if (!p.object) continue;
    (WRITE_MODES.has(p.mode) ? writes : reads).add(p.object);
  }
  // dedicated screens also write through service events (POS → order, payment …)
  const s = surfaceOf.get(rp.path) as Surface | undefined;
  for (const e of Object.values(EVENTS)) if (s && e.from.includes(s)) e.writes.forEach(o => writes.add(o));
  return { reads, writes };
}
/** The page a prototype name in LINKS points to (the prototype's main screen). */
const PRIMARY: Record<string, string> = {
  'Owner Dashboard': 'bo.dashboard', 'Manager Dashboard': 'mgr.dashboard', 'POS Register': 'pos.register', Shifts: 'bo.shifts', Studios: 'bo.screens', 'Self Order': 'order.menu',
  'Owner Mobile': 'mobile.live', 'Back Office': 'bo.transactions', Auth: 'acc.login', Landing: 'web.home', Loyalty: 'bo.loyalty', 'Menu Studio': 'bo.menustudio', 'Brand Studio': 'bo.brandstudio',
  'Kitchen Display': 'kds.tickets', 'Customer Display': 'display.screen', Kiosk: 'kiosk.app', Waiter: 'waiter.app', 'Online Orders': 'online.inbox', PIC: 'pic.home', Roles: 'bo.roles',
  'Super Admin': 'admin.overview', Authority: 'bo.approvals', Alerts: 'bo.settings',
};
const primaryOf = (proto: string) => REAL.find(r => r.id === PRIMARY[proto]);

export function linksOf(rp: RealPage): Link[] {
  const out = new Map<string, Link>();
  const add = (to: RealPage | undefined, kind: Link['kind'], why: string) => { if (to && to !== rp && !out.has(to.id + kind)) out.set(to.id + kind, { to, kind, why }); };
  for (const [proto, why] of LINKS[rp.proto] ?? []) add(primaryOf(proto), 'design', why);
  for (const [from, list] of Object.entries(LINKS)) for (const [proto, why] of list) if (proto === rp.proto) add(primaryOf(from), 'design', why);
  const mine = objectsOf(rp);
  for (const other of REAL) {
    if (other === rp || other.hidden) continue;
    const o = objectsOf(other);
    const shared = [...mine.writes].filter(x => o.reads.has(x) || o.writes.has(x)).concat([...mine.reads].filter(x => o.writes.has(x)));
    if (shared.length) add(other, 'data', [...new Set(shared)].map(x => OBJ.get(x)?.name ?? x).join(', '));
  }
  return [...out.values()];
}

/** A feature released in R must not depend on data that is first created in a later release. */
export function releaseGaps() {
  const firstWriter = new Map<string, { at: Release; by: string }>();
  const see = (o: string, at: Release, by: string) => { const cur = firstWriter.get(o); if (!cur || RELEASES.indexOf(at) < RELEASES.indexOf(cur.at)) firstWriter.set(o, { at, by }); };
  for (const f of FEATURES.values()) { const p = PAGES.find(x => x.path === f.path)!; if (p.object && WRITE_MODES.has(p.mode)) see(p.object, f.release, f.page.title); }
  for (const rp of REAL) { const s = surfaceOf.get(rp.path) as Surface | undefined; for (const e of Object.values(EVENTS)) if (s && e.from.includes(s)) e.writes.forEach(o => see(o, rp.release, rp.title)); }
  const gaps: string[] = [];
  for (const f of FEATURES.values()) {
    const p = PAGES.find(x => x.path === f.path)!, o = p.object;
    if (!o || WRITE_MODES.has(p.mode)) continue;
    const src = OBJ.get(o)?.src, w = firstWriter.get(o);
    if (src !== 'manual' && src !== 'config') continue; // automatic data appears from the field on its own
    if (!w) gaps.push(`${f.release} "${f.name}" (${f.page.title}) reads "${OBJ.get(o)?.name}" but nothing creates it`);
    else if (RELEASES.indexOf(w.at) > RELEASES.indexOf(f.release)) gaps.push(`${f.release} "${f.name}" (${f.page.title}) reads "${OBJ.get(o)?.name}", first created in ${w.at} by ${w.by}`);
  }
  return gaps;
}
export const featureCount = FEATURES.size;
