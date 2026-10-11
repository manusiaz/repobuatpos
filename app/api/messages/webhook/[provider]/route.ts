// Provider → us: delivery receipts (sent / delivered / read / failed) for messages we sent. ?tenant=<id>.
// GET answers Meta's subscription check (hub.verify_token must match the connection's verify token).
import { HttpError, UUID, handle, json } from '../../../../../src/integrations/server/http.ts';
import { DEMO, rpc } from '../../../../../src/integrations/server/supabase.ts';
import { metaCloud } from '../../../../../src/integrations/server/messaging/index.ts';
import { ctxOf, integrations } from '../../../../../src/integrations/server/store.ts';
import { safeEqual } from '../../../../../src/integrations/server/sign.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type P = { params: Promise<{ provider: string }> };

async function setup(req: Request, params: P['params']) {
  const { provider } = await params;
  if (provider !== 'meta-cloud') throw new HttpError(404, 'Unknown provider');
  if (DEMO) throw new HttpError(404, 'Message webhooks need the Supabase backend');
  const tenant = new URL(req.url).searchParams.get('tenant') ?? '';
  if (!UUID.test(tenant)) throw new HttpError(400, 'tenant query parameter is required');
  const ctxs = await Promise.all((await integrations(tenant, 'whatsapp')).filter(i => i.connector === provider).map(i => ctxOf(tenant, i)));
  return { tenant, provider, ctxs };
}

export const GET = handle(async (req: Request, { params }: P) => {
  const { ctxs } = await setup(req, params), q = new URL(req.url).searchParams;
  const token = q.get('hub.verify_token') ?? '';
  if (q.get('hub.mode') !== 'subscribe' || !token || !ctxs.some(c => c.secrets.verifyToken && safeEqual(c.secrets.verifyToken, token))) throw new HttpError(403, 'Verify token does not match');
  return new Response(q.get('hub.challenge') ?? '', { headers: { 'content-type': 'text/plain' } });
});

export const POST = handle(async (req: Request, { params }: P) => {
  const { tenant, provider, ctxs } = await setup(req, params), raw = await req.text();
  const updates = ctxs.map(c => metaCloud.parseStatus(req.headers, raw, c)).find(u => u);
  if (!updates) throw new HttpError(401, 'Signature does not verify');
  for (const u of updates) await rpc('bn_outbox_status', { p_tenant: tenant, p_provider: provider, p_provider_id: u.providerId, p_status: u.status });
  return json({ ok: true, updated: updates.length });
});
