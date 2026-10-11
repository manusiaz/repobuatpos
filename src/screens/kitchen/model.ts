// Derived kitchen state shared by KDS, online orders and the waiter phone. Pure functions over the live db.
import type { DB, Order, OrderLine } from '../../data/schema.ts';
import { isPlatform, type Source } from '../../domain/order.ts';

export type Station = OrderLine['station'];
export const STATIONS: readonly (readonly [Station | 'all', string])[] = [['all', 'All'], ['bar', 'Bar'], ['kitchen', 'Kitchen'], ['pastry', 'Pastry']];

/** Channel label + token color. Colors are labels only (official logos in production). */
export const CHANNEL: Record<Source, { name: string; short: string; color: string }> = {
  gofood: { name: 'GoFood', short: 'GF', color: 'var(--success)' }, grabfood: { name: 'GrabFood', short: 'GR', color: 'var(--violet)' },
  shopeefood: { name: 'ShopeeFood', short: 'SF', color: 'var(--ember-700)' }, web: { name: 'Web store', short: 'WEB', color: 'var(--ink-700)' },
  qr: { name: 'QR table', short: 'QR', color: 'var(--info)' }, kiosk: { name: 'Kiosk', short: 'K', color: 'var(--warning)' },
  pos: { name: 'POS', short: 'POS', color: 'var(--ink-500)' }, waiter: { name: 'Waiter', short: 'W', color: 'var(--info-fg)' },
};
export const TIER = { rush: { l: 'Rush', rank: 0, tone: 'danger' }, standard: { l: 'Standard', rank: 1, tone: 'neutral' }, saver: { l: 'Saver', rank: 2, tone: 'info' } } as const;
export const isOnline = (o: Order) => isPlatform(o.source) || o.source === 'web' || o.type === 'delivery';
export const isHistory = (o: Order) => o.id.startsWith('h');
const DEAD = ['voided', 'refunded', 'part_refunded'];

/** On the KDS: fired lines not all done (sent / preparing / ready, paid quick-service orders still cooking). */
export const isActive = (o: Order) => !DEAD.includes(o.status) && o.lines.some(l => l.fired && l.kds !== 'done');
export const activeTickets = (db: DB, outletId: string) => db.orders.filter(o => o.outletId === outletId && isActive(o));
export const linesAt = (o: Order, st: Station | 'all') => o.lines.filter(l => l.fired && (st === 'all' || l.station === st));
export const openLinesAt = (o: Order, st: Station | 'all') => linesAt(o, st).filter(l => l.kds !== 'done');

const BUMP = new Set(['ticket.bumped', 'ticket.done', 'ticket.item_done', 'ticket.started']);
/** Last kitchen touch per order (audit log), i.e. when a completed ticket was bumped. */
export function bumpTimes(db: DB) {
  const m = new Map<string, number>();
  for (const a of db.audit) if (BUMP.has(a.action) && !m.has(a.subject)) m.set(a.subject, a.at);
  return m;
}
export const startOfDay = (t = Date.now()) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };

/** Bumped today: every fired line done. Live orders only can be recalled (history is closed). */
export function completedToday(db: DB, outletId: string) {
  const bt = bumpTimes(db), t0 = startOfDay();
  return db.orders.filter(o => o.outletId === outletId && !DEAD.includes(o.status) && o.createdAt >= t0 && o.lines.some(l => l.fired) && o.lines.every(l => !l.fired || l.kds === 'done'))
    .map(o => ({ o, at: bt.get(o.id) ?? (isHistory(o) ? o.paidAt ?? o.createdAt : o.createdAt), live: !isHistory(o) && bt.has(o.id) }))
    .sort((a, b) => b.at - a.at);
}

/** Avg prep (createdAt → bump) over today's bumped tickets, minutes. */
export function prepStats(db: DB, outletId: string) {
  const done = completedToday(db, outletId).filter(x => x.live);
  const mins = done.map(x => (x.at - x.o.createdAt) / 60e3);
  return { n: mins.length, avg: mins.length ? mins.reduce((a, b) => a + b, 0) / mins.length : null, done, mins };
}

export const allDay = (orders: Order[], st: Station | 'all') => {
  const m = new Map<string, number>();
  orders.forEach(o => openLinesAt(o, st).forEach(l => m.set(l.name, (m.get(l.name) ?? 0) + l.qty)));
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
};
export const ticketLabel = (o: Order) => o.table ?? (isOnline(o) ? CHANNEL[o.source].short + ' ' + o.no.replace('#', '') : o.no);
export const mmss = (ms: number) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
export const minsLeft = (t: number, now: number) => Math.round((t - now) / 60e3);
export const dueText = (t: number, now: number) => { const m = minsLeft(t, now); return m >= 0 ? `in ${m} min` : `${-m} min late`; };
export const empName = (db: DB, id: string | null) => db.employees.find(e => e.id === id)?.name ?? null;
export const lineMods = (l: OrderLine) => l.mods.map(m => m.name).join(', ');
