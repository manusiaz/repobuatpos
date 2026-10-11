import type { Connector, Field } from '../types.ts';

// Own-fleet delivery for web store and WhatsApp orders. Pickup address comes from the outlet.
const pickup: Field = { key: 'pickupNote', label: 'Pickup note for drivers', placeholder: 'Ambil di kasir depan' };
const courier = (id: string, name: string, docs: string, keys: Field[]): Connector => ({
  id, kind: 'courier', name, scope: 'outlet', runtime: 'server', ready: false, docs, webhook: `/api/courier/webhook/${id}`,
  blurb: `Books a ${name} driver for web and WhatsApp orders and tracks the trip on the order.`, fields: [...keys, pickup],
});

export const CONNECTORS: Connector[] = [
  courier('lalamove', 'Lalamove', 'https://developers.lalamove.com', [
    { key: 'market', label: 'Market', type: 'select', options: [['ID', 'Indonesia']], required: true },
    { key: 'apiKey', label: 'API key', required: true }, { key: 'apiSecret', label: 'API secret', type: 'secret', required: true }]),
  courier('gosend', 'GoSend', 'https://docs.gobiz.co.id', [
    { key: 'clientId', label: 'Client ID', required: true }, { key: 'passKey', label: 'Pass key', type: 'secret', required: true }]),
  courier('grabexpress', 'GrabExpress', 'https://developer.grab.com', [
    { key: 'clientId', label: 'Client ID', required: true }, { key: 'clientSecret', label: 'Client secret', type: 'secret', required: true }]),
  courier('paxel', 'Paxel', 'https://paxel.co', [
    { key: 'apiKey', label: 'API key', required: true }, { key: 'apiSecret', label: 'API secret', type: 'secret', required: true }]),
];
