'use client';
// Customer links (receipt, member card, voucher, feedback, booking, queue, message previews, preferences). Each one is a
// page a guest opens from WhatsApp, email or the QR menu; ?o= (order) and ?c= (customer) pick the record, otherwise the
// remembered member or the most recent matching record at the outlet is shown.
import { feedbackBeans, giftCardOf, referralOffer, studioValue } from '../../system/studio.ts';
import { ReferralCard } from './more.tsx';
import { useState, type ReactNode } from 'react';
import { Icon, Empty, Toggle, ago, dateShort, hhmm, toast } from '../../ui/kit.tsx';
import { idr } from '../../domain/money.ts';
import { balance, tierOf, TIERS } from '../../domain/loyalty.ts';
import { usable } from '../../domain/promo.ts';
import { pickupLanes } from '../../domain/order.ts';
import { applyVoucher, rateOrder } from '../../data/actions.ts';
import { bookTable, claimVoucher, digits, findCustomer, findOrJoin, setOptIn } from '../../data/actions/selforder.ts';
import type { Customer, Order } from '../../data/schema.ts';
import { firstName, LINE, maskPhone, modsText, MUTED, progress, QR, SURFACE, TINT, Wordmark } from '../guest/kit.tsx';
import { Bar, so, tableNo, Totals, type G } from './shared.tsx';

const card = { padding: 16, borderRadius: 18, background: SURFACE } as const;
const METHOD: Record<string, string> = { cash: 'Cash', qris: 'QRIS', card: 'Card', ewallet: 'E-wallet', va: 'Virtual account', deposit: 'Deposit', kasbon: 'Tab' };
const Page = ({ title, g, children, onBack }: { title: string; g: G; children: ReactNode; onBack?: () => void }) =>
  <div style={{ paddingBottom: 40 }}><Bar title={title} onBack={onBack ?? (() => g.go(so('menu-home')))} /><div className="stack" style={{ padding: 14, gap: 14 }}>{children}</div></div>;

/** Customer for a link: ?c=, the remembered member, or (for message previews) a fallback. */
function useCustomer(g: G, fallback?: () => Customer | undefined) {
  const id = g.sp.get('c');
  return (id && g.db.customers.find(c => c.id === id)) || g.me || fallback?.() || null;
}
/** Order for a link: ?o=, this table's latest, the member's latest paid, else the outlet's latest paid. */
function useOrder(g: G, c?: Customer | null): Order | null {
  const id = g.sp.get('o');
  if (id) return g.db.orders.find(o => o.id === id) ?? null;
  const paid = g.db.orders.filter(o => o.outletId === g.outletId && o.paidAt).sort((a, b) => b.paidAt! - a.paidAt!);
  return g.latest ?? (c && paid.find(o => o.customerId === c.id)) ?? paid[0] ?? null;
}

/** Phone lookup / join, used where a link needs to know the member. */
function FindMember({ g, intro }: { g: G; intro: string }) {
  const [phone, setPhone] = useState(''), [name, setName] = useState(''), [ask, setAsk] = useState(false), [err, setErr] = useState(''), [code, setCode] = useState(g.ref ?? '');
  const ro = referralOffer(g.db);
  const go = () => {
    setErr('');
    if (digits(phone).length < 9) return setErr('Enter your WhatsApp number.');
    const c = findCustomer(g.db, phone);
    if (c) { g.setMe(c.id); toast(`Welcome back, ${firstName(c.name)}`); return; }
    if (!ask) return setAsk(true);
    const r = findOrJoin(name, phone, true, code.trim() || g.ref); g.setMe(r.id); toast('Welcome! 50 beans added');
  };
  return <div style={card} className="stack">
    <span style={{ fontSize: 15 }}>{intro}</span>
    <input className="input" inputMode="tel" autoComplete="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="WhatsApp number, e.g. 0812 3456 7890" aria-label="WhatsApp number" />
    {ask && <input className="input" autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="Your first name" aria-label="First name" />}
    {ask && ro.on && <input className="input mono" value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder={`Friend’s code, e.g. ${String(ro.prefix).toUpperCase()}-C1 (optional)`} aria-label="Friend’s code" />}
    {ask && <span style={{ fontSize: 13, color: MUTED }}>New number. Join {g.db.tenant.name} Rewards to get 50 welcome beans{ro.on ? `; with a friend’s code you get ${ro.give} too` : ''}.</span>}
    {err && <span role="alert" style={{ fontSize: 13, color: 'var(--danger-fg)' }}>{err}</span>}
    <button className="btn btn-primary" style={{ height: 52, borderRadius: 16 }} onClick={go}>{ask ? 'Join and continue' : 'Continue'}</button>
  </div>;
}

