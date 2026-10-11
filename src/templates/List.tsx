'use client';
// LIST template: index of records. Filter, search, select, act. Actions depend on where the data comes from (page mode).
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useApp } from '../app/context.tsx';
import { PAGES } from '../system/registry.ts';
import { isGated } from '../system/access.ts';
import { Badge, Empty, Field, Icon, Seg, Sheet, toast } from '../ui/kit.tsx';
import { usePin } from '../ui/PinSheet.tsx';
import { decide, escalate, receivePO, replyReview, requestPrice, resendMessage, toggle86, hideAtOutlet } from '../data/actions.ts';
import { localPriceAllowed } from '../domain/menu.ts';
import { canDecide, type Level } from '../domain/approval.ts';
import { idr } from '../domain/money.ts';
import { PageHead, cell, isRight, downloadCSV } from './common.tsx';
import { viewFor, type FieldDef, type Row } from './views.ts';
import { saveRow, removeRow } from './actions.ts';

const PAGE = 50;
const PROMO_FORM: FieldDef[] = [{ k: 'name', l: 'Promo name', req: true }, { k: 'code', l: 'Voucher code' }, { k: 'kind', l: 'Type', type: 'select', options: [['pct', 'Percent off'], ['amount', 'Amount off']] }, { k: 'value', l: 'Value (% or IDR)', type: 'number', req: true }, { k: 'minSpend', l: 'Minimum spend', type: 'money' }];

