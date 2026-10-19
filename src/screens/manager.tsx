'use client';
// Manager dashboard (spec/BorNiz Manager Dashboard.dc.html, layout A "sidebar + today"): owner's tools scoped to the
// manager's outlets (me.outlets). Approvals one tap with reason + PIN; owner-gated requests show "Send to owner".
import Link from '../ui/Link.tsx';
import { useMemo, useState } from 'react';
import { useApp } from '../app/context.tsx';
import { widgetsFor } from '../system/tools.ts';
import { pagesOf } from '../system/registry.ts';
import { LineChart, type Series } from '../ui/Chart.tsx';
import { usePin } from '../ui/PinSheet.tsx';
import { Avatar, Badge, Empty, Icon, Kpi, Status, ago, hhmm, human, toast, useNow } from '../ui/kit.tsx';
import { idr, idrShort } from '../domain/money.ts';
import { ESCALATE_MS, LIMITS } from '../domain/approval.ts';
import { expectedCash } from '../domain/shift.ts';
import { level as stockLevel } from '../domain/stock.ts';
import { sessionCash } from '../data/actions.ts';
import { closeDay, sendToOwner } from '../data/actions/manager.ts';
import type { Approval, DB } from '../data/schema.ts';
import { ApprovalCard, OpnameProof, useDecide, whyBlocked } from './ops/approvals.tsx';
import { allowed } from './ops/perm.ts';
import { ROLE_LABEL, attendance, clockState, dateKey, emp, isLive, isPaid, nameOf, onSlot, rosterDay, slotLabel, slotNow, slotOf, slotTime, startOfDay, longDate } from './ops/shift.ts';
import { KIND_SLUG, NewSheet } from './manager/create.tsx';
import { holdsTable, tableNames } from '../domain/tables.ts';

const PAGES = pagesOf('manager');
const P = (slug: string) => PAGES.find(p => p.slug === slug)?.path ?? '/manager';
const DAY = 864e5, HOURS = Array.from({ length: 16 }, (_, i) => i + 7);
const fmt = (v: number) => idrShort(v);
const TABS: [string, string, string][] = [['manager', 'Today', 'activity'], ['live-monitor', 'Live monitor', 'radio'], ['outlet-overview', 'Outlet overview', 'store'], ['daily-cash-reconciliation-and-close', 'Cash close', 'banknote']];

function useMgr() {
  const app = useApp();
  const now = useNow(30e3);
  const { db, user, me, outletId } = app;
  const scope = user.role === 'owner' ? db.outlets.map(o => o.id) : (me?.outlets ?? [outletId]);
  return { ...app, now, scope, meId: me?.id ?? user.id, here: scope.includes(outletId) ? outletId : scope[0] };
}
type Ctx = ReturnType<typeof useMgr>;

export default function Screen() {
  const c = useMgr();
  const { page, db, scope, now } = c;
  const create = page.slug === 'plus-new-action-sheet' || page.slug in KIND_SLUG;
  const view = create ? 'manager' : page.slug;
  const names = scope.map(id => db.outlets.find(o => o.id === id)?.name).join(' + ');
  return <div className="stack lg">
    <header className="stack sm">
      <span className="cap">{longDate(now)} · {names} · owner approves prices & publishing</span>
      <div className="row wrap between">
        <h1>{view === 'manager' ? 'Business today' : page.title}</h1>
        <Link href={P('plus-new-action-sheet')} className="btn btn-primary"><Icon name="plus" />New</Link>
      </div>
      <nav className="row" style={{ overflowX: 'auto', paddingBottom: 2 }} aria-label="Manager">{TABS.map(([slug, l, ic]) => { const on = view === slug; return <Link key={slug} href={P(slug)} className="chip row" aria-current={on ? 'page' : undefined}
        style={{ textDecoration: 'none', height: 40, color: on ? 'var(--bg-surface)' : 'var(--fg-1)', background: on ? 'var(--fg-1)' : undefined }}><Icon name={ic} size={16} />{l}</Link>; })}</nav>
    </header>
    {!db.device.online && <div className="banner b-warning"><Icon name="wifi-off" size={18} />Offline. Numbers are from the last sync; approvals are sent when the connection is back.</div>}
    {view === 'live-monitor' ? <Live c={c} /> : view === 'outlet-overview' ? <Overview c={c} /> : view === 'daily-cash-reconciliation-and-close' ? <CashClose c={c} /> : <Today c={c} />}
    <NewSheet open={create} kind={KIND_SLUG[page.slug] ?? null} scope={scope} />
  </div>;
}

