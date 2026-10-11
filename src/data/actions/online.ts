'use client';
// Online & ride-hailing services on top of actions.ts: channel settings (busy mode, pause, auto-accept, connection),
// scheduled orders held until fire time, missed accept window, hand-over without code, and approved exceptions.
import { commit, snapshot } from '../store.ts';
import type { DB, Order } from '../schema.ts';
import { acceptOnline, patchOrder, pickedUp, readyBy, rejectOnline, requestApproval, sendToKitchen, setSetting, simulatePlatformOrder } from '../actions.ts';
import type { Source } from '../../domain/order.ts';
import { notice } from './kds.ts';

export const CHANNELS = ['gofood', 'grabfood', 'shopeefood', 'web'] as const;
export type Channel = (typeof CHANNELS)[number];
/** Settings live on the integrations page: key = page path + ':' + outlet + '.' + id. */
export const SETTINGS_PAGE = '/owner/sales/ride-hailing-integrations';
export const skey = (outletId: string, id: string) => `${SETTINGS_PAGE}:${outletId}.${id}`;
export const BUSY_MAX_MIN = 30, PAUSE_MAX_MIN = 60, ACCEPT_WINDOW_MS = 3 * 60e3;
/** A pre-order: the platform's slot is far beyond any tier's prep time. */
export const SCHEDULED_AFTER_MS = 45 * 60e3;

export function channelState(d: Pick<DB, 'settings'>, outletId: string, ch: Channel, at = Date.now()) {
  const g = (id: string) => d.settings[skey(outletId, ch + '.' + id)];
  const pausedUntil = Number(g('pausedUntil') ?? 0);
  return { connected: g('connected') !== false, auto: g('auto') === true, paused: pausedUntil > at, pausedUntil, pauseReason: String(g('pauseReason') ?? '') };
}
export function busyState(d: Pick<DB, 'settings'>, outletId: string, at = Date.now()) {
  const until = Number(d.settings[skey(outletId, 'busy.until')] ?? 0), on = until > at;
  return { on, until, extra: on ? Number(d.settings[skey(outletId, 'busy.extra')] ?? 0) : 0, reason: String(d.settings[skey(outletId, 'busy.reason')] ?? '') };
}
export const isScheduled = (o: Order) => !!o.readyBy && o.readyBy - o.createdAt > SCHEDULED_AFTER_MS;
/** Fire time = slot − the channel's prep for that tier (same formula as ready-by, without kitchen load). */
export const fireAt = (o: Order) => (o.readyBy ?? 0) - readyBy(o.tier ?? 'standard', o.source, 0, 0);
/** The last 4 of the platform order code, printed big on the bag. */
export const pickupCode = (o: Order) => o.idemKey.replace(/[^a-z0-9]/gi, '').slice(-4).toUpperCase();

export function setBusy(outletId: string, extra: 0 | 10 | 20, minutes: number, reason: string, by: string) {
  if (extra && !reason.trim()) return 'Add a reason';
  const until = extra ? Date.now() + Math.min(minutes, BUSY_MAX_MIN) * 60e3 : 0;
  commit('online.busy', by, d => {
    d.settings[skey(outletId, 'busy.extra')] = extra; d.settings[skey(outletId, 'busy.until')] = until; d.settings[skey(outletId, 'busy.reason')] = reason.trim();
    if (extra) notice(d, 'Busy mode on', 'warn', ['pic', 'manager'], outletId, `Busy mode +${extra} min on every platform for ${Math.min(minutes, BUSY_MAX_MIN)} min · ${reason.trim()}`, '/online');
  }, 'busy', outletId);
  return null;
}
export function setPause(outletId: string, ch: Channel, minutes: number, reason: string, by: string) {
  if (minutes && !reason.trim()) return 'Add a reason';
  const until = minutes ? Date.now() + Math.min(minutes, PAUSE_MAX_MIN) * 60e3 : 0;
  commit('online.pause', by, d => {
    d.settings[skey(outletId, ch + '.pausedUntil')] = until; d.settings[skey(outletId, ch + '.pauseReason')] = reason.trim();
    if (minutes) notice(d, 'Channel paused', 'warn', ['pic', 'manager'], outletId, `${ch} paused for ${Math.min(minutes, PAUSE_MAX_MIN)} min · ${reason.trim()}`, '/online');
  }, ch, outletId);
  return null;
}
export const setChannel = (outletId: string, ch: Channel, id: 'connected' | 'auto', on: boolean, by: string) => setSetting(skey(outletId, ch + '.' + id), on, by);

