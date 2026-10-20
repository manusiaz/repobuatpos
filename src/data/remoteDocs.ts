// Pure mapping between the app DB and the document store (public.docs: tenant, coll, id, data, t, open).
// No browser or network here: the remote adapter (remoteStore.ts) and the Node tests share it.
import type { DB } from './schema.ts';
import { seed } from './seed.ts';

type Any = Record<string, any>;
export interface Op { op: 'put' | 'del'; coll: string; id: string; data?: unknown; t?: number | null; open?: boolean; expect?: Record<string, unknown>; fresh?: boolean }
/** A document as it arrives from the server; data null = deleted. */
export interface Doc { coll: string; id: string; data: unknown }
/** Display order of catalog-like collections (_meta/order), so every device lists outlets, staff and products the same way. */
export type Hint = Record<string, string[]>;
export interface PinSet { id: string; pin: string | null; approvalPin: string | null }

/** Time field per collection: ASC lists are appended (oldest first), DESC lists are prepended (newest first). */
const ASC: Record<string, string> = { customers: 'joinedAt', orders: 'createdAt', payments: 'at', refunds: 'at', movements: 'at', ledger: 'at', clock: 'at', reservations: 'at' };
const DESC: Record<string, string> = { approvals: 'at', sessions: 'openedAt', cashMoves: 'at', opnames: 'at', pos: 'at', reviews: 'at', messages: 'at', notices: 'at', versions: 'at' };
export const ORDERED = ['outlets', 'employees', 'categories', 'modifierGroups', 'products', 'stockItems', 'suppliers', 'promos', 'devices', 'integrations', 'commissionRules'];
const KEYED: Record<string, (x: Any) => string> = { outletProducts: x => x.productId + '|' + x.outletId, recipes: x => x.productId + '|' + x.stockItemId, roster: x => x.outletId + '|' + x.day };
/** Append-only rows without an id: keyed by their content (identical rows get #1, #2 …). */
const CONTENT: Record<string, string> = { movements: 'm', ledger: 'l' };
export const ARRAYS = [...ORDERED, 'outletProducts', 'recipes', 'roster', ...Object.keys(ASC), ...Object.keys(DESC)];
export const MAPS = ['settings', 'perms'];
export const META = ['tenant', 'theme', 'staffBrand'] as const;
/** Device-local in remote mode: never synced (counters come from bn_reserve blocks, audit from audit_log). */
export const LOCAL = ['v', 'counters', 'device', 'audit'];
const DONE = ['paid', 'voided', 'refunded', 'part_refunded'];
const OPEN: Record<string, (x: Any) => boolean> = {
  orders: x => !DONE.includes(x.status) || (x.lines ?? []).some((l: Any) => l.fired && l.kds !== 'done'),
  payments: x => x.status === 'pending' || x.status === 'created', approvals: x => x.status === 'waiting' || x.status === 'recount',
  sessions: x => x.status !== 'closed', cashMoves: x => x.status === 'waiting', opnames: x => !['posted', 'rejected'].includes(x.status),
  pos: x => !['received', 'cancelled'].includes(x.status), messages: x => x.status === 'queued',
};
export const MASK_PIN = '••••', MASK_APPROVAL = '••••••';
export const SYNTHETIC = '~';

