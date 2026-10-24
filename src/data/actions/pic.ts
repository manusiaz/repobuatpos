'use client';
// PIC (shift lead) services: blind opname with photo proof + recount, drawer count by the PIC, handover, pass PIC, incidents.
// Kept outside actions.ts (shared file); every write still goes through commit().
import { commit, snapshot, uid } from '../store.ts';
import { closeSession, requestApproval } from '../actions.ts';
import type { DB, Rec } from '../schema.ts';
import { idr } from '../../domain/money.ts';
import { level, opnameApprover, opnameVariance, type OpnameLine } from '../../domain/stock.ts';

const now = () => Date.now();
/** One alert engine: recipients from the alert catalog (actions.ts notify). */
import { notify as notice } from '../actions.ts';
export { notice };
export function putRecord(d: DB, object: string, row: Rec) {
  const l = d.records[object] ?? (d.records[object] = []);
  const i = l.findIndex(x => x.id === row.id);
  if (i >= 0) l[i] = row; else l.unshift(row);
}
const name = (d: DB, id: string) => d.employees.find(e => e.id === id)?.name ?? id;

// ── Opname ──────────────────────────────────────────────────────────────────────────────
/** A line counts once it holds a real number (NaN turns into null after the store round-trips through JSON). */
export const isCounted = (l: Pick<OpnameLine, 'counted'>) => typeof l.counted === 'number' && Number.isFinite(l.counted);
const log = (d: DB, opnameId: string, text: string, by: string) => putRecord(d, 'opname_log', { id: uid('ol'), a: opnameId, b: text, c: by, d: '', e: '', at: now() });

function send(opnameId: string, by: string) {
  const op = snapshot().opnames.find(x => x.id === opnameId)!;
  const lines = op.lines.filter(isCounted), value = opnameVariance(lines);
  return requestApproval({ type: 'opname', title: `Opname ${op.area} · variance ${idr(value)}`, amount: value, requestedBy: by, countedBy: op.countedBy, outletId: op.outletId, subjectId: op.id,
    note: `${lines.length} lines counted · approver ${opnameApprover(lines)}` });
}
/** Submit & lock: uncounted lines (other areas) drop out, counted lines lock, approval goes up the ladder by variance value. */
export function submitCount(opnameId: string, by: string) {
  const op = snapshot().opnames.find(x => x.id === opnameId);
  if (!op || op.status !== 'counting' || !op.lines.some(isCounted)) return null;
  commit('opname.submitted', by, d => {
    const o = d.opnames.find(x => x.id === opnameId)!;
    o.lines = o.lines.filter(isCounted).map(l => ({ ...l, locked: true })); o.status = 'locked';
    log(d, opnameId, `Submitted & locked · ${o.lines.length} items · ${name(d, by)}`, by);
  }, opnameId, op.outletId);
  return send(opnameId, by);
}
/** Photo proof can be added after the lock (differences only show then); the count itself never changes. */
export function opnamePhoto(opnameId: string, stockItemId: string, photo: string, by: string) {
  commit('opname.photo', by, d => {
    const o = d.opnames.find(x => x.id === opnameId); if (!o || !['counting', 'locked', 'recount'].includes(o.status)) return;
    const l = o.lines.find(x => x.stockItemId === stockItemId); if (l) l.photo = photo;
  }, stockItemId);
}
/** Correction after "Ask recount": the new line replaces the old one for posting; the first count stays in recountOf and the log. */
export function recountLine(opnameId: string, stockItemId: string, counted: number, by: string) {
  commit('opname.recounted', by, d => {
    const o = d.opnames.find(x => x.id === opnameId); if (!o || o.status !== 'recount') return;
    const i = o.lines.findIndex(x => x.stockItemId === stockItemId); if (i < 0) return;
    const prev = o.lines[i], item = d.stockItems.find(s => s.id === stockItemId);
    o.lines[i] = { ...prev, counted, recountOf: String(prev.counted), locked: true, photo: counted === prev.counted ? prev.photo : undefined,
      systemQty: counted === prev.counted ? prev.systemQty : Math.round(level(d.movements, o.outletId, stockItemId) * 1000) / 1000 }; // recounted now: the level now (the server sets the same)
    log(d, opnameId, `Recount ${item?.name}: ${prev.counted} → ${counted} ${item?.unit ?? ''} · ${name(d, by)} · first count kept`, by);
  }, stockItemId);
}
export function resendCount(opnameId: string, by: string) {
  const op = snapshot().opnames.find(x => x.id === opnameId);
  if (!op || op.status !== 'recount') return null;
  commit('opname.resubmitted', by, d => { const o = d.opnames.find(x => x.id === opnameId)!; o.status = 'locked'; log(d, opnameId, `Sent again after recount · ${name(d, by)}`, by); }, opnameId, op.outletId);
  return send(opnameId, by);
}

// ── Drawer count by the PIC ─────────────────────────────────────────────────────────────
/** The PIC counts someone else's drawer: the same close (no clock-out for the PIC, who counted is kept). */
export const picCountDrawer = (sessionId: string, counted: number, note: string, by: string) => closeSession(sessionId, counted, note, by);

// ── Handover, PIC pass, incidents ───────────────────────────────────────────────────────
/** Handover record per outlet + date + shift: c = ticked items (JSON), d = notes, e = who closed the shift. */
export function saveHandover(row: Rec, by: string) { commit('handover.saved', by, d => putRecord(d, 'handover', { ...row, at: now() }), row.id, row.a); }
export function closeShift(row: Rec, summary: string, by: string) {
  commit('shift.closed', by, d => {
    putRecord(d, 'handover', { ...row, e: by, at: now() });
    notice(d, 'Shift report', 'info', ['manager', 'owner'], row.a, `Shift report · ${summary} · closed by ${name(d, by)}`, '/owner/team/shifts-and-schedules');
  }, row.id, row.a);
}
export function passPic(outletId: string, day: number, slot: 'pagi' | 'siang' | 'malam', to: string, note: string, by: string) {
  commit('pic.passed', by, d => {
    const r = d.roster.find(x => x.outletId === outletId && x.day === day); if (!r) return;
    const from = r.slots[slot].pic;
    r.slots[slot].pic = to; r.slots[slot].crew = r.slots[slot].crew.filter(x => x !== to);
    putRecord(d, 'pic_pass', { id: uid('pp'), a: outletId, b: slot, c: from, d: to, e: note, at: now() });
    notice(d, 'PIC passed', 'info', ['manager'], outletId, `PIC passed from ${name(d, from)} to ${name(d, to)}${note ? ' · ' + note : ''}`, '/pic/cash-and-handover/pass-pic-to-another-person');
  }, `${outletId} ${slot}`, outletId);
}
/** Incident row: a outlet · b kind · c text (with order/table ref) · d amount · e who logged it. */
export function logIncident(outletId: string, kind: string, text: string, amount: number, by: string) {
  commit('incident.logged', by, d => {
    putRecord(d, 'incident', { id: uid('in'), a: outletId, b: kind, c: text, d: String(amount), e: by, at: now() });
    if (kind === 'complaint' && amount > 0) notice(d, 'Bad review', 'info', ['manager'], outletId, `${kind[0].toUpperCase() + kind.slice(1)} · ${text}${amount ? ' · ' + idr(amount) : ''} · ${name(d, by)}`, '/pic/floor/incident-log');
  }, kind, outletId);
}
