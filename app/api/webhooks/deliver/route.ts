// POST { integrationId, event: { id, event, at, data } } → one signed POST to the tenant's own endpoint.
// Idempotent per (event id, connection): several devices may offer the same event; it is delivered once.
// Non-2xx from the endpoint answers 502 so the dispatcher retries with backoff.
import { member } from '../../../../src/integrations/server/auth.ts';
import { HttpError, body, handle, json } from '../../../../src/integrations/server/http.ts';
import { DEMO, rpc } from '../../../../src/integrations/server/supabase.ts';
import { integrationAsMember, secretsOf } from '../../../../src/integrations/server/store.ts';
import { deliver, publicEndpoint } from '../../../../src/integrations/server/webhooks/deliver.ts';
import { EVENTS, subscribed, type OutEvent } from '../../../../src/integrations/server/webhooks/events.ts';
import { str } from '../../../../src/integrations/server/types.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = handle(async (req: Request) => {
  const b = await body<{ integrationId?: string; url?: string; secret?: string; event?: OutEvent; tenantId?: string }>(req), e = b.event;
  if ((!b.integrationId && !b.url) || !e?.id || !(EVENTS as readonly string[]).includes(e.event) || typeof e.data !== 'object') throw new HttpError(400, 'integrationId (or url) and an event { id, event, at, data } are required');
  if (DEMO) throw new HttpError(503, 'Webhooks need the Supabase backend');
  const m = await member(req, null, b.tenantId);
  if (!b.integrationId) { // the endpoint published in Studios › Webhooks & API (url + signing secret from the tenant's own settings)
    if (!publicEndpoint(str(b.url))) throw new HttpError(400, 'Endpoint must be a public https URL');
    if (!b.secret) throw new HttpError(409, 'Signing secret is not set');
    const key = `wh:${e.id}:studio`;
    const c = await rpc<{ claimed: boolean; status?: string }>('bn_outbox_claim', { p_tenant: m.tenantId, p_key: key, p_provider: 'webhook-out' });
    if (!c.claimed) return json({ ok: c.status === 'sent', duplicate: true, status: c.status }, c.status === 'sending' ? 409 : 200);
    const r = await deliver(str(b.url), b.secret, m.tenantId, { id: e.id, event: e.event, at: Number(e.at) || Date.now(), data: e.data });
    await rpc('bn_outbox_done', { p_tenant: m.tenantId, p_key: key, p_provider_id: null, p_status: r.ok ? 'sent' : 'failed', p_error: r.ok ? null : `HTTP ${r.status}` });
    return json({ ok: r.ok, status: r.status }, r.ok ? 200 : 502);
  }
  const i = await integrationAsMember(m.db, m.tenantId, b.integrationId);
  if (i.connector !== 'webhook-out' || !i.enabled) throw new HttpError(409, 'Not an active webhook connection');
  if (!subscribed(i.config, e.event)) return json({ ok: true, skipped: true });
  const key = `wh:${e.id}:${i.id}`;
  const c = await rpc<{ claimed: boolean; status?: string }>('bn_outbox_claim', { p_tenant: m.tenantId, p_key: key, p_provider: 'webhook-out' });
  if (!c.claimed) return json({ ok: c.status === 'sent', duplicate: true, status: c.status }, c.status === 'sending' ? 409 : 200);
  const secrets = await secretsOf(m.tenantId, i.id);
  if (!secrets.secret) { await rpc('bn_outbox_done', { p_tenant: m.tenantId, p_key: key, p_provider_id: null, p_status: 'failed', p_error: 'no secret' }); throw new HttpError(409, 'Signing secret is not set'); }
  const r = await deliver(str(i.config.url), secrets.secret, m.tenantId, { id: e.id, event: e.event, at: Number(e.at) || Date.now(), data: e.data });
  await rpc('bn_outbox_done', { p_tenant: m.tenantId, p_key: key, p_provider_id: null, p_status: r.ok ? 'sent' : 'failed', p_error: r.ok ? null : `HTTP ${r.status}` });
  return json({ ok: r.ok, status: r.status }, r.ok ? 200 : 502);
});
