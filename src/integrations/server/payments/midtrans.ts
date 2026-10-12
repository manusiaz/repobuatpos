// Midtrans Core API: QRIS, bank-transfer VA, GoPay / ShopeePay. Environment setting picks sandbox or production.
// Midtrans often answers HTTP 200 with an error in body.status_code, so both are checked.
import { safeEqual, sha } from '../sign.ts';
import { ProviderError, need, str, type Ctx } from '../types.ts';
import { wholeRupiah, type Gateway, type GatewayEvent } from './types.ts';

const base = (ctx: Ctx) => str(ctx.config.mode) === 'live' ? 'https://api.midtrans.com' : 'https://api.sandbox.midtrans.com';

async function send(ctx: Ctx, path: string, body?: unknown) {
  need(ctx, 'serverKey');
  const r = await (ctx.fetch ?? fetch)(base(ctx) + path, {
    method: body ? 'POST' : 'GET',
    headers: { authorization: 'Basic ' + Buffer.from(ctx.secrets.serverKey + ':').toString('base64'), accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const b = await r.json().catch(() => ({})) as Record<string, any>;
  return { code: str(b.status_code, String(r.status)), b };
}
async function call(ctx: Ctx, path: string, body?: unknown) {
  const { code, b } = await send(ctx, path, body);
  if (!/^2/.test(code)) throw new ProviderError(`Midtrans ${code}: ${str(b.validation_messages?.[0]) || str(b.status_message) || 'request failed'}`);
  return b;
}
const action = (b: Record<string, any>, name: string) => str((b.actions as { name: string; url: string }[] | undefined)?.find(a => a.name === name)?.url);

export const midtrans: Gateway = {
  id: 'midtrans',
  async createCharge(x, ctx) {
    const req: Record<string, unknown> = {
      transaction_details: { order_id: x.paymentId, gross_amount: wholeRupiah(x.amount) },
      custom_expiry: { expiry_duration: Math.max(1, Math.ceil((x.expiresAt - Date.now()) / 60_000)), unit: 'minute' },
      ...(x.customer ? { customer_details: { first_name: x.customer.name, phone: x.customer.phone, email: x.customer.email } } : {}),
    };
    if (x.method === 'va') {
      const bank = str(ctx.config.vaBank, 'bca');
      const b = await call(ctx, '/v2/charge', { ...req, payment_type: 'bank_transfer', bank_transfer: { bank } });
      const va = bank === 'permata' ? str(b.permata_va_number) : str(b.va_numbers?.[0]?.va_number);
      if (!va) throw new ProviderError('Midtrans returned no VA number');
      return { providerRef: str(b.transaction_id), vaNumber: va, expiresAt: x.expiresAt };
    }
    if (x.method === 'ewallet') {
      const type = str(ctx.config.ewallet, 'gopay'), back = str(ctx.config.redirectUrl);
      const b = await call(ctx, '/v2/charge', { ...req, payment_type: type, [type]: type === 'gopay' ? { enable_callback: !!back, callback_url: back || undefined } : { callback_url: back || undefined } });
      return { providerRef: str(b.transaction_id), deeplink: action(b, 'deeplink-redirect') || undefined, expiresAt: x.expiresAt };
    }
    const b = await call(ctx, '/v2/charge', { ...req, payment_type: 'qris', qris: { acquirer: 'gopay' } });
    const qr = str(b.qr_string), img = action(b, 'generate-qr-code');
    if (!qr && !img) throw new ProviderError('Midtrans returned no QR');
    // Without qr_string the QR image link goes in deeplink: encoding the link itself would not be a QRIS payload.
    return { providerRef: str(b.transaction_id), qrString: qr || undefined, deeplink: qr ? undefined : img, expiresAt: x.expiresAt };
  },

  parseWebhook(_h, raw, ctx) {
    const key = ctx.secrets.serverKey;
    if (!key) return null;
    let b: Record<string, any>;
    try { b = JSON.parse(raw); } catch { return null; }
    if (!b.order_id || !safeEqual(str(b.signature_key), sha(`${b.order_id}${b.status_code}${b.gross_amount}${key}`, 'sha512'))) return null;
    const t = str(b.transaction_status);
    const status: GatewayEvent['status'] = t === 'settlement' || (t === 'capture' && str(b.fraud_status, 'accept') === 'accept') ? 'settled'
      : ['deny', 'cancel', 'failure'].includes(t) ? 'failed' : t === 'expire' ? 'expired' : 'pending';
    return { paymentId: String(b.order_id), status, providerRef: str(b.transaction_id), amount: Number(b.gross_amount) || 0 };
  },

  async refund(x, ctx) {
    const b = await call(ctx, `/v2/${encodeURIComponent(x.paymentId)}/refund`, { refund_key: `${x.paymentId}-r${Date.now().toString(36)}`, amount: wholeRupiah(x.amount), reason: x.reason.slice(0, 255) || 'Refund' });
    return { refundRef: str(b.refund_key) || str(b.refund_chargeback_id), status: b.status_code === '200' ? 'refunded' : 'pending' };
  },

  async test(ctx) {
    // An order that cannot exist: 404 = the key is accepted, 401 = it is not.
    const { code, b } = await send(ctx, `/v2/borniz-test-${Date.now().toString(36)}/status`);
    if (code === '404') return { ok: true, message: `Midtrans ${str(ctx.config.mode) === 'live' ? 'production' : 'sandbox'} server key accepted.` };
    return { ok: false, message: code === '401' ? `Midtrans rejected the server key (check it belongs to ${str(ctx.config.mode) === 'live' ? 'production' : 'sandbox'}).` : `Midtrans ${code}: ${str(b.status_message, 'unexpected answer')}` };
  },
};
