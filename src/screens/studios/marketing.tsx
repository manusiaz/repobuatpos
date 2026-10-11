'use client';
// Marketing studio: vouchers (from real promos), gift cards, push, referral page, ad pixels & SEO.
import { idr } from '../../domain/money.ts';
import { Icon, hhmm } from '../../ui/kit.tsx';
import { Caption, F, first, onColor, Phone, Stage, themeColor, themeSwatches, type PP, type Tool, type V, type Ctx } from './core.tsx';

const promoOf = (x: Ctx, v: V) => x.db.promos.find(p => p.id === v.promo) ?? x.db.promos.find(p => p.code) ?? x.db.promos[0];
const offer = (p: ReturnType<typeof promoOf>) => !p ? '' : p.kind === 'pct' ? `${p.value}% off` : p.kind === 'amount' ? `${idr(p.value)} off` : `Now ${idr(p.value)}`;

function Voucher({ v, x }: PP) {
  const t = x.db.theme, c = themeColor(t, v.color), fg = onColor(c, t.ink), p = promoOf(x, v);
  const exp = p?.endsAt ? 'Valid until ' + new Date(p.endsAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ' ' + hhmm(p.endsAt) : p?.quota ? `${(p.quota - (p.used ?? 0)).toLocaleString('en-US')} of ${p.quota.toLocaleString('en-US')} left` : '';
  const title = v.title || p?.name, detail = v.val || `${offer(p)}${p?.minSpend ? ` · min. spend ${idr(p.minSpend)}` : ''}`;
  return <Stage><div data-guest style={{ fontFamily: 'var(--bn-font)', width: 'min(340px,100%)' }}>
    {v.style === 'ticket' && <div style={{ display: 'flex', borderRadius: 16, overflow: 'hidden', background: c, color: fg, boxShadow: 'var(--shadow-e2)' }}>
      <div style={{ flex: 1, padding: 18, display: 'flex', flexDirection: 'column', gap: 6 }}><b style={{ fontSize: 22 }}>{title}</b><span>{detail}</span><span style={{ fontSize: 12, opacity: .85 }}>{exp}</span></div>
      <div style={{ width: 96, borderLeft: `2px dashed ${fg}`, display: 'grid', placeItems: 'center', writingMode: 'vertical-rl', fontWeight: 800, letterSpacing: '.1em' }}>{p?.code ?? '—'}</div></div>}
    {v.style === 'card' && <div style={{ borderRadius: 20, padding: 22, background: c, color: fg, display: 'flex', flexDirection: 'column', gap: 10, boxShadow: 'var(--shadow-e2)', minHeight: 190 }}>
      <span style={{ fontSize: 12, opacity: .85 }}>{t.name}</span><b style={{ fontSize: 26 }}>{title}</b><span>{detail}</span>
      <span style={{ marginTop: 'auto', alignSelf: 'flex-start', padding: '6px 12px', borderRadius: 8, background: fg, color: c, fontWeight: 800, letterSpacing: '.08em' }}>{p?.code ?? '—'}</span></div>}
    {v.style === 'stamp' && <div style={{ borderRadius: 20, padding: 18, background: t.paper, color: t.ink, boxShadow: 'var(--shadow-e2)', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <b style={{ fontSize: 20 }}>{title}</b><span style={{ fontSize: 13 }}>Collect 10 stamps · {detail}</span>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 8 }}>{Array.from({ length: 10 }, (_, i) => <span key={i} style={{ aspectRatio: '1', borderRadius: 99, border: `2px solid ${c}`, background: i < 6 ? c : 'transparent', color: fg, display: 'grid', placeItems: 'center' }}>{i < 6 && <Icon name="coffee" size={16} />}</span>)}</div></div>}
  </div><Caption>Promo “{p?.name}” from Promos & vouchers: used {p?.used ?? 0}{p?.quota ? ` of ${p.quota}` : ''} times. Same design on the self-order app, e-receipts and WhatsApp.</Caption></Stage>;
}

function Gift({ v, x }: PP) {
  const t = x.db.theme, c = themeColor(t, v.color);
  const bg = v.style === 'minimal' ? 'var(--ink-0)' : v.style === 'photo' ? `linear-gradient(180deg,transparent,rgba(20,18,16,.6)),linear-gradient(135deg,${t.acc},${c})` : `linear-gradient(135deg,${c},${t.ink})`;
  const fg = v.style === 'minimal' ? t.ink : 'var(--ink-0)';
  return <Stage><div data-guest style={{ width: 'min(360px,100%)', aspectRatio: '1.6', borderRadius: 20, padding: 22, background: bg, color: fg, border: v.style === 'minimal' ? '1px solid var(--border)' : 0, boxShadow: 'var(--shadow-e2)', display: 'flex', flexDirection: 'column', gap: 8, fontFamily: 'var(--bn-font)' }}>
    <div className="row between"><b>{t.name}</b><span style={{ fontSize: 12 }}>GIFT CARD</span></div>
    <b style={{ fontSize: 30, marginTop: 'auto' }}>{idr(Number(v.amt))}</b><span style={{ fontSize: 13 }}>{v.msg}</span><span style={{ fontSize: 12, opacity: .85 }}>From {v.from}</span>
  </div><Caption>Sold at the POS and online; the balance works at all {x.db.outlets.length} outlets.</Caption></Stage>;
}

function Push({ v, x }: PP) {
  const t = x.db.theme;
  return <Stage><Phone theme={t} bg={`linear-gradient(160deg,${t.ink},${t.p})`}>
    <div style={{ padding: '40px 16px 0', color: 'var(--ink-0)', textAlign: 'center' }}><b style={{ fontSize: 54, fontFamily: 'var(--font-display)' }}>{v.when === 'sched' ? '08:00' : hhmm(Date.now())}</b></div>
    <div style={{ margin: 14, padding: 12, borderRadius: 18, background: 'color-mix(in srgb,var(--ink-0) 88%,transparent)', color: 'var(--ink-950)', display: 'flex', gap: 10 }}>
      <span style={{ width: 36, height: 36, borderRadius: 9, background: t.p, color: onColor(t.p, t.ink), display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 12, flex: 'none' }}>{t.name.split(' ').map(w => w[0]).join('')}</span>
      <div style={{ flex: 1, minWidth: 0, fontSize: 13 }}><div className="row between"><b>{v.title}</b><span style={{ opacity: .6, fontSize: 11 }}>{v.when === 'sched' ? 'scheduled' : 'now'}</span></div><span>{v.body}</span>
        {v.img && <div style={{ height: 90, marginTop: 8, borderRadius: 10, background: `linear-gradient(135deg,${t.acc},${t.p})` }} />}</div></div>
  </Phone><Caption>Tapping opens the {v.link} screen in the member app. {v.when === 'auto' ? 'Sent by an automation.' : ''}</Caption></Stage>;
}

function Referral({ v, x }: PP) {
  const t = x.db.theme, c = themeColor(t, v.color), fg = onColor(c, t.ink), cu = x.db.customers[0];
  const code = (first(cu?.name) + (cu?.id ?? '').replace(/\D/g, '').padStart(2, '0')).toUpperCase();
  return <Stage><Phone theme={t}>
    <div style={{ padding: 24, background: c, color: fg, display: 'flex', flexDirection: 'column', gap: 8 }}><span style={{ fontSize: 12 }}>{t.name} · Refer a friend</span><b style={{ fontSize: 26, fontFamily: 'var(--bn-font)' }}>{v.head}</b></div>
    <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12, fontSize: 14 }}>
      <div className="row" style={{ gap: 10 }}><Icon name="gift" /><span>You get <b>{v.you}</b></span></div>
      <div className="row" style={{ gap: 10 }}><Icon name="user-plus" /><span>Your friend gets <b>{v.friend}</b></span></div>
      <div style={{ padding: 14, borderRadius: 14, border: '2px dashed var(--bn-p)', textAlign: 'center' }}><span style={{ fontSize: 12 }}>Your code</span><br /><b style={{ fontSize: 22, letterSpacing: '.1em' }}>{code}</b></div>
      <button style={{ height: 48, borderRadius: 14, border: 0, background: c, color: fg, fontWeight: 700 }}>Share on WhatsApp</button>
      <span style={{ fontSize: 12, opacity: .7 }}>You can invite up to {v.cap} friends. Reward after the friend’s first paid order of IDR 30,000 or more.</span>
    </div></Phone><Caption>Shown for {cu?.name}, a real member.</Caption></Stage>;
}

