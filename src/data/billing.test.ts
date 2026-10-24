// BorNiz billing: plan × outlets + PPN 11% at the prices BorNiz set, once a month in WIB; Free, trials and Enterprise are not billed here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { billMonth, invoiceFor } from './billing.ts';

const NOV1 = Date.UTC(2026, 9, 31, 17, 30); // 1 Nov 00:30 WIB
test('this month\'s invoice for a paid plan', () => {
  const i = invoiceFor({ id: 't1', plan: 'pro' }, 3, {}, NOV1)!;
  assert.deepEqual([i.id, i.b, i.c, i.d, i.n], ['inv-t1-2026-11', '2026-11', String(3 * 349_000 + Math.round(3 * 349_000 * 0.11)), 'unpaid', 'Pro × 3 outlets']);
  assert.equal(invoiceFor({ id: 't1', plan: 'basic' }, 0, { basic: 199_000 }, NOV1)!.c, String(199_000 + 21_890), 'the console price, at least one outlet');
});
test('never billed: Free, a running trial, Enterprise (per contract)', () => {
  for (const t of [{ id: 'a', plan: 'free' }, { id: 'b', plan: 'pro', trial: true }, { id: 'c', plan: 'enterprise' }]) assert.equal(invoiceFor(t, 2, {}, NOV1), null);
  assert.equal(billMonth(NOV1 - 3600e3), '2026-10', '31 Oct 23:30 WIB is still October');
});
test('outlets kept after a downgrade are not billed (as Checkout charges)', () => {
  assert.equal(invoiceFor({ id: 't1', plan: 'basic' }, 3, {}, NOV1)!.n, 'Basic × 1 outlet');
});

test('an unpaid invoice: due, a reminder from day 7, the hold only as the server set it; the platform answer wins over local rows', async () => {
  const { RULES } = await import('./alerts/rules.ts');
  const { index } = await import('./alerts/rules.ts');
  const { unpaidSince, billingStage } = await import('./billing.ts');
  const { seed } = await import('./seed.ts');
  const DAY = 864e5, now = Date.UTC(2026, 9, 24, 3), rule = RULES.find(r => r.alert === 'Invoice due / unpaid')!;
  const at = (days: number, live?: { unpaidSince: number | null; hold?: boolean }) => {
    const d = seed(now); d.records.invoice = [{ id: 'inv-x', a: d.tenant.id, b: '2026-10', c: '149000', d: 'unpaid', e: '', at: now - days * DAY }];
    if (live) Object.assign(d.tenant, live);
    return d;
  };
  const fire = (d: ReturnType<typeof seed>) => rule.check(d, now, index(d, now)).map(f => f.key.split('|')[1]);
  assert.deepEqual(fire(at(1)), ['due']);
  assert.deepEqual(fire(at(8)), ['overdue']);
  assert.deepEqual(fire(at(15)), ['overdue'], 'no hold until the server set it');
  assert.deepEqual(fire(at(15, { unpaidSince: now - 15 * DAY, hold: true })), ['hold']);
  assert.equal(billingStage(at(15, { unpaidSince: null }), now), null, 'paid on the platform: local rows are not the truth');
  assert.equal(unpaidSince(at(15, { unpaidSince: null })), null);
});

test('every object the hold makes read-only on screen is a real back-office page object', async () => {
  const { PAGES } = await import('../system/registry.ts');
  const { HELD_OBJECTS } = await import('./billing.ts');
  const objs = new Set(PAGES.filter(p => p.shell === 'backoffice').map(p => p.object));
  assert.deepEqual([...HELD_OBJECTS].filter(o => !objs.has(o)), []);
});