// ── Digital receipt ────────────────────────────────────────────────────────────────────
export function Receipt({ g }: { g: G }) {
  const { db } = g;
  const c = useCustomer(g), o = useOrder(g, c);
  if (!o) return <Page title="Receipt" g={g}><Empty icon="receipt" title="No receipt yet">Receipts show here after you pay.</Empty></Page>;
  const out = db.outlets.find(x => x.id === o.outletId)!, cust = db.customers.find(x => x.id === o.customerId);
  const pays = db.payments.filter(p => p.orderId === o.id && p.status === 'settled');
  const pts = db.ledger.filter(r => r.orderId === o.id).reduce((a, r) => a + r.points, 0);
  return <Page title="Receipt" g={g}>
    <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
      <div style={{ background: 'var(--bn-banner)', color: 'var(--ink-0)', padding: 18 }} className="row"><Wordmark name={db.tenant.name} size={44} />
        <span className="stack grow" style={{ gap: 2 }}><b style={{ fontFamily: 'var(--bn-font)', fontSize: 18 }}>{db.tenant.name} {out.name}</b><span style={{ fontSize: 13, opacity: .9 }}>{out.city}</span></span></div>
      <div className="stack sm" style={{ padding: 16 }}>
        <div className="row between" style={{ fontSize: 13, color: MUTED }}><span className="mono">{o.no}{o.table ? ' · ' + o.table : ''}</span><span>{dateShort(o.paidAt ?? o.createdAt)} · {hhmm(o.paidAt ?? o.createdAt)}</span></div>
        {o.lines.map(l => <div key={l.id} className="row between" style={{ fontSize: 14, alignItems: 'flex-start' }}><span className="grow">{l.qty}× {l.name}{(l.mods.length > 0 || l.note) && <span style={{ display: 'block', fontSize: 12, color: MUTED }}>{modsText(l.mods, l.note)}</span>}</span>
          <span>{idr(((l.flashPrice ?? l.unitPrice) + l.mods.reduce((a, m) => a + m.price, 0)) * l.qty)}</span></div>)}
      </div>
    </div>
    <Totals db={db} o={o} tip={pays.reduce((a, p) => a + p.tip, 0)} />
    <div style={card} className="stack sm">
      <div className="row between"><b>{o.paidAt ? 'Paid' : 'Not paid yet'}</b><span className={'badge ' + (o.paidAt ? 'b-success' : 'b-warning')}>{o.paidAt ? 'Paid' : 'Open'}</span></div>
      {pays.map(p => <div key={p.id} className="row between" style={{ fontSize: 14 }}><span>{METHOD[p.method]} <span className="mono faint">{p.ref}</span></span><span>{idr(p.amount + p.tip)}</span></div>)}
      {cust && <span style={{ fontSize: 14, color: MUTED }}>{firstName(cust.name)} · {pts > 0 ? `+${pts} beans earned` : 'beans post when paid'} · balance {balance(db.ledger, cust.id).toLocaleString('en-US')}</span>}
    </div>
    <span style={{ fontSize: 12, color: MUTED, textAlign: 'center' }}>Prices include PB1 as shown. Questions about this receipt? Reply to the WhatsApp message.</span>
    {o.paidAt && <button className="btn" style={{ height: 52, borderRadius: 16 }} onClick={() => g.go(so('feedback-and-rating', { o: o.id }))}><Icon name="star" />{o.rating ? `You rated ${o.rating} of 5` : 'Rate your visit'}</button>}
  </Page>;
}

