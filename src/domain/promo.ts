import type { IDR } from './money.ts';

// lg-promo: one engine for POS, QR menu and kiosk.
export interface Promo { id: string; name: string; kind: 'pct' | 'amount' | 'flash'; value: number; minSpend?: IDR; stackable?: boolean; quota?: number; used?: number; endsAt?: number; code?: string; productIds?: string[] }

export const usable = (p: Promo, now = Date.now()) => (p.quota == null || (p.used ?? 0) < p.quota) && (p.endsAt == null || now < p.endsAt);
const value = (p: Promo, subtotal: IDR) => (subtotal < (p.minSpend ?? 0) ? 0 : p.kind === 'pct' ? Math.round((subtotal * p.value) / 100) : p.kind === 'amount' ? Math.min(p.value, subtotal) : 0);

/** Best single discount wins unless stackable; flash prices are applied as prices, not here. */
export function resolve(promos: Promo[], subtotal: IDR, now = Date.now()): { applied: Promo[]; discount: IDR } {
  const ok = promos.filter(p => p.kind !== 'flash' && usable(p, now) && value(p, subtotal) > 0);
  const best = ok.filter(p => !p.stackable).sort((a, b) => value(b, subtotal) - value(a, subtotal))[0];
  const stack = ok.filter(p => p.stackable);
  const applied = [...(best ? [best] : []), ...stack];
  let left = subtotal, discount = 0;
  for (const p of applied) { const v = Math.min(left, value(p, left)); discount += v; left -= v; }
  return { applied, discount };
}
export const flashPrice = (promos: Promo[], productId: string, now = Date.now()) =>
  promos.find(p => p.kind === 'flash' && usable(p, now) && p.productIds?.includes(productId))?.value ?? null;
