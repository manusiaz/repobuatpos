'use client';
// Remote adapter (own PostgreSQL). Same DB shape and commit() contract as the local adapter in store.ts:
//   load    the signed-in business's documents (orders, payments, movements, ledger … of the last WINDOW days, plus anything still open)
//           and opening balances before that (bn_opening) so stock levels and bean balances stay right
//   write   commit() applies the change at once (optimistic), diffs the DB into document ops and queues one bn_write per commit
//           (op id = idempotent retries); the queue survives reloads (localStorage) and drains when back online
//   listen  realtime on the tenant's documents and audit rows; remote changes merge under any still-pending local commits
//   reject  a commit the server refuses (guard trigger BNxxx) drops out of the queue: the screen reverts and says why
//   guests  QR menu / kiosk visitors read bn_public_snapshot, write through bn_guest_write and poll bn_guest_order
import type { Audit, DB } from './schema.ts';
import { seed } from './seed.ts';
import { applyDocs, blankDB, diff, emptyDB, fromDocs, guestOps, memberDB, WINDOW_MS, humanError, opsToDocs, pinChanges, wire, SYNTHETIC, type Doc, type Hint, type Op, type PinSet } from './remoteDocs.ts';
import type { Membership } from './backend.ts';
import { staffToken } from './staff.ts';

type Any = Record<string, any>;
export type Mode = 'boot' | 'anon' | 'member' | 'guest';
export interface CommitOpts { expect?: { coll: string; id: string; data: Record<string, unknown> }[]; quiet?: boolean }
interface Pending { opId: string; action: string; actor: string; subject: string; outletId?: string; ops: Op[]; at: number; pins?: PinSet[]; quiet?: boolean; local?: boolean; staff?: string | null }

const NAMES = ['order', 'po'];
const DONE = ['paid', 'voided', 'refunded', 'part_refunded'];
const lib = () => import('./backend.ts');
const toast = (m: string) => { import('../ui/kit.tsx').then(k => k.toast(m)).catch(() => {}); };
const rid = (p: string) => p + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
const ls = {
  get<T>(k: string, f: T): T { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) as T : f; } catch { return f; } },
  set(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* full or blocked: keep working in memory */ } },
};

let admin = false;
let mode: Mode = 'boot', started = false, userId: string | null = null, enteredFor: string | null | undefined, loading = false;
let tenant: { id: string; slug: string } | null = null, member: Membership | null = null;
let base: DB | null = null, db: DB | null = null, hint: Hint = {};
let queue: Pending[] = [], audit: Audit[] = [], device: DB['device'] | null = null, blocks: Record<string, [number, number][]> = {}, tracked: string[] = [];
let seq = 0, inbox: Doc[] = [], inboxTimer: ReturnType<typeof setTimeout> | null = null, cacheTimer: ReturnType<typeof setTimeout> | null = null;
let channel: { unsubscribe: () => unknown } | null = null, timers: ReturnType<typeof setInterval>[] = [];
const lastRemote = new Map<string, number>(), reserving = new Set<string>();
const subs = new Set<() => void>(), docSubs = new Set<(docs: Doc[]) => void>();
const key = (k: string) => `borniz-${k}:${mode}:${tenant?.id ?? ''}`;
const emit = () => subs.forEach(f => f());

const shapeDB = blankDB;
function countersNow(): Record<string, number> {
  const t = Math.floor(Date.now() / 1000);
  if (mode === 'guest') return { order: 10000 + t % 90000, po: 0 };
  return Object.fromEntries(NAMES.map(n => [n, blocks[n]?.[0]?.[0] ?? 90000 + t % 10000]));
}
/** Per-device blocks of order / PO numbers (bn_reserve), so registers never hand out the same number, even offline. */
async function topUp() {
  if (mode !== 'member' || !tenant) return;
  for (const n of NAMES) {
    if ((blocks[n] ?? []).reduce((a, r) => a + r[1] - r[0], 0) >= 20 || reserving.has(n)) continue;
    reserving.add(n);
    try {
      const { sb } = await lib(), { data, error } = await sb().rpc('bn_reserve', { p_tenant: tenant.id, p_name: n, p_count: 100 });
      if (!error && data != null) { (blocks[n] ??= []).push([Number(data), Number(data) + 100]); ls.set(key('blocks'), blocks); if (db) { db = { ...db, counters: countersNow() }; emit(); } }
    } catch { /* offline: fallback numbers until the next top-up */ } finally { reserving.delete(n); }
  }
}
function consume(prev: Record<string, number>, next: Record<string, number>) {
  if (mode !== 'member') return;
  for (const n of NAMES) if (next[n] !== prev[n]) { const r = blocks[n]?.[0]; if (r) { r[0] = next[n]; if (r[0] >= r[1]) blocks[n].shift(); } }
  ls.set(key('blocks'), blocks); topUp();
}