// ── Member card & points ───────────────────────────────────────────────────────────────
export function MemberCard({ g }: { g: G }) {
  const { db } = g;
  const c = useCustomer(g);
  if (!c) return <Page title={`${db.tenant.name} Rewards`} g={g}>
    <div style={{ ...card, background: 'var(--bn-p)', color: 'var(--ink-0)' }} className="stack sm"><b style={{ fontFamily: 'var(--bn-font)', fontSize: 22 }}>{db.tenant.name} Rewards</b>
      {TIERS.map(t => <span key={t.id} style={{ fontSize: 14 }}><b>{t.name}</b> · {t.min ? `${t.min.toLocaleString('en-US')} beans a year` : 'from your first order'} · earns {t.multiplier}×</span>)}</div>
    <FindMember g={g} intro="Enter your WhatsApp number to open your card." /></Page>;
  const bal = balance(db.ledger, c.id), tier = tierOf(db.ledger, c.id), next = TIERS[TIERS.findIndex(t => t.id === tier.id) + 1];
  const year = db.ledger.filter(r => r.customerId === c.id && r.points > 0 && Date.now() - r.at < 365 * 864e5).reduce((a, r) => a + r.points, 0);
  const rows = db.ledger.filter(r => r.customerId === c.id).sort((a, b) => b.at - a.at).slice(0, 12);
  const claims = (db.records.voucher_claims ?? []).filter(r => r.b === c.id).map(r => db.promos.find(p => p.id === r.a)).filter(Boolean);
  return <Page title="Member card" g={g}>
    <div style={{ borderRadius: 24, padding: 20, background: 'linear-gradient(135deg,var(--bn-p),var(--bn-ink))', color: 'var(--ink-0)', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="row between"><b style={{ fontFamily: 'var(--bn-font)', fontSize: 18 }}>{db.tenant.name} Rewards</b><span className="badge" style={{ background: 'var(--bn-acc)', color: 'var(--bn-ink)' }}>{tier.name}</span></div>
      <div className="row between" style={{ alignItems: 'flex-end' }}>
        <span className="stack" style={{ gap: 2 }}><span style={{ fontSize: 13, opacity: .85 }}>{c.name}</span><b style={{ fontFamily: 'var(--bn-font)', fontSize: 40, lineHeight: 1 }}>{bal.toLocaleString('en-US')}</b><span style={{ fontSize: 13, opacity: .85 }}>beans</span></span>
        <span style={{ width: 92, padding: 6, borderRadius: 12, background: 'var(--ink-0)' }}><QR value={'member:' + c.id} label="Member QR, show at the cashier" /></span>
      </div>
      {next ? <div className="stack" style={{ gap: 6 }}><span style={{ height: 6, borderRadius: 9, background: 'color-mix(in srgb,var(--ink-0) 25%,transparent)', overflow: 'hidden' }}><span style={{ display: 'block', width: Math.min(100, year / next.min * 100) + '%', height: '100%', background: 'var(--bn-acc)' }} /></span>
        <span style={{ fontSize: 13 }}>{(next.min - year).toLocaleString('en-US')} more to {next.name} · earning {tier.multiplier}×</span></div> : <span style={{ fontSize: 13 }}>Top tier · earning {tier.multiplier}×</span>}
    </div>
    <span style={{ fontSize: 13, color: MUTED, textAlign: 'center' }}>Show the QR at the cashier or kiosk to earn and redeem · member since {dateShort(c.joinedAt)}</span>
    {(c.deposit > 0 || giftCardOf(db).amounts.length > 0) && <div style={card} className="row between">
      <span className="stack" style={{ gap: 2 }}><span style={{ fontSize: 13, color: MUTED }}>Gift card balance</span><b style={{ fontSize: 17 }}>{idr(c.deposit)}</b></span>
      <button className="btn" onClick={() => g.go(so('member-card-and-points', { v: 'gift' }))}><Icon name="gift" />Send a gift card</button></div>}
    <ReferralCard g={g} c={c} />
    {claims.length > 0 && <div style={card} className="stack sm"><b>Saved vouchers</b>{claims.map(p => <div key={p!.id} className="row between" style={{ fontSize: 14 }}><span>{p!.name}</span><span className="mono">{p!.code}</span></div>)}</div>}
    <div style={card} className="stack sm"><b>Bean history</b>
      {rows.map((r, i) => <div key={i} className="row between" style={{ fontSize: 14 }}><span className="grow">{r.reason}<span style={{ display: 'block', fontSize: 12, color: MUTED }}>{dateShort(r.at)}</span></span><b style={{ color: r.points < 0 ? 'var(--danger-fg)' : 'var(--success-fg)' }}>{r.points > 0 ? '+' : ''}{r.points}</b></div>)}
    </div>
    <div className="row" style={{ gap: 10 }}>
      <button className="btn grow" onClick={() => g.go(so('claim-voucher'))}><Icon name="ticket-percent" />Vouchers</button>
      <button className="btn grow" onClick={() => g.go(so('unsubscribe-message-preferences'))}><Icon name="bell" />Messages</button>
    </div>
    {g.me?.id === c.id && <button className="btn btn-ghost" onClick={() => g.setMe(null)}>Not {firstName(c.name)}? Use another number</button>}
  </Page>;
}

// ── Claim voucher ──────────────────────────────────────────────────────────────────────
export function Voucher({ g }: { g: G }) {
  const { db, cart } = g;
  const c = useCustomer(g);
  const [code, setCode] = useState(''), [err, setErr] = useState('');
  const list = db.promos.filter(p => p.kind !== 'flash' && p.code);
  const claimed = (id: string) => !!c && (db.records.voucher_claims ?? []).some(r => r.a === id && r.b === c.id);
  const use = (cd: string) => { if (!cart) { g.go(so('menu-home')); toast('Voucher ready: add items, then apply it at checkout'); return; } const e = applyVoucher(cart.id, cd, 'guest'); if (e) setErr(e); else { setErr(''); toast('Voucher applied to your order'); } };
  const enter = () => { const p = db.promos.find(x => x.code?.toUpperCase() === code.trim().toUpperCase()); if (!p) return setErr('Voucher not found'); setErr(''); if (c) claimVoucher(c.id, p.id); use(p.code!); };
  return <Page title="Vouchers" g={g}>
    <div style={card} className="stack sm"><b>Have a code?</b>
      <div className="row"><input className="input grow" value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="Voucher code" aria-label="Voucher code" /><button className="btn btn-primary" style={{ height: 48 }} disabled={!code.trim()} onClick={enter}>Claim</button></div>
      {err && <span role="alert" style={{ fontSize: 13, color: 'var(--danger-fg)' }}>{err}</span>}</div>
    {list.map(p => { const ok = usable(p), left = p.quota != null ? p.quota - (p.used ?? 0) : null, vv = studioValue(db, 'voucher-and-promo-visuals'), filled = vv.fill !== 'outline';
      return <div key={p.id} style={{ ...card, display: 'flex', gap: 14, opacity: ok ? 1 : .55, borderRadius: vv.shape === 'pill' ? 999 : undefined, border: vv.shape === 'ticket' ? '2px dashed var(--bn-p)' : undefined, background: filled ? (vv.fill === 'brand' ? 'var(--bn-soft)' : 'color-mix(in srgb,var(--bn-acc) 18%,var(--bn-paper))') : card.background }}>
      <span className="stack grow" style={{ gap: 4 }}><b style={{ fontSize: 16 }}>{p.name}</b>
        <span style={{ fontSize: 13, color: MUTED }}>{[p.minSpend ? `Min. spend ${idr(p.minSpend)}` : 'No minimum', vv.expiry && left != null ? `${left.toLocaleString('en-US')} left` : '', p.endsAt ? 'until ' + dateShort(p.endsAt) : ''].filter(Boolean).join(' · ')}</span>
        {vv.code && <span className="mono" style={{ fontSize: 14, fontWeight: 700 }}>{p.code}</span>}</span>
      <span className="stack" style={{ gap: 6, justifyContent: 'center' }}>
        {!ok ? <span className="badge b-danger">{left === 0 ? 'Used up' : 'Expired'}</span> : <>
          <button className="btn btn-primary btn-sm" onClick={() => use(p.code!)}>Use now</button>
          {c ? <button className="btn btn-sm" disabled={claimed(p.id)} onClick={() => { claimVoucher(c.id, p.id); toast('Saved to your card'); }}>{claimed(p.id) ? 'Saved' : 'Save'}</button>
            : <button className="btn btn-sm" onClick={() => g.go(so('member-card-and-points'))}>Save</button>}</>}
      </span></div>; })}
    {!list.length && <Empty icon="ticket" title="No vouchers right now">New vouchers arrive on WhatsApp for members.</Empty>}
  </Page>;
}

// ── Feedback & rating ──────────────────────────────────────────────────────────────────
export function Feedback({ g }: { g: G }) {
  const { db } = g;
  const fb = studioValue(db, 'feedback-and-rating-page'), TAGS = String(fb.tags).split(',').map(x => x.trim()).filter(Boolean), beans = feedbackBeans(db);
  const c = useCustomer(g), o = useOrder(g, c);
  const [stars, setStars] = useState(0), [tags, setTags] = useState<string[]>([]), [text, setText] = useState(''), [done, setDone] = useState(false);
  if (!o) return <Page title="Rate your visit" g={g}><Empty icon="star" title="Nothing to rate yet">After your order you can rate it here.</Empty></Page>;
  const review = db.reviews.find(r => r.orderId === o.id);
  if (review || done) {
    const s = review?.stars ?? stars;
    return <Page title="Rate your visit" g={g}><div style={{ ...card, textAlign: 'center' }} className="stack">
      <div className="row" style={{ justifyContent: 'center', gap: 4 }}>{[1, 2, 3, 4, 5].map(n => <Icon key={n} name="star" size={28} fill={n <= s ? 'var(--bn-acc)' : 'none'} />)}</div>
      <b style={{ fontSize: 20 }}>Thank you{c ? ', ' + firstName(c.name) : ''}!</b>
      {beans > 0 && c && <span style={{ color: MUTED }}>{beans} beans added to your card</span>}
      <span style={{ color: MUTED }}>{s <= 2 ? 'Sorry we let you down. The outlet manager will contact you on WhatsApp today.' : 'The team reads every review. See you again soon.'}</span>
      {review?.text && <span style={{ fontStyle: 'italic' }}>“{review.text}”</span>}
      {review?.reply && <div className="sunken" style={{ textAlign: 'left' }}><b>{db.tenant.name} replied</b><br />{review.reply}</div>}
    </div></Page>;
  }
  const send = () => { rateOrder(o.id, stars, [tags.join(', '), text.trim()].filter(Boolean).join(' · ')); setDone(true); };
  return <Page title="Rate your visit" g={g}>
    <div style={card} className="stack">
      <span style={{ fontSize: 14, color: MUTED }}>{db.tenant.name} {db.outlets.find(x => x.id === o.outletId)?.name} · {o.no} · {dateShort(o.createdAt)}</span>
      <b style={{ fontSize: 20 }}>{fb.q}</b>
      {beans > 0 && c && <span style={{ fontSize: 14, color: MUTED }}>{fb.reward}</span>}
      <div className="row" role="radiogroup" aria-label="Stars" style={{ gap: 6, justifyContent: 'space-between' }}>{[1, 2, 3, 4, 5].map(n => <button key={n} role="radio" aria-checked={stars === n} aria-label={`${n} star${n > 1 ? 's' : ''}`} onClick={() => setStars(n)} style={{ flex: 1, height: 60, borderRadius: 14, border: `2px solid ${stars === n ? 'var(--bn-p)' : LINE}`, background: stars === n ? TINT : SURFACE, cursor: 'pointer', display: 'grid', placeItems: 'center' }}>
        <Icon name="star" size={28} fill={n <= stars ? 'var(--bn-acc)' : 'none'} /></button>)}</div>
      {stars > 0 && <><span style={{ fontSize: 14, fontWeight: 600 }}>{stars >= 4 ? 'What did you like?' : 'What could be better?'}</span>
        <div className="row wrap" style={{ gap: 6 }}>{TAGS.map(t => <button key={t} className="chip" aria-pressed={tags.includes(t)} onClick={() => setTags(tags.includes(t) ? tags.filter(x => x !== t) : [...tags, t])}>{t}</button>)}</div>
        <textarea className="input" rows={3} value={text} onChange={e => setText(e.target.value)} placeholder="Tell us more (optional)" aria-label="Comment" /></>}
    </div>
    <button className="btn btn-primary" style={{ height: 56, borderRadius: 16 }} disabled={!stars} onClick={send}>Send rating</button>
  </Page>;
}

// ── Online booking ─────────────────────────────────────────────────────────────────────
export function Booking({ g }: { g: G }) {
  const { db, out, me } = g;
  const [name, setName] = useState(me?.name ?? ''), [phone, setPhone] = useState(me?.phone ?? ''), [guests, setGuests] = useState(2), [day, setDay] = useState(0), [slot, setSlot] = useState(''), [note, setNote] = useState(''), [done, setDone] = useState<string | null>(null), [err, setErr] = useState('');
  const base = new Date(); base.setHours(0, 0, 0, 0);
  const bk = studioValue(db, 'reservation-booking-page'), step = Math.max(15, Number(bk.slot) || 30); // Menu Studio › reservation page
  const [oh] = out.opens.split(':').map(Number), [ch] = out.closes.split(':').map(Number);
  const slots = Array.from({ length: Math.max(0, Math.floor(((ch - oh - 1) * 60) / step)) }, (_, i) => { const m = oh * 60 + i * step; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; })
    .filter(s => { const [h, m] = s.split(':').map(Number); return base.getTime() + day * 864e5 + (h * 60 + m) * 60e3 > Date.now() + 30 * 60e3; });
  const r = done ? db.reservations.find(x => x.id === done) : null;
  if (r) return <Page title="Booking confirmed" g={g}><div style={{ ...card, textAlign: 'center' }} className="stack">
    <Icon name="calendar-check" size={36} style={{ alignSelf: 'center', color: 'var(--success)' }} />
    <b style={{ fontSize: 22 }}>See you, {firstName(r.name)}!</b>
    <span>{db.tenant.name} {out.name} · {new Date(r.at).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })} · {hhmm(r.at)}</span>
    <span style={{ color: MUTED }}>{r.guests} guests · table {tableNo(r.table)} · {String(bk.note)} Reminder on WhatsApp 3 hours before.</span>
    <span className={'badge ' + (r.status === 'booked' ? 'b-info' : r.status === 'seated' ? 'b-success' : 'b-danger')} style={{ alignSelf: 'center' }}>{r.status.replace('_', ' ')}</span>
  </div></Page>;
  const submit = () => {
    if (!name.trim() || digits(phone).length < 9) return setErr('Add your name and WhatsApp number.');
    if (!slot) return setErr('Pick a time.');
    const [h, m] = slot.split(':').map(Number);
    setDone(bookTable({ outletId: g.outletId, name: name.trim(), phone: phone.trim(), at: base.getTime() + day * 864e5 + (h * 60 + m) * 60e3, guests, note: note.trim() }));
  };
  return <Page title="Book a table" g={g}>
    <span style={{ color: MUTED }}>{db.tenant.name} {out.name} · open {out.opens}–{out.closes}</span>
    <div style={card} className="stack">
      <b>When</b>
      <div className="row" style={{ gap: 6, overflowX: 'auto', scrollbarWidth: 'none' }}>{Array.from({ length: 7 }, (_, i) => { const d = new Date(base.getTime() + i * 864e5); return <button key={i} className="chip" aria-pressed={day === i} onClick={() => { setDay(i); setSlot(''); }} style={{ height: 52, display: 'flex', flexDirection: 'column', justifyContent: 'center', lineHeight: 1.1 }}>
        <span>{i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : d.toLocaleDateString('en-GB', { weekday: 'short' })}</span><span style={{ fontSize: 11, fontWeight: 500 }}>{dateShort(d.getTime())}</span></button>; })}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(76px,1fr))', gap: 6 }}>{slots.map(s => <button key={s} className="chip" aria-pressed={slot === s} onClick={() => setSlot(s)} style={{ height: 44 }}>{s}</button>)}</div>
      {!slots.length && <span style={{ fontSize: 14, color: MUTED }}>No times left today. Try tomorrow.</span>}
      <div className="row between"><b>Guests</b><div className="row" style={{ gap: 4 }}>
        <button className="btn icon-btn" aria-label="Fewer guests" onClick={() => setGuests(Math.max(1, guests - 1))}><Icon name="minus" /></button><b style={{ minWidth: 28, textAlign: 'center' }}>{guests}</b>
        <button className="btn icon-btn" aria-label="More guests" onClick={() => setGuests(Math.min(Number(bk.maxGuests) || 30, guests + 1))}><Icon name="plus" /></button></div></div>
      {Number(bk.deposit) > 0 && guests >= Number(bk.depositFrom) && <span style={{ fontSize: 14, color: MUTED }}>Groups of {Number(bk.depositFrom)} or more confirm with a {idr(Number(bk.deposit))} deposit, taken off the bill.</span>}
    </div>
    <div style={card} className="stack">
      <b>Your details</b>
      <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="Name" aria-label="Name" autoComplete="name" />
      <input className="input" value={phone} onChange={e => setPhone(e.target.value)} placeholder="WhatsApp number" aria-label="WhatsApp number" inputMode="tel" autoComplete="tel" />
      <input className="input" value={note} onChange={e => setNote(e.target.value)} placeholder="Note: birthday, high chair… (optional)" aria-label="Note" />
    </div>
    {err && <div role="alert" className="banner" style={{ background: 'var(--danger-soft)', color: 'var(--danger-fg)' }}><Icon name="circle-alert" />{err}</div>}
    <button className="btn btn-primary" style={{ height: 56, borderRadius: 16 }} onClick={submit}>Book {slot ? `for ${slot}` : 'a table'}</button>
  </Page>;
}

