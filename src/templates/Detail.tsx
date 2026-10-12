'use client';
// DETAIL template: one record with key facts, tabs and activity. Opened by ?id= or the record picker.
import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useApp } from '../app/context.tsx';
import { Badge, Empty, Icon, Seg, Status, ago, hhmm, dateShort, toast } from '../ui/kit.tsx';
import { idr } from '../domain/money.ts';
import { balance, tierOf } from '../domain/loyalty.ts';
import { level as stockLevel } from '../domain/stock.ts';
import { priceAt } from '../data/actions.ts';
import { PageHead } from './common.tsx';
import { Letterhead } from './Letterhead.tsx';
import { viewFor } from './views.ts';

export default function Detail() {
  const { page, db, outletId, user } = useApp();
  const { key, view } = viewFor(page);
  const rows = view.rows({ db, outletId, role: user.role, page, all: true });
  const sp = useSearchParams();
  const [id, setId] = useState<string | null>(sp.get('id'));
  const [tab, setTab] = useState<'overview' | 'activity'>('overview');
  const row = rows.find(r => r.id === id) ?? rows[0];
  if (!row) return <><PageHead /><div className="card"><Empty title="Nothing to show yet">This detail opens from its list once a record exists.</Empty></div></>;
  const name = String(row.no ?? row.name ?? row.title ?? row.ref ?? row.id);
  const activity = db.audit.filter(a => a.subject === row.id || a.subject === name || a.subject === row.no).slice(0, 30);
  return <>
    <PageHead sub={<span className="row wrap">Showing <select className="input" style={{ height: 36, width: 'auto', fontSize: 14 }} value={row.id} onChange={e => setId(e.target.value)} aria-label="Record">{rows.slice(0, 200).map(r => <option key={r.id} value={r.id}>{String(r.no ?? r.name ?? r.title ?? r.ref ?? r.id)}</option>)}</select></span>}
      actions={<><button className="btn" onClick={() => { print(); }}><Icon name="printer" size={18} />Print</button>{/(po|supplier)/.test(key) && <button className="btn btn-primary" onClick={() => toast('Sent to supplier on WhatsApp')}><Icon name="send" size={18} />Send via WA</button>}</>} />
    <div className="grid" style={{ ['--min' as string]: '170px' }}>{view.cols.slice(1, 5).map(c => <div key={c.k} className="card tight stack" style={{ gap: 2 }}><span className="cap">{c.l}</span><b style={{ fontSize: 16 }}>{c.f === 'money' ? idr(Number(row[c.k])) : c.f === 'status' ? <Status s={String(row[c.k])} /> : c.f === 'time' ? dateShort(Number(row[c.k])) + ' ' + hhmm(Number(row[c.k])) : String(row[c.k] ?? '—')}</b></div>)}</div>
    <Seg value={tab} onChange={setTab} options={[['overview', 'Overview'], ['activity', `Activity · ${activity.length}`]] as const} />
    {tab === 'activity' ? <section className="card stack">{activity.length === 0 ? <p className="muted">No changes recorded for this record yet. Every change lands here from the audit log.</p> : activity.map(a => <div key={a.id} className="row between"><span><span className="mono">{a.action}</span> · {db.employees.find(e => e.id === a.actor)?.name ?? a.actor}</span><span className="faint">{ago(a.at)}</span></div>)}</section>
      : <section className="card stack">{/^(po|receipt|order|payment|supplier)$/.test(key) ? <Letterhead db={db}>{body(key)}</Letterhead> : body(key)}</section>}
  </>;

  function body(k: string): ReactNode {
    if (k === 'order' || k === 'payment') {
      const o = db.orders.find(x => x.id === row.id) ?? db.orders.find(x => db.payments.find(p => p.id === row.id)?.orderId === x.id);
      if (!o) return <p className="muted">Order not found.</p>;
      const pays = db.payments.filter(p => p.orderId === o.id), refs = db.refunds.filter(r => r.orderId === o.id);
      return <>
        <div className="row wrap"><Badge>{o.source}</Badge><Badge>{o.type}</Badge>{o.table && <Badge>{o.table}</Badge>}<Status s={o.status} /><span className="faint">{db.outlets.find(x => x.id === o.outletId)?.name} · cashier {db.employees.find(e => e.id === o.cashierId)?.name ?? '—'}</span></div>
        <table className="table"><tbody>{o.lines.map(l => <tr key={l.id}><td>{l.qty} × {l.name}{l.mods.length > 0 && <div className="faint" style={{ fontSize: 12 }}>{l.mods.map(m => m.name).join(', ')}</div>}</td><td className="r">{idr((l.flashPrice ?? l.unitPrice) * l.qty)}</td></tr>)}
          {([['Subtotal', o.subtotal], ['Discount', -o.discount], ['Service', o.service], ['Tax', o.tax], ['Total', o.total]] as const).filter(([, v]) => v).map(([l, v]) => <tr key={l}><td className={l === 'Total' ? '' : 'muted'} style={{ fontWeight: l === 'Total' ? 700 : 400 }}>{l}</td><td className="r" style={{ fontWeight: l === 'Total' ? 700 : 400 }}>{idr(v)}</td></tr>)}</tbody></table>
        <h3>Payments</h3>{pays.map(p => <div key={p.id} className="row between"><span className="row"><span className="mono">{p.ref}</span><Badge>{p.method}</Badge><Status s={p.status} /></span><b>{idr(p.amount)}</b></div>)}
        {refs.length > 0 && <><h3>Refunds</h3>{refs.map(r => <div key={r.id} className="row between"><span>{r.reason} · {ago(r.at)}</span><b className="down">{idr(-r.amount)}</b></div>)}</>}
        <div className="banner b-warning"><Icon name="info" size={18} />A paid order is never edited. Corrections are a refund requested at the POS and approved by the right level.</div>
      </>;
    }
    if (k === 'customer') { const c = db.customers.find(x => x.id === row.id)!; const os = db.orders.filter(o => o.customerId === c.id).slice(-10).reverse(); return <>
      <div className="row wrap"><Badge tone="accent">{tierOf(db.ledger, c.id).name}</Badge><b>{balance(db.ledger, c.id).toLocaleString('en-US')} beans</b><span className="mono">{c.phone}</span><Badge tone={c.optIn ? 'success' : 'neutral'}>{c.optIn ? 'WhatsApp opt-in' : 'No marketing'}</Badge>{c.deposit > 0 && <Badge tone="info">Deposit {idr(c.deposit)}</Badge>}{c.credit > 0 && <Badge tone="warning">Kasbon {idr(c.credit)}</Badge>}</div>
      <h3>Recent orders</h3>{os.length ? os.map(o => <Link key={o.id} href={'/owner/sales/transaction-detail?id=' + o.id} className="row between"><span>{o.no} · {dateShort(o.createdAt)}</span><b>{idr(o.total)}</b></Link>) : <p className="muted">No orders yet.</p>}
      <h3>Beans ledger</h3>{db.ledger.filter(l => l.customerId === c.id).slice(-8).reverse().map((l, i) => <div key={i} className="row between"><span>{l.reason}</span><b className={l.points < 0 ? 'down' : 'up'}>{l.points > 0 ? '+' : ''}{l.points}</b></div>)}</>; }
    if (k === 'employee') { const e = db.employees.find(x => x.id === row.id)!; const ss = db.sessions.filter(s => s.cashierId === e.id); return <>
      <div className="row wrap"><Badge>{e.role}</Badge><span>{e.outlets.map(o => db.outlets.find(x => x.id === o)?.name).join(', ')}</span><span className="mono">{e.phone}</span></div>
      <h3>Drawer sessions</h3>{ss.length ? ss.map(s => <div key={s.id} className="row between"><span className="mono">{s.id}</span><Status s={s.status} /><span>{s.variance != null ? 'Variance ' + idr(s.variance) : 'Open'}</span></div>) : <p className="muted">No drawer sessions.</p>}
      <h3>Clock events</h3>{db.clock.filter(c => c.employeeId === e.id).slice(-8).reverse().map(c => <div key={c.id} className="row between"><span>{c.kind}</span><span className="faint">{ago(c.at)}</span></div>)}
      <Link className="btn" href="/owner/team/employee-pin-and-access-reset">Reset PIN & access</Link></>; }
    if (k === 'product') { const p = db.products.find(x => x.id === row.id)!; return <>
      <div className="row wrap"><Badge tone={p.scope === 'global' ? 'accent' : 'info'}>{p.scope === 'global' ? 'All outlets' : db.outlets.find(o => o.id === p.ownerOutletId)?.name + ' only'}</Badge><Status s={p.status} /><span className="mono">{p.sku}</span></div>
      <table className="table"><thead><tr><th>Outlet</th><th className="r">Price</th><th>Sold out</th><th className="r">Sold · 14 days</th></tr></thead><tbody>{db.outlets.map(o => { const op = db.outletProducts.find(x => x.productId === p.id && x.outletId === o.id); const sold = db.orders.filter(x => x.outletId === o.id && x.status === 'paid').reduce((a, x) => a + x.lines.filter(l => l.productId === p.id).reduce((b, l) => b + l.qty, 0), 0); return <tr key={o.id}><td>{o.name}</td><td className="r">{op ? idr(priceAt(db, p, o.id)) : '—'}</td><td>{op?.is86 ? <Badge tone="danger">86</Badge> : op ? 'Available' : 'Not listed'}</td><td className="r">{sold}</td></tr>; })}</tbody></table>
      <h3>Recipe</h3>{db.recipes.filter(r => r.productId === p.id).map(r => { const s = db.stockItems.find(x => x.id === r.stockItemId)!; return <div key={r.stockItemId} className="row between"><span>{s.name}</span><span>{r.qty} {s.unit} · {idr(Math.round(r.qty * s.unitCost))}</span></div>; })}</>; }
    if (k === 'po' || k === 'receipt') { const po = db.pos.find(x => x.id === row.id); if (!po) return null; return <>
      <table className="table"><thead><tr><th>Item</th><th className="r">Ordered</th><th className="r">Received</th><th className="r">Price</th></tr></thead><tbody>{po.lines.map(l => { const s = db.stockItems.find(x => x.id === l.stockItemId)!; return <tr key={l.stockItemId}><td>{s.name}</td><td className="r">{l.qty} {s.unit}</td><td className="r">{l.received}</td><td className="r">{idr(l.qty * l.price)}</td></tr>; })}</tbody></table>
      <Link className="btn btn-primary" href="/owner/inventory/goods-receipt">Receive goods</Link></>; }
    if (k === 'supplier') { const s = db.suppliers.find(x => x.id === row.id)!; return <>{db.pos.filter(p => p.supplierId === s.id).map(p => <div key={p.id} className="row between"><span className="mono">{p.no}</span><Status s={p.status} /><b>{idr(p.lines.reduce((a, l) => a + l.qty * l.price, 0))}</b></div>)}
      <h3>Price history</h3>{db.pos.filter(p => p.supplierId === s.id).flatMap(p => p.lines.map(l => <div key={p.id + l.stockItemId} className="row between"><span>{db.stockItems.find(x => x.id === l.stockItemId)?.name}</span><span>{idr(l.price)} · {dateShort(p.at)}</span></div>))}</>; }
    if (k === 'adjust') return <><p>{String(row.title)}</p><p className="muted">{String(row.note ?? '')}</p><p className="muted">Stock moves only after approval, as a stock movement linked to this request.</p></>;
    return <div className="stack">{view.cols.map(c => <div key={c.k} className="row between"><span className="muted">{c.l}</span><span>{String(row[c.k] ?? '—')}</span></div>)}{key === 'stock' && <span>{stockLevel(db.movements, outletId, String(row.id))}</span>}</div>;
  }
}
