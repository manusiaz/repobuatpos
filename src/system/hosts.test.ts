import { test } from 'node:test';
import assert from 'node:assert/strict';
import { config, isTenantSlug, liveDomain, publicUrl, resolve, allPublicUrls } from './hosts.ts';
import { tableParam } from '../domain/tables.ts';
import { PAGES } from './registry.ts';

const sub = config({ NEXT_PUBLIC_BORNIZ_ROUTING: 'subdomain', NEXT_PUBLIC_BORNIZ_ROOT_DOMAIN: 'bornis.id', NEXT_PUBLIC_BORNIZ_CUSTOM_DOMAINS: '{"menu.kopibiru.id":"kopibiru"}' });
const path = config({});

test('public URLs: platform on bornis.id / app. / admin., everything of a business on <slug>.bornis.id', () => {
  assert.equal(publicUrl('/', sub), 'https://bornis.id/');
  assert.equal(publicUrl('/pricing', sub), 'https://bornis.id/pricing');
  assert.equal(publicUrl('/account/login', sub), 'https://app.bornis.id/login');
  assert.equal(publicUrl('/account/register', sub), 'https://app.bornis.id/register');
  assert.equal(publicUrl('/owner/catalog/products-and-menu', sub), 'https://kopibiru.bornis.id/owner/catalog/products-and-menu');
  assert.equal(publicUrl('/pos/selling/register-order', sub, 'warung-bu-sri'), 'https://warung-bu-sri.bornis.id/pos/selling/register-order');
  assert.equal(publicUrl('/pic/approvals/approval-queue', sub), 'https://kopibiru.bornis.id/pic/approvals/approval-queue');
  assert.equal(publicUrl('/kds', sub), 'https://kopibiru.bornis.id/kds');
  assert.equal(publicUrl('/display', sub), 'https://kopibiru.bornis.id/display');
  assert.equal(publicUrl('/order?t=07', sub), 'https://kopibiru.bornis.id/t/07');
  assert.equal(publicUrl('/order', sub), 'https://kopibiru.bornis.id');
  assert.equal(publicUrl('/kiosk/kiosk-attract-screen', sub), 'https://kopibiru.bornis.id/kiosk/kiosk-attract-screen');
  assert.equal(publicUrl('/order/qr-menu/cart', sub, 'warung-bu-sri'), 'https://warung-bu-sri.bornis.id/qr-menu/cart');
  assert.equal(publicUrl('/admin/tenant-list', sub), 'https://admin.bornis.id/tenant-list');
  assert.equal(publicUrl('/pos/selling/register-order', path, 'kopibiru', 'https://preview.vercel.app'), 'https://preview.vercel.app/pos/selling/register-order');
});

test('every page round-trips: public URL → proxy → the same page', () => {
  for (const { path: p, url } of allPublicUrls(sub)) {
    const u = new URL(url);
    const r = resolve(u.host, u.pathname, sub);
    const got = r.type === 'rewrite' ? r.path : r.type === 'next' ? u.pathname : 'REDIRECT ' + r.url;
    assert.equal(got.replace(/\/$/, '') || '/', p, `${url} → ${got}`);
  }
});

test('in-app links on the wrong host go to the host that owns the page', () => {
  // a business page asked on a platform host: which business is unknown there → the account door picks it
  assert.deepEqual(resolve('app.bornis.id', '/owner/sales/sales-transactions', sub), { type: 'redirect', url: 'https://app.bornis.id/' });
  assert.deepEqual(resolve('bornis.id', '/pos/selling/register-order', sub), { type: 'redirect', url: 'https://app.bornis.id/' });
  assert.deepEqual(resolve('kopibiru.bornis.id', '/pricing', sub), { type: 'redirect', url: 'https://bornis.id/pricing' });
  assert.deepEqual(resolve('kopibiru.bornis.id', '/admin/tenant-list', sub), { type: 'redirect', url: 'https://admin.bornis.id/tenant-list' });
  assert.equal(resolve('app.bornis.id', '/account/login', sub).type, 'next');
  assert.deepEqual(resolve('www.bornis.id', '/pricing', sub), { type: 'redirect', url: 'https://bornis.id/pricing' });
});

test('one business host serves all of that business: staff, guests, and its own sign-in', () => {
  const q = { tenant: 'kopibiru' };
  assert.deepEqual(resolve('kopibiru.bornis.id', '/t/07', sub), { type: 'rewrite', path: '/order', query: { tenant: 'kopibiru', t: '07' } });
  assert.deepEqual(resolve('kopibiru.bornis.id', '/qr-menu/cart', sub), { type: 'rewrite', path: '/order/qr-menu/cart', query: q });
  assert.deepEqual(resolve('kopibiru.bornis.id', '/', sub), { type: 'rewrite', path: '/order', query: q });
  assert.deepEqual(resolve('kopibiru.bornis.id', '/kiosk/kiosk-attract-screen', sub), { type: 'rewrite', path: '/kiosk/kiosk-attract-screen', query: q });
  assert.deepEqual(resolve('kopibiru.bornis.id', '/order/qr-menu/cart', sub), { type: 'rewrite', path: '/order/qr-menu/cart', query: q });
  for (const p of ['/owner', '/manager', '/pos/selling/register-order', '/pic/approvals/approval-queue', '/kds', '/display', '/waiter', '/account/login', '/account/cashier-pin-login'])
    assert.deepEqual(resolve('kopibiru.bornis.id', p, sub), { type: 'rewrite', path: p, query: q }, p);
  // a merchant's own domain is for guests; staff pages go to the business's subdomain
  assert.deepEqual(resolve('menu.kopibiru.id', '/t/12', sub), { type: 'rewrite', path: '/order', query: { tenant: 'kopibiru', t: '12' } });
  assert.deepEqual(resolve('menu.kopibiru.id', '/', sub), { type: 'rewrite', path: '/order', query: q });
  assert.deepEqual(resolve('menu.kopibiru.id', '/owner', sub), { type: 'redirect', url: 'https://kopibiru.bornis.id/owner' });
});

