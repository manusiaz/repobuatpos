'use client';
import { themeNow } from '../system/studio.ts';
import { guestLang } from '../system/settings.ts';
import { payOn } from '../system/settings.ts';
import { gatewayResult } from '../data/actions/dispatch.ts';
import { productImage } from '../ui/kit.tsx';
// Self-order kiosk (spec: BorNiz Kiosk). Portrait 9:16 canvas in cqw units, 64px+ touch targets, actions in the
// bottom half, merchant brand. The order is a real store order (source 'kiosk', K-number) and reaches the KDS once
// paid; "pay at cashier" holds it for the register. Resets to the attract screen after 60 s without a touch.
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useApp } from '../app/context.tsx';
import { pagesOf } from '../system/registry.ts';
import { Icon, toast, useNow } from '../ui/kit.tsx';
import { idr } from '../domain/money.ts';
import { addLine, cancelPayment, clearOrder, holdOrder, newOrder, patchOrder, sendToKitchen, setQty, startPayment } from '../data/actions.ts';
import { orderPlaced } from '../data/actions/selforder.ts';
import type { Order } from '../data/schema.ts';
import { brandVars, groupsOf, LINE, missingGroup, mmss, modsFrom, modsText, MUTED, OptionPicker, QR, unit, useLang, useLocal, useMenu, Wordmark, type MenuItem, type Sel } from './guest/kit.tsx';

const SLUG = { attract: 'kiosk-attract-screen', menu: 'kiosk-menu-and-cart', pay: 'kiosk-payment-and-number' } as const;
type View = keyof typeof SLUG;
const PATHS: Record<string, string> = Object.fromEntries(pagesOf('kiosk').map(p => [p.slug, p.path]));
const pathOf = (v: View) => PATHS[SLUG[v]] ?? PATHS.kiosk ?? '/';
const TOUCH = 'max(64px, 13cqw)';
const HEAD: CSSProperties = { fontFamily: 'var(--bn-font)', fontWeight: 800, letterSpacing: '-.02em', lineHeight: 1.05 };
const CARD: CSSProperties = { border: 0, borderRadius: '5cqw', background: 'var(--ink-0)', color: 'var(--bn-ink)', boxShadow: `0 0 0 2px ${LINE}`, cursor: 'pointer' };
const PRIMARY: CSSProperties = { height: TOUCH, border: 0, borderRadius: '5cqw', background: 'var(--bn-p)', color: 'var(--ink-0)', fontSize: '5cqw', fontWeight: 800, cursor: 'pointer', fontFamily: 'var(--font-display)' };
const placed = (o: Order) => o.lines.length > 0 && (o.status === 'held' || o.lines.every(l => l.fired));

