'use client';
import { productImage } from '../../ui/kit.tsx';
// After the sale and counter tools: open bills, shift transaction history (detail, reprint, e-receipt, void / refund,
// exchange) and tools (price check, stock check, sold-out, reservations & walk-ins, manager PIN override).
import { useState } from 'react';
import { addLine, newOrder, patchOrder, priceAt, reopen, toggle86, voidItem } from '../../data/actions.ts';
import { addWalkIn, logDevice, sendReceipt, setReservation } from '../../data/actions/pos.ts';
import { lineTotal } from '../../domain/order.ts';
import { flashPrice } from '../../domain/promo.ts';
import { level as stockLevel } from '../../domain/stock.ts';
import { idr } from '../../domain/money.ts';
import { Badge, Empty, Field, Icon, Kpi, Seg, Sheet, Status, Toggle, ago, hhmm, toast } from '../../ui/kit.tsx';
import type { Order, OrderLine } from '../../data/schema.ts';
import { P, Paper, Row, TabLinks, isOpenBill, itemsOf, label, paidOf, startOfDay, usePos, useApproval, usePerm, voidSlip, warnStyle } from './shared.tsx';
import { CustomerList } from './OrderSheets.tsx';
import { paperOf, receiptPrinter, thisDevice } from '../../devices/routing.ts';
import { openDrawer, printReceipt } from '../../devices/hardware.ts';
import { receiptDoc } from '../../devices/receipt.ts';
import { toText } from '../../devices/layout.ts';

const lt = (l: OrderLine) => lineTotal({ unitPrice: l.unitPrice, flashPrice: l.flashPrice, modifiers: l.mods.map(m => m.price), qty: l.qty, discountPct: l.discountPct });
const PAID: Order['status'][] = ['paid', 'part_refunded', 'refunded'];
const NAME: Record<string, string> = { cash: 'Cash', qris: 'QRIS', card: 'Card', ewallet: 'E-wallet', va: 'VA', deposit: 'Deposit', kasbon: 'Kasbon' };
const methodsOf = (db: ReturnType<typeof usePos>['db'], id: string) => [...new Set(db.payments.filter(p => p.orderId === id && p.status === 'settled' && p.ref !== 'ROUNDING').map(p => NAME[p.method]))].join(' + ');

export function Bills() {
  const { db, outletId, cur, me, setCur, go } = usePos();
  const bills = db.orders.filter(o => o.outletId === outletId && o.source === 'pos' && isOpenBill(o) && o.lines.length).sort((a, b) => b.createdAt - a.createdAt);
  return <div className="pos-page stack lg">
    <div className="stack" style={{ gap: 2 }}><h1>Open bills</h1><span className="muted">{bills.length} open · {idr(bills.reduce((a, o) => a + o.total - paidOf(db, o.id), 0))} still to collect</span></div>
    {bills.length === 0 ? <Empty icon="clipboard-list" title="No open bills">Use “Save bill” on an order to park it here.</Empty> :
      <div className="stack sm">{bills.map(o => { const paid = paidOf(db, o.id);
        return <div key={o.id} className="row card tight wrap" style={{ borderColor: o.id === cur?.id ? 'var(--accent)' : undefined }}>
          <span className="num" style={{ minWidth: 64, height: 48, borderRadius: 12, display: 'grid', placeItems: 'center', background: o.type === 'dine' ? 'var(--accent-soft)' : 'var(--bg-sunken)', fontWeight: 700 }}>{o.type === 'dine' ? o.table ?? 'DI' : o.type === 'take' ? 'TA' : 'DL'}</span>
          <span className="grow stack" style={{ gap: 0, minWidth: 160 }}><b>Order {o.no}</b><span className="muted" style={{ fontSize: 13 }}>{label(o)} · {itemsOf(o)} items · {ago(o.createdAt)} · {db.employees.find(e => e.id === o.cashierId)?.name}{o.note ? ' · ' + o.note : ''}</span></span>
          <span className="stack" style={{ alignItems: 'flex-end', gap: 2 }}><b className="num">{idr(o.total)}</b>{paid > 0 && <span className="faint" style={{ fontSize: 13 }}>DP {idr(paid)}</span>}</span>
          {o.id === cur?.id ? <Badge tone="accent">Current</Badge> : <Status s={o.status} />}
          <button className="btn btn-primary" onClick={() => { if (o.status === 'held') reopen(o.id, me.id); setCur(o.id); go(P('register-order')); }}>Open</button>
        </div>; })}</div>}
  </div>;
}

