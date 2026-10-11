// Payment gateways. 'simulator' works end to end; Xendit, Midtrans and DOKU have their settings, secrets and webhook URL
// in place and only need their API calls written here (createCharge, parseWebhook, refund, test).
import { hmac, safeEqual } from '../sign.ts';
import { NotConnected, str, type Ctx } from '../types.ts';
import { connector } from '../../registry.ts';
import type { Charge, ChargeInput, Gateway } from './types.ts';

const SIM_SIG = 'x-simulator-signature';
export const simulator: Gateway = {
  id: 'simulator',
  async createCharge(x: ChargeInput): Promise<Charge> {
    const providerRef = 'SIM-' + x.paymentId;
    if (x.method === 'va') return { providerRef, vaNumber: '8808' + x.paymentId.replace(/\D/g, '').padEnd(12, '0').slice(0, 12), expiresAt: x.expiresAt };
    if (x.method === 'ewallet') return { providerRef, deeplink: `https://simulator.borniz.invalid/pay/${encodeURIComponent(x.paymentId)}`, expiresAt: x.expiresAt };
    return { providerRef, qrString: `BORNIZ-SIMULATOR|${x.tenantId}|${x.paymentId}|${x.orderNo}|${x.amount}`, expiresAt: x.expiresAt };
  },
  parseWebhook(headers, raw, ctx) {
    const secret = ctx.secrets.webhookSecret, sig = headers.get(SIM_SIG) ?? '';
    if (!secret || !safeEqual(sig, hmac(secret, raw))) return null;
    try {
      const b = JSON.parse(raw) as Record<string, unknown>;
      if (!['settled', 'failed', 'expired'].includes(String(b.status)) || !b.paymentId) return null;
      return { paymentId: String(b.paymentId), status: b.status as 'settled', providerRef: str(b.providerRef, 'SIM-' + b.paymentId), amount: Number(b.amount) };
    } catch { return null; }
  },
  async refund(x) { return { refundRef: 'SIMR-' + x.paymentId, status: 'refunded' }; },
  async test() { return { ok: true, message: 'Simulator ready: charges are fake and settle from the Simulate button.' }; },
};
/** Signs a simulator webhook body (tests, and the server-side Simulate button). */
export const simulatorSignature = (secret: string, raw: string) => ({ [SIM_SIG]: hmac(secret, raw) });

const pending = (id: string): Gateway => {
  const name = connector(id)?.name ?? id;
  const fail = async (): Promise<never> => { throw new NotConnected(name); };
  return { id, createCharge: fail, refund: fail, parseWebhook: () => { throw new NotConnected(name); },
    test: async (ctx: Ctx) => ({ ok: false, message: `${name}: settings saved (${Object.keys(ctx.secrets).length} secret${Object.keys(ctx.secrets).length === 1 ? '' : 's'} stored); the API driver is not written yet.` }) };
};

export const GATEWAYS: Record<string, Gateway> = { simulator, xendit: pending('xendit'), midtrans: pending('midtrans'), doku: pending('doku') };
export const gateway = (id: string): Gateway | undefined => GATEWAYS[id];