/** db = confirmed server state + every pending local commit + device-local fields. */
function compose() {
  if (!base) return;
  let d = base;
  for (const p of queue) d = applyDocs(d, opsToDocs(p.ops), hint);
  const dev = device ?? d.device;
  db = { ...d, audit, counters: countersNow(), device: { ...dev, queue: queue.filter(p => !p.local).map(p => ({ id: p.opId, action: p.action, at: p.at })) } };
  emit();
  if (mode === 'member' && !cacheTimer) cacheTimer = setTimeout(() => { cacheTimer = null; if (base) ls.set(key('cache'), { base: { ...base, audit: [] }, hint }); }, 15e3);
}
const saveQueue = () => ls.set(key('queue'), queue.filter(p => !p.local).map(({ pins: _p, ...p }) => p));

export function remoteCommit(action: string, actor: string, mutate: (d: DB) => void, subject = '', outletId?: string, opts: CommitOpts = {}) {
  const cur = db ?? shapeDB(), next = structuredClone(cur);
  next.counters = countersNow();
  const c0 = { ...next.counters };
  mutate(next);
  next.audit.unshift({ id: rid('au'), actor, action, subject, at: Date.now(), outletId });
  if (next.audit.length > 800) next.audit.length = 800;
  consume(c0, next.counters);
  audit = next.audit;
  if (JSON.stringify(next.device) !== JSON.stringify(cur.device)) { device = next.device; ls.set('borniz-device', { outletId: device.outletId, online: device.online, paired: device.paired }); }
  if (mode !== 'member' && mode !== 'guest') { db = next; emit(); return; }
  const all = diff(cur, next), ops = mode === 'guest' ? guestOps(all) : all;
  for (const e of opts.expect ?? []) { const o = ops.find(x => x.coll === e.coll && x.id === e.id); if (o) o.expect = e.data; }
  const pins = mode === 'member' ? pinChanges(cur, next) : [];
  if (ops.length || pins.length) queue.push({ opId: rid('op'), action, actor, subject, outletId, ops, at: Date.now(), pins, quiet: opts.quiet, staff: staffToken(actor) });
  if (mode === 'guest' && all.length > ops.length) queue.push({ opId: rid('lo'), action, actor, subject, ops: all.filter(o => !ops.includes(o)), at: Date.now(), local: true });
  if (mode === 'guest') for (const o of ops) if (o.coll === 'orders' && !tracked.includes(o.id)) { tracked.push(o.id); ls.set(key('orders'), tracked); }
  saveQueue();
  db = { ...next, counters: countersNow(), device: { ...next.device, queue: queue.filter(p => !p.local).map(p => ({ id: p.opId, action: p.action, at: p.at })) } };
  emit();
  flush();
}

const retryable = (e: { code?: string; message?: string }) => !e.code || /^PGRST3/.test(e.code) || /^(08|53|57)/.test(e.code) || /fetch|network|timeout/i.test(e.message ?? '');
let flushing = false, backoff = 2000;
const rejectSubs = new Set<(p: { action: string; ops: Op[] }, err: { code: string | null; text: string }) => void>();
export const onReject = (f: (p: { action: string; ops: Op[] }, err: { code: string | null; text: string }) => void) => { rejectSubs.add(f); return () => { rejectSubs.delete(f); }; };
async function flush() {
  if (flushing || !tenant || (mode !== 'member' && mode !== 'guest') || db?.device.online === false || (typeof navigator !== 'undefined' && navigator.onLine === false)) return;
  flushing = true;
  try {
    const { sb } = await lib();
    // a shared register nobody is signed in to (kiosk, customer display) writes what a guest may write
    for (let p = queue.find(x => !x.local); p && tenant; p = queue.find(x => !x.local)) {
      const sent = seq;
      const { error } = mode === 'guest'
        ? await sb().rpc('bn_guest_write', { p_tenant: tenant.id, p_ops: wire(p.ops) })
        : await sb().rpc('bn_write', { p_tenant: tenant.id, p_ops: wire(member?.role === 'device' && !p.staff ? guestOps(p.ops) : p.ops), p_action: p.action, p_actor: p.actor, p_subject: p.subject || null, p_outlet: p.outletId ?? null, p_op: p.opId, p_staff: p.staff ?? null });
      if (error && retryable(error)) { setTimeout(flush, backoff); backoff = Math.min(backoff * 2, 60e3); break; }
      backoff = 2000;
      const done = p;
      queue = queue.filter(x => x !== done);
      if (error && /BN050/.test(error.message)) { queue = [done, ...queue]; saveQueue(); moved(); break; } // kept: replays once in the new database
      if (error) { const h = humanError(error.message); if (!done.quiet) toast(h.text); if (h.code === 'BN088') void followBorniz(); /* the hold began: show it now */ rejectSubs.forEach(f => f(done, h)); }
      else if (base) {
        // our own realtime echo (or a newer change) may already be in: only fill in what realtime has not delivered since sending
        base = applyDocs(base, opsToDocs(done.ops).filter(d => (lastRemote.get(d.coll + '/' + d.id) ?? 0) <= sent), hint);
        for (const x of done.pins ?? []) {
          const r = await sb().rpc('bn_set_pins', { p_tenant: tenant.id, p_employee: x.id, p_pin: x.pin, p_approval_pin: x.approvalPin });
          if (r.error) toast(humanError(r.error.message).text);
        }
      }
      saveQueue(); compose();
    }
  } catch { setTimeout(flush, backoff); } finally { flushing = false; }
}

