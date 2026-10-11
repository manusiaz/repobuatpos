'use client';
// Workspace, governance, industry templates and customization rules. Dashboards and analytics read real orders;
// approvals go through requestApproval / decide with the approver's PIN; franchise locks through setLocks (owner only).
import { useMemo, useState, type DragEvent } from 'react';
import { decide, deleteRecord, saveRecord, setLocks, setSetting } from '../../data/actions.ts';
import type { Approval, DB } from '../../data/schema.ts';
import { idr, idrShort } from '../../domain/money.ts';
import { level as stockLevel } from '../../domain/stock.ts';
import { Badge, Empty, Icon, Kpi, Seg, Status, Toggle, ago, dateShort, toast } from '../../ui/kit.tsx';
import { LineChart } from '../../ui/Chart.tsx';
import { usePin } from '../../ui/PinSheet.tsx';
import { Caption, contrast, copy, CopyRow, F, outletName, pct, Phone, PLAN_LABEL, PLAN_RANK, planLocked, Stage, themePairs, type Ctx, type Plan, type PP, type Tool, type V } from './core.tsx';

const DAY = 864e5;
const t0 = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };
const paid = (db: DB, outletId: string | null, from: number, to = Infinity) => db.orders.filter(o => o.status === 'paid' && (!outletId || o.outletId === outletId) && o.createdAt >= from && o.createdAt < to);

// ── Dashboard widgets ────────────────────────────────────────────────────────────────────
const WG: [string, string][] = [['w_rev', 'Revenue today'], ['w_live', 'Live orders'], ['w_trend', 'Revenue trend'], ['w_mix', 'Payment mix'], ['w_top', 'Top products'], ['w_stock', 'Low stock'], ['w_staff', 'Staff on shift'], ['w_alert', 'Alerts']];
const ROLE_DEF: Record<string, string[]> = { owner: ['w_rev', 'w_live', 'w_trend', 'w_mix', 'w_top', 'w_stock', 'w_alert'], manager: ['w_rev', 'w_live', 'w_trend', 'w_stock', 'w_staff', 'w_alert'], pic: ['w_live', 'w_stock', 'w_staff', 'w_alert'], cashier: ['w_live', 'w_top'] };
const listOf = (v: V) => (v['on:' + v.role] as string[] | undefined) ?? ROLE_DEF[v.role];
function WidgetsPanel({ v, set }: PP) {
  const on = listOf(v), off = WG.map(w => w[0]).filter(k => !on.includes(k));
  const move = (k: string, d: number) => { const o = [...on], i = o.indexOf(k), j = i + d; if (j < 0 || j >= o.length) return; [o[i], o[j]] = [o[j], o[i]]; set('on:' + v.role, o); };
  return <div className="stack">
    <div className="field"><label>Role</label><Seg value={v.role} options={[['owner', 'Owner'], ['manager', 'Manager'], ['pic', 'PIC'], ['cashier', 'Cashier']] as const} onChange={r => set('role', r)} /></div>
    <div className="field"><label>Columns</label><Seg value={String(v.cols)} options={[['2', '2'], ['3', '3'], ['4', '4']] as const} onChange={c => set('cols', Number(c))} /></div>
    <span className="cap">Shown, in order</span>
    {on.map((k, i) => <div key={k} className="row" style={{ minHeight: 44 }}><span className="grow">{WG.find(w => w[0] === k)?.[1]}</span>
      <button className="btn btn-ghost btn-sm" disabled={!i} onClick={() => move(k, -1)} aria-label="Move up"><Icon name="arrow-up" size={16} /></button>
      <button className="btn btn-ghost btn-sm" disabled={i === on.length - 1} onClick={() => move(k, 1)} aria-label="Move down"><Icon name="arrow-down" size={16} /></button>
      <Toggle on onChange={() => set('on:' + v.role, on.filter(x => x !== k))} label={'Hide ' + k} /></div>)}
    {off.length > 0 && <span className="cap">Hidden</span>}
    {off.map(k => <div key={k} className="row between" style={{ minHeight: 44 }}><span className="muted">{WG.find(w => w[0] === k)?.[1]}</span><Toggle on={false} onChange={() => set('on:' + v.role, [...on, k])} label={'Show ' + k} /></div>)}
    <p className="faint" style={{ fontSize: 13 }}>Drag widgets in the preview to reorder.</p>
  </div>;
}
function widgetValue(k: string, x: Ctx, role: string) {
  const db = x.db, scope = role === 'owner' ? null : x.outletId, today = paid(db, scope, t0());
  switch (k) {
    case 'w_rev': return [idrShort(today.reduce((a, o) => a + o.total, 0)), `${today.length} orders`];
    case 'w_live': return [String(db.orders.filter(o => (!scope || o.outletId === scope) && ['open', 'sent', 'preparing', 'ready'].includes(o.status)).length) + ' open', 'all channels'];
    case 'w_mix': { const ps = db.payments.filter(p => p.status === 'settled' && p.at >= t0() && (!scope || p.outletId === scope)); const by = ps.reduce<Record<string, number>>((a, p) => ((a[p.method] = (a[p.method] ?? 0) + p.amount), a), {}); const top = Object.entries(by).sort((a, b) => b[1] - a[1])[0]; const sum = ps.reduce((a, p) => a + p.amount, 0); return top ? [`${top[0].toUpperCase()} ${pct(top[1], sum)}%`, `${Object.keys(by).length} methods`] : ['—', 'no payments yet']; }
    case 'w_top': { const q: Record<string, number> = {}; today.forEach(o => o.lines.forEach(l => (q[l.name] = (q[l.name] ?? 0) + l.qty))); const top = Object.entries(q).sort((a, b) => b[1] - a[1])[0]; return top ? [top[0], `${top[1]} sold today`] : ['—', 'no sales yet']; }
    case 'w_stock': { const n = db.stockItems.filter(s => stockLevel(db.movements, x.outletId, s.id) < s.par).length; return [`${n} items`, 'below par at ' + outletName(db, x.outletId)]; }
    case 'w_staff': { const r = db.roster.find(y => y.outletId === x.outletId && y.day === (new Date().getDay() + 6) % 7); const h = new Date().getHours(), s = r?.slots[h < 12 ? 'pagi' : h < 17 ? 'siang' : 'malam']; return [`${s ? s.crew.length + 1 : 0} on shift`, s ? 'PIC ' + (db.employees.find(e => e.id === s.pic)?.name ?? '') : '']; }
    case 'w_alert': { const n = db.notices.filter(y => !y.read).length; return [`${n} unread`, db.notices[0]?.text ?? '']; }
    default: return ['', ''];
  }
}
function Widgets({ v, set, x }: PP) {
  const on = listOf(v), [drag, setDrag] = useState<string | null>(null);
  const days = Array.from({ length: 7 }, (_, i) => t0() - (6 - i) * DAY);
  const series = useMemo(() => [{ label: 'Revenue', data: days.map(d => paid(x.db, v.role === 'owner' ? null : x.outletId, d, d + DAY).reduce((a, o) => a + o.total, 0)) }], [x.db.orders, v.role, x.outletId]);
  const drop = (e: DragEvent, k: string) => { e.preventDefault(); if (!drag || drag === k) return; const o = on.filter(y => y !== drag); o.splice(o.indexOf(k), 0, drag); set('on:' + v.role, o); setDrag(null); };
  return <div className="stack" style={{ width: '100%' }}>
    <span className="cap">{{ owner: 'Owner home · all outlets', manager: 'Manager home', pic: 'PIC home · my shift', cashier: 'Cashier home' }[v.role as 'owner']} · {outletName(x.db, x.outletId)}</span>
    {on.length === 0 ? <Empty icon="layout-dashboard" title="No widgets" /> : <div style={{ display: 'grid', gridTemplateColumns: `repeat(${v.cols},minmax(0,1fr))`, gap: 12 }}>
      {on.map(k => { const [val, sub] = widgetValue(k, x, v.role); const wide = k === 'w_trend' && v.cols > 2;
        return <div key={k} draggable onDragStart={() => setDrag(k)} onDragOver={e => e.preventDefault()} onDrop={e => drop(e, k)} className="card tight stack sm" style={{ gridColumn: wide ? 'span 2' : undefined, cursor: 'grab', opacity: drag === k ? .5 : 1, minWidth: 0 }}>
          <span className="row between"><span className="faint" style={{ fontSize: 12 }}>{WG.find(w => w[0] === k)?.[1]}</span><Icon name="grip-vertical" size={14} /></span>
          {k === 'w_trend' ? <LineChart labels={days.map(d => dateShort(d))} series={series} height={110} format={idrShort} /> : <><b style={{ fontSize: 20, overflowWrap: 'anywhere' }}>{val}</b><span className="faint" style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub}</span></>}
        </div>; })}</div>}
  </div>;
}

