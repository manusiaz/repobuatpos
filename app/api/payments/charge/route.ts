// POST { paymentId, tenantId? } → the gateway charge (QR string / VA number / deeplink) for a pending payment.
// Staff: Supabase token of a member. Guests (QR menu, kiosk, web store): no token, only for their own guest-source order.
// Demo (no Supabase): the simulator answers from the body ({ paymentId, amount, method, orderNo }).
import { bearer, member } from '../../../../src/integrations/server/auth.ts';
import { HttpError, UUID, body, handle, json } from '../../../../src/integrations/server/http.ts';
import { DEMO } from '../../../../src/integrations/server/supabase.ts';
import { charge, GATEWAY_METHODS } from '../../../../src/integrations/server/payments/flow.ts';
import { simulator } from '../../../../src/integrations/server/payments/index.ts';
import type { GatewayMethod } from '../../../../src/integrations/server/payments/types.ts';
import { QRIS_TTL_MS } from '../../../../src/domain/order.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = handle(async (req: Request) => {
  const b = await body<{ paymentId?: string; tenantId?: string; amount?: number; method?: GatewayMethod; orderNo?: string; expiresAt?: number }>(req);
  if (!b.paymentId) throw new HttpError(400, 'paymentId is required');
  if (DEMO) {
    const method = GATEWAY_METHODS.includes(b.method as GatewayMethod) ? b.method! : 'qris';
    return json({ ok: true, demo: true, provider: 'simulator', ...(await simulator.createCharge({ tenantId: 'demo', paymentId: b.paymentId, orderNo: String(b.orderNo ?? ''), amount: Math.round(Number(b.amount) || 0), method, expiresAt: Number(b.expiresAt) || Date.now() + QRIS_TTL_MS }, { config: {}, secrets: {} })) });
  }
  const guest = !bearer(req);
  const tenant = guest ? String(b.tenantId ?? '') : (await member(req, null, b.tenantId)).tenantId;
  if (!UUID.test(tenant)) throw new HttpError(400, 'tenantId is required');
  return json({ ok: true, ...(await charge(tenant, b.paymentId, guest)) });
});
