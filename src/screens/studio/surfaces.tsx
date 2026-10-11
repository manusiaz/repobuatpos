'use client';
import { linkTo } from '../../system/hosts.ts';
// Menu Studio previews outside the QR menu: receipt & e-receipt, customer display, kiosk attract, QR table stand, member card.
// All of them render real store data (last order at the outlet, open cart, members, outlet tables).
import type { CSSProperties, ReactNode } from 'react';
import type { DB, Order } from '../../data/schema.ts';
import { idr } from '../../domain/money.ts';
import { balance, tierOf, TIERS } from '../../domain/loyalty.ts';
import { Icon } from '../../ui/kit.tsx';
import type { MenuDesign } from '../../data/actions/studio.ts';
import { Guest, GBtn, gh, photoOf, promoCards, PromoCardView, type GuestCtx } from './guest.tsx';
import { onColor, darken } from './theme.ts';
import { QR } from '../../ui/qr.tsx';

const WHITE = 'var(--ink-0)', INK = 'var(--ink-950)';
// Print card fills must be real colours for the contrast maths; these equal --ink-0 / --ink-950.
const PAPER_HEX = '#FFFFFF', INK_HEX = '#141210';
/** Table link encoded in every table QR (scan landing detects the table and outlet). */
export const tableUrl = (outletId: string, n: number) => linkTo(`/order?t=${String(n).padStart(2, '0')}&o=${outletId}`);
const lastOrder = (db: DB, outletId: string, open = false): Order | undefined =>
  db.orders.filter(o => o.outletId === outletId && o.lines.length && (open ? ['open', 'sent', 'paying'].includes(o.status) : o.status === 'paid')).sort((a, b) => b.createdAt - a.createdAt)[0];
const initials = (n: string) => n.split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();

export function ReceiptPreview({ ctx }: { ctx: GuestCtx }) {
  const { d, db, outletId } = ctx, rc = d.rc, o = lastOrder(db, outletId), outlet = db.outlets.find(x => x.id === outletId)!;
  const w = rc.paper === '58' ? 236 : 316, fs = rc.paper === '58' ? 11 : 12;
  const pts = o ? Math.floor(o.subtotal / 1000) : 0;
  const url = rc.qr === 'feedback' ? linkTo(`/order/customer-links/feedback-and-rating?o=${o?.id ?? ''}`) : rc.qr === 'member' ? linkTo('/order/customer-links/member-card-and-points') : tableUrl(outletId, 1);
  const Row = ({ l, r, b }: { l: ReactNode; r: ReactNode; b?: boolean }) => <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontWeight: b ? 700 : 400 }}><span>{l}</span><span>{r}</span></div>;
  return <div className="row wrap" style={{ alignItems: 'flex-start', justifyContent: 'center', gap: 20 }}>
    <div className="mono" style={{ width: w, background: WHITE, color: INK, padding: '16px 14px', fontSize: fs, lineHeight: 1.5, boxShadow: 'var(--shadow-e2)', display: 'flex', flexDirection: 'column', gap: 6 }} aria-label={`${rc.paper} mm thermal receipt`}>
      {rc.logo && <span style={{ alignSelf: 'center', width: 56, height: 56, borderRadius: 12, background: d.media.logo ? `url(${d.media.logo}) center/80% no-repeat` : INK, color: WHITE, display: 'grid', placeItems: 'center', fontWeight: 800, filter: 'grayscale(1) contrast(1.4)' }}>{!d.media.logo && initials(d.name)}</span>}
      <b style={{ textAlign: 'center', fontSize: fs + 2 }}>{d.name} {outlet.name}</b>
      {rc.h1 && <span style={{ textAlign: 'center' }}>{String(rc.h1)}</span>}
      <span style={{ textAlign: 'center', opacity: .75 }} title="Locked legal line"><Icon name="lock" size={10} /> NPWP 01.234.567.8-901.000</span>
      <span style={{ borderTop: '1px dashed', margin: '4px 0' }} />
      {o ? <>
        <Row l={o.no} r={new Date(o.paidAt ?? o.createdAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })} />
        {o.lines.map(l => <Row key={l.id} l={`${l.qty}× ${l.name}`} r={((l.flashPrice ?? l.unitPrice) * l.qty).toLocaleString('en-US')} />)}
        <span style={{ borderTop: '1px dashed', margin: '4px 0' }} />
        <Row l="Subtotal" r={o.subtotal.toLocaleString('en-US')} />{o.discount > 0 && <Row l="Discount" r={'−' + o.discount.toLocaleString('en-US')} />}
        {o.service > 0 && <Row l="Service" r={o.service.toLocaleString('en-US')} />}
        <Row l={<span title="Locked legal line"><Icon name="lock" size={10} /> PB1 {outlet.taxBps / 100}%{outlet.taxInclusive ? ' incl.' : ''}</span>} r={o.tax.toLocaleString('en-US')} />
        <Row l="TOTAL" r={idr(o.total)} b />
        {rc.points && o.customerId && <Row l={`+${pts} ${d.mc.pts}`} r="Member" />}
      </> : <span style={{ textAlign: 'center' }}>No paid orders at {outlet.name} yet. Your first sale prints like this.</span>}
      <span style={{ borderTop: '1px dashed', margin: '4px 0' }} />
      <span style={{ alignSelf: 'center' }}><QR value={url} size={rc.paper === '58' ? 96 : 116} fg={INK} bg={WHITE} /></span>
      <span style={{ textAlign: 'center' }}>{{ feedback: 'Scan to rate your visit', menu: 'Scan to reorder from your table', member: 'Scan to join and earn points' }[String(rc.qr)]}</span>
      {rc.wifiOn && <span style={{ textAlign: 'center' }}>Wi-Fi {String(rc.wifi)}</span>}
      {rc.social && <span style={{ textAlign: 'center' }}>{d.copy.insta?.en}</span>}
      {[rc.f1, rc.f2].filter(Boolean).map((x, i) => <span key={i} style={{ textAlign: 'center' }}>{String(x)}</span>)}
    </div>
    <Guest d={d} style={{ width: 300, minHeight: 0, borderRadius: 18, overflow: 'hidden', boxShadow: 'var(--shadow-e2)' }}>
      <div style={{ background: 'var(--bn-p)', color: 'var(--bn-on-p)', padding: '10px 14px', fontSize: 12, fontWeight: 700 }}>E-RECEIPT · {{ wa: 'WHATSAPP', email: 'EMAIL', both: 'WHATSAPP + EMAIL' }[String(rc.ch)]}</div>
      <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 8, fontSize: 14 }}>
        <b style={{ ...gh(d), fontSize: 18 }}>{String(rc.thanks)}</b>
        {o ? <><span>{o.no} · {idr(o.total)}</span>{o.lines.slice(0, 3).map(l => <span key={l.id} style={{ opacity: .8 }}>{l.qty}× {l.name}</span>)}</> : <span>Your receipt appears here.</span>}
        {rc.points && <span style={{ color: 'var(--bn-p-text)', fontWeight: 700 }}>+{pts} {String(d.mc.pts)} earned</span>}
        <GBtn d={d}>Rate your visit</GBtn>
      </div>
    </Guest>
  </div>;
}

