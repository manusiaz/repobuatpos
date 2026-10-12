'use client';
// The outbox runner: sends queued db.messages (WhatsApp, email, SMS) and outgoing webhook events, with retries and backoff.
// One tab per browser runs it (Web Lock, else a localStorage lease); across devices the server dedups on the message /
// event id, so several open registers never double-send. Demo mode (no Supabase) uses the simulator: queued → sent → delivered.
import { gatewayWebhook } from '../actions.ts';
import { useEffect } from 'react';
import { commit, snapshot } from '../store.ts';
import { REMOTE, authHeaders } from '../remote.ts';
import type { DB, Message } from '../schema.ts';
import { reportIntegration } from './integrations.ts';
import { subscribed, type OutEvent } from '../../integrations/server/webhooks/events.ts';
import { emailFrom, quietNow, toolValue } from '../../system/tools.ts';
import { linkTo } from '../../system/hosts.ts';

export interface Outgoing { messageId: string; channel: Message['channel']; to: string; template: string; params: string[]; subject: string; text: string; tenantId: string; from?: string }
export interface Result { ok: boolean; status?: string; simulated?: boolean; message?: string; permanent?: boolean }
export interface Transport { message(x: Outgoing): Promise<Result>; webhook?(integrationId: string, e: OutEvent): Promise<Result> }
/** `marketing` messages wait out the quiet hours (Studios › Opt-in & consent); transactional ones never wait. */
export type Render = (db: DB, m: Message) => Pick<Outgoing, 'params' | 'subject' | 'text' | 'from'> & { marketing?: boolean };

const TICK_MS = 3000, DELIVER_MS = 1500, MAX_TRIES = 6, DAY = 864e5;
const backoff = (n: number) => Math.min(5000 * 2 ** n, 10 * 60e3);
const RANK: Record<Message['status'], number> = { queued: 0, sent: 1, failed: 1, delivered: 2, read: 3 };

/** Status only moves forward (queued → sent → delivered → read; queued → failed). */
export function setMessageStatus(id: string, status: Message['status'], by = 'dispatcher') {
  const m = snapshot().messages.find(x => x.id === id);
  if (!m || RANK[status] <= RANK[m.status]) return;
  commit('message.' + status, by, d => { const x = d.messages.find(y => y.id === id); if (x && RANK[status] > RANK[x.status]) x.status = status; }, id);
}

async function post(path: string, payload: unknown): Promise<Result> {
  try {
    const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json', ...(await authHeaders()) }, body: JSON.stringify(payload) });
    const j = (await r.json().catch(() => ({}))) as Result;
    return r.ok ? { ...j, ok: j.ok !== false } : { ok: false, message: j.message ?? `HTTP ${r.status}`, permanent: [400, 401, 403, 404, 422, 501].includes(r.status) };
  } catch (e) { return { ok: false, message: (e as Error).message }; }
}
export const demoTransport: Transport = { message: async () => ({ ok: true, status: 'sent', simulated: true }) };
export const remoteTransport: Transport = {
  message: x => post('/api/messages/send', x),
  webhook: (integrationId, e) => post('/api/webhooks/deliver', { integrationId, event: e }),
};

/** Events since `since`, with ids stable across devices (the server delivers each id once per connection). */
export function webhookEvents(db: DB, since: number): OutEvent[] {
  const out: OutEvent[] = [];
  for (const o of db.orders) if (o.paidAt && o.paidAt >= since && o.status !== 'voided')
    out.push({ id: 'order.paid:' + o.id, event: 'order.paid', at: o.paidAt, data: { orderId: o.id, no: o.no, outletId: o.outletId, source: o.source, subtotal: o.subtotal, discount: o.discount, service: o.service, tax: o.tax, total: o.total } });
  for (const p of db.payments) if (p.status === 'settled' && p.at >= since)
    out.push({ id: 'payment.settled:' + p.id, event: 'payment.settled', at: p.at, data: { paymentId: p.id, orderId: p.orderId, outletId: p.outletId, method: p.method, amount: p.amount, tip: p.tip, ref: p.ref } });
  for (const a of db.approvals) if (a.decidedAt && a.decidedAt >= since && (a.status === 'approved' || a.status === 'rejected'))
    out.push({ id: 'approval.decided:' + a.id, event: 'approval.decided', at: a.decidedAt, data: { approvalId: a.id, type: a.type, title: a.title, status: a.status, amount: a.amount, outletId: a.outletId, requestedBy: a.requestedBy, decidedBy: a.decidedBy } });
  for (const v of db.versions) if (v.status === 'published' && v.at >= since)
    out.push({ id: 'publish.done:' + v.id, event: 'publish.done', at: v.at, data: { versionId: v.id, kind: v.kind, by: v.by, note: v.note } });
  for (const a of db.audit) if (a.action.startsWith('item.86') && a.at >= since)
    out.push({ id: 'item.86:' + a.id, event: 'item.86', at: a.at, data: { subject: a.subject, outletId: a.outletId ?? null, by: a.actor } });
  return out.sort((a, b) => a.at - b.at);
}

