'use client';
import { ReadScale } from '../../devices/ui.tsx';
import { thisDevice } from '../../devices/routing.ts';
import { printTickets } from '../../devices/hardware.ts';
import { productImage } from '../../ui/kit.tsx';
// Every sheet that edits the current order. One sheet at a time; approvals replace the sheet body in place.
import { useState, type ReactNode } from 'react';
import { addCustomer, addLine, applyVoucher, holdOrder, moveTable, patchOrder, priceAt, redeem, sendToKitchen } from '../../data/actions.ts';
import { addOpenLine, enqueue, freeOneUnit, logDevice, mergeBills, patchLine, splitToNewBill } from '../../data/actions/pos.ts';
import { flashPrice, usable } from '../../domain/promo.ts';
import { lineTotal } from '../../domain/order.ts';
import { balance, tierOf } from '../../domain/loyalty.ts';
import { idr } from '../../domain/money.ts';
import { areasOf, holdsTable, tablesOf } from '../../domain/tables.ts';
import { FloorGrid, tableShape } from '../../ui/Floor.tsx';
import { Badge, Empty, Field, Icon, Seg, Sheet, Status, Toggle, ago, hhmm, toast } from '../../ui/kit.tsx';
import type { Customer, OrderLine } from '../../data/schema.ts';
import { AmountPad, ONLINE_INBOX, P, Paper, REG, RIDE_INBOX, Stepper, TabLinks, isOpenBill, itemsOf, label, usePerm, usePos, useApproval, warnStyle } from './shared.tsx';

const lt = (l: OrderLine) => lineTotal({ unitPrice: l.unitPrice, flashPrice: l.flashPrice, modifiers: l.mods.map(m => m.price), qty: l.qty, discountPct: l.discountPct });
const TITLES: Record<string, [string, string?]> = {
  options: ['Options'], table: ['Choose table', 'Live status from every register and the waiter app.'], customer: ['Customer', 'Search name or phone, scan the member QR, or add them.'],
  voucher: ['Promo & voucher'], scan: ['Scan & quick add', 'USB and camera scanners type into this field.'], weighed: ['Weighed item', 'Read the scale, then add.'],
  openitem: ['Open item', 'For things not on the menu. Price is logged to the audit trail.'], notes: ['Item & kitchen notes', 'Notes print on the kitchen ticket.'],
  itemdisc: ['Item discount'], orderdisc: ['Order discount'], price: ['Change price', 'Lowering a price follows the discount approval ladder.'], type: ['Order type & channel'],
  merge: ['Merge tables', 'Their bills combine into this one.'], move: ['Move table'], split: ['Split to new bill', 'Pick the items that move to a separate bill.'],
  guests: ['Guests & service charge'], fire: ['Send to kitchen', 'Fire now or keep a course back.'], hold: ['Save bill', 'Park it in Open bills and start a new sale.'],
  ticket: ['Kitchen ticket'], redeem: ['Redeem beans', '1 bean = IDR 50 off. One item free per redeem.'], balance: ['Gift card & deposit'],
};

export function OrderSheet({ kind }: { kind: string }) {
  const { go, cur } = usePos();
  const flow = useApproval();
  const close = () => go(REG);
  const [t, sub] = TITLES[kind] ?? ['Order'];
  const needsOrder = !['options', 'table', 'customer', 'scan', 'weighed', 'openitem', 'type', 'balance', 'move'].includes(kind);
  const Body = BODIES[kind];
  return <Sheet open onClose={close} title={flow.open ? 'Approval needed' : t} sub={flow.open ? undefined : sub}>
    {flow.node ?? (needsOrder && !cur?.lines.length ? <NoOrder /> : Body ? <Body close={close} flow={flow} /> : null)}
  </Sheet>;
}
type BodyProps = { close: () => void; flow: ReturnType<typeof useApproval> };

/** Deep link with an empty cart: say so and offer one tap to start. */
function NoOrder() {
  const { db, outletId, me, ensureOrder } = usePos();
  const p = db.products.find(x => x.status === 'live' && !x.modifierGroupIds.length && !db.outletProducts.find(o => o.productId === x.id && o.outletId === outletId)?.is86);
  return <Empty icon="shopping-basket" title="The order is empty" action={p && <button className="btn btn-primary btn-pos" onClick={() => addLine(ensureOrder(), p.id, [], 1, '', me.id)}>Add {p.name} to try it</button>}>
    Add items on the register first. This sheet works on the current order.</Empty>;
}

