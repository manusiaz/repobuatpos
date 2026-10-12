'use client';
// Menu Studio "more pages" live on the QR menu host: category styles, the combo builder, split bill from phones, gift
// cards, the referral card, the online store / link-in-bio front page and the printable menu. Every view reads the
// published Menu Studio values (studioValue / helpers in system/studio.ts), so editing in the studio changes them here.
import { useState, type ReactNode } from 'react';
import { categoryLook, comboOf, giftCardOf, referralCode, referralOffer, studioValue } from '../../system/studio.ts';
import { linkTo } from '../../system/hosts.ts';
import { itemName } from '../../system/tools.ts';
import { payOn } from '../../system/settings.ts';
import { menuDesign } from '../../data/actions/studio.ts';
import { addCombo, cancelPayment } from '../../data/actions.ts';
import { gatewayResult } from '../../data/actions/dispatch.ts';
import { billSplit, buyGiftCard, cancelGiftCard, payShare, shareAmounts, type SplitMode } from '../../data/actions/selforder.ts';
import type { Customer, Payment } from '../../data/schema.ts';
import { idr } from '../../domain/money.ts';
import { Empty, Icon, productImage, toast, useNow } from '../../ui/kit.tsx';
import { ComboBuilder, comboHere } from '../guest/combo.tsx';
import { firstName, LINE, mmss, MUTED, QR, SURFACE, TINT, unit, useLocal, useMenu, Wordmark, type MenuItem } from '../guest/kit.tsx';
import { back, Bar, ItemRow, settledOf, so, tableNo, type G } from './shared.tsx';

const card = { padding: 16, borderRadius: 18, background: SURFACE } as const;
const choice = (on: boolean) => ({ border: `2px solid ${on ? 'var(--bn-p)' : LINE}`, background: on ? TINT : SURFACE, color: 'var(--bn-ink)', borderRadius: 14, cursor: 'pointer' });
const link = (g: G, to: string) => ({ href: to, onClick: (e: { preventDefault: () => void }) => { e.preventDefault(); g.go(to); } });

