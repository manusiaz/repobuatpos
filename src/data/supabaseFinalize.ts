'use client';
// Settlement finalizer. The gateway settles QRIS / VA / e-wallet on the server (bn_gateway_update), often after the guest closed
// their tab. Signed-in staff devices then apply the order effects once (paid, kitchen firing, stock, beans, alerts, WhatsApp):
// devices of the order's outlet right away, any other device after 30 s if nobody did. The commit carries a precondition on the
// order status, so when several devices race only the first write lands; the others are refused quietly and get the result by realtime.
import { commit, snapshot } from './store.ts';
import { backFromPaying, notify, settleIfDone } from './actions.ts';
import { onDocs } from './supabaseStore.ts';
import { idr } from '../domain/money.ts';
import type { DB } from './schema.ts';

const GATEWAY = ['qris', 'va', 'ewallet'];
const CLOSED = ['paid', 'voided', 'refunded', 'part_refunded'];
const waiting = new Map<string, ReturnType<typeof setTimeout>>();
let on = false;

/** What the server-side payment state still asks of this order: 'settle', 'fail' or nothing. */
export function finalizeNeed(d: DB, orderId: string): 'settle' | 'fail' | null {
  const o = d.orders.find(x => x.id === orderId);
  if (!o || CLOSED.includes(o.status)) return null;
  const ps = d.payments.filter(p => p.orderId === o.id && GATEWAY.includes(p.method));
  if (ps.some(p => p.status === 'settled')) return 'settle';
  if (o.status === 'paying' && ps.length && !d.payments.some(p => p.orderId === o.id && p.status === 'pending') && ps.some(p => p.status === 'failed' || p.status === 'expired')) return 'fail';
  return null;
}
function run(orderId: string) {
  waiting.delete(orderId);
  const d0 = snapshot(), need = finalizeNeed(d0, orderId), o = d0.orders.find(x => x.id === orderId);
  if (!need || !o) return;
  commit(need === 'settle' ? 'payment.settled' : 'payment.failed', 'gateway', d => {
    const x = d.orders.find(y => y.id === orderId)!;
    if (need === 'settle') return settleIfDone(d, x, 'gateway');
    const p = d.payments.filter(y => y.orderId === x.id && GATEWAY.includes(y.method)).at(-1)!;
    x.status = backFromPaying(x);
    notify(d, 'Payment failed / declined', 'warn', ['cashier'], x.outletId, `${x.no}${x.table ? ' · ' + x.table : ''} · ${p.method.toUpperCase()} ${p.status} · ${idr(p.amount)}`);
  }, orderId, o.outletId, { expect: [{ coll: 'orders', id: orderId, data: { status: o.status } }], quiet: true });
}
function consider(orderId: string) {
  const d = snapshot();
  if (waiting.has(orderId) || !finalizeNeed(d, orderId)) return;
  const o = d.orders.find(x => x.id === orderId)!;
  waiting.set(orderId, setTimeout(() => run(orderId), o.outletId === d.device.outletId ? 200 + Math.random() * 800 : 30e3));
}
export function startFinalizer() {
  if (on) return;
  on = true;
  onDocs(docs => docs.forEach(x => { const p = x.data as { orderId?: string; status?: string } | null; if (x.coll === 'payments' && p?.orderId && p.status !== 'pending') consider(p.orderId); }));
  const d = snapshot(), open = new Set(d.orders.filter(o => !CLOSED.includes(o.status)).map(o => o.id));
  for (const p of d.payments) if (open.has(p.orderId) && GATEWAY.includes(p.method) && p.status !== 'pending') consider(p.orderId);
}
