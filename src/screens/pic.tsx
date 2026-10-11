'use client';
// PIC tablet (spec/BorNiz PIC.dc.html, layout A): dark rail of the four groups, shift header, one view per registry page.
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { pagesOf, surfaceHome } from '../system/registry.ts';
import { recordTo } from '../system/drill.ts';
import { Avatar, Badge, Empty, Icon, Kpi, Seg, Status, ago, hhmm, toast } from '../ui/kit.tsx';
import { idr, idrShort } from '../domain/money.ts';
import { LIMITS } from '../domain/approval.ts';
import { level as stockLevel } from '../domain/stock.ts';
import { clock, saveRecord } from '../data/actions.ts';
import type { Order } from '../data/schema.ts';
import { usePic, picPath as P, type PicCtx } from './pic/ctx.ts';
import { ApprovalQueue, ApprovalHistory, Escalate } from './pic/approvals.tsx';
import { CashMoves, DrawerCounts, Handover, PassPic } from './pic/cash.tsx';
import { SoldOut, StockRequest, StockCount, Incidents } from './pic/floor.tsx';
import { ROLE_LABEL, clockState, isLive, isPaid, nameOf, onSlot, slotLabel, slotTime, startOfDay, emp } from './ops/shift.ts';

const PAGES = pagesOf('pic');
const GROUPS = [...new Set(PAGES.map(p => p.group))];
const GROUP_ICON: Record<string, string> = { 'My shift': 'activity', Approvals: 'badge-check', 'Cash & handover': 'banknote', Floor: 'store' };
const CSS = `
.pic{display:grid;grid-template-columns:88px minmax(0,1fr);min-height:100dvh}
.pic-rail{position:sticky;top:0;height:100dvh;background:var(--ink-950);display:flex;flex-direction:column;gap:4px;padding:12px 8px;overflow:auto}
.pic-rail a{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;min-height:64px;padding:8px 4px;border-radius:14px;color:var(--ink-400);font-size:12px;font-weight:600;text-align:center;line-height:1.15;text-decoration:none}
.pic-rail a:hover{background:var(--ink-900);text-decoration:none}.pic-rail a[aria-current=page]{background:var(--ink-800);color:var(--ink-0)}
.pic-rail .n{position:absolute;top:4px;right:8px;min-width:20px;height:20px;padding:0 6px;border-radius:99px;background:var(--danger);color:var(--ink-0);font:700 11px/20px var(--font-display)}
.pic-main{min-width:0;padding:16px var(--margin) 96px;display:flex;flex-direction:column;gap:16px;max-width:1280px;width:100%}
.pic-tabs{display:flex;gap:6px;overflow-x:auto;padding-bottom:2px}
.pic-tabs a{flex:none;display:inline-flex;align-items:center;height:40px;padding:0 14px;border-radius:999px;border:1px solid var(--border);background:var(--bg-surface);color:var(--fg-1);font-weight:600;font-size:13px;text-decoration:none}
.pic-tabs a[aria-current=page]{background:var(--fg-1);color:var(--bg-surface);border-color:var(--fg-1)}
.pic-2{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(min(100%,340px),1fr))}
@media (max-width:767px){.pic{grid-template-columns:minmax(0,1fr)}.pic-rail{position:sticky;top:0;z-index:30;height:auto;flex-direction:row;overflow-x:auto;padding:6px}.pic-rail a{min-width:76px;min-height:56px;flex:none}}
`;

