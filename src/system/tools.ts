// Customization Studio values the live app reads. The studio publishes a 'page' version { tool, values }; every surface
// reads the latest published values here, over the tool's defaults (the same defaults the studio starts from).
import type { DB, Theme } from '../data/schema.ts';

export const TOOL_DEFAULTS = {
  wait: { step: 'auto', prog: 'steps', eta: true, greet: 'Sit back, {name}. We’re brewing.', p_upsell: true, p_loyal: true, p_wifi: true, p_music: true, p_game: false, p_story: true, p_promo: true, p_ig: false, p_ad: false, adby: 'Susu Segar Lembang' },
  ready: { head: 'Selamat menikmati, {name}!', sub: 'Pesanan {order} siap di counter.', where: 'pickup', c_page: true, c_push: true, c_wa: true, c_disp: true, c_vibe: true, cta: 'rate', confetti: true, later: 'Terima kasih sudah mampir. Sampai jumpa lagi!' },
  push: { title: 'Your order is ready', body: 'Pick it up at the counter. Selamat menikmati!', img: false, link: 'order', when: 'now' },
  pixels: { meta: '', tiktok: '', ga: '', page: 'home', t_home: '', d_home: 'Order ahead, skip the queue and earn beans.', t_menu: '', d_menu: '', t_promo: '', d_promo: '' },
  optin: { quiet: true, from: '21:00', to: '08:00', stop: 'STOP', checkout: true, footer: true },
  emaild: { from: 'Kopi Biru', addr: 'hello@kopibiru.id' },
  fonts: { head: 'space', body: 'body', scale: 100, upload: '' },
  icons: { style: 'outline', stroke: 2, shape: 'rounded', color: 'primary' },
  appicon: { name: 'Kopi Biru', bg: 'primary', shape: 'squircle', og: 'Order ahead at Kopi Biru', logo: '' },
  sounds: { 'sfx-order-in': 'bell', 'sfx-pay-success': 'default', 'sfx-pay-fail': 'default', 'sfx-scan': 'default', vol: 70, kds: true, disp: true },
  lang: { def: 'id', en: true, zh: false, ja: false, ko: false, edit: 'en' },
  anim: { level: 'subtle', reduce: true },
  cup: { size: '50x30', name: true, mods: true, queue: true, logo: true, foot: 'Enjoy, {name}!' },
  kticket: { station: 'bar', fs: 'l', table: true, notes: true, cut: true, dup: false },
  coupon: { head: 'Come back this week', offer: '15% off your next coffee', code: 'BIRU15', exp: 7, min: 'Min. spend IDR 50,000', bar: true, rule: 'every' },
} as const satisfies Record<string, Record<string, string | number | boolean>>;
export type ToolId = keyof typeof TOOL_DEFAULTS;
type Widen<T> = { -readonly [K in keyof T]: T[K] extends number ? number : T[K] extends boolean ? boolean : string };

/** The live (published) version of a tool, if the owner published it (approved publishes count). */
export const toolPublished = (db: DB, id: string) => db.versions.find(v => v.kind === 'page' && v.status === 'published' && (v.data as { tool?: string } | null)?.tool === id);
/** Published values of a Customization Studio tool, over its defaults. Extra keys (translations `tr:<product>:<lang>`) pass through. */
export const toolValue = <K extends ToolId>(db: DB, id: K): Widen<(typeof TOOL_DEFAULTS)[K]> & Record<string, unknown> =>
  ({ ...TOOL_DEFAULTS[id], ...((toolPublished(db, id)?.data as { values?: object } | undefined)?.values ?? {}) }) as never;

/** {name} / {order} / {table} / {queue} placeholders in studio copy. */
export const fillTool = (s: string, vars: Record<string, string>) => String(s).replace(/\{(\w+)\}/g, (m, k) => vars[k] ?? m);

