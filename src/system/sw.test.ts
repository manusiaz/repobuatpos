// Service worker rules (public/sw.js): what it caches, what it never touches, and which cached page answers offline.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const sw: Record<string, any> = { self: { addEventListener() {}, location: { origin: 'https://pos.bornis.id' } } };
runInNewContext(readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8'), sw);
const kind = (u: string, mode = 'no-cors') => sw.kind(new URL(u, 'https://pos.bornis.id'), mode, 'https://pos.bornis.id');

test('service worker: static files and fonts cache-first, pages network-first, API and Supabase never', () => {
  assert.equal(kind('/_next/static/chunks/a1b2.js'), 'static');
  assert.equal(kind('https://fonts.gstatic.com/s/x.woff2', 'cors'), 'static');
  assert.equal(kind('https://cdn.fontshare.com/wf/x.woff2', 'cors'), 'static');
  assert.equal(kind('/pos/shift-change/handover', 'navigate'), 'page');
  assert.equal(kind('/pos?_rsc=1', 'cors'), null, 'RSC fetches go to the network; offline Next falls back to a page load');
  assert.equal(kind('/api/payments/webhook', 'navigate'), null);
  assert.equal(kind('/api/messages', 'cors'), null);
  assert.equal(kind('https://abc.supabase.co/rest/v1/rpc/bn_write', 'cors'), null);
  assert.equal(kind('https://kds.bornis.id/', 'navigate'), null, 'another host is its own app');
});

test('service worker: offline, a page never opened falls back to its own surface, then the POS, then home', () => {
  const cached = ['/pos', '/kds', '/pic/approvals/approval-queue', '/'];
  assert.equal(sw.pick('/pos/shift-change/handover', cached), '/pos');
  assert.equal(sw.pick('/pic/my-shift/shift-sales-and-orders', cached), '/pic/approvals/approval-queue');
  assert.equal(sw.pick('/waiter', cached), '/pos');
  assert.equal(sw.pick('/', ['/pos', '/']), '/', 'a subdomain root (kds.bornis.id/) is its own shell');
  assert.equal(sw.pick('/owner', ['/']), '/');
  assert.equal(sw.pick('/owner', []), null);
});
