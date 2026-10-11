'use client';
// Guest-side preview pieces for Menu Studio: the QR menu app (landing → menu → item → cart → status) and every
// Page Builder section. Everything renders from the live store (products, prices, 86, flash promos, reviews, outlets).
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import type { DB, Product } from '../../data/schema.ts';
import { priceAt, sellable } from '../../data/actions.ts';
import { flashPrice } from '../../domain/promo.ts';
import { orderTotals } from '../../domain/order.ts';
import { idr } from '../../domain/money.ts';
import { Icon, useNow } from '../../ui/kit.tsx';
import { HOME_SECTIONS, SECTION_LIB, flashPriceOf, flashSold, type MenuDesign, type Section, type Site, type StudioProduct } from '../../data/actions/studio.ts';
import { loadFont, themeVars } from './theme.ts';

export interface GuestCtx { d: MenuDesign; db: DB; outletId: string; lang: 'en' | 'id'; site?: Site }
const OVER = 'color-mix(in srgb,var(--ink-950) 55%,transparent)';
const WHITE = 'var(--ink-0)';

/** Theme root for any guest preview: merchant vars + merchant fonts, only inside [data-guest]. */
export function Guest({ d, children, style, dark }: { d: MenuDesign; children: ReactNode; style?: CSSProperties; dark?: boolean }) {
  useEffect(() => { [d.font, d.body].forEach(loadFont); }, [d.font, d.body]);
  return <div data-guest style={{ ...themeVars(d), background: dark ? 'var(--bn-ink)' : 'var(--bn-paper)', color: dark ? 'var(--bn-paper)' : 'var(--bn-ink)', fontFamily: 'var(--bn-body)', minHeight: '100%', fontSize: 15, lineHeight: 1.45, position: 'relative', ...style }}>{children}</div>;
}
export const gh = (d: MenuDesign): CSSProperties => ({ fontFamily: 'var(--bn-font)', textTransform: d.hcase as CSSProperties['textTransform'], letterSpacing: d.hcase === 'uppercase' ? '.04em' : '-.01em', fontWeight: d.font === 'bebas' ? 400 : 700, margin: 0 });
export function GBtn({ d, children, onClick, ghost, style }: { d: MenuDesign; children: ReactNode; onClick?: () => void; ghost?: boolean; style?: CSSProperties }) {
  const pill = d.layout.btn === 'pill', out = ghost || d.layout.btn === 'outline';
  return <button type="button" onClick={onClick} style={{ height: 48, padding: '0 18px', border: out ? '2px solid var(--bn-p-text)' : 0, borderRadius: pill ? 999 : 'var(--bn-r-sm)', background: out ? 'transparent' : 'var(--bn-p)', color: out ? 'var(--bn-p-text)' : 'var(--bn-on-p)', font: '700 15px var(--bn-body)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, ...style }}>{children}</button>;
}
export const photoOf = (p: Product) => (p as StudioProduct).photo ? `url(${(p as StudioProduct).photo}) center/cover no-repeat` : `linear-gradient(135deg,hsl(${p.hue} 55% 74%),hsl(${p.hue} 42% 46%))`;
export const Tag = ({ children, tone = 'acc' }: { children: ReactNode; tone?: 'acc' | 'sold' | 'flash' }) =>
  <span style={{ height: 22, padding: '0 8px', borderRadius: 999, font: '700 11px/22px var(--bn-body)', display: 'inline-block', whiteSpace: 'nowrap', background: tone === 'acc' ? 'var(--bn-acc)' : tone === 'flash' ? 'var(--danger)' : 'var(--bn-soft)', color: tone === 'acc' ? 'var(--bn-on-acc)' : tone === 'flash' ? WHITE : 'var(--bn-ink)' }}>{children}</span>;

export interface GProduct { p: Product; price: number; flash: number | null; sold: boolean }
export function guestProducts(db: DB, outletId: string): GProduct[] {
  const ok = sellable(db, outletId);
  return db.products.filter(p => p.status === 'live').flatMap(p => {
    const op = db.outletProducts.find(x => x.productId === p.id && x.outletId === outletId);
    return op && !op.hidden ? [{ p, price: priceAt(db, p, outletId), flash: flashPrice(db.promos, p.id), sold: !ok(p.id) }] : [];
  });
}
export function bestSellers(db: DB, outletId: string, n = 4) {
  const qty: Record<string, number> = {};
  db.orders.forEach(o => { if (o.outletId === outletId && o.status !== 'voided') o.lines.forEach(l => { qty[l.productId] = (qty[l.productId] ?? 0) + l.qty; }); });
  return guestProducts(db, outletId).sort((a, b) => (qty[b.p.id] ?? 0) - (qty[a.p.id] ?? 0)).slice(0, n);
}
const Price = ({ g }: { g: GProduct }) => g.flash != null && g.flash < g.price
  ? <span className="row" style={{ gap: 6 }}><b style={{ fontFamily: 'var(--bn-price)', color: 'var(--danger)' }}>{idr(g.flash)}</b><s style={{ fontSize: 12, opacity: .6 }}>{idr(g.price)}</s></span>
  : <b style={{ fontFamily: 'var(--bn-price)' }}>{idr(g.price)}</b>;

/** Promo cards as the QR menu, kiosk and customer display show them (spec/bn-promos.js), from pages + live flash promos. */
export interface PromoCard { t: string; s: string; img: string; tag: string; flash?: boolean }
export function promoCards(site: Site | undefined, db: DB, now = Date.now()): PromoCard[] {
  const out: PromoCard[] = [];
  const live = db.promos.filter(p => p.kind === 'flash' && (p.endsAt ?? 0) > now);
  if (live.length) { const left = Math.max(0, Math.min(...live.map(p => p.endsAt!)) - now); out.push({ t: 'Flash sale · ' + live.length + ' items', s: `Ends in ${Math.floor(left / 3600e3)}h ${Math.floor(left / 60e3) % 60}m`, img: '', tag: 'FLASH SALE', flash: true }); }
  (site ?? []).forEach(pg => pg.sections.forEach(s => {
    if (s.hidden) return; const q = s.props;
    if (s.type === 'banner') out.push({ t: String(q.title), s: String(q.sub), img: String(q.img), tag: String(q.badge || 'Promo') });
    if (s.type === 'carousel') s.items.forEach(x => out.push({ t: x.title, s: x.sub, img: x.img, tag: x.badge }));
    if (s.type === 'bundle') out.push({ t: String(q.title), s: idr(Number(q.price)), img: String(q.img), tag: 'Combo' });
  }));
  return out.slice(0, 8);
}
export function PromoCardView({ c, big }: { c: PromoCard; big?: boolean }) {
  return <div style={{ flex: 'none', width: big ? '46%' : '78%', aspectRatio: '16/9', borderRadius: 'var(--bn-r)', position: 'relative', overflow: 'hidden', background: c.img ? `url(${c.img}) center/cover` : c.flash ? 'linear-gradient(135deg,var(--danger),var(--accent))' : 'linear-gradient(135deg,var(--bn-p),var(--bn-ink))' }}>
    <span style={{ position: 'absolute', inset: 0, background: `linear-gradient(180deg,transparent 35%,${OVER})` }} />
    {c.tag && <span style={{ position: 'absolute', top: 10, left: 10 }}><Tag tone={c.flash ? 'flash' : 'acc'}>{c.tag}</Tag></span>}
    <span style={{ position: 'absolute', left: 12, right: 12, bottom: 10, color: WHITE, display: 'flex', flexDirection: 'column' }}><b style={{ font: `800 ${big ? 20 : 16}px/1.15 var(--bn-font)` }}>{c.t}</b><span style={{ fontSize: 12, opacity: .9 }}>{c.s}</span></span>
  </div>;
}

// ── QR menu app (phone) ─────────────────────────────────────────────────────────────
export type Screen = 'landing' | 'menu' | 'item' | 'cart' | 'status';
export function GuestApp({ ctx, screen, setScreen, table = 7, itemId }: { ctx: GuestCtx; screen: Screen; setScreen: (s: Screen) => void; table?: number; itemId?: string }) {
  const { d, db, outletId, lang } = ctx;
  const c = (k: string) => d.copy[k]?.[lang] || d.copy[k]?.en || '';
  const all = useMemo(() => guestProducts(db, outletId), [db, outletId]);
  const list = d.opts.sold ? all : all.filter(g => !g.sold);
  const outlet = db.outlets.find(o => o.id === outletId)!;
  const [cat, setCat] = useState('all'), [picked, setItem] = useState<GProduct | null>(null), [qty, setQty] = useState(1);
  useEffect(() => { setItem(null); }, [itemId]);
  const item = picked ?? all.find(g => g.p.id === itemId) ?? all[0] ?? null;
  const [cart, setCart] = useState<{ g: GProduct; q: number }[]>(() => all.slice(0, 2).map((g, i) => ({ g, q: 2 - i })));
  const [step, setStep] = useState(1);
  useEffect(() => { if (screen !== 'status') return; setStep(1); const t = setInterval(() => setStep(s => Math.min(4, s + 1)), 2500); return () => clearInterval(t); }, [screen]);
  const cats = db.categories.filter(k => list.some(g => g.p.categoryId === k.id));
  const shown = list.filter(g => cat === 'all' || g.p.categoryId === cat);
  const R = d.layout;
  const open = (g: GProduct) => { if (g.sold) return; setItem(g); setQty(1); setScreen('item'); };
  const totals = orderTotals(cart.map(l => ({ unitPrice: l.g.price, flashPrice: l.g.flash, qty: l.q })), outlet);
  const headBg = d.header === 'brand' ? 'var(--bn-p)' : d.header === 'bg' ? 'var(--bn-paper)' : 'var(--bn-surface)', headFg = d.header === 'brand' ? 'var(--bn-on-p)' : 'var(--bn-ink)';
  const initials = d.name.split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
  const Logo = ({ s = 64 }: { s?: number }) => <span style={{ width: s, height: s, borderRadius: 'var(--bn-r)', background: d.media.logo ? `var(--bn-surface) url(${d.media.logo}) center/70% no-repeat` : 'var(--bn-surface)', boxShadow: '0 0 0 1px var(--bn-line)', display: 'grid', placeItems: 'center', font: '800 22px var(--bn-font)', color: 'var(--bn-p-text)', flex: 'none' }}>{!d.media.logo && initials}</span>;
  const bg = d.opts.tex && d.media.tex ? { background: `var(--bn-paper) url(${d.media.tex}) center/400px repeat` } : undefined;
  const Card = ({ g }: { g: GProduct }) => {
    const L = R.menu, row = L === 'list' || L === 'text';
    return <button type="button" onClick={() => open(g)} aria-disabled={g.sold} style={{ display: 'flex', flexDirection: row ? 'row' : 'column', gap: 10, padding: L === 'text' ? '10px 0' : L === 'big' ? 0 : 8, background: L === 'text' ? 'transparent' : 'var(--bn-surface)', border: 0, borderBottom: L === 'text' ? '1px dashed var(--bn-line)' : 0, boxShadow: L === 'text' ? 'none' : '0 0 0 1px var(--bn-line)', borderRadius: L === 'text' ? 0 : 'var(--bn-r)', textAlign: 'left', color: 'inherit', font: 'inherit', cursor: g.sold ? 'default' : 'pointer', opacity: g.sold ? .5 : 1, overflow: 'hidden', width: '100%' }}>
      {L !== 'text' && <span style={{ width: row ? 88 : '100%', flex: 'none', aspectRatio: L === 'big' ? '16/9' : String(R.ratio), background: photoOf(g.p), borderRadius: L === 'big' ? 0 : 'var(--bn-r-sm)', position: 'relative' }}>
        {(g.sold || g.flash != null) && <span style={{ position: 'absolute', top: 6, left: 6 }}><Tag tone={g.sold ? 'sold' : 'flash'}>{g.sold ? 'Sold out' : 'Flash'}</Tag></span>}</span>}
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: L === 'big' ? '0 12px 12px' : 0, minWidth: 0, flex: 1 }}>
        <span style={{ fontWeight: 700, fontSize: L === 'big' ? 18 : 14, fontFamily: L === 'text' ? 'var(--bn-font)' : undefined }}>{g.p.name}</span>
        {d.opts.desc && g.p.desc && <span style={{ fontSize: 12, opacity: .7, fontStyle: L === 'text' ? 'italic' : undefined }}>{g.p.desc}</span>}
        <Price g={g} />
      </span>
    </button>;
  };
  const Cats = () => <div style={{ display: 'flex', gap: R.cat === 'tabs' ? 18 : 8, overflowX: 'auto', padding: '10px 16px', borderBottom: R.cat === 'tabs' ? '1px solid var(--bn-line)' : 0 }}>
    {[{ id: 'all', name: 'All' }, ...cats].map(k => { const a = cat === k.id, firstP = list.find(g => g.p.categoryId === k.id);
      return <button key={k.id} type="button" onClick={() => setCat(k.id)} style={{ flex: 'none', height: R.cat === 'tiles' ? 92 : 40, width: R.cat === 'tiles' ? 76 : undefined, padding: R.cat === 'pills' ? '0 16px' : R.cat === 'tiles' ? 4 : 0, border: R.cat === 'tiles' ? `2px solid ${a ? 'var(--bn-p)' : 'transparent'}` : 0, borderBottom: R.cat === 'tabs' ? `3px solid ${a ? 'var(--bn-p)' : 'transparent'}` : undefined, borderRadius: R.cat === 'pills' ? 999 : 'var(--bn-r-sm)', background: R.cat === 'pills' ? (a ? 'var(--bn-p)' : 'var(--bn-soft)') : 'transparent', color: R.cat === 'pills' && a ? 'var(--bn-on-p)' : a ? 'var(--bn-p-text)' : 'inherit', font: '700 13px var(--bn-body)', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
        {R.cat === 'tiles' && <span style={{ width: 60, height: 52, borderRadius: 'var(--bn-r-sm)', background: firstP ? photoOf(firstP.p) : 'var(--bn-soft)' }} />}{k.name}</button>; })}
  </div>;
  const Grid = ({ items }: { items: GProduct[] }) => <div style={{ display: 'grid', gridTemplateColumns: R.menu === 'grid' ? '1fr 1fr' : '1fr', gap: R.menu === 'text' ? 0 : 10, padding: '0 16px' }}>{items.map(g => <Card key={g.p.id} g={g} />)}</div>;
  const Top = ({ back }: { back?: Screen }) => <div style={{ display: 'flex', alignItems: 'center', gap: 10, height: 56, padding: '0 12px', background: headBg, color: headFg, position: 'sticky', top: 0, zIndex: 3, boxShadow: '0 1px 0 var(--bn-line)' }}>
    {back ? <button type="button" aria-label="Back" onClick={() => setScreen(back)} style={{ width: 40, height: 40, border: 0, background: 'transparent', color: 'inherit', cursor: 'pointer' }}><Icon name="arrow-left" /></button> : <Logo s={36} />}
    <b style={{ ...gh(d), fontSize: 17, flex: 1 }}>{d.name}</b><span style={{ fontSize: 12, opacity: .75 }}>Table {table}</span></div>;

  if (screen === 'item' && item) return <Guest d={d}><Top back="menu" />
    <div style={{ aspectRatio: R.ratio === '16/9' ? '4/3' : String(R.ratio), background: photoOf(item.p) }} />
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <h2 style={{ ...gh(d), fontSize: 24 }}>{item.p.name}</h2>{item.p.desc && <p style={{ opacity: .75 }}>{item.p.desc}</p>}<Price g={item} />
      {item.p.modifierGroupIds.slice(0, 2).map(id => db.modifierGroups.find(m => m.id === id)).filter(Boolean).map(m => <div key={m!.id}>
        <b style={{ fontSize: 14 }}>{m!.name} <span style={{ fontWeight: 400, opacity: .6 }}>{m!.required ? '· Required' : '· Optional'}</span></b>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>{m!.options.map((o, i) => <span key={o.id} style={{ padding: '8px 12px', borderRadius: 'var(--bn-r-sm)', border: `1.5px solid ${i === 0 ? 'var(--bn-p)' : 'var(--bn-line)'}`, fontSize: 13 }}>{o.name}{o.price ? ' +' + o.price / 1000 + 'k' : ''}</span>)}</div></div>)}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <GBtn d={d} ghost onClick={() => setQty(Math.max(1, qty - 1))} style={{ width: 48, padding: 0 }}>−</GBtn><b style={{ minWidth: 24, textAlign: 'center' }}>{qty}</b><GBtn d={d} ghost onClick={() => setQty(qty + 1)} style={{ width: 48, padding: 0 }}>+</GBtn>
        <GBtn d={d} style={{ flex: 1 }} onClick={() => { setCart(cs => [...cs, { g: item, q: qty }]); setScreen('menu'); }}>{c('addLabel')} · {idr((item.flash ?? item.price) * qty)}</GBtn>
      </div>
    </div></Guest>;

  if (screen === 'cart') return <Guest d={d}><Top back="menu" />
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <h2 style={{ ...gh(d), fontSize: 22 }}>Your order</h2>
      {cart.length === 0 && <p style={{ opacity: .7 }}>Your cart is empty.</p>}
      {cart.map((l, i) => <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'center' }}><span style={{ width: 48, height: 48, borderRadius: 'var(--bn-r-sm)', background: photoOf(l.g.p), flex: 'none' }} /><span style={{ flex: 1 }}>{l.q}× {l.g.p.name}</span><b>{idr((l.g.flash ?? l.g.price) * l.q)}</b></div>)}
      <div style={{ borderTop: '1px solid var(--bn-line)', paddingTop: 10, display: 'grid', gridTemplateColumns: '1fr auto', gap: 4, fontSize: 14 }}>
        <span>Subtotal</span><span>{idr(totals.subtotal)}</span>{totals.service > 0 && <><span>Service</span><span>{idr(totals.service)}</span></>}<span>Tax (PB1){outlet.taxInclusive ? ' incl.' : ''}</span><span>{idr(totals.tax)}</span><b>Total</b><b>{idr(totals.total)}</b>
      </div>
      {['QRIS · any bank or e-wallet', 'Pay at the cashier'].map((p, i) => <div key={p} style={{ padding: 12, borderRadius: 'var(--bn-r-sm)', border: `1.5px solid ${i === 0 ? 'var(--bn-p)' : 'var(--bn-line)'}`, fontSize: 14 }}>{p}</div>)}
      <GBtn d={d} onClick={() => { setCart([]); setScreen('status'); }}>{c('ctaOrder')}</GBtn>
    </div></Guest>;

  if (screen === 'status') return <Guest d={d}><Top />
    <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h2 style={{ ...gh(d), fontSize: 24 }}>{['', 'The kitchen has your order.', 'Your order is being prepared.', `Ready! We are bringing it to Table ${table}.`, 'Enjoy!'][step]}</h2>
      {['Order received', 'Preparing', 'Ready', 'Served'].map((s, i) => <div key={s} style={{ display: 'flex', gap: 12, alignItems: 'center', opacity: i < step ? 1 : .45 }}>
        <span style={{ width: 28, height: 28, borderRadius: 99, background: i < step ? 'var(--bn-p)' : 'var(--bn-soft)', color: 'var(--bn-on-p)', display: 'grid', placeItems: 'center' }}>{i < step && <Icon name="check" size={16} />}</span><b style={{ fontWeight: i === step - 1 ? 800 : 500 }}>{s}</b></div>)}
      <GBtn d={d} ghost onClick={() => setScreen('landing')}>Back to start</GBtn>
    </div></Guest>;

  const cartBar = screen === 'menu' && cart.length > 0 && <button type="button" onClick={() => setScreen('cart')} style={{ position: 'sticky', bottom: 12, margin: '12px 16px 0', marginLeft: R.cart === 'fab' ? 'auto' : 16, display: 'flex', alignItems: 'center', justifyContent: R.cart === 'fab' ? 'center' : 'space-between', gap: 10, height: R.cart === 'fab' ? 60 : 56, width: R.cart === 'fab' ? 60 : 'calc(100% - 32px)', padding: R.cart === 'fab' ? 0 : '0 18px', border: 0, borderRadius: R.cart === 'fab' || R.btn === 'pill' ? 999 : 'var(--bn-r)', background: 'var(--bn-p)', color: 'var(--bn-on-p)', font: '700 15px var(--bn-body)', boxShadow: 'var(--shadow-e2)', cursor: 'pointer' }}>
    <Icon name="shopping-bag" />{R.cart !== 'fab' && <><span style={{ flex: 1, textAlign: 'left' }}>{c('ctaCart')} · {cart.reduce((a, l) => a + l.q, 0)}</span><span>{idr(totals.total)}</span></>}</button>;

  if (screen === 'menu') return <Guest d={d} style={bg}><Top back="landing" /><Cats />
    <h2 style={{ ...gh(d), fontSize: 20, padding: '8px 16px', textAlign: R.menu === 'text' ? 'center' : 'left' }}>{cat === 'all' ? 'Menu' : cats.find(k => k.id === cat)?.name}</h2>
    {shown.length ? <Grid items={shown} /> : <p style={{ padding: 16, opacity: .7 }}>Nothing here yet.</p>}{cartBar}<div style={{ height: 24 }} /></Guest>;

  // landing + home sections
  const hero = String(R.hero);
  const cover = d.media.covers[0] ? `url(${d.media.covers[0]}) center/cover` : 'var(--bn-banner)';
  const cards = promoCards(ctx.site, db);
  const best = bestSellers(db, outletId);
  const reviews = db.reviews.filter(r => r.outletId === outletId);
  const avg = reviews.length ? reviews.reduce((a, r) => a + r.stars, 0) / reviews.length : 0;
  const block: Record<string, ReactNode> = {
    announce: <div style={{ background: 'var(--bn-acc)', color: 'var(--bn-on-acc)', padding: '10px 16px', fontWeight: 700, fontSize: 13 }}>{c('announce')}</div>,
    promo: cards.length > 0 && <div style={{ display: 'flex', gap: 10, overflowX: 'auto', padding: '0 16px' }}>{cards.map((x, i) => <PromoCardView key={i} c={x} />)}</div>,
    best: <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}><h3 style={{ ...gh(d), fontSize: 18, padding: '0 16px' }}>{c('bestTitle')}</h3>
      <div style={{ display: 'flex', gap: 10, overflowX: 'auto', padding: '0 16px' }}>{best.map((g, i) => <button key={g.p.id} type="button" onClick={() => open(g)} style={{ flex: 'none', width: 130, border: 0, background: 'transparent', padding: 0, textAlign: 'left', color: 'inherit', font: 'inherit', cursor: 'pointer' }}>
        <span style={{ display: 'block', aspectRatio: '1/1', borderRadius: 'var(--bn-r-sm)', background: photoOf(g.p), position: 'relative' }}><span style={{ position: 'absolute', top: 6, left: 6 }}><Tag>#{i + 1}</Tag></span></span><b style={{ fontSize: 13 }}>{g.p.name}</b><br /><Price g={g} /></button>)}</div></div>,
    menu: <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}><Cats /><Grid items={shown.slice(0, 6)} /></div>,
    about: <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 8 }}><span style={{ aspectRatio: '16/9', borderRadius: 'var(--bn-r)', background: d.media.about ? `url(${d.media.about}) center/cover` : 'var(--bn-banner)' }} /><h3 style={{ ...gh(d), fontSize: 18 }}>{c('aboutTitle')}</h3><p style={{ fontSize: 14, opacity: .8 }}>{c('about')}</p></div>,
    hours: <div style={{ margin: '0 16px', padding: 14, borderRadius: 'var(--bn-r)', background: 'var(--bn-surface)', boxShadow: '0 0 0 1px var(--bn-line)' }}><h3 style={{ ...gh(d), fontSize: 17 }}>{c('hoursTitle')}</h3><p style={{ fontSize: 14 }}>{outlet.name} · {outlet.city}</p><p style={{ fontSize: 14, opacity: .75 }}>Open daily {outlet.opens}–{outlet.closes}</p></div>,
    social: <div style={{ padding: '0 16px' }}><b>{c('insta')}</b><div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 6, marginTop: 6 }}>{[0, 1, 2].map(i => <span key={i} style={{ aspectRatio: '1/1', borderRadius: 'var(--bn-r-sm)', background: d.media.covers[i] ? `url(${d.media.covers[i]}) center/cover` : best[i] ? photoOf(best[i].p) : 'var(--bn-soft)' }} />)}</div></div>,
    reviews: reviews.length > 0 && <div style={{ padding: '0 16px' }}><b>{avg.toFixed(1)} / 5 · {reviews.length} reviews</b>{reviews.filter(r => r.stars >= 4).slice(0, 2).map(r => <p key={r.id} style={{ fontSize: 14, opacity: .8, marginTop: 4 }}>“{r.text}” · {r.name}</p>)}</div>,
  };
  return <Guest d={d} style={bg}>
    {hero !== 'minimal' && <div style={{ height: hero === 'split' ? 200 : 300, margin: hero === 'split' ? '40px 14px 0' : 0, borderRadius: hero === 'split' ? 'var(--bn-r)' : 0, background: cover, position: 'relative', overflow: 'hidden' }}>
      {hero !== 'split' && <span style={{ position: 'absolute', inset: 0, background: `linear-gradient(180deg,transparent 30%,${OVER})` }} />}
      {hero === 'video' && <span style={{ position: 'absolute', top: 12, right: 12 }}><Tag>Video loop</Tag></span>}
      {hero !== 'split' && <div style={{ position: 'absolute', left: 16, right: 16, bottom: 16, color: WHITE }}><h1 style={{ ...gh(d), fontSize: d.font === 'bebas' ? 44 : 32 }}>{d.name}</h1><p style={{ opacity: .9 }}>{d.tagline}</p></div>}
    </div>}
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 10, padding: '16px 20px', marginTop: hero === 'split' ? -56 : hero === 'minimal' ? 48 : 0 }}>
      {hero !== 'cover' && hero !== 'video' && <><Logo s={88} /><h1 style={{ ...gh(d), fontSize: 30 }}>{d.name}</h1><p style={{ opacity: .75 }}>{d.tagline}</p></>}
      <Tag tone="sold">Table {table} · Dine-in</Tag>
      <p style={{ fontSize: 14, opacity: .85 }}>{c('welcome')}</p>
      <GBtn d={d} onClick={() => setScreen('menu')} style={{ width: '100%' }}>{c('ctaMenu')}</GBtn>
      {d.opts.lang && <span style={{ fontSize: 12, opacity: .7 }}>EN · ID</span>}
    </div>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, paddingBottom: 24 }}>{d.sections.filter(s => s.on).map(s => <div key={s.k}>{block[s.k]}</div>)}</div>
    {d.opts.powered && <p style={{ textAlign: 'center', fontSize: 11, opacity: .55, paddingBottom: 16 }}>Powered by BorNiz</p>}
  </Guest>;
}
export const SECTION_LABEL = Object.fromEntries(HOME_SECTIONS.map(([k, l]) => [k, l]));

