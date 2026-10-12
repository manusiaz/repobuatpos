// Xendit: QRIS (QR Codes API 2022-07-31), closed single-use virtual accounts, e-wallet charges. Test and live differ
// only by the secret key; webhooks carry the dashboard's verification token in x-callback-token.
import { safeEqual } from '../sign.ts';
import { ProviderError, need, str, type Ctx } from '../types.ts';
import { msisdn } from '../messaging/index.ts';
import { wholeRupiah, type Gateway, type GatewayEvent } from './types.ts';

const API = 'https://api.xendit.co';
const QR_VERSION = { 'api-version': '2022-07-31' };
const auth = (ctx: Ctx) => ({ authorization: 'Basic ' + Buffer.from(ctx.secrets.secretKey + ':').toString('base64') });

async function call(ctx: Ctx, path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  need(ctx, 'secretKey');
  const r = await (ctx.fetch ?? fetch)(API + path, {
    method: init.method ?? 'GET',
    headers: { ...auth(ctx), ...(init.body ? { 'content-type': 'application/json' } : {}), ...init.headers },
    ...(init.body ? { body: JSON.stringify(init.body) } : {}),
  });
  const b = await r.json().catch(() => ({})) as Record<string, any>;
  if (!r.ok) throw new ProviderError(`Xendit ${r.status}: ${str(b.message) || str(b.error_code) || 'request failed'}`);
  return b;
}

export const xendit: Gateway = {
  id: 'xendit',
  async createCharge(x, ctx) {
    const amount = wholeRupiah(x.amount), idem = { 'idempotency-key': x.paymentId };
    if (x.method === 'va') {
      const name = (str(ctx.config.vaName) || x.customer?.name || 'BorNiz').replace(/[^A-Za-z ]/g, '').trim() || 'BorNiz';
      const r = await call(ctx, '/callback_virtual_accounts', { method: 'POST', headers: idem, body: {
        external_id: x.paymentId, bank_code: str(ctx.config.vaBank, 'BCA'), name, is_closed: true, is_single_use: true,
        expected_amount: amount, expiration_date: new Date(x.expiresAt).toISOString() } });
      return { providerRef: str(r.id), vaNumber: str(r.account_number), expiresAt: x.expiresAt };
    }
    if (x.method === 'ewallet') {
      const channel = str(ctx.config.ewallet, 'ID_DANA'), ovo = channel === 'ID_OVO';
      if (ovo && !x.customer?.phone) throw new ProviderError('OVO needs the guest phone number');
      if (!ovo) need(ctx, 'redirectUrl');
      const props = ovo ? { mobile_number: '+' + msisdn(x.customer!.phone!) } : { success_redirect_url: str(ctx.config.redirectUrl) };
      const r = await call(ctx, '/ewallets/charges', { method: 'POST', headers: idem, body: {
        reference_id: x.paymentId, currency: 'IDR', amount, checkout_method: 'ONE_TIME_PAYMENT', channel_code: channel, channel_properties: props } });
      // OVO has no link: the guest confirms the push notification in the OVO app.
      return { providerRef: str(r.id), deeplink: str(r.actions?.mobile_deeplink_checkout_url) || str(r.actions?.desktop_web_checkout_url) || undefined, expiresAt: x.expiresAt };
    }
    const r = await call(ctx, '/qr_codes', { method: 'POST', headers: { ...QR_VERSION, ...idem }, body: {
      reference_id: x.paymentId, type: 'DYNAMIC', currency: 'IDR', amount, expires_at: new Date(x.expiresAt).toISOString() } });
    if (!str(r.qr_string)) throw new ProviderError('Xendit returned no QR string');
    return { providerRef: str(r.id), qrString: str(r.qr_string), expiresAt: x.expiresAt };
  },

  parseWebhook(h, raw, ctx) {
    const token = ctx.secrets.callbackToken;
    if (!token || !safeEqual(h.get('x-callback-token') ?? '', token)) return null;
    let b: Record<string, any>;
    try { b = JSON.parse(raw); } catch { return null; }
    const d = b.data as Record<string, any> | undefined;
    if (d && (d.qr_id || String(b.event).startsWith('qr.'))) {
      const status = ({ SUCCEEDED: 'settled', FAILED: 'failed', EXPIRED: 'expired' } as const)[String(d.status) as 'SUCCEEDED'] ?? 'pending';
      return ev(d.reference_id, status, d.qr_id ?? d.id, d.amount);
    }
    if (d && String(b.event).startsWith('ewallet.')) {
      const status = ({ SUCCEEDED: 'settled', FAILED: 'failed', VOIDED: 'failed' } as const)[String(d.status) as 'SUCCEEDED'] ?? 'pending';
      return ev(d.reference_id, status, d.id, d.capture_amount ?? d.charge_amount);
    }
    // VA paid callback has payment_id; the VA created/updated callback does not and changes nothing (expiry is ours).
    if (b.callback_virtual_account_id || b.external_id) return ev(b.external_id, b.payment_id ? 'settled' : 'pending', b.callback_virtual_account_id ?? b.id, b.amount ?? b.expected_amount);
    return null;
  },

  async refund(x, ctx) {
    const amount = wholeRupiah(x.amount);
    if (x.providerRef.startsWith('ewc_')) {
      const r = await call(ctx, `/ewallets/charges/${encodeURIComponent(x.providerRef)}/refunds`, { method: 'POST', body: { amount, reason: 'REQUESTED_BY_CUSTOMER' } });
      return { refundRef: str(r.id), status: r.status === 'SUCCEEDED' ? 'refunded' : 'pending' };
    }
    if (x.providerRef.startsWith('qr_')) {
      // A QR code is refunded through the payment made on it, which only Xendit knows.
      const list = await call(ctx, `/qr_codes/${encodeURIComponent(x.providerRef)}/payments`, { headers: QR_VERSION });
      const paid = (list.data as { id: string; status: string }[] | undefined)?.find(p => p.status === 'SUCCEEDED');
      if (!paid) throw new ProviderError('Xendit has no settled payment on this QR code');
      const r = await call(ctx, `/qr_codes/payments/${encodeURIComponent(paid.id)}/refunds`, { method: 'POST', headers: QR_VERSION,
        body: { reference_id: `${x.paymentId}-r${Date.now().toString(36)}`, amount, reason: x.reason.slice(0, 255) || 'Refund' } });
      return { refundRef: str(r.id), status: r.status === 'SUCCEEDED' ? 'refunded' : 'pending' };
    }
    throw new ProviderError('Xendit cannot refund a virtual-account transfer through the API; pay the guest back by bank transfer.');
  },

  async test(ctx) {
    need(ctx, 'secretKey');
    const live = ctx.secrets.secretKey.startsWith('xnd_production_');
    if ((str(ctx.config.mode) === 'live') !== live) return { ok: false, message: `Environment is ${str(ctx.config.mode, 'not set')} but the key is a ${live ? 'live' : 'test'} key.` };
    await call(ctx, '/balance');
    return { ok: true, message: `Xendit ${live ? 'live' : 'test'} key accepted.` };
  },
};

const ev = (paymentId: unknown, status: GatewayEvent['status'], ref: unknown, amount: unknown): GatewayEvent | null =>
  paymentId ? { paymentId: String(paymentId), status, providerRef: String(ref ?? ''), amount: Number(amount) || 0 } : null;