// Per-tab memory; the server and the lock make it safe with several tabs and devices.
const flight = new Set<string>(), tries = new Map<string, { n: number; next: number }>(), simulated = new Map<string, number>();
const DONE_KEY = 'borniz-webhooks-done';
let done: Set<string> | null = null;
const doneSet = () => { if (!done) { try { done = new Set(JSON.parse(localStorage.getItem(DONE_KEY) || '[]') as string[]); } catch { done = new Set(); } } return done; };
const markDone = (k: string) => { const s = doneSet(); s.add(k); try { localStorage.setItem(DONE_KEY, JSON.stringify([...s].slice(-3000))); } catch { /* memory only */ } };
const failed = (k: string, now: number) => { const n = (tries.get(k)?.n ?? 0) + 1; tries.set(k, { n, next: now + backoff(n) }); return n; };
const waiting = (k: string, now: number) => (tries.get(k)?.next ?? 0) > now;

const plain: Render = () => ({ params: [], subject: '', text: '' });

/** One pass of the outbox. Exported for tests; the app runs it through useDispatcher(). */
export async function tick({ now = Date.now(), transport = REMOTE ? remoteTransport : demoTransport, render = plain }: { now?: number; transport?: Transport; render?: Render } = {}) {
  for (const [id, at] of simulated) if (now - at >= DELIVER_MS) { simulated.delete(id); setMessageStatus(id, 'delivered'); }
  const db = snapshot();
  for (const m of db.messages) {
    if (m.status !== 'queued' || m.at > now || m.channel === 'push' || flight.has(m.id) || waiting(m.id, now)) continue;
    const { marketing, ...out } = render(db, m);
    if (marketing && quietNow(db, now)) continue;
    flight.add(m.id);
    try {
      const r = await transport.message({ messageId: m.id, channel: m.channel, to: m.to, template: m.template, tenantId: db.tenant.id, ...out });
      if (r.ok) { tries.delete(m.id); setMessageStatus(m.id, r.status === 'delivered' || r.status === 'read' || r.status === 'failed' ? r.status : 'sent'); if (r.simulated) simulated.set(m.id, now); }
      else if (r.permanent || failed(m.id, now) >= MAX_TRIES) { tries.delete(m.id); setMessageStatus(m.id, 'failed'); }
    } finally { flight.delete(m.id); }
  }
  if (!transport.webhook) return;
  for (const i of db.integrations.filter(x => x.connector === 'webhook-out' && x.enabled)) {
    for (const e of webhookEvents(db, Math.max(now - DAY, i.updatedAt))) {
      const k = e.id + '|' + i.id;
      if (!subscribed(i.config, e.event) || doneSet().has(k) || waiting(k, now)) continue;
      const r = await transport.webhook(i.id, e);
      if (r.ok) { tries.delete(k); markDone(k); if (i.status !== 'ok') reportIntegration(i.id, true); continue; }
      const n = r.permanent ? MAX_TRIES : failed(k, now);
      if (n >= MAX_TRIES) { tries.delete(k); markDone(k); reportIntegration(i.id, false, `${e.event} not delivered: ${r.message ?? 'no answer'}`); }
    }
  }
}