export default function List({ readOnly }: { readOnly?: boolean }) {
  const app = useApp();
  const { page, db, user, outletId } = app;
  const { key, view } = viewFor(page);
  const [all, setAll] = useState(user.role === 'owner');
  const [q, setQ] = useState(''), [chip, setChip] = useState('All'), [n, setN] = useState(PAGE);
  const [sheet, setSheet] = useState<{ mode: 'new' | 'edit' | 'view'; row: Row | null } | null>(null);
  const pin = usePin();
  const gated = isGated(user.role, page) && page.mode !== 'approve';
  const myLevel: Level = user.role === 'owner' || user.role === 'manager' || user.role === 'pic' ? user.role : 'cashier';
  const ctx = { db, outletId, role: user.role, page, all };
  const rows0 = useMemo(() => view.rows(ctx), [db, outletId, all, page.path]); // eslint-disable-line react-hooks/exhaustive-deps
  const sk = view.status;
  const chips = sk ? ['All', ...Array.from(new Set(rows0.map(r => String(r[sk])))).slice(0, 6)] : [];
  const rows = rows0.filter(r => (chip === 'All' || String(r[sk!]) === chip) && (!q || Object.values(r).join(' ').toLowerCase().includes(q.toLowerCase())));
  const mode = readOnly ? 'read' : page.mode;
  const form = key === 'promo' ? PROMO_FORM : view.form;
  const canCreate = mode === 'edit' && !!form && (user.role === 'owner' || user.role === 'manager');
  const formPage = PAGES.find(p => p.template === 'form' && p.object === page.object && p.role === page.role);

  const approve = (r: Row, verdict: 'approved' | 'rejected' | 'recount') => pin.ask({ title: String(r.title ?? r.area), verb: verdict === 'approved' ? 'Approve with your PIN' : verdict === 'rejected' ? 'Reject with your PIN' : 'Ask for a recount',
    onOk: by => { const id = key === 'opname' ? db.approvals.find(a => a.subjectId === r.id && a.status === 'waiting')?.id : r.id; const e = id ? decide(id, by, verdict) : 'No open approval for this count'; toast(e ?? (verdict === 'approved' ? 'Approved · applied everywhere' : verdict === 'rejected' ? 'Rejected · requester notified' : 'Recount requested')); } });

  const rowActions = (r: Row) => {
    const a: React.ReactNode[] = [];
    if (key === 'approvals' && r.status === 'waiting' && !canDecide({ level: r.level as Level, requestedBy: String(r.requestedBy) }, { id: user.id, level: myLevel })) {
      a.push(<Badge key="lv" tone="info">{r.requestedBy === user.id ? 'Your request' : `Waits for ${r.level}`}</Badge>);
    } else if (key === 'approvals' && r.status === 'waiting') {
      a.push(<button key="ok" className="btn btn-success btn-sm" disabled={r.requestedBy === user.id} title={r.requestedBy === user.id ? 'You can’t decide your own request' : ''} onClick={() => approve(r, 'approved')}>Approve</button>);
      a.push(<button key="no" className="btn btn-sm" onClick={() => approve(r, 'rejected')}>Reject</button>);
      if (r.level !== 'owner') a.push(<button key="up" className="btn btn-ghost btn-sm" onClick={() => { escalate(r.id, user.id); toast('Escalated'); }}>Escalate</button>);
    }
    if (key === 'opname' && r.status === 'locked') { a.push(<button key="ok" className="btn btn-success btn-sm" onClick={() => approve(r, 'approved')}>Sign</button>); a.push(<button key="rc" className="btn btn-sm" onClick={() => approve(r, 'recount')}>Recount</button>); }
    if (key === 'sold86') a.push(<button key="86" className="btn btn-sm" onClick={() => { toggle86(String(r.oid), String(r.pid), user.id); toast('Synced to POS, KDS, QR menu, kiosk and delivery apps'); }}>{r.status === 'Sold out' ? 'Back in stock' : 'Mark sold out'}</button>);
    if (key === 'po' && ['sent', 'partial'].includes(String(r.status))) a.push(<button key="rcv" className="btn btn-primary btn-sm" onClick={() => setSheet({ mode: 'view', row: { ...r, receive: true } })}>Receive</button>);
    if (key === 'review' && !r.reply) a.push(<button key="rep" className="btn btn-primary btn-sm" onClick={() => setSheet({ mode: 'view', row: { ...r, replying: true } })}>Reply</button>);
    if (key === 'messaging' && r.status === 'failed') a.push(<button key="rt" className="btn btn-sm" onClick={() => { resendMessage(r.id, user.id); toast('Resent'); }}>Retry</button>);
    if ((key === 'online' || key === 'readyby' || key === 'pickup') && ['open', 'sent', 'preparing', 'ready'].includes(String(r.status))) a.push(<Link key="go" className="btn btn-sm" href="/online">Open inbox</Link>);
    if (key === 'price') a.push(<button key="pr" className="btn btn-sm" onClick={() => setSheet({ mode: 'view', row: { ...r, pricing: true } })}>Change price</button>);
    if (key === 'product' && user.role === 'manager' && r.scope === 'All outlets') a.push(<button key="hide" className="btn btn-ghost btn-sm" onClick={() => { const op = db.outletProducts.find(x => x.productId === r.id && x.outletId === outletId); hideAtOutlet(r.id, outletId, !op?.hidden, user.id); toast(op?.hidden ? 'Shown again at your outlet' : 'Hidden at your outlet only'); }}>{db.outletProducts.find(x => x.productId === r.id && x.outletId === outletId)?.hidden ? 'Unhide' : 'Hide here'}</button>);
    return a;
  };

  return <>
    <PageHead actions={<>
      {user.role === 'owner' && <Seg value={all ? 'all' : 'one'} onChange={v => setAll(v === 'all')} options={[['all', 'All outlets'], ['one', db.outlets.find(o => o.id === outletId)?.name ?? 'Outlet']] as const} label="Scope" />}
      <button className="btn" onClick={() => { downloadCSV(page.title, view.cols, rows); toast('Exported ' + rows.length + ' rows · CSV'); }}><Icon name="download" size={18} />Export</button>
      {!canCreate && mode === 'edit' && formPage && <Link className="btn btn-primary" href={formPage.path}><Icon name="plus" size={18} />New</Link>}
      {canCreate && <button className="btn btn-primary" onClick={() => setSheet({ mode: 'new', row: null })}><Icon name="plus" size={18} />{gated ? 'Request new' : 'New'}</button>}
      {mode === 'incoming' && (key === 'online') && <Link className="btn btn-primary" href="/online">Open online inbox</Link>}
      {key === 'opname' && <Link className="btn btn-primary" href="/pic/floor/stock-opname">Count on PIC tablet</Link>}
    </>} />
    <div className="row wrap" style={{ gap: 8 }}>
      <input className="search" style={{ maxWidth: 320 }} placeholder={`Search ${rows0.length} rows`} value={q} onChange={e => { setQ(e.target.value); setN(PAGE); }} aria-label="Search" />
      <div className="row" style={{ overflowX: 'auto', gap: 6 }}>{chips.map(c => <button key={c} className="chip" aria-pressed={chip === c} onClick={() => setChip(c)}>{c.replace(/_/g, ' ')}</button>)}</div>
      <span className="faint grow" style={{ textAlign: 'right', fontSize: 13 }}>{rows.length} of {rows0.length}</span>
    </div>
    {rows0.length === 0 ? <div className="card"><Empty icon={mode === 'approve' ? 'check-check' : 'inbox'} title={mode === 'approve' ? 'Nothing waiting for you' : 'Nothing here yet'}>{mode === 'record' ? 'These are created at the POS. They appear here the moment a cashier rings one up.' : mode === 'incoming' ? 'Incoming items from guests and delivery apps land here.' : canCreate ? 'Add the first one.' : 'Data appears as soon as it happens.'}</Empty>{canCreate && <div className="row" style={{ justifyContent: 'center' }}><button className="btn btn-primary" onClick={() => setSheet({ mode: 'new', row: null })}>New</button></div>}</div>
      : rows.length === 0 ? <div className="card"><Empty icon="search-x" title="No results">Try another search or filter.</Empty></div>
      : <div className="card flat">
        <div className="scroll-x hide-sm"><table className="table">
          <thead><tr>{view.cols.map(c => <th key={c.k} className={isRight(c) ? 'r' : ''}>{c.l}</th>)}<th /></tr></thead>
          <tbody>{rows.slice(0, n).map(r => <tr key={r.id} className="click" onClick={() => setSheet({ mode: mode === 'edit' && form ? 'edit' : 'view', row: r })}>
            {view.cols.map(c => <td key={c.k} className={isRight(c) ? 'r' : ''}>{cell(c, r[c.k])}</td>)}
            <td className="r" onClick={e => e.stopPropagation()}><div className="row" style={{ justifyContent: 'flex-end' }}>{rowActions(r)}</div></td>
          </tr>)}</tbody>
        </table></div>
        <div className="stack only-sm" style={{ padding: 12, gap: 8 }}>{rows.slice(0, n).map(r => <div key={r.id} className="sunken stack sm" onClick={() => setSheet({ mode: mode === 'edit' && form ? 'edit' : 'view', row: r })}>
          <div className="row between"><b>{cell(view.cols[0], r[view.cols[0].k])}</b>{cell(view.cols[view.cols.length - 1], r[view.cols[view.cols.length - 1].k])}</div>
          <div className="row wrap muted" style={{ fontSize: 13 }}>{view.cols.slice(1, -1).map(c => <span key={c.k}>{cell(c, r[c.k])}</span>)}</div>
          <div className="row wrap" onClick={e => e.stopPropagation()}>{rowActions(r)}</div>
        </div>)}</div>
        {rows.length > n && <div className="row" style={{ justifyContent: 'center', padding: 12 }}><button className="btn" onClick={() => setN(n + PAGE)}>Show {Math.min(PAGE, rows.length - n)} more</button></div>}
      </div>}
    <RecordSheet sheet={sheet} close={() => setSheet(null)} form={form} cols={view.cols} k={key} gated={gated} canDelete={mode === 'edit' && (!!view.rec || key === 'product')} />
    {pin.sheet}
  </>;
}