// ── Terminology, custom fields, theme per role ───────────────────────────────────────────
function Terms({ v, x }: PP) {
  const o = x.db.orders.filter(y => y.outletId === x.outletId).at(-1);
  return <Stage><div className="card flat" style={{ width: 'min(620px,100%)', display: 'grid', gridTemplateColumns: 'minmax(0,180px) minmax(0,1fr)' }}>
    <div className="stack sm" style={{ padding: 12, borderRight: '1px solid var(--border)' }}>{[['store', v.outlet], ['armchair', v.table], ['users', v.customer], ['award', v.member], ['clock', v.shift], ['package', v.product]].map(([ic, l]) => <span key={ic} className="nav-i"><Icon name={ic} size={16} />{l}</span>)}</div>
    <div className="stack" style={{ padding: 16 }}><span className="faint" style={{ fontSize: 13 }}>{v.outlet} {outletName(x.db, x.outletId)} › {v.table} {o?.table ?? '7'} › {o?.no}</span>
      <b>{x.db.customers.length} {v.customer.toLowerCase()} · {x.db.customers.filter(c => c.optIn).length} {v.member}</b>
      <span className="muted" style={{ fontSize: 13 }}>{x.db.products.length} {v.product.toLowerCase()} across {x.db.outlets.length} {v.outlet.toLowerCase()}</span></div>
  </div><Caption>Reports, exports and the API keep the original names so integrations don’t break.</Caption></Stage>;
}
function FieldsPanel({ v, set, x }: PP) {
  const ent = v.ent ?? 'customer', rows = (x.db.records.custom_field ?? []).filter(r => r.a === ent);
  const [label, setLabel] = useState(''), [type, setType] = useState('text'), [req, setReq] = useState(false);
  const add = () => { if (!label.trim()) return; saveRecord('custom_field', { id: 'cf' + Date.now().toString(36), a: ent, b: label.trim(), c: type, d: req ? 'y' : 'n', e: '', at: Date.now() }, x.by); setLabel(''); };
  return <div className="stack">
    <div className="field"><label>Add fields to</label><Seg value={ent} options={[['customer', 'Customers'], ['product', 'Products']] as const} onChange={e => set('ent', e)} /></div>
    {rows.map(r => <div key={r.id} className="row" style={{ minHeight: 44 }}><span className="grow">{r.b}{r.d === 'y' && ' *'}</span><Badge>{r.c}</Badge><button className="btn btn-ghost btn-sm" onClick={() => deleteRecord('custom_field', r.id, x.by)} aria-label={'Delete ' + r.b}><Icon name="trash" size={16} /></button></div>)}
    <div className="sunken stack sm"><input className="input" value={label} placeholder="Field name, e.g. Company" onChange={e => setLabel(e.target.value)} aria-label="Field name" />
      <select className="input" value={type} onChange={e => setType(e.target.value)} aria-label="Field type">{['text', 'number', 'date', 'select', 'toggle', 'tags'].map(t => <option key={t}>{t}</option>)}</select>
      <label className="row between"><span>Required</span><Toggle on={req} onChange={setReq} label="Required" /></label>
      <button className="btn btn-primary" onClick={add} disabled={!label.trim()}><Icon name="plus" size={18} />Add field</button></div>
  </div>;
}
function CustomFields({ v, x }: PP) {
  const ent = v.ent ?? 'customer', rows = (x.db.records.custom_field ?? []).filter(r => r.a === ent);
  const c = x.db.customers[0], p = x.db.products[0];
  const base = ent === 'customer' ? [['Name', c.name], ['WhatsApp', c.phone], ['Email', c.email]] : [['Name', p.name], ['Price', idr(p.basePrice)], ['SKU', p.sku]];
  return <Stage><div className="card stack" style={{ width: 'min(440px,100%)' }}><h3>Edit {ent}</h3>
    {base.map(([k, val]) => <div key={k} className="field"><label>{k}</label><input className="input" value={val} readOnly /></div>)}
    {rows.length ? rows.map(r => <div key={r.id} className="field"><label>{r.b}{r.d === 'y' && ' *'}</label>{r.c === 'toggle' ? <Toggle on={false} onChange={() => { }} label={r.b} /> : <input className="input" type={r.c === 'number' ? 'number' : r.c === 'date' ? 'date' : 'text'} placeholder={r.c === 'select' ? 'Choose…' : r.c === 'tags' ? 'Add tags' : ''} />}</div>)
      : <p className="faint" style={{ fontSize: 13 }}>No custom fields yet. Added fields show here, in filters and in exports.</p>}
  </div></Stage>;
}
const ACCENTS: [string, string, string][] = [['ember', 'var(--ember-500)', 'Ember'], ['blue', 'var(--info)', 'Blue'], ['green', 'var(--success)', 'Green'], ['violet', 'var(--violet)', 'Violet']];
function RoleTheme({ v, x }: PP) {
  const r = v.role, ac = ACCENTS.find(a => a[0] === v['accent:' + r])?.[1] ?? 'var(--ember-500)', h = { touch: 56, comfy: 48, dense: 40 }[v['density:' + r] as 'touch'] ?? 48;
  return <Stage><div data-theme={v['dark:' + r] ? 'dark' : 'light'} style={{ width: 'min(520px,100%)', borderRadius: 20, overflow: 'hidden', background: 'var(--bg-canvas)', color: 'var(--fg-1)', boxShadow: 'var(--shadow-e2)' }}>
    <div className="row" style={{ padding: 12, borderBottom: `3px solid ${ac}`, background: 'var(--bg-surface)' }}><b className="grow">{x.db.tenant.name} · {r}</b><span className="badge" style={{ background: ac, color: 'var(--ink-0)' }}>{outletName(x.db, x.outletId)}</span></div>
    <div className="stack" style={{ padding: 14 }}>
      {x.db.orders.filter(o => o.outletId === x.outletId).slice(-3).map(o => <div key={o.id} className="row" style={{ height: h, padding: '0 12px', borderRadius: 12, background: 'var(--bg-surface)', border: '1px solid var(--border)' }}><span className="grow">{o.no}</span><Status s={o.status} /></div>)}
      <button className="btn" style={{ height: h, background: ac, color: 'var(--ink-0)', border: 0 }}>Charge</button></div>
  </div><Caption>Status colors (paid, void, late) never change, so they mean the same on every device. Merchant brand never changes staff tools.</Caption></Stage>;
}