// ── Page Builder sections ────────────────────────────────────────────────────────────
function Countdown({ endsIn, start }: { endsIn: number; start: number }) {
  const now = useNow(1000), left = Math.max(0, start + endsIn * 60e3 - now);
  const p = (n: number) => String(n).padStart(2, '0');
  return <span className="num" style={{ display: 'inline-flex', gap: 4 }}>{[Math.floor(left / 3600e3), Math.floor(left / 60e3) % 60, Math.floor(left / 1e3) % 60].map((n, i) =>
    <b key={i} style={{ minWidth: 34, padding: '4px 6px', borderRadius: 8, background: 'var(--bn-ink)', color: 'var(--bn-paper)', textAlign: 'center' }}>{p(n)}</b>)}</span>;
}
const pids = (s: unknown) => String(s ?? '').split(',').map(x => x.trim()).filter(Boolean);
export function SectionView({ s, ctx, start = 0, mobile = true }: { s: Section; ctx: GuestCtx; start?: number; mobile?: boolean }) {
  const { d, db, outletId } = ctx, q = s.props, pad = s.style.pad === 's' ? 8 : s.style.pad === 'l' ? 32 : 18;
  const bg = s.style.bg === 'surface' ? 'var(--bn-surface)' : s.style.bg === 'brand' ? 'var(--bn-p)' : s.style.bg === 'ink' ? 'var(--bn-ink)' : 'transparent';
  const fg = s.style.bg === 'brand' ? 'var(--bn-on-p)' : s.style.bg === 'ink' ? 'var(--bn-paper)' : undefined;
  const prods = guestProducts(db, outletId), byId = (id: string) => prods.find(g => g.p.id === id);
  const H = ({ children, size = 20 }: { children: ReactNode; size?: number }) => <h3 style={{ ...gh(d), fontSize: size }}>{children}</h3>;
  const cols = (n: unknown) => `repeat(${mobile ? Math.min(2, Number(n) || 2) : Number(n) || 3},minmax(0,1fr))`;
  let body: ReactNode = null;
  switch (s.type) {
    case 'announce': return <div style={{ background: 'var(--bn-acc)', color: 'var(--bn-on-acc)', padding: '10px 16px', fontWeight: 700, fontSize: 13, textAlign: 'center' }}>{String(q.text)}</div>;
    case 'hero': return <div style={{ position: 'relative', minHeight: q.height === 'short' ? 200 : 320, background: q.img ? `url(${q.img}) center/cover` : 'var(--bn-banner)', display: 'flex', alignItems: 'flex-end', padding: 20, color: WHITE, textAlign: q.align === 'center' ? 'center' : 'left', justifyContent: q.align === 'center' ? 'center' : 'flex-start' }}>
      <span style={{ position: 'absolute', inset: 0, background: `linear-gradient(180deg,transparent,color-mix(in srgb,var(--ink-950) ${q.overlay ?? 45}%,transparent))` }} />
      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 8, alignItems: q.align === 'center' ? 'center' : 'flex-start' }}><h2 style={{ ...gh(d), fontSize: 30 }}>{String(q.title)}</h2><p style={{ opacity: .9 }}>{String(q.sub ?? '')}</p>{q.cta ? <GBtn d={d}>{String(q.cta)}</GBtn> : null}</div></div>;
    case 'text': body = <div style={{ textAlign: q.align === 'center' ? 'center' : 'left', display: 'flex', flexDirection: 'column', gap: 6 }}><H>{String(q.title)}</H><p style={{ opacity: .8 }}>{String(q.body)}</p></div>; break;
    case 'gallery': body = <div style={{ display: 'grid', gridTemplateColumns: cols(q.cols), gap: 6 }}>{prods.slice(0, Number(q.count)).map(g => <span key={g.p.id} style={{ aspectRatio: '1/1', borderRadius: 'var(--bn-r-sm)', background: photoOf(g.p) }} />)}</div>; break;
    case 'cats': body = <div style={{ display: 'flex', gap: 8, overflowX: 'auto' }}>{db.categories.map((k, i) => <span key={k.id} style={{ flex: 'none', padding: '8px 14px', borderRadius: q.style === 'pill' ? 999 : 'var(--bn-r-sm)', background: i === 0 ? 'var(--bn-p)' : 'var(--bn-soft)', color: i === 0 ? 'var(--bn-on-p)' : 'inherit', fontWeight: 700, fontSize: 13 }}>{k.name}</span>)}</div>; break;
    case 'products': {
      const items = q.cat === 'best' ? bestSellers(db, outletId, Number(q.count)) : prods.filter(g => !q.cat || g.p.categoryId === q.cat).slice(0, Number(q.count));
      body = <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}><H>{String(q.title)}</H><div style={{ display: 'grid', gridTemplateColumns: q.card === 'list' ? '1fr' : cols(q.cols), gap: 10 }}>
        {items.map(g => <div key={g.p.id} style={{ display: 'flex', flexDirection: q.card === 'list' ? 'row' : 'column', gap: 8, padding: 8, borderRadius: 'var(--bn-r)', background: 'var(--bn-surface)', boxShadow: '0 0 0 1px var(--bn-line)', opacity: g.sold ? .5 : 1, color: 'var(--bn-ink)' }}>
          <span style={{ width: q.card === 'list' ? 64 : '100%', aspectRatio: '1/1', flex: 'none', borderRadius: 'var(--bn-r-sm)', background: photoOf(g.p) }} /><span style={{ display: 'flex', flexDirection: 'column' }}><b style={{ fontSize: 14 }}>{g.p.name}</b><Price g={g} />{g.sold && <Tag tone="sold">Sold out</Tag>}</span></div>)}</div></div>; break;
    }
    case 'buttons': body = <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: q.align === 'center' ? 'stretch' : 'flex-start' }}>{[q.b1, q.b2, q.b3].filter(Boolean).map((b, i) => <GBtn key={i} d={d} ghost={i > 0}>{String(b)}</GBtn>)}</div>; break;
    case 'hours': { const o = db.outlets.find(x => x.id === outletId)!; body = <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}><H>{String(q.title)}</H>{db.outlets.map(x => <div key={x.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}><span>{x.name} · {x.city}</span><b>{x.opens}–{x.closes}</b></div>)}
      {q.map && <div style={{ height: 120, borderRadius: 'var(--bn-r)', background: 'repeating-linear-gradient(45deg,var(--bn-soft) 0 12px,var(--bn-paper) 12px 24px)', display: 'grid', placeItems: 'center', fontSize: 13 }}><span className="row"><Icon name="map-pin" size={16} />Map · {o.name}</span></div>}</div>; break; }
    case 'reviews': { const rs = db.reviews.filter(r => r.stars >= Number(q.min ?? 4)); body = <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}><H>{String(q.title)}</H>{rs.length ? rs.slice(0, 3).map(r => <div key={r.id} style={{ padding: 12, borderRadius: 'var(--bn-r)', background: 'var(--bn-surface)', color: 'var(--bn-ink)', boxShadow: '0 0 0 1px var(--bn-line)' }}><b>{'★'.repeat(r.stars)}</b><p style={{ fontSize: 14 }}>“{r.text}” · {r.name}</p></div>) : <p style={{ opacity: .7 }}>No reviews at {Number(q.min ?? 4)}+ stars yet.</p>}</div>; break; }
    case 'faq': body = <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}><H>{String(q.title)}</H>{[1, 2, 3].filter(i => q['q' + i]).map(i => <details key={i} style={{ padding: '10px 12px', borderRadius: 'var(--bn-r-sm)', background: 'var(--bn-surface)', color: 'var(--bn-ink)' }}><summary style={{ fontWeight: 700, cursor: 'pointer' }}>{String(q['q' + i])}</summary><p style={{ fontSize: 14, marginTop: 6 }}>{String(q['a' + i])}</p></details>)}</div>; break;
    case 'countdown': body = <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, textAlign: 'center' }}><H>{String(q.title)}</H><Countdown endsIn={Number(q.endsIn)} start={start} />{q.cta ? <GBtn d={d}>{String(q.cta)}</GBtn> : null}</div>; break;
    case 'spacer': return <div style={{ height: Number(q.h), borderBottom: q.line ? '1px solid var(--bn-line)' : 0 }} />;
    case 'banner': {
      const img = q.layout !== 'color' && q.img ? `url(${q.img}) center/cover` : 'linear-gradient(135deg,var(--bn-p),var(--bn-ink))';
      const text = <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: q.align === 'center' ? 'center' : 'flex-start', textAlign: q.align === 'center' ? 'center' : 'left' }}>{q.badge ? <Tag>{String(q.badge)}</Tag> : null}<H size={22}>{String(q.title)}</H><p style={{ fontSize: 14, opacity: .9 }}>{String(q.sub)}</p>{q.countdown && <Countdown endsIn={Number(q.endsIn)} start={start} />}{q.cta ? <GBtn d={d}>{String(q.cta)}</GBtn> : null}</div>;
      body = q.layout === 'split' || q.layout === 'card'
        ? <div style={{ display: 'grid', gridTemplateColumns: q.layout === 'split' ? '1fr 1fr' : '1fr', borderRadius: 'var(--bn-r)', overflow: 'hidden', background: 'var(--bn-surface)', color: 'var(--bn-ink)', boxShadow: '0 0 0 1px var(--bn-line)' }}><span style={{ minHeight: 150, background: img }} /><div style={{ padding: 14 }}>{text}</div></div>
        : <div style={{ position: 'relative', minHeight: 200, borderRadius: 'var(--bn-r)', overflow: 'hidden', background: img, color: WHITE, padding: 18, display: 'flex', alignItems: 'flex-end' }}><span style={{ position: 'absolute', inset: 0, background: `color-mix(in srgb,var(--ink-950) ${q.layout === 'color' ? 0 : q.overlay}%,transparent)` }} /><div style={{ position: 'relative' }}>{text}</div></div>;
      break;
    }
    case 'carousel': body = <div style={{ display: 'flex', gap: 10, overflowX: 'auto', scrollSnapType: 'x mandatory' }}>{s.items.map((x, i) => <div key={i} style={{ flex: 'none', width: '86%', scrollSnapAlign: 'start' }}><PromoCardView c={{ t: x.title, s: x.sub, img: x.img, tag: x.badge }} big={false} /></div>)}</div>; break;
    case 'flash': {
      const ids = pids(q.products), live = db.promos.filter(p => p.kind === 'flash' && (p.endsAt ?? 0) > Date.now() && p.productIds?.some(id => ids.includes(id)));
      const bold = q.style !== 'clean';
      body = <div style={{ borderRadius: 'var(--bn-r)', padding: 14, background: bold ? 'linear-gradient(135deg,var(--danger),var(--accent))' : 'var(--bn-surface)', color: bold ? WHITE : 'var(--bn-ink)', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}><span className="row"><Icon name="zap" /><b style={{ ...gh(d), fontSize: 20 }}>{String(q.title)}</b></span><span className="row" style={{ fontSize: 12 }}>Ends in <Countdown endsIn={Number(q.endsIn)} start={live[0]?.endsAt ? live[0].endsAt - Number(q.endsIn) * 60e3 : start} /></span></div>
        <div style={{ display: 'grid', gridTemplateColumns: cols(2), gap: 8 }}>{ids.map(byId).filter(Boolean).map(g => { const pr = live.find(p => p.productIds?.includes(g!.p.id)), sold = pr?.quota ? Math.min(100, Math.round((flashSold(db, pr) / pr.quota) * 100)) : 0;
          return <div key={g!.p.id} style={{ background: 'var(--bn-surface)', color: 'var(--bn-ink)', borderRadius: 'var(--bn-r-sm)', padding: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ aspectRatio: '1/1', borderRadius: 'var(--bn-r-sm)', background: photoOf(g!.p), position: 'relative' }}><span style={{ position: 'absolute', top: 6, left: 6 }}><Tag tone="flash">−{String(q.disc)}%</Tag></span></span>
            <b style={{ fontSize: 13 }}>{g!.p.name}</b><span className="row" style={{ gap: 6 }}><b style={{ color: 'var(--danger)' }}>{idr(flashPriceOf(g!.price, Number(q.disc)))}</b><s style={{ fontSize: 11, opacity: .6 }}>{idr(g!.price)}</s></span>
            {q.stock && <span style={{ fontSize: 11, opacity: .7 }}>{pr ? (sold >= 85 ? 'Almost gone' : `Sold ${sold}%`) : 'Not started'}</span>}{q.stock && <span style={{ height: 6, borderRadius: 99, background: 'var(--bn-soft)', overflow: 'hidden' }}><span style={{ display: 'block', height: '100%', width: sold + '%', background: 'var(--danger)' }} /></span>}</div>; })}</div></div>;
      break;
    }
    case 'tiles': body = <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}><H>{String(q.title)}</H><div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>{s.items.map((x, i) =>
      <div key={i} style={{ gridColumn: q.layout === 'feature' && i === 0 ? 'span 2' : undefined, minHeight: q.layout === 'feature' && i === 0 ? 150 : 110, borderRadius: 'var(--bn-r)', background: x.img ? `url(${x.img}) center/cover` : i % 2 ? 'linear-gradient(135deg,var(--bn-acc),var(--bn-p))' : 'linear-gradient(135deg,var(--bn-p),var(--bn-ink))', color: WHITE, padding: 12, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 2 }}>{x.badge && <Tag>{x.badge}</Tag>}<b>{x.title}</b><span style={{ fontSize: 12 }}>{x.sub}</span></div>)}</div></div>; break;
    case 'vouchers': { const vs = db.promos.filter(p => p.kind !== 'flash' && p.code); body = <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}><H>{String(q.title)}</H><div style={{ display: 'flex', gap: 8, overflowX: 'auto' }}>
      {vs.map(v => <div key={v.id} style={{ flex: 'none', width: 180, display: 'flex', borderRadius: 'var(--bn-r-sm)', border: '1.5px dashed var(--bn-p)', background: 'var(--bn-surface)', color: 'var(--bn-ink)' }}>
        <div style={{ padding: 10, flex: 1 }}><b style={{ fontFamily: 'var(--bn-font)', fontSize: 20, color: 'var(--bn-p-text)' }}>{v.kind === 'pct' ? v.value + '%' : idr(v.value).replace('IDR ', 'IDR ')}</b><p style={{ fontSize: 11 }}>{v.minSpend ? 'Min. spend ' + idr(v.minSpend) : 'Any order'}</p><span className="mono" style={{ fontSize: 11 }}>{v.code}</span></div>
        <span style={{ writingMode: 'vertical-rl', padding: 6, background: 'var(--bn-p)', color: 'var(--bn-on-p)', fontSize: 11, fontWeight: 700, textAlign: 'center' }}>Claim</span></div>)}</div>{q.member && <p style={{ fontSize: 12, opacity: .7 }}>Members only · sign in to claim</p>}</div>; break; }
    case 'bundle': { const items = pids(q.products).map(byId).filter(Boolean) as GProduct[], orig = items.reduce((a, g) => a + g.price, 0);
      body = <div style={{ display: 'flex', gap: 12, padding: 12, borderRadius: 'var(--bn-r)', background: 'var(--bn-surface)', color: 'var(--bn-ink)', boxShadow: '0 0 0 1px var(--bn-line)', alignItems: 'center' }}>
        <div style={{ display: 'flex' }}>{items.slice(0, 3).map((g, i) => <span key={g.p.id} style={{ width: 56, height: 56, borderRadius: 99, background: photoOf(g.p), marginLeft: i ? -16 : 0, boxShadow: '0 0 0 3px var(--bn-surface)' }} />)}</div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}><Tag>Combo</Tag><b>{String(q.title)}</b><span style={{ fontSize: 12, opacity: .7 }}>{items.map(g => g.p.name).join(' + ')}</span>
          <span className="row" style={{ gap: 6 }}><b style={{ color: 'var(--bn-p-text)' }}>{idr(Number(q.price))}</b>{orig > Number(q.price) && <s style={{ fontSize: 12, opacity: .6 }}>{idr(orig)}</s>}</span></div><GBtn d={d} style={{ height: 40 }}>{String(q.cta)}</GBtn></div>; break; }
    case 'popup': body = <div style={{ position: 'relative', borderRadius: 'var(--bn-r)', background: 'color-mix(in srgb,var(--ink-950) 40%,transparent)', padding: 24, display: 'grid', placeItems: 'center' }}>
      <div style={{ width: '100%', maxWidth: 300, borderRadius: 'var(--bn-r)', background: 'var(--bn-surface)', color: 'var(--bn-ink)', overflow: 'hidden', textAlign: 'center' }}>{q.img ? <span style={{ display: 'block', height: 120, background: `url(${q.img}) center/cover` }} /> : <span style={{ display: 'block', height: 8, background: 'var(--bn-p)' }} />}
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}><H>{String(q.title)}</H><p style={{ fontSize: 14 }}>{String(q.sub)}</p><span className="mono" style={{ padding: '6px 12px', border: '1.5px dashed var(--bn-p)', borderRadius: 8 }}>{String(q.code)}</span><GBtn d={d} style={{ width: '100%' }}>{String(q.cta)}</GBtn>
          <span style={{ fontSize: 11, opacity: .6 }}>{q.when === 'first' ? 'First visit' : q.when === 'exit' ? 'On exit' : 'Every visit'} · after {String(q.delay)}s</span></div></div></div>; break;
    case 'member': body = <div style={{ padding: 16, borderRadius: 'var(--bn-r)', background: 'linear-gradient(135deg,var(--bn-p),var(--bn-ink))', color: 'var(--bn-on-p)', display: 'flex', flexDirection: 'column', gap: 6 }}><Icon name="gift" /><H>{String(q.title)}</H><p style={{ fontSize: 14 }}>{String(q.sub)}</p><GBtn d={d} style={{ background: 'var(--bn-acc)', color: 'var(--bn-on-acc)' }}>{String(q.cta)}</GBtn></div>; break;
    case 'links': body = <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}><H>{String(q.title)}</H>{[1, 2, 3, 4].filter(i => q['l' + i]).map(i => <GBtn key={i} d={d} ghost style={{ width: '100%' }}>{String(q['l' + i])}</GBtn>)}</div>; break;
    default: body = <p>{SECTION_LIB[s.type]?.[0] ?? s.type}</p>;
  }
  return <div style={{ padding: pad + 'px 16px', background: bg, color: fg }}>{body}</div>;
}

/** Which sections a visitor sees (visibility rules + preview-as). */
export interface Viewer { aud: string; time: string; outlet: string; dev: string }
export const visibleTo = (s: Section, v: Viewer) => !s.hidden
  && (s.vis.aud === 'all' || s.vis.aud === v.aud) && (s.vis.time === 'all' || v.time === 'all' || s.vis.time === v.time)
  && (s.vis.outlet === 'all' || s.vis.outlet === v.outlet) && (s.vis.dev === 'all' || s.vis.dev === (v.dev === 'desktop' ? 'desktop' : 'mobile'));