// ── Numbers ─────────────────────────────────────────────────────────────────────────────
function sales(db: DB, outlets: string[], from: number, to: number) {
  const os = db.orders.filter(o => outlets.includes(o.outletId) && isPaid(o.status) && o.paidAt != null && o.paidAt >= from && o.paidAt < to);
  return { n: os.length, rev: os.reduce((a, o) => a + o.total, 0), os };
}
const pct = (a: number, b: number) => (b ? Math.round((a / b - 1) * 100) : 0);
const delta = (a: number, b: number, label = 'same time last week') => { const p = pct(a, b); return { text: `${p >= 0 ? '+' : '−'}${Math.abs(p)}% vs ${label}`, tone: p >= 0 ? 'up' as const : 'down' as const }; };

// ── Today ───────────────────────────────────────────────────────────────────────────────
function Today({ c }: { c: Ctx }) {
  const { db, scope, now, meId, user, me } = c;
  const dz = useDecide();
  const t0 = startOfDay(now), lw = t0 - 7 * DAY;
  const today = sales(db, scope, t0, now), last = sales(db, scope, lw, lw + (now - t0));
  const live = db.orders.filter(o => scope.includes(o.outletId) && isLive(o.status) && o.createdAt >= t0);
  const drawer = db.sessions.filter(s => scope.includes(s.outletId) && s.status === 'open');
  // Series are rebuilt only when the numbers change, so the chart doesn't redraw on every unrelated write.
  const by = (os: { paidAt: number | null; total: number }[], base: number) => HOURS.map(h => os.filter(o => o.paidAt! >= base + h * 3600e3 && o.paidAt! < base + (h + 1) * 3600e3).reduce((a, o) => a + o.total, 0));
  const curH = new Date(now).getHours();
  const raw = [by(today.os, t0).map((v, i) => (HOURS[i] <= curH ? v : NaN)), by(sales(db, scope, lw, lw + DAY).os, lw)];
  const key = JSON.stringify(raw);
  const lwName = new Date(lw).toLocaleDateString('en-GB', { weekday: 'long' });
  const { labels, series } = useMemo(() => ({ labels: HOURS.map(h => String(h).padStart(2, '0')),
    series: [{ label: 'Today', data: raw[0] }, { label: 'Last ' + lwName, data: raw[1], compare: true }] as Series[] }), [key, lwName]); // eslint-disable-line react-hooks/exhaustive-deps
  const waiting = db.approvals.filter(a => scope.includes(a.outletId) && a.status === 'waiting');
  const forMe = waiting.filter(a => a.level === 'manager');
  const gated = waiting.filter(a => a.level === 'owner' && a.requestedBy !== meId && !(a.payload as { sentBy?: string } | undefined)?.sentBy);
  const atPic = waiting.filter(a => a.level === 'pic');
  const ownerList = db.approvals.filter(a => scope.includes(a.outletId) && a.level === 'owner' && (a.requestedBy === meId || (a.payload as { sentBy?: string } | undefined)?.sentBy === meId) && a.at > now - 14 * DAY).slice(0, 10);
  const low = scope.flatMap(o => db.stockItems.filter(s => stockLevel(db.movements, o, s.id) < s.par).map(s => ({ o, s })));
  const needs = ([
    { n: forMe.length + gated.length, t: 'approvals over the PIC limit', d: `PICs decided ${db.approvals.filter(a => scope.includes(a.outletId) && a.level === 'pic' && (a.decidedAt ?? 0) >= t0).length} today; these need you`, href: '#needs', tone: 'warning' },
    { n: low.length, t: 'items below par', d: low.slice(0, 3).map(x => x.s.name).join(', '), href: '/owner/inventory/low-stock-alerts-and-reorder-rules', tone: 'danger' },
    { n: atPic.filter(a => now - a.at > (ESCALATE_MS.pic ?? 0)).length, t: 'PIC requests waiting over 5 min', d: 'They come to you next', href: '#needs', tone: 'info' },
    { n: db.sessions.filter(s => scope.includes(s.outletId) && s.status === 'needs_approval').length, t: 'drawer variances to sign', d: 'Over the PIC limit', href: P('daily-cash-reconciliation-and-close'), tone: 'warning' },
  ] as const).filter(x => x.n > 0).map(x => <Link key={x.t} href={x.href} className="row sunken" style={{ color: 'var(--fg-1)', padding: '10px 12px' }}>
    <Badge tone={x.tone} dot>{x.n}</Badge><span className="grow"><b>{x.t}</b><br /><span className="muted" style={{ fontSize: 13 }}>{x.d}</span></span><Icon name="chevron-right" size={16} /></Link>);
  const d1 = delta(today.rev, last.rev), d2 = delta(today.n, last.n);
  const avg = today.n ? today.rev / today.n : 0, avgL = last.n ? last.rev / last.n : 0;
  const wg = widgetsFor(db, 'manager'), show = (k: string) => !wg || wg.on.includes(k); // Studios › Dashboard widgets per role
  return <>
    {dz.sheet}
    {show('w_rev') && <div className="grid" style={{ ['--min' as string]: '180px' }}>
      <Kpi label="Sales today" value={idrShort(today.rev)} delta={d1.text} tone={d1.tone} />
      <Kpi label="Orders" value={today.n} delta={d2.text} tone={d2.tone} />
      <Kpi label="Avg ticket" value={idrShort(avg)} delta={delta(avg, avgL).text} tone={delta(avg, avgL).tone} />
      <Kpi label="Open orders" value={live.length} delta={`${live.filter(o => now - o.createdAt > 10 * 60e3).length} over 10 min`} tone={live.some(o => now - o.createdAt > 10 * 60e3) ? 'warn' : undefined} />
      <Kpi label="Drawer cash" value={idrShort(drawer.reduce((a, s) => a + expectedCash(sessionCash(db, s.id)), 0))} delta={`${drawer.length} session${drawer.length === 1 ? '' : 's'} open`} />
      <Kpi label="Approvals" value={forMe.length + gated.length} delta={forMe.length + gated.length ? 'Waiting for you' : 'All clear'} tone={forMe.length + gated.length ? 'down' : 'up'} />
    </div>}
    <div className="grid" style={{ ['--min' as string]: '360px' }}>
      {show('w_trend') && <section className="card stack">
        <div className="row between wrap"><h3>Sales by hour · today vs last week</h3><span className="row" style={{ fontSize: 12 }}><span className="row"><i style={{ width: 16, height: 3, background: 'var(--role)', borderRadius: 2 }} />Today</span><span className="row faint"><i style={{ width: 16, borderTop: '2px dashed var(--ink-300)' }} />{series[1].label}</span></span></div>
        {today.n === 0 && last.n === 0 ? <Empty icon="chart-line" title="No sales yet today" /> : <LineChart labels={labels} series={series} height={260} format={fmt} />}
      </section>}
      {(show('w_alert') || show('w_stock')) && <section className="card stack">
        <h3>Needs you now</h3>
        {needs.length === 0 ? <p className="muted">Nothing needs you right now.</p> : needs}
      </section>}
    </div>
    <section className="stack" id="needs">
      <div className="row between wrap"><h2>Approvals</h2><Badge tone="info">Approve or reject · each asks your PIN</Badge></div>
      {forMe.length + gated.length === 0 ? <div className="card"><Empty icon="badge-check" title="All clear">Requests over the PIC limit from {scope.map(id => db.outlets.find(o => o.id === id)?.name).join(' and ')} land here.</Empty></div> : <>
        {forMe.map(a => <Row key={a.id} c={c} a={a} run={dz.run} />)}
        {gated.map(a => <ApprovalCard key={a.id} a={a}>
          <Badge tone="accent">Over your limit · owner decides</Badge>
          <button className="btn btn-primary" onClick={() => { sendToOwner(a.id, 'Checked by manager', meId); toast('Sent to owner'); }}><Icon name="send" size={16} />Send to owner</button>
        </ApprovalCard>)}
      </>}
      {atPic.length > 0 && <span className="muted" style={{ fontSize: 13 }}>{atPic.length} more at PIC level ({atPic.map(a => db.outlets.find(o => o.id === a.outletId)?.name).filter((x, i, l) => l.indexOf(x) === i).join(', ')}). You can decide them too from the PIC queue if the PIC is busy.</span>}
    </section>
    <section className="card flat">
      <div className="row between" style={{ padding: 16 }}><h3>Waiting for owner</h3><Badge>Read only</Badge></div>
      {ownerList.length === 0 ? <Empty icon="send" title="Nothing sent to the owner">Purchases, repairs, new menu items and anything over {idr(LIMITS.manager)} show here with the owner’s answer.</Empty>
        : <div className="scroll-x"><table className="table"><thead><tr><th>Request</th><th>Type</th><th>Sent</th><th>Status</th><th>Answer</th></tr></thead>
          <tbody>{ownerList.map(a => <tr key={a.id}><td><b>{a.title}</b></td><td>{human(a.type)}</td><td>{ago(a.at, now)}</td><td><Status s={a.status === 'waiting' ? 'waiting' : a.status} /></td>
            <td className="muted">{a.decidedBy ? `${nameOf(db, a.decidedBy)} · ${hhmm(a.decidedAt!)}${a.decisionNote ? ' · ' + a.decisionNote : ''}` : '—'}</td></tr>)}</tbody></table></div>}
    </section>
    {!allowed(db, user.role, me, 'Approve opname variance', c.here) && <span className="faint" style={{ fontSize: 13 }}>Opname variances at this outlet are signed by the owner (permission matrix).</span>}
  </>;
}