export default function Screen() {
  const { page, db, outletId, go } = useApp();
  const view = (Object.entries(SLUG).find(([, s]) => s === page.slug)?.[0] ?? 'attract') as View;
  const [orderId, setOrderId] = useLocal<string | null>('bn-kiosk-order:' + outletId, null);
  const [type, setType] = useLocal<'dine' | 'take' | null>('bn-kiosk-type', null);
  const order = db.orders.find(o => o.id === orderId) ?? null;
  const L = useLang(guestLang(db));
  const to = (v: View) => go(pathOf(v));
  const reset = () => { if (order && !placed(order) && order.status === 'open' && order.lines.length) clearOrder(order.id, 'kiosk'); setOrderId(null); setType(null); to('attract'); };

  // 60 s without a touch → back to attract (never while a QRIS code is open).
  const last = useRef(Date.now());
  const now = useNow(5000);
  const paying = !!order && db.payments.some(p => p.orderId === order.id && p.status === 'pending');
  useEffect(() => { if (view !== 'attract' && !paying && now - last.current > 60e3 && !(order && placed(order))) reset(); }); // eslint-disable-line react-hooks/exhaustive-deps

  return <div data-guest onPointerDown={() => { last.current = Date.now(); }} style={{ ...brandVars(themeNow(db, db.theme)), height: '100dvh', display: 'grid', placeItems: 'center', background: 'var(--ink-900)', overflow: 'hidden' }}>
    <div style={{ width: 'min(100vw, calc(100dvh * 9 / 16))', aspectRatio: '9 / 16', position: 'relative', overflow: 'hidden', containerType: 'inline-size', background: 'var(--bn-paper)', display: 'flex', flexDirection: 'column', userSelect: 'none' }}>
      {view === 'attract' && <Attract L={L} start={() => { last.current = Date.now(); to('menu'); }} />}
      {view === 'menu' && <Menu L={L} order={order} type={type} setType={setType} ensure={() => {
        if (order && order.status === 'open') return order.id;
        const id = newOrder(outletId, 'kiosk', 'kiosk', { type: type ?? 'dine' }); setOrderId(id); return id;
      }} toPay={() => to('pay')} />}
      {view === 'pay' && <Pay L={L} order={order} back={() => to('menu')} reset={reset} />}
      {!db.device.online && <span style={{ position: 'absolute', top: '3cqw', left: '50%', transform: 'translateX(-50%)', padding: '1.6cqw 3.4cqw', borderRadius: 99, background: 'var(--ink-950)', color: 'var(--ink-0)', fontSize: '3.2cqw', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '2cqw', whiteSpace: 'nowrap', zIndex: 5 }}><Icon name="wifi-off" size={16} />Offline · pay by card or at the cashier</span>}
    </div>
  </div>;
}
type LangT = ReturnType<typeof useLang>;

// ── Attract ────────────────────────────────────────────────────────────────────────────
function Attract({ L, start }: { L: LangT; start: () => void }) {
  const { db, outletId } = useApp();
  const { items } = useMenu(db, outletId);
  const flash = items.filter(i => i.flash != null && !i.sold).slice(0, 2);
  const out = db.outlets.find(o => o.id === outletId);
  return <div onClick={start} role="button" tabIndex={0} onKeyDown={e => e.key === 'Enter' && start()} aria-label={L.t('Tap to start')} style={{ flex: 1, display: 'flex', flexDirection: 'column', cursor: 'pointer' }}>
    <div style={{ flex: 1.1, background: 'var(--bn-banner)', position: 'relative' }}>
      <span style={{ position: 'absolute', top: '5cqw', left: '5cqw' }}><Wordmark name={db.tenant.name} size="14cqw" radius="3.6cqw" /></span>
      <span style={{ position: 'absolute', top: '6cqw', right: '5cqw', color: 'var(--ink-0)', fontSize: '3.4cqw', fontWeight: 600, opacity: .9 }}>{out?.name}</span>
    </div>
    <div style={{ flex: 1, background: 'var(--bn-p)', color: 'var(--ink-0)', padding: '7cqw 6cqw', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: '3cqw' }}>
      {flash.map(i => <span key={i.p.id} style={{ alignSelf: 'flex-start', padding: '1.6cqw 3.4cqw', borderRadius: 99, background: 'var(--bn-acc)', color: 'var(--bn-ink)', fontSize: '3.4cqw', fontWeight: 800 }}>{L.t('Flash sale')}: {i.p.name} {idr(i.flash!)}</span>)}
      <b style={{ ...HEAD, fontSize: '10cqw', lineHeight: .95 }}>{db.tenant.name}<br />{L.lang === 'id' ? 'Pesan di sini, tanpa antre' : 'Order here, skip the line'}</b>
      <span style={{ fontSize: '4cqw', opacity: .9 }}>{L.lang === 'id' ? 'Bayar dengan QRIS atau kartu' : 'Pay with QRIS or card'}</span>
      <span style={{ ...PRIMARY, background: 'var(--ink-0)', color: 'var(--bn-p)', height: 'max(64px, 17cqw)', fontSize: '6cqw', display: 'grid', placeItems: 'center' }}>{L.t('Tap to start')}</span>
      <div style={{ display: 'flex', justifyContent: 'center', gap: '2cqw' }} onClick={e => e.stopPropagation()}>{(['en', 'id'] as const).map(k =>
        <button key={k} aria-pressed={L.lang === k} onClick={() => L.setLang(k)} style={{ height: 'max(48px, 10cqw)', padding: '0 4cqw', borderRadius: 99, border: '1px solid color-mix(in srgb,var(--ink-0) 50%,transparent)', background: L.lang === k ? 'var(--ink-0)' : 'transparent', color: L.lang === k ? 'var(--bn-p)' : 'var(--ink-0)', fontSize: '3.4cqw', fontWeight: 700, cursor: 'pointer' }}>{k === 'en' ? 'English' : 'Bahasa Indonesia'}</button>)}</div>
    </div>
  </div>;
}

