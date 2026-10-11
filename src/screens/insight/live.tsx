'use client';
// Live owner state shared by the owner dashboard and owner mobile: who leads each outlet now, devices, targets,
// and the decision queue (approvals at the owner's level + things the numbers say need a look).
import type { Approval, DB, Employee, Role } from '../../data/schema.ts';
import { canDecide, type Level } from '../../domain/approval.ts';
import { idr, idrShort } from '../../domain/money.ts';
import { SHIFTS } from '../../domain/shift.ts';
import { decide } from '../../data/actions.ts';
import { usePin } from '../../ui/PinSheet.tsx';
import { toast } from '../../ui/kit.tsx';
import { DAY, HOUR, lateOrders, openOrders, soldOrders, startOfDay, summary } from './metrics.ts';

type Slot = keyof typeof SHIFTS;
/** Roster day index: Monday = 0 (spec/bn-shift.js). Afternoon until 18:00, then the close lead takes over. */
export const rosterDay = (now = Date.now()) => (new Date(now).getDay() + 6) % 7;
export const slotAt = (now = Date.now()): Slot => { const h = new Date(now).getHours(); return h < 14 ? 'pagi' : h < 18 ? 'siang' : 'malam'; };
const hm = (s: string) => { const [h, m] = s.split(':').map(Number); return h * HOUR + m * 60e3; };

export function onShift(db: DB, outletId: string, now = Date.now()) {
  const o = db.outlets.find(x => x.id === outletId)!, t0 = startOfDay(now);
  const open = now >= t0 + hm(o.opens) && now < t0 + hm(o.closes);
  const slot = slotAt(now), day = db.roster.find(r => r.outletId === outletId && r.day === rosterDay(now));
  const emp = (id: string) => db.employees.find(e => e.id === id);
  const pic = open && day ? emp(day.slots[slot].pic) : undefined;
  const crew = open && day ? day.slots[slot].crew.map(emp).filter((e): e is Employee => !!e) : [];
  return { open, slot, slotName: SHIFTS[slot][0], pic, staff: (pic ? 1 : 0) + crew.length };
}

export const targetKey = (outletId: string) => `/owner/outlets/targets-and-kpis:daily-target-${outletId}`;
/** Daily revenue target: the owner's setting, else the average of the last 7 full days. */
export function targetFor(db: DB, outletId: string, now = Date.now()): { value: number; auto: boolean } {
  const set = Number(db.settings[targetKey(outletId)]);
  if (set > 0) return { value: set, auto: false };
  const t0 = startOfDay(now), rev = soldOrders(db, outletId, { from: t0 - 7 * DAY, to: t0 }).reduce((a, o) => a + o.total, 0);
  return { value: Math.round(rev / 7), auto: true };
}
/** Share of today's trading hours already passed (0..1), for pace against target. */
export function dayElapsed(db: DB, outletId: string, now = Date.now()) {
  const o = db.outlets.find(x => x.id === outletId)!, t0 = startOfDay(now), a = t0 + hm(o.opens), b = t0 + hm(o.closes);
  return Math.min(1, Math.max(0, (now - a) / (b - a)));
}

export interface OutletLive { id: string; name: string; revenue: number; orders: number; open: number; late: number; target: number; autoTarget: boolean; ofTarget: number; pace: number | null; pic?: Employee; staff: number; trading: boolean; devicesOnline: number; devices: number; offline: boolean }
export function outletsLive(db: DB, now = Date.now()): OutletLive[] {
  const today = { from: startOfDay(now), to: now };
  return db.outlets.map(o => {
    const s = summary(db, o.id, today), t = targetFor(db, o.id, now), sh = onShift(db, o.id, now), el = dayElapsed(db, o.id, now);
    const devs = db.devices.filter(d => d.outletId === o.id), on = devs.filter(d => d.status === 'online').length;
    return { id: o.id, name: o.name, revenue: s.revenue, orders: s.orders, open: openOrders(db, o.id).length, late: lateOrders(db, o.id, now).length,
      target: t.value, autoTarget: t.auto, ofTarget: t.value ? s.revenue / t.value : 0, pace: el > 0.05 && t.value ? s.revenue / (t.value * el) : null,
      pic: sh.pic, staff: sh.staff, trading: sh.open, devicesOnline: on, devices: devs.length, offline: !o.online || (devs.length > 0 && on === 0) };
  });
}

// ── Decisions ────────────────────────────────────────────────────────────────────────────
export const levelOf = (role: Role): Level => (role === 'owner' ? 'owner' : role === 'manager' ? 'manager' : role === 'pic' ? 'pic' : 'cashier');
/** Approvals this person can decide: waiting at exactly their level, never their own. */
export const myQueue = (db: DB, me: { id: string; role: Role }, outlet = 'all') =>
  db.approvals.filter(a => a.status === 'waiting' && a.level === levelOf(me.role) && (outlet === 'all' || a.outletId === outlet)
    && (me.role === 'owner' || !!db.employees.find(e => e.id === me.id)?.outlets.includes(a.outletId)) && canDecide(a, { id: me.id, level: levelOf(me.role) }));