// ── Queue status ───────────────────────────────────────────────────────────────────────
export function Queue({ g }: { g: G }) {
  const { db, outletId } = g;
  // History rows ("h…") are closed tickets from earlier days; the queue is today's live tickets only.
  const live = db.orders.filter(o => o.outletId === outletId && !o.id.startsWith('h') && o.lines.some(l => l.fired) && o.status !== 'served' && o.status !== 'voided' && Date.now() - o.createdAt < 3 * 3600e3).sort((a, b) => a.createdAt - b.createdAt);
  const { prep: cooking, ready } = pickupLanes(live, Date.now()); // the same lanes as the pickup board TV
  const mineNo = g.sp.get('n');
  const mine = (mineNo && live.find(o => o.no === mineNo)) || g.latest;
  const ahead = mine && progress(mine) < 3 ? cooking.findIndex(o => o.id === mine.id) : -1;
  const Nums = ({ list, tone }: { list: Order[]; tone: string }) => <div className="row wrap" style={{ gap: 8 }}>{list.map(o => <span key={o.id} className="mono" style={{ padding: '8px 12px', borderRadius: 12, fontSize: 16, fontWeight: 700, background: o.id === mine?.id ? 'var(--bn-p)' : tone, color: o.id === mine?.id ? 'var(--ink-0)' : 'var(--bn-ink)' }}>{o.no}</span>)}{!list.length && <span style={{ color: MUTED, fontSize: 14 }}>None right now</span>}</div>;
  return <Page title="Queue" g={g}>
    {mine ? <div style={{ ...card, background: progress(mine) === 3 ? 'var(--success)' : 'var(--bn-ink)', color: 'var(--ink-0)', textAlign: 'center' }} className="stack sm">
      <span>Your number</span><b style={{ fontFamily: 'var(--bn-font)', fontSize: 48, lineHeight: 1 }}>{mine.no}</b>
      <span aria-live="polite">{progress(mine) === 3 ? 'Ready! Pick it up at the counter.' : ahead > 0 ? `${ahead} order${ahead > 1 ? 's' : ''} ahead of you` : 'You’re next'}</span></div>
      : <div style={card}><span style={{ color: MUTED }}>Order from the QR menu or kiosk and your number shows here.</span></div>}
    <div style={card} className="stack sm"><b>Ready to pick up</b><Nums list={ready} tone="var(--success-soft)" /></div>
    <div style={card} className="stack sm"><b>Preparing</b><Nums list={cooking} tone="var(--bg-sunken)" /></div>
    <span style={{ fontSize: 12, color: MUTED, textAlign: 'center' }}>Updates live from the kitchen · {db.tenant.name} {g.out.name}</span>
  </Page>;
}

