// Messages rendered on the server (the automation worker) link to the business that sent them, not the default one.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.NEXT_PUBLIC_BORNIZ_ROUTING = 'subdomain';
process.env.NEXT_PUBLIC_BORNIZ_ROOT_DOMAIN = 'bornis.id';
process.env.NEXT_PUBLIC_BORNIZ_DEFAULT_TENANT = 'kopibiru';
const { seed } = await import('../seed.ts');
const { render } = await import('./dispatch.ts');

test('an email the worker sends carries the unsubscribe link of its own business', () => {
  const db = seed();
  db.tenant.id = 'warungsari';
  const out = render()(db, { id: 'm1', channel: 'email', template: 'e_receipt', to: 'tamu@contoh.id', status: 'queued', at: 0 } as never);
  assert.match(out.text ?? '', /Unsubscribe: https:\/\/warungsari\.bornis\.id\//);
});