// ── Franchise brand lock (owner only, approval PIN) ──────────────────────────────────────
const EXTRA_LOCKS: [string, string][] = [['promos', 'Promos'], ['photos', 'Product photos'], ['receipt', 'Receipt design']];
function LockPanel({ x }: PP) {
  const pin = usePin(), L = x.db.tenant.locks;
  const ask = (title: string, run: () => void) => x.owner ? pin.ask({ title, verb: 'Confirm lock change', onOk: run }) : toast('Only the owner can change brand locks');
  const row = (label: string, on: boolean, run: (b: boolean) => void) => <label key={label} className="row between" style={{ minHeight: 44 }}><span>{label}</span><Toggle on={on} onChange={b => ask(`${label}: ${b ? 'locked' : 'unlocked'} for all outlets`, () => run(b))} label={label} /></label>;
  return <div className="stack">
    {!x.owner && <div className="banner" style={{ background: 'var(--info-soft)', color: 'var(--info-fg)' }}><Icon name="lock" size={18} />Set by the owner. You can see what is locked.</div>}
    {row('Logo, colors & fonts', L.brand, b => setLocks({ brand: b }, x.by))}
    {row('Menu prices', L.menuPrices, b => setLocks({ menuPrices: b }, x.by))}
    {EXTRA_LOCKS.map(([k, l]) => row(l, !!x.db.settings['lock:' + k], b => setSetting('lock:' + k, b, x.by)))}
    <span className="cap">Outlets</span>
    {row('Allow outlet-only items', L.outletOnlyItems, b => setLocks({ outletOnlyItems: b }, x.by))}
    <p className="faint" style={{ fontSize: 13 }}>Locked = set by head office only. Every change asks your approval PIN and is in the audit log.</p>
    {pin.sheet}
  </div>;
}
function Lock({ x }: PP) {
  const L = x.db.tenant.locks, cols: [string, boolean][] = [['Logo', L.brand], ['Colors', L.brand], ['Fonts', L.brand], ['Prices', L.menuPrices], ...EXTRA_LOCKS.map(([k, l]) => [l.split(' ')[0], !!x.db.settings['lock:' + k]] as [string, boolean])];
  return <div className="stack" style={{ width: '100%' }}><div className="card flat"><div className="scroll-x"><table className="table">
    <thead><tr><th>Who can change</th>{cols.map(([l]) => <th key={l}>{l}</th>)}</tr></thead>
    <tbody>{[['Head office', false], ...x.db.outlets.map(o => [o.name, true] as [string, boolean])].map(([o, out]) => <tr key={o as string}><td><b>{o as string}</b></td>{cols.map(([l, locked]) => { const no = out && locked; return <td key={l}><span title={no ? 'Locked' : 'Can edit'} style={{ color: no ? 'var(--danger-fg)' : 'var(--success-fg)' }}><Icon name={no ? 'lock' : 'pencil'} size={16} /></span></td>; })}</tr>)}</tbody></table></div></div>
    <p className="faint" style={{ fontSize: 13 }}>Outlet-only items are {L.outletOnlyItems ? 'allowed (managers propose, owner approves)' : 'turned off'}. Last change {ago(x.db.audit.find(a => a.action === 'locks.changed')?.at ?? Date.now())}.</p></div>;
}