function Options({ close }: BodyProps) {
  const { db, q, outletId, me, ensureOrder } = usePos();
  const p = db.products.find(x => x.id === q.get('p')) ?? db.products.find(x => x.modifierGroupIds.length)!;
  const groups = p.modifierGroupIds.map(id => db.modifierGroups.find(g => g.id === id)!).filter(Boolean);
  const [pick, setPick] = useState<Record<string, string[]>>({}), [qty, setQty] = useState(1), [note, setNote] = useState(''), [tried, setTried] = useState(false), [shake, setShake] = useState(false);
  const sold = !!db.outletProducts.find(x => x.productId === p.id && x.outletId === outletId)?.is86;
  const base = flashPrice(db.promos, p.id) ?? priceAt(db, p, outletId);
  const chosen = groups.flatMap(g => (pick[g.id] ?? []).map(id => g.options.find(o => o.id === id)!));
  const missing = groups.filter(g => g.required && !pick[g.id]?.length);
  const unit = base + chosen.reduce((a, o) => a + o.price, 0);
  const add = () => {
    if (missing.length) { setTried(true); setShake(true); setTimeout(() => setShake(false), 320); return; }
    addLine(ensureOrder(), p.id, chosen.map(o => ({ name: o.name, price: o.price })), qty, note.trim(), me.id); enqueue('order.line_added'); close();
  };
  return <div className="stack lg">
    <div className="row"><span style={{ width: 64, height: 64, borderRadius: 16, background: productImage(p), flex: 'none' }} />
      <div className="stack" style={{ gap: 2 }}><h3>{p.name}</h3><span className="muted">{idr(base)}{base < priceAt(db, p, outletId) && ' · flash price'}</span></div></div>
    {sold && <div className="banner b-danger"><Icon name="ban" />Sold out at this outlet. It stays visible but can’t be added.</div>}
    {groups.map(g => {
      const sel = pick[g.id] ?? [], miss = tried && g.required && !sel.length;
      return <div key={g.id} className="stack sm">
        <div className="row between"><b>{g.name}</b><Badge tone={miss ? 'danger' : g.required ? 'neutral' : 'neutral'}>{g.required ? (miss ? 'Required · pick one' : 'Required') : g.max > 1 ? `Optional · up to ${g.max}` : 'Optional'}</Badge></div>
        <div className="grid" style={{ ['--min' as string]: '130px', gap: 8 }}>{g.options.map(o => {
          const on = sel.includes(o.id), full = g.max > 1 && !on && sel.length >= g.max;
          return <button key={o.id} className="btn btn-pos" aria-pressed={on} disabled={full} onClick={() => setPick(s => ({ ...s, [g.id]: g.max === 1 ? [o.id] : on ? sel.filter(x => x !== o.id) : [...sel, o.id] }))}
            style={{ flexDirection: 'column', gap: 0, height: 60, borderColor: on ? 'var(--accent)' : miss ? 'var(--danger)' : undefined, background: on ? 'var(--accent-soft)' : undefined }}>
            <span>{o.name}</span><span className="faint" style={{ fontSize: 13, fontWeight: 500 }}>{o.price ? '+ ' + idr(o.price) : 'Included'}</span></button>;
        })}</div>
      </div>;
    })}
    <Field label="Note for the bar" optional><input className="input" value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. extra hot, no straw" /></Field>
    <div className="row between"><Stepper value={qty} onChange={setQty} min={1} label="quantity" />
      <button className={'btn btn-primary btn-pay grow' + (shake ? ' shake' : '')} style={{ marginLeft: 12, justifyContent: 'space-between', padding: '0 20px', background: missing.length ? 'var(--fg-3)' : undefined, borderColor: missing.length ? 'var(--fg-3)' : undefined }} disabled={sold} onClick={add}>
        <span style={{ fontSize: 17 }}>{missing.length ? 'Choose required options' : 'Add to order'}</span><span className="num">{idr(unit * qty)}</span></button></div>
  </div>;
}

export function tableState(db: ReturnType<typeof usePos>['db'], outletId: string) {
  const out = db.outlets.find(o => o.id === outletId)!;
  const bills = db.orders.filter(o => o.outletId === outletId && o.type === 'dine' && o.table && isOpenBill(o));
  // paid first (QR, kiosk) and still in the kitchen: the table is taken until the food is out
  const cooking = db.orders.filter(o => o.outletId === outletId && holdsTable(o) && !isOpenBill(o));
  const now = Date.now();
  return tablesOf(out).map(ft => {
    const t = ft.name;
    const on = bills.filter(o => o.table === t);
    const res = db.reservations.find(r => r.outletId === outletId && r.table === t && r.status === 'booked' && r.at > now - 15 * 60e3 && r.at - now < 6 * 3600e3);
    return { t, ft, bills: on, cooking: cooking.filter(o => o.table === t), res, amount: on.reduce((a, o) => a + o.total, 0), since: on.length ? Math.min(...on.map(o => o.createdAt)) : 0 };
  });
}
function Table({ close }: BodyProps) {
  const { db, outletId, cur, me, ensureOrder, setCur } = usePos();
  const tables = tableState(db, outletId), areas = areasOf(tables.map(x => x.ft));
  const [area, setArea] = useState(() => tables.find(x => x.t === cur?.table)?.ft.area ?? areas[0]);
  const inArea = tables.filter(x => x.ft.area === area);
  const pick = (x: ReturnType<typeof tableState>[number]) => {
    const other = x.bills.find(o => o.id !== cur?.id);
    if (other && !x.bills.some(o => o.id === cur?.id)) { setCur(other.id); toast(`Opened bill ${other.no} · ${x.t}`); return close(); }
    patchOrder(cur?.id ?? ensureOrder(), { table: x.t, type: 'dine' }, me.id); close();
  };
  return <div className="stack">
    <div className="row wrap" style={{ gap: 12, fontSize: 13 }}>{[['var(--bg-surface)', 'Free'], ['var(--accent-soft)', 'Occupied'], ['var(--info-soft)', 'Reserved'], ['var(--accent)', 'This order']].map(([c, l]) =>
      <span key={l} className="row" style={{ gap: 6 }}><i style={{ width: 14, height: 14, borderRadius: 4, background: c, border: '1px solid var(--border)' }} />{l}</span>)}</div>
    {areas.length > 1 && <Seg label="Area" value={area} onChange={setArea} options={areas.map(a => [a, `${a} · ${tables.filter(x => x.ft.area === a && !x.bills.length).length} free`] as const)} />}
    {!tables.length ? <Empty icon="armchair" title="No tables at this outlet">The owner or manager draws them in Tables & floor plan.</Empty> :
    <FloorGrid tables={inArea.map(x => x.ft)} rows={Math.max(1, ...inArea.map(x => x.ft.y + 1))} size={96} table={ft => { const x = inArea.find(y => y.t === ft.name)!;
      const mine = x.bills.some(o => o.id === cur?.id), occ = x.bills.length > 0 || x.cooking.length > 0;
      return <button key={x.t} onClick={() => pick(x)} className="btn" style={{ ...tableShape(ft), height: '100%', flexDirection: 'column', gap: 2, padding: 4, background: mine ? 'var(--accent)' : occ ? 'var(--accent-soft)' : x.res ? 'var(--info-soft)' : undefined, color: mine ? 'var(--ink-0)' : undefined, borderColor: mine ? 'var(--accent)' : undefined }}>
        <b className="num" style={{ fontSize: 17 }}>{x.t}</b>
        <span style={{ fontSize: 13, fontWeight: 500, opacity: .85 }}>{mine ? 'This order' : occ && !x.bills.length ? 'Paid · cooking' : occ ? `${idr(x.amount).replace('IDR ', '')} · ${Math.round((Date.now() - x.since) / 60e3)}m` : x.res ? `Reserved ${hhmm(x.res.at)}` : `${ft.seats} seats`}</span></button>;
    }} />}
    <p className="faint" style={{ fontSize: 13 }}>Tap an occupied table to open its bill. Merge and move live in the order’s More menu.</p>
  </div>;
}

