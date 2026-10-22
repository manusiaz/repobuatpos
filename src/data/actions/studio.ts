'use client';
// Menu Studio, Page Builder and Brand Studio data. The merchant theme lives in db.theme (guest screens read it live);
// the richer studio design is published through publish() into the same object, so one approval path covers both.
// Drafts are versions with status 'draft' (one per kind and author); published/pending versions come from publish().
import { commit, snapshot, uid } from '../store.ts';
import { publish } from '../actions.ts';
import type { DB, Product, Theme, Version } from '../schema.ts';
import type { Promo } from '../../domain/promo.ts';

export type Val = string | number | boolean;
export type Group = Record<string, Val>;
export type Bilingual = { en: string; id: string };

/** Everything Menu Studio edits. Theme keys (name p acc ink paper font banner img) stay at the top so db.theme keeps working. */
export interface MenuDesign extends Theme {
  tagline: string; surface: string; body: string; priceFont: string; hcase: string; header: string;
  layout: Group; sections: { k: string; on: boolean }[];
  media: { logo: string; covers: string[]; about: string; tex: string };
  copy: Record<string, Bilingual>;
  rc: Group; dc: Group; ki: Group; qr: Group; mc: Group; pub: Group; opts: Group; adv: Group;
  /** Extra customer pages (closed page, gift card, menu board …), keyed by tool. */
  x: Record<string, Group>;
}

export const HOME_SECTIONS: [string, string, string][] = [
  ['announce', 'Announcement bar', 'One line in the accent color'], ['promo', 'Promos (from Pages)', 'Banners, carousel, flash sale and combos'],
  ['best', 'Best sellers', 'Top 4 by sales, automatic'], ['menu', 'Full menu', 'Categories and products'], ['about', 'Our story', 'Photo and paragraph'],
  ['hours', 'Hours & location', 'From your outlet settings'], ['social', 'Instagram', 'Handle and 3 photos'], ['reviews', 'Reviews', 'Rating from BorNiz feedback'],
];
export const COPY_KEYS: [string, string, Bilingual][] = [
  ['welcome', 'Welcome message', { en: 'Order from your table, we bring it to you. Pay by QRIS or at the cashier.', id: 'Pesan dari mejamu, kami antar. Bayar pakai QRIS atau di kasir.' }],
  ['ctaMenu', 'Landing button', { en: 'See the menu', id: 'Lihat menu' }],
  ['announce', 'Announcement', { en: '', id: '' }],
  ['bestTitle', 'Best sellers title', { en: 'Most loved', id: 'Paling disukai' }],
  ['addLabel', 'Add button', { en: 'Add to order', id: 'Tambah ke pesanan' }],
  ['ctaCart', 'Cart button', { en: 'View cart', id: 'Lihat keranjang' }],
  ['ctaOrder', 'Order button', { en: 'Place order', id: 'Pesan sekarang' }],
  ['aboutTitle', 'Story title', { en: 'Our story', id: 'Cerita kami' }],
  ['about', 'Story text', { en: '', id: '' }],
  ['hoursTitle', 'Hours title', { en: 'Visit us', id: 'Kunjungi kami' }],
  ['insta', 'Instagram', { en: '', id: '' }],
];

/** What every business starts from: nothing in it belongs to one business (the demo's own words are in seed.ts), and
 *  the sections that need the owner's words (announcement, story, Instagram) stay off until they are written. */
