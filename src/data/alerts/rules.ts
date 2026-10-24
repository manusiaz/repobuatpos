// One rule per catalog alert (src/system/alerts.json). A rule reads the store and returns fires; the sweep (index.ts)
// turns them into notices / guest messages once, keyed by a deterministic id. Rules never write.
import type { Audit, Customer, DB, Order, Rec } from '../schema.ts';
import { DAY, HOUR, MIN, WEEK, soldOrders, startOfDay, summary } from '../../screens/insight/metrics.ts';
import { levels } from '../../domain/stock.ts';
import { TIERS, balance, tierOf } from '../../domain/loyalty.ts';
import { SHIFTS } from '../../domain/shift.ts';
import { idr } from '../../domain/money.ts';
import { HOLD_DAYS, REMIND_DAYS, billingStage, unpaidSince } from '../billing.ts';
import { ACCEPT_WINDOW_MS, CHANNELS, channelState, fireAt, isScheduled } from '../actions/online.ts';

export type Level = 'info' | 'warn' | 'high';
export interface Fire { key: string; outletId: string | null; text: string; href?: string; level?: Level; msg?: { template: string; to: string; customerId: string | null; orderId?: string } }
export interface Rule { alert: string; source: 'state' | 'event' | 'external'; href: string; check: (db: DB, now: number, ix: Ix) => Fire[] }
type Slot = keyof typeof SHIFTS;

/** Events older than this are not read (the audit log is capped anyway); repeats are dropped by id. */
export const EVENT_WINDOW = 6 * HOUR;
const SLOTS = Object.keys(SHIFTS) as Slot[];
const OPEN = new Set<Order['status']>(['open', 'held', 'sent', 'preparing', 'ready', 'served', 'paying']);
const PLATFORM = new Set(['gofood', 'grabfood', 'shopeefood']);
const GUEST_SRC = new Set(['qr', 'kiosk', 'web']);
const hm = (s: string) => { const [h, m] = s.split(':').map(Number); return h * HOUR + (m || 0) * MIN; };
const pad = (n: number) => String(n).padStart(2, '0');
export const ymd = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const hhmm = (t: number) => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const ym = (t: number) => ymd(t).slice(0, 7);
/** Dates as the back-office forms write them: ms, ISO, "14 Oct", "14 Oct 2026", "Oct 2026". */
export function when(s: string | number | undefined, now: number): number {
  if (s == null || s === '') return NaN;
  if (typeof s === 'number' || /^\d{10,}$/.test(String(s))) return Number(s);
  const t = String(s).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return new Date(t.length === 10 ? t + 'T00:00' : t).getTime();
  if (/^\d{1,2} [A-Za-z]{3,}$/.test(t)) return Date.parse(`${t} ${new Date(now).getFullYear()}`);
  if (/^[A-Za-z]{3,} \d{4}$/.test(t)) return Date.parse(`1 ${t}`);
  return Date.parse(t);
}
const phoneIn = (s: string) => s.match(/(\+?62|0)8[\d\s-]{7,}\d/)?.[0] ?? '';
const num = (s: unknown) => Number(String(s ?? '').replace(/[^\d.-]/g, ''));
const has = (re: RegExp, ...s: (string | undefined)[]) => s.some(x => x && re.test(x));

/** Per-sweep indexes: built once, shared by every rule (the sweep runs every 60 s on every open device). */
export interface Ix {
  t0: number; rday: number; date: string;
  outletId: (idOrName: string) => string | null; name: (outletId: string | null) => string;
  opens: (o: string) => number; closes: (o: string) => number; open: (o: string, at?: number) => boolean;
  events: Audit[]; rec: (k: string) => Rec[];
  lv: (o: string) => Map<string, number>; cust: Map<string, Customer>; emp: (id: string) => string;
  byCustomer: () => Map<string, Order[]>; clockIn: (empId: string, outletId: string, since: number) => boolean;
  roster: (o: string) => DB['roster'][0] | undefined; slotWin: (o: string, s: Slot) => [number, number] | null;
}
export function index(db: DB, now: number): Ix {
  const t0 = startOfDay(now), memo = new Map<string, unknown>();
  const once = <T,>(k: string, f: () => T): T => { if (!memo.has(k)) memo.set(k, f()); return memo.get(k) as T; };
  const out = new Map(db.outlets.map(o => [o.id, o])), byName = new Map(db.outlets.map(o => [(o.name ?? '').toLowerCase(), o.id]));
  const opens = (o: string) => t0 + hm(out.get(o)?.opens ?? '00:00'), closes = (o: string) => t0 + hm(out.get(o)?.closes ?? '24:00');
  const rday = (new Date(now).getDay() + 6) % 7;
  const ins = once('clock', () => { const m = new Map<string, number[]>(); for (const c of db.clock) if (c.kind === 'in') { const k = c.employeeId + '|' + c.outletId; m.set(k, [...(m.get(k) ?? []), c.at]); } return m; });
  return {
    t0, rday, date: ymd(now),
    outletId: s => out.has(s) ? s : byName.get(String(s).toLowerCase()) ?? null,
    name: o => (o && out.get(o)?.name) || 'all outlets',
    opens, closes, open: (o, at = now) => at >= opens(o) && at < closes(o),
    events: db.audit.filter(a => a.at > now - EVENT_WINDOW && a.at <= now),
    rec: k => db.records[k] ?? [],
    lv: o => once('lv' + o, () => levels(db.movements, o)),
    cust: new Map(db.customers.map(c => [c.id, c])),
    emp: id => db.employees.find(e => e.id === id)?.name ?? id,
    byCustomer: () => once('bc', () => { const m = new Map<string, Order[]>(); for (const o of db.orders) if (o.customerId && o.paidAt) m.set(o.customerId, [...(m.get(o.customerId) ?? []), o]); return m; }),
    clockIn: (e, o, since) => (ins.get(e + '|' + o) ?? []).some(t => t >= since && t <= now),
    roster: o => db.roster.find(r => r.outletId === o && r.day === rday),
    slotWin: (o, s) => { const a = Math.max(t0 + hm(SHIFTS[s][1]), opens(o)), b = Math.min(t0 + hm(SHIFTS[s][2]), closes(o)); return a < b ? [a, b] : null; },
  };
}

const R = (alert: string, source: Rule['source'], href: string, check: Rule['check']): Rule => ({ alert, source, href, check });
const guest = (c: Customer | undefined, template: string, orderId?: string): Fire['msg'] | undefined => c?.phone ? { template, to: c.phone, customerId: c.id, orderId } : undefined;
const hasMsg = (db: DB, template: string, f: (m: DB['messages'][0]) => boolean) => db.messages.some(m => m.template === template && f(m));
const onRoster = (r: DB['roster'][0], s: Slot) => [r.slots[s].pic, ...r.slots[s].crew].filter(Boolean);
/** Hours worked this week per employee from clock in/out pairs (an open shift counts until now, max 16 h). */
function weekHours(db: DB, now: number) {
  const from = startOfDay(now) - ((new Date(now).getDay() + 6) % 7) * DAY, m = new Map<string, number>(), open = new Map<string, number>();
  for (const c of [...db.clock].sort((a, b) => a.at - b.at)) {
    if (c.at < from || c.at > now) continue;
    if (c.kind === 'in') open.set(c.employeeId, c.at);
    else if (c.kind === 'out' && open.has(c.employeeId)) { m.set(c.employeeId, (m.get(c.employeeId) ?? 0) + c.at - open.get(c.employeeId)!); open.delete(c.employeeId); }
  }
  open.forEach((at, e) => m.set(e, (m.get(e) ?? 0) + Math.min(now - at, 16 * HOUR)));
  return { from, hours: m };
}
const targetFor = (db: DB, o: string, t0: number) => {
  const set = Number(db.settings[`/owner/outlets/targets-and-kpis:daily-target-${o}`]);
  return set > 0 ? set : Math.round(soldOrders(db, o, { from: t0 - 7 * DAY, to: t0 }).reduce((a, x) => a + x.total, 0) / 7);
};
const latestPrice = (db: DB) => { const m = new Map<string, number>(); for (const p of [...db.pos].sort((a, b) => a.at - b.at)) for (const l of p.lines) m.set(l.stockItemId, l.price); return m; };
const foodCost = (db: DB, productId: string, price: (id: string) => number) => db.recipes.filter(r => r.productId === productId).reduce((a, r) => a + r.qty * price(r.stockItemId), 0);
const deviceDown = (d: DB['devices'][0], now: number) => d.status === 'offline' && now - d.lastSeen > 2 * MIN;
const tplRejected = (_db: DB, _now: number, ix: Ix): Fire[] => ix.rec('msg_template').filter(r => r.e === 'rejected').map(r => ({ key: r.id + '|' + r.at, outletId: null, text: `Template “${r.a}” was rejected by Meta · edit and resubmit` }));
const syncConflict = (_db: DB, _now: number, ix: Ix): Fire[] => ix.rec('sync_conflict').filter(r => !/resolved/i.test(r.d)).map(r => ({ key: r.id, outletId: ix.outletId(r.b), text: `${r.a} changed on two devices${r.c ? ' (' + r.c + ')' : ''} · pick the version to keep` }));
const FIXED_HOLIDAYS: [string, string][] = [['01-01', 'New Year'], ['05-01', 'Labour Day'], ['06-01', 'Pancasila Day'], ['08-17', 'Independence Day'], ['12-25', 'Christmas']];

