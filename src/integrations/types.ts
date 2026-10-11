// Every third-party system the POS talks to is a connector: one contract, one settings panel, one status, one alert path.
// ready = works end to end today; ready:false = the container is in place (settings, secrets, contract, webhook URL)
// and only the provider's driver/API calls remain to be written.
export type Kind = 'payment' | 'edc' | 'printer' | 'drawer' | 'scanner' | 'scale' | 'display'
  | 'whatsapp' | 'email' | 'sms' | 'delivery' | 'accounting' | 'webhook' | 'bank' | 'courier';

export interface Field {
  key: string; label: string;
  type?: 'text' | 'secret' | 'number' | 'select' | 'toggle' | 'url';
  options?: [string, string][]; required?: boolean; help?: string; placeholder?: string;
}
export interface Connector {
  id: string; kind: Kind; name: string; blurb: string;
  /** tenant: one per business · outlet: one per branch · device: one per register/KDS. */
  scope: 'tenant' | 'outlet' | 'device';
  /** server: API route with secrets · browser: WebUSB/WebSerial/WebBluetooth on this device · bridge: local helper app · manual: staff types the result. */
  runtime: 'server' | 'browser' | 'bridge' | 'manual';
  ready: boolean;
  fields: Field[];
  docs?: string;
  /** The provider calls us back: the panel shows the URL to paste in their dashboard. */
  webhook?: string;
}

export const KIND_LABEL: Record<Kind, string> = {
  payment: 'Payment gateway', edc: 'Card terminal (EDC)', printer: 'Printer', drawer: 'Cash drawer', scanner: 'Barcode scanner', scale: 'Scale',
  display: 'Customer display', whatsapp: 'WhatsApp', email: 'Email', sms: 'SMS', delivery: 'Delivery app', accounting: 'Accounting',
  webhook: 'Webhooks & API', bank: 'Bank & payouts', courier: 'Courier',
};