export function DisplayPreview({ ctx, view }: { ctx: GuestCtx; view: 'idle' | 'cart' }) {
  const { d, db, outletId } = ctx, dc = d.dc;
  const bg = dc.bg === 'dark' ? INK : dc.bg === 'brand' ? darken(d.p) : d.paper;
  const fg = dc.bg === 'light' ? d.ink : dc.bg === 'brand' ? onColor(darken(d.p)) : WHITE;
  const cover = d.media.covers[0] ? `url(${d.media.covers[0]}) center/cover` : 'var(--bn-banner)';
  const cards = promoCards(ctx.site, db);
  if (view === 'idle') return <Guest d={d} style={{ height: '100%', background: dc.idle === 'brand' ? 'var(--bn-p)' : cover, color: WHITE, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', padding: 40, gap: 16 }}>
    {dc.idle !== 'brand' && <span style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg,transparent 30%,color-mix(in srgb,var(--ink-950) 70%,transparent))' }} />}
    {dc.idle === 'video' && <span style={{ position: 'absolute', top: 20, right: 20 }} className="badge">Video loop</span>}
    <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <h1 style={{ ...gh(d), fontSize: 52, lineHeight: 1.05 }}>{String(dc.idleHead)}</h1><p style={{ fontSize: 20, opacity: .85 }}>{String(dc.welcome)}</p>
      {dc.idle === 'promo' && cards.length > 0 && <div style={{ display: 'flex', gap: 12 }}>{cards.slice(0, 2).map((c, i) => <PromoCardView key={i} c={c} big />)}</div>}
    </div></Guest>;
  const o = lastOrder(db, outletId, true) ?? lastOrder(db, outletId);
  const cust = o?.customerId ? db.customers.find(c => c.id === o.customerId) : undefined;
  const right = dc.cart === 'right';
  return <Guest d={d} style={{ height: '100%', background: bg, color: fg, display: 'flex', flexDirection: right ? 'row' : 'column' }}>
    <div style={{ flex: 1, padding: 32, display: 'flex', flexDirection: 'column', gap: 10, overflow: 'hidden' }}>
      <b style={{ ...gh(d), fontSize: 28 }}>{d.name}</b>
      {o ? o.lines.map(l => <div key={l.id} style={{ display: 'flex', gap: 14, alignItems: 'center', fontSize: 20 }}><span style={{ width: 52, height: 52, borderRadius: 12, background: photoOf(db.products.find(p => p.id === l.productId) ?? db.products[0]), flex: 'none' }} /><span style={{ flex: 1 }}>{l.qty}× {l.name}</span><b>{idr((l.flashPrice ?? l.unitPrice) * l.qty)}</b></div>) : <p style={{ fontSize: 20 }}>{String(dc.welcome)}</p>}
      {dc.promo && <div style={{ marginTop: 'auto', padding: '10px 14px', borderRadius: 12, background: 'var(--bn-acc)', color: 'var(--bn-on-acc)', fontWeight: 700 }}>{d.copy.announce?.en}</div>}
    </div>
    <div style={{ width: right ? '36%' : 'auto', padding: 32, display: 'flex', flexDirection: right ? 'column' : 'row', justifyContent: right ? 'flex-end' : 'space-between', alignItems: right ? 'stretch' : 'center', gap: 14, background: 'color-mix(in srgb,currentColor 7%,transparent)' }}>
      {dc.points && cust && <span style={{ fontSize: 16 }}>{cust.name} · {balance(db.ledger, cust.id).toLocaleString('en-US')} {String(d.mc.pts)}</span>}
      {o && <><span style={{ fontSize: 18, opacity: .8 }}>Total</span><b style={{ ...gh(d), fontSize: 48 }}>{idr(o.total)}</b></>}
      {dc.qris && o && <span style={{ alignSelf: right ? 'flex-start' : 'center', padding: 10, background: WHITE, borderRadius: 12 }} title="Sample · the live QRIS code comes from the payment gateway"><QR value={`QRIS sample ${o.no} ${o.total}`} size={130} fg={INK} bg={WHITE} /></span>}
    </div>
  </Guest>;
}

export function KioskPreview({ ctx }: { ctx: GuestCtx }) {
  const { d } = ctx, ki = d.ki;
  const cover = d.media.covers[0] ? `url(${d.media.covers[0]}) center/cover` : 'var(--bn-banner)';
  const photo = ki.bg === 'photo';
  return <Guest d={d} style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
    {ki.bg === 'split' && <div style={{ flex: 1.1, background: cover }} />}
    <div style={{ flex: 1, padding: 48, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 20, background: photo ? `linear-gradient(180deg,transparent,color-mix(in srgb,var(--ink-950) 65%,transparent)),${cover}` : 'var(--bn-p)', color: photo ? WHITE : 'var(--bn-on-p)' }}>
      <b style={{ fontSize: 20 }}>{d.name}</b>
      <h1 style={{ ...gh(d), fontSize: 56, lineHeight: 1.02 }}>{String(ki.head)}</h1>
      <button type="button" style={{ height: 80, borderRadius: 'var(--bn-r)', border: 0, background: photo ? 'var(--bn-p)' : 'var(--bn-paper)', color: photo ? 'var(--bn-on-p)' : 'var(--bn-ink)', font: '800 26px var(--bn-font)' }}>{String(ki.cta)}</button>
      {ki.step === 'ask' && <div style={{ display: 'flex', gap: 12 }}>{['Dine in', 'Takeaway'].map(x => <span key={x} style={{ flex: 1, height: 64, borderRadius: 'var(--bn-r)', border: '2px solid currentColor', display: 'grid', placeItems: 'center', fontSize: 20, fontWeight: 700 }}>{x}</span>)}</div>}
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, opacity: .8 }}><span>Resets after {String(ki.timeout)} s idle</span>{ki.lang && <span>English · Bahasa Indonesia</span>}</div>
    </div>
  </Guest>;
}