export function History() {
  const { db, outletId, session, me, route, q, go } = usePos();
  const [scope, setScope] = useState<'shift' | 'today'>(session ? 'shift' : 'today'), [f, setF] = useState('all'), [s, setS] = useState('');
  const t0 = startOfDay();
  const all = db.orders.filter(o => o.outletId === outletId && (scope === 'shift' ? o.sessionId === session?.id : o.createdAt >= t0) && o.lines.length).sort((a, b) => b.createdAt - a.createdAt);
  const list = all.filter(o => (f === 'all' || (f === 'paid' ? o.status === 'paid' : f === 'open' ? isOpenBill(o) : ['voided', 'refunded', 'part_refunded'].includes(o.status))) && (!s || o.no.includes(s)));
  const paid = all.filter(o => PAID.includes(o.status));
  const sel = db.orders.find(o => o.id === q.get('o')) ?? db.orders.filter(o => o.outletId === outletId && PAID.includes(o.status) && (o.cashierId === me.id || o.sessionId === session?.id)).sort((a, b) => (b.paidAt ?? 0) - (a.paidAt ?? 0))[0]
    ?? db.orders.filter(o => o.outletId === outletId && PAID.includes(o.status)).sort((a, b) => (b.paidAt ?? 0) - (a.paidAt ?? 0))[0];
  return <div className="pos-page stack lg">
    <div className="row between wrap"><div className="stack" style={{ gap: 2 }}><h1>Transactions</h1><span className="muted">{scope === 'shift' ? `This shift · session ${session?.id ?? '—'}` : 'Today · all registers at this outlet'}</span></div>
      <Seg label="Scope" value={scope} options={[['shift', 'This shift'], ['today', 'Today']] as const} onChange={setScope} /></div>
    <div className="grid" style={{ ['--min' as string]: '150px' }}><Kpi label="Sales" value={idr(paid.reduce((a, o) => a + o.total, 0))} /><Kpi label="Paid orders" value={paid.length} /><Kpi label="Open" value={all.filter(isOpenBill).length} /><Kpi label="Voided / refunded" value={all.filter(o => ['voided', 'refunded', 'part_refunded'].includes(o.status)).length} /></div>
    <div className="row wrap"><input className="search" style={{ maxWidth: 220 }} placeholder="Order number" value={s} onChange={e => setS(e.target.value.replace(/\D/g, ''))} aria-label="Find order number" />
      {[['all', 'All'], ['paid', 'Paid'], ['open', 'Open'], ['back', 'Voided & refunded']].map(([k, l]) => <button key={k} className="chip" aria-pressed={f === k} onClick={() => setF(k)}>{l}</button>)}</div>
    {list.length === 0 ? <Empty icon="receipt" title={scope === 'shift' ? 'No sales yet this shift' : 'No orders today'}>{scope === 'shift' ? 'Switch to Today to see every register.' : ''}</Empty> :
      <div className="card flat scroll-x"><table className="table"><thead><tr><th>Order</th><th>Time</th><th className="hide-sm">Where</th><th className="hide-sm">Paid with</th><th className="r">Total</th><th>Status</th></tr></thead><tbody>
        {list.slice(0, 120).map(o => <tr key={o.id} className="click" onClick={() => go(P('order-detail-and-edit-after-payment', { o: o.id }))}>
          <td><b className="num">{o.no}</b></td><td>{hhmm(o.paidAt ?? o.createdAt)}</td><td className="hide-sm">{o.source === 'pos' ? label(o) : o.source}</td><td className="hide-sm">{methodsOf(db, o.id) || '—'}</td>
          <td className="r num">{idr(o.total)}</td><td><Status s={o.status} /></td></tr>)}</tbody></table></div>}
    {route.s && sel && <OrderSheet o={sel} kind={route.s} />}
    {route.s && !sel && <Sheet open onClose={() => go(P('shift-transaction-history'))} title="No order"><Empty icon="receipt" title="No paid order yet">Make a sale first.</Empty></Sheet>}
  </div>;
}

const TITLE: Record<string, string> = { detail: 'Order detail', receipt: 'Reprint receipt', ereceipt: 'Send e-receipt', refund: 'Refund', voidrefund: 'Request void / refund', exchange: 'Exchange' };
function OrderSheet({ o, kind }: { o: Order; kind: string }) {
  const { go } = usePos();
  const flow = useApproval();
  const close = () => go(P('shift-transaction-history'));
  const body = kind === 'receipt' ? <Receipt o={o} /> : kind === 'ereceipt' ? <EReceipt o={o} /> : kind === 'refund' || kind === 'voidrefund' ? <Refund o={o} flow={flow} /> : kind === 'exchange' ? <Exchange o={o} flow={flow} /> : <Detail o={o} />;
  return <Sheet open onClose={close} title={flow.open ? 'Approval needed' : `${TITLE[kind] ?? 'Order'} · ${o.no}`}>{flow.node ?? body}</Sheet>;
}

