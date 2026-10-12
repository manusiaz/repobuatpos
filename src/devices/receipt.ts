// What BorNiz prints: the customer receipt, the kitchen ticket per station, the test page. Built from the order fields
// (totals are never recomputed here), laid out once for 58 mm (32 cols) and 80 mm (48 cols).
import type { DB, Order, OrderLine } from '../data/schema.ts';
import { idr } from '../domain/money.ts';
import { linkTo } from '../system/hosts.ts';
import { menuDesign } from '../data/actions/studio.ts';
import { ticketLayout } from '../system/tools.ts';
import { couponOps } from './labels.ts';
import type { Paper } from './escpos.ts';
import type { Doc, Op } from './layout.ts';

const p2 = (n: number) => String(n).padStart(2, '0');
export const clock = (t: number) => { const d = new Date(t); return p2(d.getHours()) + ':' + p2(d.getMinutes()); };
export const stamp = (t: number) => { const d = new Date(t); return `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()} ${clock(t)}`; };
/** Amount without the currency word (the TOTAL line carries "IDR"). */
const amt = (n: number) => (n < 0 ? '-' : '') + idr(Math.abs(n)).replace(/^(IDR |Rp)/, '');
const NAME: Record<string, string> = { cash: 'Cash', qris: 'QRIS', card: 'Card', ewallet: 'E-wallet', va: 'Virtual account', deposit: 'Deposit', kasbon: 'Kasbon' };
const SOURCE: Record<string, string> = { pos: 'Register', qr: 'QR order', kiosk: 'Kiosk', waiter: 'Waiter', web: 'Web', gofood: 'GoFood', grabfood: 'GrabFood', shopeefood: 'ShopeeFood' };
export const where = (o: Order) => o.type === 'dine' ? (o.table ?? 'Dine-in') : o.type === 'take' ? 'Takeaway' : 'Delivery';
export const unitOf = (l: OrderLine) => (l.flashPrice ?? l.unitPrice) + l.mods.reduce((a, m) => a + m.price, 0);
const lineAmt = (l: OrderLine) => Math.round(unitOf(l) * l.qty * (1 - l.discountPct / 100));
export const isAllergy = (l: OrderLine) => /alerg|allerg/i.test(l.note + ' ' + l.mods.map(m => m.name).join(' '));
export const receiptUrl = (orderId: string) => linkTo('/order/customer-links/digital-receipt?o=' + orderId);

export interface ReceiptOpts { copy?: boolean; change?: number; footer?: string; url?: string; kick?: boolean; cut?: boolean }

