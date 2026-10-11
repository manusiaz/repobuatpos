// Money is integer rupiah everywhere. Format only at render (Design Notes: Money).
export type IDR = number;

const group = (n: number) => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** "IDR 25,000" */
export const idr = (n: IDR) => (n < 0 ? '−IDR ' : 'IDR ') + group(Math.abs(n));

/** Short form for charts and KPIs: "IDR 2,4 jt", "IDR 23 rb". */
export function idrShort(n: IDR): string {
  const a = Math.abs(n), s = n < 0 ? '−' : '';
  if (a >= 1e9) return `${s}IDR ${(a / 1e9).toFixed(1).replace('.', ',')} M`;
  if (a >= 1e6) return `${s}IDR ${(a / 1e6).toFixed(1).replace('.', ',').replace(/,0$/, '')} jt`;
  if (a >= 1e3) return `${s}IDR ${Math.round(a / 1e3)} rb`;
  return `${s}IDR ${a}`;
}

/** Cash rounding is a separate line, applied last (lg-total). */
export const roundCash = (n: IDR, step = 100) => Math.round(n / step) * step;

/** basis points: 1000 bps = 10% */
export const bps = (n: IDR, b: number) => Math.round((n * b) / 10000);
