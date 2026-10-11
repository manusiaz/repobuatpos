'use client';
import { productImage } from '../ui/kit.tsx';
// Customer display (spec: BorNiz Customer Display). A fixed 16:9 canvas in cqw units that never scrolls, worn in the
// merchant brand. It mirrors the outlet's open POS order and follows it on its own: cart → QRIS → paid → receipt →
// thank-you → rating → idle. Every state is also its own URL; opening one directly shows it without timers.
import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { useApp } from '../app/context.tsx';
import { pagesOf } from '../system/registry.ts';
import { Icon, hhmm, useNow } from '../ui/kit.tsx';
import { idr } from '../domain/money.ts';
import { lineTotal } from '../domain/order.ts';
import { balance, earn, tierOf, TIERS } from '../domain/loyalty.ts';
import { usable } from '../domain/promo.ts';
import { patchOrder, rateOrder } from '../data/actions.ts';
import { chooseTip, newPairCode, pairByCode, sendReceipt, tipOf, unpairDisplay } from '../data/actions/display.ts';
import { digits, findCustomer, findOrJoin } from '../data/actions/selforder.ts';
import type { DB, Order, Payment } from '../data/schema.ts';
import { brandVars, firstName, LINE, maskPhone, menuOf, mmss, modsText, MUTED, QR, TINT, Wordmark } from './guest/kit.tsx';

const SLUG = {
  idle: 'idle-promo-slideshow', cart: 'live-cart', qris: 'qris-payment', paid: 'payment-success', fail: 'payment-expired-failed', rate: 'rate-your-visit',
  pair: 'pairing-with-register', tip: 'tip-selection', member: 'member-sign-up-phone-entry', split: 'split-bill-progress', receipt: 'receipt-choice', thanks: 'thank-you-and-points-earned',
} as const;
type View = keyof typeof SLUG;
const PATHS: Record<string, string> = Object.fromEntries(pagesOf('display').map(p => [p.slug, p.path]));
const pathOf = (v: View) => PATHS[SLUG[v]] ?? PATHS.display ?? '/';
const VIEW_OF = Object.fromEntries(Object.entries(SLUG).map(([k, s]) => [s, k])) as Record<string, View>;
const AFTER_PAY: View[] = ['paid', 'receipt', 'thanks', 'rate'];

// Module state survives route changes: the display reacts to *changes* in the order, never to a page being opened.
let lastPhase: View | null = null, lastPending: string | null = null, following = false, navTarget: View | null = null;

const METHOD: Record<string, string> = { cash: 'cash', qris: 'QRIS', card: 'card', ewallet: 'e-wallet', va: 'virtual account', deposit: 'deposit', kasbon: 'tab' };
const CSS = `@keyframes cdPulse{0%{box-shadow:0 0 0 0 color-mix(in srgb,var(--bn-acc) 60%,transparent)}70%{box-shadow:0 0 0 2.6cqw transparent}100%{box-shadow:0 0 0 0 transparent}}
@keyframes cdPop{from{transform:scale(.6);opacity:.4}}@keyframes cdIn{from{opacity:0;transform:translateY(1cqw)}}
[data-guest] .cd-in{animation:cdIn 320ms var(--ease-out)}@media (prefers-reduced-motion:reduce){[data-guest] *{animation:none!important;transition:none!important}}`;

const PAPER: CSSProperties = { position: 'absolute', inset: 0, background: 'var(--bn-paper)', color: 'var(--bn-ink)' };
const DARK: CSSProperties = { position: 'absolute', inset: 0, background: 'var(--ink-950)', color: 'var(--ink-0)' };
const HEAD: CSSProperties = { fontFamily: 'var(--bn-font)', fontWeight: 800, letterSpacing: '-.02em', lineHeight: 1.05 };
const TILE = (on: boolean): CSSProperties => ({ border: `.3cqw solid ${on ? 'var(--bn-p)' : LINE}`, background: on ? TINT : 'var(--ink-0)', color: 'var(--bn-ink)', borderRadius: '2cqw', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '.6cqw', transition: 'transform var(--dur-base) var(--ease-spring)' });

/** Everything the display shows, derived from the store. */
function useLive(db: DB, outletId: string) {
  return useMemo(() => {
    const pos = db.orders.filter(o => o.outletId === outletId && o.source === 'pos');
    const current = pos.filter(o => o.status === 'open' || o.status === 'paying').sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;
    const pays = current ? db.payments.filter(p => p.orderId === current.id).sort((a, b) => b.at - a.at) : [];
    const pending = pays.find(p => p.status === 'pending' && p.method === 'qris') ?? null;
    const settled = pays.filter(p => p.status === 'settled').reduce((a, p) => a + p.amount, 0);
    const lastPaid = pos.filter(o => o.paidAt).sort((a, b) => b.paidAt! - a.paidAt!)[0] ?? null;
    const failed = db.payments.filter(p => p.outletId === outletId && (p.status === 'expired' || p.status === 'failed') && pos.some(o => o.id === p.orderId)).sort((a, b) => b.at - a.at)[0] ?? null;
    return { current, pays, pending, settled, lastPaid, failed };
  }, [db, outletId]);
}
type Live = ReturnType<typeof useLive>;

function phaseOf(L: Live, now: number): View {
  if (L.pending) return L.pending.expiresAt && now >= L.pending.expiresAt ? 'fail' : 'qris';
  if (L.current?.lines.length) return L.settled > 0 ? 'split' : 'cart';
  if (L.lastPaid && now - L.lastPaid.paidAt! < 10e3) return 'paid';
  return 'idle';
}

