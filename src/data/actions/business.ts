'use client';
// Business identity, outlets and invite-a-friend. Writes only through commit().
import { commit, snapshot, uid } from '../store.ts';
import type { BusinessProfile, Outlet } from '../schema.ts';
import { checkFloor, holdsTable, tableNames, type FloorTable } from '../../domain/tables.ts';
import { referral } from '../../system/settings.ts';
import { referrerOf } from '../../system/studio.ts';
import { planBlock } from '../../screens/public/plans.ts';

const now = () => Date.now();

export function saveBusiness(name: string, profile: BusinessProfile, by: string) {
  commit('business.saved', by, d => { d.tenant.name = name.trim() || d.tenant.name; d.tenant.profile = profile; }, 'business');
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
