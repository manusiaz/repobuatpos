// Shift clock helpers shared by PIC, Shifts and Manager. Roster day index: Monday = 0 (seed roster has 7 days per outlet).
import { SHIFTS } from '../../domain/shift.ts';
import type { Level } from '../../domain/approval.ts';
import type { DB, Employee, Role, ShiftDay } from '../../data/schema.ts';
import type { Tone } from '../../ui/kit.tsx';

export type Slot = keyof typeof SHIFTS;
export const SLOTS: Slot[] = ['pagi', 'siang', 'malam'];
export const SLOT_TONE: Record<Slot, Tone> = { pagi: 'warning', siang: 'accent', malam: 'info' };
export const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY = 864e5;

export const startOfDay = (t = Date.now()) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
export const dayIdx = (t = Date.now()) => (new Date(t).getDay() + 6) % 7;
export const weekStart = (t = Date.now()) => startOfDay(t) - dayIdx(t) * DAY;
export const dateKey = (t = Date.now()) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
export const dayLabel = (i: number, t = Date.now()) => `${DAY_NAMES[i]} ${new Date(weekStart(t) + i * DAY).getDate()}`;
export const longDate = (t = Date.now()) => new Date(t).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' });

const mins = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
/** Close overlaps Afternoon from 18:00; from then the close shift is "now" (bn-shift.js). */
export function slotNow(t = Date.now()): Slot { const d = new Date(t), h = d.getHours() + d.getMinutes() / 60; return h < 14 ? 'pagi' : h < 18 ? 'siang' : 'malam'; }
export const slotStart = (s: Slot, t = Date.now()) => startOfDay(t) + mins(SHIFTS[s][1]) * 60e3;
export const slotEnd = (s: Slot, t = Date.now()) => startOfDay(t) + mins(SHIFTS[s][2]) * 60e3;
export const slotHours = (s: Slot) => (mins(SHIFTS[s][2]) - mins(SHIFTS[s][1])) / 60;
export const slotLabel = (s: Slot) => SHIFTS[s][0];
export const slotTime = (s: Slot) => `${SHIFTS[s][1]}–${SHIFTS[s][2]}`;
export const slotOf = (t: number): Slot => slotNow(t);

export const rosterDay = (db: DB, outletId: string, day = dayIdx()): ShiftDay | undefined => db.roster.find(r => r.outletId === outletId && r.day === day);
/** Everyone on a slot: the PIC first, then the crew. */
export function onSlot(sd: ShiftDay | undefined, s: Slot): string[] {
  if (!sd) return [];
  const x = sd.slots[s];
  return [...new Set([x.pic, ...x.crew].filter(Boolean))];
}
export const slotsOf = (sd: ShiftDay | undefined, empId: string) => SLOTS.filter(s => onSlot(sd, s).includes(empId));

export const emp = (db: DB, id: string | null | undefined): Employee | undefined => db.employees.find(e => e.id === id);
export const nameOf = (db: DB, id: string | null | undefined) => emp(db, id)?.name ?? (id === 'admin' ? 'BorNiz admin' : id || '—');
export const levelOf = (r: Role): Level => (r === 'owner' ? 'owner' : r === 'manager' ? 'manager' : r === 'pic' ? 'pic' : 'cashier');
export const ROLE_LABEL: Partial<Record<Role, string>> = { owner: 'Owner', manager: 'Manager', pic: 'PIC', cashier: 'Cashier', kitchen: 'Kitchen', waiter: 'Waiter' };
/** Staff of an outlet that can be rostered (owner works the floor only by clocking in). */
export const staffOf = (db: DB, outletId: string) => db.employees.filter(e => e.active && e.outlets.includes(outletId) && e.role !== 'owner');
export const picCandidates = (db: DB, outletId: string) => staffOf(db, outletId).filter(e => e.role === 'pic' || e.role === 'manager');
/** Manager of the outlet (who a PIC reports to). */
export const managerOf = (db: DB, outletId: string) => db.employees.find(e => e.role === 'manager' && e.outlets.includes(outletId));

export type ClockState = 'in' | 'break' | 'out' | 'none';
export function clockState(db: DB, empId: string, outletId: string, since = startOfDay()) {
  const ev = db.clock.filter(c => c.employeeId === empId && c.outletId === outletId && c.at >= since).sort((a, b) => a.at - b.at);
  const last = ev[ev.length - 1], firstIn = ev.find(e => e.kind === 'in');
  return { state: (last?.kind ?? 'none') as ClockState, at: last?.at ?? null, firstIn: firstIn?.at ?? null, events: ev };
}
export const LATE_MS = 10 * 60e3, NO_SHOW_MS = 15 * 60e3;
/** Attendance against the roster: late after 10 min, no-show after 15 min without a clock-in. */
export function attendance(db: DB, empId: string, outletId: string, s: Slot, t = Date.now()) {
  const c = clockState(db, empId, outletId);
  const start = slotStart(s, t);
  if (c.firstIn) return { ...c, flag: c.firstIn - start > LATE_MS ? 'late' as const : null, lateMin: Math.max(0, Math.round((c.firstIn - start) / 60e3)) };
  return { ...c, flag: t - start > NO_SHOW_MS ? 'no_show' as const : null, lateMin: 0 };
}

const LIVE: string[] = ['open', 'held', 'sent', 'preparing', 'ready', 'served', 'paying'];
export const isLive = (status: string) => LIVE.includes(status);
export const isPaid = (status: string) => status === 'paid' || status === 'part_refunded';
