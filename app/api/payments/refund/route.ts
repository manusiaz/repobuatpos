// POST { paymentId, approvalId, amount, reason } → refund through the gateway that charged it (owner / manager), only
// against an approved refund request for that payment's order, at most its amount, once per approval (the outbox claim
// is the lock: two devices or a replay never refund twice; once the gateway paid back, a retry gets that result). The
// refund record itself is written by the app's refund service.
import { member } from '../../../../src/integrations/server/auth.ts';
import { HttpError, body, handle, json } from '../../../../src/integrations/server/http.ts';
import { DEMO, as, rpc } from '../../../../src/integrations/server/db.ts';
import { gateway } from '../../../../src/integrations/server/payments/index.ts';
import type { RefundResult } from '../../../../src/integrations/server/payments/types.ts';
import { active, ctxOf, paymentOrder } from '../../../../src/integrations/server/store.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = handle(async (req: Request) => {
  const b = await body<{ paymentId?: string; approvalId?: string; amount?: number; reason?: string; tenantId?: string }>(req);
  const amount = Math.round(Number(b.amount));
  if (!b.paymentId || !(amount > 0)) throw new HttpError(400, 'paymentId and a positive amount are required');
  if (DEMO) return json({ ok: true, demo: true, refundRef: 'SIMR-' + b.paymentId, status: 'refunded' });
  const m = await member(req, ['owner', 'manager'], b.tenantId);
  const { payment: p } = await paymentOrder(m.tenantId, b.paymentId);
  if (!p?.provider || p.status !== 'settled') throw new HttpError(409, 'Only settled gateway payments are refunded through the gateway');
  const before = Number((p as { gatewayRefunded?: number }).gatewayRefunded ?? 0); // refunds already sent to the gateway for this payment
  if (before + amount > p.amount + (p.tip ?? 0)) throw new HttpError(400, `Refund is larger than what is left on the payment (${p.amount + (p.tip ?? 0) - before})`);
  const a = (await as(m.userId, m.cell, c => c.query("select data from public.docs where tenant_id = $1 and coll = 'approvals' and id = $2", [m.tenantId, String(b.approvalId ?? '')]))).rows[0]?.data as
    { type?: string; status?: string; subjectId?: string; amount?: number } | undefined;
  if (a?.type !== 'refund' || a.status !== 'approved' || a.subjectId !== p.orderId) throw new HttpError(403, 'Refunds go through the gateway only with an approved refund request for this order');
  if (amount > Number(a.amount)) throw new HttpError(400, `The approval covers ${a.amount}, not ${amount}`);
  const key = 'refund:' + b.approvalId;
  const c = await rpc<{ claimed: boolean; status?: string; provider_id?: string }>('bn_outbox_claim', { p_tenant: m.tenantId, p_key: key, p_provider: p.provider });
  if (!c.claimed) {
    if (c.status === 'sending') throw new HttpError(409, 'This refund is still being sent. Check the gateway before trying again.');
    return json({ ok: c.status !== 'failed', duplicate: true, status: c.status, refundRef: c.provider_id });
  }
  let r: RefundResult;
  try {
    const i = await active(m.tenantId, 'payment', p.outletId, p.provider), g = gateway(p.provider)!;
    r = await g.refund({ paymentId: p.id, providerRef: p.ref, amount, reason: String(b.reason ?? '') }, await ctxOf(m.tenantId, i));
  } catch (e) { // only a refund the gateway refused may be tried again
    await rpc('bn_outbox_done', { p_tenant: m.tenantId, p_key: key, p_provider_id: null, p_status: 'failed', p_error: (e as Error).message.slice(0, 300) }).catch(() => undefined);
    throw e;
  }
  await rpc('bn_outbox_done', { p_tenant: m.tenantId, p_key: key, p_provider_id: r.refundRef ?? null, p_status: 'sent', p_error: null });
  await rpc('bn_server_write', { p_tenant: m.tenantId, p_ops: [{ op: 'put', coll: 'payments', id: p.id, data: { ...p, gatewayRefunded: before + amount } }], p_action: 'payment.gateway_refund' });
  return json({ ok: true, ...r });
});
