'use client';
import { linkTo } from '../system/hosts.ts';
// Menu Studio (spec: BorNiz Menu Studio + Page Builder). Edits the merchant theme and menu presentation that /order,
// /kiosk and /display read live. Owner publishes; manager "Send to owner" (publish() creates the approval).
// Every sitemap page of the surface is one tool of the studio; drafts autosave as versions.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useApp } from '../app/context.tsx';
import { Badge, Empty, Field, Icon, Seg, Sheet, Toggle, ago, dateShort, hhmm, toast } from '../ui/kit.tsx';
import { usePin } from '../ui/PinSheet.tsx';
import { decide } from '../data/actions.ts';
import catalog from '../system/catalog.json' with { type: 'json' };
import { publishVerb } from '../domain/menu.ts';
import {
  COPY_KEYS, HOME_SECTIONS, SCHEDULE, approvalFor, asDesign, cancelSchedule, discardDraft, draftOf, menuDesign, pendingOf, publishedSite, release, runDueSchedules,
  saveDraft, schedule, type Group, type Kind, type MenuDesign, type Site, type Val,
} from '../data/actions/studio.ts';
import { pagesOf } from '../system/registry.ts';
import { Block, ColorRow, ContrastCard, DeviceSeg, DeviceView, Fields, ImageSlot, LockedCard, Opts, StudioFrame, ToggleRow, f, type Device, type F, type ToolGroup } from './studio/Frame.tsx';
import { draftState, stable, useAutosave } from './studio/draft.ts';
import { FONTS, loadFont, menuChecks, onColor, contrast } from './studio/theme.ts';
import { GuestApp, type GuestCtx, type Screen as GScreen, type Viewer } from './studio/guest.tsx';
import { DisplayPreview, KioskPreview, MemberCardPreview, ReceiptPreview, TableCard } from './studio/surfaces.tsx';
import { PROMO_TYPES, PagesPanel, PosPrices, PromosEverywhere, SitePreview, type SiteApi } from './studio/pages.tsx';
import { EXTRAS } from './studio/extras.tsx';
import { OverridesPanel, ProductsPanel } from './studio/catalog.tsx';
import { tableNames } from '../domain/tables.ts';

