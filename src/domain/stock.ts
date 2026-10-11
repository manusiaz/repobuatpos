import type { IDR } from './money.ts';
import { levelRequired } from './approval.ts';

// lg-stock: every change is a movement; level = sum of movements.
export type MoveType = 'sale' | 'receipt' | 'transfer_in' | 'transfer_out' | 'waste' | 'adjust' | 'opname_adjustment' | 'refund_return' | 'production';
export interface Movement { outletId: string; stockItemId: string; qty: number; type: MoveType; sourceId?: string; by: string; at: number }
export interface RecipeLine { productId: string; stockItemId: string; qty: number }

export const level = (moves: Movement[], outletId: string, itemId: string) =>
  moves.filter(m => m.outletId === outletId && m.stockItemId === itemId).reduce((a, m) => a + m.qty, 0);

/** Every item's level at one outlet in one pass (menus check many products at once). */
export function levels(moves: Movement[], outletId: string) {
  const m = new Map<string, number>();
  for (const x of moves) if (x.outletId === outletId) m.set(x.stockItemId, (m.get(x.stockItemId) ?? 0) + x.qty);
  return m;
}
/** Portions the recipe can still make from stock (Infinity when the product has no recipe). */
export const portionsLeft = (recipe: RecipeLine[], lv: Map<string, number>, productId: string) =>
  recipe.filter(r => r.productId === productId && r.qty > 0).reduce((n, r) => Math.min(n, Math.floor((lv.get(r.stockItemId) ?? 0) / r.qty + 1e-9)), Infinity); // 1e-9: levels are sums of decimals

/** Sale deducts by recipe at order.paid, not at add-to-cart. */
export function deductForSale(recipe: RecipeLine[], lines: { productId: string; qty: number }[], outletId: string, orderId: string, by: string, at = Date.now()): Movement[] {
  return lines.flatMap(l => recipe.filter(r => r.productId === l.productId)
    .map(r => ({ outletId, stockItemId: r.stockItemId, qty: -r.qty * l.qty, type: 'sale' as const, sourceId: orderId, by, at })));
}

// Opname: blind count, locked after submit, approved by someone else, stock moves only when posted.
export interface OpnameLine { stockItemId: string; systemQty: number; counted: number; unitCost: IDR; photo?: string; locked?: boolean; recountOf?: string }
export const lineVariance = (l: OpnameLine) => Math.round((l.counted - l.systemQty) * l.unitCost);
export const opnameVariance = (lines: OpnameLine[]) => lines.reduce((a, l) => a + Math.abs(lineVariance(l)), 0);
/** Each line with a difference needs a photo (or every line if the manager requires it). */
export const missingPhotos = (lines: OpnameLine[], requireAll = false) =>
  lines.filter(l => (requireAll || l.counted !== l.systemQty) && !l.photo);
export const opnameApprover = (lines: OpnameLine[]) => levelRequired('opname', opnameVariance(lines));
export const postOpname = (lines: OpnameLine[], outletId: string, opnameId: string, by: string, at = Date.now()): Movement[] =>
  lines.filter(l => l.counted !== l.systemQty).map(l => ({ outletId, stockItemId: l.stockItemId, qty: Math.round((l.counted - l.systemQty) * 1000) / 1000, type: 'opname_adjustment', sourceId: opnameId, by, at }));
