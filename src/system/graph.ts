// Knowledge graph: every page is a node, every edge is a real data or design dependency.
// Built from the registry (sitemap), spec authority objects, prototype links and the service events in src/data/actions.ts.
import authority from './authority.json' with { type: 'json' };
import catalog from './catalog.json' with { type: 'json' };
import { PAGES, PROTOTYPE, type Surface } from './registry.ts';

export type NodeKind = 'surface' | 'page' | 'object' | 'role' | 'event' | 'doc';
export type EdgeKind = 'renders-in' | 'reads' | 'writes' | 'opens' | 'links' | 'live' | 'emits' | 'updates';
export interface GNode { id: string; kind: NodeKind; label: string; meta?: Record<string, unknown> }
export interface GEdge { from: string; to: string; kind: EdgeKind; label?: string }

/** Service events → the data objects they change (mirrors src/data/actions.ts). */
export const EVENTS: Record<string, { writes: string[]; from: Surface[]; note: string }> = {
  'order.created': { writes: ['order'], from: ['pos', 'selforder', 'kiosk', 'waiter'], note: 'newOrder' },
  'order.sent': { writes: ['order'], from: ['pos', 'waiter', 'selforder'], note: 'sendToKitchen: course firing to stations' },
  'payment.created': { writes: ['payment', 'order', 'deposit', 'kasbon'], from: ['pos', 'selforder', 'kiosk', 'display'], note: 'startPayment; QRIS expires in 5 min' },
  'payment.settled': { writes: ['payment', 'order'], from: ['pos', 'display', 'selforder'], note: 'gatewayWebhook only' },
  'order.paid': { writes: ['stock', 'points', 'messaging', 'promo', 'notif'], from: ['pos', 'selforder', 'kiosk'], note: 'recipe deduction, beans, thank-you WA' },
  'approval.requested': { writes: ['notif'], from: ['pos', 'pic', 'manager', 'backoffice', 'shifts', 'menu', 'studios'], note: 'requestApproval: level from type + amount' },
  'approval.approved': { writes: ['refund', 'void', 'discount', 'local', 'price', 'opname', 'drawer', 'cashmove', 'po', 'design', 'adjust', 'points', 'audit'], from: ['pic', 'manager', 'owner', 'ownerMobile', 'backoffice'], note: 'decide with approval PIN; nobody approves own request' },
  'ticket.bumped': { writes: ['order', 'notif'], from: ['kds'], note: 'bump: the only way to set ready' },
  'item.86': { writes: ['sold86', 'notif'], from: ['kds', 'pic', 'pos', 'manager', 'backoffice'], note: 'per outlet, synced to QR, kiosk, delivery apps' },
  'drawer.opened': { writes: ['drawer', 'attendance'], from: ['pos'], note: 'openSession' },
  'drawer.counted': { writes: ['drawer', 'attendance'], from: ['pos', 'pic'], note: 'blind count; variance over limit → approval' },
  'cash.out': { writes: ['cashmove'], from: ['pos', 'pic'], note: 'cash out always needs the PIC or higher' },
  'roster.updated': { writes: ['roster'], from: ['shifts'], note: 'one PIC per shift' },
  'opname.submitted': { writes: ['opname'], from: ['pic', 'manager'], note: 'blind, photo per difference, locked' },
  'po.created': { writes: ['po'], from: ['backoffice', 'manager'], note: '≤ 500k manager, above owner' },
  'po.received': { writes: ['receipt', 'stock', 'payable'], from: ['backoffice', 'manager'], note: 'stock movement type receipt' },
  'product.saved': { writes: ['product', 'local'], from: ['backoffice', 'menu', 'manager'], note: 'owner global, manager local → owner' },
  'price.changed': { writes: ['price'], from: ['backoffice', 'menu'], note: 'manager → owner; ±10% local; franchise lock' },
  'customer.created': { writes: ['customer', 'points'], from: ['pos', 'display', 'selforder', 'loyalty'], note: 'welcome beans' },
  'points.redeemed': { writes: ['points'], from: ['pos', 'selforder', 'loyalty'], note: 'never below zero' },
  'review.created': { writes: ['review', 'notif'], from: ['display', 'selforder'], note: '≤ 2★ alerts PIC + manager' },
  'online.received': { writes: ['online', 'order', 'readyby'], from: ['online'], note: 'incoming only: accept / reject' },
  'publish.requested': { writes: ['design', 'business'], from: ['menu', 'brand', 'studios'], note: 'owner publishes; manager sends to owner' },
  'perms.changed': { writes: ['permmatrix'], from: ['roles'], note: 'owner only, approval PIN' },
};

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

  for (const p of PAGES) {
    add({ id: p.path, kind: 'page', label: p.name, meta: { mode: p.mode, template: p.template, group: p.group, role: p.role } });
    edges.push({ from: p.path, to: 's:' + p.surface, kind: 'renders-in' });
    edges.push({ from: 'r:' + p.role, to: p.path, kind: 'opens' });
    if (p.object) edges.push({ from: p.path, to: 'o:' + p.object, kind: READS.includes(p.mode) ? 'reads' : 'writes' });
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
export { relatedPages } from './graph-lite.ts';
