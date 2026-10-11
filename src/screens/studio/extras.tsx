'use client';
// "More pages" in Menu Studio: every extra customer page or screen, as a settings spec + a live preview from store data.
// Settings live in the menu design (design.x[key]) and publish with the rest of the menu.
import type { ReactNode } from 'react';
import type { Group, Val } from '../../data/actions/studio.ts';
import { idr } from '../../domain/money.ts';
import { orderTotals } from '../../domain/order.ts';
import { Icon } from '../../ui/kit.tsx';
import { Block, f, type Device, type F } from './Frame.tsx';
import { Guest, GBtn, Tag, gh, guestProducts, photoOf, type GuestCtx } from './guest.tsx';
import { QR } from '../../ui/qr.tsx';
import { origin } from './surfaces.tsx';

export interface Extra { key: string; label: string; icon: string; device: Device | 'print'; defaults: Group; fields: (ctx: GuestCtx, g: Group) => F[]; extra?: (g: Group, set: (k: string, v: Val) => void, ctx: GuestCtx) => ReactNode; preview: (g: Group, ctx: GuestCtx) => ReactNode }
const WHITE = 'var(--ink-0)';
const ids = (v: Val | undefined) => String(v ?? '').split(',').filter(Boolean);
const Page = ({ children, ctx, title }: { children: ReactNode; ctx: GuestCtx; title?: string }) =>
  <Guest d={ctx.d}><div style={{ height: 56, display: 'flex', alignItems: 'center', padding: '0 16px', background: 'var(--bn-surface)', boxShadow: '0 1px 0 var(--bn-line)', gap: 10 }}><b style={{ fontFamily: 'var(--bn-font)' }}>{ctx.d.name}</b>{title && <span style={{ opacity: .6, fontSize: 13 }}>· {title}</span>}</div>
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>{children}</div></Guest>;
const H = ({ ctx, children, size = 22 }: { ctx: GuestCtx; children: ReactNode; size?: number }) => <h2 style={{ ...gh(ctx.d), fontSize: size }}>{children}</h2>;
const Box = ({ children, on }: { children: ReactNode; on?: boolean }) => <div style={{ padding: 12, borderRadius: 'var(--bn-r-sm)', background: 'var(--bn-surface)', boxShadow: `0 0 0 ${on ? 2 : 1}px ${on ? 'var(--bn-p)' : 'var(--bn-line)'}`, color: 'var(--bn-ink)', fontSize: 14 }}>{children}</div>;
function Picker({ label, value, set, ctx }: { label: string; value: Val | undefined; set: (v: string) => void; ctx: GuestCtx }) {
  const v = ids(value);
  return <Block title={label}><div className="row wrap">{ctx.db.products.filter(p => p.status === 'live').map(p => <button key={p.id} type="button" className="chip" aria-pressed={v.includes(p.id)} onClick={() => set((v.includes(p.id) ? v.filter(x => x !== p.id) : [...v, p.id]).join(','))}>{p.name}</button>)}</div></Block>;
}
const BADGES: [string, string, string][] = [['spicy', 'Spicy', 'flame'], ['veg', 'Vegetarian', 'leaf'], ['nuts', 'Contains nuts', 'nut'], ['dairy', 'Contains dairy', 'milk'], ['halal', 'Halal', 'badge-check'], ['new', 'New', 'sparkles']];
const CHANNELS: [string, string][] = [['dine', 'Dine-in'], ['take', 'Takeaway'], ['gofood', 'GoFood'], ['grab', 'GrabFood'], ['shopee', 'ShopeeFood']];