export function CustomerList({ onPick, selected }: { onPick: (c: Customer) => void; selected?: string | null }) {
  const { db } = usePos();
  const [s, setS] = useState('');
  const digits = s.replace(/\D/g, '');
  const hits = db.customers.filter(c => !s || c.name.toLowerCase().includes(s.toLowerCase()) || (digits.length > 2 && c.phone.replace(/\D/g, '').includes(digits))).slice(0, 30);
  return <div className="stack sm">
    <input className="search" style={{ height: 48 }} autoFocus placeholder="Search name or phone" value={s} onChange={e => setS(e.target.value)} aria-label="Search customers" />
    {hits.length === 0 && <p className="muted">No member matches. Add them as a new customer.</p>}
    {hits.map(c => <button key={c.id} className="row card tight" onClick={() => onPick(c)} style={{ cursor: 'pointer', textAlign: 'left', borderColor: selected === c.id ? 'var(--accent)' : undefined, background: selected === c.id ? 'var(--accent-soft)' : undefined }}>
      <span className="avatar" style={{ background: 'var(--fg-2)' }}>{c.name.split(' ').map(w => w[0]).join('').slice(0, 2)}</span>
      <span className="grow stack" style={{ gap: 0 }}><b>{c.name}</b><span className="muted" style={{ fontSize: 13 }}>{c.phone}{c.deposit ? ' · deposit ' + idr(c.deposit) : ''}{c.credit ? ' · kasbon ' + idr(c.credit) : ''}</span></span>
      <span className="stack" style={{ alignItems: 'flex-end', gap: 2 }}><Badge tone="accent">{tierOf(db.ledger, c.id).name}</Badge><span className="num" style={{ fontSize: 13 }}>{balance(db.ledger, c.id).toLocaleString('en-US')} beans</span></span>
    </button>)}
  </div>;
}
function CustomerBody({ close }: BodyProps) {
  const { db, route, cur, me, ensureOrder } = usePos();
  const tab = route.t ?? 'find';
  const attach = (id: string | null) => { patchOrder(cur?.id ?? ensureOrder(), { customerId: id }, me.id); close(); };
  const [name, setName] = useState(''), [phone, setPhone] = useState(''), [opt, setOpt] = useState(true), [code, setCode] = useState(''), [err, setErr] = useState('');
  return <div className="stack">
    <TabLinks active={tab} tabs={[['find', 'Find', 'customer-lookup-and-points'], ['scan', 'Scan card', 'member-card-scan'], ['new', 'New customer', 'add-new-customer']]} />
    {cur?.customerId && <div className="banner b-info"><Icon name="user-check" /><span className="grow">{db.customers.find(c => c.id === cur.customerId)?.name} is on this order.</span><button className="btn btn-sm" onClick={() => attach(null)}>Remove</button></div>}
    {tab === 'find' && <CustomerList selected={cur?.customerId} onPick={c => attach(c.id)} />}
    {tab === 'scan' && <form className="stack" onSubmit={e => { e.preventDefault(); const d = code.replace(/\D/g, ''); const c = db.customers.find(x => x.id === code.trim() || (d.length > 5 && x.phone.replace(/\D/g, '').endsWith(d.slice(-8)))); if (c) attach(c.id); else setErr('No member found. Check the number or add them as new.'); }}>
      <Field label="Member QR or phone" error={err}><input className="input" autoFocus value={code} onChange={e => { setCode(e.target.value); setErr(''); }} placeholder="Scan the member QR, or type 0812…" /></Field>
      <button className="btn btn-primary btn-pos">Find member</button></form>}
    {tab === 'new' && <form className="stack" onSubmit={e => { e.preventDefault(); if (!name.trim() || phone.replace(/\D/g, '').length < 9) return setErr('Name and a valid phone are needed.'); const id = addCustomer(name.trim(), phone.trim(), me.id, opt), had = db.customers.find(c => c.id === id); toast(had ? `Already a member: ${had.name} · attached` : `${name} joined · 50 welcome beans`); attach(id); }}>
      <Field label="Name"><input className="input" value={name} onChange={e => setName(e.target.value)} autoFocus /></Field>
      <Field label="WhatsApp number" error={err}><input className="input" inputMode="tel" value={phone} onChange={e => { setPhone(e.target.value); setErr(''); }} placeholder="0812 3456 7890" /></Field>
      <label className="row between"><span>Receipts and offers on WhatsApp</span><Toggle on={opt} onChange={setOpt} label="Opt in" /></label>
      <button className="btn btn-primary btn-pos">Add and attach</button></form>}
  </div>;
}