export default function Screen() {
  const { page, db, outletId, go } = useApp();
  const now = useNow(500);
  const L = useLive(db, outletId);
  const phase = phaseOf(L, now);
  const disp = db.devices.find(d => d.kind === 'display' && d.outletId === outletId);
  const reg = disp && db.device.paired[disp.id] ? db.devices.find(d => d.id === db.device.paired[disp.id]) : undefined;
  // Surface root (/display): pairing until paired, then whatever the order is doing.
  const view: View = VIEW_OF[page.slug] ?? (disp && !reg ? 'pair' : phase);
  const to = useCallback((v: View) => { navTarget = v; go(pathOf(v)); }, [go]);
  // Opened by URL (not moved here by the display itself): show the state as is, no timed steps.
  useEffect(() => { if (view !== navTarget) following = false; }, [view]);

  // Auto-follow: move only when the order's phase changes (paid shows as soon as the store settles, < 1 s).
  useEffect(() => {
    const prev = lastPhase; lastPhase = phase;
    if (L.pending) lastPending = L.pending.id;
    if (prev === null || prev === phase) return;
    let next = phase;
    if (prev === 'qris' && phase !== 'paid' && phase !== 'split') {
      const p = db.payments.find(x => x.id === lastPending);
      if (p && (p.status === 'expired' || p.status === 'failed')) next = 'fail';
    }
    if (next === 'idle' && AFTER_PAY.includes(view)) return; // the thank-you sequence ends on its own
    if (next === 'cart' && (view === 'member' || view === 'tip')) return; // guest is busy on the cart
    if (next === view) return;
    following = true; to(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // Timed steps after payment; only when the display got here by itself (a page opened by URL stays put).
  const rated = !!L.lastPaid?.rating;
  useEffect(() => {
    if (!following) return;
    const step: Partial<Record<View, [View, number]>> = { paid: ['receipt', 4000], receipt: ['thanks', 20000], thanks: [rated ? 'idle' : 'rate', 7000], rate: ['idle', rated ? 4000 : 25000], fail: [L.current?.lines.length ? 'cart' : 'idle', 6000] };
    const s = step[view]; if (!s) return;
    const t = setTimeout(() => to(s[0]), s[1]);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, rated]);

  const props = { db, L, now, to, outletId };
  const body: Record<View, ReactNode> = {
    idle: <Idle {...props} />, cart: <Cart {...props} />, qris: <Qris {...props} />, paid: <Paid {...props} />, fail: <Fail {...props} />, rate: <Rate {...props} />,
    pair: <Pair {...props} />, tip: <Tip {...props} />, member: <Member {...props} />, split: <Split {...props} />, receipt: <Receipt {...props} />, thanks: <Thanks {...props} />,
  };
  return <div data-guest style={{ ...brandVars(db.theme), height: '100dvh', display: 'grid', placeItems: 'center', background: 'var(--ink-950)', overflow: 'hidden' }}>
    <style>{CSS}</style>
    <div key={view} style={{ width: 'min(100vw, calc(100dvh * 16 / 9))', aspectRatio: '16 / 9', position: 'relative', overflow: 'hidden', containerType: 'inline-size', background: 'var(--bn-ink)', color: 'var(--ink-0)', userSelect: 'none' }}>
      {body[view]}
      {view !== 'pair' && (!reg || !db.device.online) && <button onClick={() => to('pair')} style={{ position: 'absolute', top: '1.4cqw', right: '1.4cqw', zIndex: 5, border: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '.6cqw', height: '3cqw', padding: '0 1.2cqw', borderRadius: 99, background: 'color-mix(in srgb,var(--ink-950) 70%,transparent)', color: 'var(--ink-0)', fontSize: '1.1cqw', fontWeight: 600 }}>
        <Icon name={db.device.online ? 'link-2-off' : 'wifi-off'} style={{ width: '1.4cqw', height: '1.4cqw' }} />{!db.device.online ? 'Offline · QRIS paused' : 'Not paired with a register'}</button>}
    </div>
  </div>;
}

type P = { db: DB; L: Live; now: number; to: (v: View) => void; outletId: string };

// ── Idle / promo slideshow ─────────────────────────────────────────────────────────────
function Idle({ db, now, outletId }: P) {
  const slides = useMemo(() => {
    const menu = menuOf(db, outletId);
    const s: { head: string; sub: string; bg: string }[] = [];
    for (const p of db.promos.filter(x => usable(x, now))) {
      if (p.kind === 'flash') {
        const it = menu.find(i => p.productIds?.includes(i.p.id));
        if (it && !it.sold) s.push({ head: `Flash sale: ${it.p.name}`, sub: `${idr(p.value)} · was ${idr(it.price)}${p.endsAt ? ' · until ' + hhmm(p.endsAt) : ''}`, bg: productImage(it.p) });
      } else s.push({ head: p.name, sub: [p.minSpend ? `Min. spend ${idr(p.minSpend)}` : '', p.code ? `Code ${p.code}` : '', p.quota != null ? `${(p.quota - (p.used ?? 0)).toLocaleString('en-US')} left` : ''].filter(Boolean).join(' · '), bg: 'var(--bn-banner)' });
    }
    s.push({ head: `Join ${db.tenant.name} Rewards`, sub: `1 bean for every IDR 1,000 · ${TIERS[1].name} members earn ${TIERS[1].multiplier}×`, bg: 'linear-gradient(135deg,var(--bn-p),var(--bn-ink))' });
    return s;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db.promos, db.products, db.outletProducts, outletId, Math.floor(now / 60e3)]);
  const i = Math.floor(now / 5000) % slides.length, out = db.outlets.find(o => o.id === outletId);
  return <>
    {slides.map((s, k) => <div key={k} style={{ position: 'absolute', inset: 0, background: s.bg, opacity: k === i ? 1 : 0, transition: 'opacity 600ms var(--ease-out)' }} />)}
    <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(90deg,color-mix(in srgb,var(--ink-950) 70%,transparent),transparent 68%)' }} />
    <div key={i} className="cd-in" style={{ position: 'absolute', left: '6%', top: 0, bottom: 0, width: '52%', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '2cqw' }}>
      <Wordmark name={db.tenant.name} size="7cqw" radius="1.6cqw" />
      <b style={{ ...HEAD, fontSize: '5.2cqw' }}>{slides[i].head}</b>
      <span style={{ fontSize: '1.9cqw', opacity: .92 }}>{slides[i].sub}</span>
    </div>
    <div style={{ position: 'absolute', bottom: '3cqw', left: '6%', display: 'flex', gap: '.8cqw' }}>{slides.map((_, k) => <span key={k} style={{ width: k === i ? '3cqw' : '.7cqw', height: '.7cqw', borderRadius: 9, background: k === i ? 'var(--ink-0)' : 'color-mix(in srgb,var(--ink-0) 45%,transparent)', transition: 'width 300ms' }} />)}</div>
    <span style={{ position: 'absolute', bottom: '3cqw', right: '4cqw', fontSize: '1.3cqw', opacity: .8 }}>{db.tenant.name} {out?.name} · scan the table QR to order</span>
  </>;
}

// ── Live cart ──────────────────────────────────────────────────────────────────────────
function Cart({ db, L, to, outletId }: P) {
  const o = L.current;
  if (!o || !o.lines.length) return <Waiting icon="shopping-basket" title="Your order shows here" sub="The cashier is starting your order." />;
  return <CartBody db={db} o={o} to={to} outletId={outletId} />;
}
function CartBody({ db, o, to, outletId }: { db: DB; o: Order; to: (v: View) => void; outletId: string }) {
  const out = db.outlets.find(x => x.id === o.outletId)!, cashier = db.employees.find(e => e.id === o.cashierId);
  const cust = db.customers.find(c => c.id === o.customerId);
  const pts = earn(o.subtotal - o.discount, cust ? tierOf(db.ledger, cust.id) : TIERS[0]);
  const tip = tipOf(db.records, o.id);
  const shown = o.lines.slice(-6), hidden = o.lines.length - shown.length;
  const up = useMemo(() => {
    const m = menuOf(db, outletId).filter(i => !i.sold && !o.lines.some(l => l.productId === i.p.id));
    return m.find(i => i.flash != null) ?? m.find(i => i.cat === 'pastry');
  }, [db, outletId, o.lines]);
  return <div style={{ ...PAPER, display: 'grid', gridTemplateColumns: 'minmax(0,1.5fr) minmax(0,1fr)' }}>
    <div style={{ padding: '4cqw', display: 'flex', flexDirection: 'column', gap: '1.2cqw', minHeight: 0 }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: '1.2cqw', fontSize: '1.6cqw', fontWeight: 600, color: MUTED }}>
        <span style={{ width: '3.6cqw', height: '3.6cqw', borderRadius: '1cqw', background: 'var(--bn-p)', color: 'var(--ink-0)', display: 'grid', placeItems: 'center', fontSize: '1.3cqw', fontWeight: 800, fontFamily: 'var(--bn-font)' }}>{db.tenant.name.split(' ').map(w => w[0]).join('').slice(0, 2)}</span>
        {[db.tenant.name, o.table ? 'Table ' + o.table.replace(/^T-?/, '') : o.type === 'take' ? 'Takeaway' : 'Dine-in', cashier && 'Served by ' + cashier.name].filter(Boolean).join(' · ')}</span>
      {hidden > 0 && <span style={{ fontSize: '1.5cqw', color: MUTED }}>+ {hidden} earlier item{hidden > 1 ? 's' : ''}</span>}
      {shown.map(l => <div key={l.id} className="cd-in" style={{ display: 'flex', justifyContent: 'space-between', gap: '2cqw', padding: '1.1cqw 0', borderBottom: `1px solid ${LINE}`, fontSize: '2.2cqw' }}>
        <span style={{ minWidth: 0 }}><b>{l.qty}×</b> {l.name}{(l.mods.length > 0 || l.note) && <span style={{ display: 'block', fontSize: '1.4cqw', color: MUTED }}>{modsText(l.mods, l.note)}</span>}</span>
        <b style={{ whiteSpace: 'nowrap' }}>{idr(lineTotal({ unitPrice: l.unitPrice, flashPrice: l.flashPrice, modifiers: l.mods.map(m => m.price), qty: l.qty, discountPct: l.discountPct })).replace('IDR ', '')}</b></div>)}
      {up && <div style={{ marginTop: 'auto', padding: '1.4cqw 1.8cqw', borderRadius: '1.4cqw', background: 'var(--bn-acc)', color: 'var(--bn-ink)', fontSize: '1.6cqw', fontWeight: 700 }}>
        {up.flash != null ? `Flash sale: ${up.p.name} ${idr(up.flash)} · ask the cashier` : `Add a ${up.p.name} for ${idr(up.price)} · ask the cashier`}</div>}
    </div>
    <div style={{ background: 'var(--bn-p)', color: 'var(--ink-0)', padding: '4cqw', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: '1cqw' }}>
      <span style={{ fontSize: '1.6cqw', opacity: .88, lineHeight: 1.5 }}>Subtotal {idr(o.subtotal)}{o.discount > 0 && <> · Discount −{idr(o.discount)}</>}<br />
        {out.serviceBps > 0 && <>Service {out.serviceBps / 100}% {idr(o.service)} · </>}PB1 {out.taxBps / 100}%{out.taxInclusive ? ' incl.' : ''} {idr(o.tax)}</span>
      <span style={{ fontSize: '1.8cqw', opacity: .9 }}>Total</span>
      <b style={{ ...HEAD, fontSize: '6cqw', lineHeight: 1 }}>{idr(o.total)}</b>
      {tip > 0 && <span style={{ fontSize: '1.5cqw', opacity: .9 }}>+ tip {idr(tip)}</span>}
      {cust ? <span style={{ marginTop: '1cqw', padding: '1.2cqw 1.4cqw', borderRadius: '1.2cqw', background: 'color-mix(in srgb,var(--ink-0) 14%,transparent)', fontSize: '1.5cqw', fontWeight: 600 }}>
        {firstName(cust.name)} · {tierOf(db.ledger, cust.id).name} · earns +{pts} beans</span>
        : <button onClick={() => to('member')} style={{ marginTop: '1cqw', border: 0, cursor: 'pointer', textAlign: 'left', padding: '1.2cqw 1.4cqw', borderRadius: '1.2cqw', background: 'var(--bn-acc)', color: 'var(--bn-ink)', fontSize: '1.6cqw', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '1cqw' }}>
          <Icon name="star" style={{ width: '2cqw', height: '2cqw' }} />Join and earn +{pts} beans on this order</button>}
      <button onClick={() => to('tip')} style={{ border: '1px solid color-mix(in srgb,var(--ink-0) 40%,transparent)', background: 'transparent', color: 'var(--ink-0)', cursor: 'pointer', borderRadius: '1.2cqw', padding: '1cqw 1.4cqw', fontSize: '1.5cqw', fontWeight: 600, textAlign: 'left' }}>
        {tip >= 0 ? (tip ? `Tip ${idr(tip)} · change` : 'No tip · change') : 'Add a tip for the team'}</button>
    </div>
  </div>;
}

// ── QRIS ───────────────────────────────────────────────────────────────────────────────
function Qris(p: P) {
  const { db, L, now } = p, pay = L.pending;
  if (!pay) return L.current?.status === 'open' && L.pays[0] && (L.pays[0].status === 'expired' || L.pays[0].status === 'failed') ? <Fail {...p} /> : <Waiting icon="qr-code" title="No QRIS payment open" sub="When the cashier charges with QRIS, the code shows here." />;
  const left = (pay.expiresAt ?? now) - now;
  if (left <= 0) return <Fail {...p} />;
  const amount = pay.amount + pay.tip;
  return <div style={{ ...DARK, display: 'grid', gridTemplateColumns: '1fr 1fr', alignItems: 'center', padding: '4cqw', gap: '4cqw' }}>
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.6cqw' }}>
      <span style={{ alignSelf: 'flex-start', height: '3.6cqw', padding: '0 1.6cqw', borderRadius: 99, background: 'var(--warning-soft)', color: 'var(--warning-fg)', fontSize: '1.5cqw', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '.8cqw' }}><i className="dot" />Waiting for payment</span>
      <span style={{ fontSize: '2cqw', color: 'var(--ink-300)' }}>Total to pay</span>
      <b style={{ ...HEAD, fontSize: '6.4cqw', lineHeight: 1 }}>{idr(amount)}</b>
      {pay.tip > 0 && <span style={{ fontSize: '1.6cqw', color: 'var(--ink-300)' }}>Includes tip {idr(pay.tip)}</span>}
      <span style={{ fontSize: '1.8cqw', lineHeight: 1.45, color: 'var(--ink-300)' }}>Open any bank or e-wallet app and scan. GoPay, OVO, DANA, ShopeePay, BCA, Mandiri, BRI and more.</span>
      <b style={{ fontSize: '3.2cqw', color: left < 30e3 ? 'var(--warning)' : 'var(--ink-0)' }} aria-live="polite">{mmss(left)}</b>
      <span className="mono" style={{ fontSize: '1.2cqw', color: 'var(--ink-400)' }}>{pay.ref}</span>
    </div>
    <div style={{ justifySelf: 'center', width: '32cqw', borderRadius: '2.4cqw', background: 'var(--ink-0)', padding: '2.2cqw', animation: 'cdPulse 1.6s infinite', display: 'flex', flexDirection: 'column', gap: '1cqw' }}>
      <div style={{ aspectRatio: '1' }}><QR value={pay.ref + pay.amount} label={`QRIS code for ${idr(amount)}`} /></div>
      <span style={{ textAlign: 'center', color: 'var(--ink-950)', fontSize: '1.4cqw', fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase' }}>QRIS · {db.tenant.name}</span>
    </div>
  </div>;
}

// ── Paid / failed ──────────────────────────────────────────────────────────────────────
function Paid({ db, L }: P) {
  const o = L.lastPaid;
  if (!o) return <Waiting icon="check" title="No payment yet today" sub="Paid orders show here." />;
  const cust = db.customers.find(c => c.id === o.customerId);
  const pts = db.ledger.filter(r => r.orderId === o.id && r.points > 0).reduce((a, r) => a + r.points, 0);
  const pay = db.payments.filter(p => p.orderId === o.id && p.status === 'settled');
  const methods = [...new Set(pay.map(p => METHOD[p.method]))].join(' + ');
  return <div style={{ position: 'absolute', inset: 0, background: 'var(--success)', color: 'var(--ink-0)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '2cqw', textAlign: 'center', padding: '4cqw' }}>
    <span style={{ width: '16cqw', height: '16cqw', borderRadius: 999, background: 'var(--ink-0)', display: 'grid', placeItems: 'center', color: 'var(--success)', animation: 'cdPop 480ms var(--ease-spring)' }}><Icon name="check" strokeWidth={3} style={{ width: '8cqw', height: '8cqw' }} /></span>
    <b style={{ ...HEAD, fontSize: '5.4cqw' }}>Terima kasih{cust ? ', ' + firstName(cust.name) : ''}!</b>
    <span style={{ fontSize: '2.2cqw' }}>{idr(o.total)} paid{methods ? ' via ' + methods : ''}{pts > 0 ? ` · +${pts} beans` : ''}</span>
    <span style={{ fontSize: '1.8cqw', opacity: .9 }}>Your order number is <b>{o.no}</b>{o.type === 'take' ? '. We’ll call it when it’s ready.' : '.'}</span>
  </div>;
}
function Fail({ db, L, now }: P) {
  const p: Payment | null = L.pending && L.pending.expiresAt && now >= L.pending.expiresAt ? L.pending : L.failed;
  const expired = !p || p.status === 'expired' || p.status === 'pending';
  return <div style={{ ...DARK, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '2cqw', textAlign: 'center' }}>
    <span style={{ width: '14cqw', height: '14cqw', borderRadius: 999, background: 'var(--danger)', display: 'grid', placeItems: 'center' }}><Icon name="x" strokeWidth={2.5} style={{ width: '8cqw', height: '8cqw' }} /></span>
    <b style={{ ...HEAD, fontSize: '4.6cqw' }}>{expired ? 'This code has expired' : 'Payment didn’t go through'}</b>
    <span style={{ fontSize: '2cqw', color: 'var(--ink-300)' }}>No money was taken. Please ask the cashier for a new code.</span>
    {p && <span className="mono" style={{ fontSize: '1.2cqw', color: 'var(--ink-400)' }}>{p.ref} · {idr(p.amount)} · {hhmm(p.at)} · {db.tenant.name}</span>}
  </div>;
}

// ── Rate your visit ────────────────────────────────────────────────────────────────────
function Rate({ db, L }: P) {
  const o = L.lastPaid;
  const [pick, setPick] = useState<number | null>(null);
  const stars = pick ?? o?.rating ?? null;
  if (!o) return <Waiting icon="star" title="How was your visit?" sub="Rating opens after a payment." />;
  const rate = (n: number) => { if (o.rating) return; setPick(n); rateOrder(o.id, n); };
  return <div style={{ ...PAPER, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '3cqw' }}>
    <b style={{ ...HEAD, fontSize: '4.4cqw' }}>How was your visit?</b>
    <div style={{ display: 'flex', gap: '2cqw' }} role="radiogroup" aria-label="Rating">{[1, 2, 3, 4, 5].map(n => {
      const on = stars != null && n <= stars;
      return <button key={n} role="radio" aria-checked={stars === n} aria-label={`${n} star${n > 1 ? 's' : ''}`} onClick={() => rate(n)} style={{ ...TILE(stars === n), width: '12cqw', height: '12cqw', transform: stars === n ? 'scale(1.08)' : undefined }}>
        <Icon name="star" fill={on ? 'var(--bn-acc)' : 'none'} style={{ width: '5cqw', height: '5cqw', color: on ? 'var(--bn-ink)' : MUTED }} /><span style={{ fontSize: '1.6cqw', fontWeight: 700 }}>{n}</span></button>;
    })}</div>
    <span style={{ fontSize: '1.8cqw', color: MUTED }} aria-live="polite">{stars == null ? 'Tap a star. It takes one second.' : stars >= 3 ? 'Thank you! We’re glad you came.' : 'Sorry to hear that. The manager will reach out today.'}</span>
    <span className="mono" style={{ fontSize: '1.2cqw', color: MUTED }}>{db.tenant.name} · order {o.no}</span>
  </div>;
}

// ── Pairing with a register ────────────────────────────────────────────────────────────
function Pair({ db, outletId, to }: P) {
  const disp = db.devices.find(d => d.kind === 'display' && d.outletId === outletId);
  const regs = db.devices.filter(d => d.kind === 'pos' && d.outletId === outletId);
  const paired = disp ? db.devices.find(d => d.id === db.device.paired[disp.id]) : undefined;
  const [err, setErr] = useState('');
  useEffect(() => { if (disp && !disp.pairCode && !paired) newPairCode(disp.id); }, [disp, paired]);
  const out = db.outlets.find(o => o.id === outletId);
  if (!disp) return <Waiting icon="monitor-off" title="No customer display set up" sub={`Add a customer display for ${out?.name} under Devices in the back office.`} />;
  const btn: CSSProperties = { height: '5.4cqw', padding: '0 2.4cqw', borderRadius: '1.4cqw', border: 0, cursor: 'pointer', fontSize: '1.7cqw', fontWeight: 700 };
  if (paired) return <div style={{ ...PAPER, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '2.4cqw', textAlign: 'center' }}>
    <span style={{ width: '12cqw', height: '12cqw', borderRadius: 999, background: 'var(--success)', color: 'var(--ink-0)', display: 'grid', placeItems: 'center' }}><Icon name="link-2" style={{ width: '6cqw', height: '6cqw' }} /></span>
    <b style={{ ...HEAD, fontSize: '4.4cqw' }}>Paired with {paired.name}</b>
    <span style={{ fontSize: '1.8cqw', color: MUTED }}>{disp.name} · {out?.name} · shows this register’s cart and QRIS</span>
    <div style={{ display: 'flex', gap: '1.4cqw' }}>
      <button style={{ ...btn, background: 'var(--bn-p)', color: 'var(--ink-0)' }} onClick={() => to('idle')}>Start showing promos</button>
      <button style={{ ...btn, background: 'var(--ink-0)', color: 'var(--bn-ink)', border: `1px solid ${LINE}` }} onClick={() => unpairDisplay(disp.id, 'device')}>Unpair</button>
    </div>
  </div>;
  const code = disp.pairCode ?? '······';
  return <div style={{ ...PAPER, display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '4cqw', padding: '5cqw', alignItems: 'center' }}>
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2cqw' }}>
      <Wordmark name={db.tenant.name} size="6cqw" radius="1.4cqw" />
      <b style={{ ...HEAD, fontSize: '4.4cqw' }}>Pair this display with a register</b>
      <span style={{ fontSize: '1.8cqw', color: MUTED, lineHeight: 1.5 }}>On the register, open Settings → Customer display and enter this code. It changes every time you open this screen.</span>
      <div style={{ display: 'flex', gap: '1cqw' }} aria-label={`Pairing code ${code}`}>{code.split('').map((c, i) => <span key={i} style={{ width: '6.4cqw', height: '8cqw', borderRadius: '1.4cqw', background: 'var(--ink-0)', border: `2px solid var(--bn-p)`, display: 'grid', placeItems: 'center', fontFamily: 'var(--font-display)', fontSize: '4.4cqw', fontWeight: 700 }}>{c}</span>)}</div>
      <button style={{ ...btn, alignSelf: 'flex-start', background: 'transparent', color: 'var(--bn-p)', padding: 0 }} onClick={() => newPairCode(disp.id)}>Get a new code</button>
    </div>
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.2cqw', padding: '2.4cqw', borderRadius: '2cqw', background: 'var(--ink-0)', border: `1px solid ${LINE}` }}>
      <b style={{ fontSize: '2cqw' }}>Staff: confirm on this screen</b>
      <span style={{ fontSize: '1.5cqw', color: MUTED }}>Registers at {out?.name}</span>
      {regs.map(r => <button key={r.id} onClick={() => setErr(pairByCode(code, r.id, 'device') ?? '')} style={{ ...btn, background: TINT, color: 'var(--bn-ink)', display: 'flex', alignItems: 'center', gap: '1.2cqw', textAlign: 'left' }}>
        <Icon name="monitor" style={{ width: '2.2cqw', height: '2.2cqw' }} /><span style={{ flex: 1 }}>{r.name}</span><span style={{ fontSize: '1.3cqw', color: r.status === 'online' ? 'var(--success-fg)' : 'var(--danger-fg)' }}>{r.status}</span></button>)}
      {!regs.length && <span style={{ fontSize: '1.5cqw', color: MUTED }}>No register at this outlet yet.</span>}
      {err && <span role="alert" style={{ fontSize: '1.4cqw', color: 'var(--danger-fg)' }}>{err}</span>}
    </div>
  </div>;
}

// ── Tip selection ──────────────────────────────────────────────────────────────────────
function Tip({ db, L, to }: P) {
  const o = L.current;
  const [saved, setSaved] = useState(false);
  useEffect(() => { if (!saved) return; const t = setTimeout(() => to('cart'), 1200); return () => clearTimeout(t); }, [saved, to]);
  if (!o || !o.lines.length) return <Waiting icon="hand-coins" title="Add a tip for the team?" sub="Tips open when there is an order on the register." />;
  const cur = tipOf(db.records, o.id);
  return <div style={{ ...PAPER, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '3cqw', padding: '4cqw' }}>
    <b style={{ ...HEAD, fontSize: '4.4cqw' }}>Add a tip for the team?</b>
    <span style={{ fontSize: '1.8cqw', color: MUTED }}>Order total {idr(o.total)}</span>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '1.6cqw', width: '80%' }}>{[0, 5, 10, 15].map(pct => {
      const a = Math.round(o.total * pct / 100 / 100) * 100, on = cur === a;
      return <button key={pct} aria-pressed={on} onClick={() => { chooseTip(o.id, a); setSaved(true); }} style={{ ...TILE(on), height: '12cqw' }}>
        <b style={{ fontSize: '3.4cqw' }}>{pct ? pct + '%' : 'No tip'}</b><span style={{ fontSize: '1.6cqw', color: MUTED }}>{pct ? idr(a) : '—'}</span></button>;
    })}</div>
    <span style={{ fontSize: '1.6cqw', color: MUTED }} aria-live="polite">{saved ? 'Thank you! The cashier will add it to your bill.' : '100% of tips go to the team on shift.'}</span>
  </div>;
}

// ── Member sign-up / phone entry ───────────────────────────────────────────────────────
function PhonePad({ value, onChange, onSkip }: { value: string; onChange: (v: string) => void; onSkip: () => void }) {
  const press = (k: string) => k === 'del' ? onChange(value.slice(0, -1)) : k === 'skip' ? onSkip() : value.length < 14 && onChange(value + k);
  return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '1.2cqw' }}>{['1', '2', '3', '4', '5', '6', '7', '8', '9', 'skip', '0', 'del'].map(k =>
    <button key={k} onClick={() => press(k)} aria-label={k === 'del' ? 'Delete' : k === 'skip' ? 'Skip' : k} style={{ height: '7cqw', borderRadius: '1.6cqw', background: 'var(--ink-0)', border: `1px solid ${LINE}`, color: 'var(--bn-ink)', cursor: 'pointer', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: k === 'skip' ? '1.8cqw' : '3cqw', display: 'grid', placeItems: 'center' }}>
      {k === 'del' ? <Icon name="delete" style={{ width: '3cqw', height: '3cqw' }} /> : k === 'skip' ? 'Skip' : k}</button>)}</div>;
}
const fmtPhone = (d: string) => (d + '_'.repeat(Math.max(0, 12 - d.length))).replace(/(.{4})(?=.)/g, '$1 ');

function Member({ db, L, to }: P) {
  const o = L.current;
  const [phone, setPhone] = useState(''), [step, setStep] = useState<'phone' | 'name' | 'done'>('phone'), [name, setName] = useState(''), [optIn, setOptIn] = useState(true), [who, setWho] = useState('');
  useEffect(() => { if (step !== 'done') return; const t = setTimeout(() => to(o?.lines.length ? 'cart' : 'idle'), 2600); return () => clearTimeout(t); }, [step, o, to]);
  const pts = o ? earn(o.subtotal - o.discount) : 0;
  const attach = (id: string) => { if (o) patchOrder(o.id, { customerId: id }, 'guest'); };
  const next = () => {
    const c = findCustomer(db, phone);
    if (c) { attach(c.id); setWho(firstName(c.name)); setStep('done'); } else setStep('name');
  };
  const join = () => { const r = findOrJoin(name || 'Guest', phone, optIn); attach(r.id); setWho(firstName(name) || ''); setStep('done'); };
  if (o?.customerId && step === 'phone') {
    const c = db.customers.find(x => x.id === o.customerId)!;
    return <Waiting icon="badge-check" title={`${firstName(c.name)} is on this order`} sub={`${balance(db.ledger, c.id).toLocaleString('en-US')} beans · ${tierOf(db.ledger, c.id).name}`} paper />;
  }
  if (step === 'done') {
    const c = db.customers.find(x => x.id === (o?.customerId ?? findCustomer(db, phone)?.id));
    return <div style={{ ...PAPER, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '2cqw', textAlign: 'center' }}>
      <span style={{ width: '12cqw', height: '12cqw', borderRadius: 999, background: 'var(--bn-acc)', display: 'grid', placeItems: 'center', animation: 'cdPop 480ms var(--ease-spring)' }}><Icon name="star" style={{ width: '6cqw', height: '6cqw' }} /></span>
      <b style={{ ...HEAD, fontSize: '4.4cqw' }}>Welcome{who ? ', ' + who : ''}!</b>
      <span style={{ fontSize: '2cqw', color: MUTED }}>{c ? `${balance(db.ledger, c.id).toLocaleString('en-US')} beans · ` : ''}{pts ? `+${pts} beans when this order is paid` : 'You earn beans on every order'}</span>
    </div>;
  }
  return <div style={{ ...PAPER, display: 'grid', gridTemplateColumns: '1fr 1fr', alignItems: 'center', padding: '5cqw', gap: '5cqw' }}>
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.6cqw' }}>
      <b style={{ ...HEAD, fontSize: '4.4cqw' }}>{pts ? `Earn +${pts} beans on this order` : `Join ${db.tenant.name} Rewards`}</b>
      <span style={{ fontSize: '1.8cqw', color: MUTED }}>{step === 'phone' ? `Enter your WhatsApp number to join ${db.tenant.name} Rewards. Free, takes 5 seconds.` : 'New here! What should we call you?'}</span>
      {step === 'phone' ? <>
        <div aria-live="polite" style={{ height: '7cqw', borderRadius: '1.6cqw', background: 'var(--ink-0)', border: '2px solid var(--bn-p)', display: 'flex', alignItems: 'center', padding: '0 2cqw', fontSize: '3cqw', fontWeight: 700, letterSpacing: '.06em', fontFamily: 'var(--font-display)' }}>{fmtPhone(phone)}</div>
        <button disabled={digits(phone).length < 10} onClick={next} style={{ height: '6cqw', borderRadius: '1.6cqw', border: 0, background: 'var(--bn-p)', color: 'var(--ink-0)', fontSize: '2cqw', fontWeight: 800, cursor: 'pointer', opacity: digits(phone).length < 10 ? .4 : 1 }}>Continue</button>
      </> : <>
        <input className="input" autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="First name" aria-label="First name" style={{ height: '7cqw', fontSize: '2.6cqw', borderRadius: '1.6cqw', border: '2px solid var(--bn-p)', color: 'var(--bn-ink)' }} />
        <label style={{ display: 'flex', alignItems: 'center', gap: '1.2cqw', fontSize: '1.6cqw', cursor: 'pointer' }}><input type="checkbox" checked={optIn} onChange={e => setOptIn(e.target.checked)} style={{ width: '2.4cqw', height: '2.4cqw', accentColor: 'var(--bn-p)' }} />Send me offers on WhatsApp</label>
        <div style={{ display: 'flex', gap: '1.2cqw' }}>
          <button onClick={join} style={{ flex: 1, height: '6cqw', borderRadius: '1.6cqw', border: 0, background: 'var(--bn-p)', color: 'var(--ink-0)', fontSize: '2cqw', fontWeight: 800, cursor: 'pointer' }}>Join and earn beans</button>
          <button onClick={() => setStep('phone')} style={{ height: '6cqw', padding: '0 2cqw', borderRadius: '1.6cqw', border: `1px solid ${LINE}`, background: 'var(--ink-0)', color: 'var(--bn-ink)', fontSize: '1.8cqw', fontWeight: 700, cursor: 'pointer' }}>Back</button>
        </div>
      </>}
    </div>
    {step === 'phone' ? <PhonePad value={phone} onChange={setPhone} onSkip={() => to(o?.lines.length ? 'cart' : 'idle')} /> :
      <div style={{ padding: '3cqw', borderRadius: '2cqw', background: 'var(--bn-p)', color: 'var(--ink-0)', display: 'flex', flexDirection: 'column', gap: '1.2cqw' }}>
        <b style={{ ...HEAD, fontSize: '3cqw' }}>{db.tenant.name} Rewards</b>
        {TIERS.map(t => <span key={t.id} style={{ fontSize: '1.7cqw' }}><b>{t.name}</b> · {t.min ? `${t.min.toLocaleString('en-US')} beans a year` : 'from your first order'} · earns {t.multiplier}×</span>)}
        <span style={{ fontSize: '1.5cqw', opacity: .85 }}>50 welcome beans when you join.</span>
      </div>}
  </div>;
}

// ── Split bill progress ────────────────────────────────────────────────────────────────
function Split({ L }: P) {
  const o = L.current;
  if (!o || !L.pays.length) return <Waiting icon="split" title="No split bill open" sub="When the bill is paid in parts, progress shows here." />;
  const paid = Math.min(L.settled, o.total), left = o.total - paid, pct = o.total ? paid / o.total : 0;
  const parts = [...L.pays].reverse().filter(p => p.status !== 'failed' && p.status !== 'expired');
  return <div style={{ ...PAPER, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5cqw', padding: '5cqw', alignItems: 'center' }}>
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.6cqw' }}>
      <span style={{ fontSize: '2cqw', color: MUTED }}>Split bill · order {o.no}</span>
      <b style={{ ...HEAD, fontSize: '6cqw' }}>{left > 0 ? idr(left) : 'All paid'}</b>
      <span style={{ fontSize: '2cqw', color: MUTED }}>{left > 0 ? `left to pay of ${idr(o.total)}` : idr(o.total)}</span>
      <div style={{ height: '1.6cqw', borderRadius: 99, background: LINE, overflow: 'hidden' }} role="progressbar" aria-valuenow={Math.round(pct * 100)} aria-valuemin={0} aria-valuemax={100}><div style={{ width: pct * 100 + '%', height: '100%', background: 'var(--bn-p)', transition: 'width var(--dur-slow) var(--ease-out)' }} /></div>
      <span style={{ fontSize: '1.7cqw', fontWeight: 600 }}>{idr(paid)} paid · {parts.filter(p => p.status === 'settled').length} of {parts.length + (left > 0 && !L.pending ? 1 : 0)} parts</span>
    </div>
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1cqw' }}>{parts.map((p, i) => <div key={p.id} className="cd-in" style={{ display: 'flex', alignItems: 'center', gap: '1.4cqw', padding: '1.4cqw 1.8cqw', borderRadius: '1.6cqw', background: 'var(--ink-0)', border: `1px solid ${LINE}`, fontSize: '2cqw' }}>
      <Icon name={p.status === 'settled' ? 'circle-check' : 'loader'} style={{ width: '2.6cqw', height: '2.6cqw', color: p.status === 'settled' ? 'var(--success)' : 'var(--warning)' }} />
      <span style={{ flex: 1 }}>Guest {i + 1} · {METHOD[p.method]}</span><b>{idr(p.amount)}</b></div>)}
      {left > 0 && !L.pending && <div style={{ display: 'flex', alignItems: 'center', gap: '1.4cqw', padding: '1.4cqw 1.8cqw', borderRadius: '1.6cqw', border: `2px dashed ${LINE}`, fontSize: '2cqw', color: MUTED }}><Icon name="user-round" style={{ width: '2.6cqw', height: '2.6cqw' }} /><span style={{ flex: 1 }}>Next guest</span><b>{idr(left)}</b></div>}
    </div>
  </div>;
}

// ── Receipt choice ─────────────────────────────────────────────────────────────────────
function Receipt({ db, L, to }: P) {
  const o = L.lastPaid, cust = db.customers.find(c => c.id === o?.customerId);
  const [ask, setAsk] = useState(false), [phone, setPhone] = useState(''), [done, setDone] = useState('');
  useEffect(() => { if (!done) return; const t = setTimeout(() => to('thanks'), 1600); return () => clearTimeout(t); }, [done, to]);
  if (!o) return <Waiting icon="receipt" title="Receipt" sub="Receipt options open after a payment." />;
  const send = (ch: 'wa' | 'email' | 'print' | 'none', dest = '') => { sendReceipt(o.id, ch, dest); setDone(ch === 'none' ? 'No receipt. Thank you!' : ch === 'print' ? 'Printing your receipt…' : `Sent to ${ch === 'wa' ? maskPhone(dest) : dest}`); };
  if (done) return <Waiting icon={done.startsWith('No') ? 'check' : 'send'} title={done} sub={`Order ${o.no} · ${idr(o.total)}`} paper />;
  if (ask) return <div style={{ ...PAPER, display: 'grid', gridTemplateColumns: '1fr 1fr', alignItems: 'center', padding: '5cqw', gap: '5cqw' }}>
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.6cqw' }}>
      <b style={{ ...HEAD, fontSize: '4cqw' }}>Receipt to WhatsApp</b>
      <span style={{ fontSize: '1.8cqw', color: MUTED }}>Enter your number. We only use it for this receipt.</span>
      <div style={{ height: '7cqw', borderRadius: '1.6cqw', background: 'var(--ink-0)', border: '2px solid var(--bn-p)', display: 'flex', alignItems: 'center', padding: '0 2cqw', fontSize: '3cqw', fontWeight: 700, fontFamily: 'var(--font-display)' }}>{fmtPhone(phone)}</div>
      <button disabled={digits(phone).length < 10} onClick={() => send('wa', phone)} style={{ height: '6cqw', borderRadius: '1.6cqw', border: 0, background: 'var(--bn-p)', color: 'var(--ink-0)', fontSize: '2cqw', fontWeight: 800, cursor: 'pointer', opacity: digits(phone).length < 10 ? .4 : 1 }}>Send receipt</button>
    </div>
    <PhonePad value={phone} onChange={setPhone} onSkip={() => setAsk(false)} />
  </div>;
  const opts: [string, string, string, () => void, boolean][] = [
    ['printer', 'Print', 'Paper receipt from the register', () => send('print'), true],
    ['message-circle', 'WhatsApp', cust ? maskPhone(cust.phone) : 'Enter your number', () => cust ? send('wa', cust.phone) : setAsk(true), true],
    ['mail', 'Email', cust?.email || 'No email on file', () => send('email', cust!.email), !!cust?.email],
    ['leaf', 'No receipt', 'Save paper', () => send('none'), true],
  ];
  return <div style={{ ...PAPER, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '3cqw', padding: '4cqw' }}>
    <b style={{ ...HEAD, fontSize: '4.4cqw' }}>How would you like your receipt?</b>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '1.6cqw', width: '88%' }}>{opts.map(([ic, l, s, f, ok]) =>
      <button key={l} onClick={f} disabled={!ok} style={{ ...TILE(false), height: '16cqw', opacity: ok ? 1 : .45, padding: '1cqw' }}>
        <Icon name={ic} style={{ width: '4cqw', height: '4cqw', color: 'var(--bn-p)' }} /><b style={{ fontSize: '2.4cqw' }}>{l}</b><span style={{ fontSize: '1.4cqw', color: MUTED, textAlign: 'center' }}>{s}</span></button>)}</div>
    <span style={{ fontSize: '1.6cqw', color: MUTED }}>Order {o.no} · {idr(o.total)}</span>
  </div>;
}

