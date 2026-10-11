// Gateway → us: POST /api/payments/webhook/<provider>?tenant=<id>. Verify the signature with the tenant's secrets,
// then bn_gateway_update (the only way QRIS / VA / e-wallet settle). Idempotent: retries answer 200.
import { HttpError, UUID, handle, json } from '../../../../../src/integrations/server/http.ts';
import { DEMO } from '../../../../../src/integrations/server/supabase.ts';
import { apply, verify } from '../../../../../src/integrations/server/payments/flow.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = handle(async (req: Request, { params }: { params: Promise<{ provider: string }> }) => {
  const { provider } = await params;
  if (DEMO) throw new HttpError(404, 'Gateway webhooks need the Supabase backend');
  const tenant = new URL(req.url).searchParams.get('tenant') ?? '';
  if (!UUID.test(tenant)) throw new HttpError(400, 'tenant query parameter is required');
  const raw = await req.text();
  const e = await verify(tenant, provider, req.headers, raw);
  if (!e) throw new HttpError(401, 'Signature does not verify');
  return json(await apply(tenant, provider, e));
});
