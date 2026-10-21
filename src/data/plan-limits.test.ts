// The plan's room on a device is the server's (db/tests/plan_rules.sql): the same cases, so the screen says no before the server does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planBlock } from '../screens/public/plans.ts';

const db = (plan: 'free' | 'basic' | 'pro' | 'enterprise', outlets: string[], devices: [string, string][]) =>
  ({ tenant: { plan }, outlets: outlets.map(id => ({ id })), devices: devices.map(([outletId, kind]) => ({ outletId, kind })) }) as unknown as Parameters<typeof planBlock>[0];

test('adding beyond the plan is refused; what a business kept from a trial does not bring more', () => {
  assert.equal(planBlock(db('free', ['sen'], [['sen', 'pos']]), 'outlets'), 'Free: up to 1 outlet. Upgrade to add more.');
  assert.match(planBlock(db('free', ['sen'], [['sen', 'pos']]), 'pos', 'sen')!, /Free: up to 1 register per outlet/);
  assert.match(planBlock(db('free', ['sen'], []), 'kds', 'sen')!, /no kitchen display/);
  assert.match(planBlock(db('free', ['sen'], []), 'display', 'sen')!, /no customer display/);
  assert.equal(planBlock(db('free', ['sen'], []), 'printer', 'sen'), null);
  assert.equal(planBlock(db('basic', ['sen'], [['sen', 'pos']]), 'display', 'sen'), null);
  assert.match(planBlock(db('basic', ['sen'], []), 'kds', 'sen')!, /Basic: no kitchen display/);
  assert.equal(planBlock(db('pro', ['sen', 'kmg'], [['sen', 'pos']]), 'outlets'), null);
  assert.match(planBlock(db('pro', ['sen', 'kmg', 'bsd'], []), 'outlets')!, /Pro: up to 3 outlets/);
  assert.match(planBlock(db('free', ['sen', 'kmg', 'bsd'], [['sen', 'pos']]), 'pos', 'bsd')!, /Free: up to 1 register/, 'trial outlets bring no register');
  assert.equal(planBlock(db('enterprise', ['a', 'b', 'c', 'd'], [['a', 'pos'], ['a', 'pos']]), 'pos', 'a'), null);
});