function Detail({ o }: { o: Order }) {
  const { db, me, go } = usePos();
  const [edit, setEdit] = useState(false);
  const cust = db.customers.find(c => c.id === o.customerId);
  const pays = db.payments.filter(p => p.orderId === o.id), refunds = db.refunds.filter(r => r.orderId === o.id);
  const aps = db.approvals.filter(a => a.subjectId === o.id || (a.payload as { orderId?: string } | undefined)?.orderId === o.id);
  const pts = db.ledger.filter(l => l.orderId === o.id).reduce((a, l) => a + l.points, 0);
  const q = { o: o.id };
  return <div className="stack">
    <div className="row wrap"><Status s={o.status} /><Badge>{o.source === 'pos' ? 'Register' : o.source}</Badge><span className="muted" style={{ fontSize: 13 }}>{label(o)} · {hhmm(o.createdAt)} · {db.employees.find(e => e.id === o.cashierId)?.name ?? '—'}</span></div>
    <div className="stack sm">{o.lines.map(l => <Row key={l.id} l={`${l.qty}× ${l.name}${l.mods.length ? ' · ' + l.mods.map(m => m.name).join(', ') : ''}${l.discountPct ? ` (−${l.discountPct}%)` : ''}`} v={idr(lt(l))} />)}</div>
    <div className="sunken stack sm"><Row l="Subtotal" v={idr(o.subtotal)} />{o.discount > 0 && <Row l="Discount" v={'− ' + idr(o.discount)} />}<Row l="Service" v={idr(o.service)} /><Row l="PB1" v={idr(o.tax)} /><Row l="Total" v={idr(o.total)} strong /></div>
    {pays.length > 0 && <div className="stack sm"><span className="cap">Payments</span>{pays.map(p => <div key={p.id} className="row between" style={{ fontSize: 14 }}><span>{p.ref === 'ROUNDING' ? 'Cash rounding' : NAME[p.method]} · <span className="mono">{p.ref}</span></span><span className="row" style={{ gap: 6 }}><b className="num">{idr(p.amount)}</b><Status s={p.status} /></span></div>)}</div>}
    {refunds.length > 0 && <div className="stack sm"><span className="cap">Refunds</span>{refunds.map(r => <Row key={r.id} l={`${r.reason || 'Refund'} · ${hhmm(r.at)}${r.toStock ? ' · back to stock' : ''}`} v={'− ' + idr(r.amount)} />)}</div>}
    {aps.length > 0 && <div className="stack sm"><span className="cap">Approvals</span>{aps.map(a => <div key={a.id} className="row between" style={{ fontSize: 14 }}><span>{a.title}</span><Status s={a.status} /></div>)}</div>}
    <div className="row between"><span>{cust ? <>Member <b>{cust.name}</b>{pts ? ` · ${pts} beans` : ''}</> : 'No member'}</span>{PAID.includes(o.status) && <button className="btn btn-sm" onClick={() => setEdit(!edit)}>{edit ? 'Done' : 'Edit'}</button>}</div>
    {edit && <div className="stack sm"><p className="faint" style={{ fontSize: 13 }}>After payment only the member and note can change. Money changes go through refund.</p>
      <Field label="Note"><input className="input" defaultValue={o.note ?? ''} onBlur={e => patchOrder(o.id, { note: e.target.value }, me.id)} /></Field>
      <CustomerList selected={o.customerId} onPick={c => { patchOrder(o.id, { customerId: c.id }, me.id); toast(`${c.name} attached · beans aren’t added after payment`); }} /></div>}
    <div className="row wrap">
      <button className="btn" onClick={() => go(P('reprint-receipt', q))}><Icon name="printer" size={18} />Reprint</button>
      <button className="btn" onClick={() => go(P('send-e-receipt', q))}><Icon name="send" size={18} />E-receipt</button>
      {PAID.includes(o.status) && o.status !== 'refunded' && <button className="btn" onClick={() => go(P('refund', q))}><Icon name="undo-2" size={18} />Refund</button>}
      {PAID.includes(o.status) && o.status !== 'refunded' && <button className="btn" onClick={() => go(P('exchange', q))}><Icon name="repeat" size={18} />Exchange</button>}
      {isOpenBill(o) && <button className="btn btn-danger" onClick={() => go(P('request-void-refund', q))}><Icon name="ban" size={18} />Void</button>}
    </div>
  </div>;
}