export default function Screen() {
  const c = usePic();
  const { page, db, outletId, picId, slot, mgr, meId, outlet } = c;
  const waiting = db.approvals.filter(a => a.outletId === outletId && a.status === 'waiting' && a.level === 'pic').length;
  const out86 = db.outletProducts.filter(x => x.outletId === outletId && x.is86).length;
  const badge: Record<string, number> = { Approvals: waiting, Floor: out86 };
  const sibling = PAGES.filter(p => p.group === page.group && p.path !== '/pic');
  const here = page.path === '/pic' ? P('pic-home-my-shift-now') : page.path;
  return <div className="pic" data-role="pic">
    <style>{CSS}</style>
    <nav className="pic-rail" aria-label="PIC">
      {GROUPS.map(g => { const first = PAGES.find(p => p.group === g)!; return <Link key={g} href={first.path} aria-current={page.group === g ? 'page' : undefined}>
        <Icon name={GROUP_ICON[g] ?? 'circle'} size={22} />{g}{badge[g] ? <span className="n">{badge[g]}</span> : null}</Link>; })}
      <Link href={surfaceHome('pos')}><Icon name="shopping-bag" size={22} />Register</Link>
      <Link href={surfaceHome('online')}><Icon name="bike" size={22} />Online</Link>
    </nav>
    <main className="pic-main">
      <header className="row wrap between" style={{ gap: 12 }}>
        <div className="stack sm" style={{ gap: 2 }}>
          <span className="cap">PIC · {outlet?.name} · {slotLabel(slot)} {slotTime(slot)}</span>
          <h1 style={{ fontSize: 28 }}>{page.title}</h1>
        </div>
        <div className="row card tight" style={{ padding: '8px 14px' }}>
          <Avatar name={nameOf(db, picId) || '?'} color={emp(db, picId)?.color} size={36} />
          <span className="stack" style={{ gap: 0 }}><b>{picId ? nameOf(db, picId) : 'No PIC on this shift'}</b>
            <span className="muted" style={{ fontSize: 12 }}>{picId === meId ? 'You are the PIC' : 'PIC on shift'} · reports to {mgr?.name ?? 'the manager'}</span></span>
        </div>
      </header>
      {!picId && <div className="banner b-danger">No PIC on this shift. Approvals go to {mgr?.name ?? 'the manager'} until one is assigned in Shifts.</div>}
      {picId && picId !== meId && <div className="banner b-info"><Icon name="info" size={18} />{nameOf(db, picId)} is the PIC on this shift. You can still act within your role’s limits; everything is logged with your name.</div>}
      {!db.device.online && <div className="banner b-warning"><Icon name="wifi-off" size={18} />Offline. Changes are kept on this tablet and sync when the connection is back.</div>}
      {sibling.length > 1 && <nav className="pic-tabs" aria-label={page.group}>{sibling.map(p => <Link key={p.path} href={p.path} aria-current={p.path === here ? 'page' : undefined}>{p.title}</Link>)}</nav>}
      <View c={c} />
    </main>
  </div>;
}

function View({ c }: { c: PicCtx }) {
  if (c.page.path === '/pic/floor/stock-opname') return <StockCount c={c} />;
  switch (c.page.slug) {
    case 'shift-sales-and-orders': return <Sales c={c} />;
    case 'team-on-shift-and-breaks': return <Team c={c} />;
    case 'reassign-station-table-section': return <Stations c={c} />;
    case 'approval-queue': return <ApprovalQueue c={c} />;
    case 'escalate-to-manager': return <Escalate c={c} />;
    case 'approval-history-this-shift': return <ApprovalHistory c={c} />;
    case 'confirm-drawer-counts-and-variance': return <DrawerCounts c={c} />;
    case 'cash-in-out-approval': return <CashMoves c={c} />;
    case 'handover-checklist-and-notes': return <Handover c={c} />;
    case 'pass-pic-to-another-person': return <PassPic c={c} />;
    case 'mark-items-sold-out': return <SoldOut c={c} />;
    case 'stock-request-to-manager': return <StockRequest c={c} />;
    case 'incident-log': return <Incidents c={c} />;
    default: return <Home c={c} />;
  }
}