// ── Change approvals ─────────────────────────────────────────────────────────────────────
const STUDIO_TYPES: Approval['type'][] = ['publish', 'price', 'local_item'];
function Approvals({ x, mine }: PP & { mine?: boolean }) {
  const pin = usePin();
  const rows = x.db.approvals.filter(a => STUDIO_TYPES.includes(a.type) && (!mine || a.requestedBy === x.by || x.owner)).sort((a, b) => b.at - a.at);
  const waiting = rows.filter(a => a.status === 'waiting'), done = rows.filter(a => a.status !== 'waiting').slice(0, 12);
  const name = (id?: string) => x.db.employees.find(e => e.id === id)?.name ?? id ?? '';
  const act = (a: Approval, d: 'approved' | 'rejected') => pin.ask({ title: a.title, verb: d === 'approved' ? 'Approve with your PIN' : 'Reject with your PIN', onOk: id => { const err = decide(a.id, id, d); toast(err ?? (d === 'approved' ? 'Approved and published' : 'Rejected')); } });
  const canAct = (a: Approval) => x.owner && a.requestedBy !== x.by;
  return <div className="stack" style={{ width: '100%' }}>
    <div className="grid" style={{ ['--min' as string]: '150px' }}><Kpi label="Waiting for owner" value={waiting.length} tone={waiting.length ? 'warn' : undefined} /><Kpi label="Decided (all time)" value={rows.length - waiting.length} /></div>
    {waiting.length === 0 ? <Empty icon="badge-check" title="Nothing waiting">{mine ? 'When you press Send to owner, the request shows here with its status.' : 'Manager publishes and price changes appear here.'}</Empty> :
      waiting.map(a => <div key={a.id} className="card tight row wrap" style={{ gap: 10 }}>
        <div className="grow stack" style={{ gap: 2, minWidth: 200 }}><b>{a.title}</b><span className="faint" style={{ fontSize: 13 }}>{name(a.requestedBy)} · {outletName(x.db, a.outletId)} · {ago(a.at)}{a.amount ? ' · ' + idr(a.amount) : ''}</span></div>
        {canAct(a) ? <><button className="btn btn-danger btn-sm" onClick={() => act(a, 'rejected')}>Reject</button><button className="btn btn-success btn-sm" onClick={() => act(a, 'approved')}>Approve</button></> : <Status s="pending_owner" />}
      </div>)}
    {done.length > 0 && <><span className="cap">Decided</span>{done.map(a => <div key={a.id} className="row" style={{ fontSize: 13 }}><span className="grow">{a.title}</span><span className="faint">{name(a.decidedBy)} · {a.decidedAt ? ago(a.decidedAt) : ''}</span><Status s={a.status} /></div>)}</>}
    {pin.sheet}
  </div>;
}

// ── Staging & preview links ──────────────────────────────────────────────────────────────
function StagingPanel({ v, set, x }: PP) {
  const links = x.db.records.preview_link ?? [];
  const create = () => { const tok = Math.random().toString(36).slice(2, 10); saveRecord('preview_link', { id: tok, a: v.label || 'Preview', b: String(Date.now() + Number(v.exp) * DAY), c: v.pass ? String(Math.floor(1000 + Math.random() * 9000)) : '', d: x.by, e: v.banner ? 'banner' : '', at: Date.now() }, x.by); toast('Preview link created'); };
  return <div className="stack">
    <div className="field"><label>Name</label><input className="input" value={v.label ?? ''} placeholder="e.g. New menu for designer" onChange={e => set('label', e.target.value)} /></div>
    <div className="field"><label>Link expires</label><Seg value={v.exp} options={[['1', '1 day'], ['7', '7 days'], ['30', '30 days']] as const} onChange={e => set('exp', e)} /></div>
    <label className="row between" style={{ minHeight: 44 }}><span>Password protect</span><Toggle on={!!v.pass} onChange={b => set('pass', b)} label="Password" /></label>
    <label className="row between" style={{ minHeight: 44 }}><span>Show “Preview” banner</span><Toggle on={!!v.banner} onChange={b => set('banner', b)} label="Banner" /></label>
    <button className="btn btn-primary" onClick={create}><Icon name="link-2" size={18} />Create preview link</button>
    {links.map(l => { const url = `${typeof location !== 'undefined' ? location.origin : ''}/order?preview=${l.id}`, live = Number(l.b) > Date.now();
      return <div key={l.id} className="sunken stack sm"><div className="row between"><b>{l.a}</b><Badge tone={live ? 'success' : 'danger'}>{live ? 'Expires ' + dateShort(Number(l.b)) : 'Expired'}</Badge></div>
        <CopyRow value={url} />{l.c && <span style={{ fontSize: 13 }}>Password <b className="mono">{l.c}</b></span>}
        <button className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => deleteRecord('preview_link', l.id, x.by)}>Revoke</button></div>; })}
  </div>;
}
function Staging({ v, x }: PP) {
  const drafts = Object.keys(x.db.settings).filter(k => k.startsWith('studio:')).length;
  return <Stage><Phone theme={x.db.theme}>
    {v.banner && <div style={{ padding: 8, background: 'var(--warning)', color: 'var(--ink-950)', textAlign: 'center', fontSize: 12, fontWeight: 700 }}>PREVIEW · test orders are never charged</div>}
    <div style={{ flex: 1, padding: 24, display: 'flex', flexDirection: 'column', gap: 12, justifyContent: 'center', alignItems: 'center', textAlign: 'center' }}>
      <b style={{ fontFamily: 'var(--bn-font)', fontSize: 22 }}>{x.db.theme.name}</b>
      {v.pass ? <><span style={{ fontSize: 14 }}>Enter the 4-digit password to view this preview</span><span style={{ letterSpacing: '.5em', fontSize: 22 }}>• • • •</span></> : <span>Draft version with {drafts} studio draft{drafts === 1 ? '' : 's'}</span>}
    </div></Phone><Caption>{(x.db.records.preview_link ?? []).length} link{(x.db.records.preview_link ?? []).length === 1 ? '' : 's'} active. Orders on a preview link are test orders.</Caption></Stage>;
}