// slug → [tool key, label, icon, group, panel subtitle]
const T: Record<string, [string, string, string, string, string]> = {
  'menu-studio-brand-and-all-colors': ['brand', 'Brand & colors', 'store', 'Customer app', 'Your name, logo and every color. Themes are optional shortcuts; change anything after picking one, or skip them.'],
  'menu-studio-menu-and-products': ['menu', 'Menu & products', 'utensils', 'Customer app', 'Categories and products, each with its own photo, price and description. Changes show in the preview immediately.'],
  'menu-studio-typography': ['type', 'Typography', 'type', 'Customer app', 'Pick fonts for headings, body and prices, then set the case.'],
  'menu-studio-layout': ['layout', 'Layout', 'layout-template', 'Customer app', 'Landing hero, menu layout, category navigation, product cards, buttons and cart.'],
  'menu-studio-home-sections-order': ['sections', 'Home sections', 'rows-3', 'Customer app', 'Reorder and toggle the blocks on your menu home page.'],
  'menu-studio-brand-media': ['media', 'Brand media', 'image', 'Customer app', 'Cover photos, story photo and background texture. Product photos live in Menu & products; promo banners in Pages.'],
  'menu-studio-copy-and-labels': ['copy', 'Copy & labels', 'languages', 'Customer app', 'Every customer-facing word in your own voice, in English and Bahasa Indonesia.'],
  'menu-studio-receipt-and-e-receipt-design': ['receipt', 'Receipt & e-receipt', 'receipt', 'Screens & print', 'Thermal receipt and WhatsApp / email e-receipt. Legal lines (NPWP, tax) are added automatically.'],
  'menu-studio-customer-display': ['display', 'Customer display', 'monitor', 'Screens & print', 'The screen facing the customer at the counter: idle loop and live cart.'],
  'menu-studio-kiosk-attract-screen': ['kiosk', 'Kiosk attract', 'tablet', 'Screens & print', 'Self-order kiosk attract screen and first step.'],
  'menu-studio-qr-table-stand-sticker-poster': ['qr', 'QR stand & poster', 'qr-code', 'Screens & print', 'Printable table tents, stickers and posters with each table’s own QR code.'],
  'table-qr-generator': ['qrgen', 'Table QR generator', 'scan-qr-code', 'Screens & print', 'One QR per table for the selected outlet. Each opens the QR menu with the table already set.'],
  'menu-studio-member-card-and-tiers': ['member', 'Member card & tiers', 'credit-card', 'Screens & print', 'Loyalty card design, program name, points name and tier names.'],
  'menu-studio-publish-schedule-seasonal-theme': ['publish', 'Publish & schedule', 'send', 'Publish', 'Publish now, schedule a change or run a seasonal theme that reverts on its own.'],
  'menu-studio-per-outlet-overrides': ['overrides', 'Per-outlet overrides', 'store', 'Publish', 'What each outlet may change, and local prices within ±10%.'],
  'menu-studio-version-history-and-restore': ['versions', 'Version history', 'rotate-ccw-clock', 'Publish', 'Every publish is kept. Preview any version and restore it into your draft.'],
  'menu-studio-advanced': ['advanced', 'Advanced', 'code', 'Publish', 'Display options, custom CSS, domain and SEO.'],
  'menu-studio-send-to-owner': ['submit', 'Send to owner', 'user-check', 'Publish', 'Managers send changes to the owner; the owner approves with the approval PIN.'],
  'menu-studio-draft-and-submit-to-owner': ['submit', 'Draft & submit', 'user-check', 'Publish', 'Your draft is saved as you work. Send it to the owner when it’s ready.'],
  'menu-studio-pages-page-list': ['pages', 'Pages', 'files', 'Pages', 'Home, menu, about, location, reservations, gift cards, closed and any page you add.'],
  'menu-studio-pages-section-library': ['library', 'Section library', 'library', 'Pages', 'Hero, text, gallery, products, categories, buttons, hours & map, testimonials, FAQ, promo countdown, spacer.'],
  'menu-studio-pages-section-settings-content-style-visibility': ['section', 'Section settings', 'sliders-horizontal', 'Pages', 'Content, style and visibility for each section.'],
  'menu-studio-pages-visibility-rules': ['rules', 'Visibility rules', 'funnel', 'Pages', 'Show a section to an audience, at a time of day, at one outlet or on one device.'],
  'menu-studio-pages-preview-as': ['previewas', 'Preview as', 'eye', 'Pages', 'See the page as a member, a guest or a new visitor, at any time of day.'],
  'menu-studio-pages-devices': ['devices', 'Devices', 'monitor-smartphone', 'Pages', 'Phone, tablet and desktop. Limit a section to one device.'],
  'menu-studio-pages-draft-and-submit': ['psubmit', 'Pages · submit', 'user-check', 'Pages', 'Your page drafts are saved as you work. Send them to the owner when they’re ready.'],
  'menu-studio-pages-promo-banner': ['banner', 'Promo banner', 'badge-percent', 'Promo blocks', 'Image, split, card or color, with an optional countdown.'],
  'menu-studio-pages-promo-carousel': ['carousel', 'Promo carousel', 'gallery-horizontal', 'Promo blocks', 'Slides with photos, auto-play.'],
  'menu-studio-pages-flash-sale': ['flash', 'Flash sale', 'zap', 'Promo blocks', 'Countdown, sale price and sold bar. Starting it sets flash prices at the POS, QR menu and kiosk.'],
  'menu-studio-pages-promo-tiles': ['tiles', 'Promo tiles', 'layout-dashboard', 'Promo blocks', 'A feature tile and three small ones, or an even grid.'],
  'menu-studio-pages-voucher-strip': ['vouchers', 'Voucher strip', 'ticket-percent', 'Promo blocks', 'Your promotions with a code, ready to claim.'],
  'menu-studio-pages-bundle-combo': ['bundle', 'Bundle / combo', 'package-plus', 'Promo blocks', 'Pick products and a combo price.'],
  'menu-studio-pages-promo-pop-up': ['popup', 'Promo pop-up', 'square-dashed-mouse-pointer', 'Promo blocks', 'Welcome voucher on first visit, every visit or on exit.'],
  'menu-studio-pages-promos-page-template': ['promospage', 'Promos page', 'layout-template', 'Promo blocks', 'One page with every promo block, linked as “Promos”.'],
  'menu-studio-promos-live-on-qr-menu-kiosk-customer-display': ['promoslive', 'Where promos show', 'radio', 'Promo blocks', 'The same promo strip on the QR menu, kiosk and customer display.'],
  'menu-studio-flash-sale-prices-at-pos': ['flashpos', 'Flash prices at POS', 'monitor', 'Promo blocks', 'Flash prices ring automatically at the register while a sale runs.'],
};
const PAGE_KEYS = new Set(['pages', 'library', 'section', 'rules', 'previewas', 'devices', 'psubmit', 'promospage', 'promoslive', 'flashpos', ...PROMO_TYPES]);
const GROUP_ORDER = ['Customer app', 'Screens & print', 'Publish', 'Pages', 'Promo blocks', 'More pages'];
const THEMES = catalog.brandThemes as Record<string, { p: string; acc: string; ink: string; paper: string; font: string; banner: string }>;
const LABELS: Record<string, string> = { name: 'Store name', tagline: 'Tagline', p: 'Primary color', acc: 'Accent color', ink: 'Text color', paper: 'Background', surface: 'Card color', font: 'Heading font', body: 'Body font', priceFont: 'Price font', hcase: 'Heading case', header: 'Header bar', banner: 'Banner', img: 'Banner image', layout: 'Layout', sections: 'Home sections', media: 'Brand media', copy: 'Copy & labels', rc: 'Receipt', dc: 'Customer display', ki: 'Kiosk', qr: 'QR stand', mc: 'Member card', pub: 'Publish & overrides', opts: 'Display options', adv: 'Advanced', x: 'More pages' };

export default function Screen() { const { user } = useApp(); return <Studio key={user.id} />; }

