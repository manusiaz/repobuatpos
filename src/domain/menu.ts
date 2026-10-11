import type { IDR } from './money.ts';

// Menu scope (CLAUDE.md, st-menu): owner items are global; manager items are local and wait for the owner.
export type Scope = 'global' | 'local';
export type ProductStatus = 'draft' | 'pending_owner' | 'live' | 'archived';
export const LOCAL_PRICE_BAND = 0.10;

export const localPriceAllowed = (base: IDR, local: IDR, lock: { menuPrices: boolean }) =>
  !lock.menuPrices && Math.abs(local - base) <= base * LOCAL_PRICE_BAND;

export function newItem(role: 'owner' | 'manager', lock: { outletOnlyItems: boolean }) {
  if (role === 'owner') return { scope: 'global' as Scope, status: 'live' as ProductStatus };
  if (!lock.outletOnlyItems) throw new Error('Outlet-only items are turned off by the owner');
  return { scope: 'local' as Scope, status: 'pending_owner' as ProductStatus };
}
/** Outlets can hide a global item and mark it 86, never delete it. */
export const canDelete = (p: { scope: Scope; ownerOutletId?: string | null }, who: { role: string; outletId?: string }) =>
  who.role === 'owner' || (p.scope === 'local' && who.role === 'manager' && p.ownerOutletId === who.outletId);
/** Publishing: owner publishes, manager "Send to owner". */
export const publishVerb = (role: string) => (role === 'owner' ? 'Publish' : 'Send to owner');
