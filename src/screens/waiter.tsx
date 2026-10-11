'use client';
// Waiter & staff phone (spec: BorNiz Waiter). Tables with open bills, dishes to run, guest calls, take an order at the
// table (fires to the KDS), request the bill. Payment stays with the cashier or the guest's QR.
import { DeviceChrome } from '../app/chrome.tsx';
import { useMemo, useState } from 'react';
import { useApp } from '../app/context.tsx';
import { Badge, Empty, Icon, Sheet, ago, hhmm, toast, useNow, type Tone } from '../ui/kit.tsx';
import { idr } from '../domain/money.ts';
import { perm } from '../system/perms.ts';
import { addLine, markRead, newOrder, patchOrder, priceAt, served, setQty } from '../data/actions.ts';
import { fireRound, requestBill } from '../data/actions/waiter.ts';
import type { DB, Order, Product } from '../data/schema.ts';
import { SHIFTS } from '../domain/shift.ts';
import { bumpTimes, isHistory, isOnline, lineMods } from './kitchen/model.ts';
import { ClockCard } from './kitchen/kdsPages.tsx';

type Tab = 'tables' | 'table' | 'ready' | 'calls' | 'me';
const OPEN = ['open', 'held', 'sent', 'preparing', 'ready', 'served', 'paying'];
const tableName = (i: number) => 'T-' + String(i).padStart(2, '0');

function tableState(db: DB, o: Order | undefined, billed: Set<string>, now: number, resv?: DB['reservations'][0]): { s: string; tone: Tone } {
  if (!o) return resv?.status === 'seated' ? { s: 'Seated', tone: 'info' } : resv ? { s: 'Reserved ' + hhmm(resv.at), tone: 'neutral' } : { s: 'Free', tone: 'neutral' };
  if (o.status === 'paying') return { s: 'Paying', tone: 'violet' };
  if (billed.has(o.id)) return { s: 'Wants bill', tone: 'danger' };
  if (o.status === 'ready') return { s: 'Food ready', tone: 'success' };
  if (o.lines.some(l => !l.fired)) return { s: 'Ordering', tone: 'info' };
  if (o.lines.some(l => l.fired && l.kds !== 'done')) return { s: 'Cooking', tone: 'warning' };
  return { s: 'Eating', tone: 'neutral' };
}

