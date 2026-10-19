// leaveFor runs in the browser: a subdomain deployment, on a business's own host.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.NEXT_PUBLIC_BORNIZ_ROUTING = 'subdomain';
process.env.NEXT_PUBLIC_BORNIZ_ROOT_DOMAIN = 'bornis.id';
(globalThis as { location?: unknown }).location = { host: 'kopibiru.bornis.id', hostname: 'kopibiru.bornis.id', pathname: '/account/login', origin: 'https://kopibiru.bornis.id', search: '' };
const { leaveFor } = await import('./hosts.ts');

test('right after sign-in (no business data yet, id "") a link stays on this business host', () => {
  assert.equal(leaveFor('/owner/sales/refunds-and-voids?o=sen', ''), null, 'never https://.bornis.id/…');
  assert.equal(leaveFor('/pricing', ''), 'https://bornis.id/pricing', 'marketing still goes to the root');
});