/** JSON with sorted keys (content keys must not depend on property order). */
export const stable = (v: unknown): string => JSON.stringify(v, (_, x) => x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map(k => [k, x[k]])) : x);
export function h53(s: string) {
  let a = 0xdeadbeef, b = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); a = Math.imul(a ^ c, 2654435761); b = Math.imul(b ^ c, 1597334677); }
  a = Math.imul(a ^ (a >>> 16), 2246822507) ^ Math.imul(b ^ (b >>> 13), 3266489909);
  b = Math.imul(b ^ (b >>> 16), 2246822507) ^ Math.imul(a ^ (a >>> 13), 3266489909);
  return (4294967296 * (2097151 & b) + (a >>> 0)).toString(36);
}
const synthetic = (c: string, x: Any) => (c === 'movements' && String(x.sourceId ?? '').startsWith(SYNTHETIC)) || (c === 'ledger' && String(x.orderId ?? '').startsWith(SYNTHETIC)) || (c === 'recipes' && String(x.stockItemId ?? '').startsWith(SYNTHETIC));
function baseKey(c: string, x: Any): string | null {
  if (synthetic(c, x)) return null;
  if (KEYED[c]) return KEYED[c](x);
  if (CONTENT[c]) return CONTENT[c] + h53(stable(x));
  return String(x.id);
}
/** Doc ids of a collection, in array order ('' = device-only row such as an opening balance). */
export function keysOf(c: string, arr: Any[]): string[] {
  const seen = new Map<string, number>();
  return arr.map(x => { const k = baseKey(c, x); if (k === null) return ''; const n = seen.get(k) ?? 0; seen.set(k, n + 1); return n ? k + '#' + n : k; });
}

export function toDoc(c: string, x: Any): Any {
  if (c === 'employees') { const { pin, approvalPin, ...rest } = x; return { ...rest, hasPin: !!pin, hasApprovalPin: !!approvalPin }; }
  return x;
}
export function fromDoc(c: string, data: Any): Any {
  if (c === 'employees') { const { hasPin, hasApprovalPin, pin: _p, approvalPin: _a, ...rest } = data; return { ...rest, pin: hasPin ? MASK_PIN : '', approvalPin: hasApprovalPin ? MASK_APPROVAL : '' }; }
  if (c === 'records') { const { o: _o, ...rest } = data; return rest; }
  return data;
}
/** Listed by time but never left out of a device's history window: a member who joined last year still earns points today. */
const UNWINDOWED = ['customers'];
const tOf = (c: string, x: Any) => { const f = UNWINDOWED.includes(c) ? '' : ASC[c] ?? DESC[c] ?? (c === 'records' ? 'at' : ''); const v = f ? x?.[f] : undefined; return typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null; };
const put = (coll: string, id: string, data: Any, src: Any = data, fresh = false): Op => ({ op: 'put', coll, id, data, t: tOf(coll, src), open: OPEN[coll]?.(src) ?? false, ...(fresh ? { fresh } : {}) });

// Serialisations are cached per object: DB objects are never mutated after a commit (every commit works on a clone).
const cache = new WeakMap<object, string>();
const js = (v: unknown) => { if (!v || typeof v !== 'object') return JSON.stringify(v); let s = cache.get(v); if (s === undefined) { s = JSON.stringify(v); cache.set(v, s); } return s; };

function arrDiff(c: string, a: Any[], b: Any[], ops: Op[]) {
  const ka = keysOf(c, a), kb = keysOf(c, b), before = new Map<string, Any>();
  ka.forEach((k, i) => { if (k) before.set(k, a[i]); });
  kb.forEach((k, i) => {
    if (!k) return;
    const was = before.get(k); before.delete(k);
    if (!was) ops.push(put(c, k, toDoc(c, b[i]), b[i], true));
    else if (was !== b[i] && js(toDoc(c, was)) !== js(toDoc(c, b[i]))) ops.push(put(c, k, toDoc(c, b[i]), b[i]));
  });
  for (const k of before.keys()) ops.push({ op: 'del', coll: c, id: k });
}