export default function Screen() {
  const { db, user, me, outletId } = useApp();
  const now = useNow(15000);
  const by = me?.id ?? user.id;
  const [tab, setTab] = useState<Tab>('tables');
  const [sel, setSel] = useState<string | null>(null);
  const outlet = db.outlets.find(o => o.id === outletId);
  const t0 = new Date(now).setHours(0, 0, 0, 0);
  const open = useMemo(() => db.orders.filter(o => o.outletId === outletId && !isHistory(o) && o.table && OPEN.includes(o.status) && o.createdAt >= t0 - 864e5), [db.orders, outletId, t0]);
  const billed = useMemo(() => new Set(db.audit.filter(a => a.action === 'order.bill_requested').map(a => a.subject)), [db.audit]);
  const ready = db.orders.filter(o => o.outletId === outletId && o.status === 'ready' && !isOnline(o) && !isHistory(o)).sort((a, b) => a.createdAt - b.createdAt);
  const calls = db.notices.filter(n => n.to.includes('waiter') && n.outletId === outletId && n.at >= t0);
  const unread = calls.filter(n => !n.read).length;
  const canOrder = perm(db, user.role, 'Take orders & charge', outletId) !== 'n';
  const slot = (Object.keys(SHIFTS) as (keyof typeof SHIFTS)[]).find(k => db.roster.find(r => r.outletId === outletId && r.day === (new Date(now).getDay() + 6) % 7)?.slots[k].crew.includes(by));
  const title = tab === 'table' ? 'Table ' + sel : { tables: 'Tables · ' + outlet?.name, ready: 'Ready to serve', calls: 'Guest calls', me: 'My shift' }[tab];
  const TABS: [Tab, string, string, number][] = [['tables', 'Tables', 'armchair', 0], ['ready', 'Ready', 'bell', ready.length], ['calls', 'Calls', 'hand', unread], ['me', 'Me', 'user', 0]];

  return <div style={{ ['--role' as string]: 'var(--success)', ['--role-soft' as string]: 'var(--success-soft)', ['--role-fg' as string]: 'var(--success-fg)', maxWidth: 520, margin: '0 auto', minHeight: '100dvh', display: 'flex', flexDirection: 'column', background: 'var(--bg-canvas)' }}>
    <header className="row" style={{ position: 'sticky', top: 0, zIndex: 10, padding: '12px 16px', background: 'var(--bg-canvas)', borderBottom: '1px solid var(--border)' }}>
      {tab === 'table' ? <button type="button" className="btn icon-btn" aria-label="Back to tables" onClick={() => setTab('tables')}><Icon name="arrow-left" /></button>
        : <span className="avatar" style={{ background: 'var(--role)' }}>{(me?.name ?? 'W')[0]}</span>}
      <span className="grow stack" style={{ gap: 0 }}><b style={{ fontSize: 16 }}>{title}</b><span className="muted" style={{ fontSize: 12 }}>{me?.name ?? user.role}{slot ? ` · ${SHIFTS[slot][0]} ${SHIFTS[slot][1]}–${SHIFTS[slot][2]}` : ''}</span></span>
      <DeviceChrome />
    </header>
    {!db.device.online && <div className="banner" role="alert" style={{ margin: '10px 14px 0', background: 'var(--danger-soft)', color: 'var(--danger-fg)' }}><Icon name="wifi-off" /><span>Offline. New orders are kept on this phone and sent to the kitchen when the connection is back.</span></div>}
    <main className="stack" style={{ flex: 1, padding: '12px 14px 160px' }}>
      {tab === 'tables' && <Tables tables={outlet?.tables ?? 0} {...{ db, open, billed, now, ready: ready.length, outletId }} onReady={() => setTab('ready')} onPick={t => { setSel(t); setTab('table'); }} />}
      {tab === 'table' && sel && <TableView table={sel} o={open.find(o => o.table === sel)} {...{ db, by, outletId, billed, canOrder }} />}
      {tab === 'ready' && <Ready list={ready} db={db} by={by} now={now} />}
      {tab === 'calls' && (!calls.length ? <Empty icon="hand" title="No calls">Guest calls, kitchen runner calls and ready dishes show up here.</Empty>
        : calls.map(n => <div key={n.id} className="card tight row" style={{ background: n.read ? 'var(--success-soft)' : undefined, alignItems: 'center' }}>
          <span style={{ width: 44, height: 44, flex: 'none', borderRadius: 12, background: 'var(--success-soft)', color: 'var(--success-fg)', display: 'grid', placeItems: 'center' }}><Icon name={n.alert === 'Runner call' ? 'chef-hat' : n.alert === 'Order ready' ? 'bell' : n.alert === 'Sold out' ? 'ban' : 'hand'} /></span>
          <span className="grow" style={{ fontSize: 14 }}><b>{n.alert}</b> · {n.text}<br /><span className="muted" style={{ fontSize: 12 }}>{n.read ? 'Acknowledged' : ago(n.at, now)}</span></span>
          {!n.read && <button type="button" className="btn btn-dark" style={{ height: 48 }} onClick={() => { markRead(n.id, by); toast('On your way'); }}>On my way</button>}
        </div>))}
      {tab === 'me' && <div className="stack">
        <ClockCard db={db} outletId={outletId} by={by} now={now} big={false} />
        <div className="card tight stack sm"><b>My week</b>{Array.from({ length: 7 }, (_, d) => { const r = db.roster.find(x => x.outletId === outletId && x.day === d), k = r && (Object.keys(SHIFTS) as (keyof typeof SHIFTS)[]).find(s => r.slots[s].crew.includes(by) || r.slots[s].pic === by);
          return <div key={d} className="row between" style={{ fontSize: 14, padding: '6px 0', borderTop: '1px solid var(--border)' }}><b style={{ width: 48 }}>{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][d]}</b>{k ? <Badge tone="accent">{SHIFTS[k][0]}</Badge> : <Badge>Off</Badge>}<span className="muted grow" style={{ textAlign: 'right' }}>{k ? `${SHIFTS[k][1]}–${SHIFTS[k][2]} · PIC ${db.employees.find(e => e.id === r!.slots[k].pic)?.name}` : ''}</span></div>; })}</div>
      </div>}
    </main>
    <nav style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 30, background: 'var(--bg-surface)', borderTop: '1px solid var(--border)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <div style={{ maxWidth: 520, margin: '0 auto', display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', paddingRight: 'max(0px, calc(160px - (100vw - 520px) / 2))' }}>
        {TABS.map(([k, l, ic, b]) => { const on = tab === k || (k === 'tables' && tab === 'table');
          return <button key={k} type="button" onClick={() => setTab(k)} aria-current={on ? 'page' : undefined} style={{ position: 'relative', height: 64, border: 0, background: 'none', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, color: on ? 'var(--success-fg)' : 'var(--fg-3)', fontSize: 12, fontWeight: 700 }}>
            <Icon name={ic} size={22} />{l}{b > 0 && <span className="badge b-danger" style={{ position: 'absolute', top: 6, left: 'calc(50% + 6px)', height: 18, padding: '0 6px', fontSize: 11 }}>{b}</span>}</button>; })}
      </div>
    </nav>
  </div>;
}

