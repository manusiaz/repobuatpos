// BorNiz billing (spec bn-authority: "BorNiz billing (plan × outlets)", automatic): this month's invoice for a business,
// issued by the worker (db/migrations/20261023000000_borniz_billing.sql). Pure, so the worker and the tests share it.
import type { DB, Rec } from './schema.ts';
import { PPN_BPS, billed, priced } from '../screens/public/plans.ts';

/** An unpaid invoice (spec lg-gate): a reminder from day 7, the set-up read-only from day 14 (BN088); sales carry on. */
export const REMIND_DAYS = 7, HOLD_DAYS = 14;
/** When the oldest unpaid BorNiz invoice was issued: the platform's answer, else (demo) the invoices this store holds. */
export function unpaidSince(db: Pick<DB, 'tenant' | 'records'>): number | null {
  if (db.tenant.unpaidSince !== undefined) return db.tenant.unpaidSince;
  const at = (db.records.invoice ?? []).filter(r => r.a === db.tenant.id && r.d !== 'paid' && r.d !== 'void').map(r => r.at);
  return at.length ? Math.min(...at) : null;
}
/** Back-office pages whose saves the hold refuses (the collections in private.setup_change): read-only on screen too. */
export const HELD_OBJECTS = new Set(['outlet', 'promo', 'product', 'price', 'recipe', 'catops', 'supplier']);
/** Where an unpaid invoice stands: the hold is the server's (tenants.billing_hold, set by the worker from day 14). */
export function billingStage(db: Pick<DB, 'tenant' | 'records'>, now = Date.now()): 'due' | 'overdue' | 'hold' | null {
  if (db.tenant.hold) return 'hold';
  const since = unpaidSince(db);
  return since == null || since > now ? null : now - since >= REMIND_DAYS * 864e5 ? 'overdue' : 'due';
}

/** The billing month in Indonesia (WIB), so the 1st at 00:30 bills the new month. */
export const billMonth = (t: number) => new Date(t + 7 * 3600e3).toISOString().slice(0, 7);

const monthIx = (m: string) => Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1;
const monthOf = (i: number) => `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;

/** One invoice per business on Basic / Pro, at the prices BorNiz set: each month, or (yearly, 2 months free) once per
 *  year from the month its cycle starts (tenants.cycle_from: a month already paid is never billed again). A trial and
 *  Free are not billed, Enterprise is priced per contract by BorNiz staff. */
export function invoiceFor(t: { id: string; plan: string; trial?: boolean; cycle?: string; cycleFrom?: string | null }, outlets: number, prices: Record<string, unknown>, now: number): (Rec & { n: string }) | null {
  const p = priced(prices).find(x => x.id === t.plan), m = billMonth(now);
  if (!p?.monthly || t.trial || t.plan === 'enterprise' || (t.cycleFrom && m < t.cycleFrom)) return null;
  const qty = Math.max(1, Math.min(outlets, p.outlets)), what = `${p.name} × ${qty} ${qty > 1 ? 'outlets' : 'outlet'}`; // as Checkout charges: outlets kept after a downgrade are not billed
  const bill = (id: string, b: string, sub: number, n: string) => ({ id, a: t.id, b, c: String(sub + Math.round((sub * PPN_BPS) / 10000)), d: 'unpaid', e: '', at: now, n });
  if (t.cycle !== 'yearly') return bill(`inv-${t.id}-${m}`, m, p.monthly * qty, what);
  const from = monthIx(t.cycleFrom ?? m), k = monthIx(m) - from;
  return k % 12 ? null : bill(`inv-${t.id}-${m}-y`, `${m} – ${monthOf(monthIx(m) + 11)}`, (billed(p, true) ?? 0) * qty, `${what} · yearly`);
}
