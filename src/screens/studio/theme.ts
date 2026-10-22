// Merchant colour maths for the studios: WCAG contrast, mixing, and the --bn-* variables guest screens consume.
// Hex values here are merchant theme data (from db.theme / db.staffBrand), not BorNiz UI colours.
import type { CSSProperties } from 'react';
import type { MenuDesign } from '../../data/actions/studio.ts';

const WHITE = '#FFFFFF', INK = '#141210';
const rgb = (h: string) => { const s = (h || '#000000').replace('#', ''); return [0, 2, 4].map(i => parseInt(s.slice(i, i + 2), 16) || 0); };
const hex = (a: number[]) => '#' + a.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('').toUpperCase();
export const mix = (a: string, b: string, t: number) => { const x = rgb(a), y = rgb(b); return hex(x.map((v, i) => v + (y[i] - v) * t)); };
const lum = (h: string) => { const c = rgb(h).map(v => v / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
export const contrast = (a: string, b: string) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
/** Label colour on a fill: white when it reads, otherwise ink. */
export const onColor = (c: string) => (contrast(WHITE, c) >= contrast(INK, c) ? WHITE : INK);
export const isHex = (v: string) => /^#[0-9a-f]{6}$/i.test(v);
export const darken = (c: string, t = 0.45) => mix(c, INK, t);
export const lighten = (c: string, t = 0.6) => mix(c, WHITE, t);
export const MIN_RATIO = 4.5;

export interface Check { label: string; ratio: number; ok: boolean }
export function menuChecks(d: MenuDesign): Check[] {
  return [
    ['Text on page background', d.ink, d.paper], ['Text on cards', d.ink, d.surface], ['Button label on primary', onColor(d.p), d.p],
  ].map(([label, a, b]) => { const ratio = contrast(a, b); return { label, ratio, ok: ratio >= MIN_RATIO }; });
}

/** Guest fonts (merchant font only inside [data-guest]). Google family name per key. */
export const FONTS: Record<string, [label: string, css: string, google: string | null]> = {
  space: ['Space Grotesk', "'Space Grotesk',sans-serif", null], jakarta: ['Plus Jakarta Sans', "'Plus Jakarta Sans',sans-serif", 'Plus+Jakarta+Sans'],
  dm: ['DM Sans', "'DM Sans',sans-serif", 'DM+Sans'], poppins: ['Poppins', "'Poppins',sans-serif", 'Poppins'], nunito: ['Nunito', "'Nunito',sans-serif", 'Nunito'],
  outfit: ['Outfit', "'Outfit',sans-serif", 'Outfit'], playfair: ['Playfair Display', "'Playfair Display',serif", 'Playfair+Display'], lora: ['Lora', "'Lora',serif", 'Lora'],
  serif: ['Lora (serif)', "'Lora',serif", 'Lora'], bebas: ['Bebas Neue', "'Bebas Neue',sans-serif", 'Bebas+Neue'], system: ['Instrument Sans', "'Instrument Sans',sans-serif", null],
};
export function loadFont(k: string) {
  const g = FONTS[k]?.[2];
  if (!g || typeof document === 'undefined' || document.getElementById('bnf-' + k)) return;
  const l = document.createElement('link'); l.id = 'bnf-' + k; l.rel = 'stylesheet';
  l.href = `https://fonts.googleapis.com/css2?family=${g}:wght@400;600;700;800&display=swap`; document.head.appendChild(l);
}
export const fontCss = (k: string) => FONTS[k]?.[1] ?? FONTS.space[1];

/** Cover gradients when no photo is uploaded; derived from the theme so every banner key stays on-brand. */
export function bannerOf(d: Pick<MenuDesign, 'p' | 'acc' | 'ink' | 'banner' | 'img'>) {
  if (d.img) return `url(${d.img}) center/cover no-repeat`;
  const [a, b] = ({ g1: [d.p, d.ink], g2: [mix(d.p, d.acc, 0.3), darken(d.p, 0.6)], g3: [lighten(d.p, 0.3), darken(d.p, 0.4)], g4: [d.acc, d.ink] } as Record<string, string[]>)[d.banner] ?? [d.p, d.ink];
  return `linear-gradient(135deg,${a},${b})`;
}

/** The merchant theme as CSS variables (spec/bn-brand.js): --bn-p, --bn-acc, --bn-ink, --bn-paper, --bn-font, --bn-banner + studio extras. */
export function themeVars(d: MenuDesign): CSSProperties {
  const r = Number(d.layout.radius ?? 16);
  return {
    '--bn-p': d.p, '--bn-acc': d.acc, '--bn-ink': d.ink, '--bn-paper': d.paper, '--bn-surface': contrast(d.ink, d.surface) >= MIN_RATIO ? d.surface : mix(d.paper, d.ink, 0.09), // never light text on a white card '--bn-on-p': onColor(d.p), '--bn-on-acc': onColor(d.acc),
    '--bn-font': fontCss(d.font), '--bn-body': fontCss(d.body), '--bn-price': fontCss(d.priceFont === 'head' ? d.font : d.priceFont === 'body' ? d.body : 'system'),
    '--bn-banner': bannerOf(d), '--bn-r': r + 'px', '--bn-r-sm': Math.round(r * 0.6) + 'px', '--bn-line': mix(d.paper, d.ink, 0.12), '--bn-soft': mix(d.paper, d.ink, 0.06),
    '--bn-p-text': contrast(d.p, d.paper) >= MIN_RATIO ? d.p : mix(d.p, contrast(WHITE, d.paper) > 2 ? WHITE : INK, 0.35),
  } as CSSProperties;
}

/** Read a picked image, scale it down and return a JPEG data URL (kept small for the store). */
export function readImage(file: File | undefined, maxW = 1200): Promise<string> {
  return new Promise((ok, bad) => {
    if (!file) return bad(new Error('No file'));
    const rd = new FileReader();
    rd.onerror = () => bad(rd.error);
    rd.onload = () => {
      const im = new Image();
      im.onerror = () => bad(new Error('Not an image'));
      im.onload = () => {
        const c = document.createElement('canvas'), w = Math.min(maxW, im.width); c.width = w; c.height = Math.round((im.height * w) / im.width);
        c.getContext('2d')!.drawImage(im, 0, 0, c.width, c.height);
        ok(c.toDataURL(file.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.8));
      };
      im.src = rd.result as string;
    };
    rd.readAsDataURL(file);
  });
}
