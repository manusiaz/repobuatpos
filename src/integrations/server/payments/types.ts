import { ProviderError, type Ctx, type Headers, type TestResult } from '../types.ts';

export type GatewayMethod = 'qris' | 'va' | 'ewallet';
export interface ChargeInput {
  tenantId: string; paymentId: string; orderNo: string; amount: number; method: GatewayMethod; expiresAt: number;
  customer?: { name?: string; phone?: string; email?: string };
}
export interface Charge { providerRef: string; qrString?: string; vaNumber?: string; deeplink?: string; expiresAt: number }
/** 'pending' = signature verified but not final (charge created, fraud challenge, refund notice): answered 200, nothing changes. */
export interface GatewayEvent { paymentId: string; status: 'settled' | 'failed' | 'expired' | 'pending'; providerRef: string; amount: number }
export interface RefundInput { paymentId: string; providerRef: string; amount: number; reason: string }
export interface RefundResult { refundRef: string; status: 'refunded' | 'pending' }

/** Every payment gateway implements this. paymentId is the idempotency key everywhere (charge, webhook, refund). */
export interface Gateway {
  id: string;
  createCharge(input: ChargeInput, ctx: Ctx): Promise<Charge>;
  /** null = signature does not verify (the route answers 401). */
  parseWebhook(headers: Headers, rawBody: string, ctx: Ctx): GatewayEvent | null;
  refund(input: RefundInput, ctx: Ctx): Promise<RefundResult>;
  test(ctx: Ctx): Promise<TestResult>;
}

/** Gateways take whole rupiah only; a fraction means a bug upstream, never something to round away. */
export function wholeRupiah(n: number) {
  if (!Number.isInteger(n) || n <= 0) throw new ProviderError('Amount must be a positive whole number of rupiah');
  return n;
}
