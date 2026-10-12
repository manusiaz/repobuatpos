import type { IDR } from './money.ts';

// Sharing integer rupiah without losing or inventing one: a combo price over its items, a bill over the phones at a table.

/** `total` shared in proportion to `weights`: each share is floored, then the leftover rupiah go to the largest remainders
 *  (earlier shares first on a tie). Always sums to `total` exactly. All-zero weights share equally. */
export function allocate(total: IDR, weights: number[]): IDR[] {
  if (!weights.length) return [];
  const w = weights.map(x => Math.max(0, x)), sum = w.reduce((a, b) => a + b, 0);
  const exact = w.map(x => (sum ? (total * x) / sum : total / w.length));
  const out = exact.map(x => Math.floor(x));
  const order = exact.map((x, i) => [x - Math.floor(x), i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let left = total - out.reduce((a, b) => a + b, 0), k = 0; left > 0; left--, k = (k + 1) % order.length) out[order[k][1]]++;
  return out;
}
/** Split a bill equally between `n` phones; the odd rupiah go to the first shares. */
export const splitEqual = (total: IDR, n: number): IDR[] => allocate(total, Array.from({ length: Math.max(1, Math.floor(n)) }, () => 1));
/** Combo unit prices: the combo price shared over the picked items by their menu price. */
export const comboPrices = (price: IDR, listPrices: IDR[]): IDR[] => allocate(Math.max(0, Math.round(price)), listPrices);
