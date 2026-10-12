// Commission (Payroll & commission): a percent of the person's net sales and/or a fixed amount per item sold of
// chosen products or categories. Pure: the caller hands in the person's paid orders and the refunds on them.
import type { IDR } from './money.ts';

export interface CommissionRule {
  id: string; name: string;
  /** One person, or everyone with this role. A person with their own rules gets only those (no role rules). */
  employeeId: string | null; role: string | null;
  /** Percent of net sales in basis points: 100 = 1%. */
  salesBps: number;
  /** Rupiah per item sold of these products or categories (none chosen = no per-item pay). */
  perItem: IDR; productIds: string[]; categoryIds: string[];
}
export interface SoldLine { productId: string; categoryId: string; qty: number }
/** A paid order (net = after discounts, before PB1 and service) or a refund on one (its net share and the lines returned). */
export interface SaleRow { net: IDR; lines: SoldLine[] }
export interface Commission { net: IDR; items: number; fromSales: IDR; fromItems: IDR; total: IDR; rules: string[] }

export function rulesFor(rules: CommissionRule[], who: { id: string; role: string }): CommissionRule[] {
  const own = rules.filter(r => r.employeeId === who.id);
  return own.length ? own : rules.filter(r => !r.employeeId && r.role === who.role);
}

/** Net sales = paid orders − refunds on them, never below zero. Each part rounds down to whole rupiah. */
export function commission(rules: CommissionRule[], who: { id: string; role: string }, sales: SaleRow[], refunds: SaleRow[] = []): Commission {
  const sum = (rows: SaleRow[]) => rows.reduce((a, r) => a + r.net, 0);
  const net = Math.max(0, sum(sales) - sum(refunds));
  const mine = rulesFor(rules, who);
  let fromSales = 0, fromItems = 0, items = 0;
  for (const r of mine) {
    fromSales += Math.floor((net * r.salesBps) / 10000);
    if (r.perItem <= 0) continue;
    const hit = (l: SoldLine) => r.productIds.includes(l.productId) || r.categoryIds.includes(l.categoryId);
    const qty = (rows: SaleRow[]) => rows.reduce((a, x) => a + x.lines.filter(hit).reduce((b, l) => b + l.qty, 0), 0);
    const n = Math.max(0, qty(sales) - qty(refunds));
    items += n; fromItems += n * Math.floor(r.perItem);
  }
  return { net, items, fromSales, fromItems, total: fromSales + fromItems, rules: mine.map(r => r.id) };
}
