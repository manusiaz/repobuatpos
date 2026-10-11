// Send a document to a configured printer integration (connector id picks the transport).
import type { Integration } from '../data/schema.ts';
import { toEscPos, type Doc } from './layout.ts';
import { bleSend, bridgeSend, serialSend, usbSend } from './transports.ts';
import { browserPrint } from './html.ts';

export const ESCPOS = ['printer-usb', 'printer-bluetooth', 'printer-serial', 'printer-lan'];
export const canKick = (i: Integration | undefined) => !!i && ESCPOS.includes(i.connector);

export async function sendBytes(i: Integration, bytes: Uint8Array) {
  const c = i.config, paired = String(c.paired ?? '');
  if (i.connector === 'printer-lan') return bridgeSend(String(c.bridge ?? ''), String(c.host ?? ''), Number(c.port) || 9100, bytes);
  if (!paired) throw new Error(`${i.name} is not paired on this device yet.`);
  if (i.connector === 'printer-usb') return usbSend(paired, bytes);
  if (i.connector === 'printer-serial') return serialSend(paired, Number(c.baud) || 9600, bytes);
  if (i.connector === 'printer-bluetooth') return bleSend(paired, bytes, Number(c.chunk) || 20);
  throw new Error(`${i.name} cannot take raw printer commands.`);
}

export async function printDoc(i: Integration, doc: Doc, copies = 1) {
  if (i.connector === 'printer-browser') return browserPrint(doc, copies);
  const one = toEscPos(doc), all = new Uint8Array(one.length * copies);
  for (let k = 0; k < copies; k++) all.set(one, k * one.length);
  return sendBytes(i, all);
}