export function receiptDoc(db: DB, o: Order, paper: Paper, opts: ReceiptOpts = {}): Doc {
  const out = db.outlets.find(x => x.id === o.outletId);
  const cashier = db.employees.find(e => e.id === o.cashierId)?.name ?? '-';
  const cust = db.customers.find(c => c.id === o.customerId);
  const pays = db.payments.filter(p => p.orderId === o.id && p.status === 'settled' && p.ref !== 'ROUNDING');
  const rounding = db.payments.filter(p => p.orderId === o.id && p.ref === 'ROUNDING' && p.status === 'settled').reduce((a, p) => a + p.amount, 0);
  const biz = db.tenant.profile, rc = menuDesign(db).rc; // Business profile + the receipt design published from Menu Studio
  const qrUrl = opts.url ?? (rc.qr === 'feedback' ? linkTo('/order/customer-links/feedback-and-rating?o=' + o.id) : rc.qr === 'member' && cust ? linkTo('/order/customer-links/member-card-and-points?c=' + cust.id) : receiptUrl(o.id));
  const ops: Op[] = [
    { t: 'text', s: db.tenant.name, align: 'center', bold: true, size: 'wide' },
    ...(biz?.legalName && biz.legalName !== db.tenant.name ? [{ t: 'text', s: biz.legalName, align: 'center' } as Op] : []),
    ...(out ? [{ t: 'text', s: out.name, align: 'center' } as Op, { t: 'text', s: out.address || out.city, align: 'center' } as Op] : []),
    ...(out?.phone ? [{ t: 'text', s: out.phone, align: 'center' } as Op] : []),
    ...(out?.npwpd ? [{ t: 'text', s: 'NPWPD ' + out.npwpd, align: 'center' } as Op] : biz?.npwp ? [{ t: 'text', s: 'NPWP ' + biz.npwp, align: 'center' } as Op] : []),
    ...(opts.copy ? [{ t: 'text', s: '*** COPY ***', align: 'center', bold: true } as Op] : []),
    { t: 'rule' },
    { t: 'lr', l: 'No ' + o.no, r: stamp(o.paidAt ?? o.createdAt) },
    { t: 'lr', l: 'Cashier ' + cashier, r: where(o) + (o.type === 'dine' ? ` ${o.guests} pax` : '') },
    ...(o.source !== 'pos' ? [{ t: 'lr', l: 'Channel', r: SOURCE[o.source] ?? o.source } as Op] : []),
    ...(cust ? [{ t: 'lr', l: 'Member ' + cust.name, r: '' } as Op] : []),
    { t: 'rule' },
  ];
  for (const l of o.lines) {
    ops.push({ t: 'lr', l: `${l.qty} ${l.name}`, r: amt(lineAmt(l)) });
    l.mods.forEach(m => ops.push({ t: 'text', s: '  + ' + m.name }));
    if (l.qty > 1) ops.push({ t: 'text', s: `  @ ${amt(unitOf(l))}` });
    if (l.discountPct) ops.push({ t: 'text', s: `  Discount ${l.discountPct}%` });
    if (l.note) ops.push({ t: 'text', s: '  * ' + l.note });
  }
  ops.push({ t: 'rule' }, { t: 'lr', l: 'Subtotal', r: amt(o.subtotal) });
  if (o.discount) ops.push({ t: 'lr', l: 'Discount', r: amt(-o.discount) });
  if (o.service) ops.push({ t: 'lr', l: `Service ${(out?.serviceBps ?? 0) / 100}%`, r: amt(o.service) });
  ops.push({ t: 'lr', l: `PB1 ${(out?.taxBps ?? 0) / 100}%${out?.taxInclusive ? ' (incl.)' : ''}`, r: amt(o.tax) });
  if (rounding) ops.push({ t: 'lr', l: 'Cash rounding', r: amt(-rounding) });
  ops.push({ t: 'lr', l: 'TOTAL', r: idr(o.total - rounding), bold: true, size: 'tall' }, { t: 'rule' });
  for (const p of pays) {
    ops.push({ t: 'lr', l: NAME[p.method] ?? p.method, r: amt(p.amount + p.tip) });
    if (p.tip) ops.push({ t: 'text', s: `  incl. tip ${amt(p.tip)}` });
    if (p.method !== 'cash') ops.push({ t: 'text', s: '  ' + (p.method === 'card' && !p.ref.startsWith('REF-') ? p.ref : 'Ref ' + p.ref) });
  }
  if (opts.change) ops.push({ t: 'lr', l: 'Change', r: amt(opts.change), bold: true });
  ops.push({ t: 'rule' });
  if (rc.qr !== 'none') ops.push({ t: 'qr', data: qrUrl }, { t: 'text', s: rc.qr === 'feedback' ? 'Scan to rate your visit' : rc.qr === 'member' && cust ? 'Scan for your member card' : 'Scan for your digital receipt', align: 'center' });
  ops.push({ t: 'feed', n: 1 }, { t: 'text', s: opts.footer ?? (String(rc.f1 || '') || 'Terima kasih!'), align: 'center', bold: true });
  if (rc.f2) ops.push({ t: 'text', s: String(rc.f2), align: 'center' });
  if (rc.wifiOn && rc.wifi) ops.push({ t: 'text', s: 'WiFi ' + String(rc.wifi), align: 'center' });
  ops.push(...couponOps(db, o)); // Customization Studio › Coupon on receipt
  ops.push({ t: 'text', s: 'Powered by BorNiz', align: 'center' });
  if (opts.copy) ops.push({ t: 'text', s: '*** COPY ***', align: 'center', bold: true });
  ops.push({ t: 'feed', n: 3 });
  if (opts.cut !== false) ops.push({ t: 'cut' });
  if (opts.kick) ops.push({ t: 'kick' });
  return { paper, ops };
}

export interface TicketOpts { reprint?: boolean; cut?: boolean; expo?: boolean }