// ── Style per category ─────────────────────────────────────────────────────────────────
const BG = { page: 'transparent', surface: SURFACE, brand: 'color-mix(in srgb,var(--bn-p) 10%,var(--bn-paper))' } as const;
/** A menu category in the look the owner gave it (list, grid, big photo or printed; page, card or brand-tint background; banner). */
export function CatSection({ g, catId, name, list, right, badge, count, onOpen }: { g: G; catId: string; name: string; list: MenuItem[]; right?: ReactNode; badge?: (i: MenuItem) => string | undefined; count: (id: string) => number; onOpen: (id: string) => void }) {
  const s = categoryLook(g.db, catId), boxed = s.bg !== 'page', nm = (i: MenuItem) => itemName(g.db, i.p, g.L.lang);
  const head = s.banner
    ? <div style={{ aspectRatio: '3/1', borderRadius: 18, background: `linear-gradient(180deg,transparent 35%,color-mix(in srgb,var(--ink-950) 60%,transparent)),url(${s.banner}) center/cover`, color: 'var(--ink-0)', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', padding: 14, gap: 8 }}>
      <h2 style={{ fontSize: 22, fontWeight: 800 }}>{name}</h2>{right}</div>
    : <div className="row between"><h2 style={{ fontSize: 20, fontWeight: 800 }}>{name}</h2><span style={{ color: 'var(--bn-p)' }}>{right}</span></div>;
  const price = (i: MenuItem) => i.sold ? <b style={{ fontSize: 14, color: MUTED }}>{g.t('Sold out')}</b> : <b style={{ fontSize: 14 }}>{idr(unit(i))}</b>;
  const tile = (i: MenuItem) => { const n = count(i.p.id);
    return <button key={i.p.id} type="button" onClick={() => onOpen(i.p.id)} disabled={i.sold} aria-label={`${nm(i)}, ${i.sold ? g.t('Sold out') : idr(unit(i))}`}
      style={{ border: 0, padding: 8, borderRadius: 18, background: SURFACE, color: 'var(--bn-ink)', textAlign: 'left', cursor: i.sold ? 'not-allowed' : 'pointer', opacity: i.sold ? .55 : 1, display: 'flex', flexDirection: 'column', gap: 6, position: 'relative', boxShadow: boxed && s.bg === 'surface' ? `0 0 0 1px ${LINE}` : 'none' }}>
      <span style={{ display: 'block', aspectRatio: s.layout === 'big' ? '16/9' : '1/1', borderRadius: 14, background: i.sold ? 'var(--bg-sunken)' : productImage(i.p) }} />
      <span style={{ padding: '0 4px 4px', display: 'flex', flexDirection: 'column', gap: 2 }}><b style={{ fontSize: s.layout === 'big' ? 17 : 15, lineHeight: 1.25 }}>{nm(i)}{i.badges.map(([k, l, ic]) => <Icon key={k} name={ic} size={14} aria-label={l} style={{ marginLeft: 4, verticalAlign: '-2px', color: 'var(--bn-p)' }} />)}</b>
        {s.layout === 'big' && i.p.desc && <span style={{ fontSize: 13, color: MUTED }}>{i.p.desc}</span>}{price(i)}</span>
      {(n > 0 || badge?.(i)) && <span style={{ position: 'absolute', top: 14, right: 14, minWidth: 28, height: 28, padding: '0 8px', borderRadius: 99, background: n ? 'var(--bn-p)' : 'var(--bn-acc)', color: n ? 'var(--ink-0)' : 'var(--bn-ink)', fontSize: n ? 13 : 11, fontWeight: 800, lineHeight: '28px', textAlign: 'center' }}>{n || badge?.(i)}</span>}
    </button>; };
  const printed = (i: MenuItem) => <button key={i.p.id} type="button" onClick={() => onOpen(i.p.id)} disabled={i.sold} style={{ border: 0, borderBottom: `1px dashed ${LINE}`, background: 'transparent', color: 'var(--bn-ink)', padding: '10px 2px', minHeight: 48, textAlign: 'left', cursor: i.sold ? 'not-allowed' : 'pointer', opacity: i.sold ? .55 : 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
    <span style={{ display: 'flex', alignItems: 'baseline', gap: 6, width: '100%' }}><b style={{ fontSize: 15, fontFamily: 'var(--bn-font)' }}>{nm(i)}</b><span aria-hidden style={{ flex: 1, borderBottom: `1px dotted ${MUTED}`, transform: 'translateY(-4px)' }} />{price(i)}{count(i.p.id) > 0 && <b style={{ color: 'var(--bn-p)', fontSize: 13 }}>×{count(i.p.id)}</b>}</span>
    {i.p.desc && <span style={{ fontSize: 13, color: MUTED }}>{i.p.desc}</span>}</button>;
  return <section className="stack" style={{ margin: boxed ? '8px 14px' : 0, padding: boxed ? 12 : '10px 14px', borderRadius: boxed ? 22 : 0, background: BG[s.bg], gap: s.layout === 'text' ? 4 : 10 }} aria-label={name}>
    {head}
    {s.layout === 'list' ? list.map(i => <ItemRow key={i.p.id} i={i} lang={g.L.lang} t={g.t} badge={badge?.(i)} count={count(i.p.id)} onOpen={() => onOpen(i.p.id)} />)
      : s.layout === 'text' ? list.map(printed)
      : <div style={{ display: 'grid', gridTemplateColumns: s.layout === 'grid' ? 'repeat(auto-fill,minmax(150px,1fr))' : '1fr', gap: 10 }}>{list.map(tile)}</div>}
  </section>;
}
/** How many of a category's items the menu home shows before "See all". */
export const homeCount = (g: G, catId: string) => categoryLook(g.db, catId).layout === 'grid' ? 4 : 3;

// ── Combo builder ──────────────────────────────────────────────────────────────────────
export function ComboCard({ g }: { g: G }) {
  const c = comboHere(g.db, g.outletId);
  if (!c) return null;
  return <div style={{ padding: '6px 14px' }}><button onClick={() => g.go(so('item-detail-and-options', { combo: '1' }))} style={{ width: '100%', padding: 14, borderRadius: 20, border: 0, background: 'var(--bn-ink)', color: 'var(--ink-0)', display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left', cursor: 'pointer' }}>
    <span style={{ display: 'flex', flex: 'none' }}>{c.steps.map((s, i) => <span key={i} style={{ width: 40, height: 40, borderRadius: 99, marginLeft: i ? -12 : 0, background: productImage(s.items[0].p), boxShadow: '0 0 0 2px var(--bn-ink)' }} />)}</span>
    <span className="stack grow" style={{ gap: 2, minWidth: 0 }}><span style={{ fontSize: 11, fontWeight: 800, color: 'var(--bn-acc)', textTransform: 'uppercase', letterSpacing: '.06em' }}>Combo</span><b style={{ fontSize: 15 }}>{c.name} · {idr(c.price)}</b>
      <span style={{ fontSize: 12, opacity: .85, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.steps.map(s => s.title).join(' + ')}</span></span>
    <span style={{ height: 40, padding: '0 14px', borderRadius: 99, background: 'var(--bn-acc)', color: 'var(--bn-ink)', fontSize: 13, fontWeight: 800, display: 'grid', placeItems: 'center', flex: 'none' }}>Build</span></button></div>;
}
export function ComboPage({ g }: { g: G }) {
  const blocked = !g.canOrder ? 'Ordering closed' : g.cart?.status === 'paying' ? 'Payment in progress' : undefined;
  return <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column' }}>
    <ComboBuilder db={g.db} outletId={g.outletId} disabled={blocked} onClose={() => back(g.go, so('menu-home'))} onAdd={picks => {
      try { addCombo(g.ensureCart(), comboOf(g.db), picks, 'guest'); toast(`Added ${comboOf(g.db).name}`); g.go(so('menu-home')); } catch (e) { toast((e as Error).message); }
    }} />
  </div>;
}

// ── QRIS for one share / one gift card (pay on this phone) ─────────────────────────────
function PayHere({ p, note, onCancel }: { p: Payment; note: ReactNode; onCancel: () => void }) {
  const now = useNow(1000), left = (p.expiresAt ?? now) - now, expired = left <= 0;
  return <div style={{ ...card, alignItems: 'center', textAlign: 'center' }} className="stack">
    <span className="badge" style={{ height: 30, padding: '0 12px', background: expired ? 'var(--danger-soft)' : 'var(--warning-soft)', color: expired ? 'var(--danger-fg)' : 'var(--warning-fg)' }} aria-live="polite"><i className="dot" />{expired ? 'This code has expired' : `Waiting for payment · ${mmss(left)}`}</span>
    <b style={{ fontFamily: 'var(--bn-font)', fontSize: 32, fontWeight: 800, lineHeight: 1 }}>{idr(p.amount + p.tip)}</b>
    <span style={{ fontSize: 14, color: MUTED }}>{note}</span>
    <div style={{ width: 'min(240px, 70vw)', padding: 12, borderRadius: 20, background: 'var(--ink-0)', boxShadow: `0 0 0 1px ${LINE}`, opacity: expired ? .25 : 1 }}><QR value={p.ref} label={`QRIS code for ${idr(p.amount + p.tip)}`} /></div>
    <span className="mono" style={{ color: MUTED }}>{p.ref}</span>
    {!expired && <button className="btn btn-ghost btn-sm" onClick={() => gatewayResult(p.id, 'settled').catch(e => toast((e as Error).message))}>Simulate payment (demo)</button>}
    <button className="btn btn-block" style={{ height: 52, borderRadius: 16 }} onClick={onCancel}>{expired ? 'Start again' : 'Cancel'}</button>
  </div>;
}
const Progress = ({ paid, total }: { paid: number; total: number }) => <div className="stack" style={{ gap: 6 }}>
  <div className="row between" style={{ fontSize: 14 }}><span>Paid <b>{idr(paid)}</b></span><span style={{ color: MUTED }}>of {idr(total)}</span></div>
  <span style={{ height: 8, borderRadius: 9, background: 'var(--bg-sunken)', overflow: 'hidden' }}><span style={{ display: 'block', width: Math.min(100, total ? paid / total * 100 : 0) + '%', height: '100%', background: 'var(--bn-p)', transition: 'width 300ms' }} /></span></div>;

// ── Split the bill from phones ─────────────────────────────────────────────────────────
/** Shown where a table pays: everyone at the table opens it from the same table QR. */
export const splitOn = (g: G) => { const v = studioValue(g.db, 'split-bill-and-pay-together-from-phones'); return payOn(g.db, 'split') && payOn(g.db, 'qris') && (v.equal || v.items); };
export function SplitBill({ g }: { g: G }) {
  const { db } = g;
  const v = studioValue(db, 'split-bill-and-pay-together-from-phones'), max = Math.max(2, Number(v.max) || 2);
  const [mine, setMine] = useLocal<string | null>('bn-split-pay', null);
  const myPay = db.payments.find(p => p.id === mine) ?? null;
  const o = g.cart ?? (myPay ? db.orders.find(x => x.id === myPay.orderId) ?? null : null);
  const modes = (['equal', 'items'] as const).filter(m => v[m]);
  const plan = o ? billSplit(db, o.id) : null, locked = !!plan?.shares.length;
  const [pick, setPick] = useState<SplitMode>(modes[0] ?? 'equal'), [nPick, setN] = useState(Math.min(3, max));
  const [sel, setSel] = useState<string[]>([]), [part, setPart] = useState<number | null>(null), [tipPct, setTip] = useState(0), [err, setErr] = useState('');
  const top = <Bar title="Split the bill" onBack={() => back(g.go, so('checkout-and-payment'))} right={<span style={{ fontSize: 13, color: MUTED }}>Table {tableNo(g.table)}</span>} />;
  if (!o || !o.lines.length) return <>{top}<Empty icon="split" title="No bill to split" action={<button className="btn btn-primary" onClick={() => g.go(so('menu-home'))}>{g.t('See the menu')}</button>}>Order first. Everyone at the table can then pay their share from their own phone.</Empty></>;
  if (!splitOn(g) || !modes.length) return <>{top}<Empty icon="split" title="Splitting isn’t available here" action={<button className="btn btn-primary" onClick={() => g.go(so('checkout-and-payment'))}>Pay the bill</button>}>One phone pays the whole bill, or pay at the cashier.</Empty></>;
  const settled = settledOf(db, o), due = o.total - settled;
  if (o.paidAt || due <= 0) return <>{top}<div className="stack" style={{ padding: 14, gap: 14 }}><div style={{ ...card, textAlign: 'center' }} className="stack"><Icon name="circle-check" size={36} style={{ alignSelf: 'center', color: 'var(--success-fg)' }} /><b style={{ fontSize: 20 }}>The bill is paid · terima kasih!</b><span style={{ color: MUTED, fontSize: 14 }}>{o.no} · {idr(o.total)} from {Math.max(1, plan?.shares.length ?? 1)} phone{(plan?.shares.length ?? 1) > 1 ? 's' : ''}</span></div>
    <button className="btn" style={{ height: 52, borderRadius: 16 }} onClick={() => { setMine(null); g.go(so('digital-receipt', { o: o.id })); }}><Icon name="receipt" />Receipt</button></div></>;
  const mode = locked ? plan!.mode ?? pick : pick, n = locked ? plan!.n || nPick : nPick;
  const amounts = shareAmounts(o, mode, n), shares = plan?.shares ?? [];
  const stateOf = (key: string) => shares.find(s => mode === 'items' ? s.key.split(',').includes(key) : s.key === key);
  const pending = shares.filter(s => !s.paid).reduce((a, s) => a + s.amount, 0);
  let key = '', amount = 0;
  if (mode === 'equal') {
    const open = amounts.map((_, i) => i).filter(i => !stateOf('part:' + i)), i = part != null && open.includes(part) ? part : open[0];
    if (i != null) { key = 'part:' + i; amount = open.length === 1 && !pending ? due : amounts[i]; }
  } else {
    const free = o.lines.filter(l => !stateOf(l.id)).map(l => l.id), chosen = sel.filter(id => free.includes(id));
    key = chosen.join(','); amount = chosen.length && chosen.length === free.length && !pending ? due : o.lines.reduce((a, l, i) => a + (chosen.includes(l.id) ? amounts[i] : 0), 0);
  }
  const tip = v.tip ? Math.round(amount * tipPct / 100 / 100) * 100 : 0;
  const pay = () => { setErr(''); try { setMine(payShare(o.id, mode, n, key, amount, tip)); setSel([]); setPart(null); } catch (e) { setErr((e as Error).message); } };
  const tag = (s: ReturnType<typeof stateOf>) => s && <span className="badge" style={{ background: s.paid ? 'var(--success-soft)' : 'var(--warning-soft)', color: s.paid ? 'var(--success-fg)' : 'var(--warning-fg)' }}>{s.paid ? 'Paid' : 'Paying'}</span>;
  return <div style={{ paddingBottom: 110 }}>
    {top}
    <div className="stack" style={{ padding: 14, gap: 14 }}>
      <div style={card} className="stack"><Progress paid={settled} total={o.total} /><span style={{ fontSize: 13, color: MUTED }}>Everyone at Table {tableNo(g.table)} opens this page from the table QR and pays their own share by QRIS. {o.no} is paid when the shares add up.</span></div>
      {myPay?.status === 'pending' ? <PayHere p={myPay} note={`Your share of ${o.no}`} onCancel={() => { cancelPayment(myPay.id, 'guest'); setMine(null); }} /> : <>
        {myPay?.status === 'settled' && <div role="status" className="banner" style={{ background: 'var(--success-soft)', color: 'var(--success-fg)' }}><Icon name="circle-check" /><span>Your share of {idr(myPay.amount)} is paid. Waiting for the rest of the table.</span></div>}
        {modes.length > 1 && <div className="row" role="radiogroup" aria-label="How to split" style={{ gap: 8 }}>{modes.map(m => <button key={m} role="radio" aria-checked={mode === m} disabled={locked} onClick={() => setPick(m)} style={{ ...choice(mode === m), flex: 1, minHeight: 52, fontWeight: 700, opacity: locked && mode !== m ? .5 : 1 }}>{m === 'equal' ? 'Split equally' : 'Pay for my items'}</button>)}</div>}
        {mode === 'equal' ? <div style={card} className="stack">
          <div className="row between"><b>People at the table</b><div className="row" style={{ gap: 4 }}>
            <button className="btn btn-ghost icon-btn" aria-label="Fewer people" disabled={locked || n <= 2} onClick={() => setN(n - 1)}><Icon name="minus" /></button><b style={{ minWidth: 24, textAlign: 'center' }} aria-live="polite">{n}</b>
            <button className="btn btn-ghost icon-btn" aria-label="More people" disabled={locked || n >= max} onClick={() => setN(n + 1)}><Icon name="plus" /></button></div></div>
          <div role="radiogroup" aria-label="Shares" className="stack sm">{amounts.map((a, i) => { const st = stateOf('part:' + i), on = key === 'part:' + i;
            return <button key={i} role="radio" aria-checked={on} disabled={!!st} onClick={() => setPart(i)} style={{ ...choice(on), minHeight: 52, padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', opacity: st ? .7 : 1 }}>
              <b className="grow">Share {i + 1}</b>{tag(st)}<b>{idr(on ? amount : a)}</b></button>; })}</div>
          {locked && <span style={{ fontSize: 13, color: MUTED }}>Split {n} ways · fixed once the first share is paying</span>}
        </div> : <div style={card} className="stack sm"><b>Tick what you had</b>
          {o.lines.map((l, i) => { const st = stateOf(l.id), on = sel.includes(l.id) && !st;
            return <label key={l.id} className="row" style={{ ...choice(on), minHeight: 52, padding: '8px 12px', gap: 10, cursor: st ? 'default' : 'pointer', opacity: st ? .7 : 1 }}>
              <input type="checkbox" checked={on} disabled={!!st} onChange={e => setSel(s => e.target.checked ? [...s, l.id] : s.filter(x => x !== l.id))} style={{ width: 22, height: 22, accentColor: 'var(--bn-p)' }} />
              <span className="grow">{l.qty}× {l.name}</span>{tag(st)}<span style={{ fontSize: 14 }}>{idr(amounts[i])}</span></label>; })}
          <span style={{ fontSize: 13, color: MUTED }}>Each item’s price includes its part of service, PB1 and discounts.</span></div>}
        {v.tip && amount > 0 && <div style={card} className="stack"><b>{g.t('Tip for the team')}</b>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8 }}>{[0, 5, 10, 15].map(p => <button key={p} aria-pressed={tipPct === p} onClick={() => setTip(p)} style={{ ...choice(tipPct === p), height: 48, fontWeight: 700 }}>{p ? p + '%' : g.t('None')}</button>)}</div></div>}
        {err && <div role="alert" className="banner" style={{ background: 'var(--danger-soft)', color: 'var(--danger-fg)' }}><Icon name="circle-alert" />{err}</div>}
      </>}
    </div>
    {myPay?.status !== 'pending' && <div style={{ position: 'fixed', left: '50%', transform: 'translateX(-50%)', bottom: 0, width: 'min(520px,100vw)', padding: '12px 14px calc(14px + env(safe-area-inset-bottom))', background: 'var(--bn-paper)', borderTop: `1px solid ${LINE}`, zIndex: 20 }}>
      <button className="btn btn-primary btn-block" style={{ height: 58, fontSize: 16, borderRadius: 16 }} disabled={!amount || !g.online} onClick={pay}>{!g.online ? 'QRIS needs internet' : amount ? `Pay my share · ${idr(amount + tip)}` : mode === 'items' ? 'Tick your items' : 'Every share is taken'}</button>
    </div>}
  </div>;
}

// ── Gift cards ─────────────────────────────────────────────────────────────────────────
export function GiftFace({ g, amount, to }: { g: G; amount: number; to?: string }) {
  const v = giftCardOf(g.db), accent = v.style === 'accent', photo = v.style === 'photo' && v.img;
  return <div role="img" aria-label={`${v.title} gift card, ${idr(amount)}`} style={{ aspectRatio: '1.6/1', borderRadius: 22, padding: 18, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', color: accent ? 'var(--bn-ink)' : 'var(--ink-0)',
    background: photo ? `linear-gradient(180deg,transparent,color-mix(in srgb,var(--ink-950) 60%,transparent)),url(${v.img}) center/cover` : accent ? 'var(--bn-acc)' : 'linear-gradient(135deg,var(--bn-p),var(--bn-ink))' }}>
    <div className="row between"><b style={{ fontFamily: 'var(--bn-font)' }}>{g.db.tenant.name}</b><Icon name="gift" /></div>
    <div className="stack" style={{ gap: 2 }}><span style={{ fontFamily: 'var(--bn-font)', fontSize: 22, fontWeight: 800 }}>{v.title}</span><b style={{ fontFamily: 'var(--bn-font)', fontSize: 30, lineHeight: 1 }}>{idr(amount)}</b>{to && <span style={{ fontSize: 13, opacity: .9 }}>For {to}</span>}</div>
  </div>;
}
export function GiftCards({ g }: { g: G }) {
  const { db, me } = g;
  const v = giftCardOf(db);
  const [amt, setAmt] = useState(v.amounts[0] ?? 0), [name, setName] = useState(''), [phone, setPhone] = useState(''), [msg, setMsg] = useState(String(v.msg)), [err, setErr] = useState('');
  const [mine, setMine] = useLocal<string | null>('bn-gift-pay', null);
  const p = db.payments.find(x => x.id === mine) ?? null, gift = p ? (db.records.gift_cards ?? []).find(r => r.a === p.orderId) : undefined, friend = gift && db.customers.find(c => c.id === gift.b);
  const amount = v.amounts.includes(amt) ? amt : v.amounts[0] ?? 0;
  const buy = () => { setErr(''); try { setMine(buyGiftCard(g.outletId, amount, { name: name.trim() || 'Friend', phone }, msg).paymentId); } catch (e) { setErr((e as Error).message); } };
  const top = <Bar title="Gift cards" onBack={() => back(g.go, so('member-card-and-points'))} />;
  if (p && gift && p.status === 'pending') return <>{top}<div className="stack" style={{ padding: 14, gap: 14 }}><GiftFace g={g} amount={Number(gift.c)} to={friend?.name} />
    <PayHere p={p} note={`Gift card for ${friend?.name ?? 'your friend'}`} onCancel={() => { cancelGiftCard(p.orderId); setMine(null); }} /></div></>;
  if (p && gift && gift.e === 'issued') return <>{top}<div className="stack" style={{ padding: 14, gap: 14 }}><GiftFace g={g} amount={Number(gift.c)} to={friend?.name} />
    <div style={{ ...card, textAlign: 'center' }} className="stack sm"><b style={{ fontSize: 18 }}>Sent to {firstName(friend?.name) || 'your friend'}</b><span style={{ fontSize: 14, color: MUTED }}>{idr(Number(gift.c))} is on their {db.tenant.name} balance. They pay with it at the counter: “pay with gift card”. A WhatsApp with your message is on its way.</span></div>
    <button className="btn" style={{ height: 52, borderRadius: 16 }} onClick={() => setMine(null)}><Icon name="gift" />Send another</button></div></>;
  if (!v.amounts.length) return <>{top}<Empty icon="gift" title="No gift cards right now">Ask at the counter.</Empty></>;
  return <div style={{ paddingBottom: 110 }}>{top}
    <div className="stack" style={{ padding: 14, gap: 14 }}>
      <GiftFace g={g} amount={amount} to={name.trim() || undefined} />
      <div role="radiogroup" aria-label="Amount" style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(3, v.amounts.length)},1fr)`, gap: 8 }}>{v.amounts.map(a => <button key={a} role="radio" aria-checked={a === amount} onClick={() => setAmt(a)} style={{ ...choice(a === amount), height: 52, fontWeight: 800 }}>{idr(a)}</button>)}</div>
      <div style={card} className="stack"><b>Who is it for?</b>
        <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="Their first name" aria-label="Their first name" autoComplete="off" />
        <input className="input" value={phone} onChange={e => setPhone(e.target.value)} placeholder="Their WhatsApp number" aria-label="Their WhatsApp number" inputMode="tel" autoComplete="off" />
        <textarea className="input" rows={3} value={msg} onChange={e => setMsg(e.target.value)} aria-label="Message" style={{ minHeight: 80 }} />
        <span style={{ fontSize: 13, color: MUTED }}>The balance goes on their {db.tenant.name} member account{me ? `, from ${firstName(me.name)}` : ''}. No expiry, any outlet.</span></div>
      {err && <div role="alert" className="banner" style={{ background: 'var(--danger-soft)', color: 'var(--danger-fg)' }}><Icon name="circle-alert" />{err}</div>}
    </div>
    <div style={{ position: 'fixed', left: '50%', transform: 'translateX(-50%)', bottom: 0, width: 'min(520px,100vw)', padding: '12px 14px calc(14px + env(safe-area-inset-bottom))', background: 'var(--bn-paper)', borderTop: `1px solid ${LINE}`, zIndex: 20 }}>
      <button className="btn btn-primary btn-block" style={{ height: 58, fontSize: 16, borderRadius: 16 }} disabled={!g.online || !payOn(db, 'qris') || phone.replace(/\D/g, '').length < 9} onClick={buy}>{!g.online ? 'QRIS needs internet' : !payOn(db, 'qris') ? 'Buy gift cards at the counter' : `Pay ${idr(amount)} with QRIS`}</button>
    </div>
  </div>;
}

// ── Referral card (member card) ────────────────────────────────────────────────────────
export function ReferralCard({ g, c }: { g: G; c: Customer }) {
  const r = referralOffer(g.db);
  if (!r.on) return null;
  const code = referralCode(g.db, c), url = linkTo('/order?ref=' + code), text = `${g.db.tenant.name}: ${r.give} with my code ${code} ${url}`;
  const friends = (g.db.records.referrals ?? []).filter(x => x.b === c.id), paid = friends.filter(x => x.e === 'rewarded').length;
  const copy = () => { navigator.clipboard?.writeText(url).then(() => toast('Invite link copied'), () => toast(url)); };
  return <div style={card} className="stack">
    <b style={{ fontSize: 18, fontFamily: 'var(--bn-font)' }}>Bring a friend</b>
    <span style={{ fontSize: 14 }}>Your friend gets <b>{r.give}</b>. You get <b>{r.get}</b> when they pay their first order.</span>
    <div style={{ padding: 12, borderRadius: 16, border: '2px dashed var(--bn-p)', textAlign: 'center' }}><span style={{ fontSize: 12, color: MUTED }}>Your code</span><br /><b className="mono" style={{ fontSize: 22 }}>{code}</b></div>
    <div className="row" style={{ gap: 10 }}>
      {r.share !== 'link' && <a className="btn btn-primary grow" style={{ height: 52, borderRadius: 16 }} href={'https://wa.me/?text=' + encodeURIComponent(text)} target="_blank" rel="noreferrer"><Icon name="message-circle" />Share on WhatsApp</a>}
      {r.share !== 'wa' && <button className={'btn grow' + (r.share === 'link' ? ' btn-primary' : '')} style={{ height: 52, borderRadius: 16 }} onClick={copy}><Icon name="link" />Copy link</button>}
    </div>
    {friends.length > 0 && <span style={{ fontSize: 13, color: MUTED }}>{friends.length} friend{friends.length > 1 ? 's' : ''} joined · {paid} rewarded</span>}
  </div>;
}

// ── Online store / link in bio (order.<root>/<tenant> without a table) ─────────────────
const waLink = (p: string) => 'https://wa.me/' + p.replace(/\D/g, '').replace(/^0/, '62');
export function Store({ g }: { g: G }) {
  const { db } = g;
  const v = studioValue(db, 'multi-page-online-store-link-in-bio'), d = menuDesign(db);
  const phone = db.outlets.find(o => o.id === g.outletId)?.phone || db.tenant.profile?.phone || '';
  const btn = { height: 56, borderRadius: 16, fontSize: 16, width: '100%' } as const;
  const rows: [boolean, string, string, ReactNode][] = [
    [!!v.order, 'utensils', so('menu-home'), 'Order online'], [!!v.book, 'calendar-check', so('online-booking'), 'Book a table'],
    [!!v.gift, 'gift', so('member-card-and-points', { v: 'gift' }), 'Gift cards'], [true, 'file-text', so('category-full-menu', { print: '1' }), 'Menu (PDF)']];
  const url = linkTo('/order', String(v.store) || undefined); // the store address the owner picked: order.<root>/<store>
  return <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
    <div style={{ height: 150, background: 'var(--bn-banner)', flex: 'none' }} />
    <div className="stack" style={{ padding: '0 18px calc(28px + env(safe-area-inset-bottom))', gap: 12, alignItems: 'center', textAlign: 'center', marginTop: -52 }}>
      {d.media.logo ? <span role="img" aria-label={db.tenant.name} style={{ width: 104, height: 104, borderRadius: 99, background: `var(--ink-0) url(${d.media.logo}) center/70% no-repeat`, boxShadow: '0 0 0 4px var(--bn-paper)' }} />
        : <span style={{ borderRadius: 99, boxShadow: '0 0 0 4px var(--bn-paper)' }}><Wordmark name={db.tenant.name} size={104} radius={99} /></span>}
      <div className="stack" style={{ gap: 4 }}><h1 style={{ fontSize: 28, fontWeight: 800 }}>{db.tenant.name}</h1>{v.handle && <span className="mono" style={{ fontSize: 13, color: MUTED }}>{String(v.handle)}</span>}<span style={{ fontSize: 15, color: MUTED }}>{d.tagline}</span></div>
      <span className="badge" style={{ background: g.hrs.open && !g.hrs.paused ? 'var(--success-soft)' : 'var(--bg-sunken)', color: g.hrs.open && !g.hrs.paused ? 'var(--success-fg)' : MUTED }}><i className="dot" />{g.out.name} · {g.hrs.paused ? 'Ordering paused' : g.hrs.text}</span>
      <nav className="stack" style={{ width: '100%', gap: 10, marginTop: 6 }} aria-label="Store links">
        {rows.filter(([on]) => on).map(([, ic, to, l], i) => <a key={to} className={'btn' + (i === 0 ? ' btn-primary' : '')} style={btn} {...link(g, to)}><Icon name={ic} />{l}</a>)}
        {v.wa && phone && <a className="btn" style={btn} href={waLink(phone)} target="_blank" rel="noreferrer"><Icon name="message-circle" />Chat on WhatsApp</a>}
        {v.maps && db.outlets.map(o => <a key={o.id} className="btn" style={{ ...btn, justifyContent: 'flex-start', padding: '0 16px' }} target="_blank" rel="noreferrer"
          href={'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent([db.tenant.name, o.name, o.address, o.city].filter(Boolean).join(' '))}>
          <Icon name="map-pin" /><span className="grow" style={{ textAlign: 'left' }}>{o.name}</span><span style={{ fontSize: 13, color: MUTED }}>{o.opens}–{o.closes}</span></a>)}
      </nav>
      <button className="btn btn-ghost btn-sm" onClick={() => navigator.clipboard?.writeText(url).then(() => toast('Store link copied'), () => toast(url))}><Icon name="copy" size={14} /><span className="mono" style={{ fontSize: 12 }}>{url.replace(/^https?:\/\//, '')}</span></button>
    </div>
  </div>;
}

// ── Printable menu (live products and prices, the published paper layout) ──────────────
const PAPER = { a4: ['210mm 297mm', 595], a5: ['148mm 210mm', 420], letter: ['8.5in 11in', 612] } as const;
export function PrintMenu({ g }: { g: G }) {
  const { db } = g;
  const v = studioValue(db, 'printable-menu-pdf-generator'), [size, w] = PAPER[v.size as keyof typeof PAPER] ?? PAPER.a4;
  const { items, cats } = useMenu(db, g.outletId), d = menuDesign(db);
  return <div style={{ paddingBottom: 32 }}>
    <style>{`@page{size:${size};margin:12mm}@media print{body *{visibility:hidden!important}.bn-print,.bn-print *{visibility:visible!important}.bn-print{position:absolute;inset:0 auto auto 0;width:100%!important;box-shadow:none!important;margin:0!important;padding:0!important}}`}</style>
    <Bar title="Menu (PDF)" onBack={() => back(g.go, so('menu-home'))} right={<button className="btn btn-primary btn-sm" onClick={() => window.print()}><Icon name="printer" size={16} />Print or save PDF</button>} />
    <div style={{ padding: 14, overflowX: 'auto' }}>
      <article className="bn-print" style={{ width: w, maxWidth: '100%', margin: '0 auto', padding: 'clamp(18px, 6%, 40px)', background: 'var(--ink-0)', color: 'var(--ink-950)', boxShadow: `0 0 0 1px ${LINE}`, display: 'flex', flexDirection: 'column', gap: 18 }}>
        <header style={{ textAlign: 'center' }}><h1 style={{ fontFamily: 'var(--bn-font)', fontSize: 30, fontWeight: 800 }}>{db.tenant.name}</h1><span style={{ fontSize: 12 }}>{d.tagline} · {g.out.name} · {g.out.opens}–{g.out.closes}</span></header>
        <div style={{ columns: Number(v.cols) || 1, columnGap: 28 }}>{cats.map(c => <section key={c.id} style={{ breakInside: 'avoid', marginBottom: 16 }}>
          <h2 style={{ fontFamily: 'var(--bn-font)', fontSize: 16, fontWeight: 800, color: 'var(--bn-p)', marginBottom: 4 }}>{c.name}</h2>
          {items.filter(i => i.cat === c.id).map(i => <div key={i.p.id} style={{ marginTop: 6, fontSize: 12 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}><b style={{ minWidth: 0 }}>{i.p.name}</b><span aria-hidden style={{ flex: 1, minWidth: 8, borderBottom: '1px dotted', transform: 'translateY(-3px)' }} />{v.prices && <b style={{ whiteSpace: 'nowrap' }}>{idr(i.price)}</b>}</div>
            {v.desc && i.p.desc && <span style={{ fontSize: 11, opacity: .75 }}>{i.p.desc}</span>}</div>)}</section>)}</div>
        <footer style={{ fontSize: 10, textAlign: 'center' }}>{String(v.footer)}<br /><span className="mono">{linkTo('/order').replace(/^https?:\/\//, '')}</span></footer>
      </article>
    </div>
  </div>;
}