/** Delivery tracking: the link a delivery guest opens. Stages come from the kitchen and the hand-over; Menu Studio decides what shows. */
export function Track({ g }: { g: G }) {
  const { db } = g, v = studioValue(db, 'delivery-tracking-page') as { driver: boolean; map: boolean; eta: boolean; help: string };
  const id = g.sp.get('o');
  const o = id ? db.orders.find(x => x.id === id) : db.orders.filter(x => x.outletId === g.outletId && x.type === 'delivery' && !x.id.startsWith('h')).sort((a, b) => b.createdAt - a.createdAt)[0];
  if (!o) return <Page title="Delivery" g={g}><Empty icon="bike" title="No delivery to track">Open the link from your WhatsApp message to follow your order.</Empty></Page>;
  const fired = o.lines.filter(l => l.fired);
  const st = o.status === 'voided' ? -1 : o.paidAt && o.readyAt ? 2 : fired.length && fired.every(l => l.kds === 'done') ? 1 : 0;
  const steps = ['Order received', 'Prepared', 'Picked up by the rider', 'Delivered'];
  const tel = digits(g.out.phone ?? '');
  return <Page title={o.no} g={g}>
    {st < 0 ? <div style={card} role="alert"><b>This order was cancelled</b><p style={{ color: MUTED }}>{o.note}</p></div> : <>
      {v.map && <div aria-hidden style={{ ...card, height: 140, position: 'relative', background: 'repeating-linear-gradient(45deg,color-mix(in srgb,var(--bn-ink) 5%,transparent) 0 12px,transparent 12px 24px)' }}>
        <span style={{ position: 'absolute', top: 54, left: ['8%', '30%', '62%', '86%'][st], width: 32, height: 32, borderRadius: 99, background: 'var(--bn-p)', color: 'var(--ink-0)', display: 'grid', placeItems: 'center' }}><Icon name="bike" size={18} /></span></div>}
      <div style={card} className="stack sm">
        <b style={{ fontFamily: 'var(--bn-font)', fontSize: 22 }} aria-live="polite">{steps[st]}</b>
        {v.eta && o.readyBy && st < 3 && <span>Arrives around <b>{hhmm(o.readyBy + 15 * 60e3)}</b></span>}
        {steps.map((s, i) => <div key={s} className="row" style={{ gap: 10, opacity: i <= st ? 1 : .45 }}><Icon name={i <= st ? 'circle-check' : 'circle'} size={18} style={{ color: i <= st ? 'var(--success)' : MUTED }} /><span>{s}</span></div>)}
        {st === 2 && <span style={{ fontSize: 13, color: MUTED }}>{o.source} confirms when it arrives.</span>}
      </div>
      {v.driver && st >= 2 && <div style={card} className="row"><Icon name="user-round" /><span className="grow">Your rider from {o.source}</span></div>}
    </>}
    <div style={card} className="stack sm">{o.lines.map(l => <div key={l.id} className="row between"><span>{l.qty}× {l.name}</span><span>{idr(l.unitPrice * l.qty)}</span></div>)}<div className="row between"><b>Total</b><b>{idr(o.total)}</b></div></div>
    {v.help && (tel ? <a className="btn" href={`https://wa.me/${tel.replace(/^0/, '62')}`} target="_blank" rel="noreferrer" style={{ minHeight: 48 }}><Icon name="message-circle" size={18} />{v.help}</a> : <span style={{ textAlign: 'center', color: MUTED }}>{v.help}</span>)}
  </Page>;
}

