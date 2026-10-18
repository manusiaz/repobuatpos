// Platform → us: POST /api/delivery/webhook/<gofood | grabfood | shopeefood>?tenant=<id>. The signature is checked with
// each outlet connection's secret; the order lands at the outlet whose merchant ID it names (bn_platform_order: idempotent
// on the platform order id, numbered by the server sequence, raises "New online order").
import { HttpError, UUID, handle, json } from '../../../../../src/integrations/server/http.ts';
import { DEMO, rpc } from '../../../../../src/integrations/server/db.ts';
import { PLATFORMS, normalizeOrder, parsePlatform, type Platform } from '../../../../../src/integrations/server/delivery/index.ts';
import { integrations, secretsOf } from '../../../../../src/integrations/server/store.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = handle(async (req: Request, { params }: { params: Promise<{ platform: string }> }) => {
  const platform = (await params).platform as Platform;
  if (!PLATFORMS.includes(platform)) throw new HttpError(404, 'Unknown platform');
  if (DEMO) throw new HttpError(404, 'Delivery webhooks need the database (DATABASE_URL)');
  const tenant = new URL(req.url).searchParams.get('tenant') ?? '';
  if (!UUID.test(tenant)) throw new HttpError(400, 'tenant query parameter is required');
  const raw = await req.text();
  for (const i of (await integrations(tenant, 'delivery')).filter(x => x.connector === platform)) {
    let o;
    try { o = parsePlatform(platform, req.headers, raw, await secretsOf(tenant, i.id)); } catch (e) { throw (e as { status?: number }).status ? e : new HttpError(400, (e as Error).message); }
    if (!o || String(o.merchantId) !== String(i.config.merchantId) || !i.outletId) continue;
    const r = await rpc<{ id: string; no: string; status: string }>('bn_platform_order', { p_tenant: tenant, p_order: normalizeOrder(platform, o, i.outletId) });
    return json({ ok: true, orderId: r?.id, no: r?.no, status: r?.status });
  }
  throw new HttpError(401, 'Signature or merchant ID does not match any outlet connection');
});
