import type { Connector } from '../types.ts';
import { EVENTS } from '../server/webhooks/events.ts';

export const CONNECTORS: Connector[] = [
  { id: 'webhook-out', kind: 'webhook', name: 'Webhooks to your server', scope: 'tenant', runtime: 'server', ready: true,
    blurb: 'POSTs events to your URL as JSON, signed: X-BorNiz-Signature: t=<unix>,v1=<hex HMAC-SHA256 of "<t>.<body>" with your secret>.',
    fields: [
      { key: 'url', label: 'Endpoint URL', type: 'url', required: true, placeholder: 'https://example.com/borniz' },
      { key: 'secret', label: 'Signing secret', type: 'secret', required: true, help: 'Any long random string; your server uses it to check the signature.' },
      ...EVENTS.map((e, i) => ({ key: 'ev:' + e, label: e, type: 'toggle' as const, help: i === 0 ? 'Leave every event off to receive all of them.' : undefined }))] },
];