function RecordSheet({ sheet, close, form, cols, k, gated, canDelete }: { sheet: { mode: 'new' | 'edit' | 'view'; row: Row | null } | null; close: () => void; form?: FieldDef[]; cols: { k: string; l: string; f?: string }[]; k: string; gated: boolean; canDelete: boolean }) {
  const { db, user, outletId, page } = useApp();
  const r = sheet?.row ?? null;
  const init = () => { const f: Record<string, string> = {}; if (r && form) { const src = k === 'product' ? db.products.find(p => p.id === r.id) : k === 'supplier' ? db.suppliers.find(s => s.id === r.id) : k === 'employee' ? db.employees.find(e => e.id === r.id) : k === 'promo' ? db.promos.find(p => p.id === r.id) : r; form.forEach(x => { f[x.k] = String((src as Record<string, unknown> | undefined)?.[x.k] ?? ''); }); } return f; };
  const [f, setF] = useState<Record<string, string>>({}), [touched, setTouched] = useState(false), [text, setText] = useState(''), [rcv, setRcv] = useState<Record<string, number>>({});
  const [lastRow, setLastRow] = useState<Row | null>(null);
  if (sheet && r !== lastRow) { setLastRow(r); setF(init()); setTouched(false); setText(''); setRcv({}); }
  if (!sheet) return null;
  const editing = sheet.mode !== 'view' && form;
  const missing = editing ? form!.filter(x => x.req && !f[x.k]?.trim()) : [];
  const save = () => { setTouched(true); if (missing.length) return; toast(saveRow(k, f, sheet.mode === 'edit' ? r : null, { db, by: user.id, role: user.role, outletId, gated })); close(); };

  if (r?.receive) { const po = db.pos.find(p => p.id === r.id)!; return <Sheet open onClose={close} title={'Receive ' + po.no} sub="Counts what arrived. Stock moves as a goods receipt; short deliveries stay open as partial." footer={<><button className="btn" onClick={close}>Cancel</button><button className="btn btn-primary" onClick={() => { receivePO(po.id, rcv, user.id); toast('Received · stock updated'); close(); }}>Confirm receipt</button></>}>
    <div className="stack">{po.lines.map(l => { const it = db.stockItems.find(s => s.id === l.stockItemId)!; return <Field key={l.stockItemId} label={`${it.name} (${it.unit})`} hint={`ordered ${l.qty} · received ${l.received}`}><input className="input" type="number" inputMode="decimal" min={0} max={l.qty - l.received} value={rcv[l.stockItemId] ?? l.qty - l.received} onChange={e => setRcv({ ...rcv, [l.stockItemId]: Number(e.target.value) })} /></Field>; })}</div></Sheet>; }
  if (r?.replying) return <Sheet open onClose={close} title={'Reply to ' + r.name} sub={String(r.text)} footer={<button className="btn btn-primary" disabled={!text.trim()} onClick={() => { replyReview(r.id, text, user.id); toast('Reply posted · reviews can’t be edited or deleted'); close(); }}>Post reply</button>}><Field label="Your reply"><textarea className="input" value={text} onChange={e => setText(e.target.value)} placeholder="Thank the guest, say what you changed." /></Field></Sheet>;
  if (r?.pricing) {
    const p = db.products.find(x => x.id === r.pid)!, v = Number(text || r.price), oid = db.outlets.find(o => o.name === r.outlet)?.id;
    const ok = localPriceAllowed(p.basePrice, v, db.tenant.locks) || v === p.basePrice;
    return <Sheet open onClose={close} title={'Price · ' + p.name + ' · ' + r.outlet} sub={`Base ${idr(p.basePrice)}. Outlet price must stay within ±10%${db.tenant.locks.menuPrices ? ' — blocked: franchise lock “Menu prices” is on' : ''}.`}
      footer={<button className="btn btn-primary" disabled={!ok} onClick={() => { const res = requestPrice(p.id, v, user.id, oid); toast(res ? 'Price change sent to owner' : 'Price updated on every channel at ' + r.outlet); close(); }}>{user.role === 'owner' ? 'Save price' : 'Send to owner'}</button>}>
      <Field label="Outlet price (IDR)" error={ok ? undefined : 'Outside ±10% of base, or prices are locked'}><input className="input" inputMode="numeric" value={text || String(r.price)} onChange={e => setText(e.target.value.replace(/\D/g, ''))} /></Field>
    </Sheet>;
  }
  return <Sheet open onClose={close} title={sheet.mode === 'new' ? 'New · ' + page.title : String(r?.[cols[0].k] ?? r?.name ?? r?.title ?? 'Record')}
    sub={editing ? (gated ? 'You are signed in as manager. This goes to the owner for approval, then updates every connected page.' : 'Saving updates every connected app right away and is logged in the audit log.') : undefined}
    footer={editing ? <>{sheet.mode === 'edit' && canDelete && <button className="btn btn-danger" onClick={() => { toast(removeRow(k, r!, user.id)); close(); }} style={{ marginRight: 'auto' }}>{k === 'product' ? 'Archive' : 'Delete'}</button>}<button className="btn" onClick={close}>Cancel</button><button className="btn btn-primary" onClick={save}>{gated ? 'Send to owner' : 'Save'}</button></> : undefined}>
    {editing ? <div className="stack">
      {form!.map(x => <Field key={x.k} label={x.l} optional={!x.req} hint={x.hint} error={touched && x.req && !f[x.k]?.trim() ? 'Required' : undefined}>
        {x.type === 'select' ? <select className="input" value={f[x.k] ?? ''} onChange={e => setF({ ...f, [x.k]: e.target.value })}><option value="">Choose…</option>{x.options!.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          : x.type === 'textarea' ? <textarea className="input" value={f[x.k] ?? ''} onChange={e => setF({ ...f, [x.k]: e.target.value })} />
          : <input className={'input' + (touched && x.req && !f[x.k]?.trim() ? ' bad' : '')} inputMode={x.type === 'money' || x.type === 'number' ? 'numeric' : undefined} value={f[x.k] ?? ''} onChange={e => setF({ ...f, [x.k]: e.target.value })} />}
      </Field>)}
      {k === 'product' && sheet.mode === 'new' && user.role === 'manager' && <label className="row"><input type="checkbox" checked={f.promote === 'yes'} onChange={e => setF({ ...f, promote: e.target.checked ? 'yes' : '' })} />Propose for all outlets (owner decides)</label>}
      {k === 'product' && <div className="banner b-info">{user.role === 'owner' ? 'Owner items are added to all outlets. Outlets can mark them sold out or set a local price within ±10%, never delete them.' : 'Manager items are outlet-only and wait for the owner. Until approved they are hidden from guests and the POS.'}</div>}
    </div> : <div className="stack">
      {r && cols.map(c => <div key={c.k} className="row between" style={{ borderBottom: '1px solid var(--border)', paddingBottom: 8 }}><span className="muted">{c.l}</span><span>{cell(c as never, r[c.k])}</span></div>)}
      {r?.note ? <p className="muted">Note: {String(r.note)}</p> : null}
      {page.mode === 'record' && <div className="banner b-warning"><Icon name="info" size={18} />Created at the POS. Corrections are a void or refund requested at the register, never an edit here.</div>}
      {page.mode === 'incoming' && <Badge tone="info">Incoming · accept, update status or reply only</Badge>}
    </div>}
  </Sheet>;
}