export const RULES: Rule[] = [
  // ── Stock & inventory ──
  R('Stock will run out today', 'state', '/owner/inventory/stock-overview', (db, now, ix) => db.outlets.filter(o => ix.open(o.id) && now - ix.opens(o.id) >= HOUR).flatMap(o => {
    const used = new Map<string, number>();
    for (const m of db.movements) if (m.outletId === o.id && m.type === 'sale' && m.at >= ix.t0) used.set(m.stockItemId, (used.get(m.stockItemId) ?? 0) - m.qty);
    const rate = (n: number) => n / (now - ix.opens(o.id)), left = ix.closes(o.id) - now;
    return db.stockItems.filter(s => { const u = used.get(s.id) ?? 0, l = ix.lv(o.id).get(s.id) ?? 0; return u > 0 && l > 0 && l < rate(u) * left; })
      .map(s => ({ key: `${o.id}|${s.id}|${ix.date}`, outletId: o.id, text: `${s.name} at ${o.name} runs out around ${hhmm(now + (ix.lv(o.id).get(s.id) ?? 0) / rate(used.get(s.id)!))} at today’s pace · transfer or buy now` }));
  })),
  R('Batch expiring', 'state', '/owner/inventory/batches-and-expiry', (db, now, ix) => {
    const days = Number(db.settings['/owner/inventory/batches-and-expiry:expiring-days'] ?? 3);
    return ix.rec('batch').filter(r => { const t = when(r.d, now); return t >= ix.t0 && t <= ix.t0 + days * DAY && num(r.e) > 0 && !has(/waste|written|recall/i, r.c); })
      .map(r => ({ key: r.id + '|' + r.d, outletId: ix.outletId(r.b), text: `${r.a} at ${r.b} expires ${r.d} · ${r.e} left · use first (FEFO)` }));
  }),
  R('Batch expired', 'state', '/owner/inventory/batches-and-expiry', (_db, now, ix) => ix.rec('batch').filter(r => when(r.d, now) < ix.t0 && num(r.e) > 0 && !has(/waste|written|recall/i, r.c))
    .map(r => ({ key: r.id + '|' + r.d, outletId: ix.outletId(r.b), text: `${r.a} at ${r.b} expired ${r.d} with ${r.e} left · write off as waste with photo` }))),
  R('Waste above normal', 'state', '/owner/inventory/waste-damaged-goods', (db, _now, ix) => {
    const cost = new Map(db.stockItems.map(s => [s.id, s.unitCost])), today = new Map<string, number>(), past = new Map<string, number>();
    for (const m of db.movements) if (m.type === 'waste' && m.at >= ix.t0 - 30 * DAY) { const v = Math.abs(m.qty) * (cost.get(m.stockItemId) ?? 0), t = m.at >= ix.t0 ? today : past; t.set(m.outletId, (t.get(m.outletId) ?? 0) + v); }
    return [...today].filter(([o, v]) => (past.get(o) ?? 0) > 0 && v > 2 * (past.get(o)! / 30)).map(([o, v]) => ({ key: `${o}|${ix.date}`, outletId: o, text: `Waste at ${ix.name(o)} today ${idr(Math.round(v))} · over 2× the 30-day average ${idr(Math.round(past.get(o)! / 30))}` }));
  }),
  R('Opname due', 'state', '/pic/floor/stock-opname', (db, now, ix) => {
    const every = Number(db.settings['/owner/inventory/stock-count-schedule:every-days'] ?? 7) * DAY;
    return db.outlets.filter(o => ix.open(o.id) && !db.opnames.some(x => x.outletId === o.id && now - x.at < every))
      .map(o => ({ key: `${o.id}|${ix.date}`, outletId: o.id, text: `Stock count due at ${o.name} this shift · last count over ${every / DAY} days ago` }));
  }),
  R('Transfer incoming', 'state', '/owner/inventory/stock-transfer-between-outlets', (_db, _now, ix) => ix.rec('transfer').filter(r => /^sent$/i.test(r.c) && ix.outletId(r.b))
    .map(r => ({ key: r.id, outletId: ix.outletId(r.b), text: `${r.a} on the way to ${r.b} · receive and confirm quantities` }))),
  R('PO overdue', 'state', '/owner/inventory/purchase-orders', (db, now) => db.pos.filter(p => (p.status === 'sent' || p.status === 'partial') && p.due < now)
    .map(p => ({ key: p.id, outletId: p.outletId, text: `${p.no} · ${db.suppliers.find(s => s.id === p.supplierId)?.name ?? 'supplier'} past its delivery date ${ymd(p.due)} · call supplier or cancel` }))),
  R('Fridge / freezer temperature', 'external', '/pic/my-shift/pic-home-my-shift-now', (_db, now, ix) => {
    const units = new Map<string, Rec[]>();
    for (const r of ix.rec('temperature')) units.set(r.a + '|' + r.b, [...(units.get(r.a + '|' + r.b) ?? []), r]);
    return [...units.values()].flatMap(rs => {
      rs.sort((a, b) => b.at - a.at);
      const hot = (r: Rec) => num(r.d) > (/freez/i.test(r.c) ? -15 : 5);
      let i = 0; while (i < rs.length && hot(rs[i])) i++;
      const since = i ? rs[i - 1].at : now;
      return i && now - since >= 10 * MIN ? [{ key: `${rs[0].a}|${rs[0].b}|${since}`, outletId: ix.outletId(rs[0].b), text: `${rs[0].a} at ${num(rs[0].d)} °C for ${Math.round((now - since) / MIN)} min · check the door, move stock` }] : [];
    });
  }),
  R('Supplier price changed', 'state', '/owner/inventory/supplier-detail-and-price-history', db => {
    const last = new Map<string, number>(), out: Fire[] = [];
    for (const p of [...db.pos].sort((a, b) => a.at - b.at)) for (const l of p.lines) {
      const prev = last.get(l.stockItemId) ?? db.stockItems.find(s => s.id === l.stockItemId)?.unitCost ?? 0;
      if ((p.status === 'received' || p.status === 'partial') && prev > 0 && Math.abs(l.price - prev) / prev > .05)
        out.push({ key: `${p.id}|${l.stockItemId}`, outletId: p.outletId, text: `${db.stockItems.find(s => s.id === l.stockItemId)?.name} ${idr(prev)} → ${idr(l.price)} on ${p.no} · review COGS` });
      last.set(l.stockItemId, l.price);
    }
    return out;
  }),
  // ── Sales & payments (the one sales math: screens/insight/metrics.ts) ──
  R('Behind daily target', 'state', '/owner/outlets/targets-and-kpis', (db, now, ix) => {
    const at = [15, 19].find(h => now >= ix.t0 + h * HOUR && now < ix.t0 + (h + 1) * HOUR);
    return at == null ? [] : db.outlets.filter(o => ix.open(o.id)).flatMap(o => {
      const t = targetFor(db, o.id, ix.t0), el = Math.min(1, (now - ix.opens(o.id)) / (ix.closes(o.id) - ix.opens(o.id))), rev = summary(db, o.id, { from: ix.t0, to: now }).revenue;
      return t > 0 && el > 0 && rev < .8 * t * el ? [{ key: `${o.id}|${ix.date}|${at}`, outletId: o.id, text: `${o.name} at ${idr(rev)} by ${at}:00 · ${Math.round(rev / (t * el) * 100)}% of target pace (${idr(t)} today)` }] : [];
    });
  }),
  R('Target reached', 'state', '/owner/outlets/targets-and-kpis', (db, now, ix) => db.outlets.flatMap(o => {
    const t = targetFor(db, o.id, ix.t0), rev = summary(db, o.id, { from: ix.t0, to: now }).revenue;
    return t > 0 && rev >= t ? [{ key: `${o.id}|${ix.date}`, outletId: o.id, text: `${o.name} reached today’s target ${idr(t)} · now ${idr(rev)}` }] : [];
  })),
  R('Unusual sales drop', 'state', '/owner/monitor/live-monitor', (db, now, ix) => db.outlets.filter(o => ix.open(o.id) && ix.open(o.id, now - HOUR)).flatMap(o => {
    const cur = summary(db, o.id, { from: now - HOUR, to: now }).revenue, prev = summary(db, o.id, { from: now - WEEK - HOUR, to: now - WEEK }).revenue;
    return prev > 0 && cur < prev / 2 ? [{ key: `${o.id}|${ix.date}|${new Date(now).getHours()}`, outletId: o.id, text: `${o.name} last hour ${idr(cur)} vs ${idr(prev)} same hour last week · check devices and channels` }] : [];
  })),
  R('Settlement mismatch', 'external', '/owner/finance/cash-flow-and-settlement', (db, _now, ix) => ix.rec('settlement').flatMap(r => {
    const o = ix.outletId(r.a), from = when(r.b, 0), rec = db.payments.filter(p => p.status === 'settled' && p.outletId === o && p.method === r.c && p.at >= from && p.at < from + DAY).reduce((a, p) => a + p.amount, 0);
    return o && Number.isFinite(from) && num(r.e) !== rec ? [{ key: r.id + '|' + r.e, outletId: o, text: `${r.c.toUpperCase()} ${r.b} at ${ix.name(o)}: gateway settled ${idr(num(r.e))}, recorded ${idr(rec)} · difference ${idr(num(r.e) - rec)}` }] : [];
  })),
  R('Many voids/refunds by one person', 'state', '/owner/sales/refunds-and-voids', (db, _now, ix) => {
    const m = new Map<string, { voids: number; refunds: number; outletId: string; who: string }>();
    for (const a of db.approvals) if (a.status === 'approved' && (a.decidedAt ?? a.at) >= ix.t0 && (a.type === 'void' || a.type === 'refund')) {
      const k = a.outletId + '|' + a.requestedBy, x = m.get(k) ?? { voids: 0, refunds: 0, outletId: a.outletId, who: a.requestedBy };
      if (a.type === 'void') x.voids++; else x.refunds += a.amount; m.set(k, x);
    }
    return [...m].filter(([, x]) => x.voids > 3 || x.refunds > 300_000).map(([k, x]) => ({ key: `${k}|${ix.date}`, outletId: x.outletId, text: `${ix.emp(x.who)} today: ${x.voids} voids · ${idr(x.refunds)} refunds · review the shift` }));
  }),
  R('Refund rate high', 'state', '/owner/sales/refunds-and-voids', (db, now, ix) => db.outlets.flatMap(o => {
    const s = summary(db, o.id, { from: ix.t0, to: now });
    return s.revenue > 0 && s.refunds / s.revenue > .03 ? [{ key: `${o.id}|${ix.date}`, outletId: o.id, text: `Refunds at ${o.name} ${idr(s.refunds)} = ${(s.refunds / s.revenue * 100).toFixed(1)}% of today’s sales` }] : [];
  })),
  // ── Approvals / payroll ──
  R('Payroll ready', 'state', '/owner/team/payroll-and-commission', (_db, now, ix) => new Date(now).getDate() <= 3 ? [{ key: ym(ix.t0 - DAY * new Date(now).getDate()), outletId: null, text: `Payroll for ${ym(ix.t0 - DAY * new Date(now).getDate())} is calculated · review base, commission and overtime` }] : []),
  R('Payroll ready to approve', 'state', '/owner/team/payroll-and-commission', db => db.approvals.filter(a => a.type === 'payroll' && a.status === 'waiting').map(a => ({ key: a.id, outletId: a.outletId, text: `${a.title} · ${idr(a.amount)} waiting for your approval PIN` }))),
  R('Payslip ready', 'state', '/pos/shift/personal-shift-report', (db, now) => db.approvals.filter(a => a.type === 'payroll' && a.status === 'approved' && now - (a.decidedAt ?? a.at) < 7 * DAY).map(a => ({ key: a.id, outletId: a.outletId, text: `Payslips for ${a.title} are ready` }))),
  // ── Cash & shifts ──
  R('Shift ending', 'state', '/pos/shift-change/shift-ending-reminder', (db, now, ix) => db.outlets.flatMap(o => SLOTS.flatMap(s => {
    const w = ix.slotWin(o.id, s), r = ix.roster(o.id);
    return w && r && onRoster(r, s).length && w[1] > now && w[1] - now <= 15 * MIN ? [{ key: `${o.id}|${ix.date}|${s}`, outletId: o.id, text: `${SHIFTS[s][0]} shift at ${o.name} ends ${hhmm(w[1])} · count drawers and hand over` }] : [];
  }))),
  R('Drawer too full', 'state', '/pos/shift/cash-drop-to-safe', db => {
    const limit = Number(db.settings['/owner/settings/settings-payment-methods:drawer-limit'] ?? 3_000_000);
    return db.sessions.filter(s => s.status === 'open').flatMap(s => {
      const pays = db.payments.filter(p => p.sessionId === s.id && p.method === 'cash' && p.status === 'settled').reduce((a, p) => a + p.amount, 0);
      const mv = db.cashMoves.filter(c => c.sessionId === s.id && c.status === 'done').reduce((a, c) => a + (c.kind === 'in' ? c.amount : -c.amount), 0);
      const cash = s.openingFloat + pays + mv;
      return cash > limit ? [{ key: `${s.id}|${Math.floor(cash / limit)}`, outletId: s.outletId, text: `${s.id} drawer holds about ${idr(cash)} · over ${idr(limit)}, drop cash to the safe` }] : [];
    });
  }),
  R('Session not closed', 'state', '/manager/shifts/drawer-sessions-and-cash-close-per-shift', (db, now, ix) => db.sessions.filter(s => s.status === 'open' && now > Math.max(ix.closes(s.outletId) - (s.openedAt < ix.t0 ? DAY : 0), s.openedAt) + 30 * MIN)
    .map(s => ({ key: `${s.id}|${ix.date}`, outletId: s.outletId, text: `${s.id} (${ix.emp(s.cashierId)}) still open 30 min after closing · count and close it` }))),
  R('Late / no-show', 'state', '/manager/team/schedules-and-attendance', (db, now, ix) => db.outlets.flatMap(o => SLOTS.flatMap(s => {
    const w = ix.slotWin(o.id, s), r = ix.roster(o.id);
    if (!w || !r || now < w[0] + 15 * MIN || now >= w[1]) return [];
    return onRoster(r, s).filter(e => !ix.clockIn(e, o.id, w[0] - 2 * HOUR) && !db.notices.some(n => n.alert === 'Late / no-show' && n.at >= ix.t0 && n.text.startsWith(ix.emp(e) + ' ')))
      .map(e => ({ key: `${o.id}|${ix.date}|${s}|${e}`, outletId: o.id, text: `${ix.emp(e)} has not clocked in for ${SHIFTS[s][0]} at ${o.name} (started ${hhmm(w[0])}) · find cover` }));
  }))),
  R('Missing role on roster', 'state', '/manager/shifts/weekly-roster-builder-and-coverage', (db, now, ix) => db.outlets.flatMap(o => SLOTS.flatMap(s => {
    const w = ix.slotWin(o.id, s), r = ix.roster(o.id);
    if (!w || now >= w[1]) return [];
    const roles = new Set((r ? onRoster(r, s) : []).map(e => db.employees.find(x => x.id === e)?.role));
    const miss = [!r?.slots[s].pic && 'PIC', !roles.has('cashier') && 'cashier', !roles.has('kitchen') && 'kitchen'].filter(Boolean) as string[];
    return miss.length ? [{ key: `${o.id}|${ix.date}|${s}|${miss.join(',')}`, outletId: o.id, text: `${o.name} ${SHIFTS[s][0]} (${hhmm(w[0])}) has no ${miss.join(', ')}` }] : [];
  }))),
  R('Overtime', 'state', '/owner/team/leave-and-overtime', (db, now) => { const w = weekHours(db, now); return [...w.hours].filter(([, ms]) => ms > 40 * HOUR && ms <= 56 * HOUR).map(([e, ms]) => ({ key: `${e}|${ymd(w.from)}`, outletId: db.employees.find(x => x.id === e)?.outlets[0] ?? null, text: `${db.employees.find(x => x.id === e)?.name ?? e} passed 40 h this week (${(ms / HOUR).toFixed(1)} h)` })); }),
  R('Overtime over limit', 'state', '/owner/team/leave-and-overtime', (db, now) => { const w = weekHours(db, now); return [...w.hours].filter(([, ms]) => ms > 56 * HOUR).map(([e, ms]) => ({ key: `${e}|${ymd(w.from)}`, outletId: db.employees.find(x => x.id === e)?.outlets[0] ?? null, text: `${db.employees.find(x => x.id === e)?.name ?? e} at ${(ms / HOUR).toFixed(1)} h this week · over the 56 h limit incl. overtime` })); }),
  R('Missing clock-out', 'state', '/owner/team/attendance', (db, now, ix) => {
    const last = new Map<string, DB['clock'][0]>();
    for (const c of db.clock) if (c.kind !== 'break' && (last.get(c.employeeId)?.at ?? -1) <= c.at) last.set(c.employeeId, c);
    return [...last.values()].filter(c => c.kind === 'in').flatMap(c => {
      const r = db.roster.find(x => x.outletId === c.outletId && x.day === (new Date(c.at).getDay() + 6) % 7), s = SLOTS.find(x => r?.slots[x].pic === c.employeeId || r?.slots[x].crew.includes(c.employeeId));
      const end = s ? startOfDay(c.at) + hm(SHIFTS[s][2]) : c.at + 8 * HOUR;
      return now > end + HOUR ? [{ key: c.id, outletId: c.outletId, text: `${ix.emp(c.employeeId)} clocked in ${hhmm(c.at)} at ${ix.name(c.outletId)} and never clocked out` }] : [];
    });
  }),
  // ── Kitchen & orders ──
  R('Delivery order waiting', 'state', '/pos/selling/ride-hailing-orders-inbox', (db, now) => db.orders.filter(o => PLATFORM.has(o.source) && o.status === 'open' && now - o.createdAt > ACCEPT_WINDOW_MS - MIN)
    .map(o => ({ key: o.id, outletId: o.outletId, text: `${o.source} ${o.no} not accepted for ${Math.round((now - o.createdAt) / MIN)} min · the platform cancels at 3 min` }))),
  // ── Customers & loyalty ──
  R('Bad review', 'state', '/owner/customers/reviews-and-feedback', (db, now) => db.reviews.filter(r => !r.reply && now - r.at < 7 * DAY && (r.stars <= 2 || /\b(basi|lama|kotor)\b/i.test(r.text)))
    .map(r => ({ key: r.id, outletId: r.outletId, text: `${r.stars}★ from ${r.name}: ${r.text || 'no comment'}` }))),
  R('VIP visit', 'state', '/waiter', (db, now, ix) => db.orders.filter(o => o.customerId && o.status !== 'voided' && now - o.createdAt < 2 * HOUR && o.createdAt <= now && tierOf(db.ledger, o.customerId, now).id === 'platinum')
    .map(o => ({ key: `${o.customerId}|${ix.date}|${o.outletId}`, outletId: o.outletId, text: `${ix.cust.get(o.customerId!)?.name ?? 'Member'} (Platinum) is in${o.table ? ' at ' + o.table : ''} · ${o.no}` }))),
  R('Member at risk', 'state', '/owner/customers/customers', (_db, now, ix) => [...ix.byCustomer()].filter(([, os]) => os.length >= 3).flatMap(([c, os]) => {
    const last = Math.max(...os.map(o => o.paidAt!));
    return now - last > 30 * DAY ? [{ key: `${c}|${last}`, outletId: null, text: `${ix.cust.get(c)?.name ?? c} (${os.length} visits) not seen for ${Math.floor((now - last) / DAY)} days` }] : [];
  })),
  R('Points expiring', 'state', '/owner/customers/loyalty-program', (db, now, ix) => db.customers.filter(c => c.optIn && c.phone).flatMap(c => {
    const rows = db.ledger.filter(r => r.customerId === c.id && r.points > 0 && r.at > now - 365 * DAY && r.at <= now - 351 * DAY), pts = Math.min(rows.reduce((a, r) => a + r.points, 0), balance(db.ledger, c.id));
    return pts > 0 ? [{ key: `${c.id}|${ymd(Math.min(...rows.map(r => r.at)))}`, outletId: null, text: `${c.name}: ${pts} beans expire by ${ymd(Math.min(...rows.map(r => r.at)) + 365 * DAY)}`, msg: guest(ix.cust.get(c.id), 'points_expiry') }] : [];
  })),
  R('Tier up', 'state', '/owner/customers/loyalty-program', (db, now) => db.customers.filter(c => c.optIn && c.phone).flatMap(c => {
    const t = tierOf(db.ledger, c.id, now), before = tierOf(db.ledger.filter(r => r.at <= now - DAY), c.id, now - DAY);
    return TIERS.indexOf(TIERS.find(x => x.id === t.id)!) > TIERS.indexOf(TIERS.find(x => x.id === before.id)!) ? [{ key: `${c.id}|${t.id}`, outletId: null, text: `${c.name} reached ${t.name}`, msg: guest(c, 'tier_up') }] : [];
  })),
  R('Reward stock low', 'state', '/owner/customers/rewards-catalog', (_db, _now, ix) => ix.rec('reward').filter(r => r.e !== '' && Number.isFinite(Number(r.e)) && Number(r.e) < 5 && !/archiv/i.test(r.c))
    .map(r => ({ key: `${r.id}|${r.e}`, outletId: null, text: `Reward “${r.a}” has ${r.e} left · restock or hide it` }))),
  R('Suspicious points', 'state', '/owner/customers/points-adjustment', (db, _now, ix) => {
    const earn = (r: DB['ledger'][0]) => r.points > 0 && r.reason.startsWith('Order'), out: Fire[] = [];
    const byC = new Map<string, DB['ledger']>(); for (const r of db.ledger) if (r.at >= ix.t0 - 30 * DAY) byC.set(r.customerId, [...(byC.get(r.customerId) ?? []), r]);
    for (const [c, rs] of byC) {
      const today = rs.filter(r => earn(r) && r.at >= ix.t0).reduce((a, r) => a + r.points, 0), past = rs.filter(r => earn(r) && r.at < ix.t0);
      const days = new Set(past.map(r => ymd(r.at))).size, normal = days ? past.reduce((a, r) => a + r.points, 0) / days : 0;
      const quick = rs.some(r => r.points < 0 && r.reason.startsWith('Redeem') && r.at >= ix.t0 && rs.some(e => earn(e) && e.at <= r.at && r.at - e.at < 10 * MIN));
      if ((normal > 0 && today > 3 * normal) || quick) out.push({ key: `${c}|${ix.date}`, outletId: null, text: `${ix.cust.get(c)?.name ?? c}: ${quick ? 'redeemed right after earning' : `${today} beans today vs ${Math.round(normal)} on a normal day`} · check the cashier` });
    }
    return out;
  }),
  R('Kasbon due', 'state', '/owner/customers/customer-credit', (db, now) => {
    const owner = new Map(db.orders.filter(o => o.customerId).map(o => [o.id, o.customerId]));
    const last = new Map<string, number>(); for (const p of db.payments) if (p.method === 'kasbon' && owner.get(p.orderId)) last.set(owner.get(p.orderId)!, Math.max(last.get(owner.get(p.orderId)!) ?? 0, p.at));
    return db.customers.filter(c => c.credit > 0 && now > (last.get(c.id) ?? c.joinedAt) + 30 * DAY).map(c => ({ key: `${c.id}|${c.credit}`, outletId: null, text: `${c.name} owes ${idr(c.credit)} on kasbon · past 30 days` }));
  }),
  // ── Menu, promos & brand ──
  R('Flash sale starting / ending', 'state', '/owner/menu-studio-pages-promo-blocks/menu-studio-pages-flash-sale', (db, now) => db.promos.filter(p => p.kind === 'flash').flatMap(p => {
    const s = (p as { startsAt?: number }).startsAt ?? 0, e = p.endsAt ?? 0;
    return [...(s > now && s - now <= 15 * MIN ? [{ key: p.id + '|start', outletId: null, text: `${p.name} starts ${hhmm(s)} · ${idr(p.value)}` }] : []),
      ...(e && e <= now && now - e < 30 * MIN ? [{ key: p.id + '|end', outletId: null, text: `${p.name} ended · prices back to normal` }] : [])];
  })),
  R('Voucher quota almost used', 'state', '/owner/promo/promos-and-vouchers', (db, now) => db.promos.filter(p => p.quota && (p.used ?? 0) / p.quota >= .9 && !(p.endsAt && p.endsAt < now))
    .map(p => ({ key: `${p.id}|${p.quota}`, outletId: null, text: `${p.name}${p.code ? ' (' + p.code + ')' : ''} ${p.used}/${p.quota} used` }))),
  R('Margin dropped', 'state', '/owner/catalog/recipes-and-cogs', db => {
    const lp = latestPrice(db), unit = new Map(db.stockItems.map(s => [s.id, s.unitCost]));
    return db.products.filter(p => p.status === 'live' && p.basePrice > 0).flatMap(p => {
      const now_ = foodCost(db, p.id, id => lp.get(id) ?? unit.get(id) ?? 0), was = foodCost(db, p.id, id => unit.get(id) ?? 0);
      return now_ / p.basePrice > .4 && was / p.basePrice <= .4 ? [{ key: `${p.id}|${Math.round(now_)}`, outletId: null, text: `${p.name} food cost ${(now_ / p.basePrice * 100).toFixed(0)}% after supplier prices changed (was ${(was / p.basePrice * 100).toFixed(0)}%)` }] : [];
    });
  }),
  R('Theme published', 'event', '/owner/menu-studio-customer-facing/menu-studio-version-history-and-restore', (_db, _now, ix) => ix.events.filter(a => a.action === 'publish.done' || a.action === 'studio.schedule_live' || (a.action === 'approval.approved' && /^Publish /.test(a.subject)))
    .map(a => ({ key: a.id, outletId: null, text: `New version live${a.subject ? ' · ' + a.subject : ''} · ${ix.emp(a.actor)}` }))),
  // ── Devices & system ──
  R('Device offline', 'external', '/manager/devices/registers-and-devices-status', (db, now, ix) => db.devices.filter(d => ['pos', 'kds', 'display', 'pic', 'waiter'].includes(d.kind) && ix.open(d.outletId) && deviceDown(d, now))
    .map(d => ({ key: `${d.id}|${d.lastSeen}`, outletId: d.outletId, text: `${d.name} at ${ix.name(d.outletId)} offline${d.lastSeen ? ' since ' + hhmm(d.lastSeen) : ''}` }))),
  R('Offline sales not synced', 'external', '/pos/device/sync-status-and-retry', (db, now) => { const q = db.device.queue; return q.length > 50 || (q[0] && now - q[0].at > 30 * MIN) ? [{ key: 'q30|' + q[0].id, outletId: db.device.outletId, text: `${q.length} sales waiting to sync since ${hhmm(q[0].at)}` }] : []; }),
  R('Printer problem', 'external', '/pos/device/printer-and-drawer-connection', (db, now, ix) => db.devices.filter(d => d.kind === 'printer' && deviceDown(d, now) && !db.integrations.some(i => i.deviceId === d.id && i.status === 'error'))
    .map(d => ({ key: `${d.id}|${d.lastSeen}`, outletId: d.outletId, text: `${d.name} at ${ix.name(d.outletId)} not responding since ${hhmm(d.lastSeen)}` }))),
  R('Sync conflict', 'external', '/system/states/sync-conflict-resolution', syncConflict),
  R('App update', 'external', '/pos/device/register-settings', (_db, _now, ix) => { const r = ix.rec('release').filter(x => /shipped|rolling/.test(x.b)).sort((a, b) => b.at - a.at)[0]; return r ? [{ key: r.id, outletId: null, text: `BorNiz ${r.a} available · ${r.c}` }] : []; }),
  // ── Account, billing & security ──
  R('Permissions changed', 'event', '/owner/team/roles-and-permissions-matrix', (db, now, ix) => [
    ...ix.events.filter(a => a.action === 'perms.changed' || a.action === 'locks.changed').map(a => ({ key: a.id, outletId: a.outletId ?? null, text: `${ix.emp(a.actor)} changed ${a.subject || 'the permission matrix'}` })),
    ...db.approvals.filter(a => a.type === 'perm' && a.status === 'waiting' && now - a.at < EVENT_WINDOW && /^Permissions/.test(a.title)).map(a => ({ key: a.id, outletId: a.outletId, text: `${ix.emp(a.requestedBy)} proposed: ${a.title}` }))]),
  R('New login on a new device', 'event', '/owner/account/profile-and-security', (_db, _now, ix) => ix.events.filter(a => /^(auth|login)\.new_device$/.test(a.action)).map(a => ({ key: a.id, outletId: a.outletId ?? null, text: `${ix.emp(a.actor)} signed in from a new device · ${a.subject}` }))),
  R('Invoice due / unpaid', 'state', '/owner/account/invoices', (db, now) => {
    const stage = billingStage(db, now), since = unpaidSince(db) ?? 0; // the platform's answer (live) or this store's invoices (demo)
    if (!stage) return [];
    return [{ key: `${since}|${stage}`, outletId: null, level: stage === 'hold' ? 'high' : undefined, text: stage === 'due' ? `BorNiz invoice issued ${ymd(since)} is due` : stage === 'overdue'
      ? `BorNiz invoice unpaid ${REMIND_DAYS} days · from day ${HOLD_DAYS} the set-up is read-only until it is paid; sales carry on` : `BorNiz invoice unpaid ${HOLD_DAYS} days · the set-up is read-only until it is paid; sales carry on` }];
  }),
  R('Plan limit reached', 'state', '/owner/account/subscription-billing', db => {
    const plan = db.tenant.plan, pos = (o: string) => db.devices.filter(d => d.outletId === o && d.kind === 'pos').length, hit: string[] = [];
    if (plan === 'free' && db.outlets.length > 1) hit.push(`${db.outlets.length} outlets (Free: 1)`);
    if (plan === 'free' && db.outlets.some(o => pos(o.id) > 1)) hit.push('registers (Free: 1)');
    if (plan === 'basic' && db.outlets.some(o => pos(o.id) > 3)) hit.push('registers (Basic: 3 per outlet)');
    if ((plan === 'free' || plan === 'basic') && db.devices.some(d => d.kind === 'kds')) hit.push('KDS (Pro and up)');
    return hit.map(h => ({ key: `${plan}|${h}`, outletId: null, text: `Plan limit on ${plan}: ${h} · upgrade to keep using it` }));
  }),
  R('WABA template rejected', 'external', '/owner/messaging-and-automation/message-templates', tplRejected),
  // ── Reservations & tables ──
  R('Reservation in 30 min', 'state', '/pos/selling/reservations-and-walk-in-queue', (db, now) => db.reservations.filter(r => r.status === 'booked' && r.table && r.at > now && r.at - now <= 30 * MIN)
    .map(r => ({ key: r.id, outletId: r.outletId, text: `${r.name} · ${r.guests} guests at ${hhmm(r.at)} · prepare ${r.table}` }))),
  R('Guest no-show', 'state', '/pos/selling/reservations-and-walk-in-queue', (db, now) => db.reservations.filter(r => r.status === 'booked' && r.table && now > r.at + 15 * MIN && now - r.at < DAY)
    .map(r => ({ key: r.id, outletId: r.outletId, text: `${r.name} (${r.guests}) not checked in · booked ${hhmm(r.at)} at ${r.table}` }))),
  R('Table waiting too long', 'state', '/waiter', (db, now) => db.orders.filter(o => o.table && o.type === 'dine' && OPEN.has(o.status) && now - o.createdAt < 6 * HOUR).flatMap(o => {
    const last = Math.max(0, ...o.lines.map(l => l.firedAt ?? 0)), empty = !o.lines.length && now - o.createdAt > 10 * MIN, idle = last > 0 && o.status !== 'paying' && now - last > 20 * MIN;
    return empty || idle ? [{ key: `${o.id}|${empty ? 'order' : last}`, outletId: o.outletId, text: `${o.table} · ${empty ? `seated ${Math.round((now - o.createdAt) / MIN)} min, no order yet` : `${Math.round((now - last) / MIN)} min since the last item`}` }] : [];
  })),
  R('Bill open too long', 'state', '/pos/selling/open-bills-saved-orders', (db, now, ix) => db.orders.filter(o => o.table && OPEN.has(o.status) && now - o.createdAt < DAY).flatMap(o => {
    const long = now - o.createdAt > 3 * HOUR, closing = ix.open(o.outletId) && ix.closes(o.outletId) - now <= 30 * MIN;
    return long || closing ? [{ key: `${o.id}|${long ? 'long' : 'closing'}`, outletId: o.outletId, text: `${o.table} · ${o.no} open ${Math.round((now - o.createdAt) / MIN)} min${closing ? ' · outlet closes ' + hhmm(ix.closes(o.outletId)) : ''}` }] : [];
  })),
  R('Queue too long', 'state', '/pos/selling/reservations-and-walk-in-queue', (db, now, ix) => db.outlets.flatMap(o => {
    const q = db.reservations.filter(r => r.outletId === o.id && r.status === 'booked' && !r.table && r.at <= now && now - r.at < 6 * HOUR), wait = q.length ? now - Math.min(...q.map(r => r.at)) : 0;
    return q.length > 8 || wait > 25 * MIN ? [{ key: `${o.id}|${ix.date}|${new Date(now).getHours()}`, outletId: o.id, text: `${q.length} parties waiting at ${o.name} · longest ${Math.round(wait / MIN)} min` }] : [];
  })),
  R('Big event booking', 'state', '/owner/outlets/reservations', (db, now) => db.reservations.filter(r => r.status === 'booked' && r.guests > 20 && r.at > now)
    .map(r => ({ key: r.id, outletId: r.outletId, text: `${r.name} · ${r.guests} pax on ${ymd(r.at)} ${hhmm(r.at)} · plan staff and prep` }))),
  // ── Delivery & online ──
  R('Delivery app paused outlet', 'external', '/owner/sales/ride-hailing-integrations', db => db.integrations.filter(i => i.kind === 'delivery' && i.enabled && (i.config.paused === true || /paus|closed|busy|rating|turned off/i.test(i.lastError ?? '')))
    .map(i => ({ key: `${i.id}|${i.lastError ?? 'paused'}`, outletId: i.outletId, text: `${i.name} turned the store off${i.lastError ? ': ' + i.lastError : ''}` }))),
  R('Rider waiting', 'external', '/kds/delivery-and-online-order-lane', (db, _now, ix) => ix.rec('rider').flatMap(r => {
    const o = db.orders.find(x => x.id === r.a);
    return o && OPEN.has(o.status) && o.status !== 'ready' ? [{ key: r.id, outletId: o.outletId, text: `Rider for ${o.source} ${o.no} arrived ${hhmm(r.at)} · order not ready` }] : [];
  })),
  R('Online order cancelled', 'state', '/online', (db, now) => db.orders.filter(o => o.status === 'voided' && (PLATFORM.has(o.source) || o.source === 'web') && o.lines.some(l => l.fired) && now - o.createdAt < DAY)
    .map(o => ({ key: o.id, outletId: o.outletId, text: `${o.source} ${o.no} cancelled after cooking started${o.note ? ' · ' + o.note : ''}` }))),
  R('Past ready-by', 'state', '/online', (db, now) => db.orders.filter(o => o.readyBy && (o.status === 'sent' || o.status === 'preparing') && now > o.readyBy + (o.tier === 'rush' ? 2 : 5) * MIN)
    .map(o => ({ key: o.id, outletId: o.outletId, text: `${o.source} ${o.no} still cooking · ready-by was ${hhmm(o.readyBy!)}` }))),
  R('Channel paused too long', 'state', '/online', (db, now, ix) => db.outlets.flatMap(o => CHANNELS.flatMap(ch => {
    const n = db.audit.filter(a => a.action === 'online.pause' && a.subject === ch && a.outletId === o.id && a.at >= ix.t0).length, st = channelState(db, o.id, ch, now);
    return n >= 3 || (st.paused && st.pausedUntil - now > 60 * MIN) ? [{ key: `${o.id}|${ch}|${ix.date}`, outletId: o.id, text: `${ch} at ${o.name} paused ${n}× today${st.paused ? ' · until ' + hhmm(st.pausedUntil) : ''}` }] : [];
  }))),
  R('Scheduled order fired early', 'state', '/online', db => db.orders.filter(o => isScheduled(o) && o.lines.some(l => l.firedAt && l.firedAt < fireAt(o) - 15 * MIN))
    .map(o => ({ key: o.id, outletId: o.outletId, text: `${o.source} ${o.no} sent to the kitchen ${Math.round((fireAt(o) - Math.min(...o.lines.map(l => l.firedAt ?? Infinity))) / MIN)} min before its fire time` }))),
  R('Bag waiting on shelf', 'state', '/online', (db, now) => db.orders.filter(o => o.type === 'delivery' && o.status === 'ready').flatMap(o => {
    const ready = Math.max(o.createdAt, ...db.audit.filter(a => a.subject === o.id && a.action.startsWith('ticket.')).map(a => a.at), ...o.lines.map(l => l.firedAt ?? 0));
    return now - ready > 15 * MIN ? [{ key: o.id, outletId: o.outletId, text: `${o.source} ${o.no} bag on the shelf ${Math.round((now - ready) / MIN)} min · call the rider` }] : [];
  })),
  R('Internal courier late', 'external', '/owner/outlets/internal-couriers', (_db, now, ix) => ix.rec('courier').filter(r => /on delivery/i.test(r.c) && now > when(r.d, now) + 10 * MIN)
    .map(r => ({ key: r.id + '|' + r.d, outletId: ix.outletId(r.b), text: `${r.a} past ETA ${hhmm(when(r.d, now))}${r.e ? ' · ' + r.e : ''}` }))),
  R('QR order not paid', 'state', '/pos/selling/online-and-qr-orders-inbox', (db, now, ix) => db.orders.filter(o => o.source === 'qr' && OPEN.has(o.status) && o.lines.some(l => l.fired) && now - o.createdAt < DAY && (now - o.createdAt > 90 * MIN || !ix.open(o.outletId)))
    .map(o => ({ key: o.id, outletId: o.outletId, text: `${o.no}${o.table ? ' · ' + o.table : ''} unpaid (pay later) ${Math.round((now - o.createdAt) / MIN)} min · check the table` }))),
  // ── Finance & tax ──
  R('PB1 / PPN due', 'state', '/owner/finance/tax-and-service-charge', (db, now) => {
    const dd = Number(db.settings['/owner/finance/tax-and-service-charge:due-day'] ?? 15), d = new Date(now), due = new Date(d.getFullYear(), d.getMonth() + (d.getDate() > dd ? 1 : 0), dd).getTime(), left = (due - startOfDay(now)) / DAY;
    const stage = left <= 1 ? 1 : left <= 7 ? 7 : 0;
    return stage ? [{ key: `${ymd(due)}|${stage}`, outletId: null, text: `PB1 / PPN for last month due ${ymd(due)} · ${stage === 1 ? 'tomorrow or today' : 'in 7 days'}` }] : [];
  }),
  R('Payout received / failed', 'external', '/owner/finance/bank-accounts-and-withdrawals', (db, now, ix) => [
    ...ix.rec('payout').filter(r => now - r.at < 3 * DAY).map(r => ({ key: r.id + '|' + r.c, outletId: ix.outletId(r.b), text: `Payout ${r.a} ${idr(num(r.e))} ${/fail/i.test(r.c) ? 'failed' : 'received'}`, level: (/fail/i.test(r.c) ? 'high' : 'info') as Level })),
    ...db.integrations.filter(i => i.kind === 'bank' && i.status === 'error').map(i => ({ key: `${i.id}|${i.lastError}`, outletId: i.outletId, text: `Payout failed · ${i.name}: ${i.lastError}`, level: 'high' as Level }))]),
  R('Expense over budget', 'state', '/owner/finance/budget-and-sales-forecast', (_db, now, ix) => {
    const month = ym(now), exp = ix.rec('expense').filter(e => ym(Number.isFinite(when(e.d, now)) ? when(e.d, now) : e.at) === month);
    return ix.rec('budget').filter(b => !/target/i.test(b.a) && num(b.e) > 0).flatMap(b => {
      const word = b.a.replace(/budget/i, '').trim().toLowerCase(), spent = exp.filter(e => (b.b === 'All outlets' || e.b === b.b) && (!word || word === 'expense' || e.a.toLowerCase().includes(word))).reduce((a, e) => a + num(e.e), 0);
      return spent > .9 * num(b.e) ? [{ key: `${b.id}|${month}`, outletId: ix.outletId(b.b), text: `${b.a} at ${b.b}: ${idr(spent)} of ${idr(num(b.e))} spent this month` }] : [];
    });
  }),
  R('Supplier bill due', 'state', '/owner/inventory/supplier-payables', (db, now) => db.pos.filter(p => p.status === 'received' || p.status === 'partial').flatMap(p => {
    const s = db.suppliers.find(x => x.id === p.supplierId), due = p.due + (parseInt(s?.terms ?? '') || 0) * DAY;
    return due >= startOfDay(now) && due - now <= 3 * DAY ? [{ key: `${p.id}|${ymd(due)}`, outletId: p.outletId, text: `${s?.name ?? 'Supplier'} bill for ${p.no} ${idr(p.lines.reduce((a, l) => a + l.received * l.price, 0))} due ${ymd(due)}` }] : [];
  })),
  R('Profit dropped', 'state', '/owner/finance/profit-and-loss', (db, _now, ix) => {
    const m = (w: number) => summary(db, 'all', { from: ix.t0 - (w + 1) * WEEK + DAY, to: ix.t0 - w * WEEK + DAY }).grossMargin;
    const cur = m(0), prev = [1, 2, 3, 4].map(m).filter((x): x is number => x != null);
    if (cur == null || !prev.length) return [];
    const avg = prev.reduce((a, x) => a + x, 0) / prev.length;
    return avg - cur >= .05 ? [{ key: ix.date, outletId: null, text: `Margin this week ${(cur * 100).toFixed(1)}% vs ${(avg * 100).toFixed(1)}% average · −${((avg - cur) * 100).toFixed(1)} pt` }] : [];
  }),
  // ── Staff phone ──
  R('Shift starts soon', 'state', '/pos/shift/clock-in-out', (db, now, ix) => db.outlets.flatMap(o => SLOTS.flatMap(s => {
    const w = ix.slotWin(o.id, s), r = ix.roster(o.id);
    return w && r && w[0] > now && w[0] - now <= HOUR ? onRoster(r, s).map(e => ({ key: `${o.id}|${ix.date}|${s}|${e}`, outletId: o.id, text: `${ix.emp(e)} · ${SHIFTS[s][0]} at ${o.name} starts ${hhmm(w[0])}` })) : [];
  }))),
  R('You are PIC today', 'state', '/pic', (db, now, ix) => db.outlets.filter(o => now >= ix.opens(o.id) - HOUR).flatMap(o => SLOTS.flatMap(s => {
    const w = ix.slotWin(o.id, s), p = ix.roster(o.id)?.slots[s].pic;
    return w && p && now < w[1] ? [{ key: `${o.id}|${ix.date}|${s}|${p}`, outletId: o.id, text: `${ix.emp(p)} is PIC for ${SHIFTS[s][0]} at ${o.name} (${hhmm(w[0])}–${hhmm(w[1])})` }] : [];
  }))),
  R('Training / SOP to read', 'event', '/kds/recipes-and-prep-guide', (_db, _now, ix) => ix.events.filter(a => /^(sop|recipe)\.(saved|assigned|published)$/.test(a.action)).map(a => ({ key: a.id, outletId: a.outletId ?? null, text: `New ${a.action.split('.')[0] === 'sop' ? 'SOP' : 'recipe'} to read: ${a.subject}` }))),
  // ── Guest messages (to the guest's phone; skips what service code already queued) ──
  R('Order received', 'state', '/owner/messaging-and-automation/message-log-and-delivery-status', (db, now, ix) => db.orders.filter(o => GUEST_SRC.has(o.source) && o.customerId && now - o.createdAt < 30 * MIN && (o.status !== 'open' || o.lines.some(l => l.fired)) && !hasMsg(db, 'order_received', m => m.orderId === o.id))
    .flatMap(o => { const msg = guest(ix.cust.get(o.customerId!), 'order_received', o.id); return msg ? [{ key: o.id, outletId: o.outletId, text: `${o.no} received`, msg }] : []; })),
  R('Order ready / on the way', 'state', '/owner/messaging-and-automation/message-log-and-delivery-status', (db, now, ix) => db.orders.filter(o => o.customerId && now - o.createdAt < 6 * HOUR && (o.status === 'ready' || (o.type === 'delivery' && o.source === 'web' && o.status === 'paid')) && !hasMsg(db, 'order_ready', m => m.orderId === o.id))
    .flatMap(o => { const msg = guest(ix.cust.get(o.customerId!), 'order_ready', o.id); return msg ? [{ key: o.id, outletId: o.outletId, text: `${o.no} ${o.status === 'ready' ? 'ready' : 'on the way'}`, msg }] : []; })),
  R('Digital receipt', 'state', '/owner/messaging-and-automation/message-log-and-delivery-status', (db, now, ix) => db.orders.filter(o => o.customerId && o.paidAt && now - o.paidAt < 15 * MIN && o.paidAt <= now
    && !hasMsg(db, 'e_receipt', m => m.orderId === o.id || (!m.orderId && m.customerId === o.customerId && m.at >= o.paidAt! - MIN)))
    .flatMap(o => { const msg = guest(ix.cust.get(o.customerId!), 'e_receipt', o.id); return msg ? [{ key: o.id, outletId: o.outletId, text: `Receipt ${o.no}`, msg }] : []; })),
  R('Reservation reminder', 'state', '/owner/messaging-and-automation/message-log-and-delivery-status', (db, now) => db.reservations.filter(r => r.status === 'booked' && r.table && r.phone && r.at > now && r.at - now <= 3 * HOUR)
    .map(r => { const c = db.customers.find(x => x.phone.replace(/\D/g, '') === r.phone.replace(/\D/g, '')); return { key: r.id, outletId: r.outletId, text: `Reminder ${r.name} ${hhmm(r.at)}`, msg: { template: 'reservation_reminder', to: r.phone, customerId: c?.id ?? null } }; })),
  R('Refund done', 'state', '/owner/messaging-and-automation/message-log-and-delivery-status', (db, now, ix) => db.refunds.filter(r => now - r.at < DAY).flatMap(r => {
    const o = db.orders.find(x => x.id === r.orderId), msg = guest(o?.customerId ? ix.cust.get(o.customerId) : undefined, 'refund_done', o?.id);
    return o && msg ? [{ key: r.id, outletId: o.outletId, text: `Refund ${idr(r.amount)} on ${o.no}`, msg }] : [];
  })),
  // ── Kiosk, displays & QR ──
  R('Kiosk offline / frozen', 'external', '/owner/outlets/kiosk-management', (db, now, ix) => db.devices.filter(d => d.kind === 'kiosk' && ix.open(d.outletId) && deviceDown(d, now))
    .map(d => ({ key: `${d.id}|${d.lastSeen}`, outletId: d.outletId, text: `${d.name} at ${ix.name(d.outletId)} not seen since ${hhmm(d.lastSeen)}` }))),
  R('Kiosk payment terminal error', 'external', '/owner/outlets/kiosk-management', db => db.integrations.filter(i => i.status === 'error' && ['edc', 'scanner', 'payment'].includes(i.kind) && db.devices.some(d => d.id === i.deviceId && d.kind === 'kiosk'))
    .map(i => ({ key: `${i.id}|${i.lastError}`, outletId: i.outletId, text: `${i.name} on the kiosk: ${i.lastError}` }))),
  R('Table QR not scanned for days', 'state', '/owner/outlets/table-qr-generator', (db, now, ix) => {
    const used = new Map<string, { qr: number; any: number }>();
    for (const o of db.orders) if (o.table && now - o.createdAt < 7 * DAY) { const k = o.outletId + '|' + o.table, x = used.get(k) ?? { qr: 0, any: 0 }; x.any++; if (o.source === 'qr') x.qr++; used.set(k, x); }
    return [...used].filter(([, x]) => !x.qr && x.any).map(([k]) => ({ key: `${k}|${ymd(ix.t0 - ix.rday * DAY)}`, outletId: k.split('|')[0], text: `${k.split('|')[1]} at ${ix.name(k.split('|')[0])}: 0 QR scans in 7 days while the table was used · check the stand` }));
  }),
  R('QR menu slow', 'external', '/owner/menu-studio-customer-facing/menu-studio-brand-media', (_db, now, ix) => {
    const by = new Map<string, Rec[]>(); for (const r of ix.rec('qr_perf')) if (now - r.at <= 10 * MIN) by.set(r.b, [...(by.get(r.b) ?? []), r]);
    return [...by].filter(([, rs]) => rs.length >= 2 && rs.every(r => num(r.e) > 3000)).map(([b, rs]) => ({ key: `${b}|${ix.date}|${new Date(now).getHours()}`, outletId: ix.outletId(b), text: `QR menu p95 ${Math.max(...rs.map(r => num(r.e)))} ms for 10 min at ${b}` }));
  }),
  // ── Franchise & multi-outlet ──
  R('Outlet below network average', 'state', '/owner/outlets/outlet-comparison', (db, _now, ix) => db.outlets.length < 2 ? [] : db.outlets.filter(o => [1, 2, 3, 4, 5, 6, 7].every(i => {
    const r = { from: ix.t0 - i * DAY, to: ix.t0 - (i - 1) * DAY }, all = db.outlets.map(x => soldOrders(db, x.id, r).reduce((a, y) => a + y.total, 0)), avg = all.reduce((a, x) => a + x, 0) / all.length;
    return avg > 0 && all[db.outlets.indexOf(o)] < .7 * avg;
  })).map(o => ({ key: `${o.id}|${ymd(ix.t0 - ix.rday * DAY)}`, outletId: o.id, text: `${o.name} below 70% of the network average every day for 7 days` }))),
  R('Brand lock broken attempt', 'event', '/owner/governance/franchise-lock', (db, _now, ix) => ix.events.filter(a => (a.action === 'publish.requested' && a.subject === 'brand' && db.tenant.locks.brand) || (a.action === 'approval.requested' && /^Franchise lock/.test(a.subject)))
    .map(a => ({ key: a.id, outletId: a.outletId ?? null, text: `${ix.emp(a.actor)} tried to change a locked element · ${a.subject}` }))),
  R('Royalty report ready', 'state', '/owner/finance/franchise-royalties', (_db, _now, ix) => ix.rec('royalty').filter(r => /ready/i.test(r.c)).map(r => ({ key: r.id, outletId: ix.outletId(r.a), text: `Royalty report ${r.b} for ${r.a} ready · ${idr(num(r.e))}` }))),
  R('Royalty unpaid', 'state', '/owner/finance/franchise-royalties', (_db, now, ix) => ix.rec('royalty').filter(r => /unpaid|ready|sent/i.test(r.c) && now > when(r.d, now) + 7 * DAY).map(r => ({ key: r.id + '|unpaid', outletId: ix.outletId(r.a), text: `${r.a} royalty ${r.b} ${idr(num(r.e))} unpaid 7 days after ${r.d}` }))),
  R('Stock transfer not received', 'state', '/owner/inventory/stock-transfer-between-outlets', (_db, now, ix) => ix.rec('transfer').filter(r => /^sent$/i.test(r.c) && now - r.at > DAY)
    .map(r => ({ key: r.id, outletId: ix.outletId(r.b), text: `${r.a} sent ${Math.floor((now - r.at) / HOUR)} h ago, not confirmed by ${r.b}` }))),
  R('Price differs from HQ', 'state', '/owner/catalog/price-lists-per-outlet-and-channel', (db, _now, ix) => db.outletProducts.filter(x => x.localPrice != null).flatMap(x => {
    const p = db.products.find(y => y.id === x.productId);
    return p && Math.abs(x.localPrice! - p.basePrice) > p.basePrice * .1 ? [{ key: `${p.id}|${x.outletId}|${x.localPrice}|${p.basePrice}`, outletId: x.outletId, text: `${p.name} at ${ix.name(x.outletId)} ${idr(x.localPrice!)} vs HQ ${idr(p.basePrice)} · outside ±10%` }] : [];
  })),
  // ── Assets & maintenance ──
  R('Equipment service due', 'state', '/owner/finance/assets-and-equipment', (_db, now, ix) => ix.rec('maintenance').filter(r => !/done/i.test(r.c) && when(r.d, now) <= now).map(r => ({ key: r.id + '|' + r.d, outletId: ix.outletId(r.b), text: `${r.a} at ${r.b} service due ${r.d}` }))),
  R('Repair cost high', 'state', '/owner/finance/assets-and-equipment', (_db, now, ix) => {
    const year = new Date(now).getFullYear(), rows = [...ix.rec('asset'), ...ix.rec('expense')], repairs = rows.filter(r => /repair|service|servis/i.test(r.a) && new Date(r.at).getFullYear() === year);
    return ix.rec('asset').filter(a => !/repair|service/i.test(a.a) && num(a.e) > 0).flatMap(a => {
      const w = a.a.split(/\s+/)[0].toLowerCase(), cost = repairs.filter(r => r.a.toLowerCase().includes(w)).reduce((s, r) => s + num(r.e), 0);
      return cost > .3 * num(a.e) ? [{ key: `${a.id}|${year}|${cost}`, outletId: ix.outletId(a.b), text: `${a.a}: repairs ${idr(cost)} this year · over 30% of its value ${idr(num(a.e))}` }] : [];
    });
  }),
  R('Warranty ending', 'state', '/owner/finance/assets-and-equipment', (_db, now, ix) => ix.rec('warranty').filter(r => { const t = when(r.d, now); return t >= now && t - now <= 30 * DAY; }).map(r => ({ key: r.id + '|' + r.d, outletId: ix.outletId(r.b), text: `${r.a} warranty ends ${r.d}` }))),
  R('Gas / water / power bill spike', 'state', '/owner/finance/expenses', (_db, now, ix) => {
    const cat = (a: string) => /listrik|electric|power|pln/i.test(a) ? 'power' : /gas|lpg/i.test(a) ? 'gas' : /water|air|pdam/i.test(a) ? 'water' : '';
    const sums = new Map<string, Map<string, number>>();
    for (const e of ix.rec('expense')) { const c = cat(e.a); if (!c) continue; const t = when(e.d, now), m = ym(Number.isFinite(t) ? t : e.at), k = c + '|' + e.b; const x = sums.get(k) ?? new Map(); x.set(m, (x.get(m) ?? 0) + num(e.e)); sums.set(k, x); }
    const cur = ym(now);
    return [...sums].flatMap(([k, ms]) => { const prev = [...ms].filter(([m]) => m < cur).map(([, v]) => v), avg = prev.length ? prev.reduce((a, v) => a + v, 0) / prev.length : 0, v = ms.get(cur) ?? 0;
      return avg > 0 && v > 1.4 * avg ? [{ key: `${k}|${cur}`, outletId: ix.outletId(k.split('|')[1]), text: `${k.split('|')[0]} bill ${k.split('|')[1]} ${idr(v)} · +${Math.round((v / avg - 1) * 100)}% vs average` }] : []; });
  }),
  // ── Services (salon · laundry) ──
  R('Booking with staff absent', 'state', '/owner/outlets/bookings-and-schedule', (db, now, ix) => ix.rec('booking').filter(r => /book/i.test(r.c) && r.e && when(r.d, now) - now < 2 * HOUR && when(r.d, now) > now - HOUR).flatMap(r => {
    const e = db.employees.find(x => x.name.toLowerCase() === r.e.toLowerCase() || x.id === r.e), o = ix.outletId(r.b), ro = o ? ix.roster(o) : undefined;
    const absent = !e || !e.active || (ro && !SLOTS.some(s => onRoster(ro, s).includes(e.id))) || (e && o && now > when(r.d, now) && !ix.clockIn(e.id, o, ix.t0));
    return absent ? [{ key: r.id, outletId: o, text: `${r.a} booked with ${r.e} at ${hhmm(when(r.d, now))} · ${r.e} is off or late` }] : [];
  })),
  R('Service running over', 'state', '/owner/outlets/bookings-and-schedule', (_db, now, ix) => ix.rec('booking').filter(r => /in service/i.test(r.c) && now > when(r.d, now) + (num(r.c.match(/\d+/)?.[0]) || 60) * MIN + 15 * MIN
    && ix.rec('booking').some(n => n.b === r.b && /book/i.test(n.c) && when(n.d, now) <= now)).map(r => ({ key: r.id, outletId: ix.outletId(r.b), text: `${r.a} running over · next guest waiting` }))),
  R('Laundry ready for pickup', 'state', '/owner/outlets/laundry-order-tracking', (_db, _now, ix) => [...ix.rec('laundry'), ...ix.rec('service').filter(r => /laundry/i.test(r.a))].filter(r => /ready/i.test(r.c) && phoneIn(`${r.a} ${r.e}`))
    .map(r => ({ key: r.id, outletId: ix.outletId(r.b), text: `${r.a} ready for pickup`, msg: { template: 'laundry_ready', to: phoneIn(`${r.a} ${r.e}`), customerId: null } }))),
  R('Laundry not picked up', 'state', '/owner/outlets/laundry-order-tracking', (_db, now, ix) => [...ix.rec('laundry'), ...ix.rec('service').filter(r => /laundry/i.test(r.a))].filter(r => /ready/i.test(r.c) && now - r.at > 7 * DAY)
    .map(r => { const to = phoneIn(`${r.a} ${r.e}`); return { key: r.id, outletId: ix.outletId(r.b), text: `${r.a} ready over 7 days, not picked up`, msg: to ? { template: 'laundry_reminder', to, customerId: null } : undefined }; })),
  R('Deposit not paid', 'state', '/owner/outlets/bookings-and-schedule', (_db, now, ix) => ix.rec('booking').filter(r => /deposit/i.test(r.c) && !/paid/i.test(r.c) && when(r.d, now) > now && when(r.d, now) - now <= 2 * HOUR)
    .map(r => { const to = phoneIn(r.a); return { key: r.id, outletId: ix.outletId(r.b), text: `${r.a} at ${hhmm(when(r.d, now))}: deposit not paid`, msg: to ? { template: 'deposit_reminder', to, customerId: null } : undefined }; })),
  // ── Retail ──
  R('Barcode not found', 'event', '/pos/selling/barcode-scan-and-quick-add', (_db, _now, ix) => ix.events.filter(a => /^(scan|barcode)\.(not_found|unknown)$/.test(a.action)).map(a => ({ key: a.id, outletId: a.outletId ?? null, text: `Scanned ${a.subject} has no product · ${ix.emp(a.actor)}` }))),
  R('Price label outdated', 'event', '/owner/catalog/barcode-and-label-printing', (db, _now, ix) => ix.events.filter(a => (a.action === 'price.changed' || (a.action === 'approval.approved' && /^Price /.test(a.subject))) && !db.audit.some(x => x.at > a.at && /label/.test(x.action)))
    .map(a => ({ key: a.id, outletId: a.outletId ?? null, text: `${a.subject.replace(/^Price /, '')} · reprint shelf labels` }))),
  R('Exchange over policy', 'state', '/pos/after-sale/exchange', (db, now) => [
    ...db.refunds.filter(r => now - r.at < DAY).flatMap(r => { const o = db.orders.find(x => x.id === r.orderId); return o?.paidAt && r.at - o.paidAt > 14 * DAY ? [{ key: r.id, outletId: o.outletId, text: `${o.no} returned ${Math.floor((r.at - o.paidAt) / DAY)} days after purchase · over the 14-day policy` }] : []; }),
    ...db.approvals.filter(a => a.type === 'refund' && a.status === 'waiting').flatMap(a => { const o = db.orders.find(x => x.id === a.subjectId); return o?.paidAt && a.at - o.paidAt > 14 * DAY ? [{ key: a.id, outletId: a.outletId, text: `${a.title} · bought ${Math.floor((a.at - o.paidAt) / DAY)} days ago, over the 14-day policy` }] : []; })]),
  R('Variant out of stock', 'state', '/owner/catalog/variant-matrix', (_db, _now, ix) => {
    const by = new Map<string, Rec[]>(); for (const r of ix.rec('variant')) by.set(r.a + '|' + r.b, [...(by.get(r.a + '|' + r.b) ?? []), r]);
    return [...by.values()].filter(rs => rs.some(r => num(r.e) <= 0) && rs.some(r => num(r.e) > 0)).map(rs => { const z = rs.filter(r => num(r.e) <= 0).map(r => r.c); return { key: `${rs[0].a}|${rs[0].b}|${z.join(',')}`, outletId: ix.outletId(rs[0].b), text: `${rs[0].a}: ${z.join(', ')} sold out while other variants are in stock` }; });
  }),
  // ── Data & compliance ──
  R('Export ready', 'event', '/owner/reports/export-center', (_db, _now, ix) => ix.events.filter(a => /(^export\.|\.exported$)/.test(a.action)).map(a => ({ key: a.id, outletId: a.outletId ?? null, text: `Export ready · ${a.subject || a.action}` }))),
  R('Data deletion request', 'state', '/owner/settings/settings-data-backup-and-delete-account', (_db, _now, ix) => ix.rec('data_request').filter(r => /request|new|pending/i.test(r.c)).map(r => ({ key: r.id, outletId: null, text: `${r.a} asked to delete their data · answer within 14 days` }))),
  R('Backup failed', 'external', '/admin/platform-overview', (_db, now, ix) => ix.rec('backup').filter(r => /fail/i.test(r.c) && now - r.at < 3 * DAY).map(r => ({ key: r.id, outletId: null, text: `Daily backup ${r.a} failed${r.e ? ': ' + r.e : ''}` }))),
  R('Unusual export', 'event', '/owner/account/store-audit-log', (_db, _now, ix) => ix.events.filter(a => /(^export\.|\.exported$)/.test(a.action) && /customer/i.test(a.action + a.subject) && num(a.subject.match(/\d[\d,.]*/)?.[0]) > 1000)
    .map(a => ({ key: a.id, outletId: a.outletId ?? null, text: `${ix.emp(a.actor)} exported ${a.subject}` }))),
  // ── System, sync & offline ──
  R('Register went offline', 'external', '/pos/after-sale/offline-mode-and-sync-queue', (db, now) => {
    const a = db.device.online ? null : db.audit.find(x => x.action === 'device.offline' || x.action === 'device.queued');
    return a && now - a.at > MIN ? [{ key: a.id, outletId: db.device.outletId, text: `This register lost internet at ${hhmm(a.at)} · cash and card keep working, QRIS waits` }] : [];
  }),
  R('Offline queue large', 'external', '/pos/after-sale/offline-mode-and-sync-queue', (db, now) => { const q = db.device.queue; return q.length > 50 || (q[0] && now - q[0].at > 2 * HOUR) ? [{ key: 'q2h|' + q[0].id, outletId: db.device.outletId, text: `${q.length} unsynced sales, oldest ${hhmm(q[0].at)} · reconnect to sync` }] : []; }),
  R('App update required', 'external', '/pos/device/register-settings', (_db, _now, ix) => ix.rec('release').filter(r => r.b === 'required' || /required|minimum/i.test(r.c)).map(r => ({ key: r.id, outletId: null, text: `Update to ${r.a} required · ${r.c}` }))),
  R('Device clock wrong', 'external', '/manager/devices/registers-and-devices-status', (db, now, ix) => db.devices.filter(d => d.lastSeen - now > 5 * MIN).map(d => ({ key: `${d.id}|${ix.date}`, outletId: d.outletId, text: `${d.name} clock is ${Math.round((d.lastSeen - now) / MIN)} min ahead · fix the device time` }))),
  R('Storage almost full', 'external', '/manager/devices/registers-and-devices-status', (db, _now, ix) => ix.rec('device_health').filter(r => r.e !== '' && num(r.e) < 500).map(r => ({ key: `${r.a}|${ix.date}`, outletId: db.devices.find(d => d.id === r.a)?.outletId ?? ix.outletId(r.b), text: `${db.devices.find(d => d.id === r.a)?.name ?? r.a}: ${num(r.e)} MB free` }))),
  // ── Marketing & messaging ──
  R('Campaign sent', 'state', '/owner/customers/broadcast', (_db, now, ix) => ix.rec('broadcast').filter(r => /sent/i.test(r.c) && now - r.at < 3 * DAY).map(r => ({ key: r.id, outletId: ix.outletId(r.b), text: `${r.a} sent to ${r.e} people` }))),
  R('WA template rejected', 'external', '/owner/messaging-and-automation/message-templates', tplRejected),
  R('WA credits low', 'external', '/owner/messaging-and-automation/messaging-credits-and-cost', (db, now, ix) => {
    const tops = ix.rec('credit_topup'); if (!tops.length) return [];
    const cost = (m: DB['messages'][0]) => m.status === 'failed' ? 0 : m.channel === 'wa' ? 356 : m.channel === 'sms' ? 450 : m.channel === 'email' ? 15 : 0;
    const bal = tops.reduce((a, t) => a + num(t.b), 0) - db.messages.reduce((a, m) => a + cost(m), 0), week = db.messages.filter(m => m.at > now - 7 * DAY).reduce((a, m) => a + cost(m), 0) / 7;
    const lastTop = num([...tops].sort((a, b) => b.at - a.at)[0].b);
    return bal < .1 * lastTop || (week > 0 && bal / week < 3) ? [{ key: ix.date, outletId: null, text: `Messaging credit ${idr(Math.max(0, Math.round(bal)))}${week > 0 ? ` · about ${Math.max(0, Math.floor(bal / week))} days left` : ''} · top up` }] : [];
  }),
  R('WA number quality dropped', 'external', '/owner/messaging-and-automation/whatsapp-business-connection-and-number-verification', db => db.integrations.filter(i => i.kind === 'whatsapp' && /yellow|red|medium|low/i.test(String(i.config.quality ?? '')))
    .map(i => ({ key: `${i.id}|${i.config.quality}`, outletId: i.outletId, text: `WhatsApp number quality is ${i.config.quality} · pause marketing sends` }))),
  R('Many unsubscribes', 'state', '/owner/messaging-and-automation/opt-in-and-consent', (db, _now, ix) => ix.rec('broadcast').filter(r => /sent/i.test(r.c) && num(r.e) > 0).flatMap(r => {
    const n = db.audit.filter(a => /opt(ed)?_out$/.test(a.action) && a.at >= r.at && a.at < r.at + 2 * DAY).length;
    return n / num(r.e) > .02 ? [{ key: r.id, outletId: ix.outletId(r.b), text: `${n} unsubscribed after “${r.a}” (${(n / num(r.e) * 100).toFixed(1)}%)` }] : [];
  })),
  R('Automation stopped', 'external', '/owner/messaging-and-automation/automation-performance', db => {
    const by = new Map<string, DB['messages']>(); for (const m of db.messages) by.set(m.template, [...(by.get(m.template) ?? []), m]);
    return [...by].flatMap(([t, ms]) => { const last = [...ms].sort((a, b) => b.at - a.at).slice(0, 3); return last.length === 3 && last.every(m => m.status === 'failed') ? [{ key: `${t}|${last[0].id}`, outletId: null, text: `“${t}” failed 3 times in a row · check the template and number` }] : []; });
  }),
  // ── Guest inbox & service ──
  R('Guest replied on WhatsApp', 'external', '/owner/messaging-and-automation/message-log-and-delivery-status', (_db, now, ix) => ix.rec('inbox').filter(r => now - r.at < DAY).map(r => ({ key: r.id, outletId: ix.outletId(r.b), text: `${r.a}: ${r.c}` }))),
  R('Guest message unanswered', 'external', '/owner/messaging-and-automation/message-log-and-delivery-status', (_db, now, ix) => ix.rec('inbox').filter(r => !/replied|closed/i.test(r.d) && now - r.at > 15 * MIN && now - r.at < DAY && (!ix.outletId(r.b) || ix.open(ix.outletId(r.b)!)))
    .map(r => ({ key: r.id, outletId: ix.outletId(r.b), text: `${r.a} waiting ${Math.round((now - r.at) / MIN)} min for a reply` }))),
  R('Complaint keywords', 'external', '/owner/messaging-and-automation/message-log-and-delivery-status', (_db, now, ix) => ix.rec('inbox').filter(r => now - r.at < DAY && /\b(basi|rambut|sakit perut|kecewa|kotor|jijik)\b/i.test(r.c))
    .map(r => ({ key: r.id, outletId: ix.outletId(r.b), text: `${r.a}: “${r.c}”` }))),
  R('Lost item reported', 'state', '/pic/floor/incident-log', (_db, now, ix) => [...ix.rec('lost_found'), ...ix.rec('incident').filter(r => /lost|found|hilang/i.test(r.a + ' ' + r.b))].filter(r => now - r.at < 3 * DAY)
    .map(r => ({ key: r.id, outletId: ix.outletId(r.a) ?? ix.outletId(r.b), text: `Lost & found: ${/lost|found/i.test(r.b) ? r.c : r.a}` }))),
  // ── Food safety & incidents ──
  R('Opening checklist not done', 'state', '/pic/cash-and-handover/handover-checklist-and-notes', (db, now, ix) => db.outlets.filter(o => ix.open(o.id) && now - ix.opens(o.id) > 30 * MIN).flatMap(o => {
    const r = ix.rec('checklist').find(x => ix.outletId(x.a) === o.id && x.b === ix.date && /open/i.test(x.c)), pct = r && num(r.e) > 0 ? num(r.d) / num(r.e) : 0;
    return pct < 1 ? [{ key: `${o.id}|${ix.date}`, outletId: o.id, text: `${o.name} opened ${hhmm(ix.opens(o.id))}, opening checklist ${Math.round(pct * 100)}% done` }] : [];
  })),
  R('Temperature log missing', 'state', '/pic/cash-and-handover/handover-checklist-and-notes', (db, now, ix) => {
    const at = [16, 10].find(h => now >= ix.t0 + h * HOUR); if (at == null) return [];
    const since = ix.t0 + (at === 16 ? 12 : 0) * HOUR;
    return db.outlets.filter(o => ix.open(o.id) && !ix.rec('temperature').some(r => ix.outletId(r.b) === o.id && r.at >= since))
      .map(o => ({ key: `${o.id}|${ix.date}|${at}`, outletId: o.id, text: `${o.name}: fridge temperature not logged by ${at}:00` }));
  }),
  R('Incident reported', 'event', '/pic/floor/incident-log', (_db, _now, ix) => ix.events.filter(a => a.action === 'incident.logged' || a.action === 'incident.saved').map(a => ({ key: a.id, outletId: a.outletId ?? null, text: `${a.subject} logged by ${ix.emp(a.actor)}` }))),
  R('Halal / supplier certificate expiring', 'state', '/owner/inventory/suppliers', (_db, now, ix) => ix.rec('certificate').filter(r => { const t = when(r.d, now); return t >= ix.t0 && t - now <= 30 * DAY; }).map(r => ({ key: r.id + '|' + r.d, outletId: ix.outletId(r.b), text: `${r.a} certificate ends ${r.d}` }))),
  R('Recall from supplier', 'external', '/owner/inventory/batches-and-expiry', (_db, _now, ix) => [...ix.rec('recall'), ...ix.rec('batch').filter(r => /recall/i.test(r.c))].map(r => ({ key: r.id, outletId: ix.outletId(r.b), text: `Recall: ${r.a}${r.b ? ' at ' + r.b : ''} · stop using it, set aside` }))),
  // ── HR ──
  R('Contract ending', 'state', '/owner/team/employees', (db, now, ix) => ix.rec('contract').filter(r => { const t = when(r.d, now); return t >= ix.t0 && t - now <= 30 * DAY; })
    .map(r => { const e = db.employees.find(x => x.id === r.a || x.name === r.a); return { key: r.id + '|' + r.d, outletId: e?.outlets[0] ?? null, text: `${e?.name ?? r.a} contract ends ${r.d}` }; })),
  R('Staff BPJS / docs missing', 'state', '/owner/team/employees', (db, now, ix) => db.audit.filter(a => a.action === 'employee.invited' && now - a.at > 7 * DAY).flatMap(a => {
    const e = db.employees.find(x => x.name === a.subject);
    return e && !ix.rec('staff_doc').some(r => r.a === e.id) ? [{ key: e.id, outletId: e.outlets[0] ?? null, text: `${e.name} joined over 7 days ago without BPJS / ID documents` }] : [];
  })),
  // ── Purchasing ──
  R('Goods received short', 'state', '/owner/inventory/goods-receipt-detail-and-partial-receive', db => db.pos.filter(p => p.status === 'partial').map(p => {
    const short = p.lines.filter(l => l.received < l.qty);
    return { key: `${p.id}|${p.lines.map(l => l.received).join(',')}`, outletId: p.outletId, text: `${p.no}: ${short.map(l => `${db.stockItems.find(s => s.id === l.stockItemId)?.name} ${l.received}/${l.qty}`).join(', ')}` };
  })),
  R('Goods damaged on arrival', 'state', '/owner/inventory/purchase-return-to-supplier', (db, now, ix) => [
    ...ix.rec('purchase_return').filter(r => now - r.at < 2 * DAY).map(r => ({ key: r.id, outletId: ix.outletId(r.b), text: `Damaged on arrival: ${r.a}${r.e ? ' · ' + r.e : ''}` })),
    ...db.movements.filter(m => m.type === 'waste' && m.sourceId && now - m.at < 2 * DAY && db.pos.some(p => p.id === m.sourceId)).map(m => ({ key: `${m.sourceId}|${m.stockItemId}|${m.at}`, outletId: m.outletId, text: `${db.pos.find(p => p.id === m.sourceId)?.no}: ${Math.abs(m.qty)} ${db.stockItems.find(s => s.id === m.stockItemId)?.name} damaged` }))]),
  R('Supplier didn’t confirm PO', 'state', '/owner/inventory/po-detail-and-print-send-via-wa', (db, now, ix) => db.pos.filter(p => p.status === 'sent' && !ix.rec('po_confirm').some(r => r.a === p.id)).flatMap(p => {
    const sent = db.approvals.find(a => a.type === 'po' && a.subjectId === p.id)?.decidedAt ?? p.at;
    return now - sent > 12 * HOUR ? [{ key: p.id, outletId: p.outletId, text: `${p.no} · ${db.suppliers.find(s => s.id === p.supplierId)?.name} has not confirmed ${Math.floor((now - sent) / HOUR)} h after sending` }] : [];
  })),
  // ── Hours, events & calendar ──
  R('Holiday hours not set', 'state', '/owner/settings/settings-opening-hours', (db, now, ix) => {
    const y = new Date(now).getFullYear(), days = [...FIXED_HOLIDAYS.flatMap(([md, n]) => [y, y + 1].map(yy => [`${yy}-${md}`, n] as [string, string])), ...ix.rec('holiday').map(r => [ymd(when(r.d, now)), r.a] as [string, string])];
    return days.filter(([d]) => { const t = when(d, now); return t > ix.t0 && t - ix.t0 <= 7 * DAY; }).flatMap(([d, n]) => db.outlets.filter(o => !db.audit.some(a => a.action === 'outlet.updated' && a.outletId === o.id && now - a.at < 30 * DAY))
      .map(o => ({ key: `${o.id}|${d}`, outletId: o.id, text: `${n} on ${d}: ${o.name} hours unchanged (${o.opens}–${o.closes})` })));
  }),
  R('Season theme starts', 'state', '/owner/menu-studio-customer-facing/menu-studio-publish-schedule-seasonal-theme', (_db, now, ix) => ix.rec('studio_schedule').filter(r => r.d === 'scheduled' && ymd(num(r.c)) === ymd(ix.t0 + DAY + HOUR))
    .map(r => ({ key: r.id, outletId: null, text: `${r.b || 'Scheduled theme'} goes live tomorrow ${hhmm(num(r.c))}` }))),
  R('Closing early', 'event', '/manager/operations/daily-cash-reconciliation-and-close', (_db, _now, ix) => ix.events.filter(a => a.action === 'day.closed' && a.outletId && a.at < ix.closes(a.outletId) - 30 * MIN && a.at >= ix.t0)
    .map(a => ({ key: a.id, outletId: a.outletId!, text: `${ix.name(a.outletId!)} closed early at ${hhmm(a.at)} (normally ${hhmm(ix.closes(a.outletId!))}) · ${ix.emp(a.actor)}` }))),
];

