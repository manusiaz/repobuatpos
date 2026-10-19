// Sends one queued db.messages row through the business's active connector for its channel, once: the message id is
// the outbox key, so a second device (or the automation worker) gets the first result. Used by /api/messages/send
// (after it checks the caller) and by the worker (src/integrations/server/worker.ts).
import { HttpError } from '../http.ts';
import { rpc } from '../db.ts';
import { active, ctxOf } from '../store.ts';
import { str } from '../types.ts';
import { KIND_OF, sender, type Channel } from './index.ts';

export interface OutMessage { messageId: string; channel: Channel; to: string; template: string; lang?: string; params?: unknown[]; subject?: string; text?: string; from?: string }
type Claim = { claimed: boolean; status?: string; provider_id?: string };

export async function sendMessage(tenant: string, b: OutMessage) {
  const i = await active(tenant, KIND_OF[b.channel]), s = sender(i.connector);
  if (!s) throw new HttpError(409, 'Unknown sender');
  const key = 'msg:' + b.messageId;
  const c = await rpc<Claim>('bn_outbox_claim', { p_tenant: tenant, p_key: key, p_provider: i.connector });
  if (!c.claimed) {
    if (c.status === 'sending') throw new HttpError(409, 'Already being sent by another device');
    return { ok: true, duplicate: true, status: c.status, providerId: c.provider_id };
  }
  const ctx = await ctxOf(tenant, i);
  const input = b.channel === 'wa' ? { to: b.to, template: b.template, lang: str(b.lang) || str(ctx.config.lang, 'id'), params: (b.params ?? []).map(String), idempotencyKey: b.messageId }
    : b.channel === 'email' ? { to: b.to, subject: str(b.subject, b.template), text: str(b.text), from: str(b.from) || undefined, idempotencyKey: b.messageId }
    : { to: b.to, text: str(b.text), idempotencyKey: b.messageId };
  try {
    const r = await s.send(input, ctx);
    await rpc('bn_outbox_done', { p_tenant: tenant, p_key: key, p_provider_id: r.providerId, p_status: 'sent', p_error: null });
    return { ok: true, status: 'sent', providerId: r.providerId, simulated: !!r.simulated };
  } catch (e) {
    await rpc('bn_outbox_done', { p_tenant: tenant, p_key: key, p_provider_id: null, p_status: 'failed', p_error: (e as Error).message.slice(0, 300) }).catch(() => undefined);
    throw e;
  }
}