function incoming(r: Any) { inbox.push({ coll: r.coll, id: r.id, data: r.data ?? null }); inboxTimer ??= setTimeout(drain, 30); }
function drain() {
  inboxTimer = null;
  if (!base || loading || !inbox.length) return;
  const docs = inbox; inbox = [];
  applyRemote(docs);
}
function applyRemote(docs: Doc[]) {
  if (!base || !docs.length) return;
  for (const d of docs) lastRemote.set(d.coll + '/' + d.id, ++seq);
  base = applyDocs(base, docs, hint);
  compose();
  docSubs.forEach(f => f(docs));
}
function auditIn(r: Any) {
  const a: Audit = { id: 'a' + r.id, actor: r.actor, action: r.action, subject: r.subject ?? '', at: Date.parse(r.at), outletId: r.outlet_id ?? undefined };
  const i = audit.findIndex(x => x.id.startsWith('au') && x.action === a.action && x.actor === a.actor && (x.subject || '') === a.subject);
  audit = [a, ...audit.filter((_, j) => j !== i)].slice(0, 800);
  if (db) { db = { ...db, audit }; emit(); }
}

/** Live changes of this business (server-sent events from app/api/bn/live, read under the member's own access). */
async function listen(tid: string) {
  let first = true;
  const es = new EventSource('/api/bn/live?tenant=' + encodeURIComponent(tid), { withCredentials: true });
  const on = (ev: string, f: (r: Any) => void) => es.addEventListener(ev, e => { try { f(JSON.parse((e as MessageEvent).data)); } catch { /* bad frame */ } });
  on('doc', r => { if (r.tenant_id === tid) incoming(r); });
  on('audit', auditIn);
  on('ready', () => { if (!first) resync(); first = false; }); // reconnected after a gap: reload
  on('reset', () => resync());
  channel = { unsubscribe: () => es.close() };
}
/** Reconnected after a gap: reload, keep the pending queue on top. */
async function resync() {
  if (mode !== 'member' || loading) return;
  try { base = await loadMember(); compose(); drain(); flush(); } catch { /* still offline */ }
}

async function loadMember(): Promise<DB> {
  const { sb } = await lib(), tid = tenant!.id, since = Date.now() - WINDOW_MS;
  loading = true;
  try {
    const docs: Doc[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb().read<Doc[]>('docs', { tenant: tid, since, from });
      if (error) throw error;
      docs.push(...(data ?? []));
      if ((data ?? []).length < 1000) break;
    }
    const [op, au] = await Promise.all([sb().rpc('bn_opening', { p_tenant: tid, p_before: since }), sb().read<Any[]>('audit', { tenant: tid })]);
    if (op.error) throw op.error;
    hint = {};
    const d = memberDB(docs, (op.data ?? {}) as { stock?: Any[]; beans?: Any[] }, since, hint, { slug: tenant!.slug, name: member?.name, plan: member?.plan, status: member?.status, trialUntil: member?.trialUntil, unpaidSince: member?.unpaidSince, hold: member?.hold }) as unknown as Any;
    const local = audit.filter(a => a.id.startsWith('au'));
    audit = [...local, ...(au.data ?? []).map(r => ({ id: 'a' + r.id, actor: r.actor, action: r.action, subject: r.subject ?? '', at: Date.parse(r.at), outletId: r.outlet_id ?? undefined }))].slice(0, 800);
    return d as unknown as DB;
  } finally { loading = false; }
}