function Receipt({ o }: { o: Order }) {
  const { db, me } = usePos();
  const dev = thisDevice(db), p = receiptPrinter(db, o.outletId, dev);
  const copies = db.audit.filter(a => a.action === 'print.receipt' && a.subject === o.no).length;
  const [busy, setBusy] = useState(false);
  return <div className="stack"><Paper lines={toText(receiptDoc(db, o, p ? paperOf(p) : '80', { copy: copies > 0 }))} />
    <span className="faint" style={{ fontSize: 13 }}>{copies ? `Printed ${copies} time${copies > 1 ? 's' : ''} before. Reprints are marked COPY.` : 'Reprints are marked COPY.'} {p ? `Prints on ${p.name}.` : 'No receipt printer on this register: send an e-receipt instead.'}</span>
    <button className="btn btn-primary btn-pos" disabled={busy} onClick={async () => { setBusy(true); const r = await printReceipt(db, o, dev, me.id); setBusy(false); toast(r.message); }}><Icon name="printer" />{copies ? 'Print copy' : 'Print receipt'}</button></div>;
}
function EReceipt({ o }: { o: Order }) {
  const { db, me } = usePos();
  const c = db.customers.find(x => x.id === o.customerId);
  const [ch, setCh] = useState<'wa' | 'email'>('wa'), [to, setTo] = useState(c?.phone ?? '');
  const sent = db.messages.filter(m => m.template === 'e_receipt' && (m.customerId === o.customerId && !!c)).slice(0, 5);
  return <div className="stack">
    <Seg label="Channel" value={ch} options={[['wa', 'WhatsApp'], ['email', 'Email']] as const} onChange={v => { setCh(v); setTo(v === 'email' ? c?.email ?? '' : c?.phone ?? ''); }} />
    <Field label={ch === 'wa' ? 'WhatsApp number' : 'Email'}><input className="input" inputMode={ch === 'wa' ? 'tel' : 'email'} value={to} onChange={e => setTo(e.target.value)} /></Field>
    <button className="btn btn-primary btn-pos" disabled={!to.trim()} onClick={() => { sendReceipt(o.id, ch, to.trim(), me.id); toast(`E-receipt queued to ${to}`); }}>Send e-receipt</button>
    {sent.length > 0 && <div className="stack sm"><span className="cap">Sent before</span>{sent.map(m => <div key={m.id} className="row between" style={{ fontSize: 14 }}><span>{m.channel === 'wa' ? 'WhatsApp' : 'Email'} · {m.to} · {ago(m.at)}</span><Status s={m.status} /></div>)}</div>}
  </div>;
}

