// Forecasts over the live store. Pure functions of (db, outlet, now); sales numbers come from the one sales math
// (screens/insight/metrics.ts). Money is integer rupiah.
// Sales: per weekday, the mean of that weekday over the last `weeks` weeks × a trend factor (last 14 days vs the
// 14 before, clamped), with a low/high band of ± that weekday's standard deviation.
// Stock: days left = level on hand ÷ average daily use over the last 14 days.
import type { DB } from '../data/schema.ts';
import { DAY, dayBuckets, series, soldOrders, startOfDay } from '../screens/insight/metrics.ts';
import { levels } from './stock.ts';

export const FORECAST = {
  /** weeks of history per weekday mean */ weeks: 8,
  /** trend compares the last `trendDays` with the `trendDays` before; each side needs `trendMin` days of data */ trendDays: 14, trendMin: 7,
  trendLow: 0.8, trendHigh: 1.2,
  /** stock use is averaged over this many completed days */ usageDays: 14,
  /** supplier lead time when no purchase order says otherwise */ leadDays: 2,
} as const;

export interface DayForecast { from: number; value: number; low: number; high: number }
export interface SalesForecast { outletId: string; days: DayForecast[]; trend: number; samples: number; total: number; low: number; high: number }

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs: number[]) => { if (xs.length < 2) return 0; const m = mean(xs); return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1)); };
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const known = (xs: (number | null)[]) => xs.filter((x): x is number => x != null);

/** Start of the first day an outlet has orders; null when it has none (days before it are "no data", not zero). */
export function salesStart(db: DB, outletId: string): number | null {
  let t = Infinity;
  for (const o of db.orders) if (o.outletId === outletId && o.createdAt < t) t = o.createdAt;
  return t === Infinity ? null : startOfDay(t);
}

/** Completed days before today: revenue (or orders) per day, null before the outlet's history starts. */
export function dailyActuals(db: DB, outletId: string, days: number, now = Date.now(), metric: 'revenue' | 'orders' = 'revenue') {
  const bs = dayBuckets(days, startOfDay(now) - DAY), since = salesStart(db, outletId);
  return { buckets: bs, values: since == null ? bs.map(() => null) : series(db, outletId, bs, metric, now, since) };
}

/** Daily forecast for `horizon` days starting today. */
export function salesForecast(db: DB, outletId: string, horizon: number, now = Date.now(), metric: 'revenue' | 'orders' = 'revenue'): SalesForecast {
  const n = FORECAST.weeks * 7, T = FORECAST.trendDays;
  const { buckets, values } = dailyActuals(db, outletId, Math.max(n, 2 * T), now, metric);
  const byWeekday = Array.from({ length: 7 }, () => [] as number[]);
  values.slice(-n).forEach((v, i) => { if (v != null) byWeekday[new Date(buckets[buckets.length - n + i].from).getDay()].push(v); });
  const all = byWeekday.flat(), last = known(values.slice(-T)), prior = known(values.slice(-2 * T, -T));
  const trend = last.length >= FORECAST.trendMin && prior.length >= FORECAST.trendMin && mean(prior) > 0 ? clamp(mean(last) / mean(prior), FORECAST.trendLow, FORECAST.trendHigh) : 1;
  const t0 = startOfDay(now);
  const days = Array.from({ length: horizon }, (_, i): DayForecast => {
    const from = t0 + i * DAY, own = byWeekday[new Date(from).getDay()], xs = own.length ? own : all; // a weekday never seen yet borrows every day
    if (!xs.length) return { from, value: 0, low: 0, high: 0 };
    const m = mean(xs), d = sd(xs);
    return { from, value: Math.round(m * trend), low: Math.max(0, Math.round((m - d) * trend)), high: Math.round((m + d) * trend) };
  });
  const sum = (k: 'value' | 'low' | 'high') => days.reduce((a, d) => a + d[k], 0);
  return { outletId, days, trend, samples: all.length, total: sum('value'), low: sum('low'), high: sum('high') };
}