// ── A/B testing ──────────────────────────────────────────────────────────────────────────
const SELF = ['qr', 'kiosk', 'web'];
const bucket = (id: string) => { let h = 0; for (const c of id) h = (h * 33 + c.charCodeAt(0)) % 9973; return h % 100; };
function AB({ v, set, x }: PP) {
  const from = v.start || Date.now() - 14 * DAY;
  const os = paid(x.db, null, from).filter(o => SELF.includes(o.source));
  const B = os.filter(o => bucket(o.id) < v.split), A = os.filter(o => bucket(o.id) >= v.split);
  const m = (l: typeof os) => v.metric === 'aov' ? (l.length ? Math.round(l.reduce((a, o) => a + o.total, 0) / l.length) : 0) : v.metric === 'items' ? (l.length ? l.reduce((a, o) => a + o.lines.reduce((s, y) => s + y.qty, 0), 0) / l.length : 0) : l.reduce((a, o) => a + o.total, 0);
  const fmt = (n: number) => v.metric === 'items' ? n.toFixed(2) : idrShort(n);
  const [ma, mb] = [m(A), m(B)], max = Math.max(ma, mb, 1), day = v.start ? Math.ceil((Date.now() - v.start) / DAY) : 0;
  return <div className="stack" style={{ width: '100%' }}>
    <div className="row wrap between"><Badge tone={v.start ? 'success' : 'neutral'} dot>{v.start ? `Running · day ${day} of ${v.dur}` : 'Not running · baseline from the last 14 days'}</Badge>
      <button className="btn btn-sm" onClick={() => { set('start', v.start ? 0 : Date.now()); toast(v.start ? 'Test stopped' : 'Test started'); }}>{v.start ? 'Stop test' : 'Start test'}</button></div>
    {[['A', `Live theme (${100 - v.split}%)`, A, ma], ['B', `Draft theme (${v.split}%)`, B, mb]].map(([k, l, list, val]) => <div key={k as string} className="card tight stack sm">
      <div className="row between"><b>{k as string} · {l as string}</b><span className="faint">{(list as typeof os).length} orders</span></div>
      <div style={{ height: 10, borderRadius: 5, background: 'var(--bg-sunken)' }}><div style={{ width: (val as number) / max * 100 + '%', height: '100%', borderRadius: 5, background: k === 'B' ? 'var(--role)' : 'var(--ink-400)' }} /></div>
      <span className="num">{fmt(val as number)} <span className="faint" style={{ fontWeight: 400, fontSize: 13 }}>{{ aov: 'avg order', items: 'items per order', rev: 'revenue' }[v.metric as 'aov']}</span></span></div>)}
    <p className="faint" style={{ fontSize: 13 }}>Self-order orders (QR, kiosk, web) are split by a stable hash of the order, so each guest sees one version. {os.length < 100 ? 'Under 100 orders: too early to call a winner.' : mb > ma ? 'B is ahead.' : 'A is ahead.'}</p>
  </div>;
}

// ── Menu analytics (from paid orders by product) ─────────────────────────────────────────
function Stats({ v, x }: PP) {
  const days = v.per === 'today' ? 1 : v.per === '7d' ? 7 : 14, from = t0() - (days - 1) * DAY;
  const os = paid(x.db, v.scope === 'all' ? null : x.outletId, from);
  const rows = useMemo(() => { const m: Record<string, { n: string; qty: number; rev: number; orders: number; self: number }> = {}; os.forEach(o => { const seen = new Set<string>(); o.lines.forEach(l => { const r = (m[l.productId] ??= { n: l.name, qty: 0, rev: 0, orders: 0, self: 0 }); r.qty += l.qty; r.rev += (l.flashPrice ?? l.unitPrice) * l.qty; if (!seen.has(l.productId)) { r.orders++; if (SELF.includes(o.source)) r.self++; seen.add(l.productId); } }); }); return Object.values(m).sort((a, b) => b.rev - a.rev); }, [os]);
  const top = rows.slice(0, 8);
  const series = useMemo(() => [{ label: 'Revenue', data: top.map(r => r.rev) }], [top]);
  if (!os.length) return <Empty icon="chart-no-axes-column" title="No paid orders in this period" />;
  return <div className="stack" style={{ width: '100%' }}>
    <div className="grid" style={{ ['--min' as string]: '150px' }}><Kpi label="Paid orders" value={os.length} /><Kpi label="Self-order share" value={pct(os.filter(o => SELF.includes(o.source)).length, os.length) + '%'} delta="QR, kiosk, web" /><Kpi label="Items per order" value={(os.reduce((a, o) => a + o.lines.reduce((s, l) => s + l.qty, 0), 0) / os.length).toFixed(2)} /></div>
    <div className="card"><span className="cap">Top items by revenue</span><LineChart labels={top.map(r => r.n.split(' ').slice(0, 2).join(' '))} series={series} kind="bar" height={200} format={idrShort} /></div>
    <div className="card flat"><div className="scroll-x"><table className="table"><thead><tr><th>Item</th><th className="r">Orders</th><th className="r">Qty</th><th className="r">Revenue</th><th className="r">From self-order</th></tr></thead>
      <tbody>{rows.map(r => <tr key={r.n}><td>{r.n}</td><td className="r">{r.orders}</td><td className="r">{r.qty}</td><td className="r">{idr(r.rev)}</td><td className="r">{pct(r.self, r.orders)}%</td></tr>)}</tbody></table></div></div>
  </div>;
}

