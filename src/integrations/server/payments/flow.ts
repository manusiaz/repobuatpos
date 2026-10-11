// What the payment routes do: charge a pending payment, apply a verified gateway event. Amounts always come from the
// database (the pending payment doc), never from the caller.
import { QRIS_TTL_MS } from '../../../domain/order.ts';
import { HttpError } from '../http.ts';
import { rpc } from '../supabase.ts';
import { active, ctxOf, integrations, paymentOrder } from '../store.ts';
import type { Headers } from '../types.ts';
import { gateway } from './index.ts';
import type { Charge, GatewayEvent, GatewayMethod } from './types.ts';

export const GATEWAY_METHODS: GatewayMethod[] = ['qris', 'va', 'ewallet'];
export const GUEST_SOURCES = ['qr', 'kiosk', 'web'];
type Stored = { qr?: string; va?: string; deeplink?: string; ref: string; provider?: string; expiresAt: number | null };

export async function charge(tenant: string, paymentId: string, guest: boolean): Promise<Charge & { provider: string }> {
  const { payment: p, order: o } = await paymentOrder(tenant, paymentId);
  if (!p || !o) throw new HttpError(404, 'Payment not found');
  if (guest && !GUEST_SOURCES.includes(o.source)) throw new HttpError(401, 'Sign in first');
  if (p.status !== 'pending' || !GATEWAY_METHODS.includes(p.method as GatewayMethod)) throw new HttpError(409, `Payment is ${p.status}`);
  const done = p as typeof p & Stored;
  if (done.provider) return { provider: done.provider, providerRef: done.ref, qrString: done.qr, vaNumber: done.va, deeplink: done.deeplink, expiresAt: done.expiresAt ?? 0 };
  const i = await active(tenant, 'payment', p.outletId), g = gateway(i.connector);
  if (!g) throw new HttpError(409, 'Unknown payment gateway');
  const c = await g.createCharge({ tenantId: tenant, paymentId, orderNo: o.no, amount: p.amount + (p.tip ?? 0), method: p.method as GatewayMethod, expiresAt: p.expiresAt ?? Date.now() + QRIS_TTL_MS }, await ctxOf(tenant, i));
  await rpc('bn_gateway_charge', { p_tenant: tenant, p_payment_id: paymentId, p_provider: g.id, p_ref: c.providerRef, p_qr: c.qrString ?? null, p_va: c.vaNumber ?? null, p_deeplink: c.deeplink ?? null, p_expires_at: c.expiresAt });
  return { provider: g.id, ...c };
}

/** Verifies the webhook against each enabled connection of that provider; null when no secret matches. */
export async function verify(tenant: string, provider: string, h: Headers, raw: string): Promise<GatewayEvent | null> {
  const g = gateway(provider);
  if (!g) throw new HttpError(404, 'Unknown provider');
  for (const i of (await integrations(tenant, 'payment')).filter(x => x.connector === provider)) {
    const e = g.parseWebhook(h, raw, await ctxOf(tenant, i));
    if (e) return e;
  }
  return null;
}

/** Idempotent: a payment that is no longer pending is returned as it is (gateways retry). */
export async function apply(tenant: string, provider: string, e: GatewayEvent) {
  const { payment: p } = await paymentOrder(tenant, e.paymentId);
  if (!p) return { ok: true, ignored: 'unknown payment' };
  if (p.status !== 'pending') return { ok: true, status: p.status, duplicate: true };
  if ((p as Stored).provider && (p as Stored).provider !== provider) throw new HttpError(409, 'Payment was charged through another gateway');
  if (e.status === 'settled' && Math.round(e.amount) !== p.amount + (p.tip ?? 0)) throw new HttpError(422, 'Amount does not match the payment');
  const d = await rpc<{ status: string }>('bn_gateway_update', { p_tenant: tenant, p_payment_id: e.paymentId, p_status: e.status, p_provider: provider, p_payload: { providerRef: e.providerRef, amount: e.amount } });
  return { ok: true, status: d?.status ?? e.status };
}
