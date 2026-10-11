'use client';
// Customer display services: pairing with a register, tip choice and receipt delivery. Writes only through commit().
import { commit, snapshot, uid } from '../store.ts';

const now = () => Date.now();

/** Shows a fresh 6-digit code on the display; a register confirms it with pairByCode. */
export function newPairCode(displayId: string) {
  const code = String(Math.floor(100000 + Math.random() * 900000));
  commit('display.pair_code', 'device', d => { const x = d.devices.find(v => v.id === displayId); if (x) { x.pairCode = code; x.lastSeen = now(); } }, displayId);
  return code;
}
/** Called from the register (or staff on the display) with the code the display shows. */
export function pairByCode(code: string, registerId: string, by: string): string | null {
  const disp = snapshot().devices.find(v => v.kind === 'display' && v.pairCode === code.trim());
  if (!disp) return 'Code not found. Check the code on the customer display.';
  commit('display.paired', by, d => {
    d.device.paired[disp.id] = registerId;
    const x = d.devices.find(v => v.id === disp.id)!; x.pairCode = null; x.status = 'online'; x.lastSeen = now();
  }, disp.id, disp.outletId);
  return null;
}
export function unpairDisplay(displayId: string, by: string) {
  commit('display.unpaired', by, d => { delete d.device.paired[displayId]; }, displayId);
}

/** Tip picked on the display. Kept per order (records.cd_tips) for the register; a pending payment carries it too. */
export function chooseTip(orderId: string, amount: number) {
  commit('display.tip', 'guest', d => {
    const l = d.records.cd_tips ?? (d.records.cd_tips = []);
    const row = { id: orderId, a: String(amount), b: '', c: '', d: '', e: '', at: now() };
    const i = l.findIndex(x => x.id === orderId); if (i >= 0) l[i] = row; else l.unshift(row);
    d.payments.forEach(p => { if (p.orderId === orderId && p.status === 'pending') p.tip = amount; });
  }, orderId);
}
export const tipOf = (records: Record<string, { id: string; a: string }[]>, orderId: string) => Number(records.cd_tips?.find(x => x.id === orderId)?.a ?? NaN);

/** Receipt choice: WhatsApp / email go out as messages; print is logged for the register's printer. */
export function sendReceipt(orderId: string, channel: 'wa' | 'email' | 'print' | 'none', to = '') {
  commit('receipt.' + channel, 'guest', d => {
    const o = d.orders.find(x => x.id === orderId);
    if (channel === 'wa' || channel === 'email') d.messages.unshift({ id: uid('ms'), channel, template: 'e_receipt', to, status: 'queued', at: now(), customerId: o?.customerId ?? null });
  }, orderId, snapshot().orders.find(o => o.id === orderId)?.outletId);
}
