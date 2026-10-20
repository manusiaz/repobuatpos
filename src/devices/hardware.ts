// What the screens and the print agent call: print a receipt / ticket, open the drawer, show on the pole display, read the scale.
// Each call reports health to the integration (a failing printer raises "Printer problem" once) and returns a message.
import type { DB, Integration, Order } from '../data/schema.ts';
import { reportIntegration } from '../data/actions/integrations.ts';
import { logDevice } from '../data/actions/pos.ts';
import { logDrawer, type DrawerReason } from '../data/actions/devices.ts';
import { kickDoc, kitchenDoc, receiptDoc, type ReceiptOpts } from './receipt.ts';
import { cupDoc } from './labels.ts';
import { ticketLayout } from '../system/tools.ts';
import { toEscPos } from './layout.ts';
import { canKick, printDoc, sendBytes } from './printer.ts';
import { copiesOf, outletOfDevice, ownerOf, paperOf, printersAt, receiptPrinter, stationOf, stationPrinter, ticketLines } from './routing.ts';
import { serialSend } from './transports.ts';
import { readScale } from './scale.ts';
import { poleBytes } from './escpos.ts';

export type Result = { ok: boolean; message: string };
const health = (i: Integration, ok: boolean, message = '') => { if (!ok || i.status !== 'ok') reportIntegration(i.id, ok, message); };
export async function run(i: Integration, job: () => Promise<unknown>, done: string): Promise<Result> {
  try { await job(); health(i, true); return { ok: true, message: done }; }
  catch (e) { const m = (e as Error).message || 'No response'; health(i, false, m); return { ok: false, message: `${i.name}: ${m}` }; }
}
const mineOn = (db: DB, deviceId: string | null, connector: string) => db.integrations.find(i => i.connector === connector && i.enabled && ownerOf(db, i) === deviceId);

export function printReceipt(db: DB, o: Order, deviceId: string | null, by: string, opts: ReceiptOpts = {}): Promise<Result> {
  const p = receiptPrinter(db, o.outletId, deviceId);
  if (!p) return Promise.resolve({ ok: false, message: 'No receipt printer set up. Add one in Device › Printer & drawer.' });
  const copy = opts.copy ?? db.audit.some(a => a.action === 'print.receipt' && a.subject === o.no);
  return run(p, () => printDoc(p, receiptDoc(db, o, paperOf(p), { ...opts, copy }), copy ? 1 : copiesOf(p)), copy ? 'Copy printed' : 'Receipt printed')
    .then(r => { if (r.ok) logDevice('print.receipt', o.no, by, o.outletId); return r; });
}

/** Kitchen tickets for an order: fired lines (or all lines on a reprint) grouped by station printer. A banner marks a
 *  change slip (table moved, item voided). */
export async function printTickets(db: DB, o: Order, by: string, reprint = false, lineIds?: string[], banner?: string): Promise<Result> {
  const lines = ticketLines(o, lineIds);
  const st = [...new Set(lines.map(l => l.station))];
  const res: Result[] = [];
  for (const s of st) {
    const p = stationPrinter(db, o.outletId, s);
    if (!p) { res.push({ ok: false, message: `No ${s} printer · the ticket shows on the KDS` }); continue; }
    res.push(await run(p, () => printDoc(p, kitchenDoc(db, o, s, lines.filter(l => l.station === s), paperOf(p), { reprint, banner })), `${s} ticket printed`));
  }
  // Customization Studio › Kitchen ticket: an expo copy of every line at the pass; › Cup sticker: one label per drink.
  const pass = ticketLayout(db).expo && st.length && receiptPrinter(db, o.outletId, null);
  if (pass) res.push(await run(pass, () => printDoc(pass, kitchenDoc(db, o, 'expo', lines, paperOf(pass), { reprint, expo: true, banner })), 'Expo copy printed'));
  const label = printersAt(db, o.outletId).find(i => stationOf(i) === 'label'), cups = label && !reprint && !banner && cupDoc(db, o, lines);
  if (label && cups) res.push(await run(label, () => printDoc(label, cups), 'Cup stickers printed'));
  if (res.some(r => r.ok)) logDevice(banner ? 'print.kitchen_slip' : reprint ? 'print.kitchen_reprint' : 'print.kitchen_ticket', o.no, by, o.outletId); // a void / move slip is not a reprint
  return { ok: res.length > 0 && res.every(r => r.ok), message: res.map(r => r.message).join(' · ') || 'Nothing to print' };
}

/** Kick the drawer through this register's receipt printer and log the open (cash sale, no-sale override, test). */
export async function openDrawer(db: DB, deviceId: string | null, reason: DrawerReason, note: string, by: string, auto = false): Promise<Result> {
  const outletId = outletOfDevice(db, deviceId), drawer = mineOn(db, deviceId, 'drawer-kick');
  if (auto && (!drawer || drawer.config.openOn === 'never')) return { ok: true, message: '' };
  const p = receiptPrinter(db, outletId, deviceId);
  if (!drawer || !canKick(p) || ownerOf(db, p!) !== deviceId) {
    logDrawer({ outletId, reason, printer: 'Manual key', note: note + ' · no drawer connected', ok: true }, by);
    return { ok: false, message: drawer ? 'The drawer kicks through an ESC/POS receipt printer on this register (USB, Bluetooth, serial or LAN).' : 'No cash drawer connected · open it with the key. Logged.' };
  }
  const r = await run(p!, () => sendBytes(p!, toEscPos(kickDoc(paperOf(p!), Number(drawer.config.pin) === 1 ? 1 : 0))), 'Drawer opened');
  logDrawer({ outletId, reason, printer: p!.name, note: r.ok ? note : r.message, ok: r.ok }, by);
  return r;
}

export function showOnPole(db: DB, deviceId: string | null, l1: string, l2: string): Promise<Result> {
  const i = mineOn(db, deviceId, 'display-pole');
  if (!i?.config.paired) return Promise.resolve({ ok: false, message: '' });
  return run(i, () => serialSend(String(i.config.paired), Number(i.config.baud) || 9600, poleBytes(l1, l2)), 'Shown');
}

export async function weigh(db: DB, deviceId: string | null): Promise<{ kg: number } | Result> {
  const i = mineOn(db, deviceId, 'scale-serial');
  if (!i?.config.paired) return { ok: false, message: 'No scale paired on this register. Pair it in Device › Scanner & scale, or type the weight.' };
  let kg = 0;
  const r = await run(i, async () => { kg = (await readScale(String(i.config.paired), { baud: Number(i.config.baud) || 9600, request: String(i.config.request ?? ''), unit: i.config.unit === 'g' ? 'g' : 'kg' })).kg; }, 'Read');
  return r.ok ? { kg } : r;
}