function Row({ c, a, run }: { c: Ctx; a: Approval; run: ReturnType<typeof useDecide>['run'] }) {
  const b = whyBlocked(c.db, c.user.role, c.me, c.meId, a);
  return <ApprovalCard a={a} foot={a.type === 'opname' ? <OpnameProof a={a} /> : undefined}>
    {b ? <Badge tone="warning">{b}</Badge> : <>
      <button className="btn btn-success" onClick={() => run(a, 'approved')}>{a.type === 'opname' || a.type === 'variance' ? 'Sign' : 'Approve'}</button>
      {a.type === 'opname' && <button className="btn" onClick={() => run(a, 'recount')}>Ask recount</button>}
      <button className="btn btn-danger" onClick={() => run(a, 'rejected')}>{a.type === 'variance' ? 'Ask recount' : 'Reject'}</button>
    </>}
  </ApprovalCard>;
}

// ── Daily cash reconciliation & close ───────────────────────────────────────────────────
function CashClose({ c }: { c: Ctx }) {
  const { db, here, now, meId, user, me } = c;
  const dz = useDecide();
  const pin = usePin();
  const t0 = startOfDay(now), date = dateKey(now);
  const sessions = db.sessions.filter(s => s.outletId === here && (s.openedAt >= t0 || s.status !== 'closed' || (s.closedAt ?? 0) >= t0));
  const pays = db.payments.filter(p => p.outletId === here && p.status === 'settled' && p.ref !== 'ROUNDING' && p.at >= t0); // cash rounding moves no money
  const sum = (m: string[]) => pays.filter(p => m.includes(p.method)).reduce((a, p) => a + p.amount, 0);
  const totals = { cash: sum(['cash']), qris: sum(['qris']), cardWallet: sum(['card', 'ewallet', 'va']), other: sum(['deposit', 'kasbon']), variance: sessions.reduce((a, s) => a + (s.variance ?? 0), 0) };
  const pending = sessions.filter(s => s.status !== 'closed');
  const varW = db.approvals.filter(a => a.outletId === here && a.type === 'variance' && a.status === 'waiting');
  const closed = db.records.day_close?.find(r => r.id === `${here}|${date}`);
  const can = allowed(db, user.role, me, 'Close cash for the day', here);
  const outlet = db.outlets.find(o => o.id === here);
  const sign = () => pin.ask({ title: `${outlet?.name} · ${longDate(now)}`, verb: 'Sign & close the day', detail: `Cash ${idr(totals.cash)} · QRIS ${idr(totals.qris)} · variance ${idr(totals.variance)}. The Z report goes to the owner.`, onOk: by => { closeDay(here, date, totals, by); toast('Day closed · Z report sent to owner'); } });
  return <>
    {dz.sheet}{pin.sheet}
    <div className="banner b-info">Counts come from each drawer at the register, blind. Confirm or ask for a recount; numbers can’t be typed in here. {c.scope.length > 1 && 'Switch outlet in the top bar.'}</div>
    <section className="card flat">
      <div className="row between" style={{ padding: 16 }}><h3>Drawer sessions · {outlet?.name}</h3><span className="muted">{sessions.length} today</span></div>
      {sessions.length === 0 ? <Empty icon="banknote" title="No drawer sessions today">Sessions open when a cashier starts a drawer on the register.</Empty> : <div className="scroll-x"><table className="table">
        <thead><tr><th>Drawer session</th><th className="r">Counted</th><th className="r">Expected</th><th className="r">Variance</th><th>Status</th><th>Note</th><th /></tr></thead>
        <tbody>{sessions.map(s => { const ap = varW.find(a => a.subjectId === s.id); const b = ap && whyBlocked(db, user.role, me, meId, ap); return <tr key={s.id}>
          <td><b>{nameOf(db, s.cashierId)}</b> · <span className="mono">{s.id}</span><br /><span className="faint" style={{ fontSize: 12 }}>{slotLabel(slotOf(s.openedAt))} {hhmm(s.openedAt)}–{s.closedAt ? hhmm(s.closedAt) : 'now'}</span></td>
          <td className="r num">{s.counted != null ? idr(s.counted) : '—'}</td><td className="r num">{idr(expectedCash(sessionCash(db, s.id)))}</td>
          <td className={'r num ' + (s.variance ? 'down' : s.variance === 0 ? 'up' : '')}>{s.variance != null ? idr(s.variance) : '—'}</td>
          <td><Status s={s.status} /></td><td className="muted" style={{ maxWidth: 200 }}>{s.note || '—'}</td>
          <td>{ap && (b ? <Badge tone="warning">{ap.level === 'owner' ? 'Owner signs' : b}</Badge> : <div className="row"><button className="btn btn-sm btn-success" onClick={() => dz.run(ap, 'approved')}>Sign</button><button className="btn btn-sm btn-danger" onClick={() => dz.run(ap, 'rejected')}>Ask recount</button></div>)}</td>
        </tr>; })}</tbody></table></div>}
    </section>
    <div className="grid" style={{ ['--min' as string]: '170px' }}>
      <Kpi label="Cash" value={idrShort(totals.cash)} />
      <Kpi label="QRIS (settles T+1)" value={idrShort(totals.qris)} />
      <Kpi label="Card & e-wallet" value={idrShort(totals.cardWallet)} />
      <Kpi label="Variance today" value={idr(totals.variance)} tone={totals.variance ? 'down' : 'up'} delta={totals.variance ? 'Every variance has a note' : 'No variance'} />
    </div>
    {closed ? <div className="banner b-success"><Icon name="circle-check" size={18} /><span><b>Day closed</b> by {nameOf(db, closed.c)} at {hhmm(closed.at)} · Z report sent to the owner.</span></div>
      : !can ? <Badge>Closing the day isn’t on for your role here</Badge>
      : <div className="row wrap"><button className="btn btn-primary btn-lg" disabled={pending.length > 0 || varW.length > 0} onClick={sign}>Close the day</button>
        <span className="muted" style={{ fontSize: 13 }}>{pending.length ? `${pending.length} session${pending.length > 1 ? 's' : ''} still open or waiting · close the day after the last session` : varW.length ? 'Sign the variances first' : 'All sessions closed and signed'}</span></div>}
  </>;
}