// ── Message previews (what the guest receives) ─────────────────────────────────────────
function useThanks(g: G) {
  const { db } = g;
  const msg = db.messages.filter(m => m.template === 'thanks_visit' && m.customerId).sort((a, b) => b.at - a.at)[0];
  const c = useCustomer(g, () => db.customers.find(x => x.id === msg?.customerId) ?? db.customers[0]);
  const o = c ? db.orders.filter(x => x.customerId === c.id && x.paidAt).sort((a, b) => b.paidAt! - a.paidAt!)[0] : undefined;
  return { c, o, pts: o ? db.ledger.filter(r => r.orderId === o.id && r.points > 0).reduce((a, r) => a + r.points, 0) : 0, msg };
}
const linkBtn = (g: G, label: string, href: string) => <a key={label} href={href} onClick={e => { e.preventDefault(); g.go(href); }} style={{ display: 'block', textAlign: 'center', padding: '10px 0', borderTop: `1px solid ${LINE}`, fontWeight: 600 }}>{label}</a>;

export function WaThanks({ g }: { g: G }) {
  const { db, out } = g;
  const { c, o, pts, msg } = useThanks(g);
  if (!c) return <Page title="WhatsApp message" g={g}><Empty icon="message-circle" title="No members yet" /></Page>;
  const bal = balance(db.ledger, c.id), at = msg?.customerId === c.id ? msg.at : (o?.paidAt ?? Date.now()) + 3600e3;
  return <Page title="WhatsApp thank-you" g={g}>
    <span style={{ fontSize: 13, color: MUTED }}>Sent 60 minutes after a paid visit to members who opted in{c.optIn ? '' : ' · this member opted out, so it is not sent'}.</span>
    <div style={{ borderRadius: 22, overflow: 'hidden', boxShadow: `0 0 0 1px ${LINE}` }}>
      <div className="row" style={{ padding: '12px 14px', background: 'var(--bn-ink)', color: 'var(--ink-0)' }}><Wordmark name={db.tenant.name} size={36} radius={99} /><span className="stack grow" style={{ gap: 0 }}><b>{db.tenant.name}</b><span style={{ fontSize: 12, opacity: .8 }}>Business account</span></span><Icon name="badge-check" size={18} /></div>
      <div style={{ padding: 14, background: 'var(--bg-sunken)', minHeight: 260 }}>
        <div style={{ maxWidth: '86%', borderRadius: '4px 16px 16px 16px', background: SURFACE, overflow: 'hidden', boxShadow: '0 1px 1px color-mix(in srgb,var(--bn-ink) 15%,transparent)' }}>
          <div style={{ height: 90, background: 'var(--bn-banner)' }} />
          <div className="stack sm" style={{ padding: 12, fontSize: 15, lineHeight: 1.45 }}>
            <span>Hi {firstName(c.name)}, terima kasih sudah mampir ke {db.tenant.name} {out.name}!</span>
            {o && <span>{o.no} · {idr(o.total)}{pts ? ` · you earned +${pts} beans` : ''}. Balance: <b>{bal.toLocaleString('en-US')} beans</b> ({tierOf(db.ledger, c.id).name}).</span>}
            <span style={{ fontSize: 12, color: MUTED, textAlign: 'right' }}>{hhmm(at)}</span>
          </div>
          {o && linkBtn(g, 'View receipt', so('digital-receipt', { o: o.id }))}
          {o && linkBtn(g, 'Rate your visit', so('feedback-and-rating', { o: o.id }))}
          {linkBtn(g, 'Stop messages', so('unsubscribe-message-preferences', { c: c.id }))}
        </div>
      </div>
    </div>
    <span style={{ fontSize: 13, color: MUTED }}>To {maskPhone(c.phone)} · template thanks_visit{msg?.customerId === c.id ? ` · ${msg.status}` : ''}</span>
  </Page>;
}

