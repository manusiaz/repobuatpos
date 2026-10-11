// Sales aggregation over the live store. Pure functions of (db, outlet, range) so every insight screen
// (owner, owner mobile, manager, reports) computes the same numbers the same way.
import type { Approval, DB, Order, Refund } from '../../data/schema.ts';
import type { Method, Source } from '../../domain/order.ts';

export const MIN = 60e3, HOUR = 3600e3, DAY = 864e5, WEEK = 7 * DAY;
/** 'all' or an outlet id. */
export type OutletScope = string;
export interface Range { from: number; to: number }
export interface Bucket extends Range { label: string }
export type Period = 'today' | '7d' | '30d' | '12m';
export type Gran = 'hour' | '15m' | 'min';

export const SOURCE_LABEL: Record<Source, string> = { pos: 'Counter', qr: 'QR table', kiosk: 'Kiosk', waiter: 'Waiter', web: 'Web store', gofood: 'GoFood', grabfood: 'GrabFood', shopeefood: 'ShopeeFood' };
export const METHOD_LABEL: Record<Method, string> = { cash: 'Cash', qris: 'QRIS', card: 'Card', ewallet: 'E-wallet', va: 'Virtual account', deposit: 'Deposit', kasbon: 'Kasbon' };

const SOLD = new Set<Order['status']>(['paid', 'part_refunded', 'refunded']);
const OPEN = new Set<Order['status']>(['open', 'held', 'sent', 'preparing', 'ready', 'served', 'paying']);
export const inScope = (x: { outletId: string }, outlet: OutletScope) => outlet === 'all' || x.outletId === outlet;
export const soldAt = (o: Order) => o.paidAt ?? o.createdAt;
const within = (t: number, r: Range) => t >= r.from && t < r.to;
export const startOfDay = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const pad = (n: number) => String(n).padStart(2, '0');

export function soldOrders(db: DB, outlet: OutletScope, r: Range): Order[] {
  return db.orders.filter(o => SOLD.has(o.status) && inScope(o, outlet) && within(soldAt(o), r));
}
export const openOrders = (db: DB, outlet: OutletScope) => db.orders.filter(o => OPEN.has(o.status) && inScope(o, outlet));
/** Open orders waiting longer than `mins` (default 12, the KDS red line). */
export const lateOrders = (db: DB, outlet: OutletScope, now = Date.now(), mins = 12) => openOrders(db, outlet).filter(o => now - o.createdAt > mins * MIN);

const costMap = (db: DB) => new Map(db.products.map(p => [p.id, p.cost]));
const orderCogs = (o: Order, cost: Map<string, number>) => o.lines.reduce((a, l) => a + (cost.get(l.productId) ?? 0) * l.qty, 0);

export interface Summary {
  revenue: number; orders: number; avgTicket: number; net: number; cogs: number;
  /** (net sales − COGS) / net sales, 0..1; null when nothing sold. */
  grossMargin: number | null;
  refunds: number; refundCount: number; voids: number; voidCount: number; discounts: number;
}
export function summary(db: DB, outlet: OutletScope, r: Range): Summary {
  const sold = soldOrders(db, outlet, r), cost = costMap(db);
  const revenue = sold.reduce((a, o) => a + o.total, 0);
  const net = sold.reduce((a, o) => a + o.subtotal - o.discount, 0);
  const cogs = sold.reduce((a, o) => a + orderCogs(o, cost), 0);
  const vr = voidsAndRefunds(db, outlet, r);
  return {
    revenue, orders: sold.length, avgTicket: sold.length ? Math.round(revenue / sold.length) : 0, net, cogs,
    grossMargin: net > 0 ? (net - cogs) / net : null,
    refunds: vr.refunds.reduce((a, x) => a + x.amount, 0), refundCount: vr.refunds.length,
    voids: vr.voids.reduce((a, o) => a + o.total, 0), voidCount: vr.voids.length,
    discounts: sold.reduce((a, o) => a + o.discount, 0),
  };
}