type Flow = ReturnType<typeof useApproval>;
function Refund({ o, flow }: { o: Order; flow: Flow }) {
  const { db, me } = usePos(); const can = usePerm();
  const unpaid = isOpenBill(o);
  const refunded = db.refunds.filter(r => r.orderId === o.id).reduce((a, r) => a + r.amount, 0), max = o.total - refunded;
  const [mode, setMode] = useState<'full' | 'part' | 'item'>(unpaid ? 'item' : 'full'), [amt, setAmt] = useState(0), [sel, setSel] = useState<string[]>([]), [why, setWhy] = useState(''), [stock, setStock] = useState(false);
  const itemAmt = Math.round(o.lines.filter(l => sel.includes(l.id)).reduce((a, l) => a + lt(l), 0) / (o.subtotal || 1) * o.total);
  if (o.status === 'voided') return <Empty icon="ban" title="This bill is voided" />;
  if (o.status === 'refunded') return <Empty icon="undo-2" title="Fully refunded">{idr(refunded)} returned.</Empty>;
  if (unpaid) {
    const line = o.lines.find(l => sel.includes(l.id));
    return <div className="stack">
      <p className="muted">Not paid yet, so this is a void. Items not sent to the kitchen can just be removed on the register.</p>
      <Seg label="Void" value={mode === 'full' ? 'full' : 'item'} options={[['item', 'One item'], ['full', 'Whole bill']] as const} onChange={setMode} />
      {mode !== 'full' && o.lines.map(l => <label key={l.id} className="row card tight" style={{ cursor: 'pointer' }}><input type="radio" name="vl" style={{ width: 22, height: 22 }} checked={sel[0] === l.id} onChange={() => setSel([l.id])} /><span className="grow">{l.qty}× {l.name}</span><b className="num">{idr(lt(l))}</b></label>)}
      <Field label="Reason"><input className="input" value={why} onChange={e => setWhy(e.target.value)} placeholder="Wrong order, guest left…" /></Field>
      <button className="btn btn-danger btn-pos" style={warnStyle(can('Void item'))} disabled={!why.trim() || (mode !== 'full' && !line)} onClick={() => flow.run(mode === 'full'
        ? { action: 'Void item', type: 'void', amount: o.total, subjectId: o.id, note: why, title: `Void bill ${o.no} · ${idr(o.total)}`, direct: () => voidItem(o.id, null, me.id, why), done: () => voidSlip(db, o, o.lines.map(l => l.id), me.id, 'Bill voided') }
        : { action: 'Void item', type: 'void', amount: lt(line!), subjectId: o.id, note: why, payload: { lineId: line!.id }, title: `Void ${line!.qty}× ${line!.name} · ${o.no}`, direct: () => voidItem(o.id, line!.id, me.id), done: () => voidSlip(db, o, [line!.id], me.id) })}>
        Request void · {idr(mode === 'full' ? o.total : line ? lt(line) : 0)}</button>
    </div>;
  }
  const amount = mode === 'full' ? max : mode === 'part' ? Math.min(amt, max) : Math.min(itemAmt, max);
  return <div className="stack">
    {refunded > 0 && <div className="banner b-info"><Icon name="info" />{idr(refunded)} already refunded · {idr(max)} left.</div>}
    <Seg label="Refund" value={mode} options={[['full', 'Full'], ['part', 'Partial'], ['item', 'By item']] as const} onChange={setMode} />
    {mode === 'part' && <Field label="Amount"><input className="input num" inputMode="numeric" value={amt || ''} onChange={e => setAmt(Number(e.target.value.replace(/\D/g, '')) || 0)} /></Field>}
    {mode === 'item' && o.lines.map(l => <label key={l.id} className="row card tight" style={{ cursor: 'pointer' }}><input type="checkbox" style={{ width: 22, height: 22 }} checked={sel.includes(l.id)} onChange={e => setSel(s => e.target.checked ? [...s, l.id] : s.filter(x => x !== l.id))} /><span className="grow">{l.qty}× {l.name}</span><b className="num">{idr(lt(l))}</b></label>)}
    <Field label="Reason"><div className="row wrap" style={{ gap: 6 }}>{['Cold / quality', 'Wrong item', 'Guest changed mind', 'Double charge'].map(r => <button key={r} className="chip" aria-pressed={why === r} onClick={() => setWhy(r)}>{r}</button>)}</div>
      <input className="input" value={why} onChange={e => setWhy(e.target.value)} placeholder="Or type a reason" /></Field>
    <label className="row between"><span>Return items to stock</span><Toggle on={stock} onChange={setStock} label="Return to stock" /></label>
    <div className="sunken row between"><span>Refund to {methodsOf(db, o.id) || 'original method'}</span><b className="num">{idr(amount)}</b></div>
    <p className="faint" style={{ fontSize: 13 }}>PIC signs up to IDR 100,000 · manager up to IDR 500,000 · owner above. Beans earned on this order are reversed.</p>
    <button className="btn btn-primary btn-pos" style={warnStyle(can('Refund'))} disabled={!amount || !why.trim()} onClick={() => flow.run({ action: 'Refund', type: 'refund', amount, subjectId: o.id, note: why,
      payload: { toStock: stock, lineIds: mode === 'item' ? sel : undefined }, title: `Refund ${idr(amount)} · ${o.no}`, done: () => toast('Refund approved') })}>Request refund · {idr(amount)}</button>
  </div>;
}

