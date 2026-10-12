'use client';
// Business identity, outlets and invite-a-friend. Writes only through commit().
import { commit, snapshot, uid } from '../store.ts';
import type { BusinessProfile, Outlet } from '../schema.ts';
import { referral } from '../../system/settings.ts';
import { referrerOf } from '../../system/studio.ts';

const now = () => Date.now();

export function saveBusiness(name: string, profile: BusinessProfile, by: string) {
  commit('business.saved', by, d => { d.tenant.name = name.trim() || d.tenant.name; d.tenant.profile = profile; }, 'business');
}

/** A new outlet sells the whole global menu at base price until the owner says otherwise. */
export function addOutlet(o: Omit<Outlet, 'id'>, by: string): string {
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