// ── Webhooks & API ───────────────────────────────────────────────────────────────────────
const EVENTS = ['theme.published', 'menu.updated', 'price.changed', 'order.paid'];
function HooksPanel({ v, set, x }: PP) {
  const locked = planLocked('enterprise', x.db);
  const keys = x.db.records.api_key ?? [];
  const test = async () => {
    const id = 'wh' + Date.now().toString(36); let status = 'sent';
    try { await fetch(v.url, { method: 'POST', mode: 'no-cors', body: JSON.stringify({ event: 'test', tenant: x.db.tenant.id, at: new Date().toISOString() }) }); } catch { status = 'failed'; }
    saveRecord('webhook_delivery', { id, a: 'test', b: v.url, c: status, d: '', e: '', at: Date.now() }, x.by); toast(status === 'sent' ? 'Test delivered to the endpoint' : 'Endpoint unreachable');
  };
  const newKey = () => { const k = 'bn_live_' + Array.from(crypto.getRandomValues(new Uint8Array(12)), b => b.toString(16).padStart(2, '0')).join(''); saveRecord('api_key', { id: 'k' + Date.now().toString(36), a: 'API key', b: k.slice(0, 12) + '…' + k.slice(-4), c: x.by, d: '', e: '', at: Date.now() }, x.by); copy(k, 'Key copied. It won’t be shown again.'); };
  return <div className="stack">
    <div className="field"><label>Endpoint URL</label><input className="input" value={v.url} onChange={e => set('url', e.target.value)} type="url" /></div>
    {EVENTS.map(e => <label key={e} className="row between" style={{ minHeight: 44 }}><span className="mono">{e}</span><Toggle on={!!v[e]} onChange={b => set(e, b)} label={e} /></label>)}
    <div className="field"><label>Signing secret</label>{v.secret ? <CopyRow value={v.secret} /> : <button className="btn btn-sm" onClick={() => set('secret', 'whsec_' + Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join(''))}>Generate secret</button>}</div>
    <button className="btn" disabled={locked || !/^https?:\/\//.test(v.url)} onClick={test}>Send test event</button>
    <span className="cap">API keys</span>
    {keys.map(k => <div key={k.id} className="row" style={{ fontSize: 13 }}><span className="mono grow">{k.b}</span><span className="faint">{ago(k.at)}</span><button className="btn btn-ghost btn-sm" disabled={!x.owner} onClick={() => deleteRecord('api_key', k.id, x.by)}>Revoke</button></div>)}
    {x.owner ? <button className="btn btn-sm" disabled={locked} onClick={newKey}>Create API key</button> : <p className="faint" style={{ fontSize: 13 }}>Only the owner can create API keys.</p>}
  </div>;
}
function Hooks({ v, x }: PP) {
  const dl = (x.db.records.webhook_delivery ?? []).slice(0, 8);
  return <div className="stack" style={{ width: '100%' }}>
    <span className="cap">Example payload</span>
    <pre className="mono" style={{ margin: 0, padding: 14, borderRadius: 12, background: 'var(--ink-950)', color: 'var(--ink-100)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 12 }}>{JSON.stringify({ event: EVENTS.find(e => v[e]) ?? 'order.paid', tenant: x.db.tenant.id, version: x.db.versions.length, by: x.me?.name, at: new Date().toISOString() }, null, 2)}</pre>
    <p className="faint" style={{ fontSize: 13 }}>Signed with HMAC-SHA256 in the X-BorNiz-Signature header. Failed deliveries retry 5 times.</p>
    <span className="cap">Recent deliveries</span>
    {dl.length ? dl.map(d => <div key={d.id} className="row" style={{ fontSize: 13 }}><span className="mono grow" style={{ overflowWrap: 'anywhere' }}>{d.a} → {d.b}</span><span className="faint">{ago(d.at)}</span><Status s={d.c} /></div>) : <p className="faint" style={{ fontSize: 13 }}>No deliveries yet.</p>}
  </div>;
}

// ── Industry templates ───────────────────────────────────────────────────────────────────
export const IND: [string, string, string, string[], string][] = [
  ['fnb', 'F&B · café, restaurant, bar, bakery', 'var(--bn-p)', ['QR menu with photos', 'Table & floor plan', 'Kitchen display routing', 'Cup stickers'], 'Meja'],
  ['retail', 'Retail · catalog, size/color variants, barcode', 'var(--ember-700)', ['Size × color variants', 'Barcode & label printing', 'Exchange flow', 'Online catalog'], 'Rak'],
  ['salon', 'Salon & spa · booking per staff', 'var(--violet)', ['Booking per stylist', 'Service duration', 'Commission per service', 'Deposit on booking'], 'Kursi'],
  ['laundry', 'Laundry · order status tracking', 'var(--success)', ['Order by kg or item', 'Status tracking link', 'Pickup & delivery', 'WhatsApp ready alert'], 'Rak'],
  ['court', 'Food court & multi-tenant', 'var(--ember-600)', ['One cart, many tenants', 'Settlement per tenant', 'Shared table QR', 'Tenant KDS'], 'Meja'],
];
function Industry({ v, set, x }: PP) {
  const t = IND.find(i => i[0] === v.pick) ?? IND[0];
  const applied = x.db.versions.find(ver => ver.status === 'published' && (ver.data as V)?.tool === 'industry');
  return <div className="stack" style={{ width: '100%' }}>
    <div className="grid" style={{ ['--min' as string]: '170px' }}>{IND.map(([k, n, c]) => <button key={k} className="card tight stack sm" onClick={() => set('pick', k)} aria-pressed={v.pick === k} style={{ cursor: 'pointer', textAlign: 'left', boxShadow: v.pick === k ? '0 0 0 3px var(--role)' : undefined }}>
      <span style={{ height: 8, borderRadius: 4, background: c, ...(k === 'fnb' ? { ['--bn-p' as string]: x.db.theme.p } : {}) }} /><b style={{ fontSize: 14 }}>{n.split(' · ')[0]}</b>{applied && (applied.data as V).values.pick === k && <Badge tone="success">Applied</Badge>}</button>)}</div>
    <div className="card stack" style={{ ['--bn-p' as string]: x.db.theme.p }}><span className="cap" style={{ color: t[2] }}>{t[1]}</span>
      <div className="grid" style={{ ['--min' as string]: '200px' }}>{t[3].map(f => <div key={f} className="row"><Icon name="check" size={18} style={{ color: t[2] }} />{f}</div>)}</div>
      <p className="muted" style={{ fontSize: 13 }}>Sets up pages, POS layout, receipt and recommended settings. Your {x.db.products.length} products, {x.db.customers.length} customers and order history are kept. Seats are called “{t[4]}”.</p></div>
  </div>;
}

// ── Customization rules ──────────────────────────────────────────────────────────────────
function Locked() {
  const block = (title: string, why: string, body: React.ReactNode) => <div className="card stack sm"><div className="row"><Icon name="lock" size={16} /><b>{title}</b></div><span className="muted" style={{ fontSize: 13 }}>{why}</span>{body}</div>;
  return <div className="grid" style={{ ['--min' as string]: '240px', width: '100%' }}>
    {block('Status colors', 'Paid, pending, void and late mean the same everywhere.', <div className="row wrap">{['paid', 'pending', 'voided', 'refunded', 'failed'].map(s => <Status key={s} s={s} />)}</div>)}
    {block('KDS timers', 'Ticket age turns amber at 8 min and red at 12 min.', <div className="row">{[['3:12', 'success'], ['8:40', 'warning'], ['12:05', 'danger']].map(([t, c]) => <span key={t} className={'badge b-' + c}>{t}</span>)}</div>)}
    {block('Payment marks', 'QRIS, GPN and card marks follow scheme rules.', <div className="row">{['QRIS', 'GPN', 'VISA', 'Mastercard'].map(m => <span key={m} className="badge" style={{ fontWeight: 800, letterSpacing: '.04em' }}>{m}</span>)}</div>)}
    {block('Error screens', 'Wording can change, layout and actions can’t.', <span style={{ fontSize: 13 }}>Payment didn’t go through. No money was taken. Try again or pick another method.</span>)}
    {block('Legal lines', 'NPWP, tax lines and the payment provider line always print.', <span className="mono" style={{ fontSize: 12 }}>NPWP 01.234.567.8-901.000 · PB1 10%</span>)}
    {block('Staff tools', 'Merchant brand never changes POS, KDS or dashboards. Use Brand Studio for staff accents.', <span className="row"><Icon name="monitor" size={16} />BorNiz tokens only</span>)}
  </div>;
}
function ContrastCheck({ v, set, x }: PP & { tools?: Tool[] }) {
  const pairs = themePairs(x.db.theme);
  const r = contrast(v.fg ?? x.db.theme.ink, v.bg ?? x.db.theme.paper);
  return <div className="stack" style={{ width: '100%' }}>
    <div className="card flat scroll-x"><table className="table"><thead><tr><th>Live theme pair</th><th>Sample</th><th className="r">Ratio</th><th>Result</th></tr></thead>
      <tbody>{pairs.map(([fg, bg, l]) => { const c = contrast(fg, bg); return <tr key={l}><td>{l}</td><td><span style={{ padding: '4px 10px', borderRadius: 8, background: bg, color: fg, fontWeight: 700 }}>Aa 123</span></td><td className="r num">{c.toFixed(2)}:1</td><td><Badge tone={c >= 4.5 ? 'success' : 'danger'}>{c >= 4.5 ? 'Pass' : 'Blocks publish'}</Badge></td></tr>; })}</tbody></table></div>
    <div className="card stack"><span className="cap">Try a pair</span><div className="row wrap">
      <label className="row">Text <input type="color" value={v.fg ?? x.db.theme.ink} onChange={e => set('fg', e.target.value)} style={{ width: 44, height: 44, border: 0, background: 'none' }} /></label>
      <label className="row">Background <input type="color" value={v.bg ?? x.db.theme.paper} onChange={e => set('bg', e.target.value)} style={{ width: 44, height: 44, border: 0, background: 'none' }} /></label>
      <span style={{ padding: '10px 16px', borderRadius: 10, background: v.bg ?? x.db.theme.paper, color: v.fg ?? x.db.theme.ink, fontWeight: 700 }}>Order now</span>
      <Badge tone={r >= 4.5 ? 'success' : 'danger'}>{r.toFixed(2)}:1 {r >= 4.5 ? 'pass' : 'fail'}</Badge></div></div>
    <p className="faint" style={{ fontSize: 13 }}>Every studio checks its text on color against 4.5:1 (WCAG AA). Below that, Publish is blocked and the failing pair is named.</p>
  </div>;
}
function Plans({ x, tools }: PP & { tools: Tool[] }) {
  const plans: Plan[] = ['free', 'basic', 'pro', 'enterprise'], cur = x.db.tenant.plan;
  const locked = tools.filter(t => planLocked(t.plan, x.db));
  return <div className="stack" style={{ width: '100%' }}>
    {locked.length > 0 && <div className="card row wrap" style={{ background: 'var(--info-soft)', borderColor: 'transparent' }}><div className="grow stack sm" style={{ minWidth: 220 }}><b>{locked.length} tools need {PLAN_LABEL[locked[0].plan]}</b><span style={{ fontSize: 13 }}>You’re on {PLAN_LABEL[cur]}. Locked tools stay visible with a live preview; publishing unlocks after upgrading.</span></div><a className="btn btn-primary" href="/owner/account/subscription-billing">Upgrade</a></div>}
    <div className="card flat"><div className="scroll-x"><table className="table"><thead><tr><th>Tool</th>{plans.map(p => <th key={p} style={{ color: p === cur ? 'var(--role-fg)' : undefined }}>{PLAN_LABEL[p]}{p === cur && ' · you'}</th>)}</tr></thead>
      <tbody>{tools.filter(t => t.group !== 'STUDIOS' && t.group !== 'RULES').map(t => <tr key={t.id}><td>{t.name}</td>{plans.map(p => <td key={p}>{PLAN_RANK[p] >= PLAN_RANK[t.plan] ? <Icon name="check" size={16} style={{ color: 'var(--success-fg)' }} /> : <span className="faint">—</span>}</td>)}</tr>)}</tbody></table></div></div>
  </div>;
}

export function workspaceTools(all: () => Tool[]): Tool[] {
  return [
    { id: 'widgets', group: 'WORKSPACE', name: 'Dashboard widgets per role', icon: 'layout-dashboard', plan: 'free', desc: 'Choose and order the widgets each role sees on its home dashboard.', def: { role: 'owner', cols: 3 }, Preview: Widgets, Panel: WidgetsPanel, wide: true },
    { id: 'terms', group: 'WORKSPACE', name: 'Terminology', icon: 'whole-word', plan: 'free', desc: 'Rename modules to match how your business talks. Changes apply across the dashboard, POS and reports.', def: { outlet: 'Cabang', table: 'Meja', customer: 'Pelanggan', member: 'Sahabat Biru', shift: 'Shift', product: 'Menu' }, Preview: Terms,
      fields: () => [F.text('Outlet', 'outlet'), F.text('Table', 'table'), F.text('Customer', 'customer'), F.text('Member', 'member'), F.text('Shift', 'shift'), F.text('Product', 'product')] },
    { id: 'fields', group: 'WORKSPACE', name: 'Custom fields', icon: 'list-plus', plan: 'pro', desc: 'Add your own fields to products and customers. They show on forms, filters and exports.', Preview: CustomFields, Panel: FieldsPanel },
    { id: 'roleth', group: 'WORKSPACE', name: 'Theme per role', icon: 'user-cog', plan: 'pro', desc: 'Give each role its own accent and density so devices are easy to tell apart.', def: { role: 'cashier', 'accent:cashier': 'ember', 'density:cashier': 'touch', 'accent:manager': 'blue', 'density:manager': 'comfy', 'accent:kitchen': 'green', 'dark:kitchen': true }, Preview: RoleTheme,
      fields: v => [F.seg('Role', 'role', [['owner', 'Owner'], ['manager', 'Manager'], ['pic', 'PIC'], ['cashier', 'Cashier'], ['kitchen', 'Kitchen']]), F.swatch('Accent', 'accent:' + v.role, ACCENTS), F.seg('Density', 'density:' + v.role, [['touch', 'Touch'], ['comfy', 'Comfy'], ['dense', 'Dense']]), F.toggle('Dark mode', 'dark:' + v.role)] },
    { id: 'lock', group: 'GOVERNANCE', name: 'Franchise brand lock', icon: 'lock', plan: 'pro', desc: 'Head office locks brand elements. Outlets can only change what is unlocked.', Preview: Lock, Panel: LockPanel },
    { id: 'approve', group: 'GOVERNANCE', name: 'Change approvals', icon: 'badge-check', plan: 'free', desc: 'Managers edit every studio like the owner; price changes and publishing wait for the owner’s OK.', def: { rule: 'owner', notify: true }, Preview: Approvals,
      fields: () => [F.seg('Who approves', 'rule', [['owner', 'Owner'], ['two', 'Owner + one admin']]), F.toggle('Notify the owner on WhatsApp', 'notify'), F.note('Price changes and publishing always need the owner, with the approval PIN.')] },
    { id: 'requests', group: 'GOVERNANCE', name: 'Publish requests & status', icon: 'send', plan: 'free', desc: 'Every “Send to owner” with its status: waiting, approved or rejected.', Preview: p => <Approvals {...p} mine /> },
    { id: 'staging', group: 'GOVERNANCE', name: 'Staging & preview link', icon: 'link-2', plan: 'free', desc: 'Share an unpublished version with your team or a designer before it goes live.', Preview: Staging, Panel: p => <StagingPanel {...p} v={{ exp: '7', pass: true, banner: true, ...p.v }} /> },
    { id: 'ab', group: 'GOVERNANCE', name: 'A/B testing', icon: 'split', plan: 'pro', desc: 'Show two themes to guests and keep the one that sells more.', def: { split: 50, metric: 'aov', dur: '14', start: 0 }, Preview: AB,
      fields: () => [F.range('Traffic to B', 'split', 10, 90, 5, '%'), F.seg('Winner by', 'metric', [['aov', 'Avg order'], ['items', 'Items/order'], ['rev', 'Revenue']]), F.seg('Run for', 'dur', [['7', '7 days'], ['14', '14 days'], ['30', '30 days']])] },
    { id: 'stats', group: 'GOVERNANCE', name: 'Menu analytics', icon: 'chart-no-axes-column', plan: 'free', desc: 'Which items sell, how often they’re ordered and how much comes from self-order.', Preview: Stats,
      Panel: ({ v, set }) => <div className="stack"><div className="field"><label>Period</label><Seg value={v.per ?? '7d'} options={[['today', 'Today'], ['7d', '7 days'], ['14d', '14 days']] as const} onChange={p => set('per', p)} /></div><div className="field"><label>Outlets</label><Seg value={v.scope ?? 'one'} options={[['one', 'This outlet'], ['all', 'All']] as const} onChange={s => set('scope', s)} /></div></div> },
    { id: 'hooks', group: 'GOVERNANCE', name: 'Webhooks & API', icon: 'webhook', plan: 'enterprise', desc: 'Notify your own systems when themes, menus or orders change.', def: { url: 'https://hooks.kopibiru.id/bornis', 'theme.published': true, 'menu.updated': true, 'price.changed': false, 'order.paid': true, secret: '' }, Preview: Hooks, Panel: HooksPanel },
    { id: 'industry', group: 'TEMPLATES', name: 'Industry templates', icon: 'layout-template', plan: 'free', desc: 'Starter setups per business type: pages, sections, POS layout and receipt. Publishing applies the template.', def: { pick: 'fnb' }, Preview: Industry,
      fields: () => [F.seg('Business type', 'pick', [['fnb', 'F&B'], ['retail', 'Retail'], ['salon', 'Salon'], ['laundry', 'Laundry'], ['court', 'Food court']]), F.note('Applying keeps your products, customers and history.')] },
    { id: 'locked', group: 'RULES', name: 'Locked elements', icon: 'shield', plan: 'free', desc: 'What no studio can change: status colors, KDS timers, payment marks, error screens and legal lines.', Preview: Locked },
    { id: 'contrast', group: 'RULES', name: 'Contrast check & publish blocking', icon: 'contrast', plan: 'free', desc: 'Text on color must reach 4.5:1. Below that, publish is blocked.', Preview: ContrastCheck },
    { id: 'plans', group: 'RULES', name: 'Plan gating', icon: 'gem', plan: 'free', desc: 'Which tools come with Free, Basic, Pro and Enterprise. Nothing is hidden.', Preview: p => <Plans {...p} tools={all()} /> },
  ];
}