function Exchange({ o, flow }: { o: Order; flow: Flow }) {
  const { db, outletId, me, session, setCur, go } = usePos();
  const [back, setBack] = useState<string[]>([]), [take, setTake] = useState<string[]>([]), [made, setMade] = useState<string | null>(null);
  const products = db.products.filter(p => p.status === 'live' && !p.modifierGroupIds.length && !db.outletProducts.find(x => x.productId === p.id && x.outletId === outletId)?.is86);
  const backAmt = Math.round(o.lines.filter(l => back.includes(l.id)).reduce((a, l) => a + lt(l), 0) / (o.subtotal || 1) * o.total);
  if (made) return <div className="stack" style={{ alignItems: 'center', textAlign: 'center' }}><Icon name="repeat" size={36} /><h3>Exchange started</h3>
    <p className="muted">The return of {idr(backAmt)} is waiting for sign-off. Charge the replacement on the new bill.</p>
    <button className="btn btn-primary btn-pos" onClick={() => { setCur(made); go(P('register-order')); }}>Go to the new bill</button></div>;
  const start = () => {
    const id = newOrder(outletId, me.id, 'pos', { type: 'take', customerId: o.customerId, sessionId: session?.id ?? null, note: `Exchange for ${o.no}` });
    take.forEach(pid => addLine(id, pid, [], 1, '', me.id));
    setMade(id);
    flow.run({ action: 'Refund', type: 'refund', amount: backAmt, subjectId: o.id, note: `Exchange · new bill`, payload: { toStock: true, lineIds: back }, title: `Exchange return ${idr(backAmt)} · ${o.no}` });
  };
  return <div className="stack">
    <span className="cap">Items coming back</span>
    {o.lines.map(l => <label key={l.id} className="row card tight" style={{ cursor: 'pointer' }}><input type="checkbox" style={{ width: 22, height: 22 }} checked={back.includes(l.id)} onChange={e => setBack(s => e.target.checked ? [...s, l.id] : s.filter(x => x !== l.id))} /><span className="grow">{l.qty}× {l.name}</span><b className="num">{idr(lt(l))}</b></label>)}
    <span className="cap">Replacement</span>
    <div className="row wrap" style={{ gap: 6 }}>{products.map(p => <button key={p.id} className="chip" aria-pressed={take.includes(p.id)} onClick={() => setTake(s => s.includes(p.id) ? s.filter(x => x !== p.id) : [...s, p.id])}>{p.name}</button>)}</div>
    <div className="sunken row between"><span>Returned value</span><b className="num">{idr(backAmt)}</b></div>
    <button className="btn btn-primary btn-pos" disabled={!back.length || !take.length} onClick={start}>Start exchange</button>
  </div>;
}

export function Tools() {
  const { route } = usePos();
  const tab = route.t ?? 'price';
  return <div className="pos-page stack lg">
    <h1>Counter tools</h1>
    <TabLinks active={tab} tabs={[['price', 'Price check', 'price-check'], ['stock', 'Stock check', 'stock-check'], ['soldout', 'Sold out', 'product-sold-out-toggle'], ['reservations', 'Reservations & queue', 'reservations-and-walk-in-queue'], ['override', 'Manager override', 'manager-pin-override']]} />
    {tab === 'price' ? <PriceCheck /> : tab === 'stock' ? <StockCheck /> : tab === 'soldout' ? <SoldOut /> : tab === 'reservations' ? <Reservations /> : <Override />}
  </div>;
}