function Pixels({ v, x }: PP) {
  const page = { home: ['Home', ''], menu: ['Menu', '/menu'], promo: ['Promos', '/promo'] }[v.page as 'home'];
  const host = 'order.' + x.db.tenant.name.toLowerCase().replace(/\s/g, '') + '.id';
  return <Stage>
    <div className="card" style={{ width: 'min(560px,100%)' }}><span className="faint" style={{ fontSize: 12 }}>{host}{page[1]}</span>
      <b style={{ display: 'block', color: 'var(--info-fg)', fontSize: 18, fontWeight: 500 }}>{v['t_' + v.page] || `${page[0]} · ${x.db.tenant.name}`}</b>
      <p className="muted" style={{ fontSize: 14 }}>{(v['d_' + v.page] || '').slice(0, 160)}</p></div>
    <div className="card flat" style={{ width: 'min(560px,100%)' }}><div style={{ height: 160, background: `linear-gradient(135deg,${x.db.theme.p},${x.db.theme.ink})` }} />
      <div style={{ padding: 12 }}><span className="faint" style={{ fontSize: 12 }}>{host.toUpperCase()}</span><br /><b>{v['t_' + v.page] || x.db.tenant.name}</b></div></div>
    <div className="row wrap">{[['Meta pixel', v.meta], ['TikTok pixel', v.tiktok], ['Google Analytics 4', v.ga]].map(([l, id]) => <span key={l} className={'badge' + (id ? ' b-success' : '')}>{l}{id ? ' · on' : ' · off'}</span>)}</div>
    <Caption>Pixels fire on menu, cart and order-placed events only. They never load on payment pages.</Caption>
  </Stage>;
}