function Studio() {
  const { page, db, user, outletId, setOutlet } = useApp();
  const pin = usePin();
  const owner = user.role === 'owner', online = db.device.online;
  const extra = EXTRAS.find(x => x.key === page.slug);
  const key = extra ? 'x' : T[page.slug]?.[0] ?? 'brand';
  const kind: Kind = PAGE_KEYS.has(key) ? 'page' : 'menu';

  const published = useMemo(() => menuDesign(db), [db]);
  const pubSite = useMemo(() => publishedSite(db), [db]);
  const [d, setD] = useState<MenuDesign>(() => { const v = draftOf(db, 'menu', user.id) ?? (owner ? undefined : pendingOf(db, 'menu', user.id)); return v ? asDesign(db, v.data) : menuDesign(db); });
  const [site, setSite] = useState<Site>(() => (draftOf(db, 'page', user.id) ?? (owner ? undefined : pendingOf(db, 'page', user.id)))?.data as Site ?? publishedSite(db));
  const dirtyMenu = stable(d) !== stable(published), dirtySite = stable(site) !== stable(pubSite);
  useAutosave('menu', d, dirtyMenu, user.id);
  useAutosave('page', site, dirtySite, user.id);
  useEffect(() => { [d.font, d.body].forEach(loadFont); }, [d.font, d.body]);
  useEffect(() => { if (owner && online) { const n = runDueSchedules(user.id); if (n) toast(`${n} scheduled change${n > 1 ? 's' : ''} went live`); } }, [owner, online, db.records, user.id]);

  // preview state
  const [device, setDevice] = useState<Device>('phone'), [screen, setScreen] = useState<GScreen>('landing'), [lang, setLang] = useState<'en' | 'id'>('en');
  const [itemId, setItemId] = useState<string>(), [dcView, setDcView] = useState<'idle' | 'cart'>('cart');
  const [peek, setPeek] = useState<{ label: string; kind: Kind; data: unknown } | null>(null);
  const [confirm, setConfirm] = useState(false), [note, setNote] = useState('');
  // pages state
  const [pageId, setPageId] = useState('home'), [sel, setSel] = useState<string | null>(null);
  const [viewer, setViewer] = useState<Viewer>({ aud: 'member', time: 'all', outlet: outletId, dev: 'phone' });
  const started = useRef(Date.now()).current;

  const shown: MenuDesign = peek?.kind === 'menu' ? asDesign(db, peek.data) : d;
  const ctx: GuestCtx = { d: shown, db, outletId, lang, site: peek?.kind === 'page' ? peek.data as Site : site };
  const api: SiteApi = { site: peek?.kind === 'page' ? peek.data as Site : site, mut: fn => { setPeek(null); setSite(s => { const n = structuredClone(s); fn(n); return n; }); }, pageId, setPageId, sel, setSel, viewer: { ...viewer, dev: device }, setViewer, ctx, owner, by: user.id, started };

  const set = <K extends keyof MenuDesign>(k: K, v: MenuDesign[K]) => { setPeek(null); setD(x => ({ ...x, [k]: v })); };
  const setIn = (g: 'layout' | 'rc' | 'dc' | 'ki' | 'qr' | 'mc' | 'pub' | 'opts' | 'adv') => (k: string, v: Val) => { setPeek(null); setD(x => ({ ...x, [g]: { ...x[g], [k]: v } })); };

  // status (Design Notes states: Draft · Published · Locked by plan · Contrast fail)
  const checks = menuChecks(d), contrastBad = checks.some(c => !c.ok);
  const dirty = kind === 'menu' ? dirtyMenu : dirtySite;
  const { status, blocked, waiting } = draftState(db, kind, user.id, dirty, kind === 'menu' && contrastBad);
  const verb = publishVerb(user.role) + (kind === 'page' ? ' pages' : '');
  const doRelease = () => {
    const live = release(kind, kind === 'menu' ? d : site, user.id, note.trim() || (kind === 'menu' ? 'Menu design update' : 'Pages update'));
    toast(live ? `Published · live on ${db.outlets.length} outlets` : 'Sent to the owner for approval');
    setConfirm(false); setNote('');
  };
  // Ctrl/Cmd+S saves the draft now
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); if (dirtyMenu) saveDraft('menu', d, user.id); if (dirtySite) saveDraft('page', site, user.id); toast('Draft saved'); } };
    addEventListener('keydown', k); return () => removeEventListener('keydown', k);
  }, [d, site, dirtyMenu, dirtySite, user.id]);

  // tools from the registry (every page of the surface is a tool)
  const groups: ToolGroup[] = useMemo(() => {
    const gs: Record<string, ToolGroup['tools']> = {};
    for (const p of pagesOf('menu')) {
      const ex = EXTRAS.find(x => x.key === p.slug), t = T[p.slug];
      if (!ex && !t) continue;
      if (p.role === 'manager' ? owner : !owner && (t?.[0] === 'submit')) continue;
      const g = ex ? 'More pages' : t[3];
      (gs[g] ??= []).push({ key: ex ? 'x:' + ex.key : t[0], label: ex ? ex.label : t[1], icon: ex ? ex.icon : t[2], path: p.path });
    }
    return GROUP_ORDER.filter(g => gs[g]).map(title => ({ title, tools: gs[title] }));
  }, [owner]);
  const current = extra ? 'x:' + extra.key : key;

  // ── settings panels ───────────────────────────────────────────────────────────────
  const D = d as unknown as Group;
  const x = extra ? { ...extra.defaults, ...d.x[extra.key] } : {};
  const setX = (k: string, v: Val) => extra && set('x', { ...d.x, [extra.key]: { ...x, [k]: v } });
  const themeOf = Object.entries(THEMES).find(([, t]) => t.p === d.p && t.paper === d.paper)?.[0] ?? '';
  const locked = db.tenant.plan !== 'enterprise';

  const panels: Record<string, () => ReactNode> = {
    brand: () => <>
      <Block title="Start from a theme · optional" hint="A theme only fills in colors and fonts. Everything stays editable below and in the other tools.">
        <Opts value={themeOf} cols={2} onChange={n => { const t = THEMES[String(n)]; setPeek(null); setD(v => ({ ...v, ...t, img: '' })); }}
          opts={Object.entries(THEMES).map(([n, t]) => [n, n, FONTS[t.font]?.[0], `linear-gradient(90deg,${t.p} 0 55%,${t.paper} 55% 80%,${t.acc} 80%)`, FONTS[t.font]?.[1]])} />
      </Block>
      <Fields g={D} set={(k, v) => set(k as keyof MenuDesign, String(v) as never)} fs={[f.text('name', 'Store name'), f.text('tagline', 'Tagline')]} />
      <Block title="Logo" hint="Shown on the landing page, menu header, order status, receipts and kiosk. SVG or PNG, 512 px or larger."><div style={{ maxWidth: 160 }}><ImageSlot label="Logo" ratio="1/1" maxW={512} value={d.media.logo} onChange={v => set('media', { ...d.media, logo: v })} /></div></Block>
      <Block title="Colors">
        <ColorRow label="Primary" sub="Buttons, links, active tab" value={d.p} onChange={v => set('p', v)} check={{ ratio: contrast(onColor(d.p), d.p), text: 'button label' }} />
        <ColorRow label="Accent" sub="Badges, announcement, stars" value={d.acc} onChange={v => set('acc', v)} />
        <ColorRow label="Page background" sub="Behind everything" value={d.paper} onChange={v => set('paper', v)} check={{ ratio: contrast(d.ink, d.paper), text: 'text on background' }} />
        <ColorRow label="Cards & sheets" sub="Product cards, panels" value={d.surface} onChange={v => set('surface', v)} check={{ ratio: contrast(d.ink, d.surface), text: 'text on cards' }} />
        <ColorRow label="Text" sub="Names, descriptions" value={d.ink} onChange={v => set('ink', v)} />
      </Block>
      <Block title="Header bar"><Opts value={d.header} cols={3} onChange={v => set('header', String(v))} opts={[['surface', 'Card', undefined, d.surface], ['bg', 'Page', undefined, d.paper], ['brand', 'Brand', undefined, d.p]]} /></Block>
      <ToggleRow label="Background texture" sub={d.media.tex ? 'From Brand media' : 'Upload one in Brand media first'} on={!!d.opts.tex} onChange={v => setIn('opts')('tex', v)} />
      <ContrastCard checks={checks} /><LockedCard />
    </>,
    menu: () => <ProductsPanel onPreview={id => { setItemId(id); setScreen('item'); }} />,
    type: () => { const fl = Object.entries(FONTS).filter(([k]) => k !== 'lora'); return <>
      <Block title="Headings"><Opts value={d.font} onChange={v => { loadFont(String(v)); set('font', String(v)); }} opts={fl.map(([k, x]) => [k, x[0], undefined, undefined, x[1]])} /></Block>
      <Block title="Body text"><Opts value={d.body} onChange={v => { loadFont(String(v)); set('body', String(v)); }} opts={fl.filter(([k]) => k !== 'bebas').map(([k, x]) => [k, x[0], undefined, undefined, x[1]])} /></Block>
      <Block title="Prices"><Opts value={d.priceFont} cols={3} onChange={v => set('priceFont', String(v))} opts={[['head', 'Like headings'], ['body', 'Like body'], ['system', 'Plain']]} /></Block>
      <Block title="Heading case"><Opts value={d.hcase} cols={3} onChange={v => set('hcase', String(v))} opts={[['none', 'Aa Normal'], ['uppercase', 'AA Upper'], ['lowercase', 'aa lower']]} /></Block>
      <p className="faint" style={{ fontSize: 12 }}>Merchant fonts apply only on customer screens. Staff tools keep BorNiz type.</p></>; },
    layout: () => <Fields g={d.layout} set={setIn('layout')} fs={[
      f.seg('hero', 'Landing hero', 'cover:Full cover:Photo edge to edge|split:Card + logo:Logo overlaps|minimal:Logo only:Clean, no photo|video:Video loop:MP4 up to 15 s'),
      f.seg('menu', 'Menu layout', 'list:List:Photo left|grid:Grid:2 columns|big:Big photo:Full width|text:Printed menu:No photos'),
      f.seg('cat', 'Category navigation', 'pills:Pills|tabs:Underline|tiles:Photo tiles'), f.seg('ratio', 'Product photo ratio', '1/1:1:1|4/3:4:3|16/9:16:9'),
      f.seg('radius', 'Corners', '0:Square|6:Sharp|16:Soft|24:Round', 4), f.seg('btn', 'Buttons', 'filled:Filled|outline:Outline|pill:Pill'), f.seg('cart', 'Cart', 'bar:Bottom bar|fab:Floating button')]} />,
    sections: () => <div className="stack sm" role="list">{d.sections.map((s, i) => { const info = HOME_SECTIONS.find(h => h[0] === s.k)!;
      const mv = (j: number) => { const a = d.sections.slice(); [a[i], a[j]] = [a[j], a[i]]; set('sections', a); };
      return <div key={s.k} role="listitem" className="row" style={{ padding: '6px 8px', borderRadius: 12, border: '1px solid var(--border)', opacity: s.on ? 1 : .55 }}>
        <b className="num faint" style={{ width: 20 }}>{i + 1}</b><span className="grow stack" style={{ gap: 0 }}><b style={{ fontSize: 14 }}>{info[1]}</b><span className="faint" style={{ fontSize: 12 }}>{info[2]}</span></span>
        <button className="btn btn-ghost btn-sm" aria-label="Move up" disabled={i === 0} onClick={() => mv(i - 1)}><Icon name="arrow-up" size={14} /></button>
        <button className="btn btn-ghost btn-sm" aria-label="Move down" disabled={i === d.sections.length - 1} onClick={() => mv(i + 1)}><Icon name="arrow-down" size={14} /></button>
        <Toggle on={s.on} label={'Show ' + info[1]} onChange={v => set('sections', d.sections.map((y, j) => j === i ? { ...y, on: v } : y))} />
      </div>; })}</div>,
    media: () => <>
      <Block title="Cover photos" hint="Cover 1 is the landing hero. Covers 2–3 feed the Instagram grid and the customer display idle loop. 1920×1080 JPG.">
        <div className="grid" style={{ ['--min' as string]: '120px', gap: 8 }}>{d.media.covers.map((u, i) => <ImageSlot key={i} label={'Cover ' + (i + 1)} value={u} onChange={v => set('media', { ...d.media, covers: d.media.covers.map((c, j) => j === i ? v : c) })} />)}</div></Block>
      <Block title="Story photo"><ImageSlot label="Story photo" ratio="4/3" value={d.media.about} onChange={v => set('media', { ...d.media, about: v })} /></Block>
      <Block title="Background texture" hint="Seamless PNG. Turn it on in Brand & colors; it tiles behind every page at 400 px."><ImageSlot label="Texture" ratio="1/1" maxW={600} value={d.media.tex} onChange={v => set('media', { ...d.media, tex: v })} /></Block>
    </>,
    copy: () => <>
      <Block title="Preview language"><Seg value={lang} onChange={setLang} options={[['en', 'English'], ['id', 'Bahasa Indonesia']]} /></Block>
      {COPY_KEYS.map(([k, label]) => { const v = d.copy[k] ?? { en: '', id: '' }, long = v.id.length > v.en.length * 1.4;
        return <Block key={k} title={label} hint={long ? 'Indonesian is over 40% longer. Check that buttons still fit.' : undefined}>
          {(['en', 'id'] as const).map(l => <div key={l} className="row"><Badge>{l.toUpperCase()}</Badge><input className="input" aria-label={`${label} ${l === 'en' ? 'English' : 'Indonesian'}`} value={v[l]} onChange={e => set('copy', { ...d.copy, [k]: { ...v, [l]: e.target.value } })} /></div>)}
        </Block>; })}
    </>,
    receipt: () => <><Fields g={d.rc} set={setIn('rc')} fs={[f.seg('paper', 'Paper', '58:58 mm:32 columns|80:80 mm:48 columns'), f.seg('qr', 'QR code links to', 'feedback:Feedback|menu:Reorder|member:Join member'), f.seg('ch', 'E-receipt via', 'wa:WhatsApp|email:Email|both:Both'),
      f.text('h1', 'Header line'), f.text('f1', 'Footer line 1'), f.text('f2', 'Footer line 2'), f.text('wifi', 'Wi-Fi · password'), f.text('thanks', 'E-receipt greeting'),
      f.tog('logo', 'Print logo', 'Mono, dithered for thermal'), f.tog('points', 'Show points earned', 'Members only'), f.tog('social', 'Show Instagram', 'From Copy & labels'), f.tog('wifiOn', 'Print Wi-Fi', 'Dine-in only')]} />
      <LockedCard items={['NPWP line from Business profile', 'Tax (PB1) and service lines', 'Payment method marks', 'Order number and date']} /></>,
    display: () => <Fields g={d.dc} set={setIn('dc')} fs={[f.seg('idle', 'Idle screen', 'slides:Photo slideshow|promo:Promo banners|video:Video loop|brand:Brand color'), f.seg('cart', 'Cart layout', 'right:Total on right|bottom:Total at bottom'), f.seg('bg', 'Background', 'dark:Dark|brand:Brand|light:Light'),
      f.text('idleHead', 'Idle headline'), f.text('welcome', 'Idle subtext'), f.tog('points', 'Show member points', 'When a member is attached'), f.tog('promo', 'Announcement under the cart', 'From Copy & labels'), f.tog('qris', 'Show QRIS on the display', 'Customer scans here')]} />,
    kiosk: () => <Fields g={d.ki} set={setIn('ki')} fs={[f.seg('bg', 'Attract background', 'brand:Brand color|photo:Cover photo|split:Photo + color'), f.seg('step', 'First step', 'ask:Ask dine-in / takeaway|skip:Takeaway only'), f.text('head', 'Headline'), f.text('cta', 'Start button'), f.range('timeout', 'Reset after', 20, 180, 10, ' s idle'), f.tog('lang', 'Language switch', 'On the attract screen')]} />,
    qr: () => <><Fields g={d.qr} set={setIn('qr')} fs={qrFields(tableNames(db.outlets.find(o => o.id === outletId)).length)} />
      <button className="btn btn-primary" onClick={() => print()}><Icon name="printer" size={16} />Print or save PDF</button></>,
    qrgen: () => <><Block title="Outlet"><div className="row wrap">{db.outlets.map(o => <button key={o.id} className="chip" aria-pressed={o.id === outletId} onClick={() => setOutlet(o.id)}>{o.name} · {tableNames(o).length}</button>)}</div></Block>
      <Fields g={d.qr} set={setIn('qr')} fs={[f.num('from', 'From table'), f.num('to', 'To table', `${tableNames(db.outlets.find(o => o.id === outletId)).length} tables, in floor plan order · 0 = all`), f.seg('layout', 'Format', 'tent:Table tent|sticker:Round sticker|poster:A5 poster'), f.seg('color', 'Color', 'brand:Brand|light:Light|dark:Dark')]} />
      <p className="faint" style={{ fontSize: 12 }}>Each code opens /order with its table and outlet set. Reprint only if you renumber tables.</p>
      <button className="btn btn-primary" onClick={() => print()}><Icon name="printer" size={16} />Print {tableRange(d, db.outlets.find(o => o.id === outletId)).length} codes</button></>,
    member: () => <Fields g={d.mc} set={setIn('mc')} fs={[f.seg('style', 'Card style', 'brand:Brand gradient|dark:Dark|photo:Cover photo'), f.text('prog', 'Program name'), f.text('pts', 'Points name'), f.text('t0', 'Tier 1 name'), f.text('t1', 'Tier 2 name'), f.text('t2', 'Tier 3 name'),
      f.tog('barcode', 'Show member code', 'Scannable at the POS'), f.tog('progress', 'Show tier progress'), f.note('Tier thresholds and earn rate are set in Loyalty and stay the same here.')]} />,
    publish: () => publishPanel(),
    overrides: () => <OverridesPanel g={d.pub} set={setIn('pub')} />,
    versions: () => versionsPanel(),
    advanced: () => <>
      <Fields g={d.opts} set={setIn('opts')} fs={[f.tog('prices', 'Show prices incl. tax', 'PB1-inclusive prices'), f.tog('desc', 'Show descriptions'), f.tog('sold', 'Show sold-out items', 'Greyed out instead of hidden'), f.tog('lang', 'Language switch', 'EN / ID on the landing page'),
        f.tog('powered', 'Show “Powered by BorNiz”', db.tenant.plan === 'free' || db.tenant.plan === 'basic' ? 'Removable on Pro and up' : 'Removable on your plan', db.tenant.plan === 'free' || db.tenant.plan === 'basic' ? 'Locked by plan' : undefined)]} />
      <Block title="Custom CSS" right={locked ? <Badge><Icon name="lock" size={12} />Locked by plan · Enterprise</Badge> : undefined} hint="Scoped to .bn-menu. Status colors, payment marks and legal lines ignore custom CSS.">
        <textarea className="input mono" disabled={locked} value={String(d.adv.css)} onChange={e => setIn('adv')('css', e.target.value)} aria-label="Custom CSS" placeholder=".bn-menu h1 { letter-spacing: .02em; }" /></Block>
      <Fields g={d.adv} set={setIn('adv')} fs={[f.text('seoTitle', 'SEO title'), f.area('seoDesc', 'SEO description')]} />
    </>,
    submit: () => submitPanel(owner ? ['menu', 'page'] : ['menu']),
    psubmit: () => submitPanel(['page']),
    x: () => extra ? <><Fields g={x} set={setX} fs={extra.fields(ctx, x)} />{extra.extra?.(x, setX, ctx)}{extra.device === 'print' && <button className="btn btn-primary" onClick={() => print()}><Icon name="printer" size={16} />Print or save PDF</button>}</> : null,
  };

  // ── larger panels (plain render functions, so inputs keep focus) ─────────────────────
  function publishPanel() {
    const p = d.pub, rows = (db.records[SCHEDULE] ?? []).filter(r => r.d === 'scheduled');
    const when = String(p.when), at = Date.parse(String(when === 'season' ? p.from : p.at)), to = Date.parse(String(p.to));
    const ok = when === 'now' || (at > Date.now() && (when !== 'season' || to > at));
    const go = () => {
      if (when === 'now') return setConfirm(true);
      schedule('menu', d, at, user.id, when === 'season' ? `${p.season} theme` : 'Scheduled menu update');
      if (when === 'season') schedule('menu', published, to, user.id, `End of ${p.season} · back to current theme`);
      discardDraft('menu', user.id); setD(published); toast(when === 'season' ? `${p.season} theme scheduled, reverts on its own` : 'Change scheduled');
    };
    return <>
      <Fields g={p} set={setIn('pub')} disabled={!owner} fs={[f.seg('when', 'When', 'now:Now|schedule:Schedule|season:Seasonal', 3, !owner ? 'Only the owner schedules. Send your draft to the owner instead.' : when === 'now' ? `Goes live on all ${db.outlets.length} outlets as soon as you publish.` : undefined),
        ...(when === 'schedule' ? [f.date('at', 'Go live at')] : when === 'season' ? [f.text('season', 'Season name'), f.date('from', 'Starts'), f.date('to', 'Ends · reverts to the current theme')] : [])]} />
      {owner ? <button className="btn btn-primary" disabled={!!blocked || !ok} onClick={go}>
        <Icon name={when === 'now' ? 'send' : 'calendar-clock'} size={16} />{when === 'now' ? 'Publish now' : when === 'season' ? 'Schedule season' : 'Schedule'}</button>
        : <button className="btn btn-primary" disabled={!!blocked} onClick={() => setConfirm(true)}><Icon name="send" size={16} />Send to owner</button>}
      {kind === 'menu' && contrastBad && <ContrastCard checks={checks} />}
      <Block title="Scheduled">{rows.length ? rows.map(r => <div key={r.id} className="st-row"><Icon name="calendar-clock" size={16} /><span className="grow stack" style={{ gap: 0 }}><b style={{ fontSize: 14 }}>{r.b}</b><span className="faint" style={{ fontSize: 12 }}>{dateShort(+r.c)} · {hhmm(+r.c)}</span></span>
        {owner && <button className="btn btn-ghost btn-sm" onClick={() => cancelSchedule(r.id, user.id)}>Cancel</button>}</div>) : <p className="faint" style={{ fontSize: 13 }}>Nothing scheduled.</p>}</Block>
    </>;
  }
  function versionsPanel() {
    const vs = db.versions.filter(v => v.status !== 'draft');
    if (!vs.length) return <Empty icon="rotate-ccw-clock" title="No versions yet">Your first publish becomes version 1. Drafts save as you work.</Empty>;
    return <div className="stack sm">{vs.map((v, i) => { const ap = approvalFor(db, v.id), st = v.status === 'pending_owner' ? (ap?.status === 'rejected' ? 'rejected' : 'waiting') : 'published';
      return <div key={v.id} className="card tight stack sm" style={{ borderColor: peek?.data === v.data ? 'var(--role)' : undefined }}>
        <div className="row between"><b style={{ fontSize: 14 }}>v{vs.length - i} · {v.kind === 'page' ? 'Pages' : v.kind === 'brand' ? 'Staff brand' : 'Menu'}</b><Badge tone={st === 'published' ? 'success' : st === 'waiting' ? 'warning' : 'danger'} dot>{st === 'waiting' ? 'Waiting for owner' : st === 'rejected' ? 'Rejected' : 'Published'}</Badge></div>
        <span className="muted" style={{ fontSize: 13 }}>{v.note} · {db.employees.find(e => e.id === v.by)?.name ?? v.by} · {ago(v.at)}</span>
        {v.kind !== 'brand' && <div className="row"><button className="btn btn-sm" onClick={() => setPeek({ label: `v${vs.length - i}`, kind: v.kind, data: v.data })}><Icon name="eye" size={14} />Preview</button>
          <button className="btn btn-sm" onClick={() => { if (v.kind === 'menu') setD(asDesign(db, v.data)); else setSite(structuredClone(v.data as Site)); setPeek(null); toast('Restored into your draft. Publish to make it live.'); }}><Icon name="rotate-ccw" size={14} />Restore</button></div>}
      </div>; })}</div>;
  }
  function submitPanel(kinds: Kind[]) {
    const queue = db.approvals.filter(a => a.type === 'publish' && a.status === 'waiting');
    const changed = (k: Kind) => k === 'menu' ? Object.keys(LABELS).filter(f2 => stable((d as unknown as Group)[f2]) !== stable((published as unknown as Group)[f2])).map(f2 => LABELS[f2])
      : site.filter(p => stable(p) !== stable(pubSite.find(q => q.id === p.id))).map(p => p.name + ' page');
    const decideIt = (id: string, title: string, verdict: 'approved' | 'rejected') => pin.ask({ title, verb: verdict === 'approved' ? 'Approve and publish' : 'Reject', onOk: by => { const e = decide(id, by, verdict); toast(e ?? (verdict === 'approved' ? 'Approved · now live' : 'Rejected · the manager can edit and resend')); } });
    return <>
      {owner && <Block title={`Waiting for you · ${queue.length}`}>{queue.length ? queue.map(a => { const v = db.versions.find(x => x.id === a.subjectId);
        return <div key={a.id} className="card tight stack sm"><b style={{ fontSize: 14 }}>{a.title}</b><span className="muted" style={{ fontSize: 13 }}>{db.employees.find(e => e.id === a.requestedBy)?.name} · {ago(a.at)}</span>
          <div className="row wrap">{v && v.kind !== 'brand' && <button className="btn btn-sm" onClick={() => setPeek({ label: 'request', kind: v.kind, data: v.data })}><Icon name="eye" size={14} />Preview</button>}
            <button className="btn btn-sm" onClick={() => decideIt(a.id, a.title, 'rejected')}>Reject</button><button className="btn btn-sm btn-success" onClick={() => decideIt(a.id, a.title, 'approved')}>Approve</button></div></div>; })
        : <p className="faint" style={{ fontSize: 13 }}>No changes waiting. Manager requests appear here and in Notifications.</p>}</Block>}
      {kinds.map(k => { const ch = changed(k), mine = db.versions.filter(v => v.kind === k && v.by === user.id && v.status !== 'draft').slice(0, 4);
        return <Block key={k} title={(k === 'menu' ? 'Your menu draft' : 'Your page drafts') + ` · ${ch.length} change${ch.length === 1 ? '' : 's'}`}>
          {ch.length ? <div className="row wrap">{ch.map(c => <Badge key={c}>{c}</Badge>)}</div> : <p className="faint" style={{ fontSize: 13 }}>No changes since the last publish.</p>}
          {k === 'menu' && <ContrastCard checks={checks} />}
          <div className="row wrap">
            <button className="btn btn-primary" disabled={!online || !ch.length || (k === 'menu' && contrastBad)} onClick={() => { const live = release(k, k === 'menu' ? d : site, user.id, k === 'menu' ? 'Menu design update' : 'Pages update'); toast(live ? 'Published' : 'Sent to the owner for approval'); }}>{publishVerb(user.role)}</button>
            {ch.length > 0 && <button className="btn" onClick={() => { discardDraft(k, user.id); if (k === 'menu') setD(published); else setSite(pubSite); toast('Draft discarded'); }}>Discard draft</button>}
          </div>
          {mine.map(v => { const ap = approvalFor(db, v.id); return <div key={v.id} className="row between" style={{ fontSize: 13 }}><span>{v.note} · {ago(v.at)}</span><Badge tone={v.status === 'published' ? 'success' : ap?.status === 'rejected' ? 'danger' : 'warning'} dot>{v.status === 'published' ? 'Published' : ap?.status === 'rejected' ? 'Rejected' + (ap.decisionNote ? ': ' + ap.decisionNote : '') : 'Waiting for owner'}</Badge></div>; })}
        </Block>; })}
    </>;
  }

  // ── previews ─────────────────────────────────────────────────────────────────────
  const outlet = db.outlets.find(o => o.id === outletId)!;
  const phone = (only?: Device[]) => ({
    bar: <><DeviceSeg value={device} onChange={setDevice} only={only} /><Seg value={screen} onChange={s => { setItemId(undefined); setScreen(s); }} label="Screen" options={[['landing', 'Landing'], ['menu', 'Menu'], ['item', 'Item'], ['cart', 'Cart'], ['status', 'Status']]} /><Seg value={lang} onChange={setLang} label="Language" options={[['en', 'EN'], ['id', 'ID']]} /></>,
    body: <DeviceView device={device} label="QR menu preview"><GuestApp key={stable(ctx.d.sections) + device} ctx={ctx} screen={screen} setScreen={setScreen} itemId={itemId} /></DeviceView>,
  });
  let preview: { bar?: ReactNode; body: ReactNode };
  if (kind === 'page' && key === 'promoslive') preview = { body: <PromosEverywhere a={api} /> };
  else if (kind === 'page' && key === 'flashpos') preview = { body: <PosPrices a={api} /> };
  else if (kind === 'page') preview = { bar: <><DeviceSeg value={device} onChange={setDevice} /><span className="faint" style={{ fontSize: 12 }}>{key === 'previewas' ? `As ${viewer.aud} · ${viewer.time === 'all' ? 'now' : viewer.time}` : 'Click a section to select it'}</span></>, body: <DeviceView device={device} label="Page preview"><SitePreview a={api} device={device} focus={key === 'previewas' || key === 'rules'} /></DeviceView> };
  else if (key === 'receipt') preview = { body: <ReceiptPreview ctx={ctx} /> };
  else if (key === 'display') preview = { bar: <Seg value={dcView} onChange={setDcView} label="Display state" options={[['idle', 'Idle'], ['cart', 'Live cart']]} />, body: <DeviceView device="desktop" height={675} label="Customer display preview"><DisplayPreview ctx={ctx} view={dcView} /></DeviceView> };
  else if (key === 'kiosk') preview = { body: <DeviceView device="tablet" label="Kiosk preview"><KioskPreview ctx={ctx} /></DeviceView> };
  else if (key === 'qr' || key === 'qrgen') { const tables = tableRange(d, outlet), list = key === 'qr' ? tables.slice(0, 3) : tables;
    preview = { bar: <span style={{ fontSize: 13 }}>{outlet.name} · tables {tables[0] ?? '—'}–{tables[tables.length - 1] ?? '—'}</span>, body: tables.length ? <div className="row wrap" style={{ justifyContent: 'center', gap: 16 }}>{list.map(t => <TableCard key={t} d={shown} table={t} outletId={outletId} wifi={String(d.rc.wifi)} />)}</div> : <Empty icon="qr-code" title="No tables in range">This outlet has {tableNames(outlet).length} tables. Set From and To within that.</Empty> }; }
  else if (key === 'member') preview = { body: <MemberCardPreview ctx={ctx} /> };
  else if (extra) preview = extra.device === 'print' ? { body: <div style={{ overflow: 'auto', maxWidth: '100%' }}>{extra.preview(x, ctx)}</div> }
    : { bar: <DeviceSeg value={extra.device === 'desktop' ? 'desktop' : device} onChange={setDevice} only={extra.device === 'desktop' ? ['desktop'] : undefined} />, body: <DeviceView device={extra.device === 'desktop' ? 'desktop' : device} height={extra.device === 'desktop' ? 675 : undefined}>{extra.preview(x, ctx)}</DeviceView> };
  else { const p = phone(); preview = { bar: p.bar, body: p.body }; }

  const title = extra ? extra.label : T[page.slug]?.[1] ?? page.title;
  const sub = extra ? 'Customer page · publishes with the menu' : T[page.slug]?.[4];
  return <>
    {pin.sheet}
    {!online && <div className="banner" style={{ background: 'var(--warning-soft)', color: 'var(--warning-fg)', marginBottom: 12 }}><Icon name="wifi-off" size={18} />Offline. Your draft is kept on this device; publishing waits until you are back online.</div>}
    <StudioFrame title="Menu studio" sub={<span className="mono">{linkTo('/order').replace(/^https?:\/\//, '')}</span>} groups={groups} current={current} status={status}
      panelTitle={title} panelSub={sub} panel={PAGE_KEYS.has(key) && key !== 'psubmit' ? <PagesPanel view={key} a={api} /> : (panels[key] ?? panels.brand)()}
      actions={<button className="btn btn-primary" disabled={!!blocked} title={blocked || undefined} onClick={() => setConfirm(true)}><Icon name="send" size={16} />{waiting ? 'Waiting for owner' : verb}</button>}
      previewBar={<>{preview.bar}{peek && <span className="row" style={{ marginLeft: 'auto' }}><Badge tone="info">Previewing {peek.label}</Badge><button className="btn btn-sm btn-ghost" style={{ color: 'inherit' }} onClick={() => setPeek(null)}>Back to draft</button></span>}</>}
      preview={preview.body} />
    <Sheet open={confirm} onClose={() => setConfirm(false)} side="center" title={owner ? `${verb}?` : 'Send to owner?'} sub={owner ? `Live on ${db.outlets.length} outlets: QR menu, kiosk, customer display${kind === 'menu' ? ', receipts' : ''}.` : 'The owner approves with their approval PIN. You can keep editing meanwhile.'}
      footer={<><button className="btn" onClick={() => setConfirm(false)}>Keep editing</button><button className="btn btn-primary" disabled={!!blocked} onClick={doRelease}>{verb}</button></>}>
      <div className="stack">
        {kind === 'menu' && <ContrastCard checks={checks} />}
        <Field label="What changed" optional><input className="input" value={note} onChange={e => setNote(e.target.value)} placeholder={kind === 'menu' ? 'e.g. Ramadan colors, new hero photo' : 'e.g. Payday promos page'} /></Field>
      </div>
    </Sheet>
  </>;
}

const qrFields = (tables: number): F[] => [f.seg('layout', 'Format', 'tent:Table tent|sticker:Round sticker|poster:A5 poster'), f.seg('color', 'Color', 'brand:Brand|light:Light|dark:Dark'), f.text('head', 'Headline'), f.text('sub', 'Instructions'),
  f.num('from', 'From table'), f.num('to', 'To table', `${tables} tables, in floor plan order · 0 = all`), f.tog('logo', 'Show logo'), f.tog('wifi', 'Show Wi-Fi', 'From Receipt'), f.tog('qris', 'Show “QRIS accepted”')];
/** Tables From…To (1-based, in floor plan order) for the QR codes. */
const tableRange = (d: MenuDesign, o: Parameters<typeof tableNames>[0]) => { const all = tableNames(o), max = all.length, a = Math.max(1, Number(d.qr.from) || 1), b = Math.min(max, Number(d.qr.to) || max), out: string[] = []; for (let i = a; i <= b; i++) out.push(all[i - 1]); return out; };
