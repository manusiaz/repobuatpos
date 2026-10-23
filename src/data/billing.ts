// BorNiz billing (spec bn-authority: "BorNiz billing (plan × outlets)", automatic): this month's invoice for a business,
// issued by the worker (db/migrations/20261023000000_borniz_billing.sql). Pure, so the worker and the tests share it.
import type { Rec } from './schema.ts';
import { PPN_BPS, priced } from '../screens/public/plans.ts';

/** The billing month in Indonesia (WIB), so the 1st at 00:30 bills the new month. */
export const billMonth = (t: number) => new Date(t + 7 * 3600e3).toISOString().slice(0, 7);

/** One invoice per business per month on Basic / Pro, at the prices BorNiz set; a trial and Free are not billed,
 *  Enterprise is priced per contract by BorNiz staff. */
export function invoiceFor(t: { id: string; plan: string; trial?: boolean }, outlets: number, prices: Record<string, unknown>, now: number): (Rec & { n: string }) | null {
  const p = priced(prices).find(x => x.id === t.plan);
  if (!p?.monthly || t.trial || t.plan === 'enterprise') return null;
  const qty = Math.max(1, Math.min(outlets, p.outlets)), sub = p.monthly * qty, m = billMonth(now); // as Checkout charges: outlets kept after a downgrade are not billed
  return { id: `inv-${t.id}-${m}`, a: t.id, b: m, c: String(sub + Math.round((sub * PPN_BPS) / 10000)), d: 'unpaid', e: '', at: now, n: `${p.name} × ${qty} ${qty > 1 ? 'outlets' : 'outlet'}` };
}