// ── Menu & cart ────────────────────────────────────────────────────────────────────────
function Menu({ L, order, type, setType, ensure, toPay }: { L: LangT; order: Order | null; type: 'dine' | 'take' | null; setType: (t: 'dine' | 'take' | null) => void; ensure: () => string; toPay: () => void }) {
  const { db, outletId } = useApp();
  const { items, cats, best } = useMenu(db, outletId);
  const [cat, setCat] = useState('all'), [open, setOpen] = useState<MenuItem | null>(null);
  const t = L.t;
  if (!type && !order) return <div style={{ flex: 1, padding: '8cqw 6cqw', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '5cqw' }}>
    <b style={{ ...HEAD, fontSize: '9cqw', textAlign: 'center' }}>{t('Where will you eat?')}</b>
    {([['dine', 'utensils', 'Eat here'], ['take', 'shopping-bag', 'Take away']] as const).map(([k, ic, l]) =>
      <button key={k} onClick={() => setType(k)} style={{ ...CARD, borderRadius: '6cqw', height: '34cqw', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '2cqw' }}>
        <Icon name={ic} style={{ width: '16cqw', height: '16cqw' }} /><b style={{ fontSize: '6cqw' }}>{t(l)}</b></button>)}
  </div>;
  const list = items.filter(i => cat === 'all' || i.cat === cat).sort((a, b) => (best.indexOf(a.p.id) + 1 || 99) - (best.indexOf(b.p.id) + 1 || 99));
  const inCart = (id: string) => order?.status === 'open' ? order.lines.filter(l => l.productId === id).reduce((a, l) => a + l.qty, 0) : 0;
  const count = order?.status === 'open' ? order.lines.reduce((a, l) => a + l.qty, 0) : 0;
  const add = (i: MenuItem, mods: { name: string; price: number }[] = [], qty = 1) => addLine(ensure(), i.p.id, mods, qty, '', 'kiosk');
  const ty = order?.type ?? type ?? 'dine';
  return <>
    <div style={{ flex: 'none', padding: '5cqw 5cqw 3cqw', display: 'flex', alignItems: 'center', gap: '3cqw' }}>
      <b style={{ ...HEAD, flex: 1, fontSize: '7cqw' }}>{t('Menu')}</b>
      <button onClick={() => order ? patchOrder(order.id, { type: ty === 'dine' ? 'take' : 'dine' }, 'kiosk') : setType(ty === 'dine' ? 'take' : 'dine')} style={{ height: 'max(48px, 10cqw)', padding: '0 4cqw', borderRadius: 99, border: 0, background: 'var(--ink-0)', color: 'var(--bn-ink)', fontSize: '3.4cqw', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '1.6cqw', cursor: 'pointer' }}>
        <Icon name={ty === 'dine' ? 'utensils' : 'shopping-bag'} size={18} />{t(ty === 'dine' ? 'Dine-in' : 'Takeaway')}</button>
    </div>
    <div style={{ flex: 'none', display: 'flex', gap: '2cqw', padding: '0 5cqw 3cqw', overflowX: 'auto' }}>{[['all', 'All'] as const, ...cats.map(c => [c.id, c.name] as const)].map(([k, l]) =>
      <button key={k} aria-pressed={cat === k} onClick={() => setCat(k)} style={{ flex: 'none', height: TOUCH, padding: '0 5cqw', border: 0, borderRadius: 99, background: cat === k ? 'var(--bn-ink)' : 'var(--ink-0)', color: cat === k ? 'var(--ink-0)' : 'var(--bn-ink)', fontSize: '4cqw', fontWeight: 700, cursor: 'pointer' }}>{t(l)}</button>)}</div>
    <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '0 5cqw 26cqw', display: 'grid', gridTemplateColumns: '1fr 1fr', gridAutoRows: 'min-content', gap: '3cqw' }}>
      {list.map(i => { const n = inCart(i.p.id); return <button key={i.p.id} disabled={i.sold} onClick={() => groupsOf(db, i.p).length ? setOpen(i) : add(i)} aria-label={`${i.p.name}, ${i.sold ? t('Sold out') : idr(unit(i))}`}
        style={{ ...CARD, boxShadow: 'none', padding: 0, overflow: 'hidden', textAlign: 'left', position: 'relative', opacity: i.sold ? .55 : 1, cursor: i.sold ? 'not-allowed' : 'pointer' }}>
        <span style={{ display: 'block', aspectRatio: '1', background: i.sold ? 'var(--bg-sunken)' : productImage(i.p) }} />
        <span style={{ display: 'block', padding: '3cqw' }}><b style={{ display: 'block', fontSize: '4cqw', lineHeight: 1.2 }}>{i.p.name}</b>
          {i.sold ? <b style={{ fontSize: '4cqw', color: MUTED }}>{t('Sold out')}</b> : <><b style={{ fontSize: '4cqw', color: 'var(--bn-p)' }}>{idr(unit(i))}</b>{i.flash != null && <s style={{ fontSize: '3cqw', color: MUTED, marginLeft: '1.4cqw' }}>{idr(i.price).replace('IDR ', '')}</s>}</>}</span>
        {n > 0 && <span style={{ position: 'absolute', top: '2.4cqw', right: '2.4cqw', minWidth: '9cqw', height: '9cqw', padding: '0 2cqw', borderRadius: 99, background: 'var(--bn-p)', color: 'var(--ink-0)', fontSize: '4cqw', fontWeight: 800, lineHeight: '9cqw', textAlign: 'center' }}>{n}</span>}
        {i.flash != null && !i.sold && <span style={{ position: 'absolute', top: '2.4cqw', left: '2.4cqw', padding: '.8cqw 2cqw', borderRadius: 99, background: 'var(--bn-acc)', fontSize: '2.8cqw', fontWeight: 800 }}>{t('Flash sale')}</span>}
      </button>; })}
    </div>
    {count > 0 && <button onClick={toPay} style={{ ...PRIMARY, position: 'absolute', left: '5cqw', right: '5cqw', bottom: '5cqw', height: 'max(64px, 17cqw)', display: 'flex', alignItems: 'center', padding: '0 5cqw', gap: '3cqw', boxShadow: 'var(--shadow-e2)' }}>
      <span>{count} {count > 1 ? 'items' : 'item'}</span><span style={{ marginLeft: 'auto' }}>Pay {idr(order!.total)}</span></button>}
    {open && <ItemSheet i={open} L={L} close={() => setOpen(null)} add={(mods, q) => { add(open, mods, q); setOpen(null); }} />}
  </>;
}