// ── Live monitor (one outlet) ───────────────────────────────────────────────────────────
function Live({ c }: { c: Ctx }) {
  const { db, here, user } = c;
  const now = useNow(15e3);
  const t0 = startOfDay(now), outlet = db.outlets.find(o => o.id === here)!;
  const today = sales(db, [here], t0, now);
  const live = db.orders.filter(o => o.outletId === here && isLive(o.status) && o.createdAt >= t0).sort((a, b) => a.createdAt - b.createdAt);
  const slot = slotNow(now), sd = rosterDay(db, here);
  const crew = onSlot(sd, slot);
  const tables = tableNames(outlet);
  const used = new Set(db.orders.filter(o => o.outletId === here && holdsTable(o)).map(o => o.table));
  const booked = new Set(db.reservations.filter(r => r.outletId === here && r.status === 'booked' && r.at >= t0 && r.at < t0 + DAY).map(r => r.table));
  const online = live.filter(o => ['gofood', 'grabfood', 'shopeefood', 'web'].includes(o.source) && o.status === 'open');
  const sold = db.outletProducts.filter(x => x.outletId === here && x.is86).map(x => db.products.find(p => p.id === x.productId)?.name);
  const offline = db.devices.filter(d => d.outletId === here && d.status === 'offline');
  const feed = db.audit.filter(a => a.outletId === here).slice(0, 10);
  const age = (t: number) => { const m = Math.floor((now - t) / 60e3); return `${String(m).padStart(2, '0')}:${String(Math.floor((now - t) / 1e3) % 60).padStart(2, '0')}`; };
  return <>
    <div className="row wrap"><Badge tone="success" dot>Live</Badge><span className="muted">{outlet.name} · {slotLabel(slot)} {slotTime(slot)} · PIC {nameOf(db, sd?.slots[slot].pic) || 'none'}{c.scope.length > 1 && user.role !== 'pic' ? ' · switch outlet in the top bar' : ''}</span></div>
    <div className="grid" style={{ ['--min' as string]: '170px' }}>
      <Kpi label="Sales today" value={idrShort(today.rev)} delta={`${today.n} orders`} />
      <Kpi label="Open orders" value={live.length} delta={`${live.filter(o => now - o.createdAt > 10 * 60e3).length} over 10 min`} />
      <Kpi label="Tables in use" value={`${used.size} of ${outlet.tables}`} delta={`${booked.size} booked today`} />
      <Kpi label="Online waiting" value={online.length} tone={online.length ? 'down' : undefined} delta={online.length ? 'Accept on the register' : 'None'} />
    </div>
    <div className="grid" style={{ ['--min' as string]: '320px' }}>
      <section className="card stack">
        <h3>Orders in progress</h3>
        {live.length === 0 ? <p className="muted">No open orders right now.</p> : live.slice(0, 10).map(o => { const m = (now - o.createdAt) / 60e3; return <div key={o.id} className="row" style={{ fontSize: 14 }}>
          <b className="mono">{o.table ?? o.no}</b><span className="grow muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.source !== 'pos' ? o.source + ' · ' : ''}{o.lines.map(l => `${l.qty}× ${l.name}`).join(', ') || 'No items yet'}</span>
          <Status s={o.status} /><b className={'num ' + (m > 12 ? 'down' : m > 8 ? 'warn' : '')}>{age(o.createdAt)}</b></div>; })}
      </section>
      <section className="card stack">
        <h3>On shift now</h3>
        {crew.length === 0 ? <p className="muted">Nobody rostered on this shift.</p> : crew.map(id => { const e = emp(db, id); const a = attendance(db, id, here, slot, now); const st = clockState(db, id, here).state; return <div key={id} className="row">
          <Avatar name={e?.name ?? '?'} color={e?.color} size={30} /><span className="grow"><b>{e?.name}</b> · {sd?.slots[slot].pic === id ? 'PIC' : ROLE_LABEL[e?.role ?? 'cashier']}</span>
          {a.flag === 'no_show' ? <Badge tone="danger">No-show</Badge> : a.flag === 'late' ? <Badge tone="warning">Late {a.lateMin} min</Badge> : st === 'break' ? <Badge tone="warning">On break</Badge> : st === 'in' ? <Badge tone="success">On</Badge> : <Badge>Not in yet</Badge>}</div>; })}
      </section>
      <section className="card stack">
        <h3>Tables · {used.size} of {outlet.tables} in use</h3>
        <div className="grid" style={{ ['--min' as string]: '64px', gap: 6 }}>{tables.map(t => <span key={t} className={'badge ' + (used.has(t) ? 'b-info' : booked.has(t) ? 'b-violet' : '')} style={{ height: 40, justifyContent: 'center', borderRadius: 10 }}>{t}</span>)}</div>
        <span className="faint" style={{ fontSize: 12 }}>Blue in use · violet booked today. Seating and bills happen on the register and waiter app.</span>
      </section>
      <section className="card stack">
        <h3>Watch list</h3>
        {db.sessions.filter(s => s.outletId === here && s.status === 'open').map(s => <div key={s.id} className="row" style={{ fontSize: 14 }}><Icon name="banknote" size={16} /><span className="grow">{nameOf(db, s.cashierId)} · <span className="mono">{s.id}</span> open since {hhmm(s.openedAt)}</span><b className="num">{idrShort(expectedCash(sessionCash(db, s.id)))}</b></div>)}
        {online.map(o => <div key={o.id} className="row" style={{ fontSize: 14 }}><Icon name="bike" size={16} /><span className="grow">{o.source} {o.no} waiting {Math.round((now - o.createdAt) / 60e3)} min</span></div>)}
        {sold.length > 0 && <div className="row" style={{ fontSize: 14 }}><Icon name="ban" size={16} /><span className="grow">Sold out: {sold.join(', ')}</span></div>}
        {offline.map(d => <div key={d.id} className="row" style={{ fontSize: 14 }}><Icon name="wifi-off" size={16} /><span className="grow">{d.name} offline {ago(d.lastSeen, now).replace(' ago', '')}</span></div>)}
        {db.reservations.filter(r => r.outletId === here && r.status === 'booked' && r.at > now && r.at < t0 + DAY).map(r => <div key={r.id} className="row" style={{ fontSize: 14 }}><Icon name="calendar" size={16} /><span className="grow">{r.name} · {r.guests} pax · {r.table}</span><b>{hhmm(r.at)}</b></div>)}
      </section>
    </div>
    <section className="card stack">
      <h3>Activity</h3>
      {feed.length === 0 ? <p className="muted">No activity yet today.</p> : feed.map(a => <div key={a.id} className="row" style={{ fontSize: 13 }}><span className="mono faint">{hhmm(a.at)}</span><span className="grow">{human(a.action.replace(/\./g, ' '))}{a.subject ? ' · ' + a.subject : ''}</span><span className="muted">{nameOf(db, a.actor)}</span></div>)}
    </section>
  </>;
}