function shiftOrders(c: PicCtx) {
  const { db, outletId, start } = c;
  const mine = db.orders.filter(o => o.outletId === outletId && o.createdAt >= start);
  const paid = mine.filter(o => isPaid(o.status));
  const live = db.orders.filter(o => o.outletId === outletId && isLive(o.status) && o.createdAt >= startOfDay(c.now));
  return { mine, paid, live, sales: paid.reduce((a, o) => a + o.total, 0) };
}
/** Who's on: the roster slot plus anyone else still clocked in at this outlet (overlaps, cover). */
function team(c: PicCtx) {
  const { db, outletId, sd, slot } = c;
  const ids = new Set(onSlot(sd, slot));
  db.employees.forEach(e => { if (e.outlets.includes(outletId) && ['in', 'break'].includes(clockState(db, e.id, outletId).state)) ids.add(e.id); });
  return [...ids].map(id => ({ id, e: emp(db, id), ...clockState(db, id, outletId), rostered: onSlot(sd, slot).includes(id) })).filter(x => x.e);
}
const STATE_TONE = { in: 'success', break: 'warning', out: 'neutral', none: 'neutral' } as const;
const stateText = (s: { state: string; at: number | null }) => s.state === 'in' ? 'On · since ' + hhmm(s.at!) : s.state === 'break' ? 'Break since ' + hhmm(s.at!) : s.state === 'out' ? 'Clocked out ' + hhmm(s.at!) : 'Not clocked in';

function Home({ c }: { c: PicCtx }) {
  const { db, outletId, slot, now, meId, start } = c;
  const { live, paid, sales } = shiftOrders(c);
  const waiting = db.approvals.filter(a => a.outletId === outletId && a.status === 'waiting' && a.level === 'pic');
  const crew = team(c), onNow = crew.filter(x => x.state === 'in').length, onBreak = crew.filter(x => x.state === 'break');
  const late = live.filter(o => now - o.createdAt > 10 * 60e3 && !['ready', 'served'].includes(o.status));
  const mineDone = db.approvals.filter(a => a.outletId === outletId && a.decidedBy === meId && a.status === 'approved' && (a.decidedAt ?? 0) >= start);
  const sumOf = (t: string[]) => mineDone.filter(a => t.includes(a.type)).reduce((x, a) => x + a.amount, 0);
  const ho = db.records.handover?.find(r => r.id === `${outletId}|${c.date}|${slot}`);
  const ticked = ho ? (JSON.parse(ho.c || '[]') as number[]).length : 0;
  const floor = useFloor(c, live);
  return <>
    <div className="grid" style={{ ['--min' as string]: '170px' }}>
      <Kpi label="Shift sales" value={idrShort(sales)} delta={`Since ${hhmm(start)} · ${paid.length} orders`} tone="up" />
      <Kpi label="Approvals" value={waiting.length} delta={waiting.length ? 'Waiting for you' : 'All clear'} tone={waiting.length ? 'down' : 'up'} />
      <Kpi label="Open orders" value={live.length} delta={late.length ? `${late.length} over 10 min` : 'None late'} tone={late.length ? 'warn' : undefined} />
      <Kpi label="On shift" value={`${onNow} of ${crew.length}`} delta={onBreak.length ? `${onBreak.map(x => x.e!.name).join(', ')} on break` : 'Nobody on break'} />
    </div>
    <div className="pic-2">
      <section className="card stack">
        <div className="row between"><h3>Approvals · {waiting.length} waiting</h3><Link className="btn btn-sm" href={P('approval-queue')}>Open all</Link></div>
        {waiting.length === 0 ? <p className="muted">Nothing waiting. Cashier requests within your limits land here.</p>
          : waiting.slice(0, 3).map(a => <div key={a.id} className="row between sunken" style={{ padding: '10px 12px' }}><span className="grow"><b>{a.type === 'cash_out' ? 'Cash out' : a.type[0].toUpperCase() + a.type.slice(1)}</b> · {a.title}</span><b className="num">{a.type === 'discount' ? a.pct + '%' : idr(a.amount)}</b></div>)}
      </section>
      <section className="card stack">
        <h3>My limits this shift</h3>
        {[['Discount', `up to ${LIMITS.picDiscountPct}% per bill`, mineDone.filter(a => a.type === 'discount').length + ' approved'],
          ['Void & refund', `up to ${idr(LIMITS.pic)} each`, idr(sumOf(['void', 'refund'])) + ' approved'],
          ['Cash out', `up to ${idr(LIMITS.pic)} each`, idr(sumOf(['cash_out'])) + ' approved'],
          ['Drawer variance, waste, opname', `up to ${idr(LIMITS.picVariance)}`, idr(sumOf(['variance', 'waste', 'opname'])) + ' signed']].map(([l, lim, used]) =>
          <div key={l} className="row between" style={{ fontSize: 14 }}><span className="grow"><b>{l}</b><br /><span className="muted">{lim}</span></span><span className="muted">{used}</span></div>)}
        <span className="faint" style={{ fontSize: 13 }}>Over the limit goes to {c.mgr?.name ?? 'the manager'} automatically.</span>
      </section>
    </div>
    <div className="pic-2">
      <section className="card stack">
        <div className="row between"><h3>Team on shift</h3><Link className="btn btn-sm" href={P('team-on-shift-and-breaks')}>Breaks</Link></div>
        {crew.length === 0 ? <p className="muted">Nobody rostered or clocked in for this shift.</p> : crew.map(x => <div key={x.id} className="row">
          <Avatar name={x.e!.name} color={x.e!.color} size={32} /><span className="grow"><b>{x.e!.name}</b> · {ROLE_LABEL[x.e!.role]}{x.id === c.picId ? ' · PIC' : ''}</span>
          <Badge tone={STATE_TONE[x.state]}>{stateText(x)}</Badge></div>)}
      </section>
      <section className="card stack">
        <h3>Floor right now</h3>
        {floor.length === 0 ? <p className="muted">All calm. No late orders, low stock or offline devices.</p> : floor.map((f, i) => <Link key={i} href={f.href} className="row" style={{ color: 'var(--fg-1)', minHeight: 36 }}>
          <Badge tone={f.tone} dot>{f.tag}</Badge><span className="grow" style={{ fontSize: 14 }}>{f.text}</span><Icon name="chevron-right" size={16} /></Link>)}
      </section>
      <section className="card stack">
        <h3>Handover at {slotTime(slot).split('–')[1]}</h3>
        <span className="muted">{ho?.e ? `Closed by ${nameOf(db, ho.e)} · ${hhmm(ho.at)}` : `${ticked} of 6 done`}</span>
        <div style={{ height: 8, borderRadius: 99, background: 'var(--bg-sunken)' }}><div style={{ width: `${ho?.e ? 100 : ticked / 6 * 100}%`, height: '100%', borderRadius: 99, background: 'var(--role)' }} /></div>
        <Link className="btn" href={P('handover-checklist-and-notes')}>Open checklist</Link>
      </section>
    </div>
  </>;
}