export function defaultDesign(theme: Theme): MenuDesign {
  return {
    ...theme, tagline: '', surface: '#FFFFFF', body: theme.font === 'serif' ? 'lora' : 'jakarta', priceFont: 'head', hcase: 'none', header: 'surface',
    layout: { hero: 'cover', menu: 'grid', cat: 'pills', ratio: '1/1', radius: 16, btn: 'filled', cart: 'bar' },
    sections: HOME_SECTIONS.map(([k]) => ({ k, on: !['reviews', 'announce', 'about', 'social'].includes(k) })),
    media: { logo: '', covers: ['', '', ''], about: '', tex: '' },
    copy: Object.fromEntries(COPY_KEYS.map(([k, , v]) => [k, v])),
    rc: { paper: '80', qr: 'feedback', ch: 'wa', h1: '', f1: 'Terima kasih sudah mampir!', f2: '', wifi: '', thanks: 'Thanks for visiting!', logo: true, points: true, social: true, wifiOn: false },
    dc: { idle: 'slides', cart: 'right', bg: 'dark', idleHead: 'Welcome to ' + theme.name, welcome: 'Your order will appear here.', points: true, promo: true, qris: true },
    ki: { bg: 'split', step: 'ask', head: 'Order here, skip the line', cta: 'Tap to start', timeout: 60, lang: true },
    qr: { layout: 'tent', color: 'brand', head: 'Scan to order', sub: 'No app needed. Pay with QRIS or at the cashier.', from: 1, to: 0, // to 0 = every table on the floor plan
    wifi: true, logo: true, qris: true },
    mc: { style: 'brand', prog: theme.name + ' Rewards', pts: 'beans', t0: 'Silver', t1: 'Gold', t2: 'Platinum', barcode: true, progress: true },
    pub: { when: 'now', at: '', from: '', to: '', season: 'Ramadan' },
    opts: { prices: true, desc: true, sold: true, lang: true, powered: true, tex: false },
    adv: { css: '', seoTitle: theme.name + ' · Order online', seoDesc: 'Order ahead or dine in.' },
    x: {},
  };
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
/** Deep-merge saved data over defaults so older versions always have every key. */
function merge<T>(base: T, over: unknown): T {
  if (!isObj(base) || !isObj(over)) return (over === undefined ? base : over) as T;
  const out: Record<string, unknown> = { ...base };
  for (const k of Object.keys(over)) out[k] = isObj((base as Record<string, unknown>)[k]) ? merge((base as Record<string, unknown>)[k], over[k]) : over[k];
  return out as T;
}
/** The live (published) menu design that /order, /kiosk and /display read. */
export const menuDesign = (db: DB): MenuDesign => merge(defaultDesign({ ...db.theme }), db.theme);
/** Any saved design (draft, version, schedule) completed with defaults. */
export const asDesign = (db: DB, data: unknown): MenuDesign => merge(menuDesign(db), data);

// ── Versions & drafts ─────────────────────────────────────────────────────────────────
export type Kind = Version['kind'];
export const draftOf = (db: DB, kind: Kind, by: string) => db.versions.find(v => v.kind === kind && v.status === 'draft' && v.by === by);
export const pendingOf = (db: DB, kind: Kind, by: string) => db.versions.find(v => v.kind === kind && v.status === 'pending_owner' && v.by === by);
export const approvalFor = (db: DB, versionId: string) => db.approvals.find(a => a.type === 'publish' && a.subjectId === versionId);
export const latestPublished = (db: DB, kind: Kind) => db.versions.find(v => v.kind === kind && v.status === 'published');

export function saveDraft(kind: Kind, data: unknown, by: string, note = 'Draft') {
  commit('studio.draft_saved', by, d => {
    const v = d.versions.find(x => x.kind === kind && x.status === 'draft' && x.by === by);
    if (v) { v.data = data; v.at = Date.now(); v.note = note; } else d.versions.unshift({ id: uid('v'), kind, by, at: Date.now(), status: 'draft', data, note });
  }, kind);
}
export function discardDraft(kind: Kind, by: string) {
  commit('studio.draft_discarded', by, d => { d.versions = d.versions.filter(x => !(x.kind === kind && x.status === 'draft' && x.by === by)); }, kind);
}
/** Publish (owner) or send to owner (manager), then drop the author's draft. Returns true when live. */
export function release(kind: Kind, data: unknown, by: string, note: string) {
  const live = publish(kind, data, by, note);
  if (draftOf(snapshot(), kind, by)) discardDraft(kind, by);
  return live;
}

// Scheduled and seasonal releases: records['studio_schedule'] a=kind b=note c=goLive ms d=status e=JSON data.
// The owner's open studio applies due rows (server cron in production).
export const SCHEDULE = 'studio_schedule';
export function schedule(kind: Kind, data: unknown, at: number, by: string, note: string) {
  commit('studio.scheduled', by, d => { (d.records[SCHEDULE] ??= []).unshift({ id: uid('sc'), a: kind, b: note, c: String(at), d: 'scheduled', e: JSON.stringify(data), at: Date.now() }); }, note);
}
export function cancelSchedule(id: string, by: string) {
  commit('studio.schedule_cancelled', by, d => { const r = d.records[SCHEDULE]?.find(x => x.id === id); if (r) r.d = 'cancelled'; }, id);
}
export function runDueSchedules(by: string, now = Date.now()) {
  const due = (snapshot().records[SCHEDULE] ?? []).filter(r => r.d === 'scheduled' && +r.c <= now);
  for (const r of due) {
    publish(r.a as Kind, JSON.parse(r.e), by, r.b);
    commit('studio.schedule_live', by, d => { const x = d.records[SCHEDULE]?.find(y => y.id === r.id); if (x) x.d = 'live'; }, r.b);
  }
  return due.length;
}

// ── Catalog helpers the studio needs beyond saveProduct / requestPrice / toggle86 ────────────
export type StudioProduct = Product & { photo?: string };
export function patchProduct(id: string, patch: Partial<StudioProduct>, by: string) {
  commit('product.updated', by, d => { const p = d.products.find(x => x.id === id); if (p) Object.assign(p, patch); }, id);
}
export function setHidden(outletId: string, productId: string, hidden: boolean, by: string) {
  commit(hidden ? 'product.hidden' : 'product.shown', by, d => { const x = d.outletProducts.find(y => y.productId === productId && y.outletId === outletId); if (x) x.hidden = hidden; }, productId, outletId);
}
export function addCategory(name: string, by: string) {
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  commit('category.created', by, d => { if (!d.categories.some(c => c.id === id)) d.categories.push({ id, name, station: 'bar' }); }, name);
  return id;
}

// ── Pages (Page Builder) ──────────────────────────────────────────────────────────────
export interface Slide { title: string; sub: string; img: string; badge: string }
export interface Vis { aud: string; time: string; outlet: string; dev: string; dates: string }
export interface Section { id: string; type: string; hidden: boolean; props: Group; items: Slide[]; vis: Vis; style: Group }
export interface SitePage { id: string; name: string; slug: string; icon: string; nav: boolean; sched: string; seo: string; sections: Section[] }
export type Site = SitePage[];

export const SECTION_LIB: Record<string, [label: string, icon: string, props: Group, promo?: boolean]> = {
  hero: ['Hero', 'image', { title: 'Kopi Biru, Senayan', sub: 'Single-origin coffee and fresh pastry, brewed since 2019.', cta: 'Order now', align: 'left', height: 'tall', overlay: 45, img: '' }],
  text: ['Text', 'type', { title: 'Our story', body: 'We roast in small batches every Monday and deliver to all three outlets by Tuesday morning.', align: 'left' }],
  gallery: ['Gallery', 'images', { cols: 3, count: 6 }],
  products: ['Products', 'layout-grid', { title: 'Best sellers', cols: 2, card: 'photo', count: 4, cat: 'best' }],
  cats: ['Categories', 'tags', { style: 'pill' }],
  buttons: ['Buttons', 'mouse-pointer-click', { b1: 'Order now', b2: 'Reserve a table', b3: 'WhatsApp us', align: 'center' }],
  hours: ['Hours & map', 'map-pin', { title: 'Visit us', map: true }],
  reviews: ['Testimonials', 'star', { title: 'What guests say', min: 4 }],
  faq: ['FAQ', 'circle-question-mark', { title: 'Questions', q1: 'Do you take reservations?', a1: 'Yes, up to 12 guests. Book from the Reservations page.', q2: 'Is there Wi-Fi?', a2: 'Free Wi-Fi at every outlet. Password is on your receipt.', q3: 'Can I pay with QRIS?', a3: 'Yes, any bank or e-wallet.' }],
  countdown: ['Promo countdown', 'timer', { title: 'Payday ends in', endsIn: 300, cta: 'See promos' }],
  spacer: ['Spacer', 'move-vertical', { h: 32, line: false }],
  announce: ['Announcement', 'megaphone', { text: 'Payday week: 20% off all coffee until Sunday' }],
  banner: ['Promo banner', 'badge-percent', { title: 'Buy 2, get 1 free', sub: 'Every Friday, 15:00 – 18:00', cta: 'See promo', badge: 'Fri only', layout: 'image', img: '', overlay: 45, align: 'left', countdown: false, endsIn: 180 }, true],
  carousel: ['Promo carousel', 'gallery-horizontal', { ratio: '16/9', auto: true, every: 5 }, true],
  flash: ['Flash sale', 'zap', { title: 'Flash sale', endsIn: 120, disc: 30, products: 'p1,p7,p4,p8', quota: 40, stock: true, style: 'bold' }, true],
  tiles: ['Promo tiles', 'layout-dashboard', { title: 'This week', layout: 'feature' }, true],
  vouchers: ['Voucher strip', 'ticket-percent', { title: 'Claim your vouchers', member: false }, true],
  bundle: ['Bundle / combo', 'package-plus', { title: 'Breakfast combo', products: 'p3,p7,p12', price: 49000, cta: 'Add combo', img: '' }, true],
  popup: ['Promo pop-up', 'square-dashed-mouse-pointer', { title: 'Welcome! 15% off', sub: 'For your first order today', code: 'HALO15', cta: 'Use voucher', when: 'first', delay: 3, img: '' }, true],
  member: ['Member sign-up', 'gift', { title: 'Join Biru Rewards', sub: 'Earn 1 bean for every IDR 1,000.', cta: 'Join free' }],
  links: ['Link list', 'link', { title: 'Find us everywhere', l1: 'Order online', l2: 'Reserve a table', l3: 'Instagram', l4: 'GoFood' }],
};
const SLIDES: Record<string, Slide[]> = {
  carousel: [{ img: '', title: 'Payday week · 20% off coffee', sub: 'Until Sunday · all outlets', badge: '−20%' }, { img: '', title: 'New: Pandan Latte', sub: '+50 beans this week', badge: 'NEW' }, { img: '', title: 'Free croissant on 2 lattes', sub: 'Weekdays 07:00–10:00', badge: 'Morning' }],
  tiles: [{ img: '', title: 'Weekend brunch', sub: 'Sat–Sun 08:00–12:00', badge: 'New' }, { img: '', title: 'Student 15%', sub: 'Show your student card', badge: '' }, { img: '', title: 'Office catering', sub: 'Order 1 day ahead', badge: '' }, { img: '', title: 'Gift cards', sub: 'From IDR 100k', badge: '' }],
};
export const ALL_VIS: Vis = { aud: 'all', time: 'all', outlet: 'all', dev: 'all', dates: '' };
export function newSection(type: string, props: Group = {}, id = uid('s')): Section {
  return { id, type, hidden: false, props: { ...SECTION_LIB[type][2], ...props }, items: structuredClone(SLIDES[type] ?? []), vis: { ...ALL_VIS }, style: { bg: 'page', pad: 'm' } };
}
const pg = (id: string, name: string, slug: string, icon: string, nav: boolean, types: (string | [string, Group])[], sched = 'always'): SitePage =>
  ({ id, name, slug, icon, nav, sched, seo: name, sections: types.map((t, i) => (Array.isArray(t) ? newSection(t[0], t[1], `${id}-${i}`) : newSection(t, {}, `${id}-${i}`))) });
export const promosTemplate = () => ['carousel', 'flash', 'vouchers', 'tiles', 'bundle', ['banner', { layout: 'split', title: 'Bring a friend, both get 10%', sub: 'Share your code from the member app', badge: 'Referral', cta: 'Get my code' }], 'popup'] as (string | [string, Group])[];
/** Deterministic ids, so the default site always equals itself (no phantom draft before the first publish). */
export function defaultSite(): Site {
  return [
    pg('home', 'Home', '/', 'home', true, ['announce', 'hero', 'cats', 'products', ['banner', { countdown: true }], 'reviews', 'member', 'hours']),
    pg('menu', 'Menu', '/menu', 'utensils', true, ['cats', ['products', { title: 'Coffee', cat: 'coffee', count: 6 }], ['products', { title: 'Pastry', cat: 'pastry', card: 'list' }]]),
    pg('about', 'About', '/about', 'info', true, [['hero', { title: 'From bean to cup', height: 'short', cta: '' }], 'text', 'gallery']),
    pg('location', 'Location', '/location', 'map-pin', true, ['hours', 'faq']),
    pg('reservations', 'Reservations', '/reservations', 'calendar', true, [['hero', { title: 'Book a table', height: 'short', cta: 'Reserve' }], ['buttons', { b1: 'Reserve a table', b2: '', b3: '' }]]),
    pg('giftcards', 'Gift cards', '/gift', 'gift', false, [['hero', { title: 'Give the gift of coffee', height: 'short', cta: 'Buy a gift card' }], 'text']),
    pg('promo', 'Promos', '/promo', 'badge-percent', true, promosTemplate()),
    pg('closed', 'Closed', '/closed', 'moon', false, [['text', { title: 'We are closed right now', body: 'We open again at 07:00. Pre-order now and pick up when we open.', align: 'center' }], 'hours']),
  ];
}
export const publishedSite = (db: DB): Site => (latestPublished(db, 'page')?.data as Site | undefined) ?? defaultSite();

// ── Flash sales → db.promos kind 'flash' (POS, QR menu, kiosk and display price from these) ──────────
export type FlashPromo = Promo & { startsAt?: number; sectionId?: string };
export const flashPriceOf = (base: number, disc: number) => Math.round((base * (1 - disc / 100)) / 100) * 100;
export function startFlash(sectionId: string, title: string, productIds: string[], disc: number, minutes: number, quota: number, by: string) {
  const d0 = snapshot(), now = Date.now();
  commit('promo.flash_started', by, d => {
    d.promos = d.promos.filter(p => (p as FlashPromo).sectionId !== sectionId);
    // one flash price per product: a new sale replaces any running one on the same items
    d.promos.forEach(p => { if (p.kind === 'flash' && (p.endsAt ?? 0) > now && p.productIds?.some(id => productIds.includes(id))) p.endsAt = now - 1; });
    for (const id of productIds) {
      const p = d0.products.find(x => x.id === id); if (!p) continue;
      const row: FlashPromo = { id: uid('fl'), name: `${title} · ${p.name}`, kind: 'flash', value: flashPriceOf(p.basePrice, disc), productIds: [id], endsAt: now + minutes * 60e3, quota: quota > 0 ? quota : undefined, used: 0, startsAt: now, sectionId };
      d.promos.push(row);
    }
  }, title);
}
export function endFlash(promoIds: string[], by: string) {
  commit('promo.flash_ended', by, d => { d.promos.forEach(p => { if (promoIds.includes(p.id)) p.endsAt = Date.now() - 1; }); }, promoIds.join(','));
}
/** Units sold at the flash price since the sale started (from real orders). */
export function flashSold(db: DB, p: FlashPromo) {
  const from = p.startsAt ?? (p.endsAt ?? 0) - 24 * 3600e3;
  return db.orders.filter(o => o.createdAt >= from && !['voided', 'held'].includes(o.status))
    .reduce((a, o) => a + o.lines.filter(l => p.productIds?.includes(l.productId) && l.flashPrice != null).reduce((s, l) => s + l.qty, 0), 0);
}

// ── Staff brand (Brand Studio) ─────────────────────────────────────────────────────────
export interface StaffBrand {
  accent: string; logo: string; workspace: string; density: 'compact' | 'comfy';
  c: { primary: string; sidebar: string; bg: string; surface: string; text: string; kpi: string; loginTint: string };
  logoMono: string; loginImg: string; loginTitle: string; font: string; radius: number; side: string; posHead: string; kdsLine: boolean; powered: boolean;
}
export function staffBrand(db: DB): StaffBrand {
  const sb = db.staffBrand;
  return merge<StaffBrand>({
    ...sb, c: { primary: sb.accent, sidebar: '#FFFFFF', bg: '#FAFAFA', surface: '#FFFFFF', text: '#0F172A', kpi: sb.accent, loginTint: '#0F172A' },
    logoMono: '', loginImg: '', loginTitle: 'Good morning, team.', font: 'space', radius: 16, side: 'light', posHead: 'light', kdsLine: true, powered: true,
  }, sb);
}