export const MARKETING: Tool[] = [
  { id: 'voucher', group: 'MARKETING', name: 'Voucher & promo design', icon: 'ticket', plan: 'free', desc: 'Design how vouchers look in the self-order app, on e-receipts and in WhatsApp.', def: { promo: '', style: 'ticket', title: '', val: '', color: 'primary' }, Preview: Voucher,
    pairs: (v, x) => { const c = themeColor(x.db.theme, v.color); return [[onColor(c, x.db.theme.ink), c, 'Voucher text']]; },
    fields: (_, x) => [F.select('Promo', 'promo', [['', 'First promo with a code'], ...x.db.promos.map(p => [p.id, p.name] as [string, string])]), F.seg('Style', 'style', [['ticket', 'Ticket'], ['card', 'Card'], ['stamp', 'Stamp']]), F.text('Title', 'title', 'Promo name'), F.text('Detail', 'val', 'From the promo rules'), F.swatch('Color', 'color', themeSwatches(x.db.theme)), F.note('Code, value and expiry come from Promos & vouchers; edit them there.')] },
  { id: 'gift', group: 'MARKETING', name: 'Gift card design', icon: 'gift', plan: 'pro', desc: 'Digital and printed gift cards customers can buy and send.', def: { style: 'brand', amt: '200000', msg: 'Happy birthday! Coffee is on me.', from: 'Dewi', color: 'primary' }, Preview: Gift,
    fields: (_, x) => [F.seg('Design', 'style', [['brand', 'Brand'], ['photo', 'Photo'], ['minimal', 'Minimal']]), F.seg('Amount', 'amt', [['100000', '100k'], ['200000', '200k'], ['500000', '500k']]), F.area('Message', 'msg'), F.text('From', 'from'), F.swatch('Color', 'color', themeSwatches(x.db.theme))] },
  { id: 'push', group: 'MARKETING', name: 'Push notifications', icon: 'bell-ring', plan: 'enterprise', desc: 'Notifications for the member app: promos, points and order status.', def: { title: 'Your order is ready', body: 'Pick it up at the counter. Selamat menikmati!', img: false, link: 'order', when: 'now' }, Preview: Push,
    fields: () => [F.text('Title', 'title'), F.area('Body', 'body'), F.toggle('Image', 'img'), F.seg('Opens', 'link', [['order', 'Order'], ['promo', 'Promo'], ['menu', 'Menu'], ['points', 'Points']]), F.seg('Send', 'when', [['now', 'Now'], ['sched', 'Schedule'], ['auto', 'Automation']])] },
  { id: 'referral', group: 'MARKETING', name: 'Referral program page', icon: 'users-round', plan: 'pro', desc: 'Members share a link. Both people get a reward after the friend’s first purchase.', def: { head: 'Give 25k, get 25k', you: 'IDR 25,000 credit', friend: 'IDR 25,000 off first order', cap: 10, color: 'primary' }, Preview: Referral,
    pairs: (v, x) => { const c = themeColor(x.db.theme, v.color); return [[onColor(c, x.db.theme.ink), c, 'Headline on color']]; },
    fields: (_, x) => [F.text('Headline', 'head'), F.text('You get', 'you'), F.text('Friend gets', 'friend'), F.range('Max referrals per member', 'cap', 1, 50, 1), F.swatch('Color', 'color', themeSwatches(x.db.theme))] },
  { id: 'pixels', group: 'MARKETING', name: 'Ad pixels & SEO per page', icon: 'scan-search', plan: 'basic', desc: 'Meta, TikTok and Google Analytics tags, plus the title and description search engines show for each page.', def: { meta: '', tiktok: '', ga: '', page: 'home', t_home: '', d_home: 'Order ahead, skip the queue and earn beans.', t_menu: '', d_menu: '', t_promo: '', d_promo: '' }, Preview: Pixels,
    fields: v => [F.text('Meta pixel ID', 'meta', '1234567890'), F.text('TikTok pixel ID', 'tiktok', 'C4XXXX'), F.text('GA4 measurement ID', 'ga', 'G-XXXXXXX'), F.head('SEO'), F.seg('Page', 'page', [['home', 'Home'], ['menu', 'Menu'], ['promo', 'Promos']]), F.text('Title', 't_' + v.page, 'Page · Brand', `${String(v['t_' + v.page] ?? '').length}/60`), F.area('Description', 'd_' + v.page)] },
];
