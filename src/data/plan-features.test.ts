// Features above the plan (plans.ts FEATURE, spec lg-gate) once a business moves between plans: stock comes back only
// if the sale took it, a locked feature raises no alerts, beans already earned still redeem, staff ask the owner once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commit, snapshot } from './store.ts';
import { addLine, decide, newOrder, redeem, requestApproval } from './actions.ts';
import { payCash } from './actions/pos.ts';
import { askForPlan } from './actions/business.ts';
import { planAlerts, RULES } from './alerts/index.ts';
import { pageLock, type PlanId } from '../screens/public/plans.ts';
import { balance } from '../domain/loyalty.ts';
import { roundCash } from '../domain/money.ts';

const plan = (p: PlanId) => commit('plan.changed', 'budi', d => { d.tenant.plan = p; });

test('a refund after an upgrade puts back no stock the Free sale never took', () => {
  plan('free');
  const pid = snapshot().recipes[0].productId, id = newOrder('sen', 'tono', 'pos', {});
  addLine(id, pid, [], 1, '', 'tono');
  const o = snapshot().orders.find(x => x.id === id)!;
  payCash(id, roundCash(o.total), o.total, 'tono');
  assert.equal(snapshot().movements.filter(m => m.sourceId === id).length, 0, 'Free moves no stock');
  plan('basic');
  const r = requestApproval({ type: 'refund', title: 'Refund ' + o.no, amount: o.total, requestedBy: 'tono', outletId: 'sen', subjectId: id, note: 'cold', payload: { toStock: true } });
  assert.equal(decide(r.id, 'andi', 'approved'), null);
  assert.equal(snapshot().movements.filter(m => m.sourceId === id).length, 0, 'nothing comes back');
});

test('a feature above the plan raises no alerts; beans a member holds still redeem; the owner is asked once a day', () => {
  const locked = (p: PlanId) => planAlerts(snapshot()).filter(a => pageLock(p, RULES.find(r => r.alert === a.alert)!.href)).map(a => a.alert);
  plan('pro');
  assert.ok(locked('free').length > 0, 'the demo raises inventory / shift alerts on Pro');
  plan('free');
  assert.deepEqual(locked('free'), []);
  const c = snapshot().customers.find(x => balance(snapshot().ledger, x.id) > 10)!.id;
  assert.equal(redeem(c, 10, 'Free cookie', 'tono'), null);
  const n = snapshot().notices.length;
  askForPlan('Inventory & recipes', 'andi'); askForPlan('Inventory & recipes', 'andi');
  assert.equal(snapshot().notices.length, n + 1);
});
