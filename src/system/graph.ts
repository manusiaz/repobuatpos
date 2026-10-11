// Knowledge graph: every page is a node, every edge is a real data or design dependency.
// Built from the registry (sitemap), spec authority objects, prototype links and the service events in src/data/actions.ts.
import authority from './authority.json' with { type: 'json' };
import catalog from './catalog.json' with { type: 'json' };
import { PAGES, PROTOTYPE } from './registry.ts';
import { FEATURES, REAL } from './pagemap.ts';
import { linksOf } from './connections.ts';
import { EVENTS } from './events.ts';

export type NodeKind = 'page' | 'feature' | 'surface' | 'object' | 'role' | 'event' | 'doc';
export type EdgeKind = 'part-of' | 'renders-in' | 'reads' | 'writes' | 'opens' | 'links' | 'live' | 'emits' | 'updates';
export interface GNode { id: string; kind: NodeKind; label: string; meta?: Record<string, unknown> }
export interface GEdge { from: string; to: string; kind: EdgeKind; label?: string }

export { EVENTS } from './events.ts';

const READS: Mode2[] = ['read', 'record', 'screen'];
type Mode2 = string;

export function buildGraph() {
  const nodes = new Map<string, GNode>(), edges: GEdge[] = [];
  const add = (n: GNode) => { if (!nodes.has(n.id)) nodes.set(n.id, n); };
  const surfaceOfProto = Object.fromEntries(Object.entries(PROTOTYPE).map(([s, p]) => [p, s]));
  const protoId = (name: string) => (surfaceOfProto[name] ? 's:' + surfaceOfProto[name] : 'doc:' + name);

  for (const [s, proto] of Object.entries(PROTOTYPE)) add({ id: 's:' + s, kind: 'surface', label: proto, meta: { prototype: `spec/BorNiz ${proto}.dc.html` } });
  for (const o of authority.objects) add({ id: 'o:' + o.id, kind: 'object', label: o.name, meta: { area: o.area, src: o.src, create: o.create, approve: o.approve } });
  for (const r of ['public', 'owner', 'manager', 'pic', 'cashier', 'kitchen', 'waiter', 'customer', 'admin', 'system']) add({ id: 'r:' + r, kind: 'role', label: r });

  // feature = one sitemap entry (a route); page = the real page it lives on (src/system/pagemap.ts)
  for (const p of PAGES) {
    const f = FEATURES.get(p.path);
    add({ id: p.path, kind: 'feature', label: p.name, meta: { mode: p.mode, template: p.template, group: p.group, role: p.role, kind: f?.kind, release: f?.release } });
    edges.push({ from: p.path, to: 's:' + p.surface, kind: 'renders-in' });
    edges.push({ from: 'r:' + p.role, to: p.path, kind: 'opens' });
    if (p.object) edges.push({ from: p.path, to: 'o:' + p.object, kind: READS.includes(p.mode) ? 'reads' : 'writes' });
    if (f) edges.push({ from: p.path, to: 'pg:' + f.page.id, kind: 'part-of', label: f.kind });
  }
  for (const rp of REAL) {
    add({ id: 'pg:' + rp.id, kind: 'page', label: rp.title, meta: { app: rp.app, module: rp.module, release: rp.release, epic: rp.epic, path: rp.path } });
    if (!FEATURES.has(rp.path)) edges.push({ from: 'pg:' + rp.id, to: rp.path, kind: 'part-of', label: 'root' });
    for (const l of linksOf(rp).filter(l => l.kind === 'design')) edges.push({ from: 'pg:' + rp.id, to: 'pg:' + l.to.id, kind: 'links', label: l.why });
  }
  for (const [from, list] of Object.entries(catalog.links as unknown as Record<string, [string, string][]>)) {
    add({ id: protoId(from), kind: surfaceOfProto[from] ? 'surface' : 'doc', label: from });
    for (const [to, label] of list) { add({ id: protoId(to), kind: surfaceOfProto[to] ? 'surface' : 'doc', label: to }); edges.push({ from: protoId(from), to: protoId(to), kind: 'links', label }); }
  }
  for (const pair of catalog.live as string[]) { const [a, b] = pair.split('|'); edges.push({ from: protoId(a), to: protoId(b), kind: 'live', label: 'realtime' }); }
  for (const [ev, e] of Object.entries(EVENTS)) {
    add({ id: 'e:' + ev, kind: 'event', label: ev, meta: { note: e.note } });
    for (const s of e.from) edges.push({ from: 's:' + s, to: 'e:' + ev, kind: 'emits' });
    for (const o of e.writes) edges.push({ from: 'e:' + ev, to: 'o:' + o, kind: 'updates' });
  }
  return { nodes: [...nodes.values()], edges };
}

/** Everything one node touches: used by the page "Connected" panel and /graph. */
export function neighbours(g: ReturnType<typeof buildGraph>, id: string) {
  return { out: g.edges.filter(e => e.from === id), in: g.edges.filter(e => e.to === id) };
}
