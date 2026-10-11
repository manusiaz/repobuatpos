import type { Connector, Field } from '../types.ts';
import type { Source } from '../../domain/order.ts';

// Ride-hailing food platforms. Connector id = order Source. Orders arrive at /api/delivery/webhook/<platform>
// (normalized relay format, HMAC-signed, works today; each platform's native payload needs partner API access).
const fields = (merchant: string): Field[] => [
  { key: 'merchantId', label: merchant, required: true, help: 'One per outlet. Orders for this ID land at this outlet.' },
  { key: 'clientId', label: 'Partner client ID', required: true },
  { key: 'clientSecret', label: 'Partner client secret', type: 'secret', required: true },
  { key: 'webhookSecret', label: 'Webhook signing secret', type: 'secret', required: true, help: 'Verifies that orders really come from the platform.' },
  { key: 'autoAccept', label: 'Accept orders automatically', type: 'toggle' },
];
const platform = (id: Source, name: string, merchant: string, docs: string): Connector => ({
  id, kind: 'delivery', name, scope: 'outlet', runtime: 'server', ready: false, webhook: `/api/delivery/webhook/${id}`, docs, fields: fields(merchant),
  blurb: `${name} orders straight into the online inbox and KDS; menu, prices and sold-out items sync back. Needs ${name} partner API access.`,
});

export const CONNECTORS: Connector[] = [
  platform('gofood', 'GoFood', 'GoBiz outlet ID', 'https://docs.gobiz.co.id'),
  platform('grabfood', 'GrabFood', 'GrabFood merchant ID', 'https://developer.grab.com'),
  platform('shopeefood', 'ShopeeFood', 'ShopeeFood store ID', 'https://open.shopee.com'),
];