/** Everything one commit changed, as document upserts / deletes (one bn_write call). */
export function diff(a: DB, b: DB): Op[] {
  const A = a as unknown as Any, B = b as unknown as Any, ops: Op[] = [];
  for (const m of META) if (A[m] !== B[m] && js(A[m]) !== js(B[m])) ops.push(put('_meta', m, B[m]));
  for (const c of ARRAYS) if (A[c] !== B[c] && js(A[c]) !== js(B[c])) arrDiff(c, A[c] ?? [], B[c] ?? [], ops);
  if (ORDERED.some(c => A[c] !== B[c] && js(keysOf(c, A[c] ?? [])) !== js(keysOf(c, B[c] ?? [])))) ops.push(put('_meta', 'order', hintOf(b)));
  for (const c of MAPS) {
    const x = A[c] ?? {}, y = B[c] ?? {};
    if (x === y) continue;
    for (const k of Object.keys(y)) if (!(k in x) || js(x[k]) !== js(y[k])) ops.push(put(c, k, { k, v: y[k] }, {}, !(k in x)));
    for (const k of Object.keys(x)) if (!(k in y)) ops.push({ op: 'del', coll: c, id: k });
  }
  const ra = A.records ?? {}, rb = B.records ?? {};
  if (ra !== rb) for (const o of new Set([...Object.keys(ra), ...Object.keys(rb)])) {
    const x: Any[] = ra[o] ?? [], y: Any[] = rb[o] ?? [];
    if (x === y || js(x) === js(y)) continue;
    const old = new Map(x.map(r => [r.id, r]));
    for (const r of y) { const w = old.get(r.id); old.delete(r.id); if (!w || js(w) !== js(r)) ops.push(put('records', o + '|' + r.id, { o, ...r }, r, !w)); }
    for (const id of old.keys()) ops.push({ op: 'del', coll: 'records', id: o + '|' + id });
  }
  return ops;
}
export const hintOf = (d: DB): Hint => Object.fromEntries(ORDERED.map(c => [c, keysOf(c, (d as unknown as Any)[c] ?? [])]));
export const opsToDocs = (ops: Op[]): Doc[] => ops.map(o => ({ coll: o.coll, id: o.id, data: o.op === 'del' ? null : o.data }));

const byTime = (c: string) => { const f = ASC[c] ?? DESC[c], s = ASC[c] ? 1 : -1; return (x: Any, y: Any) => s * ((x[f] ?? 0) - (y[f] ?? 0)); };
function byHint(c: string, arr: Any[], order?: string[]) {
  if (!order?.length) return arr;
  const pos = new Map(order.map((k, i) => [k, i])), keys = keysOf(c, arr);
  return arr.map((x, i) => [x, pos.get(keys[i]) ?? order.length + i] as const).sort((p, q) => p[1] - q[1]).map(p => p[0]);
}

/** Merge server documents into a DB (new arrays only where something changed; existing rows keep their place). */
export function applyDocs(db: DB, docs: Doc[], hint: Hint): DB {
  if (!docs.length) return db;
  const out = { ...db } as unknown as Any, groups = new Map<string, Doc[]>();
  for (const d of docs) { const g = groups.get(d.coll); if (g) g.push(d); else groups.set(d.coll, [d]); }
  let reorder = false;
  for (const [c, list] of groups) {
    if (c === '_meta') {
      for (const d of list) {
        if (d.id === 'order') { if (d.data) { Object.assign(hint, d.data); reorder = true; } }
        else if ((META as readonly string[]).includes(d.id) && d.data) out[d.id] = d.data;
      }
    } else if (MAPS.includes(c)) {
      const m = { ...(out[c] ?? {}) };
      for (const d of list) { if (d.data == null) delete m[d.id]; else m[d.id] = (d.data as Any).v; }
      out[c] = m;
    } else if (c === 'records') {
      const r: Record<string, Any[]> = { ...(out.records ?? {}) };
      for (const d of list) {
        const i = d.id.indexOf('|'), o = d.id.slice(0, i), id = d.id.slice(i + 1), l = [...(r[o] ?? [])], at = l.findIndex(x => x.id === id);
        if (d.data == null) { if (at >= 0) l.splice(at, 1); } else { const v = fromDoc(c, d.data as Any); if (at >= 0) l[at] = v; else l.unshift(v); }
        r[o] = l;
      }
      out.records = r;
    } else if (ARRAYS.includes(c)) {
      const arr: Any[] = [...(out[c] ?? [])], idx = new Map(keysOf(c, arr).map((k, i) => [k, i])), gone = new Set<number>(), addAt = new Map<string, number>();
      const add: (Any | null)[] = [];
      for (const d of list) {
        const i = idx.get(d.id), j = addAt.get(d.id);
        const v = d.data == null ? null : fromDoc(c, d.data as Any);
        if (i !== undefined) { if (v) { arr[i] = v; gone.delete(i); } else gone.add(i); }
        else if (j !== undefined) add[j] = v;
        else if (v) { addAt.set(d.id, add.length); add.push(v); }
      }
      let res = gone.size ? arr.filter((_, i) => !gone.has(i)) : arr;
      const fresh = add.filter((x): x is Any => !!x);
      if (fresh.length) { res = [...res, ...fresh]; if (ASC[c] || DESC[c]) res = res.map((x, i) => [x, i] as const).sort((p, q) => byTime(c)(p[0], q[0]) || p[1] - q[1]).map(p => p[0]); }
      out[c] = res;
      if (ORDERED.includes(c) && fresh.length) reorder = true;
    }
  }
  if (reorder) for (const c of ORDERED) out[c] = byHint(c, out[c] ?? [], hint[c]);
  return out as unknown as DB;
}