async function enterMember(m: Membership) {
  mode = 'member'; member = m; tenant = { id: m.tenantId, slug: m.slug };
  queue = ls.get<Pending[]>(key('queue'), []); blocks = ls.get(key('blocks'), {});
  await listen(m.tenantId);
  try { base = await loadMember(); }
  catch (e) {
    const c = ls.get<{ base: DB; hint: Hint } | null>(key('cache'), null);
    if (!c) throw e;
    base = c.base; hint = c.hint; toast('Offline: showing the data saved on this device. Changes sync when you’re back.');
  }
  const saved = ls.get<Partial<DB['device']> | null>('borniz-device', null);
  device = { ...base.device, ...saved, queue: [] } as DB['device'];
  if (!base.outlets.some(o => o.id === device!.outletId) && base.outlets[0]) device.outletId = base.outlets[0].id;
  compose(); drain(); flush(); topUp();
  import('./remoteFinalize.ts').then(f => f.startFinalizer()).catch(() => {});
  timers.push(setInterval(() => void followBorniz(), 5 * 60e3));
}
/** What BorNiz sets on the business (plan, trial end, an unpaid invoice, the hold) changes with no document: ask again. */
async function followBorniz() {
  if (mode !== 'member' || !base || !tenant) return;
  const { membership } = await lib(), m = await membership().catch(() => null);
  if (!m || m.tenantId !== tenant.id) return;
  const t = { plan: m.plan ?? 'free', status: m.status ?? 'active', trialUntil: m.trialUntil ?? null, unpaidSince: m.unpaidSince ?? null, hold: !!m.hold } as const;
  member = m; ls.set('borniz-member:' + userId, m); // a reload offline starts from what is true now
  if ((Object.keys(t) as (keyof typeof t)[]).every(k => base!.tenant[k] === t[k])) return;
  base = { ...base, tenant: { ...base.tenant, ...t } }; compose();
}

export function guestBase(snap: Any, slug: string, prev: DB | null): DB {
  const d = applyDocs(prev ?? emptyDB(shapeDB()), snap.docs ?? [], hint);
  const portions = (snap.portions ?? []) as { outletId: string; productId: string; n: number }[];
  // the plan is the one BorNiz set (tenants.plan), never the merchant's own _meta document
  return { ...d, tenant: { ...d.tenant, id: slug, name: d.tenant.name || snap.tenant?.name || '', plan: snap.tenant?.plan ?? 'free' },
    recipes: [...new Set(portions.map(p => p.productId))].map(p => ({ productId: p, stockItemId: SYNTHETIC + p, qty: 1 })),
    movements: portions.map(p => ({ outletId: p.outletId, stockItemId: SYNTHETIC + p.productId, qty: Number(p.n), type: 'adjust' as const, sourceId: SYNTHETIC + 'portions', by: 'system', at: 0 })) };
}
async function snapshotOf(slug: string) {
  const { sb } = await lib(); // a merchant on its own database: the server answers from there
  const { data, error } = await sb().rpc('bn_public_snapshot', { p_slug: slug }); if (error) throw error; return data as Any | null; }
async function enterGuest(slug: string): Promise<boolean> {
  const snap = await snapshotOf(slug);
  if (!snap) return false;
  mode = 'guest'; tenant = { id: snap.tenant.id, slug };
  base = guestBase(snap, slug, null);
  queue = ls.get<Pending[]>(key('queue'), []); tracked = ls.get<string[]>(key('orders'), []);
  device = { ...base.device, ...ls.get<Partial<DB['device']>>('borniz-device', {}), queue: [] } as DB['device'];
  compose(); flush(); pollGuest();
  timers.push(setInterval(pollGuest, 4000), setInterval(async () => { try { const s = await snapshotOf(slug); if (s && base) { base = guestBase(s, slug, base); compose(); } } catch { /* offline */ } }, 60e3));
  return true;
}
/** A guest follows their own orders (status, payments) without an account. */
async function pollGuest() {
  if (mode !== 'guest' || !tenant || !tracked.length || (typeof document !== 'undefined' && document.hidden)) return;
  const { sb } = await lib(), docs: Doc[] = [];
  for (const id of [...tracked]) {
    const { data } = await sb().rpc('bn_guest_order', { p_tenant: tenant.id, p_order_id: id });
    const o = (data as Any | null)?.order;
    if (!o) continue;
    docs.push({ coll: 'orders', id, data: o }, ...((data as Any).payments ?? []).map((p: Any) => ({ coll: 'payments', id: p.id, data: p })));
    if (DONE.includes(o.status) && Date.now() - (o.paidAt ?? o.createdAt) > 3 * 3600e3) tracked = tracked.filter(x => x !== id);
  }
  ls.set(key('orders'), tracked);
  applyRemote(docs);
}
function enterAnon() { mode = 'anon'; tenant = null; member = null; base = shapeDB(); queue = []; compose(); }