export const isSupportAccess = (a: Approval) => a.type === 'perm' && (a.payload as { kind?: string } | undefined)?.kind === 'support_access';
export function verbs(a: Approval): { ok: string; no: string; noDecision: 'rejected' | 'recount' } {
  if (a.type === 'opname') return { ok: 'Approve count', no: 'Ask recount', noDecision: 'recount' };
  if (a.type === 'local_item') return { ok: (a.payload as { promote?: boolean } | undefined)?.promote ? 'Make global' : 'Approve item', no: 'Reject', noDecision: 'rejected' };
  if (isSupportAccess(a)) return { ok: 'Grant access', no: 'Deny', noDecision: 'rejected' };
  if (a.type === 'refund') return { ok: 'Approve refund', no: 'Reject', noDecision: 'rejected' };
  if (a.type === 'price') return { ok: 'Approve price', no: 'Reject', noDecision: 'rejected' };
  if (a.type === 'points') return { ok: 'Apply beans', no: 'Reject', noDecision: 'rejected' };
  return { ok: 'Approve', no: 'Reject', noDecision: 'rejected' };
}
export const TYPE_LABEL: Partial<Record<Approval['type'], string>> = { refund: 'Refund', void: 'Void', discount: 'Discount', local_item: 'New menu item', price: 'Price change', po: 'Purchase order', opname: 'Stock count', variance: 'Cash variance', publish: 'Publish', payroll: 'Payroll', points: 'Points adjustment', perm: 'Access', cash_out: 'Cash out', waste: 'Waste', adjust: 'Stock adjustment' };
export const typeLabel = (a: Approval) => (isSupportAccess(a) ? 'Support access' : TYPE_LABEL[a.type] ?? a.type.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase()));
export const amountOf = (a: Approval) => (a.amount && a.type !== 'local_item' && a.type !== 'points' ? idr(a.amount) : a.type === 'points' ? `${Number((a.payload as { points?: number } | undefined)?.points ?? 0) > 0 ? '+' : ''}${(a.payload as { points?: number } | undefined)?.points ?? 0} beans` : '');

/** Approve / reject with the approver's PIN. Render `sheet` once. */
export function useDecide() {
  const pin = usePin();
  const ask = (a: Approval, approve: boolean, extra?: Record<string, unknown>) => {
    const v = verbs(a), decision = approve ? 'approved' : v.noDecision;
    pin.ask({ title: a.title, detail: approve ? undefined : 'The requester is told right away.', verb: approve ? v.ok : v.no,
      onOk: by => { const err = decide(a.id, by, decision, '', extra); toast(err ?? `${approve ? v.ok : v.no} · ${a.title}`); } });
  };
  return { ask, sheet: pin.sheet };
}

/** Things the numbers say need the owner (besides approvals). Each opens the page where it's handled. */
export function watchItems(db: DB, outlet: string, now = Date.now()) {
  const items: { id: string; tone: 'danger' | 'warning' | 'info'; title: string; detail: string; href: string; cta: string }[] = [];
  for (const o of outletsLive(db, now)) {
    if (outlet !== 'all' && o.id !== outlet) continue;
    if (o.offline) items.push({ id: 'off-' + o.id, tone: 'danger', title: `${o.name} is offline`, detail: `${o.devicesOnline} of ${o.devices} devices online. Cash and card keep working; QRIS waits.`, href: '/owner/account/devices', cta: 'Open devices' });
    else if (o.trading && o.pace != null && o.pace < 0.85) items.push({ id: 'tg-' + o.id, tone: 'warning', title: `${o.name} at ${Math.round(o.ofTarget * 100)}% of target`, detail: `${idrShort(o.revenue)} of ${idrShort(o.target)} · ${Math.round(o.pace * 100)}% of pace`, href: '/owner/outlets/targets-and-kpis', cta: 'View' });
    if (o.late) items.push({ id: 'late-' + o.id, tone: 'danger', title: `${o.late} order${o.late > 1 ? 's' : ''} over 12 min at ${o.name}`, detail: 'Waiting in the kitchen or for payment', href: '/owner/sales/open-bills-across-outlets', cta: 'Open bills' });
  }
  for (const r of db.reviews.filter(r => r.stars <= 2 && !r.reply && (outlet === 'all' || r.outletId === outlet)))
    items.push({ id: 'rv-' + r.id, tone: 'warning', title: `${r.stars}-star review from ${r.name}`, detail: `“${r.text}” · ${db.outlets.find(o => o.id === r.outletId)?.name}`, href: '/owner/customers/reviews-and-feedback', cta: 'Reply' });
  return items;
}
