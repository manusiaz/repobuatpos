import type { IDR } from './money.ts';

// lg-loyalty: earn on paid orders only, append-only ledger, balance derived.
export interface LedgerRow { customerId: string; points: number; reason: string; orderId?: string; at: number }
export interface Tier { id: string; name: string; min: number; multiplier: number }

export const TIERS: Tier[] = [
  { id: 'silver', name: 'Silver', min: 0, multiplier: 1 },
  { id: 'gold', name: 'Gold', min: 1500, multiplier: 1.25 },
  { id: 'platinum', name: 'Platinum', min: 4000, multiplier: 1.5 },
];
/** Earn on subtotal before tax and service, after discounts. 1 bean per IDR 1,000 by default. */
export const earn = (netSubtotal: IDR, tier: Tier = TIERS[0], perIdr = 1000) => Math.floor((netSubtotal / perIdr) * tier.multiplier);
export const balance = (rows: LedgerRow[], customerId: string) => rows.filter(r => r.customerId === customerId).reduce((a, r) => a + r.points, 0);
const YEAR = 365 * 864e5;
/** Tier from lifetime beans earned in the last 12 months. */
export function tierOf(rows: LedgerRow[], customerId: string, now = Date.now()): Tier {
  const earned = rows.filter(r => r.customerId === customerId && r.points > 0 && now - r.at < YEAR).reduce((a, r) => a + r.points, 0);
  return [...TIERS].reverse().find(t => earned >= t.min) ?? TIERS[0];
}
/** Never let balance go negative; block redeem instead. */
export const canRedeem = (rows: LedgerRow[], customerId: string, cost: number) => balance(rows, customerId) >= cost;
/** Refund reverses earned beans with a negative row. */
export const reversal = (row: LedgerRow, at = Date.now()): LedgerRow => ({ ...row, points: -row.points, reason: 'Refund reversal', at });