type FloorItem = { tag: string; text: string; tone: 'danger' | 'warning' | 'info' | 'neutral'; href: string };
function useFloor(c: PicCtx, live: Order[]): FloorItem[] {
  const { db, outletId, now } = c;
  return useMemo(() => {
    const out: FloorItem[] = [];
    live.filter(o => ['gofood', 'grabfood', 'shopeefood', 'web'].includes(o.source) && o.status === 'open')
      .forEach(o => out.push({ tag: 'Online', text: `${o.source} ${o.no} waiting ${Math.round((now - o.createdAt) / 60e3)} min to be accepted`, tone: 'danger', href: surfaceHome('online') }));
    live.filter(o => now - o.createdAt > 10 * 60e3 && ['sent', 'preparing'].includes(o.status))
      .forEach(o => out.push({ tag: 'Late', text: `${o.no}${o.table ? ' · ' + o.table : ''} in the kitchen ${Math.round((now - o.createdAt) / 60e3)} min`, tone: 'warning', href: P('shift-sales-and-orders') }));
    db.stockItems.forEach(s => { const l = stockLevel(db.movements, outletId, s.id); if (l < s.par) out.push({ tag: 'Low stock', text: `${s.name} ${+l.toFixed(1)} ${s.unit} left (par ${s.par})`, tone: 'warning', href: P('stock-request-to-manager') }); });
    const sold = db.outletProducts.filter(x => x.outletId === outletId && x.is86);
    if (sold.length) out.push({ tag: 'Sold out', text: sold.map(x => db.products.find(p => p.id === x.productId)?.name).join(', '), tone: 'neutral', href: P('mark-items-sold-out') });
    db.devices.filter(d => d.outletId === outletId && d.status === 'offline').forEach(d => out.push({ tag: 'Device', text: `${d.name} offline ${ago(d.lastSeen, now).replace(' ago', '')}`, tone: 'danger', href: P('pic-home-my-shift-now') }));
    db.reservations.filter(r => r.outletId === outletId && r.status === 'booked' && r.at > now && r.at - now < 2 * 3600e3)
      .forEach(r => out.push({ tag: 'Booking', text: `${r.name} · ${r.guests} pax · ${hhmm(r.at)} · ${r.table}`, tone: 'info', href: P('reassign-station-table-section') }));
    return out.slice(0, 7);
  }, [db, outletId, now, live]);
}

