// "Test" in the settings panel for every hardware connector. Imported once for its side effect (agent.ts, Device.tsx).
import type { Integration } from '../data/schema.ts';
import { snapshot } from '../data/store.ts';
import { registerTester, type Result } from '../integrations/testers.ts';
import { logDrawer } from '../data/actions/devices.ts';
import { testDoc, kickDoc } from './receipt.ts';
import { toEscPos } from './layout.ts';
import { printDoc, sendBytes } from './printer.ts';
import { paperOf, receiptPrinter, ownerOf } from './routing.ts';
import { serialSend, pairedName } from './transports.ts';
import { readScale } from './scale.ts';
import { simulatorDriver } from './edc.ts';
import { poleBytes } from './escpos.ts';
import { REMOTE } from '../data/remote.ts';

const t = async (f: () => Promise<string>): Promise<Result> => { try { return { ok: true, message: await f() }; } catch (e) { return { ok: false, message: (e as Error).message || 'No response' }; } };

for (const id of ['printer-usb', 'printer-bluetooth', 'printer-serial', 'printer-lan', 'printer-browser'])
  registerTester(id, i => t(async () => { await printDoc(i, testDoc(`${i.name}${i.config.paired ? ' · ' + pairedName(i.config.paired) : ''}`, paperOf(i))); return 'Test page sent. Check the paper: 48 or 32 columns, QR and barcode.'; }));

// The attendance machine calls us, not the other way round: "connected" = it reached the server in the last 10 minutes.
registerTester('attendance-zkteco', async (i: Integration) => i.lastOk && Date.now() - i.lastOk < 10 * 60e3
  ? { ok: true, message: `${i.name} reached BorNiz ${Math.max(1, Math.round((Date.now() - i.lastOk) / 60e3))} min ago${i.lastError ? '. ' + i.lastError : ''}` }
  : { ok: false, message: REMOTE ? 'Saved. Waiting for the machine: set its Cloud Server as shown, wait a minute, then test again.' : 'Saved. In demo mode no machine can reach BorNiz; it starts pushing once the app runs on Supabase.' });

registerTester('drawer-kick', (i: Integration) => t(async () => {
  const db = snapshot(), p = receiptPrinter(db, i.outletId ?? db.device.outletId, ownerOf(db, i));
  if (!p || p.connector === 'printer-browser') throw new Error('Connect an ESC/POS receipt printer on this register first; the drawer opens through it.');
  await sendBytes(p, toEscPos(kickDoc(paperOf(p), Number(i.config.pin) === 1 ? 1 : 0)));
  logDrawer({ outletId: p.outletId ?? db.device.outletId, reason: 'test', printer: p.name, note: 'Test from settings', ok: true }, i.updatedBy);
  return 'Kick sent. The drawer should spring open.';
}));
registerTester('edc-manual', async i => ({ ok: true, message: `Ready. Card payments ask for the approval code from the ${i.config.bank || 'EDC'} slip.` }));
registerTester('edc-simulator', () => t(async () => { const d = simulatorDriver(), r = await d.charge({ amount: 1, ref: 'TEST' }); await d.void(r.trace); return `Test IDR 1 approved (${r.approvalCode}) and voided.`; }));
registerTester('scanner-wedge', async () => ({ ok: true, message: 'Ready. Scan any label: the register adds the product with that SKU.' }));
registerTester('scale-serial', i => t(async () => {
  if (!i.config.paired) throw new Error('Pair the scale on this register first.');
  const w = await readScale(String(i.config.paired), { baud: Number(i.config.baud) || 9600, request: String(i.config.request ?? ''), unit: i.config.unit === 'g' ? 'g' : 'kg' });
  return `Stable reading ${w.kg.toFixed(3)} kg`;
}));
registerTester('display-pole', i => t(async () => {
  if (!i.config.paired) throw new Error('Pair the pole display on this register first.');
  await serialSend(String(i.config.paired), Number(i.config.baud) || 9600, poleBytes(String(i.config.greeting || 'Selamat datang'), 'BorNiz display OK'));
  return 'Text sent to the display.';
}));