function Tables({ db, open, billed, now, tables, ready, outletId, onReady, onPick }: { db: DB; open: Order[]; billed: Set<string>; now: number; tables: number; ready: number; outletId: string; onReady: () => void; onPick: (t: string) => void }) {
  const resv = db.reservations.filter(r => r.outletId === outletId && (r.status === 'seated' || (r.status === 'booked' && r.at > now - 30 * 60e3 && r.at < now + 3 * 3600e3)));
  if (!tables) return <Empty icon="armchair" title="No tables at this outlet">Tables are set in the outlet settings.</Empty>;
  return <>
    {ready > 0 && <div className="row between" style={{ padding: '12px 14px', borderRadius: 16, background: 'var(--success)', color: '#fff' }}><span style={{ fontSize: 14 }}><b>{ready} {ready === 1 ? 'order' : 'orders'} ready</b> at the pass</span><button type="button" className="btn btn-sm" style={{ background: '#fff', color: 'var(--success-fg)', borderColor: 'transparent' }} onClick={onReady}>Pick up</button></div>}
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>{Array.from({ length: tables }, (_, i) => { const t = tableName(i + 1), o = open.find(x => x.table === t), st = tableState(db, o, billed, now, resv.find(r => r.table === t));
      const col = st.tone === 'neutral' ? 'var(--border)' : `var(--${st.tone === 'accent' ? 'accent' : st.tone})`;
      return <button key={t} type="button" onClick={() => onPick(t)} style={{ height: 96, borderRadius: 18, border: `2px solid ${col}`, background: st.s === 'Free' ? 'var(--bg-sunken)' : 'var(--bg-surface)', color: 'var(--fg-1)', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3, padding: 4 }}>
        <b style={{ fontSize: 20 }}>{t}</b><span style={{ fontSize: 12, fontWeight: 700, color: st.tone === 'neutral' ? 'var(--fg-2)' : `var(--${st.tone}-fg)` }}>{st.s}</span>
        {o && <span className="muted" style={{ fontSize: 11 }}>{o.guests} pax · {Math.round((now - o.createdAt) / 60e3)} min</span>}</button>; })}</div>
  </>;
}