async function guestSlug(): Promise<string | null> {
  if (typeof location === 'undefined') return null;
  const { resolve, config } = await import('../system/hosts.ts');
  const r = resolve(location.host, location.pathname, config()); // <slug>.bornis.id also serves the business's staff pages
  const internal = r.type === 'rewrite' ? r.path : location.pathname;
  if (!/^\/(order|kiosk)(\/|$)/.test(internal)) return null;
  return (r.type === 'rewrite' ? r.query.tenant : '') || config().tenant || null;
}
/** BN050: the business moved to its own database while this device was open: the server routes to it now, so reload. */
async function moved() {
  if (!tenant) return;
  toast(humanError('BN050').text);
  remoteRestart();
}
const offline = () => typeof navigator !== 'undefined' && navigator.onLine === false;
/** The account's business, remembered on this device: a register reloaded without internet still opens its own data and queue. */
async function memberOf(): Promise<Membership | null> {
  const k = 'borniz-member:' + userId, saved = ls.get<Membership | null>(k, null);
  if (offline() && saved) return saved;
  try { const m = await (await lib()).membership(); ls.set(k, m); return m; }
  catch (e) { if (saved && retryable(e as Any)) return saved; throw e; }
}
async function enter() {
  try {
    admin = userId ? await (await lib()).isPlatformAdmin().catch(() => false) : false;
    const m = userId ? await memberOf() : null;
    if (m) return await enterMember(m);
    if (await guestSlug().then(s => s ? enterGuest(s) : false)) return;
  } catch (e) { toast(humanError((e as Error)?.message ?? String(e)).text); }
  enterAnon();
}
async function enterFor() { const u = userId; await enter(); enteredFor = u; }
function stop() {
  channel?.unsubscribe(); channel = null; timers.forEach(clearInterval); timers = [];
  admin = false; lastRemote.clear(); hint = {}; audit = []; tracked = []; inbox = []; base = db = null; tenant = null; member = null; mode = 'boot'; enteredFor = undefined;
}
/** Signed in or out, or switched business: reload everything for the new account. */
let chain: Promise<void> = Promise.resolve();
export function remoteRestart() { return chain = chain.then(() => { stop(); emit(); return enterFor(); }).catch(() => {}); }
async function boot() {
  const { sb } = await lib();
  // Offline with an expired token the session can't refresh: still the same person on this device until they sign out.
  userId = (await sb().auth.getSession()).data.session?.user.id ?? (offline() ? ls.get<string | null>('borniz-uid', null) : null);
  ls.set('borniz-uid', userId);
  sb().auth.onAuthStateChange((e, s) => { const u = s?.user.id ?? (e !== 'SIGNED_OUT' && offline() ? userId : null); if (u !== userId) { userId = u; ls.set('borniz-uid', u); setTimeout(remoteRestart, 0); } });
  addEventListener('online', () => { flush(); if (mode === 'member') resync(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) flush(); });
  await (chain = chain.then(enterFor));
}

export function remoteGet(): DB | null { if (!started && typeof window !== 'undefined') { started = true; boot(); } return db; }
export const remoteSnapshot = (): DB => remoteGet() ?? shapeDB();
export const remoteSubscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
/** Remote documents just merged (realtime or guest poll): the settlement finalizer listens here. */
export const onDocs = (f: (docs: Doc[]) => void) => { docSubs.add(f); return () => { docSubs.delete(f); }; };
/** Resolves once the store has loaded for this account (after sign-in / sign-out the auth listener reloads it). */
export async function remoteReady(user: string | null) {
  remoteGet();
  for (let i = 0; i < 600 && !(enteredFor === user && mode !== 'boot'); i++) await new Promise(r => setTimeout(r, 100));
  return remoteInfo();
}
/** Resolves once no pending write still carries this document (sent, or refused): a server route that reads it, such
 *  as the gateway charge reading its payment, must not run before the row is there. */
export const remoteSent = (coll: string, id: string, ms = 30e3) => new Promise<void>(ok => {
  const end = Date.now() + ms, check = () => (!queue.some(p => !p.local && p.ops.some(o => o.coll === coll && o.id === id)) || Date.now() > end ? ok() : setTimeout(check, 100));
  check();
});
export const remoteInfo = () => ({ mode, tenant, member, admin, pending: queue.filter(p => !p.local).length });