// ── Languages ──────────────────────────────────────────────────────────────────────────
export const LANG_NAMES: Record<string, [string, string]> = { id: ['Bahasa Indonesia', 'Pesan dalam Bahasa Indonesia'], en: ['English', 'Order in English'], zh: ['中文', '菜单名称翻译'], ja: ['日本語', 'メニュー名の翻訳'], ko: ['한국어', '메뉴 이름 번역'] };
/** Languages a guest can pick: the default first, then every language the owner switched on. `fallback` = the settings page choice. */
export function guestLanguages(db: DB, fallback: string) {
  if (!toolPublished(db, 'lang')) return { first: fallback, langs: ['en', 'id'] };
  const v = toolValue(db, 'lang'), first = v.def === 'en' ? 'en' : 'id';
  return { first, langs: [first, ...['id', 'en', 'zh', 'ja', 'ko'].filter(k => k !== first && v[k])] };
}
/** A product name in the guest's language: the owner's translation, else the name as written. */
export const itemName = (db: DB, p: { id: string; name: string }, lang: string) => {
  const tr = toolPublished(db, 'lang') ? toolValue(db, 'lang')[`tr:${p.id}:${lang}`] : '';
  return typeof tr === 'string' && tr.trim() ? tr : p.name;
};

// ── Ad pixels & SEO (guest pages only, never on payment pages, only after the guest agrees) ──
export const PAY_PAGES = ['checkout-and-payment', 'qris-payment'];
const SEO_PAGE: Record<string, 'home' | 'menu' | 'promo'> = { order: 'home', 'scan-landing': 'home', 'menu-home': 'home', 'category-full-menu': 'menu', search: 'menu', 'item-detail-and-options': 'menu', 'claim-voucher': 'promo' };
export interface PixelTag { id: string; src: string; init: string }
export function pixelPlan(db: DB, slug: string, consent: boolean | null) {
  const v = toolValue(db, 'pixels'), page = SEO_PAGE[slug];
  const ids = { meta: v.meta.trim(), tiktok: v.tiktok.trim(), ga: v.ga.trim() };
  const wanted = !!(ids.meta || ids.tiktok || ids.ga);
  const tags: PixelTag[] = !wanted || consent !== true || PAY_PAGES.includes(slug) ? [] : [
    ...(ids.meta ? [{ id: 'meta', src: 'https://connect.facebook.net/en_US/fbevents.js', init: `window.fbq=window.fbq||function(){(fbq.q=fbq.q||[]).push(arguments)};fbq('init',${JSON.stringify(ids.meta)});fbq('track','PageView');` }] : []),
    ...(ids.tiktok ? [{ id: 'tiktok', src: 'https://analytics.tiktok.com/i18n/pixel/events.js?sdkid=' + encodeURIComponent(ids.tiktok), init: '' }] : []),
    ...(ids.ga ? [{ id: 'ga', src: 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(ids.ga), init: `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config',${JSON.stringify(ids.ga)});` }] : []),
  ];
  const title = page ? String(v['t_' + page] ?? '').trim() : '', desc = page ? String(v['d_' + page] ?? '').trim() : '';
  return { ask: wanted && consent === null && !PAY_PAGES.includes(slug), tags, title: title || (page ? `${db.tenant.name} · ${{ home: 'Order', menu: 'Menu', promo: 'Promos' }[page]}` : ''), desc };
}

// ── Messaging consent & sender ─────────────────────────────────────────────────────────
const hm = (s: string) => { const [h, m] = String(s).split(':').map(Number); return (h || 0) * 60 + (m || 0); };
/** Marketing waits during the owner's quiet hours (transactional messages never do). */
export function quietNow(db: DB, at = Date.now()) {
  const v = toolValue(db, 'optin');
  if (!v.quiet) return false;
  const d = new Date(at), m = d.getHours() * 60 + d.getMinutes(), f = hm(v.from), e = hm(v.to);
  return f > e ? m >= f || m < e : m >= f && m < e;
}
/** "Kopi Biru <hello@kopibiru.id>" once the owner published their own sender; '' = the platform default sender. */
export const emailFrom = (db: DB) => { if (!toolPublished(db, 'emaild')) return ''; const v = toolValue(db, 'emaild'); return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.addr.trim()) ? `${v.from.trim() || db.tenant.name} <${v.addr.trim()}>` : ''; };