/** Relative change; null when there is no base to compare with. */
export const delta = (cur: number, prev: number) => (prev > 0 ? (cur - prev) / prev : null);
export const pct = (x: number | null, digits = 0) => (x == null ? '—' : (x > 0 ? '+' : x < 0 ? '−' : '') + Math.abs(x * 100).toFixed(digits) + '%');

// ── Buckets ───────────────────────────────────────────────────────────────────────────────
/** Today from 06:00 to midnight per hour or per 15 minutes; or the last 60 minutes per minute. */
export function todayBuckets(gran: Gran, now = Date.now()): Bucket[] {
  if (gran === 'min') {
    const end = Math.floor(now / MIN) * MIN + MIN;
    return Array.from({ length: 60 }, (_, i) => { const from = end - (60 - i) * MIN, d = new Date(from); return { from, to: from + MIN, label: `${pad(d.getHours())}:${pad(d.getMinutes())}` }; });
  }
  const t0 = startOfDay(now) + 6 * HOUR, step = gran === 'hour' ? HOUR : 15 * MIN, n = (18 * HOUR) / step;
  return Array.from({ length: n }, (_, i) => { const from = t0 + i * step, d = new Date(from); return { from, to: from + step, label: `${pad(d.getHours())}:${pad(d.getMinutes())}` }; });
}
export function dayBuckets(days: number, now = Date.now()): Bucket[] {
  const t0 = startOfDay(now);
  return Array.from({ length: days }, (_, i) => { const from = t0 - (days - 1 - i) * DAY; return { from, to: from + DAY, label: new Date(from).toLocaleDateString('en-GB', days <= 7 ? { weekday: 'short' } : { day: 'numeric', month: 'short' }) }; });
}
export function monthBuckets(months: number, now = Date.now()): Bucket[] {
  const d = new Date(now);
  return Array.from({ length: months }, (_, i) => {
    const a = new Date(d.getFullYear(), d.getMonth() - (months - 1 - i), 1), b = new Date(a.getFullYear(), a.getMonth() + 1, 1);
    return { from: a.getTime(), to: b.getTime(), label: a.toLocaleDateString('en-GB', { month: 'short' }) };
  });
}
export const shift = (bs: Bucket[], ms: number): Bucket[] => bs.map(b => ({ ...b, from: b.from + ms, to: b.to + ms }));

/** Revenue (or order count) per bucket. Buckets that haven't started, or lie before `since`, are null (a gap, not a zero). */
export function series(db: DB, outlet: OutletScope, bs: Bucket[], metric: 'revenue' | 'orders' = 'revenue', now = Date.now(), since = -Infinity): (number | null)[] {
  if (!bs.length) return [];
  const out: (number | null)[] = bs.map(b => (b.from > now || b.to <= since ? null : 0));
  const r = { from: bs[0].from, to: bs[bs.length - 1].to };
  for (const o of soldOrders(db, outlet, r)) {
    const t = soldAt(o), i = bs.findIndex(b => within(t, b));
    if (i >= 0 && out[i] != null) out[i] = (out[i] as number) + (metric === 'revenue' ? o.total : 1);
  }
  return out;
}
/** First moment the store has sales history; older periods are shown as "no data", never as zero. */
export const historyStart = (db: DB) => db.orders.reduce((a, o) => Math.min(a, o.createdAt), Date.now());