test('subfolder mode and unknown hosts change nothing', () => {
  assert.equal(resolve('bornis.id', '/owner', path).type, 'next');
  assert.equal(resolve('borniz-git-main.vercel.app', '/owner', sub).type, 'next');
  assert.equal(PAGES.length > 600, true);
});

test('host map: free vercel.app aliases before the domain exists (one shared host for the default business)', () => {
  const H = { '': 'pos-soft-ajie.vercel.app', app: 'pos-soft-ajie-app.vercel.app', admin: 'pos-soft-ajie-admin.vercel.app', tenant: 'pos-soft-ajie-pos.vercel.app' };
  const m = config({ NEXT_PUBLIC_BORNIZ_HOSTS: JSON.stringify(H) });
  assert.equal(m.routing, 'subdomain');
  assert.equal(publicUrl('/pos/selling/register-order', m), 'https://pos-soft-ajie-pos.vercel.app/pos/selling/register-order');
  assert.equal(publicUrl('/order?t=07', m), 'https://pos-soft-ajie-pos.vercel.app/t/07');
  assert.deepEqual(resolve('pos-soft-ajie-pos.vercel.app', '/kds', m), { type: 'rewrite', path: '/kds', query: { tenant: 'kopibiru' } });
  assert.deepEqual(resolve('pos-soft-ajie-app.vercel.app', '/owner', m), { type: 'redirect', url: 'https://pos-soft-ajie-app.vercel.app/' });
  for (const { path: p, url } of allPublicUrls(m)) {
    const u = new URL(url), r = resolve(u.host, u.pathname, m);
    const got = r.type === 'rewrite' ? r.path : r.type === 'next' ? u.pathname : 'REDIRECT ' + r.url;
    assert.equal(got.replace(/\/$/, '') || '/', p, `${url} → ${got}`);
  }
});

test('a table QR keeps the whole table name: spaces, slash, hash and percent survive the trip', () => {
  for (const name of ['T-07', 'Garden 1', 'Bar/1', 'VIP #2', 'Meja 100%']) {
    const u = new URL(publicUrl(`/order?t=${encodeURIComponent(name)}&o=sen`, sub));
    const r = resolve(u.host, u.pathname, sub) as unknown as { query: { t: string } };
    assert.equal(tableParam(r.query.t), name, u.href);
  }
});

test('old order.bornis.id/<slug> QR codes redirect to <slug>.bornis.id; platform names are never a business', () => {
  assert.deepEqual(resolve('order.bornis.id', '/kopibiru/t/07', sub), { type: 'redirect', url: 'https://kopibiru.bornis.id/t/07' });
  assert.deepEqual(resolve('order.bornis.id', '/kopibiru/qr-menu/cart', sub), { type: 'redirect', url: 'https://kopibiru.bornis.id/qr-menu/cart' });
  assert.deepEqual(resolve('order.bornis.id', '/', sub), { type: 'redirect', url: 'https://bornis.id/' });
  for (const name of ['app', 'pos', 'kds', 'display', 'admin', 'www', 'order', 'menu', 'go', 'status', 'mail']) assert.equal(isTenantSlug(name), false, name);
  assert.ok(isTenantSlug('kopibiru') && isTenantSlug('warung-bu-sri') && !isTenantSlug('-x') && !isTenantSlug('a'));
  // the old pos./kds./display. hosts do not know the business: the account door picks it
  for (const h of ['pos', 'kds', 'display']) assert.deepEqual(resolve(h + '.bornis.id', '/selling/register-order', sub), { type: 'redirect', url: 'https://app.bornis.id/' }, h);
  assert.equal(publicUrl('/order?t=07', sub, 'kopibiru', '', 'menu.kopibiru.id'), 'https://menu.kopibiru.id/t/07');
});

test('a merchant domain is used for links only once this deployment serves it', () => {
  assert.equal(liveDomain('kopibiru', sub), 'menu.kopibiru.id');
  assert.equal(liveDomain('warung-bu-sri', sub), '', 'asked for in Studios but not switched on: links stay on <slug>.bornis.id');
  assert.equal(publicUrl('/order?t=07', sub, 'warung-bu-sri', '', liveDomain('warung-bu-sri', sub)), 'https://warung-bu-sri.bornis.id/t/07');
});

test('every app starts on the host that holds its data: owner mobile on the business, the states gallery on app.', () => {
  assert.equal(publicUrl('/system/mobile/owner-mobile-live-monitor', sub), 'https://kopibiru.bornis.id/system/mobile/owner-mobile-live-monitor');
  assert.deepEqual(resolve('kopibiru.bornis.id', '/system/mobile/owner-mobile-live-monitor', sub), { type: 'rewrite', path: '/system/mobile/owner-mobile-live-monitor', query: { tenant: 'kopibiru' } });
  assert.equal(publicUrl('/system/states/empty-states', sub), 'https://app.bornis.id/system/states/empty-states');
});
