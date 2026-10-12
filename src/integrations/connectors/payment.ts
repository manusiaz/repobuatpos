import type { Connector, Field } from '../types.ts';

// One contract for every gateway (src/integrations/server/payments): createCharge → QR / VA / deeplink, signed webhook → settle.
const MODE: Field = { key: 'mode', label: 'Environment', type: 'select', options: [['sandbox', 'Sandbox (test money)'], ['live', 'Live']], required: true };
const hook = (id: string) => `/api/payments/webhook/${id}`;
const RETURN: Field = { key: 'redirectUrl', label: 'Return link after e-wallet payment', type: 'url', placeholder: 'https://order.bornis.id/kopibiru', help: 'The e-wallet app sends the guest back here after paying (your QR menu link).' };

export const CONNECTORS: Connector[] = [
  { id: 'simulator', kind: 'payment', name: 'Payment simulator', scope: 'tenant', runtime: 'server', ready: true, webhook: hook('simulator'),
    blurb: 'Fake QRIS, VA and e-wallet charges for training and demos. Never moves real money.',
    fields: [{ key: 'webhookSecret', label: 'Simulator signing secret', type: 'secret', help: 'Only needed to post signed test webhooks from outside BorNiz (header X-Simulator-Signature = HMAC-SHA256 of the raw body).' }] },
  { id: 'xendit', kind: 'payment', name: 'Xendit', scope: 'tenant', runtime: 'server', ready: true, webhook: hook('xendit'), docs: 'https://docs.xendit.co',
    blurb: 'QRIS, virtual accounts (BCA, BNI, BRI, Mandiri, Permata) and e-wallets (OVO, DANA, ShopeePay, LinkAja).',
    fields: [MODE,
      { key: 'businessId', label: 'Business ID', placeholder: 'Settings → Business profile' },
      { key: 'secretKey', label: 'Secret API key', type: 'secret', required: true, placeholder: 'xnd_production_…', help: 'Settings → API keys, with Money-in write permission.' },
      { key: 'callbackToken', label: 'Webhook verification token', type: 'secret', required: true, help: 'Settings → Webhooks. Xendit sends it in the x-callback-token header.' },
      { key: 'vaBank', label: 'Virtual account bank', type: 'select', options: [['BCA', 'BCA'], ['BNI', 'BNI'], ['BRI', 'BRI'], ['MANDIRI', 'Mandiri'], ['PERMATA', 'Permata'], ['BSI', 'BSI'], ['CIMB', 'CIMB Niaga']], help: 'Default BCA. The bank must be activated in your Xendit account.' },
      { key: 'vaName', label: 'Name shown on the virtual account', placeholder: 'Kopi Biru', help: 'Letters and spaces only; the guest sees it in their bank app.' },
      { key: 'ewallet', label: 'E-wallet', type: 'select', options: [['ID_DANA', 'DANA'], ['ID_SHOPEEPAY', 'ShopeePay'], ['ID_LINKAJA', 'LinkAja'], ['ID_ASTRAPAY', 'AstraPay'], ['ID_OVO', 'OVO (needs the guest phone)']], help: 'Default DANA.' },
      RETURN] },
  { id: 'midtrans', kind: 'payment', name: 'Midtrans', scope: 'tenant', runtime: 'server', ready: true, webhook: hook('midtrans'), docs: 'https://docs.midtrans.com',
    blurb: 'QRIS, GoPay, ShopeePay, bank transfer VA and cards through the Midtrans Core API.',
    fields: [MODE,
      { key: 'merchantId', label: 'Merchant ID', required: true, placeholder: 'G123456789' },
      { key: 'clientKey', label: 'Client key', required: true, placeholder: 'Mid-client-…' },
      { key: 'serverKey', label: 'Server key', type: 'secret', required: true, placeholder: 'Mid-server-…', help: 'Also verifies payment notifications (signature_key). Sandbox keys work only with Environment = Sandbox.' },
      { key: 'vaBank', label: 'Virtual account bank', type: 'select', options: [['bca', 'BCA'], ['bni', 'BNI'], ['bri', 'BRI'], ['permata', 'Permata'], ['cimb', 'CIMB Niaga']], help: 'Default BCA.' },
      { key: 'ewallet', label: 'E-wallet', type: 'select', options: [['gopay', 'GoPay'], ['shopeepay', 'ShopeePay']], help: 'Default GoPay.' },
      RETURN] },
  { id: 'doku', kind: 'payment', name: 'DOKU', scope: 'tenant', runtime: 'server', ready: false, webhook: hook('doku'), docs: 'https://developers.doku.com',
    blurb: 'QRIS, virtual accounts, e-wallets and cards through DOKU Checkout / Direct API.',
    fields: [MODE,
      { key: 'clientId', label: 'Client ID', required: true, placeholder: 'BRN-…' },
      { key: 'secretKey', label: 'Secret key', type: 'secret', required: true, help: 'Signs requests and verifies notifications (Signature header).' }] },
];