// ── Outlet overview ─────────────────────────────────────────────────────────────────────
function Overview({ c }: { c: Ctx }) {
  const { db, scope, now, setOutlet, go } = c;
  const t0 = startOfDay(now), lw = t0 - 7 * DAY;
  const [sort, setSort] = useState<'name' | 'sales'>('sales');
  const rows = scope.map(id => {
    const o = db.outlets.find(x => x.id === id)!, s = sales(db, [id], t0, now), l = sales(db, [id], lw, lw + (now - t0)), sd = rosterDay(db, id), slot = slotNow(now);
    return { o, s, l, pic: sd?.slots[slot].pic, live: db.orders.filter(x => x.outletId === id && isLive(x.status) && x.createdAt >= t0).length,
      ap: db.approvals.filter(a => a.outletId === id && a.status === 'waiting').length, low: db.stockItems.filter(si => stockLevel(db.movements, id, si.id) < si.par).length,
      open: db.sessions.filter(x => x.outletId === id && x.status === 'open').length, rating: db.reviews.filter(r => r.outletId === id) };
  }).sort((a, b) => sort === 'sales' ? b.s.rev - a.s.rev : a.o.name.localeCompare(b.o.name));
  return <>
    <div className="row between wrap"><span className="muted">{scope.length} outlet{scope.length > 1 ? 's' : ''} you manage · today up to {hhmm(now)}</span>
      <div className="row"><button className="chip" aria-pressed={sort === 'sales'} onClick={() => setSort('sales')}>By sales</button><button className="chip" aria-pressed={sort === 'name'} onClick={() => setSort('name')}>By name</button></div></div>
    <div className="grid" style={{ ['--min' as string]: '300px' }}>
      {rows.map(r => { const d = delta(r.s.rev, r.l.rev, 'last week'); const stars = r.rating.length ? (r.rating.reduce((a, x) => a + x.stars, 0) / r.rating.length).toFixed(1) : '—'; return <section key={r.o.id} className="card stack">
        <div className="row between"><span><h3>{r.o.name}</h3><span className="muted" style={{ fontSize: 13 }}>{r.o.city} · {r.o.opens}–{r.o.closes}</span></span>{r.o.online ? <Badge tone="success" dot>Online</Badge> : <Badge tone="danger" dot>Offline</Badge>}</div>
        <div className="row between"><b className="num" style={{ fontSize: 26 }}>{idrShort(r.s.rev)}</b><span className={d.tone} style={{ fontSize: 13, fontWeight: 600 }}>{d.text}</span></div>
        <div className="grid" style={{ ['--min' as string]: '110px', gap: 8 }}>
          {[['Orders', r.s.n], ['Open now', r.live], ['Approvals', r.ap], ['Below par', r.low], ['Drawers open', r.open], ['Rating', stars]].map(([l, v]) => <div key={l as string} className="sunken" style={{ padding: 10 }}><span className="muted" style={{ fontSize: 12 }}>{l}</span><br /><b className="num">{v}</b></div>)}
        </div>
        <span className="muted" style={{ fontSize: 13 }}>PIC now: <b>{nameOf(db, r.pic) || 'none'}</b></span>
        <button className="btn" onClick={() => { setOutlet(r.o.id); go(P('live-monitor')); }}>Open live monitor</button>
      </section>; })}
    </div>
  </>;
}
