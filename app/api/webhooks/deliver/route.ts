// POST { integrationId, event: { id, event, at, data } } → one signed POST to the tenant's own endpoint.
// Idempotent per (event id, connection): several devices may offer the same event; it is delivered once.
// Non-2xx from the endpoint answers 502 so the dispatcher retries with backoff.
import { member } from '../../../../src/integrations/server/auth.ts';
import { HttpError, body, handle, json } from '../../../../src/integrations/server/http.ts';
import { DEMO } from '../../../../src/integrations/server/db.ts';
import { integrationAsMember, publishedTool, secretsOf } from '../../../../src/integrations/server/store.ts';
import { deliverOnce, publicEndpoint } from '../../../../src/integrations/server/webhooks/deliver.ts';
import { EVENTS, subscribed, type OutEvent } from '../../../../src/integrations/server/webhooks/events.ts';
import { str } from '../../../../src/integrations/server/types.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = handle(async (req: Request) => {
  const b = await body<{ integrationId?: string; url?: string; event?: OutEvent; tenantId?: string }>(req), e = b.event;
  if ((!b.integrationId && !b.url) || !e?.id || !(EVENTS as readonly string[]).includes(e.event) || typeof e.data !== 'object') throw new HttpError(400, 'integrationId (or url) and an event { id, event, at, data } are required');
  if (DEMO) throw new HttpError(503, 'Webhooks need the database (DATABASE_URL)');
  const m = await member(req, null, b.tenantId);
  if (!b.integrationId) { // the endpoint published in Studios › Webhooks & API, read here: never a url or secret a device sends
    const v = await publishedTool(m, 'hooks');
    const url = str(v.url), secret = str(v.secret);
    if (!publicEndpoint(url)) throw new HttpError(400, 'Endpoint must be a public https URL');
    if (!secret) throw new HttpError(409, 'Signing secret is not set');
    const r = await deliverOnce(m.tenantId, `wh:${e.id}:studio`, url, secret, e);
    return json({ ok: r.ok, status: r.status, ...(r.duplicate ? { duplicate: true } : {}) }, r.ok || r.duplicate ? (r.status === 'sending' ? 409 : 200) : 502);
  }
  const i = await integrationAsMember(m, b.integrationId);
  if (i.connector !== 'webhook-out' || !i.enabled) throw new HttpError(409, 'Not an active webhook connection');
  if (!subscribed(i.config, e.event)) return json({ ok: true, skipped: true });
  const secrets = await secretsOf(m.tenantId, i.id);
  if (!secrets.secret) throw new HttpError(409, 'Signing secret is not set');
  const r = await deliverOnce(m.tenantId, `wh:${e.id}:${i.id}`, str(i.config.url), secrets.secret, e);
  return json({ ok: r.ok, status: r.status, ...(r.duplicate ? { duplicate: true } : {}) }, r.ok || r.duplicate ? (r.status === 'sending' ? 409 : 200) : 502);
});
