import { bps, roundCash, type IDR } from './money.ts';

// lg-total: line price → modifiers → flash price → line discount → order discount → service → tax.
// Same function on POS, QR menu and kiosk. The server is the authority; clients only preview.

export interface LineInput {
  unitPrice: IDR;          // base or outlet local price
  flashPrice?: IDR | null; // flash price is a price, not a discount
  modifiers?: IDR[];       // modifier price deltas
  qty: number;
  discountPct?: number;    // line discount 0–100
}
export interface OutletTax { serviceBps: number; taxBps: number; taxInclusive: boolean; cashStep?: number }
export interface Totals { lines: IDR[]; subtotal: IDR; orderDiscount: IDR; service: IDR; tax: IDR; total: IDR; rounding: IDR; due: IDR }

export const lineTotal = (l: LineInput): IDR => {
  const unit = (l.flashPrice ?? l.unitPrice) + (l.modifiers ?? []).reduce((a, b) => a + b, 0);
  const gross = unit * l.qty;
  return gross - Math.round((gross * (l.discountPct ?? 0)) / 100);
};

export function orderTotals(lines: LineInput[], tax: OutletTax, orderDiscount: { pct?: number; amount?: IDR } = {}, cash = false): Totals {
  const lt = lines.map(lineTotal);
  const subtotal = lt.reduce((a, b) => a + b, 0);
  const disc = Math.min(subtotal, (orderDiscount.amount ?? 0) + Math.round((subtotal * (orderDiscount.pct ?? 0)) / 100));
  const net = subtotal - disc;
  let service: IDR, taxAmt: IDR, total: IDR;
  if (tax.taxInclusive) {
    // prices already include tax: back-calculate the tax share, service stays on top
    service = bps(net, tax.serviceBps);
    total = net + service;
    taxAmt = Math.round(total - total / (1 + tax.taxBps / 10000));
  } else {
    service = bps(net, tax.serviceBps);
    taxAmt = bps(net + service, tax.taxBps);
    total = net + service + taxAmt;
  }
  const due = cash ? roundCash(total, tax.cashStep ?? 100) : total;
  return { lines: lt, subtotal, orderDiscount: disc, service, tax: taxAmt, total, rounding: due - total, due };
}

// st-order: one order, every channel.
export type OrderStatus = 'open' | 'held' | 'sent' | 'preparing' | 'ready' | 'served' | 'paying' | 'paid' | 'voided' | 'part_refunded' | 'refunded';
const ORDER_FLOW: Record<OrderStatus, OrderStatus[]> = {
  open: ['sent', 'held', 'paying', 'voided'], held: ['open'], sent: ['preparing', 'paying'], preparing: ['ready', 'paying'],
  ready: ['served', 'paying'], served: ['paying'], paying: ['paid', 'open'], paid: ['part_refunded', 'refunded'],
  part_refunded: ['part_refunded', 'refunded'], voided: [], refunded: [],
};
export const canMove = (from: OrderStatus, to: OrderStatus) => ORDER_FLOW[from].includes(to);

/** Pickup board lanes from kitchen line state, so a paid-first QR / kiosk order shows too. Ready numbers stay `readyMin` minutes. */
type Ticket = { id: string; createdAt: number; status: OrderStatus; readyAt?: number; lines: { fired: boolean; kds: 'new' | 'cooking' | 'done' }[] };
export function pickupLanes<T extends Ticket>(orders: T[], now: number, readyMin = 10) {
  const live = orders.filter(o => !o.id.startsWith('h') && now - o.createdAt < 3 * 3600e3 && !['served', 'voided', 'refunded'].includes(o.status) && o.lines.some(l => l.fired));
  const done = (o: T) => o.lines.every(l => !l.fired || l.kds === 'done');
  return { prep: live.filter(o => !done(o)), ready: live.filter(o => done(o) && now - (o.readyAt ?? now) < readyMin * 60e3) };
}

// st-pay: only the gateway webhook settles a QRIS / VA payment.
export type PaymentStatus = 'created' | 'pending' | 'settled' | 'expired' | 'failed' | 'refund_requested' | 'refunded';
export type Method = 'cash' | 'qris' | 'card' | 'ewallet' | 'va' | 'deposit' | 'kasbon';
export const QRIS_TTL_MS = 5 * 60 * 1000;
export const needsGateway = (m: Method) => m === 'qris' || m === 'va' || m === 'ewallet';
/** lg-sync: gateway methods are blocked offline; cash and card EDC keep working. */
export const methodAvailable = (m: Method, online: boolean) => online || !needsGateway(m);

export type Source = 'pos' | 'qr' | 'kiosk' | 'waiter' | 'web' | 'gofood' | 'grabfood' | 'shopeefood';
export const isPlatform = (s: Source) => s === 'gofood' || s === 'grabfood' || s === 'shopeefood';
/** Delivery-app orders: no void, no price change, no add item anywhere in BorNiz. */
export const editableInBorniz = (s: Source) => !isPlatform(s);