/** Demo: what the platform webhook would deliver. Paused / disconnected channels send nothing. */
export function receiveDemoOrder(outletId: string, ch: Channel, scheduled: boolean, by: string): string | null {
  const d0 = snapshot(), st = channelState(d0, outletId, ch);
  if (!st.connected) return `${ch} is disconnected`;
  if (st.paused) return `${ch} is paused`;
  const id = simulatePlatformOrder(outletId, ch as Source);
  const o = snapshot().orders.find(x => x.id === id)!, busy = busyState(snapshot(), outletId);
  if (scheduled) patchOrder(id, { readyBy: Date.now() + (60 + Math.round(Math.random() * 60)) * 60e3 }, ch);
  else if (busy.extra && o.readyBy) patchOrder(id, { readyBy: o.readyBy + busy.extra * 60e3 }, ch);
  if (st.auto) accept(id, 'system');
  return null;
}
/** Accept: normal orders fire now; scheduled ones are held and fire at slot − prep. */
export function accept(orderId: string, by: string) {
  const o = snapshot().orders.find(x => x.id === orderId);
  if (!o || o.status !== 'open') return;
  if (isScheduled(o) && fireAt(o) > Date.now()) commit('online.accepted', by, d => { const x = d.orders.find(y => y.id === orderId)!; x.cashierId = by; x.status = 'held'; }, orderId);
  else acceptOnline(orderId, by);
}
export function fireScheduled(orderId: string, by: string) {
  const o = snapshot().orders.find(x => x.id === orderId);
  if (o?.status === 'held') sendToKitchen(orderId, by);
}
/** Platform cancels orders not accepted inside its window. Guarded so several open screens don't double-write. */
export function missOnline(orderId: string) {
  if (snapshot().orders.find(x => x.id === orderId)?.status !== 'open') return;
  commit('online.missed', 'system', d => {
    const o = d.orders.find(x => x.id === orderId); if (!o || o.status !== 'open') return;
    o.status = 'voided'; o.note = 'Missed: not accepted in time · cancelled by the platform';
    notice(d, 'Missed online order', 'high', ['pic', 'manager'], o.outletId, `${o.source} ${o.no} not accepted in time and was cancelled`, '/online');
  }, orderId);
}
export function handOver(orderId: string, by: string) {
  const o = snapshot().orders.find(x => x.id === orderId);
  if (o?.status === 'ready') pickedUp(orderId, by);
}
/** Driver's code didn't match: the person who signed and why are kept on the alert and in the audit log. */
export function handOverWithoutCode(orderId: string, reason: string, approverId: string, by: string) {
  const o = snapshot().orders.find(x => x.id === orderId);
  if (o?.status !== 'ready') return;
  commit('online.handover_without_code', approverId, d => notice(d, 'Pickup code mismatch', 'warn', ['pic', 'manager'], o.outletId, `${o.source} ${o.no} handed over without pickup code · ${reason} · signed by ${d.employees.find(e => e.id === approverId)?.name ?? approverId}`), orderId, o.outletId);
  pickedUp(orderId, by);
}

/** 'a' in the permission matrix: the request waits for a PIC; the effect runs once when it is approved. */
export type OnlineAsk = { kind: 'reject'; orderId: string; reason: string } | { kind: 'handover'; orderId: string; reason: string }
  | { kind: 'busy'; extra: 0 | 10 | 20; minutes: number; reason: string } | { kind: 'pause'; ch: Channel; minutes: number; reason: string } | { kind: 'fire'; orderId: string };
export function askOnline(ask: OnlineAsk, title: string, by: string, outletId: string) {
  return requestApproval({ type: 'reject_online', title, requestedBy: by, outletId, subjectId: 'orderId' in ask ? ask.orderId : null, note: 'reason' in ask ? ask.reason : '', payload: { online: ask } });
}
export function applyApproved(approvalId: string) {
  const a0 = snapshot().approvals.find(x => x.id === approvalId);
  if (a0?.status !== 'approved' || (a0.payload as { applied?: boolean } | undefined)?.applied) return;
  let ask: OnlineAsk | null = null, by = '', outletId = '';
  commit('online.approved_applied', 'system', d => {
    const a = d.approvals.find(x => x.id === approvalId), pl = a?.payload as { online?: OnlineAsk; applied?: boolean } | undefined;
    if (!a || a.status !== 'approved' || !pl?.online || pl.applied) return;
    pl.applied = true; ask = pl.online; by = a.decidedBy ?? a.requestedBy; outletId = a.outletId;
  }, approvalId);
  const x = ask as OnlineAsk | null;
  if (!x) return;
  if (x.kind === 'reject') { const o = snapshot().orders.find(y => y.id === x.orderId); if (o?.status === 'open') rejectOnline(x.orderId, x.reason, by); }
  if (x.kind === 'handover') handOverWithoutCode(x.orderId, x.reason, by, by);
  if (x.kind === 'busy') setBusy(outletId, x.extra, x.minutes, x.reason, by);
  if (x.kind === 'pause') setPause(outletId, x.ch, x.minutes, x.reason, by);
  if (x.kind === 'fire') fireScheduled(x.orderId, by);
}
export const pendingAsk = (d: DB, outletId: string) => d.approvals.filter(a => a.outletId === outletId && a.type === 'reject_online' && a.status === 'waiting' && (a.payload as { online?: OnlineAsk } | undefined)?.online);