/** Kitchen ticket for one station: only the lines given (the fired lines routed there), big table/order number.
 *  Item size, table size, inverted notes and auto-cut follow Customization Studio › Kitchen ticket. */
export function kitchenDoc(db: DB, o: Order, station: string, lines: OrderLine[], paper: Paper, opts: TicketOpts = {}): Doc {
  const k = ticketLayout(db);
  const by = db.employees.find(e => e.id === o.cashierId)?.name;
  const at = Math.max(0, ...lines.map(l => l.firedAt ?? 0)) || o.createdAt;
  const ops: Op[] = [
    { t: 'text', s: (opts.expo ? 'EXPO COPY' : station.toUpperCase()) + (opts.reprint ? ' - REPRINT' : ''), align: 'center', bold: true, invert: true },
    { t: 'text', s: (o.type === 'dine' ? o.table ?? 'DINE-IN' : o.type === 'take' ? 'TAKEAWAY' : 'DELIVERY').toUpperCase(), align: 'center', bold: true, size: k.table },
    { t: 'text', s: o.no, align: 'center', bold: true, size: 'wide' },
    { t: 'lr', l: `${SOURCE[o.source] ?? o.source}${o.type === 'dine' ? ` - ${o.guests} pax` : ''}`, r: clock(at) },
    ...(by ? [{ t: 'text', s: 'By ' + by } as Op] : []),
    { t: 'rule', ch: '=' },
  ];
  for (const l of lines) {
    ops.push({ t: 'text', s: `${l.qty} x ${l.name.toUpperCase()}${opts.expo ? ' (' + l.station.toUpperCase() + ')' : ''}`, bold: true, size: k.item });
    l.mods.forEach(m => ops.push({ t: 'text', s: '  > ' + m.name.toUpperCase(), bold: true, ...(k.bigMods ? { size: 'tall' as const } : {}) }));
    if (l.note) ops.push({ t: 'text', s: '  ** ' + l.note.toUpperCase() + ' **', ...(k.notes ? { bold: true, invert: true } : {}) });
    if (isAllergy(l)) ops.push({ t: 'text', s: '!! ALLERGY: ' + (l.note || l.mods.map(m => m.name).join(', ')).toUpperCase() + ' !!', bold: true, invert: true });
    ops.push({ t: 'feed', n: 1 });
  }
  if (o.note) ops.push({ t: 'rule' }, { t: 'text', s: 'NOTE: ' + o.note, bold: true });
  ops.push({ t: 'rule', ch: '=' }, { t: 'lr', l: `${lines.reduce((a, l) => a + l.qty, 0)} item(s)`, r: o.no }, { t: 'feed', n: 3 });
  if ((opts.cut ?? k.cut) !== false) ops.push({ t: 'cut' });
  return { paper, ops };
}

/** Test page: alignment, sizes, the full ruler, QR and barcode, so one print proves the whole command set. */
export function testDoc(name: string, paper: Paper, extra: string[] = []): Doc {
  return { paper, ops: [
    { t: 'text', s: 'BorNiz test print', align: 'center', bold: true, size: 'wide' },
    { t: 'text', s: name, align: 'center' }, { t: 'rule' },
    { t: 'text', s: '1234567890'.repeat(5) },
    { t: 'lr', l: `Paper ${paper} mm`, r: `${paper === '58' ? 32 : 48} columns` },
    { t: 'text', s: 'Bold', bold: true }, { t: 'text', s: 'Tall', size: 'tall' }, { t: 'text', s: 'Wide', size: 'wide' },
    { t: 'text', s: 'Highlighted', invert: true }, { t: 'text', s: 'Right', align: 'right' },
    { t: 'text', s: 'Kopi Susu Aren · crème brûlée' },
    ...extra.map(s => ({ t: 'text', s } as Op)),
    { t: 'qr', data: 'https://bornis.id' }, { t: 'barcode', data: 'KB-001' },
    { t: 'feed', n: 3 }, { t: 'cut' },
  ] };
}

/** Drawer pulse only (no paper). */
export const kickDoc = (paper: Paper = '80', pin: 0 | 1 = 0): Doc => ({ paper, ops: [{ t: 'kick', pin }] });
