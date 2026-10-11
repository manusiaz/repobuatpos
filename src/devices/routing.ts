// Which device am I, which printer prints what. Pure: the print agent, the Device page and the tests share it.
import type { Category, DB, Integration, Order, OrderLine } from '../data/schema.ts';
import type { Paper } from './escpos.ts';

/** This register: the paired POS (Auth › pairing), else the first register at the device's outlet. */
export function thisDevice(db: DB): string | null {
  return db.device.paired.pos ?? db.devices.find(d => d.kind === 'pos' && d.outletId === db.device.outletId)?.id ?? null;
}
export const outletOfDevice = (db: DB, deviceId: string | null) => db.devices.find(d => d.id === deviceId)?.outletId ?? db.device.outletId;

export type Station = 'receipt' | 'all' | Category['station'];
export const STATIONS: [Station, string][] = [['receipt', 'Receipt (counter)'], ['bar', 'Bar tickets'], ['kitchen', 'Kitchen tickets'], ['pastry', 'Pastry tickets'], ['all', 'Receipt + every kitchen ticket']];
export const stationOf = (i: Integration) => (String(i.config.station || 'receipt')) as Station;
export const paperOf = (i: Integration): Paper => (String(i.config.paper) === '58' ? '58' : '80');
export const copiesOf = (i: Integration) => Math.max(1, Math.min(5, Number(i.config.copies) || 1));

export const printersAt = (db: DB, outletId: string) => db.integrations.filter(i => i.kind === 'printer' && i.enabled && i.outletId === outletId);
/** The device that drives an integration: its own device, or (set up from the back office) the outlet's first register. */
export const ownerOf = (db: DB, i: Integration) => i.deviceId ?? db.devices.find(d => d.kind === 'pos' && d.outletId === i.outletId)?.id ?? null;

/** Printer for a kitchen station: a dedicated station printer wins, else a printer set to "all". */
export function stationPrinter(db: DB, outletId: string, station: Category['station']) {
  const ps = printersAt(db, outletId);
  return ps.find(i => stationOf(i) === station) ?? ps.find(i => stationOf(i) === 'all');
}
/** Receipt printer: this device's own first, else any receipt printer at the outlet. */
export function receiptPrinter(db: DB, outletId: string, deviceId: string | null) {
  const ps = printersAt(db, outletId).filter(i => stationOf(i) === 'receipt' || stationOf(i) === 'all');
  return ps.find(i => ownerOf(db, i) === deviceId) ?? ps[0];
}

export interface Job { key: string; kind: 'ticket' | 'receipt'; integrationId: string; orderId: string; station?: Category['station']; lineIds?: string[] }
export const lineKey = (o: Order, l: OrderLine) => `l:${o.id}:${l.id}`;
export const receiptKey = (o: Order) => `r:${o.id}`;

/** Jobs this device owes: each fired line once to its station printer, and the receipt of each paid register order
 *  when the receipt printer has auto-print on. Only printers this device drives; only events since `since`. */
export function pendingJobs(db: DB, deviceId: string | null, done: Record<string, number>, since: number): Job[] {
  const outletId = outletOfDevice(db, deviceId), jobs: Job[] = [];
  const mine = (i: Integration | undefined): i is Integration => !!i && ownerOf(db, i) === deviceId;
  for (const o of db.orders) {
    if (o.outletId !== outletId) continue;
    const groups = new Map<string, Job>();
    for (const l of o.lines) {
      if (!l.fired || (l.firedAt ?? 0) < since || done[lineKey(o, l)]) continue;
      const p = stationPrinter(db, outletId, l.station);
      if (!mine(p)) continue;
      const k = p.id + ':' + l.station;
      const g = groups.get(k) ?? { key: `t:${o.id}:${l.station}:${l.id}`, kind: 'ticket' as const, integrationId: p.id, orderId: o.id, station: l.station, lineIds: [] };
      g.lineIds!.push(l.id); groups.set(k, g);
    }
    jobs.push(...groups.values());
    if (o.source === 'pos' && o.status === 'paid' && (o.paidAt ?? 0) >= since && !done[receiptKey(o)]) {
      const p = receiptPrinter(db, outletId, deviceId);
      if (mine(p) && p.config.autoPrint) jobs.push({ key: receiptKey(o), kind: 'receipt', integrationId: p.id, orderId: o.id });
    }
  }
  return jobs;
}
/** The dedupe keys a job settles (every line of a ticket, or the receipt). */
export const keysOf = (j: Job, o: Order) => j.kind === 'receipt' ? [receiptKey(o)] : o.lines.filter(l => j.lineIds!.includes(l.id)).map(l => lineKey(o, l));