function TableView({ db, table, o, by, outletId, billed, canOrder }: { db: DB; table: string; o: Order | undefined; by: string; outletId: string; billed: Set<string>; canOrder: boolean }) {
  const [pick, setPick] = useState(false);
  const draft = o?.lines.filter(l => !l.fired) ?? [];
  const lineState = (l: Order['lines'][0]): [string, Tone] => !l.fired ? ['Not sent', 'info'] : l.kds === 'new' ? ['Sent', 'info'] : l.kds === 'cooking' ? ['Cooking', 'warning'] : o!.status === 'served' || o!.status === 'paying' ? ['Served', 'success'] : ['Ready', 'success'];
  const guests = (n: number) => o && patchOrder(o.id, { guests: Math.max(1, n) }, by);
  return <>
    <div className="row between" style={{ alignItems: 'baseline' }}><b style={{ fontSize: 24 }}>{table}</b>{o && <span className="row"><button type="button" className="btn btn-sm icon-btn" aria-label="Fewer guests" onClick={() => guests(o.guests - 1)}>−</button><span className="muted" style={{ fontSize: 13 }}>{o.guests} pax · {o.no}</span><button type="button" className="btn btn-sm icon-btn" aria-label="More guests" onClick={() => guests(o.guests + 1)}>+</button></span>}</div>
    {!o ? <Empty icon="armchair" title="Table is free">Take the order here; it goes straight to the kitchen and bar screens.</Empty>
      : o.lines.map(l => { const [s, t] = lineState(l);
        return <div key={l.id} className="card tight row" style={{ gap: 10 }}>
          <span className="grow" style={{ fontSize: 14 }}><b>{l.qty}×</b> {l.name}{(l.mods.length > 0 || l.note) && <><br /><span className="muted" style={{ fontSize: 12 }}>{[lineMods(l), l.note].filter(Boolean).join(' · ')}</span></>}</span>
          {!l.fired && <span className="row" style={{ gap: 4 }}><button type="button" className="btn btn-sm icon-btn" aria-label="Less" onClick={() => setQty(o.id, l.id, l.qty - 1, by)}>−</button><button type="button" className="btn btn-sm icon-btn" aria-label="More" onClick={() => setQty(o.id, l.id, l.qty + 1, by)}>+</button></span>}
          <Badge tone={t}>{s}</Badge></div>; })}
    {o && <div className="row between" style={{ fontSize: 14, padding: '4px 4px' }}><span className="muted">Bill so far</span><b>{idr(o.total)}</b></div>}
    {draft.length > 0 && <button type="button" className="btn btn-primary btn-pos" onClick={() => { fireRound(o!.id, by); toast(`${draft.reduce((a, l) => a + l.qty, 0)} items sent to the kitchen`); }}>Send to kitchen · {draft.reduce((a, l) => a + l.qty, 0)} items</button>}
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
      {canOrder && <button type="button" className="btn btn-pos" onClick={() => setPick(true)}><Icon name="plus" />Add items</button>}
      {o && o.lines.some(l => l.fired) && <button type="button" className="btn btn-pos" disabled={billed.has(o.id) || o.status === 'paying'} onClick={() => { requestBill(o.id, by); toast(`Bill requested for ${table} · cashier notified`); }}>{billed.has(o.id) ? 'Bill requested' : 'Request bill'}</button>}
    </div>
    <p className="faint" style={{ fontSize: 12, textAlign: 'center' }}>Payment is taken by the cashier or by the guest via QR. Waiters can’t charge unless the owner allows it.</p>
    <Menu open={pick} onClose={() => setPick(false)} {...{ db, table, o, by, outletId }} />
  </>;
}