function Voucher({ close }: BodyProps) {
  const { db, cur, me } = usePos();
  const [code, setCode] = useState(''), [err, setErr] = useState('');
  const codes = db.promos.filter(p => p.code && usable(p));
  const apply = (c: string) => { const e = applyVoucher(cur!.id, c, me.id); if (e) setErr(e); else { toast('Voucher applied'); close(); } };
  return <div className="stack">
    {cur!.promoIds.map(id => db.promos.find(p => p.id === id)).filter(Boolean).map(p => <div key={p!.id} className="banner b-success"><Icon name="ticket-percent" /><span className="grow">{p!.name} · − {idr(cur!.discount)}</span>
      <button className="btn btn-sm" onClick={() => patchOrder(cur!.id, { promoIds: [] }, me.id)}>Remove</button></div>)}
    <form className="row" onSubmit={e => { e.preventDefault(); apply(code); }}>
      <input className="input mono grow" style={{ textTransform: 'uppercase' }} value={code} onChange={e => { setCode(e.target.value); setErr(''); }} placeholder="Voucher code" aria-label="Voucher code" autoFocus />
      <button className="btn btn-primary" style={{ height: 48 }}>Apply</button></form>
    {err && <p style={{ color: 'var(--danger-fg)' }} role="alert">{err}</p>}
    <span className="cap">Active codes</span>
    {codes.map(p => <button key={p.id} className="row card tight" style={{ cursor: 'pointer', textAlign: 'left' }} onClick={() => apply(p.code!)}>
      <span className="grow stack" style={{ gap: 0 }}><b>{p.name}</b><span className="muted" style={{ fontSize: 13 }}>{p.minSpend ? 'Min. spend ' + idr(p.minSpend) + ' · ' : ''}{p.quota ? `${p.quota - (p.used ?? 0)} left` : ''}</span></span>
      <span className="mono badge">{p.code}</span></button>)}
    <p className="faint" style={{ fontSize: 13 }}>Best single promo wins. Flash prices are already in the item price.</p>
  </div>;
}

function Scan() {
  const { db, outletId, me, ensureOrder, go } = usePos();
  const [code, setCode] = useState(''), [log, setLog] = useState<string[]>([]);
  const add = () => {
    const c = code.trim().toLowerCase(); if (!c) return;
    const p = db.products.find(x => x.sku.toLowerCase() === c || x.name.toLowerCase() === c);
    const op = p && db.outletProducts.find(x => x.productId === p.id && x.outletId === outletId);
    if (!p || !op || op.hidden) setLog(l => [`${code} · not found`, ...l]);
    else if (op.is86) setLog(l => [`${p.name} · sold out`, ...l]);
    else if (p.modifierGroupIds.length) return go(P('product-options-sheet', { p: p.id }));
    else { addLine(ensureOrder(), p.id, [], 1, '', me.id); setLog(l => [`${p.name} · added`, ...l]); }
    setCode('');
  };
  return <div className="stack">
    <form onSubmit={e => { e.preventDefault(); add(); }} className="row"><input className="input mono grow" autoFocus value={code} onChange={e => setCode(e.target.value)} placeholder="Scan or type SKU, e.g. KB-012" aria-label="Barcode" /><button className="btn btn-primary" style={{ height: 48 }}>Add</button></form>
    {log.length === 0 ? <p className="muted">Scanned items are added one by one. Items with options open the options sheet.</p> : log.map((l, i) => <div key={i} className="row" style={{ fontSize: 14 }}><Icon name={l.endsWith('added') ? 'check' : 'x'} size={16} />{l}</div>)}
  </div>;
}

function Weighed({ close }: BodyProps) {
  const { db, me, ensureOrder } = usePos();
  const [name, setName] = useState('Weighed item'), [perKg, setPerKg] = useState(120000), [w, setW] = useState(0);
  const price = Math.round(perKg * w / 100) * 100;
  return <div className="stack">
    <Field label="Item"><input className="input" value={name} onChange={e => setName(e.target.value)} /></Field>
    <Field label="Price per kg"><input className="input num" inputMode="numeric" value={perKg} onChange={e => setPerKg(Number(e.target.value.replace(/\D/g, '')) || 0)} /></Field>
    <div className="sunken row between"><span className="stack" style={{ gap: 0 }}><span className="muted">Scale</span><b className="num" style={{ fontSize: 28 }}>{w.toFixed(3)} kg</b></span>
      <span className="row"><button className="btn" onClick={() => setW(0)}>Zero</button><ReadScale db={db} deviceId={thisDevice(db)} onWeight={setW} /></span></div>
    <Field label="Or type the weight (kg)"><input className="input num" inputMode="decimal" value={w || ''} onChange={e => setW(Number(e.target.value.replace(',', '.')) || 0)} /></Field>
    <button className="btn btn-primary btn-pay" disabled={!w || !perKg} onClick={() => { addOpenLine(ensureOrder(), `${name} · ${w.toFixed(3)} kg`, price, me.id, { station: 'kitchen' }); close(); }}>Add {idr(price)}</button>
  </div>;
}

function OpenItem({ close }: BodyProps) {
  const { me, ensureOrder } = usePos();
  const [name, setName] = useState(''), [price, setPrice] = useState(0), [st, setSt] = useState<OrderLine['station']>('bar');
  return <div className="stack">
    <Field label="Item name"><input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Birthday candle" autoFocus /></Field>
    <Seg label="Station" value={st} options={[['bar', 'Bar'], ['kitchen', 'Kitchen'], ['pastry', 'Pastry']] as const} onChange={setSt} />
    <AmountPad value={price} onChange={setPrice} title="Price" />
    <button className="btn btn-primary btn-pay" disabled={!name.trim() || !price} onClick={() => { addOpenLine(ensureOrder(), name.trim(), price, me.id, { station: st }); toast('Open item added'); close(); }}>Add {idr(price)}</button>
  </div>;
}

