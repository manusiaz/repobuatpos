// Recommendations engine: deterministic rules over the live store, each one an action with the numbers behind it and
// the page where it is done. Pure function of (db, outlets in scope, now). Sales math comes from metrics.ts, forecasts
// from forecast.ts; thresholds live in RULES so the page can say how each one is worked out.
import type { DB } from '../data/schema.ts';
import { DAY, WEEK, byHour, soldOrders, soldAt, startOfDay, topProducts } from '../screens/insight/metrics.ts';
import { SHIFTS } from './shift.ts';
import { idr } from './money.ts';
import { FORECAST, LEAD_NOTE, dailyActuals, salesForecast, salesStart, stockRunway, type Runway } from './forecast.ts';

export type Severity = 'high' | 'medium' | 'low';
export type Kind = 'reorder' | 'staffing' | 'outlet-forecast' | 'outlet-network' | 'margin' | 'customers' | 'slow-hours' | 'dead-menu' | 'dead-stock';
export interface Recommendation { id: string; kind: Kind; severity: Severity; outletId: string | null; title: string; why: string; action: string; href: string }

export const RULES = {
  /** reorder when stock (with what is already on order) lasts no longer than the lead time + this many days */ reorderBuffer: 1, reorderCoverDays: 7,
  /** an hour is slow under this share of the week's average opening hour, in every week with data of the last `slowWeeks` */ slowShare: 0.5, slowWeeks: 3, slowMinWeeks: 2, slowWeekDays: 4,
  /** top sellers by revenue over `marginDays` whose cost exceeds `cogsRatio` of sales */ topN: 10, marginDays: 28, cogsRatio: 0.35,
  /** menu items / stock with no sale or use for this many days (outlet needs that much history) */ deadDays: 14,
  /** last 7 days under this share of the forecast made 7 days ago */ underForecast: 0.85,
  /** last 7 days under this share of the average outlet in scope */ underNetwork: 0.7,
  /** forecast orders in the busiest hour per rostered person */ ordersPerStaffHour: 12,
  /** members away longer than gapX × their usual gap and at least riskMinDays; usual gap needs riskMinVisits visit days */ riskGapX: 2, riskMinDays: 7, riskMinVisits: 3,
} as const;

/** Runs out before a delivery ordered today could arrive (lead time + buffer), counting what is already on order. */
export const needsReorder = (r: Runway) => r.daysLeft != null && (r.level + r.onOrder) / r.perDay <= r.leadDays + RULES.reorderBuffer;

export const KIND_LABEL: Record<Kind, string> = { reorder: 'Reorder', staffing: 'Staffing', 'outlet-forecast': 'Below forecast', 'outlet-network': 'Outlet vs others', margin: 'Margin', customers: 'Customers at risk', 'slow-hours': 'Slow hours', 'dead-menu': 'Not selling', 'dead-stock': 'Dead stock' };
const ORDER: Kind[] = ['reorder', 'staffing', 'outlet-forecast', 'outlet-network', 'margin', 'customers', 'slow-hours', 'dead-menu', 'dead-stock'];
const RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