function useCatalog() {
  const { db, outletId } = usePos();
  const [s, setS] = useState('');
  const list = db.products.filter(p => p.status === 'live' && db.outletProducts.some(x => x.productId === p.id && x.outletId === outletId) && (!s || (p.name + ' ' + p.sku).toLowerCase().includes(s.toLowerCase())));
  return { s, setS, list, input: <input className="search" style={{ height: 48, maxWidth: 420 }} autoFocus placeholder="Scan or search product" value={s} onChange={e => setS(e.target.value)} aria-label="Search product" /> };
}
function PriceCheck() {
  const { db, outletId } = usePos();
  const c = useCatalog();
  const [open, setOpen] = useState<string | null>(null);
  return <div className="stack">{c.input}
    <div className="card flat scroll-x"><table className="table"><thead><tr><th>Product</th><th className="hide-sm">SKU</th><th className="r">Menu</th><th className="r">Here</th><th>Status</th></tr></thead><tbody>
      {c.list.map(p => { const op = db.outletProducts.find(x => x.productId === p.id && x.outletId === outletId)!, here = priceAt(db, p, outletId), fl = flashPrice(db.promos, p.id);
        return [<tr key={p.id} className="click" onClick={() => setOpen(open === p.id ? null : p.id)}><td><b>{p.name}</b></td><td className="hide-sm mono">{p.sku}</td><td className="r num">{idr(p.basePrice)}</td>
          <td className="r num">{fl != null ? <>{idr(fl)} <Badge tone="accent">Flash</Badge></> : idr(here)}</td><td>{op.is86 ? <Badge tone="danger">Sold out</Badge> : <Badge tone="success">On sale</Badge>}</td></tr>,
        open === p.id && <tr key={p.id + 'm'}><td colSpan={5} style={{ height: 'auto', padding: 12 }}>{p.modifierGroupIds.length ? p.modifierGroupIds.map(id => db.modifierGroups.find(g => g.id === id)!).map(g => <div key={g.id} style={{ fontSize: 14 }}><b>{g.name}</b>{g.required ? ' (required)' : ''}: {g.options.map(o => o.name + (o.price ? ' +' + idr(o.price) : '')).join(' · ')}</div>) : <span className="muted">No options.</span>}</td></tr>];
      })}</tbody></table></div>
  </div>;
}
function StockCheck() {
  const { db, outletId } = usePos();
  const c = useCatalog();
  const lvl = (id: string) => stockLevel(db.movements, outletId, id);
  const shown = c.s ? c.list.slice(0, 6) : [];
  return <div className="stack">{c.input}
    {shown.map(p => { const rec = db.recipes.filter(r => r.productId === p.id);
      const can = rec.length ? Math.floor(Math.min(...rec.map(r => lvl(r.stockItemId) / r.qty))) : null;
      return <div key={p.id} className="card stack sm"><div className="row between"><b>{p.name}</b><Badge tone={can == null ? 'neutral' : can < 10 ? 'danger' : 'success'}>{can == null ? 'No recipe' : `Can make about ${Math.max(0, can)}`}</Badge></div>
        {rec.map(r => { const it = db.stockItems.find(s => s.id === r.stockItemId)!; return <Row key={r.stockItemId} l={`${it.name} · ${r.qty} ${it.unit} each`} v={`${lvl(it.id).toFixed(2)} ${it.unit}`} tone={lvl(it.id) < it.par ? 'var(--danger-fg)' : undefined} />; })}</div>; })}
    <div className="card flat scroll-x"><table className="table"><thead><tr><th>Stock item</th><th className="r">On hand</th><th className="r">Par</th><th>Status</th></tr></thead><tbody>
      {db.stockItems.map(s => { const l = lvl(s.id); return <tr key={s.id}><td>{s.name}</td><td className="r num">{l.toFixed(2)} {s.unit}</td><td className="r num">{s.par} {s.unit}</td><td>{l < s.par ? <Badge tone="danger" dot>Low</Badge> : <Badge tone="success" dot>OK</Badge>}</td></tr>; })}</tbody></table></div>
    <p className="faint" style={{ fontSize: 13 }}>Read-only. Counts and adjustments are done by the PIC in stock opname.</p>
  </div>;
}
function SoldOut() {
  const { db, outletId, me } = usePos();
  const can = usePerm(), flow = useApproval();
  const c = useCatalog();
  const sorted = [...c.list].sort((a, b) => Number(!!db.outletProducts.find(x => x.productId === b.id && x.outletId === outletId)?.is86) - Number(!!db.outletProducts.find(x => x.productId === a.id && x.outletId === outletId)?.is86));
  if (can('Mark item sold out') === 'n') return <Empty icon="shield-x" title="Sold-out is turned off for your role" />;
  if (flow.node) return <div className="card" style={{ maxWidth: 520 }}>{flow.node}</div>;
  return <div className="stack">{c.input}
    <p className="muted" style={{ fontSize: 14 }}>Sold out is per outlet and syncs to the QR menu, kiosk, waiter app and delivery apps.{can('Mark item sold out') === 'a' ? ' Your role needs the PIC’s PIN for each change.' : ''}</p>
    <div className="grid" style={{ ['--min' as string]: '260px', gap: 8 }}>{sorted.map(p => { const on = !!db.outletProducts.find(x => x.productId === p.id && x.outletId === outletId)?.is86;
      return <div key={p.id} className="row card tight" style={{ opacity: on ? .7 : 1, ...warnStyle(can('Mark item sold out')) }}><span style={{ width: 40, height: 40, borderRadius: 10, background: productImage(p), flex: 'none' }} />
        <span className="grow stack" style={{ gap: 0 }}><b style={{ fontSize: 14 }}>{p.name}</b><span className={on ? '' : 'muted'} style={{ fontSize: 13, color: on ? 'var(--danger-fg)' : undefined }}>{on ? 'Sold out' : 'Available'}</span></span>
        <Toggle on={on} label={`${p.name} sold out`} onChange={() => flow.verify('Mark item sold out', `${on ? 'Back in stock' : 'Sold out'} · ${p.name}`, by => { toggle86(outletId, p.id, by); toast(`${p.name} ${on ? 'available again' : 'sold out'}`); })} /></div>; })}</div>
    <span className="faint" style={{ fontSize: 13 }}>Signed in as {me.name}.</span>
  </div>;
}
function Reservations() {
  const { db, outletId, me, session, setCur, go } = usePos();
  const [name, setName] = useState(''), [phone, setPhone] = useState(''), [pax, setPax] = useState(2);
  const t0 = startOfDay();
  const list = db.reservations.filter(r => r.outletId === outletId && r.at >= t0 && r.at < t0 + 864e5).sort((a, b) => a.at - b.at);
  const seat = (r: typeof list[number]) => {
    setReservation(r.id, 'seated', me.id);
    const id = newOrder(outletId, me.id, 'pos', { type: 'dine', table: r.table || null, guests: r.guests, sessionId: session?.id ?? null, note: r.name });
    setCur(id); go(P(r.table ? 'register-order' : 'table-picker'));
  };
  return <div className="grid" style={{ ['--min' as string]: '320px', alignItems: 'start' }}>
    <div className="card stack"><h3>Today · {list.length}</h3>
      {list.length === 0 ? <p className="muted">No bookings today.</p> : list.map(r => <div key={r.id} className="row wrap" style={{ borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
        <b className="num" style={{ minWidth: 48 }}>{hhmm(r.at)}</b><span className="grow stack" style={{ gap: 0 }}><b>{r.name} · {r.guests} pax</b><span className="muted" style={{ fontSize: 13 }}>{r.table || 'Walk-in queue'}{r.deposit ? ' · deposit ' + idr(r.deposit) : ''}{r.phone ? ' · ' + r.phone : ''}</span></span>
        <Status s={r.status} />{r.status === 'booked' && <><button className="btn btn-primary btn-sm" onClick={() => seat(r)}>Seat</button><button className="btn btn-sm" onClick={() => setReservation(r.id, 'no_show', me.id)}>No-show</button></>}</div>)}</div>
    <form className="card stack" onSubmit={e => { e.preventDefault(); if (!name.trim()) return; addWalkIn(outletId, name.trim(), phone.trim(), pax, me.id); toast(`${name} added to the queue`); setName(''); setPhone(''); }}>
      <h3>Add walk-in to the queue</h3>
      <Field label="Name"><input className="input" value={name} onChange={e => setName(e.target.value)} /></Field>
      <Field label="Phone" optional><input className="input" inputMode="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="We’ll WhatsApp when the table is ready" /></Field>
      <div className="row between"><span>Guests</span><span className="row" style={{ gap: 4 }}><button type="button" className="btn icon-btn" onClick={() => setPax(Math.max(1, pax - 1))} aria-label="Fewer guests"><Icon name="minus" /></button><b className="num" style={{ minWidth: 28, textAlign: 'center' }}>{pax}</b><button type="button" className="btn icon-btn" onClick={() => setPax(pax + 1)} aria-label="More guests"><Icon name="plus" /></button></span></div>
      <button className="btn btn-primary btn-pos" disabled={!name.trim()}>Add to queue</button></form>
  </div>;
}
function Override() {
  const { db, outletId, me } = usePos();
  const can = usePerm(), flow = useApproval();
  const t0 = startOfDay();
  const waiting = db.approvals.filter(a => a.outletId === outletId && a.status === 'waiting' && a.requestedBy === me.id);
  const recent = db.audit.filter(a => a.outletId === outletId && (a.action === 'drawer.no_sale' || a.action.startsWith('approval.approved')) && a.at >= t0).slice(0, 10);
  if (flow.node) return <div className="card" style={{ maxWidth: 520 }}>{flow.node}</div>;
  return <div className="grid" style={{ ['--min' as string]: '320px', alignItems: 'start' }}>
    <div className="card stack"><h3>Override on this register</h3>
      <p className="muted" style={{ fontSize: 14 }}>The PIC or manager types their own approval PIN here. Every override is logged with both names.</p>
      {can('Open drawer without sale') !== 'n' && <button className="btn btn-pos" style={warnStyle(can('Open drawer without sale'))} onClick={() => flow.verify('Open drawer without sale', 'Open drawer · no sale', by => { const note = `by ${db.employees.find(e => e.id === by)?.name} for ${me.name}`; logDevice('drawer.no_sale', note, by, outletId); openDrawer(db, thisDevice(db), 'no_sale', note, by).then(r => toast(r.ok ? 'Drawer opened · logged' : r.message)); })}><Icon name="archive" />Open drawer without sale</button>}
      <span className="cap">Your requests waiting · {waiting.length}</span>
      {waiting.length === 0 ? <p className="muted">Nothing waiting.</p> : waiting.map(a => <div key={a.id} className="row"><span className="grow" style={{ fontSize: 14 }}>{a.title}<br /><span className="faint">{a.level.toUpperCase()} · {ago(a.at)}</span></span><button className="btn btn-sm" onClick={() => flow.resume(a.id, a.title, a.level)}>Enter PIN</button></div>)}
    </div>
    <div className="card stack"><h3>Today’s overrides</h3>{recent.length === 0 ? <p className="muted">None today.</p> : recent.map(a => <Row key={a.id} l={`${a.action === 'drawer.no_sale' ? 'No-sale drawer' : 'Approved'} · ${a.subject}`} v={hhmm(a.at)} />)}</div>
  </div>;
}