function Notes({ close }: BodyProps) {
  const { cur, q, me } = usePos();
  const o = cur!;
  const [notes, setNotes] = useState<Record<string, string>>(Object.fromEntries(o.lines.map(l => [l.id, l.note]))), [kn, setKn] = useState(o.note ?? '');
  const focus = q.get('line');
  return <div className="stack">
    {o.lines.map(l => <Field key={l.id} label={`${l.qty}× ${l.name}`} hint={l.fired ? 'Sent · tell the kitchen' : undefined}>
      <input className="input" disabled={l.fired} autoFocus={l.id === focus} value={notes[l.id] ?? ''} onChange={e => setNotes(n => ({ ...n, [l.id]: e.target.value }))} placeholder="less sugar, no ice, allergy…" /></Field>)}
    <Field label="Kitchen note for the whole order" optional><textarea className="input" value={kn} onChange={e => setKn(e.target.value)} placeholder="e.g. serve together, birthday plate" /></Field>
    <button className="btn btn-primary btn-pos" onClick={() => { patchOrder(o.id, { note: kn.trim(), lines: o.lines.map(l => l.fired ? l : { ...l, note: (notes[l.id] ?? '').trim() }) }, me.id); close(); }}>Save notes</button>
  </div>;
}

function LinePicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const { cur } = usePos();
  return <Field label="Item"><select className="input" value={value} onChange={e => onChange(e.target.value)}>{cur!.lines.map(l => <option key={l.id} value={l.id}>{l.qty}× {l.name} · {idr(lt(l))}</option>)}</select></Field>;
}
const PCTS = [5, 10, 15, 20, 25, 50, 100];
function PctPicker({ pct, setPct }: { pct: number; setPct: (n: number) => void }) {
  return <div className="stack sm"><div className="row wrap" style={{ gap: 6 }}>{PCTS.map(p => <button key={p} className="chip" style={{ height: 48, minWidth: 64 }} aria-pressed={pct === p} onClick={() => setPct(p)}>{p}%</button>)}</div>
    <Field label="Custom %"><input className="input num" inputMode="numeric" value={pct || ''} onChange={e => setPct(Math.min(100, Number(e.target.value.replace(/\D/g, '')) || 0))} /></Field>
    <p className="faint" style={{ fontSize: 13 }}>Up to 10% you sign yourself · up to 20% the PIC · above that the manager.</p></div>;
}
const REASONS = ['Regular guest', 'Birthday', 'Complaint', 'Staff meal', 'Wrong order'];
function Reason({ v, set }: { v: string; set: (s: string) => void }) {
  return <Field label="Reason"><div className="row wrap" style={{ gap: 6 }}>{REASONS.map(r => <button key={r} className="chip" aria-pressed={v === r} onClick={() => set(r)}>{r}</button>)}</div>
    <input className="input" value={v} onChange={e => set(e.target.value)} placeholder="Or type a reason" /></Field>;
}

function ItemDisc({ close, flow }: BodyProps) {
  const { cur, q, me } = usePos(); const can = usePerm();
  const o = cur!;
  const [lineId, setLine] = useState(q.get('line') ?? o.lines[0].id), [pct, setPct] = useState(10), [why, setWhy] = useState('');
  const l = o.lines.find(x => x.id === lineId) ?? o.lines[0];
  const amount = Math.round(lt({ ...l, discountPct: 0 }) * pct / 100);
  return <div className="stack">
    <LinePicker value={l.id} onChange={setLine} /><PctPicker pct={pct} setPct={setPct} /><Reason v={why} set={setWhy} />
    <div className="sunken row between"><span>Discount on {l.name}</span><b className="num">− {idr(amount)}</b></div>
    <div className="row"><button className="btn btn-pos" disabled={!l.discountPct} onClick={() => { patchLine(o.id, l.id, { discountPct: 0 }, me.id); close(); }}>Remove discount</button>
      <button className="btn btn-primary btn-pos grow" style={warnStyle(can('Apply discount'))} disabled={!pct || !why.trim()} onClick={() => flow.run({ action: 'Apply discount', type: 'discount', pct, amount, subjectId: null, note: why,
        payload: { pos: 'line_discount', orderId: o.id, lineId: l.id, pct }, title: `Item discount ${pct}% · ${l.name} · ${o.no}`, direct: () => patchLine(o.id, l.id, { discountPct: pct }, me.id), done: close })}>Apply {pct}%</button></div>
  </div>;
}
function OrderDisc({ close, flow }: BodyProps) {
  const { cur, me } = usePos(); const can = usePerm();
  const o = cur!;
  const [pct, setPct] = useState(o.discountPct || 10), [why, setWhy] = useState('');
  const amount = Math.round(o.subtotal * pct / 100);
  return <div className="stack">
    <PctPicker pct={pct} setPct={setPct} /><Reason v={why} set={setWhy} />
    <div className="sunken row between"><span>{pct}% of {idr(o.subtotal)}</span><b className="num">− {idr(amount)}</b></div>
    <div className="row"><button className="btn btn-pos" disabled={!o.discountPct} onClick={() => { patchOrder(o.id, { discountPct: 0 }, me.id); close(); }}>Remove discount</button>
      <button className="btn btn-primary btn-pos grow" style={warnStyle(can('Apply discount'))} disabled={!pct || !why.trim()} onClick={() => flow.run({ action: 'Apply discount', type: 'discount', pct, amount, subjectId: o.id, note: why,
        title: `Discount ${pct}% · ${o.no}${o.table ? ' · ' + o.table : ''}`, direct: () => patchOrder(o.id, { discountPct: pct }, me.id), done: close })}>Apply {pct}%</button></div>
  </div>;
}
function Price({ close, flow }: BodyProps) {
  const { cur, q, me } = usePos(); const can = usePerm();
  const o = cur!;
  const [lineId, setLine] = useState(q.get('line') ?? o.lines[0].id);
  const l = o.lines.find(x => x.id === lineId) ?? o.lines[0];
  const old = l.flashPrice ?? l.unitPrice;
  const [price, setPrice] = useState(old);
  const pct = price < old ? Math.ceil((old - price) / old * 100) : 0;
  return <div className="stack">
    <LinePicker value={l.id} onChange={id => { setLine(id); const x = o.lines.find(y => y.id === id)!; setPrice(x.flashPrice ?? x.unitPrice); }} />
    <AmountPad value={price} onChange={setPrice} title={`New unit price (was ${idr(old)})`} hint={pct > 0 ? <span className="muted" style={{ fontSize: 13 }}>{pct}% below the menu price · needs the same sign-off as a {pct}% discount</span> : null} />
    <button className="btn btn-primary btn-pay" style={warnStyle(pct ? can('Apply discount') : 'y')} disabled={price === old} onClick={() => pct
      ? flow.run({ action: 'Apply discount', type: 'discount', pct, amount: (old - price) * l.qty, subjectId: null, payload: { pos: 'line_price', orderId: o.id, lineId: l.id, price }, title: `Price ${l.name} ${idr(old)} → ${idr(price)} · ${o.no}`, direct: () => patchLine(o.id, l.id, { unitPrice: price, flashPrice: null }, me.id), done: close })
      : (patchLine(o.id, l.id, { unitPrice: price, flashPrice: null }, me.id), toast('Price changed'), close())}>Set {idr(price)}</button>
  </div>;
}

