import { test } from 'node:test';
import assert from 'node:assert/strict';
import { config, publicUrl, resolve, allPublicUrls } from './hosts.ts';
import { tableParam } from '../domain/tables.ts';
import { PAGES } from './registry.ts';

const sub = config({ NEXT_PUBLIC_BORNIZ_ROUTING: 'subdomain', NEXT_PUBLIC_BORNIZ_ROOT_DOMAIN: 'bornis.id', NEXT_PUBLIC_BORNIZ_CUSTOM_DOMAINS: '{"menu.kopibiru.id":"kopibiru"}' });
const path = config({});

test('public URLs follow the sitemap hosts', () => {
  assert.equal(publicUrl('/', sub), 'https://bornis.id/');
  assert.equal(publicUrl('/pricing', sub), 'https://bornis.id/pricing');
  assert.equal(publicUrl('/account/login', sub), 'https://app.bornis.id/login');
  assert.equal(publicUrl('/owner/catalog/products-and-menu', sub), 'https://app.bornis.id/owner/catalog/products-and-menu');
  assert.equal(publicUrl('/pos/selling/register-order', sub), 'https://pos.bornis.id/selling/register-order');
  assert.equal(publicUrl('/pic/approvals/approval-queue', sub), 'https://pos.bornis.id/pic/approvals/approval-queue');
  assert.equal(publicUrl('/kds', sub), 'https://kds.bornis.id/');
  assert.equal(publicUrl('/order?t=07', sub), 'https://order.bornis.id/kopibiru/t/07');
  assert.equal(publicUrl('/kiosk/kiosk-attract-screen', sub), 'https://order.bornis.id/kopibiru/kiosk/kiosk-attract-screen');
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
  assert.deepEqual(resolve('pos.bornis.id', '/owner/sales/sales-transactions', sub), { type: 'redirect', url: 'https://app.bornis.id/owner/sales/sales-transactions' });
  assert.deepEqual(resolve('bornis.id', '/pos/selling/register-order', sub), { type: 'redirect', url: 'https://pos.bornis.id/selling/register-order' });
  assert.equal(resolve('pos.bornis.id', '/pos/selling/register-order', sub).type, 'next');
  assert.deepEqual(resolve('www.bornis.id', '/pricing', sub), { type: 'redirect', url: 'https://bornis.id/pricing' });
});

test('tenants, tables and custom domains', () => {
  assert.deepEqual(resolve('order.bornis.id', '/kopibiru/t/07', sub), { type: 'rewrite', path: '/order', query: { tenant: 'kopibiru', t: '07' } });
  assert.deepEqual(resolve('order.bornis.id', '/kopibiru/qr-menu/cart', sub), { type: 'rewrite', path: '/order/qr-menu/cart', query: { tenant: 'kopibiru' } });
  assert.deepEqual(resolve('menu.kopibiru.id', '/t/12', sub), { type: 'rewrite', path: '/order', query: { tenant: 'kopibiru', t: '12' } });
  assert.deepEqual(resolve('menu.kopibiru.id', '/', sub), { type: 'rewrite', path: '/order', query: { tenant: 'kopibiru' } });
});

test('subfolder mode and unknown hosts change nothing', () => {
  assert.equal(resolve('bornis.id', '/owner', path).type, 'next');
  assert.equal(resolve('borniz-git-main.vercel.app', '/owner', sub).type, 'next');
  assert.equal(PAGES.length > 600, true);
});

test('host map: every surface on its own hostname (free vercel.app aliases now, separate servers later)', () => {
  const H = { '': 'pos-soft-ajie.vercel.app', app: 'pos-soft-ajie-app.vercel.app', pos: 'pos-soft-ajie-pos.vercel.app', kds: 'pos-soft-ajie-kds.vercel.app', display: 'pos-soft-ajie-display.vercel.app', order: 'pos-soft-ajie-order.vercel.app', admin: 'pos-soft-ajie-admin.vercel.app' };
  const m = config({ NEXT_PUBLIC_BORNIZ_HOSTS: JSON.stringify(H) });
  assert.equal(m.routing, 'subdomain');
  assert.equal(publicUrl('/pos/selling/register-order', m), 'https://pos-soft-ajie-pos.vercel.app/selling/register-order');
  assert.equal(publicUrl('/order?t=07', m), 'https://pos-soft-ajie-order.vercel.app/kopibiru/t/07');
  assert.deepEqual(resolve('pos-soft-ajie-kds.vercel.app', '/', m), { type: 'rewrite', path: '/kds', query: {} });
  assert.deepEqual(resolve('pos-soft-ajie-pos.vercel.app', '/owner', m), { type: 'redirect', url: 'https://pos-soft-ajie-app.vercel.app/owner' });
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
