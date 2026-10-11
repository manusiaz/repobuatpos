'use client';
// Manager services: forward an owner-gated request with the manager's note, reservations, daily close (Z report).
import { commit, uid } from '../store.ts';
import type { Reservation } from '../schema.ts';
import { notice, putRecord } from './pic.ts';

const now = () => Date.now();

/** The request already sits at owner level; the manager's "Send to owner" adds their check and pings the owner. */
export function sendToOwner(approvalId: string, note: string, by: string) {
  commit('approval.sent_to_owner', by, d => {
    const r = d.approvals.find(x => x.id === approvalId); if (!r) return;
    r.payload = { ...r.payload, sentBy: by, sentAt: now(), sentNote: note };
    notice(d, 'Approval not answered', 'high', ['owner'], r.outletId, `${r.title} · checked by ${d.employees.find(e => e.id === by)?.name ?? by}, waiting for owner`, '/owner/monitor/notifications-and-activity-center');
  }, approvalId);
}
export function addReservation(r: Omit<Reservation, 'id' | 'status'>, by: string) {
  const id = uid('rs');
  commit('reservation.created', by, d => {
    d.reservations.push({ ...r, id, status: 'booked' });
    notice(d, 'New reservation', 'info', ['manager', 'pic'], r.outletId, `${r.name} · ${r.guests} guests · ${new Date(r.at).toTimeString().slice(0, 5)} · ${r.table}`);
  }, r.name, r.outletId);
  return id;
}
/** Z report: one row per outlet per business date (a outlet · b date · c who · d totals JSON). */
export function closeDay(outletId: string, date: string, totals: Record<string, number>, by: string) {
  commit('day.closed', by, d => {
    putRecord(d, 'day_close', { id: `${outletId}|${date}`, a: outletId, b: date, c: by, d: JSON.stringify(totals), e: '', at: now() });
    notice(d, 'Day closed', 'info', ['owner'], outletId, `${d.outlets.find(o => o.id === outletId)?.name} day closed · Z report sent`, '/manager/operations/daily-cash-reconciliation-and-close');
  }, date, outletId);
}