function TypeBody({ close }: BodyProps) {
  const { cur, me, ensureOrder, go } = usePos();
  return <div className="stack">
    <span className="cap">This order</span>
    <div className="grid" style={{ ['--min' as string]: '140px', gap: 8 }}>{([['dine', 'Dine-in', 'armchair', 'Table and pax, service charge'], ['take', 'Takeaway', 'shopping-bag', 'Packed at the counter'], ['delivery', 'Delivery', 'bike', 'Own courier or phone order']] as const).map(([k, l, ic, s]) =>
      <button key={k} className="card tight stack sm" style={{ cursor: 'pointer', textAlign: 'left', borderColor: (cur?.type ?? 'dine') === k ? 'var(--accent)' : undefined, background: (cur?.type ?? 'dine') === k ? 'var(--accent-soft)' : undefined }}
        onClick={() => { patchOrder(cur?.id ?? ensureOrder(), { type: k, table: k === 'dine' ? cur?.table ?? null : null }, me.id); close(); }}><Icon name={ic} /><b>{l}</b><span className="muted" style={{ fontSize: 13 }}>{s}</span></button>)}</div>
    <span className="cap">Other channels</span>
    <p className="muted" style={{ fontSize: 14 }}>QR menu, kiosk, web store and delivery-app orders arrive in their own inboxes. Delivery-app orders can’t be edited in BorNiz.</p>
    <div className="row wrap"><button className="btn" onClick={() => go(ONLINE_INBOX)}><Icon name="qr-code" size={18} />Online & QR inbox</button><button className="btn" onClick={() => go(RIDE_INBOX)}><Icon name="bike" size={18} />GoFood · GrabFood · ShopeeFood</button></div>
  </div>;
}

function Merge({ close }: BodyProps) {
  const { db, cur, outletId, me } = usePos();
  const others = db.orders.filter(o => o.outletId === outletId && o.id !== cur!.id && o.source === 'pos' && isOpenBill(o) && o.lines.length && o.status !== 'paying');
  if (!others.length) return <Empty icon="merge" title="No other open bills">Open bills on other tables show here.</Empty>;
  return <div className="stack sm">{others.map(o => <button key={o.id} className="row card tight" style={{ cursor: 'pointer' }} onClick={() => { mergeBills(cur!.id, o.id, me.id); toast(`${o.no} merged into ${cur!.no}`); close(); }}>
    <b className="num" style={{ minWidth: 56 }}>{label(o)}</b><span className="grow" style={{ textAlign: 'left' }}>{o.no} · {itemsOf(o)} items · {ago(o.createdAt)}</span><b className="num">{idr(o.total)}</b></button>)}</div>;
}
/** Move table: everything live at a table (open bills and paid orders still cooking) goes to a free table. The kitchen
 *  gets a slip with the new table for food still being made; the KDS, waiter app and the guest's phone follow on their own. */