export const EXTRAS: Extra[] = [
  { key: 'style-per-category', label: 'Style per category', icon: 'swatch-book', device: 'phone', defaults: { cat: 'coffee', layout: 'grid', bg: 'page', banner: '' },
    fields: ctx => [f.seg('cat', 'Category', ctx.db.categories.map(c => `${c.id}:${c.name}`).join('|'), 2), f.seg('layout', 'Layout', 'list:List|grid:Grid|big:Big photo|text:Printed'), f.seg('bg', 'Background', 'page:Page|surface:Card|brand:Brand tint'), f.img('banner', 'Category banner', '3/1')],
    preview: (g, ctx) => { const items = guestProducts(ctx.db, ctx.outletId).filter(x => x.p.categoryId === g.cat), cat = ctx.db.categories.find(c => c.id === g.cat);
      return <Page ctx={ctx} title={cat?.name}><div style={{ margin: -16, padding: 16, background: g.bg === 'surface' ? 'var(--bn-surface)' : g.bg === 'brand' ? 'color-mix(in srgb,var(--bn-p) 10%,var(--bn-paper))' : 'transparent', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ aspectRatio: '3/1', borderRadius: 'var(--bn-r)', background: g.banner ? `url(${g.banner}) center/cover` : 'var(--bn-banner)', display: 'flex', alignItems: 'flex-end', padding: 14, color: WHITE }}><H ctx={ctx}>{cat?.name}</H></div>
        <div style={{ display: 'grid', gridTemplateColumns: g.layout === 'grid' ? '1fr 1fr' : '1fr', gap: 10 }}>{items.map(x => <div key={x.p.id} style={{ display: 'flex', flexDirection: g.layout === 'grid' || g.layout === 'big' ? 'column' : 'row', gap: 8, padding: g.layout === 'text' ? '8px 0' : 8, borderBottom: g.layout === 'text' ? '1px dashed var(--bn-line)' : 0, background: g.layout === 'text' ? 'transparent' : 'var(--bn-surface)', borderRadius: 'var(--bn-r-sm)' }}>
          {g.layout !== 'text' && <span style={{ width: g.layout === 'list' ? 64 : '100%', aspectRatio: g.layout === 'big' ? '16/9' : '1/1', borderRadius: 'var(--bn-r-sm)', background: photoOf(x.p), flex: 'none' }} />}<span style={{ flex: 1 }}><b style={{ fontSize: 14 }}>{x.p.name}</b><br />{idr(x.price)}</span></div>)}</div></div></Page>; } },

  { key: 'auto-theme-by-time', label: 'Auto theme by time', icon: 'sun-moon', device: 'tablet', defaults: { on: true, dark: '18:00', light: '06:00', paper: '#14161C', ink: '#F5F2EE' },
    fields: () => [f.tog('on', 'Switch theme automatically', 'Outlet local time'), f.text('light', 'Day theme from', 'HH:MM'), f.text('dark', 'Night theme from', 'HH:MM'), f.color('paper', 'Night background'), f.color('ink', 'Night text')],
    preview: (g, ctx) => <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', height: '100%' }}>{[false, true].map(night => <Guest key={String(night)} d={night && g.on ? { ...ctx.d, paper: String(g.paper), ink: String(g.ink), surface: String(g.paper) } : ctx.d} style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <span style={{ fontSize: 12, opacity: .7 }}><Icon name={night ? 'moon' : 'sun'} size={14} /> {night ? `From ${g.dark}` : `From ${g.light}`}</span><H ctx={ctx}>{ctx.d.name}</H><p style={{ fontSize: 14 }}>{ctx.d.tagline}</p>
      {guestProducts(ctx.db, ctx.outletId).slice(0, 3).map(x => <div key={x.p.id} style={{ display: 'flex', gap: 10, alignItems: 'center' }}><span style={{ width: 44, height: 44, borderRadius: 10, background: photoOf(x.p) }} /><span style={{ flex: 1, fontSize: 14 }}>{x.p.name}</span><b>{idr(x.price)}</b></div>)}<GBtn d={ctx.d}>See the menu</GBtn></Guest>)}</div> },

  { key: 'upsell-and-goes-well-with-rules', label: 'Upsell & goes well with', icon: 'sparkles', device: 'phone', defaults: { trigger: 'p1', suggest: 'p7,p8', title: 'Goes well with', max: 2, cart: true },
    fields: ctx => [f.seg('trigger', 'When a guest opens', ctx.db.products.filter(p => p.status === 'live').slice(0, 8).map(p => `${p.id}:${p.name}`).join('|'), 2), f.text('title', 'Heading'), f.range('max', 'Suggestions', 1, 4, 1), f.tog('cart', 'Also suggest in the cart')],
    extra: (g, set, ctx) => <Picker label="Suggest" value={g.suggest} set={v => set('suggest', v)} ctx={ctx} />,
    preview: (g, ctx) => { const all = guestProducts(ctx.db, ctx.outletId), t = all.find(x => x.p.id === g.trigger), s = ids(g.suggest).map(id => all.find(x => x.p.id === id)).filter(Boolean).slice(0, Number(g.max));
      return <Page ctx={ctx}>{t && <><div style={{ aspectRatio: '4/3', borderRadius: 'var(--bn-r)', background: photoOf(t.p) }} /><H ctx={ctx}>{t.p.name}</H><b>{idr(t.price)}</b></>}
        <b>{String(g.title)}</b>{s.map(x => <Box key={x!.p.id}><div style={{ display: 'flex', gap: 10, alignItems: 'center' }}><span style={{ width: 44, height: 44, borderRadius: 10, background: photoOf(x!.p) }} /><span style={{ flex: 1 }}>{x!.p.name}<br /><b>+{idr(x!.price)}</b></span><Tag>Add</Tag></div></Box>)}<GBtn d={ctx.d}>Add to order</GBtn></Page>; } },

  { key: 'combo-bundle-builder-steps', label: 'Combo builder steps', icon: 'list-ordered', device: 'phone', defaults: { name: 'Breakfast combo', price: 49000, s1: 'Pick a drink', c1: 'coffee', s2: 'Pick a pastry', c2: 'pastry', s3: 'Add a side', c3: 'other' },
    fields: ctx => { const cats = ctx.db.categories.map(c => `${c.id}:${c.name}`).join('|'); return [f.text('name', 'Combo name'), f.num('price', 'Combo price (IDR)'), ...[1, 2, 3].flatMap(i => [f.text('s' + i, `Step ${i} title`), f.seg('c' + i, `Step ${i} from`, cats, 3)])]; },
    preview: (g, ctx) => { const all = guestProducts(ctx.db, ctx.outletId);
      return <Page ctx={ctx} title="Combo"><H ctx={ctx}>{String(g.name)}</H><b style={{ color: 'var(--bn-p-text)' }}>{idr(Number(g.price))}</b>
        {[1, 2, 3].map(i => <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}><b style={{ fontSize: 14 }}><span style={{ display: 'inline-grid', placeItems: 'center', width: 24, height: 24, borderRadius: 99, background: i === 1 ? 'var(--bn-p)' : 'var(--bn-soft)', color: i === 1 ? 'var(--bn-on-p)' : 'inherit', marginRight: 8 }}>{i}</span>{String(g['s' + i])}</b>
          <div style={{ display: 'flex', gap: 8, overflowX: 'auto' }}>{all.filter(x => x.p.categoryId === g['c' + i]).slice(0, 4).map((x, j) => <span key={x.p.id} style={{ flex: 'none', width: 92, padding: 6, borderRadius: 'var(--bn-r-sm)', boxShadow: `0 0 0 ${i === 1 && j === 0 ? 2 : 1}px ${i === 1 && j === 0 ? 'var(--bn-p)' : 'var(--bn-line)'}`, fontSize: 12 }}><span style={{ display: 'block', aspectRatio: '1/1', borderRadius: 8, background: photoOf(x.p), marginBottom: 4 }} />{x.p.name}</span>)}</div></div>)}
        <GBtn d={ctx.d}>Next step</GBtn></Page>; } },

  { key: 'split-bill-and-pay-together-from-phones', label: 'Split bill from phones', icon: 'split', device: 'phone', defaults: { equal: true, items: true, max: 6, tip: false },
    fields: () => [f.tog('equal', 'Split equally'), f.tog('items', 'Pay for my items'), f.range('max', 'Up to', 2, 12, 1, ' people'), f.tog('tip', 'Ask for a tip')],
    preview: (g, ctx) => { const o = ctx.db.orders.filter(x => x.outletId === ctx.outletId && x.status === 'paid' && x.lines.length > 1).sort((a, b) => b.createdAt - a.createdAt)[0]; const n = 3;
      return <Page ctx={ctx} title={o ? 'Table ' + (o.table ?? '7') : undefined}><H ctx={ctx}>Split the bill</H>{o ? <><b>Total {idr(o.total)}</b>
        {g.equal && <Box on>Split equally · {n} people · <b>{idr(Math.ceil(o.total / n))}</b> each</Box>}{g.items && <Box>Pay for my items{o.lines.slice(0, 3).map(l => <div key={l.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}><span>{l.qty}× {l.name}</span><span>{idr(l.unitPrice * l.qty)}</span></div>)}</Box>}
        <div style={{ display: 'flex', gap: 6 }}>{Array.from({ length: n }, (_, i) => <span key={i} style={{ flex: 1, padding: 8, borderRadius: 'var(--bn-r-sm)', background: i === 0 ? 'var(--bn-p)' : 'var(--bn-soft)', color: i === 0 ? 'var(--bn-on-p)' : 'inherit', fontSize: 12, textAlign: 'center' }}>{i === 0 ? 'Paid' : 'Waiting'}</span>)}</div>
        <span style={{ fontSize: 12, opacity: .7 }}>Up to {String(g.max)} phones per table{g.tip ? ' · tip asked at payment' : ''}</span><GBtn d={ctx.d}>Pay my share with QRIS</GBtn></> : <p>No multi-item bill yet at this outlet.</p>}</Page>; } },

  { key: 'reservation-booking-page', label: 'Reservation page', icon: 'calendar-check', device: 'phone', defaults: { maxGuests: 12, slot: 30, deposit: 100000, depositFrom: 6, note: 'We hold your table for 15 minutes.' },
    fields: () => [f.range('maxGuests', 'Largest party online', 2, 30, 1), f.seg('slot', 'Time slots every', '15:15 min|30:30 min|60:1 hour'), f.num('deposit', 'Deposit (IDR)', '0 for none'), f.range('depositFrom', 'Deposit from', 2, 20, 1, ' guests'), f.area('note', 'Note to guests')],
    preview: (g, ctx) => { const o = ctx.db.outlets.find(x => x.id === ctx.outletId)!, [h0] = o.opens.split(':').map(Number), [h1] = o.closes.split(':').map(Number), step = Number(g.slot);
      const slots: string[] = []; for (let m = h0 * 60; m < h1 * 60 - 60 && slots.length < 12; m += step) slots.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
      const booked = ctx.db.reservations.filter(r => r.outletId === ctx.outletId && r.status === 'booked').map(r => new Date(r.at).toTimeString().slice(0, 5));
      return <Page ctx={ctx} title="Book a table"><H ctx={ctx}>Book at {o.name}</H><Box>Guests · <b>2</b> <span style={{ opacity: .6 }}>(up to {String(g.maxGuests)})</span></Box>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 6 }}>{slots.map((s, i) => <span key={s} style={{ padding: '8px 0', textAlign: 'center', borderRadius: 'var(--bn-r-sm)', fontSize: 13, background: booked.includes(s) ? 'var(--bn-soft)' : i === 2 ? 'var(--bn-p)' : 'var(--bn-surface)', color: i === 2 && !booked.includes(s) ? 'var(--bn-on-p)' : 'inherit', textDecoration: booked.includes(s) ? 'line-through' : 'none', boxShadow: '0 0 0 1px var(--bn-line)' }}>{s}</span>)}</div>
        {Number(g.deposit) > 0 && <p style={{ fontSize: 13 }}>Deposit {idr(Number(g.deposit))} for {String(g.depositFrom)}+ guests, deducted from the bill.</p>}<p style={{ fontSize: 13, opacity: .75 }}>{String(g.note)}</p><GBtn d={ctx.d}>Book table</GBtn></Page>; } },

  { key: 'gift-card-designer', label: 'Gift card designer', icon: 'gift', device: 'phone', defaults: { style: 'brand', title: 'A coffee on me', amounts: '100000,200000,500000', msg: 'Happy birthday! Enjoy a slow morning on me.', img: '' },
    fields: () => [f.seg('style', 'Card style', 'brand:Brand gradient|accent:Accent|photo:Photo'), f.text('title', 'Card title'), f.text('amounts', 'Amounts (IDR, comma separated)'), f.area('msg', 'Default message'), f.img('img', 'Card photo', '1.6/1')],
    preview: (g, ctx) => <Page ctx={ctx} title="Gift cards"><div style={{ aspectRatio: '1.6/1', borderRadius: 'var(--bn-r)', padding: 18, color: g.style === 'accent' ? 'var(--bn-on-acc)' : WHITE, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', background: g.style === 'photo' && g.img ? `linear-gradient(180deg,transparent,color-mix(in srgb,var(--ink-950) 60%,transparent)),url(${g.img}) center/cover` : g.style === 'accent' ? 'var(--bn-acc)' : 'linear-gradient(135deg,var(--bn-p),var(--bn-ink))' }}>
      <b>{ctx.d.name}</b><div><H ctx={ctx}>{String(g.title)}</H><b style={{ fontSize: 26 }}>{idr(Number(ids(g.amounts)[0] ?? 0))}</b></div></div>
      <div style={{ display: 'flex', gap: 8 }}>{ids(g.amounts).map((a, i) => <span key={a} style={{ flex: 1, padding: 10, textAlign: 'center', borderRadius: 'var(--bn-r-sm)', boxShadow: `0 0 0 ${i ? 1 : 2}px ${i ? 'var(--bn-line)' : 'var(--bn-p)'}`, fontSize: 13, fontWeight: 700 }}>{idr(Number(a)).replace(',000', 'k')}</span>)}</div>
      <Box>{String(g.msg)}</Box><GBtn d={ctx.d}>Buy gift card</GBtn></Page> },

  { key: 'referral-page', label: 'Referral page', icon: 'users', device: 'phone', defaults: { give: '10% off first order', get: '50 beans', prefix: 'KOPI', share: 'wa' },
    fields: () => [f.text('give', 'Friend gets'), f.text('get', 'You get'), f.text('prefix', 'Code prefix'), f.seg('share', 'Share button', 'wa:WhatsApp|link:Copy link|both:Both')],
    preview: (g, ctx) => { const c = ctx.db.customers[0]; return <Page ctx={ctx} title="Refer a friend"><H ctx={ctx}>Bring a friend</H><p>Your friend gets <b>{String(g.give)}</b>. You get <b>{String(g.get)}</b> when they pay.</p>
      <div style={{ padding: 14, borderRadius: 'var(--bn-r)', border: '2px dashed var(--bn-p)', textAlign: 'center' }}><span style={{ fontSize: 12, opacity: .7 }}>Your code</span><br /><b className="mono" style={{ fontSize: 22 }}>{String(g.prefix)}-{c.name.split(' ')[0].toUpperCase()}</b></div>
      {g.share !== 'link' && <GBtn d={ctx.d}>Share on WhatsApp</GBtn>}{g.share !== 'wa' && <GBtn d={ctx.d} ghost>Copy link</GBtn>}</Page>; } },

  { key: 'delivery-tracking-page', label: 'Delivery tracking page', icon: 'bike', device: 'phone', defaults: { driver: true, map: true, eta: true, help: 'Chat with us on WhatsApp' },
    fields: () => [f.tog('driver', 'Show driver name & plate'), f.tog('map', 'Show map'), f.tog('eta', 'Show arrival time'), f.text('help', 'Help line')],
    preview: (g, ctx) => { const o = ctx.db.orders.filter(x => x.outletId === ctx.outletId && x.type === 'delivery').sort((a, b) => b.createdAt - a.createdAt)[0];
      return <Page ctx={ctx} title={o?.no}>{g.map && <div style={{ height: 160, borderRadius: 'var(--bn-r)', background: 'repeating-linear-gradient(45deg,var(--bn-soft) 0 12px,var(--bn-paper) 12px 24px)', display: 'grid', placeItems: 'center' }}><Icon name="bike" size={28} /></div>}
        <H ctx={ctx}>{o ? 'On the way' : 'No delivery yet'}</H>{g.eta && o?.readyBy && <p>Arrives around <b>{new Date(o.readyBy + 15 * 60e3).toTimeString().slice(0, 5)}</b></p>}
        {['Order received', 'Prepared', 'Picked up', 'Delivered'].map((s, i) => <div key={s} style={{ display: 'flex', gap: 10, alignItems: 'center', opacity: i < 3 ? 1 : .45 }}><span style={{ width: 14, height: 14, borderRadius: 99, background: i < 3 ? 'var(--bn-p)' : 'var(--bn-soft)' }} />{s}</div>)}
        {g.driver && <Box>Driver name and plate appear here from the delivery platform.</Box>}<span style={{ fontSize: 13, opacity: .7 }}>{String(g.help)}</span></Page>; } },

  { key: 'store-closed-offline-sold-out-pages', label: 'Closed, offline, sold out', icon: 'store', device: 'phone', defaults: { state: 'closed', closed: 'We are closed right now', closedSub: 'Pre-order now and pick up when we open.', offline: 'We can’t take orders right now', offlineSub: 'Please order at the cashier. We’re fixing it.', sold: 'Sold out for today', soldSub: 'Back tomorrow morning. Try something else?', preorder: true },
    fields: (_c, g) => [f.seg('state', 'Edit page', 'closed:Closed|offline:Offline|sold:Sold out', 3), f.text(String(g.state), 'Headline'), f.area(g.state + 'Sub', 'Message'), ...(g.state === 'closed' ? [f.tog('preorder', 'Allow pre-orders while closed')] : [])],
    preview: (g, ctx) => { const o = ctx.db.outlets.find(x => x.id === ctx.outletId)!, st = String(g.state), sold = guestProducts(ctx.db, ctx.outletId).filter(x => x.sold);
      return <Page ctx={ctx}><div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center', paddingTop: 40 }}><Icon name={st === 'closed' ? 'moon' : st === 'offline' ? 'wifi-off' : 'circle-slash'} size={40} />
        <H ctx={ctx}>{String(g[st])}</H><p style={{ opacity: .8 }}>{String(g[st + 'Sub'])}</p>{st === 'closed' && <Tag tone="sold">Opens {o.opens} · closes {o.closes}</Tag>}
        {st === 'sold' && <p style={{ fontSize: 13 }}>{sold.length ? 'Sold out now: ' + sold.map(x => x.p.name).join(', ') : 'Nothing is sold out right now.'}</p>}
        {st === 'closed' && g.preorder && <GBtn d={ctx.d}>Pre-order for later</GBtn>}{st !== 'closed' && <GBtn d={ctx.d} ghost>Back to menu</GBtn>}</div></Page>; } },

  { key: 'feedback-and-rating-page', label: 'Feedback & rating page', icon: 'star', device: 'phone', defaults: { q: 'How was your visit?', tags: 'Taste,Speed,Friendly staff,Cleanliness,Value', low: true, reward: '20 beans for your feedback' },
    fields: () => [f.text('q', 'Question'), f.text('tags', 'Quick tags (comma separated)'), f.tog('low', 'Send 1–2 stars to the manager', 'Private, not posted'), f.text('reward', 'Thank-you reward')],
    preview: (g, ctx) => { const rs = ctx.db.reviews, avg = rs.length ? rs.reduce((a, r) => a + r.stars, 0) / rs.length : 0;
      return <Page ctx={ctx} title="Feedback"><H ctx={ctx}>{String(g.q)}</H><div style={{ display: 'flex', gap: 6, fontSize: 34, color: 'var(--bn-acc)' }}>{[1, 2, 3, 4, 5].map(i => <span key={i}>{i <= 4 ? '★' : '☆'}</span>)}</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{ids(g.tags).map((t, i) => <Tag key={t} tone={i < 2 ? 'acc' : 'sold'}>{t}</Tag>)}</div><Box>Tell us more (optional)</Box>
        <span style={{ fontSize: 13 }}>{String(g.reward)}</span><GBtn d={ctx.d}>Send feedback</GBtn><span style={{ fontSize: 12, opacity: .6 }}>Average so far {avg.toFixed(1)} from {rs.length} reviews</span></Page>; } },

  { key: 'queue-pickup-screen', label: 'Queue & pickup screen', icon: 'list-ordered', device: 'desktop', defaults: { head: 'Order status', ready: 'Ready for pickup', prep: 'Preparing', sound: true, show: 8 },
    fields: () => [f.text('head', 'Title'), f.text('prep', 'Preparing column'), f.text('ready', 'Ready column'), f.range('show', 'Numbers per column', 4, 16, 1), f.tog('sound', 'Chime when ready')],
    preview: (g, ctx) => { const os = ctx.db.orders.filter(o => o.outletId === ctx.outletId && !o.id.startsWith('h')), prep = os.filter(o => ['sent', 'preparing'].includes(o.status)), ready = os.filter(o => o.status === 'ready');
      const col = (t: string, list: typeof os, hi: boolean) => <div style={{ flex: 1, padding: 24, display: 'flex', flexDirection: 'column', gap: 12, background: hi ? 'var(--bn-p)' : 'transparent', color: hi ? 'var(--bn-on-p)' : 'inherit' }}><b style={{ fontSize: 28 }}>{t}</b>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 12 }}>{list.slice(0, Number(g.show)).map(o => <b key={o.id} className="num" style={{ fontSize: 44, fontFamily: 'var(--bn-font)' }}>{o.no.replace(/\D/g, '').slice(-3)}</b>)}</div>{!list.length && <span style={{ opacity: .6, fontSize: 20 }}>None right now</span>}</div>;
      return <Guest d={ctx.d} dark style={{ height: '100%', display: 'flex', flexDirection: 'column' }}><div style={{ padding: '18px 24px', display: 'flex', justifyContent: 'space-between' }}><H ctx={ctx} size={30}>{String(g.head)}</H><b>{ctx.d.name}</b></div>
        <div style={{ flex: 1, display: 'flex' }}>{col(String(g.prep), prep, false)}{col(String(g.ready), ready, true)}</div></Guest>; } },

  { key: 'menu-board-tv-digital-signage', label: 'Menu board TV', icon: 'tv', device: 'desktop', defaults: { cols: 3, photos: true, dark: true, promo: true },
    fields: () => [f.seg('cols', 'Columns', '2:2|3:3|4:4'), f.tog('photos', 'Show photos'), f.tog('dark', 'Dark board'), f.tog('promo', 'Promo strip at the bottom')],
    preview: (g, ctx) => { const all = guestProducts(ctx.db, ctx.outletId), cats = ctx.db.categories.filter(c => all.some(x => x.p.categoryId === c.id)).slice(0, Number(g.cols));
      return <Guest d={ctx.d} dark={!!g.dark} style={{ height: '100%', padding: 28, display: 'flex', flexDirection: 'column', gap: 18 }}><H ctx={ctx} size={36}>{ctx.d.name}</H>
        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: `repeat(${cats.length},1fr)`, gap: 24 }}>{cats.map(c => <div key={c.id} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}><b style={{ fontSize: 22, color: 'var(--bn-acc)' }}>{c.name}</b>
          {all.filter(x => x.p.categoryId === c.id).slice(0, 6).map(x => <div key={x.p.id} style={{ display: 'flex', gap: 10, alignItems: 'center', opacity: x.sold ? .4 : 1 }}>{g.photos && <span style={{ width: 44, height: 44, borderRadius: 10, background: photoOf(x.p), flex: 'none' }} />}<span style={{ flex: 1, fontSize: 17 }}>{x.p.name}{x.sold ? ' · sold out' : ''}</span><b style={{ fontSize: 17 }}>{Math.round((x.flash ?? x.price) / 1000)}k</b></div>)}</div>)}</div>
        {g.promo && <div style={{ padding: '10px 16px', borderRadius: 12, background: 'var(--bn-acc)', color: 'var(--bn-on-acc)', fontWeight: 700 }}>{ctx.d.copy.announce?.en}</div>}</Guest>; } },

  { key: 'printable-menu-pdf-generator', label: 'Printable menu (PDF)', icon: 'printer', device: 'print', defaults: { size: 'a4', cols: 2, desc: true, prices: true, footer: 'Prices include 10% PB1 where stated · Ask us about allergens' },
    fields: () => [f.seg('size', 'Paper', 'a4:A4|a5:A5|letter:Letter'), f.seg('cols', 'Columns', '1:1|2:2'), f.tog('desc', 'Descriptions'), f.tog('prices', 'Prices'), f.text('footer', 'Footer line'), f.note('Print or “Save as PDF” from the button above the preview.')],
    preview: (g, ctx) => { const all = guestProducts(ctx.db, ctx.outletId), cats = ctx.db.categories.filter(c => all.some(x => x.p.categoryId === c.id));
      return <Guest d={ctx.d} style={{ width: g.size === 'a5' ? 420 : 595, minHeight: g.size === 'a5' ? 595 : 842, padding: 40, background: WHITE, color: 'var(--ink-950)', display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={{ textAlign: 'center' }}><H ctx={ctx} size={30}>{ctx.d.name}</H><span style={{ fontSize: 12 }}>{ctx.d.tagline}</span></div>
        <div style={{ columns: Number(g.cols), columnGap: 28, flex: 1 }}>{cats.map(c => <div key={c.id} style={{ breakInside: 'avoid', marginBottom: 16 }}><b style={{ fontFamily: 'var(--bn-font)', fontSize: 16, color: 'var(--bn-p-text)' }}>{c.name}</b>
          {all.filter(x => x.p.categoryId === c.id).map(x => <div key={x.p.id} style={{ display: 'flex', gap: 6, fontSize: 12, marginTop: 4 }}><span>{x.p.name}</span><span style={{ flex: 1, borderBottom: '1px dotted', margin: '0 4px 4px' }} />{g.prices && <b>{Math.round(x.price / 1000)}k</b>}</div>)}</div>)}</div>
        <span style={{ fontSize: 10, textAlign: 'center' }}>{String(g.footer)}</span></Guest>; } },

  { key: 'qris-payment-page-on-customer-phone', label: 'QRIS payment page', icon: 'qr-code', device: 'phone', defaults: { timer: 5, steps: true, save: true },
    fields: () => [f.range('timer', 'Code valid for', 1, 15, 1, ' min'), f.tog('steps', 'Show how-to steps'), f.tog('save', 'Show “Save QR to gallery”'), f.note('QRIS marks and the payment code are locked; only the page around them follows your brand.')],
    preview: (g, ctx) => { const o = ctx.db.orders.filter(x => x.outletId === ctx.outletId && x.lines.length).sort((a, b) => b.createdAt - a.createdAt)[0], total = o?.total ?? 0;
      return <Page ctx={ctx} title="Pay with QRIS"><div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center' }}><span style={{ fontSize: 13, opacity: .7 }}>{o?.no}</span><b style={{ fontSize: 30, fontFamily: 'var(--bn-font)' }}>{idr(total)}</b>
        <span style={{ padding: 12, background: WHITE, borderRadius: 16, boxShadow: '0 0 0 1px var(--bn-line)' }} title="Sample · live codes come from the payment gateway"><QR value={`QRIS sample ${o?.no ?? ''} ${total}`} size={190} fg="var(--ink-950)" bg={WHITE} /></span>
        <Tag tone="sold"><Icon name="lock" size={10} /> QRIS · code valid {String(g.timer)}:00</Tag>
        {g.steps && <ol style={{ textAlign: 'left', fontSize: 13, paddingLeft: 18, margin: 0 }}><li>Open any bank or e-wallet app</li><li>Scan or upload this code</li><li>Check the amount and pay</li></ol>}
        {g.save && <GBtn d={ctx.d} ghost>Save QR to gallery</GBtn>}</div></Page>; } },

  { key: 'checkout-flow-fields', label: 'Checkout fields', icon: 'list-checks', device: 'phone', defaults: { name: 'required', phone: 'optional', notes: true, tips: false, pickup: true, member: true },
    fields: () => [f.seg('name', 'Name', 'required:Required|optional:Optional|off:Hidden', 3), f.seg('phone', 'WhatsApp number', 'required:Required|optional:Optional|off:Hidden', 3), f.tog('notes', 'Order notes'), f.tog('tips', 'Tips'), f.tog('pickup', 'Pickup time (takeaway)'), f.tog('member', 'Join member checkbox')],
    preview: (g, ctx) => { const o = ctx.db.outlets.find(x => x.id === ctx.outletId)!, items = guestProducts(ctx.db, ctx.outletId).slice(0, 2), t = orderTotals(items.map(x => ({ unitPrice: x.price, qty: 1 })), o);
      const field = (l: string, v: Val) => v !== 'off' && <Box key={l}>{l} <span style={{ fontSize: 11, opacity: .6 }}>{v === 'required' ? 'Required' : 'Optional'}</span></Box>;
      return <Page ctx={ctx} title="Checkout"><H ctx={ctx}>Almost done</H>{field('Name', g.name)}{field('WhatsApp number', g.phone)}{g.notes && <Box>Notes for the kitchen</Box>}{g.pickup && <Box>Pickup at · <b>ASAP</b></Box>}
        {g.tips && <div style={{ display: 'flex', gap: 6 }}>{['No tip', '5%', '10%'].map((x, i) => <span key={x} style={{ flex: 1, padding: 8, textAlign: 'center', borderRadius: 'var(--bn-r-sm)', boxShadow: `0 0 0 ${i ? 1 : 2}px ${i ? 'var(--bn-line)' : 'var(--bn-p)'}` }}>{x}</span>)}</div>}
        {g.member && <label style={{ fontSize: 13 }}><input type="checkbox" defaultChecked /> Join {String(ctx.d.mc.prog)} and earn {String(ctx.d.mc.pts)}</label>}<GBtn d={ctx.d}>Pay {idr(t.total)}</GBtn></Page>; } },

  { key: 'menu-and-price-per-channel', label: 'Menu & price per channel', icon: 'split', device: 'desktop', defaults: { dine: 0, take: 0, gofood: 20, grab: 20, shopee: 15, round: 500 },
    fields: () => [...CHANNELS.map(([k, l]) => f.range(k, l + ' markup', 0, 40, 1, '%')), f.seg('round', 'Round to', '100:IDR 100|500:IDR 500|1000:IDR 1,000'), f.note('Platform prices cover commission. Base prices stay owner-approved; markups publish with the menu.')],
    preview: (g, ctx) => { const all = guestProducts(ctx.db, ctx.outletId), r = Number(g.round);
      return <div style={{ padding: 24, background: WHITE, color: 'var(--ink-950)', height: '100%', overflow: 'auto' }}><table className="table"><thead><tr><th>Product</th>{CHANNELS.map(([k, l]) => <th key={k} className="r">{l}</th>)}</tr></thead>
        <tbody>{all.map(x => <tr key={x.p.id}><td>{x.p.name}</td>{CHANNELS.map(([k]) => <td key={k} className="r num">{idr(Math.ceil((x.price * (1 + Number(g[k]) / 100)) / r) * r)}</td>)}</tr>)}</tbody></table></div>; } },

  { key: 'custom-badges-and-allergen-diet-icons', label: 'Badges & allergen icons', icon: 'leaf', device: 'phone', defaults: { which: 'spicy', ...Object.fromEntries(BADGES.map(([k]) => [k, ''])), legend: true },
    fields: () => [f.seg('which', 'Edit badge', BADGES.map(([k, l]) => `${k}:${l}`).join('|'), 2), f.tog('legend', 'Show icon legend on the menu')],
    extra: (g, set, ctx) => <Picker label={'Products with “' + BADGES.find(b => b[0] === g.which)?.[1] + '”'} value={g[String(g.which)]} set={v => set(String(g.which), v)} ctx={ctx} />,
    preview: (g, ctx) => <Page ctx={ctx} title="Menu">{guestProducts(ctx.db, ctx.outletId).slice(0, 8).map(x => { const bs = BADGES.filter(([k]) => ids(g[k]).includes(x.p.id));
      return <div key={x.p.id} style={{ display: 'flex', gap: 10, alignItems: 'center' }}><span style={{ width: 48, height: 48, borderRadius: 10, background: photoOf(x.p), flex: 'none' }} /><span style={{ flex: 1 }}><b style={{ fontSize: 14 }}>{x.p.name}</b><br /><span style={{ display: 'inline-flex', gap: 6 }}>{bs.map(([k, l, ic]) => <span key={k} title={l} style={{ display: 'inline-flex' }}><Icon name={ic} size={14} /></span>)}</span></span><b>{idr(x.price)}</b></div>; })}
      {g.legend && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, fontSize: 12, opacity: .8 }}>{BADGES.map(([k, l, ic]) => <span key={k} style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}><Icon name={ic} size={12} />{l}</span>)}</div>}</Page> },

  { key: 'voucher-and-promo-visuals', label: 'Voucher & promo visuals', icon: 'ticket', device: 'phone', defaults: { shape: 'ticket', fill: 'outline', code: true, expiry: true },
    fields: () => [f.seg('shape', 'Shape', 'ticket:Ticket|card:Card|pill:Pill', 3), f.seg('fill', 'Fill', 'outline:Outline|brand:Brand|accent:Accent', 3), f.tog('code', 'Show code'), f.tog('expiry', 'Show quota left')],
    preview: (g, ctx) => <Page ctx={ctx} title="Vouchers">{ctx.db.promos.filter(p => p.kind !== 'flash').map(p => { const filled = g.fill !== 'outline';
      return <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 14, borderRadius: g.shape === 'pill' ? 999 : 'var(--bn-r)', border: g.shape === 'ticket' ? '2px dashed var(--bn-p)' : filled ? 0 : '1.5px solid var(--bn-line)', background: g.fill === 'brand' ? 'var(--bn-p)' : g.fill === 'accent' ? 'var(--bn-acc)' : 'var(--bn-surface)', color: g.fill === 'brand' ? 'var(--bn-on-p)' : g.fill === 'accent' ? 'var(--bn-on-acc)' : 'var(--bn-ink)' }}>
        <b style={{ fontFamily: 'var(--bn-font)', fontSize: 24, minWidth: 72 }}>{p.kind === 'pct' ? p.value + '%' : Math.round(p.value / 1000) + 'k'}</b><span style={{ flex: 1, fontSize: 13 }}><b>{p.name}</b>{p.minSpend ? <><br />Min. spend {idr(p.minSpend)}</> : null}{g.expiry && p.quota ? <><br />{p.quota - (p.used ?? 0)} left</> : null}</span>{g.code && p.code && <span className="mono" style={{ fontSize: 12 }}>{p.code}</span>}</div>; })}</Page> },

  { key: 'multi-page-online-store-link-in-bio', label: 'Online store & link in bio', icon: 'link', device: 'phone', defaults: { handle: '@kopibiru.id', order: true, book: true, gift: true, wa: true, maps: true, store: 'kopibiru' },
    fields: () => [f.text('handle', 'Handle'), f.text('store', 'Store address', 'order.bornis.id/<this>'), f.tog('order', 'Order online'), f.tog('book', 'Book a table'), f.tog('gift', 'Gift cards'), f.tog('wa', 'WhatsApp'), f.tog('maps', 'Google Maps (each outlet)')],
    preview: (g, ctx) => <Guest d={ctx.d} style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center', textAlign: 'center' }}>
      <span style={{ width: 84, height: 84, borderRadius: 99, background: ctx.d.media.logo ? `var(--bn-surface) url(${ctx.d.media.logo}) center/70% no-repeat` : 'var(--bn-banner)' }} /><H ctx={ctx}>{String(g.handle)}</H><p style={{ fontSize: 13, opacity: .75 }}>{ctx.d.tagline}</p>
      {[['order', 'Order online'], ['book', 'Book a table'], ['gift', 'Gift cards'], ['wa', 'Chat on WhatsApp']].filter(([k]) => g[k]).map(([k, l], i) => <GBtn key={k} d={ctx.d} ghost={i > 0} style={{ width: '100%' }}>{l}</GBtn>)}
      {g.maps && ctx.db.outlets.map(o => <GBtn key={o.id} d={ctx.d} ghost style={{ width: '100%' }}><Icon name="map-pin" size={16} />{o.name}</GBtn>)}
      <span className="mono" style={{ fontSize: 11, opacity: .6 }}>{origin().replace(/^https?:\/\//, '')}/{String(g.store)}</span></Guest> },
];
