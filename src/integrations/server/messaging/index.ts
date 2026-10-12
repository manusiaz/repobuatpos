// Message senders. Simulators work everywhere; Meta WhatsApp Cloud API and Resend are real HTTP drivers;
// Qontak, Wati, Fonnte, SMTP and Twilio have their settings in place and only need send()/test() written here.
import { hmac, safeEqual } from '../sign.ts';
import { NotConnected, ProviderError, need, str, type Ctx, type Headers, type TestResult } from '../types.ts';
import { connector } from '../../registry.ts';

export type Channel = 'wa' | 'email' | 'sms';
export interface WaInput { to: string; template: string; lang: string; params: string[]; idempotencyKey: string }
/** `from`: the merchant's own sender (Studios › Email sender domain); else the connector's From. */
export interface EmailInput { to: string; subject: string; text: string; html?: string; from?: string; idempotencyKey: string }
export interface SmsInput { to: string; text: string; idempotencyKey: string }
export interface Sent { providerId: string; simulated?: boolean }
export interface StatusUpdate { providerId: string; status: 'sent' | 'delivered' | 'read' | 'failed' }

export interface Sender<I> { id: string; channel: Channel; send(x: I, ctx: Ctx): Promise<Sent>; test(ctx: Ctx): Promise<TestResult> }
export const KIND_OF: Record<Channel, 'whatsapp' | 'email' | 'sms'> = { wa: 'whatsapp', email: 'email', sms: 'sms' };

/** Indonesian numbers to E.164 digits without '+': 0812… / +62 812… / 62812… → 62812…. Emails pass through. */
export const msisdn = (to: string) => {
  if (to.includes('@')) return to.trim();
  const d = to.replace(/\D/g, '');
  return d.startsWith('0') ? '62' + d.slice(1) : d.startsWith('8') ? '62' + d : d;
};

const sim = <I extends { idempotencyKey: string }>(id: string, channel: Channel): Sender<I> => ({
  id, channel,
  async send(x) { return { providerId: 'sim-' + x.idempotencyKey, simulated: true }; },
  async test() { return { ok: true, message: 'Simulator ready: messages are marked sent and delivered without leaving BorNiz.' }; },
});
const pending = <I>(id: string, channel: Channel): Sender<I> => {
  const name = connector(id)?.name ?? id;
  return { id, channel, send: async () => { throw new NotConnected(name); }, test: async () => ({ ok: false, message: `${name}: settings saved; the API driver is not written yet.` }) };
};
async function call(ctx: Ctx, url: string, init: RequestInit, who: string) {
  const r = await (ctx.fetch ?? fetch)(url, init);
  const body = await r.json().catch(() => ({})) as Record<string, any>;
  if (!r.ok) throw new ProviderError(`${who} ${r.status}: ${str(body?.error?.message) || str(body?.message) || str(body?.name) || 'request failed'}`);
  return body;
}

// ── WhatsApp Cloud API (Meta) ───────────────────────────────────────────────────────────────
const graph = (ctx: Ctx) => `https://graph.facebook.com/${str(ctx.config.version, 'v21.0')}`;
export const metaCloud: Sender<WaInput> & { parseStatus(h: Headers, raw: string, ctx: Ctx): StatusUpdate[] | null } = {
  id: 'meta-cloud', channel: 'wa',
  async send(x, ctx) {
    need(ctx, 'phoneNumberId', 'accessToken');
    const body = {
      messaging_product: 'whatsapp', recipient_type: 'individual', to: msisdn(x.to), type: 'template',
      template: { name: x.template, language: { code: x.lang || str(ctx.config.lang, 'id') }, ...(x.params.length ? { components: [{ type: 'body', parameters: x.params.map(text => ({ type: 'text', text })) }] } : {}) },
    };
    const r = await call(ctx, `${graph(ctx)}/${str(ctx.config.phoneNumberId)}/messages`, { method: 'POST', headers: { authorization: `Bearer ${ctx.secrets.accessToken}`, 'content-type': 'application/json' }, body: JSON.stringify(body) }, 'WhatsApp');
    const id = str(r.messages?.[0]?.id);
    if (!id) throw new ProviderError('WhatsApp accepted the request but returned no message id');
    return { providerId: id };
  },
  async test(ctx) {
    need(ctx, 'phoneNumberId', 'accessToken');
    const r = await call(ctx, `${graph(ctx)}/${str(ctx.config.phoneNumberId)}?fields=display_phone_number,verified_name`, { headers: { authorization: `Bearer ${ctx.secrets.accessToken}` } }, 'WhatsApp');
    return { ok: true, message: `Connected: ${str(r.verified_name, 'WhatsApp number')} ${str(r.display_phone_number)}`.trim() };
  },
  /** Status webhook (sent / delivered / read / failed). null = X-Hub-Signature-256 does not verify. */
  parseStatus(h, raw, ctx) {
    const secret = ctx.secrets.appSecret, sig = h.get('x-hub-signature-256') ?? '';
    if (!secret || !safeEqual(sig, 'sha256=' + hmac(secret, raw))) return null;
    try {
      const b = JSON.parse(raw) as { entry?: { changes?: { value?: { statuses?: { id: string; status: string }[] } }[] }[] };
      return (b.entry ?? []).flatMap(e => e.changes ?? []).flatMap(c => c.value?.statuses ?? [])
        .filter(s => ['sent', 'delivered', 'read', 'failed'].includes(s.status)).map(s => ({ providerId: s.id, status: s.status as StatusUpdate['status'] }));
    } catch { return null; }
  },
};

// ── Resend ────────────────────────────────────────────────────────────────────────────────
export const resend: Sender<EmailInput> = {
  id: 'resend', channel: 'email',
  async send(x, ctx) {
    need(ctx, 'from', 'apiKey');
    const body = { from: str(x.from) || str(ctx.config.from), to: [x.to], subject: x.subject, text: x.text, ...(x.html ? { html: x.html } : {}), ...(str(ctx.config.replyTo) ? { reply_to: str(ctx.config.replyTo) } : {}) };
    const r = await call(ctx, 'https://api.resend.com/emails', { method: 'POST', headers: { authorization: `Bearer ${ctx.secrets.apiKey}`, 'content-type': 'application/json', 'idempotency-key': x.idempotencyKey }, body: JSON.stringify(body) }, 'Resend');
    return { providerId: str(r.id) };
  },
  async test(ctx) {
    need(ctx, 'apiKey');
    const r = await (ctx.fetch ?? fetch)('https://api.resend.com/domains', { headers: { authorization: `Bearer ${ctx.secrets.apiKey}` } });
    if (r.ok) return { ok: true, message: 'Resend key accepted.' };
    return { ok: false, message: r.status === 401 ? 'Resend rejected the key (a sending-only key cannot be tested here; send a test message instead).' : `Resend ${r.status}` };
  },
};

export const SENDERS: Record<string, Sender<any>> = {
  'wa-simulator': sim<WaInput>('wa-simulator', 'wa'), 'meta-cloud': metaCloud, qontak: pending('qontak', 'wa'), wati: pending('wati', 'wa'), fonnte: pending('fonnte', 'wa'),
  'email-simulator': sim<EmailInput>('email-simulator', 'email'), resend, smtp: pending('smtp', 'email'),
  'sms-simulator': sim<SmsInput>('sms-simulator', 'sms'), twilio: pending('twilio', 'sms'),
};
export const sender = (id: string): Sender<any> | undefined => SENDERS[id];