function ItemSheet({ i, L, close, add }: { i: MenuItem; L: LangT; close: () => void; add: (mods: { name: string; price: number }[], qty: number) => void }) {
  const { db } = useApp();
  const groups = groupsOf(db, i.p);
  const [sel, setSel] = useState<Sel>({}), [q, setQ] = useState(1);
  const miss = missingGroup(groups, sel), mods = modsFrom(groups, sel);
  const each = unit(i) + mods.reduce((a, m) => a + m.price, 0);
  return <>
    <div onClick={close} style={{ position: 'absolute', inset: 0, background: 'color-mix(in srgb,var(--ink-950) 45%,transparent)', zIndex: 8, animation: 'fade var(--dur-base) var(--ease-out)' }} />
    <div role="dialog" aria-modal="true" aria-label={i.p.name} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '88%', zIndex: 9, background: 'var(--bn-paper)', borderRadius: '7cqw 7cqw 0 0', display: 'flex', flexDirection: 'column', animation: 'slideU var(--dur-slow) var(--ease-out)' }}>
      <div style={{ flex: 'none', display: 'flex', gap: '4cqw', padding: '5cqw', alignItems: 'center' }}>
        <span style={{ width: '22cqw', height: '22cqw', borderRadius: '5cqw', background: productImage(i.p), flex: 'none' }} />
        <span style={{ flex: 1, minWidth: 0 }}><b style={{ ...HEAD, display: 'block', fontSize: '6cqw' }}>{i.p.name}</b><span style={{ fontSize: '4cqw', color: MUTED }}>{idr(unit(i))}</span></span>
        <button onClick={close} aria-label="Close" style={{ width: TOUCH, height: TOUCH, borderRadius: 99, border: 0, background: 'var(--ink-0)', cursor: 'pointer', display: 'grid', placeItems: 'center' }}><Icon name="x" size={28} /></button>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '0 5cqw 4cqw', fontSize: '4cqw' }}><OptionPicker groups={groups} sel={sel} onChange={setSel} t={L.t} h={TOUCH} font="4cqw" /></div>
      <div style={{ flex: 'none', display: 'flex', gap: '3cqw', padding: '4cqw 5cqw 5cqw', borderTop: `1px solid ${LINE}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '2cqw' }}>
          <button aria-label="Fewer" onClick={() => setQ(Math.max(1, q - 1))} style={{ ...CARD, width: TOUCH, height: TOUCH, display: 'grid', placeItems: 'center' }}><Icon name="minus" size={26} /></button>
          <b style={{ minWidth: '7cqw', textAlign: 'center', fontSize: '5.4cqw' }}>{q}</b>
          <button aria-label="More" onClick={() => setQ(q + 1)} style={{ ...CARD, width: TOUCH, height: TOUCH, display: 'grid', placeItems: 'center' }}><Icon name="plus" size={26} /></button>
        </div>
        <button disabled={!!miss} onClick={() => add(mods, q)} style={{ ...PRIMARY, flex: 1, fontSize: '4.6cqw', opacity: miss ? .45 : 1 }}>{miss ? `Choose ${miss.name.toLowerCase()}` : `${L.t('Add')} · ${idr(each * q)}`}</button>
      </div>
    </div>
  </>;
}

// ── Payment & number ───────────────────────────────────────────────────────────────────
function Pay({ L, order, back, reset }: { L: LangT; order: Order | null; back: () => void; reset: () => void }) {
  const { db } = useApp();
  const now = useNow(1000);
  const [err, setErr] = useState('');
  const pend = order ? db.payments.find(p => p.orderId === order.id && p.status === 'pending' && p.method === 'qris') : undefined;
  const isPlaced = !!order && placed(order);
  const [left, setLeft] = useState(15);
  useEffect(() => { if (!isPlaced) return; setLeft(15); const t = setInterval(() => setLeft(l => l - 1), 1000); return () => clearInterval(t); }, [isPlaced]);
  useEffect(() => { if (isPlaced && left <= 0) reset(); }); // eslint-disable-line react-hooks/exhaustive-deps

  if (order && isPlaced) {
    const later = order.status === 'held';
    return <div style={{ flex: 1, background: later ? 'var(--bn-p)' : 'var(--success)', color: 'var(--ink-0)', padding: '8cqw', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '4cqw', textAlign: 'center' }}>
      <span style={{ fontSize: '6cqw', fontWeight: 700 }}>{L.lang === 'id' ? 'Nomor kamu' : 'Your number'}</span>
      <b style={{ ...HEAD, fontSize: '22cqw', lineHeight: .9 }} aria-live="polite">{order.no}</b>
      <span style={{ fontSize: '4.4cqw', lineHeight: 1.4 }}>{later ? `Pay ${idr(order.total)} at the counter and show this number. We start making it once paid.` : 'Watch the screen near the counter. We’ll call your number when it’s ready.'}</span>
      <span style={{ padding: '3cqw 5cqw', borderRadius: '4cqw', background: 'color-mix(in srgb,var(--ink-0) 18%,transparent)', fontSize: '3.8cqw' }}>{later ? 'Ticket printed · ' : 'Receipt printed · '}{order.type === 'take' ? 'Takeaway' : 'Dine-in'}</span>
      <button onClick={reset} style={{ marginTop: '4cqw', height: TOUCH, padding: '0 10cqw', border: 0, borderRadius: '4cqw', background: 'var(--ink-0)', color: 'var(--bn-ink)', fontSize: '4.6cqw', fontWeight: 800, cursor: 'pointer' }}>Done</button>
      <span style={{ fontSize: '3.2cqw', opacity: .8 }}>Resets in {Math.max(0, left)}s</span>
    </div>;
  }
  if (!order || !order.lines.length) return <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '4cqw', padding: '8cqw', textAlign: 'center' }}>
    <Icon name="shopping-basket" style={{ width: '16cqw', height: '16cqw', color: MUTED }} />
    <b style={{ ...HEAD, fontSize: '7cqw' }}>{L.t('Your cart is empty')}</b>
    <button onClick={back} style={{ ...PRIMARY, padding: '0 10cqw' }}>{L.t('See the menu')}</button>
  </div>;

  if (pend) {
    const ms = (pend.expiresAt ?? now) - now;
    return <div style={{ flex: 1, padding: '7cqw 6cqw', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4cqw', textAlign: 'center' }}>
      <span style={{ padding: '1.6cqw 4cqw', borderRadius: 99, background: ms > 0 ? 'var(--warning-soft)' : 'var(--danger-soft)', color: ms > 0 ? 'var(--warning-fg)' : 'var(--danger-fg)', fontSize: '3.6cqw', fontWeight: 800 }}>{ms > 0 ? `${L.t('Waiting for payment')} · ${mmss(ms)}` : 'This code has expired'}</span>
      <b style={{ ...HEAD, fontSize: '9cqw' }}>{idr(pend.amount)}</b>
      <div style={{ width: '64cqw', padding: '4cqw', borderRadius: '5cqw', background: 'var(--ink-0)', boxShadow: `0 0 0 2px ${LINE}`, opacity: ms > 0 ? 1 : .25 }}><QR value={pend.qr ?? pend.ref} label={`QRIS code for ${idr(pend.amount)}`} /></div>
      <span style={{ fontSize: '4cqw', color: MUTED, lineHeight: 1.4 }}>Scan with any bank or e-wallet app. Your number appears as soon as it’s paid.</span>
      <span className="mono" style={{ color: MUTED }}>{pend.ref}</span>
      <div style={{ marginTop: 'auto', width: '100%', display: 'flex', flexDirection: 'column', gap: '3cqw' }}>
        {ms > 0 && <button onClick={() => gatewayResult(pend.id, 'settled').catch(e => toast((e as Error).message))} style={{ ...CARD, height: 'max(48px, 10cqw)', fontSize: '3.6cqw', fontWeight: 700, color: MUTED }}>Simulate payment (demo)</button>}
        <button onClick={() => cancelPayment(pend.id, 'kiosk')} style={{ ...CARD, height: TOUCH, fontSize: '4.4cqw', fontWeight: 800 }}>{ms > 0 ? 'Cancel and choose another way' : 'Try again'}</button>
      </div>
    </div>;
  }

  const out = db.outlets.find(o => o.id === order.outletId)!;
  const pay = (k: 'qris' | 'card' | 'cashier') => {
    setErr('');
    try {
      if (k === 'cashier') { holdOrder(order.id, 'kiosk'); orderPlaced(order.id, true); }
      else startPayment(order.id, k, order.total, 'kiosk');
    } catch (e) { setErr((e as Error).message); }
  };
  const methods: [('qris' | 'card' | 'cashier'), string, string, string, boolean][] = [
    ['qris', 'qr-code', 'QRIS', 'Scan with any bank or e-wallet', db.device.online], ['card', 'credit-card', 'Card', 'Tap or insert below the screen', true], ['cashier', 'receipt', L.t('Pay at the cashier'), 'Print a ticket and pay at the counter', true]];
  const offered = methods.filter(([k]) => k === 'cashier' || payOn(db, k)); // the owner's Payment methods decide
  return <div style={{ flex: 1, minHeight: 0, padding: '7cqw 6cqw 6cqw', display: 'flex', flexDirection: 'column', gap: '3.4cqw' }}>
    <b style={{ ...HEAD, fontSize: '8cqw' }}>Pay {idr(order.total)}</b>
    <div style={{ flex: '0 1 auto', minHeight: 0, overflow: 'auto', padding: '4cqw', borderRadius: '5cqw', background: 'var(--ink-0)', display: 'flex', flexDirection: 'column', gap: '2.4cqw', fontSize: '3.8cqw' }}>
      {order.lines.map(l => <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: '2cqw' }}>
        <span style={{ flex: 1, minWidth: 0 }}>{l.name}{l.mods.length > 0 && <span style={{ display: 'block', fontSize: '3cqw', color: MUTED }}>{modsText(l.mods)}</span>}</span>
        <button aria-label={`Fewer ${l.name}`} onClick={() => setQty(order.id, l.id, l.qty - 1, 'kiosk')} style={{ ...CARD, width: 'max(48px,10cqw)', height: 'max(48px,10cqw)', borderRadius: '3cqw', display: 'grid', placeItems: 'center' }}><Icon name={l.qty > 1 ? 'minus' : 'trash-2'} size={20} /></button>
        <b style={{ minWidth: '5cqw', textAlign: 'center' }}>{l.qty}</b>
        <button aria-label={`More ${l.name}`} onClick={() => setQty(order.id, l.id, l.qty + 1, 'kiosk')} style={{ ...CARD, width: 'max(48px,10cqw)', height: 'max(48px,10cqw)', borderRadius: '3cqw', display: 'grid', placeItems: 'center' }}><Icon name="plus" size={20} /></button>
      </div>)}
      <div style={{ borderTop: `1px solid ${LINE}`, paddingTop: '2cqw', display: 'flex', flexDirection: 'column', gap: '1cqw', fontSize: '3.4cqw', color: MUTED }}>
        <span style={{ display: 'flex', justifyContent: 'space-between' }}><span>{L.t('Subtotal')}</span><span>{idr(order.subtotal)}</span></span>
        {order.service > 0 && <span style={{ display: 'flex', justifyContent: 'space-between' }}><span>{L.t('Service')} {out.serviceBps / 100}%</span><span>{idr(order.service)}</span></span>}
        <span style={{ display: 'flex', justifyContent: 'space-between' }}><span>PB1 {out.taxBps / 100}%{out.taxInclusive ? ' incl.' : ''}</span><span>{idr(order.tax)}</span></span>
      </div>
    </div>
    {offered.map(([k, ic, l, d, ok]) => <button key={k} disabled={!ok} onClick={() => pay(k)} style={{ ...CARD, flex: 'none', height: 'max(72px, 18cqw)', display: 'flex', alignItems: 'center', gap: '4cqw', padding: '0 5cqw', textAlign: 'left', opacity: ok ? 1 : .45 }}>
      <Icon name={ic} style={{ width: '8cqw', height: '8cqw', color: 'var(--bn-p)' }} />
      <span style={{ display: 'flex', flexDirection: 'column', gap: '1cqw' }}><b style={{ fontSize: '5cqw' }}>{l}</b><span style={{ fontSize: '3.4cqw', color: MUTED }}>{ok ? d : 'Needs internet. Use card or pay at the cashier.'}</span></span></button>)}
    {err && <span role="alert" style={{ color: 'var(--danger-fg)', fontSize: '3.6cqw' }}>{err}</span>}
    <button onClick={back} style={{ marginTop: 'auto', flex: 'none', height: TOUCH, border: 0, borderRadius: '4cqw', background: 'transparent', color: MUTED, fontSize: '4cqw', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '2cqw' }}><Icon name="arrow-left" size={22} />Back to menu</button>
  </div>;
}