/** The empty shape of a DB (keeps tenant, theme, brand and device defaults). */
export function emptyDB(shape: DB): DB {
  const o = { ...shape } as unknown as Any;
  for (const c of ARRAYS) o[c] = [];
  for (const c of MAPS) o[c] = {};
  return { ...o, records: {}, counters: {}, audit: [], device: { ...shape.device, queue: [], paired: {} } } as unknown as DB;
}
/** A DB from a full document load (server order is by coll, id; timed lists are sorted by time). */
export function fromDocs(shape: DB, docs: Doc[], hint: Hint = {}): DB {
  const d = applyDocs(emptyDB(shape), docs, hint) as unknown as Any;
  for (const c of [...Object.keys(ASC), ...Object.keys(DESC)]) d[c] = [...d[c]].sort(byTime(c));
  for (const c of ORDERED) d[c] = byHint(c, d[c], hint[c]);
  return d as unknown as DB;
}
/** Every syncable document of a DB (starter dataset upload). */
export const allOps = (d: DB): Op[] => diff(emptyDB(d), d).filter(o => o.op === 'put');

/** Staff PINs typed on this device in this commit (sent with bn_set_pins, never stored in documents). */
export function pinChanges(a: DB, b: DB): PinSet[] {
  const old = new Map(a.employees.map(e => [e.id, e]));
  return b.employees.flatMap(e => {
    const o = old.get(e.id);
    const pin = /^\d{4}$/.test(e.pin ?? '') && e.pin !== o?.pin ? e.pin : null, approvalPin = /^\d{6}$/.test(e.approvalPin ?? '') && e.approvalPin !== o?.approvalPin ? e.approvalPin : null;
    return pin || approvalPin ? [{ id: e.id, pin, approvalPin }] : [];
  });
}

const GUEST_ORDER = ['open', 'held', 'sent', 'preparing', 'paying'];
/** What an anonymous guest may send (bn_guest_write); the rest stays on the guest's screen only. */
export function guestOps(ops: Op[]): Op[] {
  return ops.filter(o => {
    if (o.op !== 'put') return false;
    const d = o.data as Any;
    if (o.coll === 'orders') return ['qr', 'kiosk', 'web'].includes(d.source) && GUEST_ORDER.includes(d.status);
    if (o.coll === 'payments') return d.status === 'pending' && ['qris', 'va', 'ewallet'].includes(d.method);
    if (o.coll === 'ledger') return !!o.fresh && d.points === 50 && d.reason === 'Welcome beans';
    return ['reviews', 'reservations', 'notices', 'customers'].includes(o.coll) && !!o.fresh;
  }).sort((x, y) => Number(y.coll === 'orders') - Number(x.coll === 'orders'));
}
export const wire = (ops: Op[]) => ops.map(({ fresh: _f, ...o }) => o);