export function TableCard({ d, n, outletId, wifi }: { d: MenuDesign; n: number; outletId: string; wifi?: string }) {
  const q = d.qr, sticker = q.layout === 'sticker';
  const bg = q.color === 'brand' ? d.p : q.color === 'dark' ? INK_HEX : PAPER_HEX;
  const fg = onColor(bg);
  const s: CSSProperties = { width: sticker ? 300 : q.layout === 'poster' ? 320 : 280, minHeight: sticker ? 300 : q.layout === 'poster' ? 440 : 380, borderRadius: sticker ? 999 : 'var(--bn-r)', background: bg, color: fg, padding: sticker ? 34 : 22, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', gap: sticker ? 6 : 10, boxShadow: 'var(--shadow-e2)', breakInside: 'avoid', flex: 'none' };
  return <Guest d={d} style={{ ...s, minHeight: s.minHeight }}>
    {q.logo && !sticker && <span style={{ width: 44, height: 44, borderRadius: 12, background: d.media.logo ? `${WHITE} url(${d.media.logo}) center/70% no-repeat` : 'var(--bn-acc)', color: 'var(--bn-on-acc)', display: 'grid', placeItems: 'center', fontWeight: 800 }}>{!d.media.logo && initials(d.name)}</span>}
    <b style={{ ...gh(d), fontSize: sticker ? 20 : 26, color: fg }}>{String(q.head)}</b>
    <span style={{ padding: 8, background: WHITE, borderRadius: 12 }}><QR value={tableUrl(outletId, n)} size={sticker ? 120 : 160} fg={INK} bg={WHITE} label={`Table ${n} QR`} /></span>
    <b style={{ fontSize: 18, color: fg }}>Table {String(n).padStart(2, '0')}</b>
    {!sticker && <span style={{ fontSize: 13, color: fg, opacity: .85 }}>{String(q.sub)}</span>}
    {q.qris && <span style={{ fontSize: 11, fontWeight: 700, color: fg }}>QRIS accepted</span>}
    {q.wifi && wifi && !sticker && <span style={{ fontSize: 11, color: fg, opacity: .8 }}>Wi-Fi {wifi}</span>}
  </Guest>;
}

export function MemberCardPreview({ ctx }: { ctx: GuestCtx }) {
  const { d, db } = ctx, mc = d.mc;
  const top = [...db.customers].sort((a, b) => balance(db.ledger, b.id) - balance(db.ledger, a.id))[0];
  const bal = top ? balance(db.ledger, top.id) : 0, tier = top ? tierOf(db.ledger, top.id) : TIERS[0];
  const ti = TIERS.findIndex(t => t.id === tier.id), next = TIERS[ti + 1], names = [mc.t0, mc.t1, mc.t2].map(String);
  const cover = d.media.covers[0] ? `url(${d.media.covers[0]}) center/cover` : '';
  return <div className="stack" style={{ alignItems: 'center', gap: 16 }}>
    <Guest d={d} style={{ width: 340, minHeight: 0, aspectRatio: '1.6/1', borderRadius: 'max(12px,var(--bn-r))', overflow: 'hidden', padding: 20, color: WHITE, display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
      background: mc.style === 'dark' ? INK : mc.style === 'photo' && cover ? `linear-gradient(180deg,color-mix(in srgb,var(--ink-950) 20%,transparent),color-mix(in srgb,var(--ink-950) 70%,transparent)),${cover}` : 'linear-gradient(135deg,var(--bn-p),var(--bn-ink))' }}>
      <div className="row between"><b style={{ fontSize: 15 }}>{String(mc.prog)}</b><span style={{ padding: '2px 10px', borderRadius: 99, background: 'var(--bn-acc)', color: 'var(--bn-on-acc)', fontSize: 11, fontWeight: 800 }}>{names[ti]?.toUpperCase()}</span></div>
      <div><span style={{ fontSize: 12, opacity: .8 }}>{top?.name ?? 'Member'}</span><b style={{ ...gh(d), display: 'block', fontSize: 30 }}>{bal.toLocaleString('en-US')} {String(mc.pts)}</b>
        {mc.progress && next && <span style={{ fontSize: 11, opacity: .85 }}>{(next.min - bal > 0 ? next.min - bal : 0).toLocaleString('en-US')} {String(mc.pts)} to {names[ti + 1]}</span>}</div>
      {mc.barcode && top && <span style={{ alignSelf: 'flex-end', padding: 4, background: WHITE, borderRadius: 6 }}><QR value={'BORNIZ-MEMBER:' + top.id} size={52} fg={INK} bg={WHITE} /></span>}
    </Guest>
    <div className="stack sm" style={{ width: 340, color: 'var(--ink-0)' }}>
      {TIERS.map((t, i) => <div key={t.id} className="row between" style={{ fontSize: 13 }}><b>{names[i]}</b><span style={{ opacity: .75 }}>{t.min ? `${t.min.toLocaleString('en-US')} ${mc.pts} / 12 months` : 'From first visit'} · ×{t.multiplier}</span></div>)}
    </div>
  </div>;
}
