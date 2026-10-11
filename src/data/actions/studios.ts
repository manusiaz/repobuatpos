'use client';
// Studios: messaging (WABA / email / SMS), consent and provider callbacks. Writes only through commit().
import { commit, snapshot, uid } from '../store.ts';
import type { Message } from '../schema.ts';

type Status = Message['status'];

/** Provider delivery receipt (WhatsApp Cloud API / email webhook). Status only moves forward; failed is final. */
export function messageStatus(id: string, status: Status) {
  const order: Status[] = ['queued', 'sent', 'delivered', 'read'];
  commit('message.' + status, 'provider', d => {
    const m = d.messages.find(x => x.id === id); if (!m || m.status === 'failed') return;
    if (status === 'failed' || order.indexOf(status) > order.indexOf(m.status)) m.status = status;
  }, id);
}

/** Queue messages (test sends, "Run now" on an automation). The local adapter plays the provider's receipts back. */
export function queueMessages(rows: { channel: Message['channel']; template: string; to: string; customerId: string | null; at?: number }[], by: string, live = true) {
  const ids = rows.map(() => uid('ms'));
  commit('message.queued', by, d => { rows.forEach((r, i) => d.messages.unshift({ id: ids[i], channel: r.channel, template: r.template, to: r.to, customerId: r.customerId, status: 'queued', at: r.at ?? Date.now() })); }, rows[0]?.template ?? '');
  if (live && typeof window !== 'undefined') ids.forEach((id, i) => {
    const bad = !/\d{6,}|@/.test(rows[i].to.replace(/\s/g, ''));
    setTimeout(() => messageStatus(id, bad ? 'failed' : 'sent'), 900);
    if (!bad) { setTimeout(() => messageStatus(id, 'delivered'), 2200); if (rows[i].channel === 'wa') setTimeout(() => messageStatus(id, 'read'), 5200); }
  });
  return ids;
}

/** Retry a failed message as a new send (the failed row stays in the log). */
export function retryMessage(id: string, by: string) {
  const m = snapshot().messages.find(x => x.id === id); if (!m) return;
  queueMessages([{ channel: m.channel, template: m.template, to: m.to, customerId: m.customerId }], by);
}

/** Consent: marketing needs opt-in; transactional messages (receipt, order ready) don't. STOP replies set optIn false. */
export function setOptIn(customerId: string, optIn: boolean, by: string) {
  commit(optIn ? 'consent.opt_in' : 'consent.opt_out', by, d => { const c = d.customers.find(x => x.id === customerId); if (c) c.optIn = optIn; }, customerId);
}