/** Runs one pass while holding the per-browser lock; skips when another tab of this browser holds it. */
export async function withLock(fn: () => Promise<void>) {
  const locks = typeof navigator !== 'undefined' ? (navigator as Navigator & { locks?: LockManager }).locks : undefined;
  if (locks) { await locks.request('borniz-dispatcher', { ifAvailable: true }, async l => { if (l) await fn(); }); return; }
  try {
    const k = 'borniz-dispatcher-lease', cur = JSON.parse(localStorage.getItem(k) || 'null') as { owner: string; until: number } | null;
    if (cur && cur.owner !== LEASE && cur.until > Date.now()) return;
    localStorage.setItem(k, JSON.stringify({ owner: LEASE, until: Date.now() + 5 * TICK_MS }));
  } catch { /* no storage: this tab only */ }
  await fn();
}
const LEASE = Math.random().toString(36).slice(2);

/** Template text and positional WhatsApp params from the same templates and variables the studio previews. */
async function loadRender(): Promise<Render> {
  const [{ templates }, { orderVars, fillVars }] = await Promise.all([import('../../screens/studios/messaging.tsx'), import('../../screens/studios/core.tsx')]);
  return (db, m) => {
    const o = m.orderId ? db.orders.find(x => x.id === m.orderId) : undefined;
    const vars: Record<string, unknown> = { brand: db.tenant.name, ...orderVars(db, o?.outletId ?? db.outlets[0]?.id ?? '', m.customerId ?? undefined) };
    const t = templates(db).find(x => x.id === m.template), body = t?.body ?? '', marketing = t?.cat === 'MARKETING', c = toolValue(db, 'optin');
    const foot = m.channel === 'email' && c.footer ? `\n\nUnsubscribe: ${linkTo('/order/customer-links/unsubscribe-message-preferences')}` : m.channel === 'sms' && marketing ? `\nReply ${c.stop} to stop` : '';
    return { params: [...body.matchAll(/\{\{(\w+)\}\}/g)].map(x => (typeof vars[x[1]] === 'string' ? vars[x[1]] as string : '')), subject: `${t?.name ?? m.template.replace(/_/g, ' ')} · ${db.tenant.name}`, text: fillVars(body, vars) + foot,
      ...(m.channel === 'email' && emailFrom(db) ? { from: emailFrom(db) } : {}), marketing };
  };
}

/** Mount once on staff surfaces (App shell). */
export function useDispatcher(enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    let stop = false, timer: ReturnType<typeof setTimeout> | undefined, render: Render = plain;
    loadRender().then(r => { render = r; }).catch(() => undefined);
    const loop = async () => {
      try { await withLock(() => tick({ render })); } catch { /* next pass retries */ }
      if (!stop) timer = setTimeout(loop, TICK_MS);
    };
    timer = setTimeout(loop, 1000);
    return () => { stop = true; clearTimeout(timer); };
  }, [enabled]);
}

/** Remote mode: asks the gateway for the QR / VA / deeplink of a pending payment (the server stores it on the payment). */
export async function chargePayment(paymentId: string) {
  const r = await post('/api/payments/charge', { paymentId, tenantId: snapshot().tenant.id });
  if (!r.ok) throw new Error(r.message ?? 'Could not start the payment');
  return r as Result & { provider: string; providerRef: string; qrString?: string; vaNumber?: string; deeplink?: string; expiresAt: number };
}
/** Remote mode, simulator gateway only: settle / fail / expire a pending payment the way a gateway webhook would. */
export async function simulatePayment(paymentId: string, status: 'settled' | 'failed' | 'expired' = 'settled') {
  const r = await post('/api/payments/simulate', { paymentId, status, tenantId: snapshot().tenant.id });
  if (!r.ok) throw new Error(r.message ?? 'Simulation failed');
}

/** A gateway result for the simulator: applied here on the local adapter, sent through the server (like a real webhook) in remote mode. */
export const gatewayResult = (paymentId: string, status: 'settled' | 'failed' | 'expired') =>
  REMOTE ? simulatePayment(paymentId, status) : Promise.resolve(gatewayWebhook(paymentId, status));
