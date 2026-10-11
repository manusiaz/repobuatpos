'use client';
// Hardware services: card approval on the payment, the cash drawer log, pairing a physical device to an integration.
import { commit, uid } from '../store.ts';

/** EDC result on the card payment it settled. Set once, right after the charge (an approved card payment is never edited). */
export function setPaymentRef(paymentId: string, ref: string, by: string) {
  commit('payment.edc_ref', by, d => {
    const p = d.payments.find(x => x.id === paymentId);
    if (p && p.method === 'card' && p.ref.startsWith('REF-')) p.ref = ref;
  }, paymentId);
}

export const DRAWER_LOG = 'drawer_log';
export type DrawerReason = 'cash_sale' | 'no_sale' | 'test';
/** Every drawer open (sale, no-sale override, test). records.drawer_log: a=reason b=outlet c=who d=printer e=order/approver/error. */
export function logDrawer(x: { outletId: string; reason: DrawerReason; printer: string; note: string; ok: boolean }, by: string) {
  commit(x.ok ? 'drawer.kicked' : 'drawer.kick_failed', by, d => {
    const who = d.employees.find(e => e.id === by)?.name ?? by;
    (d.records[DRAWER_LOG] ??= []).unshift({ id: uid('dk'), a: x.reason, b: d.outlets.find(o => o.id === x.outletId)?.name ?? x.outletId, c: who, d: x.printer, e: x.ok ? x.note : 'Failed: ' + x.note, at: Date.now() });
    if (d.records[DRAWER_LOG].length > 500) d.records[DRAWER_LOG].length = 500;
  }, x.reason, x.outletId);
}

/** Remember which physical device (USB / serial / Bluetooth / HID descriptor) an integration drives. */
export function setIntegrationConfig(id: string, patch: Record<string, string | number | boolean>, by: string) {
  commit('integration.paired', by, d => { const i = d.integrations.find(x => x.id === id); if (i) { i.config = { ...i.config, ...patch }; i.updatedBy = by; i.updatedAt = Date.now(); } }, id);
}