function Sales({ c }: { c: PicCtx }) {
  const { db, start, user, go } = c;
  const { mine, paid, live, sales } = shiftOrders(c);
  const [f, setF] = useState<'all' | 'open' | 'paid'>('all');
  const pays = db.payments.filter(p => p.status === 'settled' && paid.some(o => o.id === p.orderId));
  const cash = pays.filter(p => p.method === 'cash' && p.ref !== 'ROUNDING').reduce((a, p) => a + p.amount, 0);
  const rows = (f === 'open' ? live : f === 'paid' ? paid : [...new Set([...live, ...mine])]).sort((a, b) => b.createdAt - a.createdAt);
  return <>
    <div className="grid" style={{ ['--min' as string]: '170px' }}>
      <Kpi label="Shift sales" value={idrShort(sales)} delta={`Since ${hhmm(start)}`} />
      <Kpi label="Paid orders" value={paid.length} delta={`Avg ${idrShort(paid.length ? sales / paid.length : 0)}`} />
      <Kpi label="Cash" value={idrShort(cash)} delta={`Non-cash ${idrShort(sales - cash)}`} />
      <Kpi label="Open now" value={live.length} />
    </div>
    <section className="card flat">
      <div className="row between" style={{ padding: 16 }}><h3>Orders this shift</h3><Seg value={f} onChange={setF} options={[['all', 'All'], ['open', 'Open'], ['paid', 'Paid']] as const} label="Filter" /></div>
      {rows.length === 0 ? <Empty icon="receipt" title="No orders yet this shift">Orders from the register, QR, kiosk and delivery apps show here as they come in.</Empty>
        : <div className="scroll-x"><table className="table"><thead><tr><th>Order</th><th>Where</th><th>Items</th><th>Time</th><th>Status</th><th className="r">Total</th></tr></thead>
          <tbody>{rows.slice(0, 80).map(o => { const to = recordTo('order', o.id, user.role); return <tr key={o.id} className={to ? 'click' : undefined} onClick={to ? () => go(to) : undefined}><td className="mono">{o.no}</td><td>{o.table ?? (o.type === 'delivery' ? o.source : o.type === 'take' ? 'Takeaway' : o.source)}</td>
            <td style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.lines.map(l => `${l.qty}× ${l.name}`).join(', ')}</td><td>{hhmm(o.createdAt)}</td><td><Status s={o.status} /></td><td className="r num">{idr(o.total)}</td></tr>; })}</tbody></table></div>}
    </section>
  </>;
}

