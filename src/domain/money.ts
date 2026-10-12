// Money is integer rupiah everywhere. Format only at render (Design Notes: Money).
export type IDR = number;

let style: 'idr' | 'rp' = 'idr', sep: 'comma' | 'dot' | undefined, short = false;
/** Set once per render from the owner's Language & currency page (src/system/settings.ts moneyStyle); guest surfaces
 *  add the Studios number format (separator, "25k" short form) through src/system/tools.ts moneyFormat. */
export const setMoneyStyle = (s: 'idr' | 'rp', sp?: 'comma' | 'dot', sh = false) => { style = s; sep = sp; short = sh; };
/** Format with another style for one document (a receipt in the outlet's guest format), then restore. */
export function withMoneyStyle<T>(f: [s: 'idr' | 'rp', sp?: 'comma' | 'dot', sh?: boolean], fn: () => T): T {
  const prev: [typeof style, typeof sep, boolean] = [style, sep, short];
  setMoneyStyle(...f);
  try { return fn(); } finally { setMoneyStyle(...prev); }
}
const group = (n: number) => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, (sep ?? (style === 'rp' ? 'dot' : 'comma')) === 'dot' ? '.' : ',');
const cur = () => (style === 'rp' ? 'Rp' : 'IDR ');

/** "IDR 25,000" or "Rp25.000" (or "25k" for whole thousands when the short form is on) */
export const idr = (n: IDR) => (n < 0 ? '−' : '') + (short && n && n % 1000 === 0 ? Math.abs(n) / 1000 + 'k' : cur() + group(Math.abs(n)));

/** Short form for charts and KPIs: "IDR 2,4 jt", "IDR 23 rb". */
export function idrShort(n: IDR): string {
  const a = Math.abs(n), s = n < 0 ? '−' : '';
  if (a >= 1e9) return `${s}${cur()}${(a / 1e9).toFixed(1).replace('.', ',')} M`;
  if (a >= 1e6) return `${s}${cur()}${(a / 1e6).toFixed(1).replace('.', ',').replace(/,0$/, '')} jt`;
  if (a >= 1e3) return `${s}${cur()}${Math.round(a / 1e3)} rb`;
  return `${s}${cur()}${a}`;
}

/** Cash rounding is a separate line, applied last (lg-total). */
export const roundCash = (n: IDR, step = 100) => Math.round(n / step) * step;

/** basis points: 1000 bps = 10% */
export const bps = (n: IDR, b: number) => Math.round((n * b) / 10000);