const MESSAGES: Record<string, string> = {
  '033': 'Quantity must be a whole number from 1 to 99.', '034': 'That option is no longer on the menu. Refresh the menu.', '035': 'That promo is no longer active.',
  '036': 'The total changed (tax or service). Refresh and try again.', '038': 'Tips must be a positive amount.', '039': 'Sign up with your name and contact only.',
  '047': 'Only waiter calls and order notices can be sent from the menu.', '048': 'This request was already decided and can’t be changed.', '049': 'Order numbers are reserved 1 to 1000 at a time.',
  '053': 'This request needs a higher approver. Refresh and send it again.', '054': 'Your role can’t change this. Ask your PIC or manager.',
  '055': 'A refund needs its approved request first.', '056': 'Voiding a bill needs an approved void. Ask your PIC.',
  '080': 'Only the owner or a manager sets up a shared register.', '081': 'That register code is wrong or expired.',
  '082': 'Your session ended. Sign in with your PIN again.',
  '052': 'Only the owner adds or changes owners and managers; a manager changes other staff.', '064': 'This attendance machine is already connected to a business.',
  '050': 'This business moved to its own server. Reconnecting…',   '001': 'Sales records are never deleted. Make a correction instead.', '002': 'Stock and beans history can’t be edited.', '003': 'Not enough beans.',
  '004': 'QRIS, VA and e-wallet payments are confirmed by the payment gateway, not on this device.', '006': 'This request was already decided on another device.',
  '007': 'Nobody approves their own request.', '008': 'Approval PIN expired. Enter it again.', '011': 'This device is not signed in to this business. Log in again.',
  '012': 'Log in first.', '021': 'This order is already closed.', '023': 'A price just changed. Refresh the menu.', '024': 'The flash sale ended. Refresh the menu.',
  '025': 'Your total no longer matches the menu. Refresh the menu.', '040': 'Someone changed this on another device. Showing the latest.',
  '045': 'Starter data can only go into a new, empty business.',
};
/** Server guard errors (BNxxx) → one sentence for a toast. */
export function humanError(msg: string): { code: string | null; text: string } {
  const m = /BN(\d{3})\s*(.*)/.exec(msg || '');
  if (!m) return { code: null, text: /fetch|network/i.test(msg) ? 'No connection. Saved on this device, it syncs when you’re back online.' : msg || 'Something went wrong' };
  const rest = m[2].replace(/\s*\(.*\)$/, '');
  return { code: 'BN' + m[1], text: MESSAGES[m[1]] ?? (rest ? rest[0].toUpperCase() + rest.slice(1) + (/[.!?]$/.test(rest) ? '' : '.') : 'Not allowed.') };
}

/** History every device loads (and the automation worker): NEXT_PUBLIC_BORNIZ_WINDOW_DAYS, default 35. */
export const WINDOW_MS = (Number(process.env.NEXT_PUBLIC_BORNIZ_WINDOW_DAYS) || 35) * 864e5;
let blank: DB | null = null;
/** The empty shape a business's documents fill in. */
export function blankDB(): DB {
  if (blank) return blank;
  const s = emptyDB(seed());
  return blank = { ...s, tenant: { ...s.tenant, id: '', name: '', plan: 'free' }, theme: { ...s.theme, name: '' }, staffBrand: { ...s.staffBrand, workspace: '' } };
}
/** A business as a signed-in device (remoteStore) and the automation worker see it: its documents inside the history
 *  window, plus stock and beans from before it as opening rows. */
export function memberDB(docs: Doc[], opening: { stock?: Any[]; beans?: Any[] }, since: number, hint: Hint, t: { slug: string; name?: string; plan?: string; status?: string; trialUntil?: number | null }): DB {
  const d = fromDocs(blankDB(), docs, hint) as unknown as Any;
  d.movements = [...(opening.stock ?? []).map(s => ({ outletId: s.outletId, stockItemId: s.stockItemId, qty: Number(s.qty), type: 'adjust', sourceId: SYNTHETIC + 'opening', by: 'system', at: since - 1 })), ...d.movements];
  d.ledger = [...(opening.beans ?? []).map(b => ({ customerId: b.customerId, points: Number(b.points), reason: 'Opening balance', orderId: SYNTHETIC + 'opening', at: since - 1 })), ...d.ledger];
  d.tenant = { ...d.tenant, id: t.slug, name: d.tenant.name || t.name || '', plan: t.plan ?? 'free', status: t.status ?? 'active', trialUntil: t.trialUntil ?? null }; // plan, status, trial are set by BorNiz (tenants)
  return d as DB;
}