const hm = (s: string) => { const [h, m] = s.split(':').map(Number); return h + (m || 0) / 60; };
const hh = (h: number) => String(h).padStart(2, '0') + ':00';
const qty = (x: number) => (Math.round(x * 100) / 100).toLocaleString('en-US');
const d1 = (x: number) => (Math.round(x * 10) / 10).toLocaleString('en-US');
const pctOf = (a: number, b: number) => Math.round((a / b) * 100) + '%';
const list = (xs: string[], n = 3) => xs.slice(0, n).join(', ') + (xs.length > n ? ` and ${xs.length - n} more` : '');
const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function recommend(db: DB, outletIds: string[], now = Date.now()): Recommendation[] {
  const t0 = startOfDay(now), scope = db.outlets.filter(o => outletIds.includes(o.id)), one = scope.length === 1 ? scope[0].id : null;
  const out: Recommendation[] = [];
  const push = (r: Recommendation) => out.push(r);
  const historyDays = (o: string) => { const s = salesStart(db, o); return s == null ? 0 : Math.round((t0 - s) / DAY); };

  for (const o of scope) {
    // ── reorder: runs out before a delivery ordered today could arrive ──
    for (const r of stockRunway(db, o.id, now)) {
      if (r.daysLeft == null || !needsReorder(r)) continue;
      const need = Math.max(0, r.perDay * (r.leadDays + RULES.reorderCoverDays) - r.level - r.onOrder), suggest = r.unit === 'pcs' ? Math.ceil(need) : Math.ceil(need * 10) / 10;
      push({ id: `reorder:${o.id}:${r.stockItemId}`, kind: 'reorder', severity: r.daysLeft <= r.leadDays ? 'high' : 'medium', outletId: o.id,
        title: `${r.name} at ${o.name} runs out in ${d1(r.daysLeft)} days`,
        why: `${qty(r.level)} ${r.unit} on hand, using ${qty(r.perDay)} ${r.unit}/day · lead time ${r.leadDays} days (${LEAD_NOTE[r.leadFrom]}) · order about ${qty(suggest)} ${r.unit} for ${RULES.reorderCoverDays} days of cover`,
        action: 'Create PO', href: '/owner/inventory/purchase-orders' });
    }

    // ── staffing: forecast orders in the busiest hour vs people rostered then (next 7 days) ──
    const roster = db.roster.filter(x => x.outletId === o.id);
    if (roster.length) {
      const share = byHour(db, o.id, { from: t0 - 28 * DAY, to: t0 }, 'orders'), total = share.reduce((a, b) => a + b, 0);
      const f = salesForecast(db, o.id, 7, now, 'orders');
      let worst: { from: number; h: number; orders: number; staff: number; ratio: number } | null = null;
      if (total > 0) for (const d of f.days) {
        const day = roster.find(x => x.day === (new Date(d.from).getDay() + 6) % 7); if (!day) continue;
        for (let h = Math.floor(hm(o.opens)); h < Math.ceil(hm(o.closes)); h++) {
          const orders = (d.value * share[h]) / total; if (orders < 1) continue;
          const people = new Set<string>();
          for (const [slot, [, a, b]] of Object.entries(SHIFTS) as [keyof typeof SHIFTS, readonly [string, string, string]][]) if (h >= hm(a) && h < hm(b)) { const s = day.slots[slot]; if (s.pic) people.add(s.pic); s.crew.forEach(c => people.add(c)); }
          const ratio = people.size ? orders / people.size : Infinity;
          if (!worst || ratio > worst.ratio) worst = { from: d.from, h, orders, staff: people.size, ratio };
        }
      }
      if (worst && worst.ratio > RULES.ordersPerStaffHour) push({ id: `staffing:${o.id}`, kind: 'staffing', severity: worst.staff === 0 ? 'high' : 'medium', outletId: o.id,
        title: worst.staff === 0 ? `Nobody rostered at ${o.name} ${WEEKDAY[new Date(worst.from).getDay()]} ${hh(worst.h)}` : `${o.name} short-staffed ${WEEKDAY[new Date(worst.from).getDay()]} ${hh(worst.h)}`,
        why: `Forecast ${Math.round(worst.orders)} orders that hour for ${worst.staff} ${worst.staff === 1 ? 'person' : 'people'} rostered · limit ${RULES.ordersPerStaffHour} orders per person per hour`,
        action: 'Adjust roster', href: '/owner/team/shifts-and-schedules' });
    }

    // ── outlet below the forecast made a week ago ──
    const back = salesForecast(db, o.id, 7, t0 - 7 * DAY), actual = dailyActuals(db, o.id, 7, now).values.reduce<number>((a, v) => a + (v ?? 0), 0);
    if (back.samples >= 7 && back.total > 0 && actual < RULES.underForecast * back.total)
      push({ id: `outlet-forecast:${o.id}`, kind: 'outlet-forecast', severity: 'medium', outletId: o.id, title: `${o.name} is ${pctOf(back.total - actual, back.total)} below forecast`,
        why: `Last 7 days ${idr(actual)} vs ${idr(back.total)} forecast (range ${idr(back.low)}–${idr(back.high)}) · alert under ${Math.round(RULES.underForecast * 100)}%`,
        action: 'Look at outlet', href: `/owner/outlets/outlet-detail?id=${o.id}` });

    // ── slow hours: under half the week's average opening hour, every week with data ──
    const open = Array.from({ length: 24 }, (_, h) => h).filter(h => h >= Math.floor(hm(o.opens)) && h < Math.ceil(hm(o.closes)));
    const weeks = Array.from({ length: RULES.slowWeeks }, (_, k) => ({ from: t0 - (k + 1) * WEEK, to: t0 - k * WEEK }))
      .filter(w => new Set(soldOrders(db, o.id, w).map(x => startOfDay(soldAt(x)))).size >= RULES.slowWeekDays);
    if (weeks.length >= RULES.slowMinWeeks && open.length) {
      const per = weeks.map(w => byHour(db, o.id, w)), avg = per.map(hs => open.reduce((a, h) => a + hs[h], 0) / open.length);
      const slow = open.filter(h => per.every((hs, i) => hs[h] < RULES.slowShare * avg[i]));
      const ranges: [number, number][] = [];
      for (const h of slow) { const last = ranges[ranges.length - 1]; if (last && last[1] === h) last[1] = h + 1; else ranges.push([h, h + 1]); }
      if (ranges.length) {
        const inSlow = Math.round(per.reduce((a, hs) => a + slow.reduce((b, h) => b + hs[h], 0), 0) / (weeks.length * slow.length)), base = Math.round(avg.reduce((a, b) => a + b, 0) / avg.length);
        push({ id: `slow-hours:${o.id}`, kind: 'slow-hours', severity: 'low', outletId: o.id, title: `Slow hours at ${o.name}: ${ranges.map(([a, b]) => `${hh(a)}–${hh(b)}`).join(', ')}`,
          why: `${idr(inSlow)} per week in each slow hour vs ${idr(base)} for an average opening hour · under ${Math.round(RULES.slowShare * 100)}% in each of the last ${weeks.length} weeks`,
          action: 'Plan a happy hour', href: '/owner/promo/promo-form' });
      }
    }

    // ── dead menu items and dead stock (outlet needs `deadDays` of history) ──
    if (historyDays(o.id) >= RULES.deadDays) {
      const sold = new Set(soldOrders(db, o.id, { from: t0 - RULES.deadDays * DAY, to: now }).flatMap(x => x.lines.map(l => l.productId)));
      const dead = db.outletProducts.filter(x => x.outletId === o.id && !x.hidden && !x.is86 && !sold.has(x.productId)).map(x => db.products.find(p => p.id === x.productId)).filter(p => p?.status === 'live').map(p => p!.name);
      if (dead.length) push({ id: `dead-menu:${o.id}`, kind: 'dead-menu', severity: 'low', outletId: o.id, title: `${dead.length} menu item${dead.length > 1 ? 's' : ''} not sold at ${o.name} in ${RULES.deadDays} days`,
        why: `${list(dead)} · on the menu but no sale since ${new Date(t0 - RULES.deadDays * DAY).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`, action: 'Hide or promote', href: '/owner/catalog/products-and-menu' });
      const idle = stockRunway(db, o.id, now).filter(r => r.level > 0 && r.perDay === 0 && r.value > 0).sort((a, b) => b.value - a.value);
      if (idle.length) push({ id: `dead-stock:${o.id}`, kind: 'dead-stock', severity: 'low', outletId: o.id, title: `${idr(idle.reduce((a, r) => a + r.value, 0))} of stock unused at ${o.name}`,
        why: `${list(idle.map(r => `${r.name} ${qty(r.level)} ${r.unit}`))} · not used in ${FORECAST.usageDays} days`, action: 'Transfer or use up', href: '/owner/inventory/stock-transfer-between-outlets' });
    }
  }

  // ── outlet vs the other outlets in scope (last 7 days) ──
  if (scope.length >= 2) {
    const rev = scope.map(o => ({ o, v: dailyActuals(db, o.id, 7, now).values.reduce<number>((a, x) => a + (x ?? 0), 0) })), avg = rev.reduce((a, x) => a + x.v, 0) / rev.length;
    for (const { o, v } of rev) if (avg > 0 && historyDays(o.id) >= 7 && v < RULES.underNetwork * avg)
      push({ id: `outlet-network:${o.id}`, kind: 'outlet-network', severity: 'medium', outletId: o.id, title: `${o.name} at ${pctOf(v, avg)} of the average outlet`,
        why: `Last 7 days ${idr(v)} vs ${idr(Math.round(avg))} average across ${scope.length} outlets · alert under ${Math.round(RULES.underNetwork * 100)}%`,
        action: 'Compare outlets', href: '/owner/outlets/outlet-comparison' });
  }

  // ── top sellers with high cost of goods ──
  const m = new Map<string, { name: string; qty: number; revenue: number; cogs: number }>(), mr = { from: t0 - RULES.marginDays * DAY, to: t0 };
  for (const o of scope) for (const x of topProducts(db, o.id, mr, 1000)) { const y = m.get(x.productId) ?? { name: db.products.find(p => p.id === x.productId)?.name ?? x.name, qty: 0, revenue: 0, cogs: 0 }; y.qty += x.qty; y.revenue += x.revenue; y.cogs += x.cogs; m.set(x.productId, y); }
  [...m].sort((a, b) => b[1].revenue - a[1].revenue || a[0].localeCompare(b[0])).slice(0, RULES.topN).forEach(([id, x], i) => {
    if (!x.revenue || x.cogs / x.revenue <= RULES.cogsRatio) return;
    push({ id: `margin:${id}`, kind: 'margin', severity: 'medium', outletId: one, title: `${x.name}: ${pctOf(x.cogs, x.revenue)} cost of goods`,
      why: `#${i + 1} by sales · ${x.qty.toLocaleString('en-US')} sold for ${idr(x.revenue)} in ${RULES.marginDays} days · cost ${idr(x.cogs)} · target ${Math.round(RULES.cogsRatio * 100)}% or less`,
      action: 'Review price & recipe', href: '/owner/catalog/recipes-and-cogs' });
  });

  // ── members overdue against their own visit rhythm ──
  const visits = new Map<string, Set<number>>();
  for (const o of soldOrders(db, 'all', { from: 0, to: now })) if (o.customerId && outletIds.includes(o.outletId)) visits.set(o.customerId, (visits.get(o.customerId) ?? new Set()).add(startOfDay(soldAt(o))));
  const risk = db.customers.flatMap(c => {
    const ds = [...(visits.get(c.id) ?? [])].sort((a, b) => a - b); if (ds.length < RULES.riskMinVisits) return [];
    const usual = (ds[ds.length - 1] - ds[0]) / DAY / (ds.length - 1), away = Math.round((t0 - ds[ds.length - 1]) / DAY);
    return away >= RULES.riskMinDays && away > RULES.riskGapX * usual ? [{ c, usual, away }] : [];
  }).sort((a, b) => b.away / b.usual - a.away / a.usual || a.c.id.localeCompare(b.c.id));
  if (risk.length) push({ id: 'customers:' + (one ?? 'all'), kind: 'customers', severity: 'medium', outletId: one, title: `${risk.length} regular${risk.length > 1 ? 's' : ''} overdue for a visit`,
    why: list(risk.map(r => `${r.c.name} usually every ${d1(r.usual)} days, away ${r.away}`)) + ` · over ${RULES.riskGapX}× their usual gap`, action: 'Send a win-back', href: '/owner/messaging-and-automation/automation-win-back' });

  return out.sort((a, b) => RANK[a.severity] - RANK[b.severity] || ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || a.id.localeCompare(b.id));
}
