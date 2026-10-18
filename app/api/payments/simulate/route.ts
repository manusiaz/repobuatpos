// Staff "Simulate payment" on a tenant running the payment simulator: settles / fails / expires a pending payment that
// was charged through the simulator, by the same path a real gateway webhook takes.
import { member } from '../../../../src/integrations/server/auth.ts';
import { HttpError, body, handle, json } from '../../../../src/integrations/server/http.ts';
import { DEMO } from '../../../../src/integrations/server/db.ts';
import { apply } from '../../../../src/integrations/server/payments/flow.ts';
import { integrations, paymentOrder } from '../../../../src/integrations/server/store.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = handle(async (req: Request) => {
  const b = await body<{ paymentId?: string; status?: string; tenantId?: string }>(req);
  if (DEMO) throw new HttpError(400, 'Demo mode settles in the browser');
  const status = b.status ?? 'settled';
  if (!b.paymentId || !['settled', 'failed', 'expired'].includes(status)) throw new HttpError(400, 'paymentId and status (settled | failed | expired) are required');
  const m = await member(req, null, b.tenantId);
  // a business on a real gateway never settles by simulation, whatever a payment document says about its provider
  if (!(await integrations(m.tenantId, 'payment')).some(i => i.connector === 'simulator')) throw new HttpError(403, 'The payment simulator is not enabled for this business');
  const { payment: p } = await paymentOrder(m.tenantId, b.paymentId);
  if (!p) throw new HttpError(404, 'Payment not found');
  if (p.provider !== 'simulator') throw new HttpError(409, 'Only simulator charges can be simulated');
  return json(await apply(m.tenantId, 'simulator', { paymentId: p.id, status: status as 'settled', providerRef: p.ref, amount: p.amount + (p.tip ?? 0) }));
});