// ── Thank-you & points ─────────────────────────────────────────────────────────────────
function Thanks({ db, L }: P) {
  const o = L.lastPaid;
  if (!o) return <Waiting icon="heart" title="Thank you!" sub="See you again soon." />;
  const cust = db.customers.find(c => c.id === o.customerId);
  const pts = db.ledger.filter(r => r.orderId === o.id && r.points > 0).reduce((a, r) => a + r.points, 0);
  const out = db.outlets.find(x => x.id === o.outletId);
  if (!cust) return <div style={{ position: 'absolute', inset: 0, background: 'var(--bn-banner)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '2cqw', textAlign: 'center', padding: '4cqw' }}>
    <Wordmark name={db.tenant.name} size="9cqw" radius="2cqw" />
    <b style={{ ...HEAD, fontSize: '5.4cqw' }}>Terima kasih!</b>
    <span style={{ fontSize: '2.2cqw', opacity: .92 }}>See you again at {db.tenant.name} {out?.name}.</span>
    <span style={{ padding: '1.4cqw 2.2cqw', borderRadius: '1.6cqw', background: 'var(--bn-acc)', color: 'var(--bn-ink)', fontSize: '1.8cqw', fontWeight: 700 }}>Members would have earned +{earn(o.subtotal - o.discount)} beans on this order · join next time</span>
  </div>;
  const bal = balance(db.ledger, cust.id), tier = tierOf(db.ledger, cust.id), next = TIERS[TIERS.indexOf(TIERS.find(t => t.id === tier.id)!) + 1];
  const year = db.ledger.filter(r => r.customerId === cust.id && r.points > 0 && Date.now() - r.at < 365 * 864e5).reduce((a, r) => a + r.points, 0);
  return <div style={{ position: 'absolute', inset: 0, background: 'var(--bn-banner)', display: 'grid', gridTemplateColumns: '1.1fr 1fr', alignItems: 'center', gap: '4cqw', padding: '5cqw' }}>
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.8cqw' }}>
      <b style={{ ...HEAD, fontSize: '5.4cqw' }}>Terima kasih, {firstName(cust.name)}!</b>
      <span style={{ fontSize: '2.2cqw', opacity: .92 }}>Order {o.no} · {idr(o.total)}</span>
    </div>
    <div style={{ padding: '3cqw', borderRadius: '2.4cqw', background: 'var(--bn-paper)', color: 'var(--bn-ink)', display: 'flex', flexDirection: 'column', gap: '1.2cqw' }}>
      <span style={{ fontSize: '1.6cqw', color: MUTED, fontWeight: 600 }}>{db.tenant.name} Rewards · {tier.name}</span>
      <b style={{ ...HEAD, fontSize: '6cqw', color: 'var(--bn-p)', animation: 'cdPop 480ms var(--ease-spring)' }}>+{pts}</b>
      <span style={{ fontSize: '1.8cqw' }}>beans earned · balance <b>{bal.toLocaleString('en-US')}</b></span>
      {next && <><div style={{ height: '1cqw', borderRadius: 99, background: LINE, overflow: 'hidden' }}><div style={{ width: Math.min(100, year / next.min * 100) + '%', height: '100%', background: 'var(--bn-acc)' }} /></div>
        <span style={{ fontSize: '1.5cqw', color: MUTED }}>{(next.min - year).toLocaleString('en-US')} more to {next.name} · earn {next.multiplier}×</span></>}
    </div>
  </div>;
}

/** Calm in-canvas empty state (the display never shows staff UI to guests). */
function Waiting({ icon, title, sub, paper }: { icon: string; title: string; sub: string; paper?: boolean }) {
  return <div style={{ ...(paper ? PAPER : { position: 'absolute', inset: 0, background: 'var(--bn-ink)', color: 'var(--ink-0)' }), display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1.6cqw', textAlign: 'center', padding: '4cqw' }}>
    <Icon name={icon} style={{ width: '6cqw', height: '6cqw', opacity: .8 }} />
    <b style={{ ...HEAD, fontSize: '3.6cqw' }}>{title}</b>
    <span style={{ fontSize: '1.8cqw', opacity: .8 }}>{sub}</span>
  </div>;
}
