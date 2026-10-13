// POST { paymentId, amount, reason } → refund through the gateway that charged it (owner / manager, after the
// refund approval was decided in the app). The refund record itself is written by the app's refund service.
import { member } from '../../../../src/integrations/server/auth.ts';
import { HttpError, body, handle, json } from '../../../../src/integrations/server/http.ts';
import { DEMO, rpc } from '../../../../src/integrations/server/supabase.ts';
import { gateway } from '../../../../src/integrations/server/payments/index.ts';
import { active, ctxOf, paymentOrder } from '../../../../src/integrations/server/store.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = handle(async (req: Request) => {
  const b = await body<{ paymentId?: string; amount?: number; reason?: string; tenantId?: string }>(req);
  const amount = Math.round(Number(b.amount));
  if (!b.paymentId || !(amount > 0)) throw new HttpError(400, 'paymentId and a positive amount are required');
  if (DEMO) return json({ ok: true, demo: true, refundRef: 'SIMR-' + b.paymentId, status: 'refunded' });
  const m = await member(req, ['owner', 'manager'], b.tenantId);
  const { payment: p } = await paymentOrder(m.tenantId, b.paymentId);
  if (!p?.provider || p.status !== 'settled') throw new HttpError(409, 'Only settled gateway payments are refunded through the gateway');
  const before = Number((p as { gatewayRefunded?: number }).gatewayRefunded ?? 0); // refunds already sent to the gateway for this payment
  if (before + amount > p.amount + (p.tip ?? 0)) throw new HttpError(400, `Refund is larger than what is left on the payment (${p.amount + (p.tip ?? 0) - before})`);
  const i = await active(m.tenantId, 'payment', p.outletId, p.provider), g = gateway(p.provider)!;
  const r = await g.refund({ paymentId: p.id, providerRef: p.ref, amount, reason: String(b.reason ?? '') }, await ctxOf(m.tenantId, i));
  await rpc('bn_server_write', { p_tenant: m.tenantId, p_ops: [{ op: 'put', coll: 'payments', id: p.id, data: { ...p, gatewayRefunded: before + amount } }], p_action: 'payment.gateway_refund' });
  return json({ ok: true, ...r });
});