function Move({ close }: BodyProps) {
  const { db, cur, outletId, me } = usePos();
  const tables = tableState(db, outletId), busy = tables.filter(x => x.bills.length || x.cooking.length);
  const [from, setFrom] = useState<string | null>(cur?.table ?? null);
  const src = busy.find(x => x.t === from);
  if (!src) return busy.length ? <div className="stack"><p className="muted">Which table is moving?</p>
    <div className="grid" style={{ ['--min' as string]: '96px', gap: 8 }}>{busy.map(x => <button key={x.t} className="btn btn-pos" style={{ background: 'var(--accent-soft)' }} onClick={() => setFrom(x.t)}>{x.t}</button>)}</div></div>
    : <Empty icon="armchair" title="No table to move">Tables with an open bill or food on the way show here.</Empty>;
  const orders = [...src.bills, ...src.cooking], free = tables.filter(x => !x.bills.length && !x.cooking.length);
  const moveTo = (t: string) => {
    const slips = orders.map(o => [o, o.lines.filter(l => l.fired && l.kds !== 'done').map(l => l.id)] as const).filter(([, ids]) => ids.length);
    orders.forEach(o => moveTable(o.id, t, me.id)); close();
    if (!slips.length) return toast(`Moved to ${t}`);
    Promise.all(slips.map(([o, ids]) => printTickets(db, { ...o, table: t, type: 'dine' }, me.id, true, ids, `Moved from ${src.t}`)))
      .then(r => toast(`Moved to ${t} · ${r.every(x => x.ok) ? 'kitchen slip printed' : 'the kitchen screen shows the new table'}`));
  };
  return <div className="stack"><p className="muted">Moving {src.t}: {orders.map(o => o.no).join(', ')}{src.cooking.length ? ' (food on the way)' : ''}. Pick a free table. <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFrom(null)}>Another table</button></p>
    <div className="grid" style={{ ['--min' as string]: '96px', gap: 8 }}>{free.map(x => <button key={x.t} className="btn btn-pos" style={{ background: x.res ? 'var(--info-soft)' : undefined }} onClick={() => moveTo(x.t)}>{x.t}</button>)}</div></div>;
}
function Split({ close }: BodyProps) {
  const { cur, me, setCur, go } = usePos();
  const [sel, setSel] = useState<string[]>([]), [made, setMade] = useState<string | null>(null);
  if (made) return <div className="stack" style={{ alignItems: 'center', textAlign: 'center' }}><Icon name="split" size={36} /><h3>New bill created</h3><p className="muted">The selected items moved to a separate bill on the same table.</p>
    <div className="row"><button className="btn btn-pos" onClick={close}>Back to {cur?.no}</button><button className="btn btn-primary btn-pos" onClick={() => { setCur(made); go(P('payment-method-picker')); }}>Charge the new bill</button></div></div>;
  const o = cur!;
  return <div className="stack">
    {o.lines.map(l => <label key={l.id} className="row card tight" style={{ cursor: 'pointer' }}><input type="checkbox" style={{ width: 22, height: 22 }} checked={sel.includes(l.id)} onChange={e => setSel(s => e.target.checked ? [...s, l.id] : s.filter(x => x !== l.id))} />
      <span className="grow">{l.qty}× {l.name}</span><b className="num">{idr(lt(l))}</b></label>)}
    <button className="btn btn-primary btn-pos" disabled={!sel.length || sel.length === o.lines.length} onClick={() => setMade(splitToNewBill(o.id, sel, me.id))}>Move {sel.length} item{sel.length === 1 ? '' : 's'} to a new bill</button>
  </div>;
}
function Guests({ close }: BodyProps) {
  const { db, cur, outletId, me } = usePos();
  const out = db.outlets.find(o => o.id === outletId)!, o = cur!;
  const [n, setN] = useState(o.guests);
  return <div className="stack lg">
    <div className="row between"><b>Guests</b><Stepper value={n} onChange={setN} min={1} max={40} label="guests" /></div>
    <p className="muted" style={{ fontSize: 14 }}>Used for per-pax reports and table turn time.</p>
    <div className="sunken stack sm"><div className="row between"><b>Service charge</b><span className="num">{out.serviceBps / 100}% · {idr(o.service)}</span></div>
      <span className="muted" style={{ fontSize: 13 }}>Set per outlet by the owner. PB1 {out.taxBps / 100}% {out.taxInclusive ? 'is included in prices' : 'is added on top'}.</span></div>
    <button className="btn btn-primary btn-pos" onClick={() => { patchOrder(o.id, { guests: n }, me.id); close(); }}>Save · {n} pax</button>
  </div>;
}
function Fire({ close }: BodyProps) {
  const { cur, me } = usePos();
  const o = cur!;
  const unfired = o.lines.filter(l => !l.fired);
  const [sel, setSel] = useState<string[]>(unfired.map(l => l.id));
  const send = () => {
    if (sel.length === unfired.length) sendToKitchen(o.id, me.id);
    else patchOrder(o.id, { lines: o.lines.map(l => sel.includes(l.id) ? { ...l, fired: true, kds: 'new' as const } : l), status: o.status === 'open' || o.status === 'held' ? 'sent' : o.status }, me.id);
    enqueue('order.sent'); toast(`Sent ${sel.length} item${sel.length > 1 ? 's' : ''} to the kitchen`); close();
  };
  const by = (['bar', 'kitchen', 'pastry'] as const).map(st => [st, o.lines.filter(l => l.station === st)] as const).filter(([, ls]) => ls.length);
  return <div className="stack">
    {by.map(([st, ls]) => <div key={st} className="stack sm"><span className="cap">{st}</span>{ls.map(l => <label key={l.id} className="row card tight" style={{ cursor: l.fired ? 'default' : 'pointer' }}>
      <input type="checkbox" style={{ width: 22, height: 22 }} disabled={l.fired} checked={l.fired || sel.includes(l.id)} onChange={e => setSel(s => e.target.checked ? [...s, l.id] : s.filter(x => x !== l.id))} />
      <span className="grow">{l.qty}× {l.name}{l.note && <span className="muted"> · {l.note}</span>}</span>{l.fired ? <Status s={l.kds === 'new' ? 'sent' : l.kds === 'cooking' ? 'cooking' : 'ready'} /> : <Badge>Not sent</Badge>}</label>)}</div>)}
    <button className="btn btn-primary btn-pos" disabled={!sel.length} onClick={send}>{sel.length < unfired.length ? `Fire ${sel.length} now · keep ${unfired.length - sel.length} back` : `Send ${sel.length} item${sel.length === 1 ? '' : 's'}`}</button>
  </div>;
}
function Hold() {
  const { db, cur, me, setCur, go } = usePos();
  const o = cur!, held = db.orders.filter(x => x.outletId === o.outletId && x.status === 'held').length;
  return <div className="stack">
    <div className="sunken stack sm"><Row2 l="Bill" v={`${o.no} · ${label(o)}`} /><Row2 l="Items" v={String(itemsOf(o))} /><Row2 l="Total" v={idr(o.total)} /></div>
    <p className="muted">{held} bill{held === 1 ? '' : 's'} already open. Saved bills keep their table and items; anything sent to the kitchen keeps cooking.</p>
    <button className="btn btn-primary btn-pos" onClick={() => { holdOrder(o.id, me.id); enqueue('order.held'); setCur(null); toast('Bill saved to Open bills'); go(REG); }}>Save bill and start new sale</button>
  </div>;
}
const Row2 = ({ l, v }: { l: string; v: string }) => <div className="row between"><span className="muted">{l}</span><b className="num">{v}</b></div>;
function Ticket() {
  const { db, cur, me } = usePos();
  const o = cur!, cashier = db.employees.find(e => e.id === o.cashierId)?.name ?? me.name;
  const by = (['bar', 'kitchen', 'pastry'] as const).map(st => [st, o.lines.filter(l => l.station === st)] as const).filter(([, ls]) => ls.length);
  const lines = [`${label(o).toUpperCase()}  ${o.type === 'dine' ? 'DINE-IN' : o.type === 'take' ? 'TAKEAWAY' : 'DELIVERY'}`, `${o.no} · ${cashier}  ${hhmm(Date.now())}`, '*** REPRINT ***', '',
    ...by.flatMap(([st, ls]) => [`${st.toUpperCase()} · ${ls.length} item${ls.length > 1 ? 's' : ''}`, ...ls.flatMap(l => [`${l.qty} x ${l.name.toUpperCase()}`, ...l.mods.map(m => `  > ${m.name.toUpperCase()}`), ...(l.note ? [`  ** ${l.note.toUpperCase()} **`] : [])]), '']),
    ...(o.note ? [`NOTE: ${o.note}`] : [])];
  return <div className="stack"><Paper lines={lines} />
    <button className="btn btn-primary btn-pos" onClick={() => { printTickets(db, o, me.id, true).then(r => toast(r.message)); }}><Icon name="printer" />Reprint ticket</button></div>;
}
function Redeem({ close }: BodyProps) {
  const { db, cur, me, go } = usePos();
  const o = cur!, c = db.customers.find(x => x.id === o.customerId);
  if (!c) return <Empty icon="user-plus" title="Attach a member first" action={<button className="btn btn-primary" onClick={() => go(P('customer-lookup-and-points'))}>Find customer</button>}>Beans belong to a member account.</Empty>;
  const bal = balance(db.ledger, c.id);
  return <div className="stack">
    <div className="sunken row between"><span><b>{c.name}</b> · {tierOf(db.ledger, c.id).name}</span><b className="num">{bal.toLocaleString('en-US')} beans</b></div>
    {o.lines.filter(l => l.discountPct < 100 && l.unitPrice > 0).map(l => {
      const unit = (l.flashPrice ?? l.unitPrice) + l.mods.reduce((a, m) => a + m.price, 0), cost = Math.ceil(unit / 50);
      return <div key={l.id} className="row card tight"><span className="grow">Free {l.name}<br /><span className="muted" style={{ fontSize: 13 }}>{idr(unit)} off</span></span>
        <button className="btn btn-primary" disabled={bal < cost} onClick={() => { const e = redeem(c.id, cost, `Free ${l.name} · ${o.no}`, me.id); if (e) return toast(e); freeOneUnit(o.id, l.id, `Redeemed ${cost} beans`, me.id); toast(`${cost} beans redeemed`); close(); }}>{bal < cost ? `Needs ${cost}` : `Redeem ${cost}`}</button></div>;
    })}
  </div>;
}
function BalanceBody() {
  const { db, cur, me, go, ensureOrder } = usePos();
  const c = db.customers.find(x => x.id === cur?.customerId);
  if (!c) return <div className="stack"><p className="muted">Pick the guest to see their deposit, gift card and kasbon balance.</p><CustomerList onPick={x => patchOrder(cur?.id ?? ensureOrder(), { customerId: x.id }, me.id)} /></div>;
  return <div className="stack">
    <div className="row"><b className="grow">{c.name}</b><button className="btn btn-sm" onClick={() => patchOrder(cur!.id, { customerId: null }, me.id)}>Change</button></div>
    <div className="grid" style={{ ['--min' as string]: '150px' }}>
      <div className="card kpi"><span className="l">Deposit / gift card</span><span className="v">{idr(c.deposit)}</span></div>
      <div className="card kpi"><span className="l">Kasbon owed</span><span className="v">{idr(c.credit)}</span></div>
      <div className="card kpi"><span className="l">Beans</span><span className="v">{balance(db.ledger, c.id).toLocaleString('en-US')}</span></div>
    </div>
    <button className="btn btn-primary btn-pos" disabled={!c.deposit || !cur?.lines.length} onClick={() => go(P('pay-with-deposit-gift-card'))}>Pay with deposit</button>
    <p className="faint" style={{ fontSize: 13 }}>Top-ups and new gift cards are sold in the back office.</p>
  </div>;
}

const BODIES: Record<string, (p: BodyProps) => ReactNode> = {
  options: Options, table: Table, customer: CustomerBody, voucher: Voucher, scan: Scan, weighed: Weighed, openitem: OpenItem, notes: Notes,
  itemdisc: ItemDisc, orderdisc: OrderDisc, price: Price, type: TypeBody, merge: Merge, move: Move, split: Split, guests: Guests, fire: Fire,
  hold: Hold, ticket: Ticket, redeem: Redeem, balance: BalanceBody,
};
