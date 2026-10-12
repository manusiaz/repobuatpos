// POST { messageId, channel, to, template, lang?, params?, subject?, text? } → sends one db.messages row through the
// tenant's active connector for that channel. messageId is the idempotency key: a second device gets the first result.
import { member } from '../../../../src/integrations/server/auth.ts';
import { HttpError, body, handle, json } from '../../../../src/integrations/server/http.ts';
import { DEMO, rpc } from '../../../../src/integrations/server/supabase.ts';
import { KIND_OF, sender, type Channel } from '../../../../src/integrations/server/messaging/index.ts';
import { active, ctxOf } from '../../../../src/integrations/server/store.ts';
import { str } from '../../../../src/integrations/server/types.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Claim = { claimed: boolean; status?: string; provider_id?: string };

export const POST = handle(async (req: Request) => {
  const b = await body<{ messageId?: string; channel?: Channel; to?: string; template?: string; lang?: string; params?: unknown[]; subject?: string; text?: string; from?: string; tenantId?: string }>(req);
  const channel = b.channel as Channel;
  if (!b.messageId || !KIND_OF[channel] || !b.to?.trim() || !b.template) throw new HttpError(400, 'messageId, channel (wa | email | sms), to and template are required');
  if (DEMO) return json({ ok: true, demo: true, status: 'sent', providerId: 'sim-' + b.messageId, simulated: true });
  const m = await member(req, null, b.tenantId);
  const i = await active(m.tenantId, KIND_OF[channel]), s = sender(i.connector);
  if (!s) throw new HttpError(409, 'Unknown sender');
  const key = 'msg:' + b.messageId;
  const c = await rpc<Claim>('bn_outbox_claim', { p_tenant: m.tenantId, p_key: key, p_provider: i.connector });
  if (!c.claimed) {
    if (c.status === 'sending') throw new HttpError(409, 'Already being sent by another device');
    return json({ ok: true, duplicate: true, status: c.status, providerId: c.provider_id });
  }
  const ctx = await ctxOf(m.tenantId, i);
  const input = channel === 'wa' ? { to: b.to, template: b.template, lang: str(b.lang) || str(ctx.config.lang, 'id'), params: (b.params ?? []).map(String), idempotencyKey: b.messageId }
    : channel === 'email' ? { to: b.to, subject: str(b.subject, b.template), text: str(b.text), from: str(b.from) || undefined, idempotencyKey: b.messageId }
    : { to: b.to, text: str(b.text), idempotencyKey: b.messageId };
  try {
    const r = await s.send(input, ctx);
    await rpc('bn_outbox_done', { p_tenant: m.tenantId, p_key: key, p_provider_id: r.providerId, p_status: 'sent', p_error: null });
    return json({ ok: true, status: 'sent', providerId: r.providerId, simulated: !!r.simulated });
  } catch (e) {
    await rpc('bn_outbox_done', { p_tenant: m.tenantId, p_key: key, p_provider_id: null, p_status: 'failed', p_error: (e as Error).message.slice(0, 300) }).catch(() => undefined);
    throw e;
  }
});