function Menu({ open, onClose, db, table, o, by, outletId }: { open: boolean; onClose: () => void; db: DB; table: string; o: Order | undefined; by: string; outletId: string }) {
  const [cat, setCat] = useState('all'), [q, setQ] = useState(''), [p, setP] = useState<Product | null>(null);
  const [mods, setMods] = useState<Record<string, string[]>>({}), [note, setNote] = useState('');
  const items = db.outletProducts.filter(x => x.outletId === outletId && !x.hidden).map(x => ({ x, p: db.products.find(y => y.id === x.productId)! }))
    .filter(r => r.p?.status === 'live' && (cat === 'all' || r.p.categoryId === cat) && r.p.name.toLowerCase().includes(q.toLowerCase()));
  const groups = p ? p.modifierGroupIds.map(id => db.modifierGroups.find(g => g.id === id)!).filter(Boolean) : [];
  const choose = (prod: Product) => { const gs = prod.modifierGroupIds.map(id => db.modifierGroups.find(g => g.id === id)!).filter(Boolean); setP(prod); setNote(''); setMods(Object.fromEntries(gs.filter(g => g.required).map(g => [g.id, [g.options[0].id]]))); };
  const add = () => {
    if (!p) return;
    const id = o?.id ?? newOrder(outletId, by, 'waiter', { table, type: 'dine', guests: 2, cashierId: by });
    addLine(id, p.id, groups.flatMap(g => (mods[g.id] ?? []).map(oid => g.options.find(x => x.id === oid)!).map(x => ({ name: x.name, price: x.price }))), 1, note.trim(), by);
    toast(`${p.name} added to ${table} · tap Send to kitchen`); setP(null);
  };
  const close = () => { setP(null); onClose(); };
  return <Sheet open={open} onClose={close} side="bottom" title={p ? p.name : `Add to ${table}`} sub={p ? idr(priceAt(db, p, outletId)) : 'Sold-out items are set by the kitchen or PIC for this outlet.'}
    footer={p ? <><button type="button" className="btn" onClick={() => setP(null)}>Back</button><button type="button" className="btn btn-primary" disabled={groups.some(g => g.required && !(mods[g.id]?.length))} onClick={add}>Add to {table}</button></> : undefined}>
    {p ? <div className="stack">{groups.map(g => <div key={g.id} className="stack sm"><b style={{ fontSize: 14 }}>{g.name}{g.required ? '' : ' (optional)'}</b>
      <div className="row wrap">{g.options.map(x => { const on = mods[g.id]?.includes(x.id) ?? false;
        return <button key={x.id} type="button" className="chip" aria-pressed={on} style={{ height: 44 }} onClick={() => setMods(m => { const cur = m[g.id] ?? []; const next = on ? (g.required && cur.length === 1 ? cur : cur.filter(y => y !== x.id)) : g.max === 1 ? [x.id] : [...cur, x.id].slice(-g.max); return { ...m, [g.id]: next }; })}>{x.name}{x.price ? ` +${idr(x.price)}` : ''}</button>; })}</div></div>)}
      <div className="field"><label>Note for the kitchen <span className="faint">(optional)</span></label><input className="input" value={note} onChange={e => setNote(e.target.value)} placeholder="Allergy, no ice, extra spicy…" /></div></div>
      : <div className="stack">
        <input className="search" placeholder="Search menu" value={q} onChange={e => setQ(e.target.value)} aria-label="Search menu" style={{ height: 44, fontSize: 16 }} />
        <div className="row" style={{ overflowX: 'auto' }}>{[{ id: 'all', name: 'All' }, ...db.categories].map(c => <button key={c.id} type="button" className="chip" aria-pressed={cat === c.id} onClick={() => setCat(c.id)}>{c.name}</button>)}</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 8 }}>{items.map(({ x, p: prod }) =>
          <button key={prod.id} type="button" disabled={x.is86} onClick={() => choose(prod)} style={{ minHeight: 60, padding: '8px 10px', borderRadius: 14, textAlign: 'left', cursor: x.is86 ? 'not-allowed' : 'pointer', opacity: x.is86 ? .6 : 1,
            border: `1.5px solid ${x.is86 ? 'var(--danger-soft)' : 'var(--border)'}`, background: x.is86 ? 'var(--danger-soft)' : 'var(--bg-surface)', color: 'var(--fg-1)', display: 'flex', flexDirection: 'column', gap: 2 }}>
            <b style={{ fontSize: 13 }}>{prod.name}</b><span style={{ fontSize: 12, fontWeight: 600, color: x.is86 ? 'var(--danger-fg)' : 'var(--fg-2)' }}>{x.is86 ? 'Sold out' : idr(priceAt(db, prod, outletId))}</span></button>)}</div>
        {!items.length && <p className="muted">Nothing matches.</p>}
      </div>}
  </Sheet>;
}

function Ready({ list, db, by, now }: { list: Order[]; db: DB; by: string; now: number }) {
  const bt = bumpTimes(db);
  if (!list.length) return <Empty icon="bell" title="Nothing waiting at the pass">When the kitchen bumps an order it shows here and on your Calls tab.</Empty>;
  return <>{list.map(o => <div key={o.id} className="card tight row" style={{ gap: 12 }}>
    <b style={{ fontSize: 22, minWidth: 60 }}>{o.table ?? o.no}</b>
    <span className="grow" style={{ fontSize: 13, lineHeight: 1.4 }}>{o.lines.filter(l => l.fired).map(l => `${l.qty}× ${l.name}`).join(' · ')}<br /><span className="muted">{[...new Set(o.lines.map(l => l.station))].join(' + ')} · ready {ago(bt.get(o.id) ?? o.createdAt, now)}</span></span>
    <button type="button" className="btn btn-success" style={{ height: 48 }} onClick={() => { served(o.id, by); toast(`${o.table ?? o.no} served`); }}>Served</button>
  </div>)}</>;
}
