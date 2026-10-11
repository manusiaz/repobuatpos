'use client';
// PIC floor: sold-out (86) list, stock requests + blind stock count (opname), incident log.
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { Opname } from '../../data/schema.ts';
import { requestApproval, startOpname, stockEntry, toggle86, updateOpnameLine } from '../../data/actions.ts';
import { isCounted, logIncident, opnamePhoto, recountLine, resendCount, submitCount } from '../../data/actions/pic.ts';
import { level as stockLevel, lineVariance, missingPhotos, opnameApprover, opnameVariance } from '../../domain/stock.ts';
import { idr } from '../../domain/money.ts';
import { usePin } from '../../ui/PinSheet.tsx';
import { Badge, Empty, Field, Icon, Seg, Status, hhmm, human, toast, dateShort } from '../../ui/kit.tsx';
import { allowed } from '../ops/perm.ts';
import { nameOf, startOfDay } from '../ops/shift.ts';
import type { PicCtx } from './ctx.ts';

export function SoldOut({ c }: { c: PicCtx }) {
  const { db, outletId, meId, user, me, outlet } = c;
  const [q, setQ] = useState(''), [cat, setCat] = useState('all');
  const items = db.outletProducts.filter(x => x.outletId === outletId && !x.hidden).map(x => ({ x, p: db.products.find(p => p.id === x.productId)! }))
    .filter(r => r.p && r.p.status === 'live' && (cat === 'all' || r.p.categoryId === cat) && r.p.name.toLowerCase().includes(q.toLowerCase()));
  const out = db.outletProducts.filter(x => x.outletId === outletId && x.is86).length;
  if (!allowed(db, user.role, me, 'Mark item sold out', outletId)) return <Empty icon="ban" title="Sold out is managed by the PIC and kitchen here" />;
  return <div className="stack">
    <div className="banner b-info">Sold out is per outlet. Tapping an item hides it at {outlet?.name} on the POS, QR menu, kiosk, waiter app and delivery apps. Kitchen sees the same list; other outlets keep selling.</div>
    <div className="row wrap between">
      <input className="search" style={{ maxWidth: 320, height: 44 }} placeholder="Search menu" value={q} onChange={e => setQ(e.target.value)} aria-label="Search menu" />
      <Badge tone={out ? 'danger' : 'success'}>{out} sold out</Badge>
    </div>
    <div className="row" style={{ overflowX: 'auto' }}>{[['all', 'All'], ...db.categories.map(k => [k.id, k.name])].map(([k, l]) => <button key={k} className="chip" aria-pressed={cat === k} onClick={() => setCat(k)}>{l}</button>)}</div>
    {items.length === 0 ? <Empty icon="search" title="No items match" /> : <div className="grid" style={{ ['--min' as string]: '200px', gap: 10 }}>
      {items.map(({ x, p }) => <button key={p.id} className="card tight stack sm" aria-pressed={x.is86} onClick={() => { toggle86(outletId, p.id, meId); toast(x.is86 ? `${p.name} back on sale` : `${p.name} sold out at ${outlet?.name}`); }}
        style={{ cursor: 'pointer', textAlign: 'left', minHeight: 72, borderColor: x.is86 ? 'var(--danger)' : undefined, background: x.is86 ? 'var(--danger-soft)' : undefined }}>
        <b>{p.name}</b><span className={x.is86 ? 'down' : 'up'} style={{ fontSize: 13, fontWeight: 600 }}>{x.is86 ? 'Sold out · tap to restock' : 'Available'}</span></button>)}
    </div>}
    <p className="faint" style={{ fontSize: 13 }}>Every change is logged with your name and time. Global items stay on the menu; only availability changes here.</p>
  </div>;
}

