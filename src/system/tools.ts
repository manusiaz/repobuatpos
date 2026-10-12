// Customization Studios → the live app. A tool's settings are a draft until published (publish('page', { tool, values }),
// owner directly or manager via the owner's approval). Surfaces read the latest published values here, over the tool's
// defaults (the same defaults the studio starts from). Nothing published, or a plan that no longer includes the tool,
// means the app behaves exactly as it did before.
import type { DB, Outlet, Role, Theme } from '../data/schema.ts';
import { moneyStyle } from './settings.ts';

type Plan = DB['tenant']['plan'];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type V = Record<string, any>;
const RANK: Record<Plan, number> = { free: 0, basic: 1, pro: 2, enterprise: 3 };
const DAY = 864e5;

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

/** The latest published version of a studio tool (approved publishes count), if the tenant's plan still includes it. */
export function toolVersion(db: DB, id: string, plan: Plan = 'free') {
  if (RANK[db.tenant.plan] < RANK[plan]) return undefined;
  return db.versions.find(v => v.kind === 'page' && v.status === 'published' && (v.data as V)?.tool === id);
}
export const toolPublished = (db: DB, id: string) => toolVersion(db, id);
/** Published values of a studio tool over its defaults ({} when a tool without defaults was never published). Extra keys
 *  (translations `tr:<product>:<lang>`) pass through. */
export function toolValue<K extends ToolId>(db: DB, id: K, plan?: Plan): Widen<(typeof TOOL_DEFAULTS)[K]> & Record<string, unknown>;
export function toolValue(db: DB, id: string, plan?: Plan): V;
export function toolValue(db: DB, id: string, plan: Plan = 'free'): V {
  return { ...((TOOL_DEFAULTS as Record<string, object>)[id] ?? {}), ...((toolVersion(db, id, plan)?.data as V)?.values ?? {}) };
}

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