/** Catalog alerts raised at the moment of the event by service code (file:function). No sweep rule. */
export const SERVICE: Record<string, string> = {
  'Thank you after visit': 'src/data/alerts/automations.ts:automationMessages', // its settings are the a_thanks automation
  'Low stock': 'src/data/actions.ts:settleIfDone',
  'Out of stock': 'src/data/actions.ts:settleIfDone',
  'Opname waiting to sign': 'src/data/actions.ts:requestApproval',
  'Payment failed / declined': 'src/data/actions.ts:gatewayWebhook',
  'QRIS gateway down': 'src/data/actions/integrations.ts:reportIntegration',
  'Big order': 'src/data/actions.ts:settleIfDone',
  'Approval decided': 'src/data/actions.ts:decide',
  'New QR / kiosk / online order': 'src/data/actions.ts:settleIfDone',
  'Discount / void / refund request': 'src/data/actions.ts:requestApproval',
  'Refund over IDR 500k': 'src/data/actions.ts:requestApproval',
  'Price change request': 'src/data/actions.ts:requestApproval',
  'Local menu item waiting': 'src/data/actions.ts:requestApproval',
  'Publish waiting': 'src/data/actions.ts:requestApproval',
  'Approval not answered': 'src/data/actions.ts:escalateDue',
  'Cash variance': 'src/data/actions.ts:closeSession',
  'Swap request': 'src/data/actions/shifts.ts:requestSwap',
  'Day closed': 'src/data/actions/manager.ts:closeDay',
  'New order': 'src/data/actions.ts:sendToKitchen',
  'Order late': 'src/data/actions.ts:watchKitchen',
  'Order ready': 'src/data/actions.ts:orderReady',
  'Guest call': 'src/data/actions/selforder.ts:guestCall',
  'Item sold out (86)': 'src/data/actions.ts:toggle86',
  'Too many wrong PINs': 'src/data/actions.ts:verifyPin',
  'Support access requested': 'src/data/actions/admin.ts:requestSupportAccess',
  'Integration disconnected': 'src/data/actions/integrations.ts:reportIntegration',
  'New reservation': 'src/data/actions/selforder.ts:bookTable',
  'Menu sync failed': 'src/data/actions/integrations.ts:reportIntegration',
  'Busy mode on': 'src/data/actions/online.ts:setBusy',
  'Pickup code mismatch': 'src/data/actions/online.ts:handOverWithoutCode',
  'Accounting sync failed': 'src/data/actions/integrations.ts:reportIntegration',
  'Roster published': 'src/data/actions/shifts.ts:publishRoster',
  'Swap / leave decided': 'src/data/actions.ts:decide',
  'Customer display disconnected': 'src/data/actions/integrations.ts:reportIntegration',
  'Allergy order': 'src/data/actions.ts:sendToKitchen',
  'PO approved / rejected': 'src/data/actions.ts:decide',
};
