// Menu Studio page values the live app reads (QR menu, kiosk, POS, display). The studio edits them; publishing puts them in
// the menu design (design.x[key]); every surface reads them here, merged over these defaults, so a preview is never a dead end.
import type { DB } from '../data/schema.ts';
import { menuDesign } from '../data/actions/studio.ts';

export const BADGES: [string, string, string][] = [['spicy', 'Spicy', 'flame'], ['veg', 'Vegetarian', 'leaf'], ['nuts', 'Contains nuts', 'nut'], ['dairy', 'Contains dairy', 'milk'], ['halal', 'Halal', 'badge-check'], ['new', 'New', 'sparkles']];
export const STUDIO_DEFAULTS = {
  'custom-badges-and-allergen-diet-icons': { which: 'spicy', spicy: '', veg: '', nuts: '', dairy: '', halal: '', new: '', legend: true },
  'style-per-category': { cat: 'coffee', layout: 'grid', bg: 'page', banner: '' },
  'auto-theme-by-time': { on: true, dark: '18:00', light: '06:00', paper: '#14161C', ink: '#F5F2EE' },
  'upsell-and-goes-well-with-rules': { trigger: 'p1', suggest: 'p7,p8', title: 'Goes well with', max: 2, cart: true },
  'combo-bundle-builder-steps': { name: 'Breakfast combo', price: 49000, s1: 'Pick a drink', c1: 'coffee', s2: 'Pick a pastry', c2: 'pastry', s3: 'Add a side', c3: 'other' },
  'split-bill-and-pay-together-from-phones': { equal: true, items: true, max: 6, tip: false },
  'reservation-booking-page': { maxGuests: 12, slot: 30, deposit: 100000, depositFrom: 6, note: 'We hold your table for 15 minutes.' },
  'gift-card-designer': { style: 'brand', title: 'A coffee on me', amounts: '100000,200000,500000', msg: 'Happy birthday! Enjoy a slow morning on me.', img: '' },
  'referral-page': { give: '10% off first order', get: '50 beans', prefix: 'KOPI', share: 'wa' },
  'delivery-tracking-page': { driver: true, map: true, eta: true, help: 'Chat with us on WhatsApp' },
  'store-closed-offline-sold-out-pages': { state: 'closed', closed: 'We are closed right now', closedSub: 'Pre-order now and pick up when we open.', offline: 'We can’t take orders right now', offlineSub: 'Please order at the cashier. We’re fixing it.', sold: 'Sold out for today', soldSub: 'Back tomorrow morning. Try something else?', preorder: true },
  'feedback-and-rating-page': { q: 'How was your visit?', tags: 'Taste,Speed,Friendly staff,Cleanliness,Value', low: true, reward: '20 beans for your feedback' },
  'queue-pickup-screen': { head: 'Order status', ready: 'Ready for pickup', prep: 'Preparing', sound: true, show: 8 },
  'menu-board-tv-digital-signage': { cols: 3, photos: true, dark: true, promo: true },
  'printable-menu-pdf-generator': { size: 'a4', cols: 2, desc: true, prices: true, footer: 'Prices include 10% PB1 where stated · Ask us about allergens' },
  'qris-payment-page-on-customer-phone': { timer: 5, steps: true, save: true },
  'checkout-flow-fields': { name: 'required', phone: 'required', notes: true, tips: false, pickup: true, member: true },
  'menu-and-price-per-channel': { dine: 0, take: 0, gofood: 20, grab: 20, shopee: 15, round: 500 },
  'voucher-and-promo-visuals': { shape: 'ticket', fill: 'outline', code: true, expiry: true },
  'multi-page-online-store-link-in-bio': { handle: '@kopibiru.id', order: true, book: true, gift: true, wa: true, maps: true, store: 'kopibiru' },
} as const satisfies Record<string, Record<string, string | number | boolean>>;
export type StudioKey = keyof typeof STUDIO_DEFAULTS;

/** Published values of one Menu Studio page, over its defaults. */
export const studioValue = <K extends StudioKey>(db: DB, key: K): { -readonly [F in keyof (typeof STUDIO_DEFAULTS)[K]]: (typeof STUDIO_DEFAULTS)[K][F] extends number ? number : (typeof STUDIO_DEFAULTS)[K][F] extends boolean ? boolean : string } =>
  ({ ...STUDIO_DEFAULTS[key], ...(menuDesign(db).x[key] ?? {}) }) as never;

const mins = (hhmm: string) => { const [h, m] = String(hhmm).split(':').map(Number); return (h || 0) * 60 + (m || 0); };
/** Auto theme by time: the guest screens switch to the evening colours between `dark` and `light`. */
export function themeNow<T extends { paper: string; ink: string }>(db: DB, theme: T, at = Date.now()): T {
  const v = studioValue(db, 'auto-theme-by-time');
  if (!v.on) return theme;
  const d = new Date(at), now = d.getHours() * 60 + d.getMinutes(), a = mins(v.dark), b = mins(v.light);
  const dark = a > b ? now >= a || now < b : now >= a && now < b;
  return dark ? { ...theme, paper: v.paper, ink: v.ink } : theme;
}
/** Beans promised on the feedback page ("20 beans for your feedback" → 20). */
export const feedbackBeans = (db: DB) => Number(/(\d+)\s*beans?/i.exec(studioValue(db, 'feedback-and-rating-page').reward)?.[1] ?? 0);

/** Diet and allergen badges the owner put on a product (Menu Studio › badges & allergen icons). */
export function badgesOf(db: DB, productId: string): [string, string, string][] {
  const v = studioValue(db, 'custom-badges-and-allergen-diet-icons') as Record<string, string | boolean>;
  return BADGES.filter(([k]) => String(v[k] ?? '').split(',').map(x => x.trim()).includes(productId));
}
/** Price sent to a delivery platform: base price + the channel markup, rounded (Menu Studio › menu & price per channel). */
export function channelPrice(db: DB, base: number, source: string): number {
  const v = studioValue(db, 'menu-and-price-per-channel'), key = ({ gofood: 'gofood', grabfood: 'grab', shopeefood: 'shopee' } as Record<string, 'gofood' | 'grab' | 'shopee'>)[source];
  if (!key) return base;
  const r = Number(v.round) || 100;
  return Math.ceil((base * (1 + Number(v[key]) / 100)) / r) * r;
}
