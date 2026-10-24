'use client';
// Business identity, outlets and invite-a-friend. Writes only through commit().
import { commit, snapshot, uid } from '../store.ts';
import type { BusinessProfile, Outlet } from '../schema.ts';
import { checkFloor, holdsTable, tableNames, type FloorTable } from '../../domain/tables.ts';
import { referral } from '../../system/settings.ts';
import { referrerOf } from '../../system/studio.ts';
import { planBlock } from '../../screens/public/plans.ts';
import { notify } from '../actions.ts';
import { REMOTE } from '../remote.ts';

const now = () => Date.now();

export function saveBusiness(name: string, profile: BusinessProfile, by: string) {
  commit('business.saved', by, d => { d.tenant.name = name.trim() || d.tenant.name; d.tenant.profile = profile; }, 'business');
}

/** Demo (no database): a trial that ran out is Free again, as bn_plan_now does on the server. */
export function endTrialIfDue(at = Date.now()) {
  const t = snapshot().tenant;
  if (!REMOTE && t.trialUntil && t.trialUntil <= at && t.plan !== 'free') commit('plan.changed', 'system', d => {
    d.tenant.plan = 'free';
    notify(d, 'Plan changed', 'info', ['owner'], null, 'Plan is now Free · the trial ended. Your data stays; upgrade to use it again.', '/owner/account/subscription-billing');
  }, 'free');
}
/** Upgrade wall, not the owner: "Ask the owner" tells them (spec lg-gate). */
export function askForPlan(feature: string, by: string): boolean {
  const d0 = snapshot(), text = `${d0.employees.find(e => e.id === by)?.name ?? 'A manager'} asked for ${feature} · upgrade in Subscription`;
  const recent = (at: number) => Date.now() - at < 864e5; // once a day: this device's audit, or the notice every device has
  if (d0.audit.some(a => a.action === 'plan.asked' && a.actor === by && a.subject === feature && recent(a.at)) || d0.notices.some(n => n.text === text && recent(n.at))) return false;
  commit('plan.asked', by, d => notify(d, 'Plan limit reached', 'info', ['owner'], null, text, '/owner/account/subscription-billing'), feature);
  return true;
}

/** A new outlet sells the whole global menu at base price until the owner says otherwise. */
/** Tables & floor plan. A table that has an open bill or a booking still coming can't be renamed or removed. */
export function saveFloor(outletId: string, floor: FloorTable[], by: string): string | null {
  const d0 = snapshot(), out = d0.outlets.find(o => o.id === outletId);
  if (!out) return 'Outlet not found.';
  const plan = floor.map(t => ({ ...t, name: t.name.trim(), area: t.area.trim() }));
  const bad = checkFloor(plan);
  if (bad) return bad;
  const keep = new Set(plan.map(t => t.name)), now = Date.now();
  const busy = [...d0.orders.filter(o => o.outletId === outletId && holdsTable(o)).map(o => o.table!),
    ...d0.reservations.filter(r => r.outletId === outletId && ['booked', 'seated'].includes(r.status) && r.at > now - 3 * 3600e3).map(r => r.table)];
  const gone = tableNames(out).filter(n => !keep.has(n) && busy.includes(n));
  if (gone.length) return `${gone.join(', ')} ${gone.length > 1 ? 'have' : 'has'} an open bill or booking. Close it or move it first.`;
  commit('outlet.floor_saved', by, d => { const o = d.outlets.find(x => x.id === outletId)!; o.floor = plan; o.tables = plan.length; }, `${out.name} · ${plan.length} tables`, outletId);
  return null;
}
export function addOutlet(o: Omit<Outlet, 'id'>, by: string): string | null {
  if (planBlock(snapshot(), 'outlets')) return null;
  const id = uid('ol');
  commit('outlet.created', by, d => {
    d.outlets.push({ ...o, id });
    d.products.filter(p => p.scope === 'global').forEach(p => d.outletProducts.push({ productId: p.id, outletId: id, localPrice: null, is86: false, hidden: false }));
  }, o.name, id);
  return id;
}

/** Friend joined from a member's invite link or code (Menu Studio › referral page): the link is kept, and both get their
 *  reward once, when the friend's first order is paid (settleIfDone). Never for an existing member, never twice. */
export function awardReferral(friendId: string, ref: string) {
  const d0 = snapshot(), by = referrerOf(d0, ref);
  if (!referral(d0).on || !by || friendId === by.id || (d0.records.referrals ?? []).some(r => r.a === friendId)) return false;
  commit('referral.joined', 'guest', d => {
    (d.records.referrals ??= []).unshift({ id: uid('rf'), a: friendId, b: by.id, c: '', d: '', e: 'joined', at: now() });
  }, friendId);
  return true;
}