export function StockRequest({ c }: { c: PicCtx }) {
  const { db, outletId, meId } = c;
  const [item, setItem] = useState(''), [qty, setQty] = useState(''), [note, setNote] = useState('');
  const low = db.stockItems.map(s => ({ s, l: stockLevel(db.movements, outletId, s.id) })).filter(x => x.l < x.s.par);
  const it = db.stockItems.find(s => s.id === item), n = Number(qty);
  const reqs = db.approvals.filter(a => a.outletId === outletId && a.type === 'transfer').slice(0, 12);
  const send = () => {
    const r = requestApproval({ type: 'transfer', title: `Stock request · ${it!.name} ${n} ${it!.unit}`, amount: Math.round(n * it!.unitCost), requestedBy: meId, outletId, note: note.trim() || 'Running low on shift', payload: { stockItemId: it!.id, qty: n } });
    toast(`Request sent · ${r.level === 'owner' ? 'owner' : c.mgr?.name ?? 'manager'} decides`); setItem(''); setQty(''); setNote('');
  };
  return <div className="pic-2">
    <section className="card stack">
      <h3>Ask {c.mgr?.name ?? 'the manager'} for stock</h3>
      <Field label="Item"><select className="input" value={item} onChange={e => setItem(e.target.value)}><option value="">Pick an item</option>{db.stockItems.map(s => <option key={s.id} value={s.id}>{s.name} · {s.unit}</option>)}</select></Field>
      <Field label="Quantity" hint={it ? `≈ ${idr(Math.round((n || 0) * it.unitCost))}` : undefined}><input className="input" inputMode="decimal" value={qty} onChange={e => setQty(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="12" /></Field>
      <Field label="Note" optional><input className="input" value={note} onChange={e => setNote(e.target.value)} placeholder="Weekend rush, transfer from Kemang if possible" /></Field>
      <button className="btn btn-primary btn-pos" disabled={!it || !(n > 0)} onClick={send}>Send request</button>
      <Link href="/pic/floor/stock-opname" className="row" style={{ fontSize: 14 }}><Icon name="clipboard-list" size={16} />Counting a shelf? Start a blind stock count</Link>
    </section>
    <section className="stack">
      <div className="card stack">
        <h3>Below par now</h3>
        {low.length === 0 ? <p className="muted">Everything is above par.</p> : low.map(({ s, l }) => <div key={s.id} className="row"><span className="grow"><b>{s.name}</b><br /><span className="muted" style={{ fontSize: 13 }}>{+l.toFixed(2)} {s.unit} left · par {s.par}</span></span>
          <button className="btn btn-sm" onClick={() => { setItem(s.id); setQty(String(Math.max(1, Math.ceil(s.par * 2 - l)))); }}>Request</button></div>)}
      </div>
      <div className="card stack">
        <h3>My outlet’s requests</h3>
        {reqs.length === 0 ? <p className="muted">No stock requests yet.</p> : reqs.map(a => <div key={a.id} className="row" style={{ fontSize: 14 }}><span className="grow">{a.title}<br /><span className="faint">{nameOf(db, a.requestedBy)} · {dateShort(a.at)} {hhmm(a.at)}{a.decidedBy ? ' · ' + nameOf(db, a.decidedBy) : ''}</span></span><Status s={a.status} /></div>)}
      </div>
    </section>
  </div>;
}

// Bar / kitchen / storage split of the stock list; anything unmapped is counted in storage.
const AREAS: Record<string, string[]> = { Bar: ['beans', 'milk', 'oat', 'aren', 'matcha', 'tea', 'choco', 'pandan', 'cups'], Kitchen: ['rice', 'chicken', 'egg', 'butter'], Storage: [] };
const areaOf = (id: string) => Object.keys(AREAS).find(k => AREAS[k].includes(id)) ?? 'Storage';

/** Phone photos are shrunk before they go into the store (synced across tabs). */
async function shrink(f: File): Promise<string> {
  const url = URL.createObjectURL(f), img = new Image(); img.src = url;
  try { await img.decode(); const k = Math.min(1, 480 / Math.max(img.width, img.height)); const cv = document.createElement('canvas'); cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k); cv.getContext('2d')!.drawImage(img, 0, 0, cv.width, cv.height); return cv.toDataURL('image/jpeg', .72); }
  finally { URL.revokeObjectURL(url); }
}

export function StockCount({ c }: { c: PicCtx }) {
  const { db, outletId, meId, user, me } = c;
  const pin = usePin();
  const [area, setArea] = useState('Bar');
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [re, setRe] = useState<Record<string, string>>({});
  const op: Opname | undefined = db.opnames.filter(o => o.outletId === outletId && o.area === area).sort((a, b) => b.at - a.at)[0];
  useEffect(() => { setDraft({}); setRe({}); }, [op?.id]);
  const ids = db.stockItems.filter(s => areaOf(s.id) === area).map(s => s.id);
  const active = op && ['counting', 'locked', 'recount', 'submitted'].includes(op.status) ? op : undefined;
  const lines = active ? active.lines.filter(l => active.status === 'counting' ? ids.includes(l.stockItemId) : true) : [];
  const lock = !!active && active.status !== 'counting';
  const ap = active && db.approvals.filter(a => a.subjectId === active.id && a.type === 'opname').sort((a, b) => b.at - a.at)[0];
  const decision = op && db.approvals.filter(a => a.subjectId === op.id && a.type === 'opname' && a.status !== 'waiting').sort((a, b) => (b.decidedAt ?? 0) - (a.decidedAt ?? 0))[0];
  const need = lock ? missingPhotos(lines, active!.requirePhotoAll) : [];
  const filled = lines.filter(l => isCounted(l) || draft[l.stockItemId]).length;
  const value = opnameVariance(lines.filter(isCounted));
  const approver = { pic: 'Another PIC on shift signs', manager: `${c.mgr?.name ?? 'Manager'} verifies`, owner: 'Owner approves (over IDR 500k)', cashier: 'Signed' }[opnameApprover(lines.filter(isCounted))];
  const canCount = allowed(db, user.role, me, 'Count stock (opname)', outletId);
  const commitDraft = (id: string) => { const v = draft[id]; if (v == null || v === '' || !active) return; updateOpnameLine(active.id, id, { counted: Number(v) }, meId); };
  const photo = async (id: string, f?: File) => { if (!f || !active) return; opnamePhoto(active.id, id, await shrink(f), meId); toast('Photo added'); };
  const submit = () => { Object.keys(draft).forEach(commitDraft); pin.ask({ title: `${area} · ${lines.length} items`, verb: 'Sign & lock your count', detail: 'After this nobody can edit the count. Corrections are a recount and both counts are kept.', onOk: by => { const r = submitCount(active!.id, by); toast(r ? 'Count locked · add photos for differences' : 'Nothing counted'); } }); };
  const log = [...(db.records.opname_log ?? []).filter(r => op && r.a === op.id).map(r => ({ at: r.at, t: r.b })),
    ...db.approvals.filter(a => op && a.subjectId === op.id && a.decidedAt).map(a => ({ at: a.decidedAt!, t: `${human(a.status)} by ${nameOf(db, a.decidedBy)}${a.decisionNote ? ' · ' + a.decisionNote : ''}` }))].sort((a, b) => b.at - a.at);

  const note = !active ? (op?.status === 'posted' ? `Last count approved by ${nameOf(db, op.approvedBy)} · stock adjusted as an Opname adjustment.` : op?.status === 'rejected' ? `Last count was rejected${decision?.decisionNote ? ': ' + decision.decisionNote : ''}. Start a new count.` : 'Blind count: system quantities stay hidden until you submit. Count everything on the shelf, including opened packs.')
    : active.status === 'counting' ? 'Blind count: system quantities stay hidden until you submit. Count everything on the shelf, including opened packs.'
    : active.status === 'recount' ? `${nameOf(db, decision?.decidedBy)} asked for a recount${decision?.decisionNote ? ': ' + decision.decisionNote : ''}. Use Recount on the lines that look wrong, then send again. The first count stays in the history.`
    : need.length ? 'Locked. Add a photo for every line that differs. You can’t edit your count; corrections are a recount and both counts are kept.'
    : `Sent · ${approver}. Stock changes only after approval, as an Opname adjustment with your name, photos and time.`;

  return <div className="stack">
    {pin.sheet}
    <div className="row wrap between">
      <div className="row wrap">{Object.keys(AREAS).map(k => <button key={k} className="chip" aria-pressed={area === k} onClick={() => setArea(k)} style={{ height: 44 }}>{k} · {db.stockItems.filter(s => areaOf(s.id) === k).length}</button>)}</div>
      <div className="row">{['1 · Count', '2 · Photo proof', '3 · Approval'].map((l, i) => <Badge key={l} tone={(i === 0 && !lock) || (i === 1 && lock && need.length > 0) || (i === 2 && lock && !need.length) ? 'info' : 'neutral'}>{l}</Badge>)}</div>
    </div>
    <div className={'banner ' + (lock ? 'b-warning' : 'b-info')}>{note}</div>
    {!canCount ? <Empty icon="clipboard-list" title="Counting isn’t on for your role here" />
      : !active ? <div className="card"><Empty icon="clipboard-list" title={`Count the ${area.toLowerCase()} area`} action={<button className="btn btn-primary btn-pos" onClick={() => { startOpname(outletId, area, meId); toast(`${area} count started`); }}>Start blind count</button>}>{ids.length} items. You count, someone else signs.</Empty></div>
      : <section className="card flat">
        <div className="scroll-x"><table className="table">
          <thead><tr><th>Item</th><th>Counted</th><th>System</th><th>Difference</th><th>Photo</th></tr></thead>
          <tbody>{lines.map(l => { const it = db.stockItems.find(s => s.id === l.stockItemId)!; const d = isCounted(l) ? +(l.counted - l.systemQty).toFixed(2) : 0; const miss = need.includes(l);
            return <tr key={l.stockItemId} style={{ background: lock && d ? 'var(--warning-soft)' : undefined }}>
              <td><b>{it.name}</b><br /><span className="faint" style={{ fontSize: 12 }}>{it.unit} · {idr(it.unitCost)} / {it.unit}{l.recountOf ? ` · recount, first ${l.recountOf}` : ''}</span></td>
              <td>{!lock ? <input className="input" style={{ width: 110, height: 44 }} inputMode="decimal" placeholder="Count" aria-label={`Count of ${it.name}`}
                  value={draft[l.stockItemId] ?? (isCounted(l) ? String(l.counted) : '')} onChange={e => setDraft(x => ({ ...x, [l.stockItemId]: e.target.value.replace(/[^0-9.]/g, '') }))} onBlur={() => commitDraft(l.stockItemId)} />
                : active.status === 'recount' && re[l.stockItemId] != null ? <span className="row"><input className="input" style={{ width: 90, height: 44 }} inputMode="decimal" autoFocus value={re[l.stockItemId]} onChange={e => setRe(x => ({ ...x, [l.stockItemId]: e.target.value.replace(/[^0-9.]/g, '') }))} />
                  <button className="btn btn-sm" disabled={!re[l.stockItemId]} onClick={() => { recountLine(active.id, l.stockItemId, Number(re[l.stockItemId]), meId); setRe(x => { const y = { ...x }; delete y[l.stockItemId]; return y; }); }}>Save</button></span>
                : <span className="row"><b className="num">{l.counted} {it.unit}</b>{active.status === 'recount' && <button className="btn btn-sm btn-ghost" onClick={() => setRe(x => ({ ...x, [l.stockItemId]: String(l.counted) }))}>Recount</button>}</span>}</td>
              <td className={lock ? '' : 'faint'}>{lock ? `${l.systemQty} ${it.unit}` : 'Hidden'}</td>
              <td>{lock ? <b className={d < 0 ? 'down' : d > 0 ? 'up' : 'muted'}>{d > 0 ? '+' : ''}{d} {it.unit}{d ? ` · ${idr(lineVariance(l))}` : ''}</b> : '—'}</td>
              <td><span className="row">{l.photo && <img src={l.photo} alt={`Photo of ${it.name}`} width={40} height={40} style={{ borderRadius: 8, objectFit: 'cover' }} />}
                <label className={'btn btn-sm' + (miss ? ' btn-danger' : '')} style={{ cursor: 'pointer' }}><Icon name="camera" size={16} />{l.photo ? 'Retake' : 'Photo'}
                  <input type="file" accept="image/*" capture="environment" className="sr" onChange={e => photo(l.stockItemId, e.target.files?.[0])} /></label></span></td>
            </tr>; })}</tbody>
        </table></div>
        <div className="row wrap between" style={{ padding: 16, borderTop: '1px solid var(--border)' }}>
          <span className="stack" style={{ gap: 0 }}><span className="muted" style={{ fontSize: 12 }}>Variance value</span><b className="num" style={{ fontSize: 20 }}>{lock ? idr(value) : 'Hidden until submit'}</b></span>
          <span className="muted grow" style={{ fontSize: 13 }}>{lock ? approver + (ap ? ` · ${human(ap.status)}` : '') : `${filled} of ${lines.length} counted`}</span>
          {active.status === 'counting' && <button className="btn btn-primary btn-pos" disabled={filled < lines.length} onClick={submit}>{filled < lines.length ? 'Count every item first' : 'Submit & lock count'}</button>}
          {active.status === 'recount' && <button className="btn btn-primary btn-pos" disabled={need.length > 0} onClick={() => pin.ask({ title: `${area} recount`, verb: 'Sign & send again', onOk: by => { resendCount(active.id, by); toast('Sent again for approval'); } })}>{need.length ? `${need.length} photo${need.length > 1 ? 's' : ''} missing` : 'Send again'}</button>}
          {active.status === 'locked' && <Badge tone={need.length ? 'danger' : 'info'}>{need.length ? `${need.length} photo${need.length > 1 ? 's' : ''} missing` : 'Waiting for approval'}</Badge>}
        </div>
      </section>}
    {log.length > 0 && <section className="card stack sm"><h3>History · nothing is deleted</h3>{log.map((l, i) => <div key={i} className="row" style={{ fontSize: 13 }}><span className="faint mono">{hhmm(l.at)}</span><span className="grow">{l.t}</span></div>)}</section>}
  </div>;
}

const KINDS = [['complaint', 'Complaint'], ['breakage', 'Breakage'], ['comp', 'Comp']] as const;
export function Incidents({ c }: { c: PicCtx }) {
  const { db, outletId, meId, now } = c;
  const [kind, setKind] = useState<(typeof KINDS)[number][0]>('complaint');
  const [text, setText] = useState(''), [ref, setRef] = useState(''), [amt, setAmt] = useState(''), [item, setItem] = useState(''), [qty, setQty] = useState('');
  const rows = useMemo(() => (db.records.incident ?? []).filter(r => r.a === outletId).sort((a, b) => b.at - a.at).slice(0, 30), [db.records.incident, outletId]);
  const amount = Number(amt.replace(/\D/g, '')) || 0;
  const save = () => {
    logIncident(outletId, kind, (ref.trim() ? ref.trim() + ' · ' : '') + text.trim(), amount, meId);
    if (kind === 'breakage' && item && Number(qty) > 0) { const r = stockEntry('waste', outletId, item, Number(qty), 'Breakage · ' + text.trim(), meId); toast(`Logged · waste sent to ${r.level === 'pic' ? 'another PIC' : r.level}`); }
    else toast('Incident logged');
    setText(''); setRef(''); setAmt(''); setItem(''); setQty('');
  };
  const today = rows.filter(r => r.at >= startOfDay(now));
  return <div className="pic-2">
    <section className="card stack">
      <h3>Log an incident</h3>
      <Seg value={kind} onChange={setKind} options={KINDS} label="Kind" />
      <Field label="What happened"><textarea className="input" value={text} onChange={e => setText(e.target.value)} placeholder={kind === 'complaint' ? 'Croissant served cold, replaced' : kind === 'breakage' ? '2 glasses broken at the bar' : 'Free dessert for long wait'} /></Field>
      <Field label="Order or table" optional><input className="input" value={ref} onChange={e => setRef(e.target.value)} placeholder="T-04 or #2041" /></Field>
      {kind !== 'complaint' && <Field label={kind === 'comp' ? 'Value given (IDR)' : 'Cost (IDR)'} optional><input className="input" inputMode="numeric" value={amt} onChange={e => setAmt(e.target.value)} placeholder="0" /></Field>}
      {kind === 'breakage' && <div className="row wrap" style={{ alignItems: 'flex-end' }}>
        <div className="grow"><Field label="Write off stock" optional><select className="input" value={item} onChange={e => setItem(e.target.value)}><option value="">No stock item</option>{db.stockItems.map(s => <option key={s.id} value={s.id}>{s.name} · {s.unit}</option>)}</select></Field></div>
        <div style={{ width: 110 }}><Field label="Qty"><input className="input" inputMode="decimal" value={qty} onChange={e => setQty(e.target.value.replace(/[^0-9.]/g, ''))} /></Field></div>
      </div>}
      <button className="btn btn-primary btn-pos" disabled={!text.trim()} onClick={save}>Log incident</button>
    </section>
    <section className="card stack">
      <h3>Today · {today.length}</h3>
      {rows.length === 0 ? <p className="muted">No incidents logged. Complaints, breakages and comps on this shift go here and to the manager.</p>
        : rows.map(r => <div key={r.id} className="row" style={{ alignItems: 'flex-start', fontSize: 14 }}>
          <Badge tone={r.b === 'complaint' ? 'warning' : r.b === 'breakage' ? 'danger' : 'violet'}>{human(r.b)}</Badge>
          <span className="grow">{r.c}<br /><span className="faint">{nameOf(db, r.e)} · {r.at >= startOfDay(now) ? hhmm(r.at) : dateShort(r.at)}</span></span>
          {Number(r.d) > 0 && <b className="num">{idr(Number(r.d))}</b>}</div>)}
    </section>
  </div>;
}
