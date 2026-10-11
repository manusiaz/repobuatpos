'use client';
// Business identity, outlets and invite-a-friend. Writes only through commit().
import { commit, snapshot, uid } from '../store.ts';
import type { BusinessProfile, Outlet } from '../schema.ts';
import { referral } from '../../system/settings.ts';

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

/** Friend joined from a member's invite link: both get beans once (never for an existing member, never twice). */
export function awardReferral(friendId: string, referrerId: string) {
  const d0 = snapshot(), r = referral(d0);
  if (!r.on || friendId === referrerId || !d0.customers.some(c => c.id === referrerId)) return false;
  if (d0.ledger.some(l => l.customerId === friendId && l.reason.startsWith('Referral'))) return false;
  commit('referral.joined', 'guest', d => {
    if (r.friend > 0) d.ledger.push({ customerId: friendId, points: r.friend, reason: 'Referral welcome', at: now() });
    if (r.referrer > 0) d.ledger.push({ customerId: referrerId, points: r.referrer, reason: 'Referral · ' + (d.customers.find(c => c.id === friendId)?.name ?? 'friend'), at: now() });
  }, friendId);
  return true;
}