export function EmailThanks({ g }: { g: G }) {
  const { db, out } = g;
  const { c, o, pts } = useThanks(g);
  if (!c) return <Page title="Thank-you email" g={g}><Empty icon="mail" title="No members yet" /></Page>;
  return <Page title="Thank-you email" g={g}>
    <div style={{ ...card, padding: 12, fontSize: 13 }} className="stack sm">
      <span><span className="faint">From</span> {db.tenant.name} {out.name}</span><span><span className="faint">To</span> {c.email || c.name}</span>
      <span><b>Thanks for visiting {db.tenant.name} {out.name}</b></span></div>
    <div style={{ borderRadius: 18, overflow: 'hidden', background: SURFACE, boxShadow: `0 0 0 1px ${LINE}` }}>
      <div style={{ background: 'var(--bn-banner)', color: 'var(--ink-0)', padding: '28px 20px' }} className="stack sm"><Wordmark name={db.tenant.name} size={44} /><h2 style={{ fontSize: 26, fontWeight: 800 }}>Terima kasih, {firstName(c.name)}!</h2></div>
      <div className="stack" style={{ padding: 20 }}>
        <span>We hope you enjoyed your visit{o ? ` on ${dateShort(o.paidAt!)}` : ''}. Here is a summary of your order.</span>
        {o && <div className="stack sm" style={{ padding: 14, borderRadius: 14, background: 'var(--bg-sunken)' }}>
          {o.lines.map(l => <div key={l.id} className="row between" style={{ fontSize: 14 }}><span>{l.qty}× {l.name}</span><span>{idr(((l.flashPrice ?? l.unitPrice) + l.mods.reduce((a, m) => a + m.price, 0)) * l.qty)}</span></div>)}
          <div className="row between" style={{ borderTop: `1px solid ${LINE}`, paddingTop: 8, fontWeight: 700 }}><span>Total</span><span>{idr(o.total)}</span></div></div>}
        <div className="row" style={{ gap: 12, padding: 14, borderRadius: 14, background: TINT }}><Icon name="star" style={{ color: 'var(--bn-p)' }} /><span>{pts ? <><b>+{pts} beans</b> earned · </> : ''}balance <b>{balance(db.ledger, c.id).toLocaleString('en-US')}</b> · {tierOf(db.ledger, c.id).name}</span></div>
        {o && <div className="row" style={{ gap: 10 }}>
          <button className="btn btn-primary grow" onClick={() => g.go(so('digital-receipt', { o: o.id }))}>View receipt</button>
          <button className="btn grow" onClick={() => g.go(so('feedback-and-rating', { o: o.id }))}>Rate your visit</button></div>}
        <span style={{ fontSize: 12, color: MUTED, borderTop: `1px solid ${LINE}`, paddingTop: 12 }}>{db.tenant.name} · {out.name}, {out.city}. You get this email because you are a {db.tenant.name} Rewards member.{' '}
          <a href={so('unsubscribe-message-preferences', { c: c.id })} onClick={e => { e.preventDefault(); g.go(so('unsubscribe-message-preferences', { c: c.id })); }}>Unsubscribe or change preferences</a></span>
      </div>
    </div>
  </Page>;
}

