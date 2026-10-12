'use client';
// Marketing studio: vouchers (from real promos), gift cards, push, referral page, ad pixels & SEO.
import { same } from './same.tsx';
import { TOOL_DEFAULTS } from '../../system/tools.ts';
import { hhmm } from '../../ui/kit.tsx';
import { Caption, F, onColor, Phone, Stage, type PP, type Tool } from './core.tsx';


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
  { id: 'voucher', group: 'MARKETING', name: 'Voucher & promo design', icon: 'ticket', plan: 'free', desc: 'Design how vouchers look in the self-order app, on e-receipts and in WhatsApp.', ...same('voucher-and-promo-visuals') },
  { id: 'gift', group: 'MARKETING', name: 'Gift card design', icon: 'gift', plan: 'pro', desc: 'Digital and printed gift cards customers can buy and send.', ...same('gift-card-designer') },
  { id: 'push', group: 'MARKETING', name: 'Push notifications', icon: 'bell-ring', plan: 'enterprise', desc: 'Notifications for the member app: promos, points and order status.', def: { ...TOOL_DEFAULTS.push }, Preview: Push,
    fields: () => [F.text('Title', 'title'), F.area('Body', 'body'), F.toggle('Image', 'img'), F.seg('Opens', 'link', [['order', 'Order'], ['promo', 'Promo'], ['menu', 'Menu'], ['points', 'Points']]), F.seg('Send', 'when', [['now', 'Now'], ['sched', 'Schedule'], ['auto', 'Automation']])] },
  { id: 'referral', group: 'MARKETING', name: 'Referral program page', icon: 'users-round', plan: 'pro', desc: 'Members share a link. Both people get a reward after the friend’s first purchase.', ...same('referral-page') },
  { id: 'pixels', group: 'MARKETING', name: 'Ad pixels & SEO per page', icon: 'scan-search', plan: 'basic', desc: 'Meta, TikTok and Google Analytics tags, plus the title and description search engines show for each page.', def: { ...TOOL_DEFAULTS.pixels }, Preview: Pixels,
    fields: v => [F.text('Meta pixel ID', 'meta', '1234567890'), F.text('TikTok pixel ID', 'tiktok', 'C4XXXX'), F.text('GA4 measurement ID', 'ga', 'G-XXXXXXX'), F.head('SEO'), F.seg('Page', 'page', [['home', 'Home'], ['menu', 'Menu'], ['promo', 'Promos']]), F.text('Title', 't_' + v.page, 'Page · Brand', `${String(v['t_' + v.page] ?? '').length}/60`), F.area('Description', 'd_' + v.page)] },
];