function Team({ c }: { c: PicCtx }) {
  const { db, outletId, meId } = c;
  const crew = team(c);
  const act = (id: string, kind: 'in' | 'out' | 'break', msg: string) => { clock(id, outletId, kind); toast(msg); };
  if (!crew.length) return <Empty icon="users" title="Nobody on this shift yet">The roster for this shift is empty. Ask {c.mgr?.name ?? 'the manager'} to add people in Shifts.</Empty>;
  return <>
    <div className="grid" style={{ ['--min' as string]: '280px' }}>
      {crew.map(x => { const st = db.records.station?.find(r => r.id === `${outletId}|${c.date}|${x.id}`); return <div key={x.id} className="card tight stack sm">
        <div className="row"><Avatar name={x.e!.name} color={x.e!.color} /><span className="grow"><b>{x.e!.name}</b><br /><span className="muted" style={{ fontSize: 13 }}>{ROLE_LABEL[x.e!.role]}{x.id === c.picId ? ' · PIC' : ''}{st ? ' · ' + st.c : ''}{!x.rostered ? ' · not on this shift' : ''}</span></span>
          <Badge tone={STATE_TONE[x.state]}>{stateText(x)}</Badge></div>
        <div className="row wrap">
          {(x.state === 'none' || x.state === 'out') && <button className="btn btn-sm" onClick={() => act(x.id, 'in', `${x.e!.name} clocked in`)}>Clock in</button>}
          {x.state === 'in' && <button className="btn btn-sm" onClick={() => act(x.id, 'break', `Break started for ${x.e!.name}`)}>Start break</button>}
          {x.state === 'break' && <button className="btn btn-sm btn-primary" onClick={() => act(x.id, 'in', `${x.e!.name} back from break`)}>End break</button>}
          {x.id === meId && x.state !== 'none' && x.state !== 'out' && <button className="btn btn-sm btn-ghost" onClick={() => act(x.id, 'out', 'You clocked out')}>Clock out</button>}
        </div>
      </div>; })}
    </div>
    <p className="faint" style={{ fontSize: 13 }}>You can log breaks and move people between stations. Roster changes are done by {c.mgr?.name ?? 'the manager'} in Shifts.</p>
  </>;
}

const STATIONS = ['Register 1', 'Register 2', 'Bar', 'Kitchen', 'Pastry', 'Floor', 'Runner'];
function Stations({ c }: { c: PicCtx }) {
  const { db, outletId, date, slot, meId, outlet } = c;
  const crew = team(c);
  const n = outlet?.tables ?? 0, sections = ['—', ...Array.from({ length: Math.ceil(n / 4) }, (_, i) => `T-${String(i * 4 + 1).padStart(2, '0')} – T-${String(Math.min(n, i * 4 + 4)).padStart(2, '0')}`)];
  const save = (id: string, patch: { c?: string; d?: string }) => {
    const cur = db.records.station?.find(r => r.id === `${outletId}|${date}|${id}`);
    saveRecord('station', { id: `${outletId}|${date}|${id}`, a: outletId, b: id, c: patch.c ?? cur?.c ?? STATIONS[0], d: patch.d ?? cur?.d ?? '—', e: slot, at: Date.now() }, meId);
    toast(`${nameOf(db, id)} moved · logged`);
  };
  if (!crew.length) return <Empty icon="users" title="Nobody on this shift yet" />;
  return <section className="card flat">
    <div className="scroll-x"><table className="table"><thead><tr><th>Person</th><th>Station</th><th>Table section</th><th>Since</th></tr></thead>
      <tbody>{crew.map(x => { const st = db.records.station?.find(r => r.id === `${outletId}|${date}|${x.id}`); return <tr key={x.id}>
        <td><div className="row"><Avatar name={x.e!.name} color={x.e!.color} size={28} /><b>{x.e!.name}</b><span className="muted">{ROLE_LABEL[x.e!.role]}</span></div></td>
        <td><select className="input" style={{ height: 44, minWidth: 140 }} value={st?.c ?? ''} onChange={e => save(x.id, { c: e.target.value })} aria-label={`Station for ${x.e!.name}`}><option value="" disabled>Pick station</option>{STATIONS.map(s => <option key={s}>{s}</option>)}</select></td>
        <td><select className="input" style={{ height: 44, minWidth: 150 }} value={st?.d ?? '—'} onChange={e => save(x.id, { d: e.target.value })} aria-label={`Section for ${x.e!.name}`}>{sections.map(s => <option key={s}>{s}</option>)}</select></td>
        <td className="muted">{st ? hhmm(st.at) : '—'}</td></tr>; })}</tbody></table></div>
    <p className="faint" style={{ fontSize: 13, padding: 16 }}>Tickets and tables belong to the outlet, not the person; waiters see their section on the waiter app.</p>
  </section>;
}