// ── Money: Price display rules + Number & currency format per outlet (guest surfaces and receipts) ──
export type MoneyFmt = [style: 'idr' | 'rp', sep: 'comma' | 'dot' | undefined, short: boolean];
const GUEST = ['selforder', 'kiosk', 'display'];
/** How money reads on a surface. Staff tools and reports keep the owner's Language & currency setting. */
export function moneyFormat(db: DB, surface: string, outletId: string): MoneyFmt {
  const base = moneyStyle(db);
  if (!GUEST.includes(surface)) return [base, undefined, false];
  return guestMoney(db, outletId);
}
/** Guest money format at an outlet: the outlet's number format wins over the brand's price display rules. */
export function guestMoney(db: DB, outletId: string): MoneyFmt {
  const pr = toolValue(db, 'prices'), n = toolValue(db, 'numfmt'), nf = !n.outlet || n.outlet === outletId ? n : {};
  const sym = nf.sym ?? pr.sym, sep = nf.sep ?? pr.sep;
  return [sym === 'rp' ? 'rp' : sym === 'idr' ? 'idr' : moneyStyle(db), sep === 'dot' || sep === 'comma' ? sep : undefined, Boolean(nf.short ?? pr.short)];
}
const p2 = (n: number) => String(n).padStart(2, '0');
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** Date and time on guest documents at an outlet (receipts), or null when no number format was published for it. */
export function guestStamp(db: DB, outletId: string, t: number): string | null {
  const n = toolValue(db, 'numfmt');
  if (!n.date || (n.outlet && n.outlet !== outletId)) return null;
  const d = new Date(t), h = d.getHours();
  const date = n.date === 'iso' ? `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}` : n.date === 'dmy' ? `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()}` : `${DAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  const time = n.clock === '12' ? `${h % 12 || 12}:${p2(d.getMinutes())} ${h < 12 ? 'AM' : 'PM'}` : `${p2(h)}${n.sep === 'dot' ? '.' : ':'}${p2(d.getMinutes())}`;
  return `${date} ${time}${n.tz ? ' WIB' : ''}`;
}
/** Menu price as the guest sees it: optionally with tax & service, rounded. Display only; the bill is computed once. */
export function shownPrice(n: number, out: Pick<Outlet, 'taxInclusive' | 'taxBps' | 'serviceBps'>, v: V): number {
  const withTax = v.tax === 'incl' && !out.taxInclusive ? n * (1 + out.serviceBps / 1e4) * (1 + out.taxBps / 1e4) : n;
  const step = Number(v.step) || 1;
  if (step <= 1) return Math.round(withTax);
  const q = withTax / step;
  return (v.mode === 'up' ? Math.ceil(q - 1e-9) : v.mode === 'down' ? Math.floor(q + 1e-9) : Math.round(q)) * step;
}
/** Price display rules for the menus at an outlet: `price` maps a catalog price, `strike` = show the original on sale items. */
export function priceRules(db: DB, outletId: string) {
  const v = toolValue(db, 'prices'), out = db.outlets.find(o => o.id === outletId);
  const on = !!out && (Number(v.step) > 1 || v.tax === 'incl');
  return { price: (n: number) => (on ? shownPrice(n, out!, v) : n), strike: v.strike !== false, inclTax: on && v.tax === 'incl' && !out!.taxInclusive };
}

// ── A/B testing: two themes on the guest screens, results by variant ─────────────────────
/** Stable 0–99 bucket for an id (the same guest always sees the same version). */
export const bucket = (id: string) => { let h = 0; for (const c of id) h = (h * 33 + c.charCodeAt(0)) % 9973; return h % 100; };
export const abRunning = (v: V, now = Date.now()) => Number(v.start) > 0 && now < Number(v.start) + (Number(v.dur) || 14) * DAY;
const THEME_KEYS: (keyof Theme)[] = ['p', 'acc', 'ink', 'paper', 'font', 'banner', 'img'];
/** Variant B is the newest Menu Studio draft (the theme being tested); A is the live theme. */
export function abDraft(db: DB): Partial<Theme> | null {
  const d = db.versions.find(v => v.kind === 'menu' && v.status === 'draft')?.data as Partial<Theme> | undefined;
  if (!d) return null;
  const t = Object.fromEntries(THEME_KEYS.filter(k => d[k] != null).map(k => [k, d[k]])) as Partial<Theme>;
  return Object.keys(t).length ? t : null;
}
/** Which version this guest sees while a test runs (null = no test: everyone sees the live theme). */
export function abVariant(db: DB, guestId: string, now = Date.now()): 'A' | 'B' | null {
  const v = toolValue(db, 'ab', 'pro');
  if (!guestId || !abRunning(v, now) || !abDraft(db)) return null;
  return bucket(guestId) < Number(v.split ?? 50) ? 'B' : 'A';
}
export const abTheme = (db: DB, theme: Theme, variant: 'A' | 'B' | null): Theme => (variant === 'B' ? { ...theme, ...abDraft(db) } : theme);
/** The variant an order counts for: the one its guest saw, else (orders before tagging) a stable hash of the order. */
export const variantOf = (o: { id: string; ab?: 'A' | 'B' }, split: number) => o.ab ?? (bucket(o.id) < split ? 'B' : 'A');

// ── Webhooks & API (studio): which events go to the merchant's endpoint ──────────────────
export const HOOK_EVENTS = ['theme.published', 'menu.updated', 'price.changed', 'order.paid'] as const;
/** The endpoint published in Studios › Webhooks & API, with the events toggled on (Enterprise). */
export function studioHook(db: DB): { url: string; secret: string; events: string[]; since: number } | null {
  const v = toolValue(db, 'hooks', 'enterprise'), ver = toolVersion(db, 'hooks', 'enterprise');
  if (!ver || !/^https:\/\//.test(String(v.url ?? ''))) return null;
  return { url: String(v.url), secret: String(v.secret ?? ''), events: HOOK_EVENTS.filter(e => v[e]), since: ver.at };
}
/** A webhook-out connection pointed at the studio's endpoint takes the studio's event list; others keep their own. */
export const hookWants = (hook: ReturnType<typeof studioHook>, url: unknown, event: string, own: () => boolean) =>
  hook && hook.url === url ? hook.events.includes(event) : own();

// ── Change approvals ─────────────────────────────────────────────────────────────────────
/** 'two' = "Owner + one admin": studio publishes, price changes and local items need a second person besides the owner. */
export const approvalRule = (db: DB) => (toolValue(db, 'approve').rule === 'two' ? 'two' : 'owner') as 'owner' | 'two';
/** WhatsApp the owner when a studio change waits for them (only once the owner switched it on and published). */
export const approvalWa = (db: DB) => toolValue(db, 'approve').notify === true;

// ── Theme per role (staff shells) ────────────────────────────────────────────────────────
const ACCENT: Record<string, [string, string, string]> = {
  ember: ['var(--ember-500)', 'var(--ember-50)', 'var(--ember-700)'], blue: ['var(--info)', 'var(--info-soft)', 'var(--info-fg)'],
  green: ['var(--success)', 'var(--success-soft)', 'var(--success-fg)'], violet: ['var(--violet)', 'var(--violet-soft)', 'var(--violet-fg)'],
};
const HIT: Record<string, string> = { touch: '56px', comfy: '48px', dense: '44px' }; // staff minimum stays 44px
export function roleTheme(db: DB, role: Role): { style: Record<string, string>; dark: boolean } | null {
  const v = toolValue(db, 'roleth', 'pro'), a = ACCENT[v['accent:' + role]], h = HIT[v['density:' + role]];
  if (!a && !h && v['dark:' + role] === undefined) return null;
  return { style: { ...(a ? { '--role': a[0], '--role-soft': a[1], '--role-fg': a[2] } : {}), ...(h ? { '--hit': h } : {}) }, dark: v['dark:' + role] === true };
}

// ── Dashboard widgets per role ───────────────────────────────────────────────────────────
export const WIDGETS_DEFAULT: Record<string, string[]> = { owner: ['w_rev', 'w_reco', 'w_live', 'w_trend', 'w_mix', 'w_top', 'w_stock', 'w_alert'], manager: ['w_rev', 'w_reco', 'w_live', 'w_trend', 'w_stock', 'w_staff', 'w_alert'], pic: ['w_live', 'w_stock', 'w_staff', 'w_alert'], cashier: ['w_live', 'w_top'] };
/** Widgets a role's home dashboard shows, in order (null = not customized: the dashboard shows everything). */
export function widgetsFor(db: DB, role: string): { on: string[]; cols: number } | null {
  const v = toolValue(db, 'widgets'); if (!Object.keys(v).length) return null;
  return { on: (v['on:' + role] as string[] | undefined) ?? WIDGETS_DEFAULT[role] ?? [], cols: Number(v.cols) || 3 };
}

// ── Terminology + industry template ──────────────────────────────────────────────────────
export type Term = 'outlet' | 'table' | 'customer' | 'member' | 'shift' | 'product';
const TERM: Record<Term, string> = { outlet: 'Outlet', table: 'Table', customer: 'Customer', member: 'Member', shift: 'Shift', product: 'Product' };
export const SEAT: Record<string, string> = { fnb: 'Meja', retail: 'Rak', salon: 'Kursi', laundry: 'Rak', court: 'Meja' };
export const industry = (db: DB) => String(toolValue(db, 'industry').pick ?? 'fnb');
/** The merchant's word for a module (Terminology), else the industry template's seat word, else BorNiz's. */
export function term(db: DB, k: Term): string {
  const v = toolValue(db, 'terms'), t = String(v[k] ?? '').trim();
  if (t) return t;
  if (k === 'table' && toolVersion(db, 'industry')) return SEAT[industry(db)] ?? TERM.table;
  return TERM[k];
}
/** Back-office module names follow the terminology once it is published. */
export const moduleLabel = (db: DB, mod: string) => {
  const map: Record<string, Term> = { Outlets: 'outlet', Customers: 'customer', Catalog: 'product' };
  return map[mod] && toolVersion(db, 'terms') ? term(db, map[mod]) : mod;
};
/** Apps a business type doesn't run: no kitchen or table service outside F&B and food courts. */
export const industryHides = (db: DB, surface: string) => ['retail', 'salon', 'laundry'].includes(industry(db)) && (surface === 'kds' || surface === 'waiter');

// ── Legal pages, white-label, letterhead, receipts ───────────────────────────────────────
/** Legal pages linked from guest screens and receipts (null = none published). */
export function legal(db: DB) {
  const v = toolValue(db, 'legal');
  if (!v.co && !v.b_terms) return null;
  return { co: String(v.co ?? db.tenant.name), terms: String(v.b_terms ?? ''), privacy: String(v.b_privacy ?? ''), refund: String(v.b_refund ?? '') };
}
/** White-label (Enterprise): the merchant's own app name, and no "Powered by BorNiz" on guest screens and receipts. */
export function whiteLabel(db: DB): { name: string; sub: string; bundle: string } | null {
  const v = toolValue(db, 'white', 'enterprise');
  return v.name ? { name: String(v.name), sub: String(v.sub ?? ''), bundle: String(v.bundle ?? '') } : null;
}
/** Receipt template for an outlet: overrides apply to the outlet it was made for, or to every outlet when none was picked. */
export function receiptFor(db: DB, outletId: string) {
  const v = toolValue(db, 'rcpt');
  if (!Object.keys(v).length || (v.outlet && v.outlet !== outletId)) return null;
  const own = !v.inherit;
  return { paper: v.paper === '58' || v.paper === '80' ? v.paper as '58' | '80' : undefined, h1: own ? String(v.h1 ?? '') : '', h2: own ? String(v.h2 ?? '') : '', wifi: own ? String(v.wifi ?? '') : '', f1: String(v.f1 ?? '') };
}
export const letterhead = (db: DB) => { const v = toolValue(db, 'letter'); return v.co ? v : null; };
/** Embeds & widgets (Pro): WhatsApp button, reviews, custom head code on menu pages, the iframe widget. */
export const embeds = (db: DB) => { const v = toolValue(db, 'embed', 'pro'); return Object.keys(v).length ? v : null; };
/** Custom menu domain (Enterprise) for QR codes, receipts and shared links. */
export const menuDomain = (db: DB) => String(toolValue(db, 'domain', 'enterprise').menu ?? '').trim();
