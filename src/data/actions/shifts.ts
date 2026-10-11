'use client';
// Roster services (Shifts): one commit per roster edit, publish to WhatsApp, swap requests, no-show alerts.
import { commit, snapshot, uid } from '../store.ts';
import { requestApproval } from '../actions.ts';
import { notice, putRecord } from './pic.ts';

type Slot = 'pagi' | 'siang' | 'malam';
const SLOTS: Slot[] = ['pagi', 'siang', 'malam'];
const now = () => Date.now();

/** Moves one person to a slot (or off) for a day. Leaving a slot as its PIC leaves that slot without a PIC until one is picked. */
export function assignShift(outletId: string, day: number, empId: string, slot: Slot | 'off', by: string) {
  commit('roster.updated', by, d => {
    const r = d.roster.find(x => x.outletId === outletId && x.day === day); if (!r) return;
    for (const s of SLOTS) { r.slots[s].crew = r.slots[s].crew.filter(x => x !== empId); if (r.slots[s].pic === empId && s !== slot) r.slots[s].pic = ''; }
    if (slot !== 'off' && r.slots[slot].pic !== empId) r.slots[slot].crew.push(empId);
  }, `${outletId} day ${day} ${empId}`, outletId);
}
/** Exactly one PIC per shift: the new PIC replaces the old one, who stays on the crew. */
export function assignPic(outletId: string, day: number, slot: Slot, picId: string, by: string) {
  commit('roster.updated', by, d => {
    const r = d.roster.find(x => x.outletId === outletId && x.day === day); if (!r) return;
    const x = r.slots[slot], old = x.pic;
    x.crew = x.crew.filter(c => c !== picId);
    if (old && old !== picId && !x.crew.includes(old)) x.crew.push(old);
    x.pic = picId;
  }, `${outletId} day ${day} ${slot} PIC`, outletId);
}
export function publishRoster(outletId: string, week: string, messages: { employeeId: string; phone: string; text: string }[], by: string) {
  commit('roster.published', by, d => {
    for (const m of messages) d.messages.unshift({ id: uid('ms'), channel: 'wa', template: 'roster_week', to: m.phone, status: 'queued', at: now(), customerId: null });
    putRecord(d, 'roster_publish', { id: `${outletId}|${week}`, a: outletId, b: week, c: by, d: String(messages.length), e: messages[0]?.text ?? '', at: now() });
    notice(d, 'Roster published', 'info', ['pic', 'cashier', 'kitchen', 'waiter', 'manager'], outletId, `Roster for ${week} sent to ${messages.length} people on WhatsApp`, '/manager/shifts/publish-roster-to-whatsapp');
  }, week, outletId);
}
export function requestSwap(a: { outletId: string; day: number; slot: Slot; from: string; to: string; title: string; note: string }, by: string) {
  const r = requestApproval({ type: 'leave', title: a.title, requestedBy: by, outletId: a.outletId, note: a.note, payload: { kind: 'swap', day: a.day, slot: a.slot, from: a.from, to: a.to } });
  commit('swap.requested', by, d => notice(d, 'Swap request', 'info', ['manager', 'pic'], a.outletId, a.title, '/manager/team/schedules-and-attendance'));
  return r;
}
/** Runs after the swap approval is approved: the roster changes once, with the approval as the source. */
export function applySwap(approvalId: string, by: string) {
  const a = snapshot().approvals.find(x => x.id === approvalId);
  const p = a?.payload as { kind?: string; day: number; slot: Slot; from: string; to: string; applied?: boolean } | undefined;
  if (!a || a.status !== 'approved' || p?.kind !== 'swap' || p.applied) return;
  commit('roster.swapped', by, d => {
    const r = d.roster.find(x => x.outletId === a.outletId && x.day === p.day);
    const ap = d.approvals.find(x => x.id === approvalId)!;
    if (r) { const x = r.slots[p.slot]; if (x.pic === p.from) x.pic = p.to; else x.crew = [...x.crew.filter(c => c !== p.from && c !== p.to), p.to]; }
    ap.payload = { ...ap.payload, applied: true };
  }, approvalId, a.outletId);
}
export function alertNoShow(outletId: string, empName: string, slotLabel: string, by: string) {
  commit('attendance.no_show', by, d => notice(d, 'Late / no-show', 'warn', ['pic', 'manager'], outletId, `${empName} has not clocked in for ${slotLabel} · find cover`, '/manager/team/schedules-and-attendance'), empName, outletId);
}