export interface PeriodSpec { range: Range; compare: Range; buckets: Bucket[]; compareBuckets: Bucket[]; compareLabel: string }
/** Current period and its comparison: same period last week for today and 7 days; the period before for 30 days / 12 months. */
export function period(p: Period, gran: Gran = 'hour', now = Date.now()): PeriodSpec {
  const wk = new Date(now - WEEK).toLocaleDateString('en-GB', { weekday: 'long' });
  if (p === 'today') {
    const bs = todayBuckets(gran, now), from = gran === 'min' ? bs[0].from : startOfDay(now);
    const shiftMs = -WEEK;
    return { range: { from, to: now }, compare: { from: from + shiftMs, to: now + shiftMs }, buckets: bs, compareBuckets: shift(bs, shiftMs), compareLabel: gran === 'min' ? `Same minutes last ${wk}` : `Last ${wk}` };
  }
  if (p === '7d') { const bs = dayBuckets(7, now); return { range: { from: bs[0].from, to: now }, compare: { from: bs[0].from - WEEK, to: now - WEEK }, buckets: bs, compareBuckets: shift(bs, -WEEK), compareLabel: 'Previous 7 days' }; }
  if (p === '30d') { const bs = dayBuckets(30, now); return { range: { from: bs[0].from, to: now }, compare: { from: bs[0].from - 30 * DAY, to: now - 30 * DAY }, buckets: bs, compareBuckets: shift(bs, -30 * DAY), compareLabel: 'Previous 30 days' }; }
  const bs = monthBuckets(12, now), prev = bs.map(b => { const a = new Date(b.from), c = new Date(b.to); a.setFullYear(a.getFullYear() - 1); c.setFullYear(c.getFullYear() - 1); return { ...b, from: a.getTime(), to: c.getTime() }; });
  return { range: { from: bs[0].from, to: now }, compare: { from: prev[0].from, to: prev[prev.length - 1].to }, buckets: bs, compareBuckets: prev, compareLabel: 'Same months last year' };
}

// ── Breakdowns ────────────────────────────────────────────────────────────────────────────
export function byOutlet(db: DB, r: Range) {
  return db.outlets.map(o => { const s = soldOrders(db, o.id, r); return { outletId: o.id, name: o.name, revenue: s.reduce((a, x) => a + x.total, 0), orders: s.length }; });
}
export function byChannel(db: DB, outlet: OutletScope, r: Range) {
  const m = new Map<Source, { source: Source; revenue: number; orders: number }>();
  for (const o of soldOrders(db, outlet, r)) { const x = m.get(o.source) ?? { source: o.source, revenue: 0, orders: 0 }; x.revenue += o.total; x.orders++; m.set(o.source, x); }
  return [...m.values()].sort((a, b) => b.revenue - a.revenue);
}
export function byMethod(db: DB, outlet: OutletScope, r: Range) {
  const m = new Map<Method, { method: Method; amount: number; count: number }>();
  for (const p of db.payments) {
    if (p.status !== 'settled' || !inScope(p, outlet) || !within(p.at, r)) continue;
    const x = m.get(p.method) ?? { method: p.method, amount: 0, count: 0 }; x.amount += p.amount; x.count++; m.set(p.method, x);
  }
  return [...m.values()].sort((a, b) => b.amount - a.amount);
}
export function topProducts(db: DB, outlet: OutletScope, r: Range, n = 5) {
  const cost = costMap(db), m = new Map<string, { productId: string; name: string; qty: number; revenue: number; cogs: number }>();
  for (const o of soldOrders(db, outlet, r)) for (const l of o.lines) {
    const x = m.get(l.productId) ?? { productId: l.productId, name: l.name, qty: 0, revenue: 0, cogs: 0 };
    x.qty += l.qty; x.revenue += (l.flashPrice ?? l.unitPrice) * l.qty; x.cogs += (cost.get(l.productId) ?? 0) * l.qty; m.set(l.productId, x);
  }
  return [...m.values()].sort((a, b) => b.qty - a.qty).slice(0, n);
}
export function voidsAndRefunds(db: DB, outlet: OutletScope, r: Range): { voids: Order[]; refunds: Refund[]; pending: Approval[] } {
  const orderOutlet = new Map(db.orders.map(o => [o.id, o.outletId]));
  return {
    voids: db.orders.filter(o => o.status === 'voided' && inScope(o, outlet) && within(o.createdAt, r)),
    refunds: db.refunds.filter(x => within(x.at, r) && (outlet === 'all' || orderOutlet.get(x.orderId) === outlet)),
    pending: db.approvals.filter(a => a.status === 'waiting' && (a.type === 'void' || a.type === 'refund') && inScope(a, outlet)),
  };
}
