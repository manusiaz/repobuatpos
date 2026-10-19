// Staff "Simulate payment" on a tenant running the payment simulator: settles / fails / expires a pending payment that
// was charged through the simulator, by the same path a real gateway webhook takes.
import { member } from '../../../../src/integrations/server/auth.ts';
import { tokenOf } from '../../../../src/integrations/server/session.ts';
import { HttpError, UUID, body, handle, json } from '../../../../src/integrations/server/http.ts';
import { DEMO } from '../../../../src/integrations/server/db.ts';
import { apply, GUEST_SOURCES } from '../../../../src/integrations/server/payments/flow.ts';
import { integrations, paymentOrder } from '../../../../src/integrations/server/store.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = handle(async (req: Request) => {
  const b = await body<{ paymentId?: string; status?: string; tenantId?: string }>(req);
  if (DEMO) throw new HttpError(400, 'Demo mode settles in the browser');
  const status = b.status ?? 'settled';
  if (!b.paymentId || !['settled', 'failed', 'expired'].includes(status)) throw new HttpError(400, 'paymentId and status (settled | failed | expired) are required');
  // the business as for the charge: staff of it, or a guest paying for their own guest-source order
  const tenant = req.headers.get('x-borniz-tenant') ?? String(b.tenantId ?? '');
  if (!UUID.test(tenant)) throw new HttpError(400, 'tenantId is required');
  const m = tokenOf(req) ? await member(req, null, tenant).catch(() => null) : null;
  // a business on a real gateway never settles by simulation, whatever a payment document says about its provider
  if (!(await integrations(tenant, 'payment')).some(i => i.connector === 'simulator')) throw new HttpError(403, 'The payment simulator is not enabled for this business');
  const { payment: p, order } = await paymentOrder(tenant, b.paymentId);
  if (!p) throw new HttpError(404, 'Payment not found');
  if (!m && !GUEST_SOURCES.includes(order?.source as never)) throw new HttpError(401, 'Sign in first');
  if (p.provider !== 'simulator') throw new HttpError(409, 'Only simulator charges can be simulated');
  return json(await apply(tenant, 'simulator', { paymentId: p.id, status: status as 'settled', providerRef: p.ref, amount: p.amount + (p.tip ?? 0) }));
});