// ── Guest look: fonts, icon style, motion ──────────────────────────────────────────────
const FAMILY: Record<string, string> = { space: "'Space Grotesk',sans-serif", body: "'Instrument Sans',sans-serif" };
const lum = (h: string) => { const x = h.replace('#', ''), f = x.length === 3 ? x.split('').map(c => c + c).join('') : x.slice(0, 6), n = parseInt(f, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(c => { const s = c / 255; return s <= .03928 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4; }).reduce((a, c, i) => a + c * [.2126, .7152, .0722][i], 0); };
const ratio = (a: string, b: string) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
/** CSS variables a guest screen root wears: merchant fonts (once published, else the theme font stays) and the icon colours. */
export function guestVars(db: DB, t: Theme): Record<string, string> {
  const ic = toolValue(db, 'icons'), c = ic.color === 'accent' ? t.acc : ic.color === 'dark' ? t.ink : t.p;
  const out: Record<string, string> = { '--bn-icon': c, '--bn-icon-on': ratio('#ffffff', c) >= ratio(t.ink, c) ? '#ffffff' : t.ink };
  if (!toolPublished(db, 'fonts')) return out;
  const v = toolValue(db, 'fonts');
  if (FAMILY[v.head]) out['--bn-font'] = FAMILY[v.head];
  if (FAMILY[v.body]) out['--font-body'] = FAMILY[v.body];
  return out;
}
/** Size scale of the guest menu (85–120 %), 1 until the owner publishes fonts. */
export const guestZoom = (db: DB) => (toolPublished(db, 'fonts') ? Math.max(.85, Math.min(1.2, Number(toolValue(db, 'fonts').scale) / 100 || 1)) : 1);
export const animLevel = (db: DB, reducedMotion: boolean): 'none' | 'subtle' | 'playful' => {
  const v = toolValue(db, 'anim'), l = v.level === 'none' || v.level === 'playful' ? v.level : 'subtle';
  return v.reduce && reducedMotion ? 'none' : l;
};
/** Rules for [data-guest] roots: icon stroke / style / container, and the motion level. */
export function guestCss(db: DB) {
  const ic = toolValue(db, 'icons'), r = { none: '0', rounded: '28%', circle: '50%' }[ic.shape] ?? '28%';
  const a = toolValue(db, 'anim');
  return [
    `[data-guest] .lucide{stroke-width:${Math.max(1, Math.min(3, Number(ic.stroke) || 2))}px}`,
    ic.style === 'duo' ? '[data-guest] .bn-ico{fill:currentColor;fill-opacity:.22}' : '',
    ic.style === 'filled' ? `[data-guest] .bn-ico{background:var(--bn-icon);color:var(--bn-icon-on)!important;border-radius:${r};padding:2px;box-sizing:content-box}` : '',
    a.level === 'none' ? '[data-guest] *{animation:none!important;transition:none!important}' : '',
    a.level === 'playful' ? '[data-guest] button:not(:disabled){transition:transform 420ms var(--ease-spring)}[data-guest] button:not(:disabled):hover{transform:translateY(-3px) rotate(-.6deg) scale(1.01)}[data-guest] button:not(:disabled):active{transform:scale(.97)}' : '',
    a.reduce ? '@media (prefers-reduced-motion:reduce){[data-guest] *{animation:none!important;transition:none!important}}' : '',
  ].filter(Boolean).join('\n');
}

// ── Kitchen ticket layout ──────────────────────────────────────────────────────────────
export function ticketLayout(db: DB) {
  const v = toolValue(db, 'kticket');
  return { item: (v.fs === 'm' ? 'tall' : 'wide') as 'tall' | 'wide', bigMods: v.fs === 'xl', table: v.table ? 'wide' as const : 'normal' as const, notes: !!v.notes, cut: !!v.cut, expo: !!v.dup };
}