// ── Unsubscribe / message preferences ──────────────────────────────────────────────────
export function Prefs({ g }: { g: G }) {
  const { db } = g;
  const c = useCustomer(g);
  if (!c) return <Page title="Message preferences" g={g}><FindMember g={g} intro="Enter the WhatsApp number we message to change your preferences." /></Page>;
  const last = db.messages.filter(m => m.customerId === c.id).sort((a, b) => b.at - a.at).slice(0, 4);
  return <Page title="Message preferences" g={g}>
    <div style={card} className="stack sm"><b style={{ fontSize: 18 }}>{firstName(c.name)}, choose what we send you</b><span style={{ fontSize: 14, color: MUTED }}>{maskPhone(c.phone)}{c.email ? ' · ' + c.email : ''}</span></div>
    <div style={card} className="stack">
      <div className="row between" style={{ gap: 12 }}><span className="stack grow" style={{ gap: 2 }}><b>Offers, thank-you notes and rewards news</b><span style={{ fontSize: 13, color: MUTED }}>WhatsApp and email from {db.tenant.name}</span></span>
        <Toggle on={c.optIn} onChange={v => { setOptIn(c.id, v); toast(v ? 'You’re subscribed again' : 'Unsubscribed. No more offers.'); }} label="Offers and thank-you messages" /></div>
      <div className="row between" style={{ gap: 12, opacity: .7 }}><span className="stack grow" style={{ gap: 2 }}><b>Receipts and order updates</b><span style={{ fontSize: 13, color: MUTED }}>Only when you order or book. Always on.</span></span><Icon name="lock" size={18} /></div>
    </div>
    {c.optIn ? <button className="btn btn-danger" style={{ height: 52, borderRadius: 16 }} onClick={() => { setOptIn(c.id, false); toast('Unsubscribed. No more offers.'); }}>Unsubscribe from all offers</button>
      : <div role="status" className="banner" style={{ background: 'var(--success-soft)', color: 'var(--success-fg)' }}><Icon name="circle-check" /><span>You’re unsubscribed. Your beans and member card stay active.</span></div>}
    {last.length > 0 && <div style={card} className="stack sm"><span className="cap">Recent messages</span>{last.map(m => <div key={m.id} className="row between" style={{ fontSize: 14 }}><span>{m.template.replace(/_/g, ' ')} · {m.channel === 'wa' ? 'WhatsApp' : m.channel}</span><span style={{ color: MUTED }}>{ago(m.at)}</span></div>)}</div>}
  </Page>;
}