export interface Runway {
  outletId: string; stockItemId: string; name: string; unit: string; level: number; perDay: number;
  /** null when nothing was used in the window */ daysLeft: number | null;
  leadDays: number; leadFrom: LeadFrom; supplierId: string | null; onOrder: number; value: number; historyDays: number;
}
/** supplier: this item's supplier's POs · all-pos: average of every PO · default: no PO yet */
export type LeadFrom = 'supplier' | 'all-pos' | 'default';
export const LEAD_NOTE: Record<LeadFrom, string> = { supplier: 'from the supplier’s POs', 'all-pos': 'average of your POs', default: 'assumed, no PO yet' };
const OPEN_PO = new Set(['draft', 'waiting', 'sent', 'partial']);

/** Supplier lead time for an item: the average promised delivery (due − ordered) of the supplier's POs that last
 *  delivered this item (this outlet first), else of all POs, else FORECAST.leadDays. */
export function leadTime(db: DB, stockItemId: string, outletId: string): { days: number; from: LeadFrom; supplierId: string | null } {
  const pos = db.pos.filter(p => p.status !== 'cancelled'), lead = (ps: DB['pos']) => Math.max(1, Math.ceil(mean(ps.map(p => (p.due - p.at) / DAY))));
  const withItem = pos.filter(p => p.lines.some(l => l.stockItemId === stockItemId)).sort((a, b) => b.at - a.at);
  const last = withItem.find(p => p.outletId === outletId) ?? withItem[0];
  if (last) return { days: lead(pos.filter(p => p.supplierId === last.supplierId)), from: 'supplier', supplierId: last.supplierId };
  return pos.length ? { days: lead(pos), from: 'all-pos', supplierId: null } : { days: FORECAST.leadDays, from: 'default', supplierId: null };
}

/** Days of stock left per item at one outlet. Use = stock moved out by sales and waste (net of refunds back to stock),
 *  plus the recipe use of sold orders that never posted stock (history imported without movements). */
export function stockRunway(db: DB, outletId: string, now = Date.now()): Runway[] {
  const t0 = startOfDay(now), since = salesStart(db, outletId) ?? t0;
  const historyDays = Math.round((t0 - since) / DAY), days = clamp(historyDays, 1, FORECAST.usageDays);
  const r = { from: t0 - days * DAY, to: t0 }, used = new Map<string, number>(), posted = new Set<string>();
  const add = (id: string, q: number) => used.set(id, (used.get(id) ?? 0) + q);
  for (const m of db.movements) {
    if (m.outletId !== outletId || m.at < r.from || m.at >= r.to) continue;
    if (m.type === 'sale' || m.type === 'waste' || m.type === 'refund_return') add(m.stockItemId, -m.qty);
    if (m.type === 'sale' && m.sourceId) posted.add(m.sourceId);
  }
  const recipe = new Map<string, DB['recipes']>();
  for (const x of db.recipes) recipe.set(x.productId, [...(recipe.get(x.productId) ?? []), x]);
  for (const o of soldOrders(db, outletId, r)) if (!posted.has(o.id)) for (const l of o.lines) for (const x of recipe.get(l.productId) ?? []) add(x.stockItemId, x.qty * l.qty);
  const lv = levels(db.movements, outletId);
  return db.stockItems.map(s => {
    const level = Math.max(0, Math.round((lv.get(s.id) ?? 0) * 1000) / 1000), perDay = Math.max(0, (used.get(s.id) ?? 0) / days), lead = leadTime(db, s.id, outletId);
    const onOrder = db.pos.filter(p => p.outletId === outletId && OPEN_PO.has(p.status)).reduce((a, p) => a + p.lines.filter(l => l.stockItemId === s.id).reduce((b, l) => b + Math.max(0, l.qty - l.received), 0), 0);
    return { outletId, stockItemId: s.id, name: s.name, unit: s.unit, level, perDay, daysLeft: perDay > 0 ? level / perDay : null,
      leadDays: lead.days, leadFrom: lead.from, supplierId: lead.supplierId, onOrder, value: Math.round(level * s.unitCost), historyDays };
  });
}
