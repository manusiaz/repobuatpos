'use client';
// Owner mobile (spec/BorNiz Owner Mobile.dc.html): the owner dashboard below 768px. Bottom tabs, cards instead of tables,
// chips for filters, approvals one-handed with 52px buttons. Each tab is its own URL under /system/mobile/.
import { useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useApp } from '../app/context.tsx';
import { UserSwitch } from '../app/chrome.tsx';
import { Badge, Empty, Icon, Status, ago, hhmm, useNow, type Tone } from '../ui/kit.tsx';
import { LineChart } from '../ui/Chart.tsx';
import { idr, idrShort } from '../domain/money.ts';
import { markRead } from '../data/actions.ts';
import { nav, pagesOf } from '../system/registry.ts';
import type { DB } from '../data/schema.ts';
import { delta, openOrders, pct, period, series, startOfDay, summary, WEEK, SOURCE_LABEL, METHOD_LABEL } from './insight/metrics.ts';
import { amountOf, myQueue, outletsLive, typeLabel, useDecide, verbs, watchItems } from './insight/live.tsx';

// Tab key → registry path (slug "owner-mobile-<key>").
const PATH: Record<string, string> = Object.fromEntries(pagesOf('ownerMobile').map(p => [p.slug.replace('owner-mobile-', ''), p.path]));
const TABS = [['live-monitor', 'Live', 'activity'], ['sales', 'Sales', 'receipt'], ['approvals', 'Approvals', 'badge-check'], ['alerts', 'Alerts', 'bell'], ['more', 'More', 'menu']] as const;
const TITLE: Record<string, string> = { 'live-monitor': 'Live', sales: 'Sales today', approvals: 'Approvals', 'decision-inbox': 'Decision inbox', alerts: 'Alerts', more: 'More' };

export default function Screen() {
  const { page, db, user, me } = useApp();
  const view = page.slug.replace('owner-mobile-', '');
  const now = useNow(10000);
  const mine = user.role === 'owner' ? db.outlets : db.outlets.filter(o => me?.outlets.includes(o.id));
  const [outlet, setOutlet] = useState(mine.length > 1 ? 'all' : mine[0]?.id ?? 'all');
  const dec = useDecide();
  const queue = myQueue(db, user, outlet);
  const notices = db.notices.filter(n => (user.role === 'owner' || n.to.includes(user.role)) && (!n.outletId || mine.some(o => o.id === n.outletId)));
  const unread = notices.filter(n => !n.read).length;
  const tabOf = view === 'decision-inbox' ? 'approvals' : view;
  const scope = outlet === 'all' ? 'All outlets' : db.outlets.find(o => o.id === outlet)?.name;

  return <div style={{ minHeight: '100dvh', background: 'var(--bg-canvas)' }}>
    <div style={{ maxWidth: 520, margin: '0 auto', minHeight: '100dvh', display: 'flex', flexDirection: 'column', background: 'var(--bg-canvas)', boxShadow: '0 0 0 1px var(--border)' }}>
      <header className="row between" style={{ position: 'sticky', top: 0, zIndex: 20, padding: '14px 16px 10px', background: 'color-mix(in srgb,var(--bg-canvas) 90%,transparent)', backdropFilter: 'blur(10px)', borderBottom: '1px solid var(--border)' }}>
        <div className="stack" style={{ gap: 0 }}><h2>{TITLE[view]}</h2><span className="muted" style={{ fontSize: 13 }}>{db.tenant.name} · {scope}{!db.device.online && ' · offline'}</span></div>
        <div className="row"><Link href={user.role === 'owner' ? '/owner' : '/manager'} className="btn btn-ghost btn-sm" aria-label="Desktop dashboard"><Icon name="monitor" size={18} /></Link><UserSwitch compact /></div>
      </header>
      <main className="stack" style={{ padding: '16px 16px 96px', flex: 1 }}>
        {(view === 'live-monitor' || view === 'sales') && mine.length > 1 && <div className="row" style={{ overflowX: 'auto', paddingBottom: 2 }} role="group" aria-label="Outlet">
          {[['all', 'All'] as const, ...mine.map(o => [o.id, o.name] as const)].map(([id, l]) => <button key={id} className="chip" aria-pressed={outlet === id} onClick={() => setOutlet(id)} style={{ height: 40 }}>{l}</button>)}
        </div>}
        {view === 'live-monitor' && <Live db={db} outlet={outlet} now={now} queue={queue.length} />}
        {view === 'sales' && <Sales db={db} outlet={outlet} now={now} />}
        {(view === 'approvals' || view === 'decision-inbox') && <nav className="seg" aria-label="View" style={{ width: '100%' }}>
          {[['decision-inbox', 'Decision inbox'], ['approvals', `Approvals · ${queue.length}`]].map(([k, l]) => <Link key={k} href={PATH[k]} aria-current={view === k ? 'page' : undefined}
            style={{ flex: 1, display: 'grid', placeItems: 'center', height: 40, borderRadius: 9, fontWeight: 600, fontSize: 13, textDecoration: 'none', color: view === k ? 'var(--fg-1)' : 'var(--fg-2)', background: view === k ? 'var(--bg-surface)' : 'transparent', boxShadow: view === k ? '0 1px 3px rgba(20,18,16,.15)' : 'none' }}>{l}</Link>)}
        </nav>}
        {view === 'decision-inbox' && <Inbox db={db} outlet={outlet} now={now} queue={queue.length} />}
        {view === 'approvals' && <Approvals db={db} userId={user.id} queue={queue} now={now} ask={dec.ask} />}
        {view === 'alerts' && <Alerts notices={notices} now={now} by={user.id} />}
        {view === 'more' && <More role={user.role === 'manager' ? 'manager' : 'owner'} />}
      </main>
      <nav aria-label="Owner mobile" className="row" style={{ position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)', width: 'min(520px,100%)', zIndex: 30, background: 'var(--bg-surface)', borderTop: '1px solid var(--border)', padding: '6px 6px calc(6px + env(safe-area-inset-bottom))', gap: 0 }}>
        {TABS.map(([k, l, ic]) => { const on = tabOf === k, b = k === 'approvals' ? queue.length : k === 'alerts' ? unread : 0;
          return <Link key={k} href={PATH[k]} aria-current={on ? 'page' : undefined} className="stack" style={{ flex: 1, alignItems: 'center', gap: 2, minHeight: 52, justifyContent: 'center', textDecoration: 'none', color: on ? 'var(--role-fg)' : 'var(--fg-3)', fontSize: 12, fontWeight: 600, position: 'relative' }}>
            <Icon name={ic} size={22} />{l}{b > 0 && <span className="badge b-accent" style={{ position: 'absolute', top: 2, left: '55%', height: 18, padding: '0 6px', fontSize: 11 }}>{b}</span>}
          </Link>; })}
      </nav>
    </div>
    {dec.sheet}
  </div>;
}

const Card = ({ children, pad = 16 }: { children: ReactNode; pad?: number }) => <section className="card" style={{ padding: pad, borderRadius: 'var(--radius-lg)' }}>{children}</section>;
const Bar = ({ v, tone }: { v: number; tone: Tone }) => <span style={{ display: 'block', height: 8, borderRadius: 99, background: 'var(--bg-sunken)', overflow: 'hidden' }}><span style={{ display: 'block', height: '100%', width: Math.min(100, v * 100) + '%', background: `var(--${tone === 'success' ? 'success' : tone === 'warning' ? 'warning' : 'accent'})` }} /></span>;

function Live({ db, outlet, now, queue }: { db: DB; outlet: string; now: number; queue: number }) {
  const minute = Math.floor(now / 60e3);
  const spec = useMemo(() => period('today', 'hour', now), [minute]);
  const cur = summary(db, outlet, spec.range), prev = summary(db, outlet, spec.compare), d = delta(cur.revenue, prev.revenue);
  const rows = outletsLive(db, now).filter(r => outlet === 'all' || r.id === outlet);
  const target = rows.reduce((a, r) => a + r.target, 0), ofT = target ? cur.revenue / target : 0;
  const watch = watchItems(db, outlet, now);
  const chart = useMemo(() => ({ labels: spec.buckets.map(b => b.label), series: [{ label: 'Today', data: series(db, outlet, spec.buckets, 'revenue', now) as number[] }, { label: spec.compareLabel, data: series(db, outlet, spec.compareBuckets, 'revenue', Infinity) as number[], compare: true }] }), [db, outlet, spec]);
  const staff = rows.reduce((a, r) => a + r.staff, 0);
  return <>
    <Card pad={20}><div className="stack sm">
      <span className="muted" style={{ fontSize: 13 }}>Revenue today</span>
      <b className="num" style={{ fontSize: 34, letterSpacing: '-.02em', lineHeight: 1.05 }}>{idrShort(cur.revenue)}</b>
      <span style={{ fontSize: 13 }}><span className={d == null ? 'muted' : d >= 0 ? 'up' : 'down'} style={{ fontWeight: 600 }}>{d == null ? 'No comparison yet' : `${pct(d)} vs ${spec.compareLabel.toLowerCase()}`}</span><span className="muted"> · {Math.round(ofT * 100)}% of target</span></span>
      <Bar v={ofT} tone={ofT >= 1 ? 'success' : 'accent'} />
      {cur.orders === 0 ? <p className="faint" style={{ fontSize: 13 }}>No sales yet today.</p> : <LineChart labels={chart.labels} series={chart.series} height={140} format={idrShort} />}
    </div></Card>
    <div className="grid" style={{ ['--min' as string]: '140px', gap: 10 }}>
      {[['Orders', cur.orders], ['Avg ticket', idrShort(cur.avgTicket)], ['Open orders', openOrders(db, outlet).length], ['On shift', staff]].map(([l, v]) => <Card key={l as string} pad={14}><span className="muted" style={{ fontSize: 12 }}>{l}</span><br /><b className="num" style={{ fontSize: 20 }}>{v}</b></Card>)}
    </div>
    <h3 style={{ marginTop: 6 }}>Needs your decision</h3>
    <div className="stack sm">
      <Link href={PATH.approvals} className="card row" style={{ padding: 14, textDecoration: 'none', color: 'var(--fg-1)', minHeight: 56 }}><span className="dot" style={{ color: queue ? 'var(--warning)' : 'var(--success)' }} /><span className="grow"><b>{queue ? `${queue} approval${queue > 1 ? 's' : ''} waiting` : 'No approvals waiting'}</b></span><Icon name="chevron-right" /></Link>
      {watch.slice(0, 3).map(w => <Link key={w.id} href={PATH['decision-inbox']} className="card row" style={{ padding: 14, textDecoration: 'none', color: 'var(--fg-1)', minHeight: 56 }}><span className="dot" style={{ color: `var(--${w.tone === 'info' ? 'info' : w.tone})` }} /><span className="grow stack" style={{ gap: 0 }}><b style={{ fontSize: 14 }}>{w.title}</b><span className="muted" style={{ fontSize: 13 }}>{w.detail}</span></span><Icon name="chevron-right" /></Link>)}
    </div>
    <h3 style={{ marginTop: 6 }}>Outlets now</h3>
    {rows.map(r => { const tone: Tone = r.pace == null || r.pace >= 1 ? 'success' : r.pace >= .85 ? 'accent' : 'warning';
      return <Card key={r.id}><div className="stack sm">
        <div className="row between"><span className="row"><b style={{ fontSize: 16 }}>{r.name}</b>{r.offline ? <Badge tone="danger" dot>Offline</Badge> : !r.trading && <Badge>Closed</Badge>}</span><b className="num">{idrShort(r.revenue)}</b></div>
        <Bar v={r.ofTarget} tone={tone} />
        <span className="muted" style={{ fontSize: 13 }}>{r.orders} orders · {r.open} open{r.late ? ` · ${r.late} late` : ''} · {r.staff} on shift{r.pic ? ` · PIC ${r.pic.name}` : ''} · {r.devicesOnline}/{r.devices} devices</span>
      </div></Card>; })}
  </>;
}

function Sales({ db, outlet, now }: { db: DB; outlet: string; now: number }) {
  const [f, setF] = useState<'all' | 'open' | 'paid' | 'refund'>('all');
  const t0 = startOfDay(now);
  const rows = db.orders.filter(o => (outlet === 'all' || o.outletId === outlet) && o.createdAt >= t0 && o.status !== 'held'
    && (f === 'all' || (f === 'open' ? !['paid', 'voided', 'refunded', 'part_refunded'].includes(o.status) : f === 'paid' ? o.status === 'paid' : ['voided', 'refunded', 'part_refunded'].includes(o.status))))
    .sort((a, b) => b.createdAt - a.createdAt).slice(0, 60);
  const s = summary(db, outlet, { from: t0, to: now + 1 }), prevS = summary(db, outlet, { from: t0 - WEEK, to: now - WEEK });
  const method = (id: string) => db.payments.find(p => p.orderId === id && p.status === 'settled')?.method;
  return <>
    <div className="grid" style={{ ['--min' as string]: '140px', gap: 10 }}>
      <Card pad={14}><span className="muted" style={{ fontSize: 12 }}>Revenue</span><br /><b className="num" style={{ fontSize: 20 }}>{idrShort(s.revenue)}</b><br /><span className={s.revenue >= prevS.revenue ? 'up' : 'down'} style={{ fontSize: 12, fontWeight: 600 }}>{pct(delta(s.revenue, prevS.revenue))} vs last week</span></Card>
      <Card pad={14}><span className="muted" style={{ fontSize: 12 }}>Voids & refunds</span><br /><b className="num" style={{ fontSize: 20 }}>{idrShort(s.voids + s.refunds)}</b><br /><span className="faint" style={{ fontSize: 12 }}>{s.voidCount + s.refundCount} today</span></Card>
    </div>
    <div className="row" style={{ overflowX: 'auto' }} role="group" aria-label="Status">{([['all', 'All'], ['open', 'Open'], ['paid', 'Paid'], ['refund', 'Voids & refunds']] as const).map(([k, l]) => <button key={k} className="chip" aria-pressed={f === k} onClick={() => setF(k)} style={{ height: 40 }}>{l}</button>)}</div>
    {rows.length === 0 ? <Empty icon="receipt" title="No orders here yet">Orders from the counter, QR menu, kiosk and delivery apps show here live.</Empty>
      : <Card pad={0}>{rows.map((o, i) => <div key={o.id} className="row between" style={{ padding: '12px 16px', borderTop: i ? '1px solid var(--border)' : 0, minHeight: 60 }}>
        <span className="stack grow" style={{ gap: 0 }}><b style={{ fontSize: 14 }}><span className="mono">{o.no}</span> · {db.outlets.find(x => x.id === o.outletId)?.name}</b><span className="muted" style={{ fontSize: 13 }}>{SOURCE_LABEL[o.source]}{method(o.id) ? ' · ' + METHOD_LABEL[method(o.id)!] : ''} · {hhmm(o.paidAt ?? o.createdAt)} · {o.lines.reduce((a, l) => a + l.qty, 0)} items</span></span>
        <span className="stack" style={{ gap: 2, alignItems: 'flex-end' }}><b className="num">{idr(o.total)}</b><Status s={o.status} /></span>
      </div>)}</Card>}
    <Link href="/owner/sales/sales-transactions" className="btn btn-block">Open all sales on desktop</Link>
  </>;
}

function Inbox({ db, outlet, now, queue }: { db: DB; outlet: string; now: number; queue: number }) {
  const watch = watchItems(db, outlet, now);
  const pendingItems = db.products.filter(p => p.status === 'pending_owner').length;
  if (!queue && !watch.length) return <Empty icon="circle-check" title="You’re all caught up">Requests over your managers’ limits and outlets that need a look show here.</Empty>;
  return <div className="stack sm">
    {queue > 0 && <Link href={PATH.approvals} className="card row" style={{ padding: 16, textDecoration: 'none', color: 'var(--fg-1)', minHeight: 64 }}><Icon name="badge-check" /><span className="grow stack" style={{ gap: 0 }}><b>{queue} approval{queue > 1 ? 's' : ''} waiting for you</b><span className="muted" style={{ fontSize: 13 }}>{pendingItems ? `${pendingItems} new menu item${pendingItems > 1 ? 's' : ''}, ` : ''}refunds, purchases and access requests</span></span><Icon name="chevron-right" /></Link>}
    {watch.map(w => <section key={w.id} className="card stack sm" style={{ padding: 16 }}>
      <div className="row"><Badge tone={w.tone} dot>{w.tone === 'danger' ? 'Act now' : 'Watch'}</Badge></div>
      <b>{w.title}</b><span className="muted" style={{ fontSize: 14 }}>{w.detail}</span>
      <Link href={w.href} className="btn btn-block">{w.cta}</Link>
    </section>)}
  </div>;
}

function Approvals({ db, userId, queue, now, ask }: { db: DB; userId: string; queue: DB['approvals']; now: number; ask: (a: DB['approvals'][0], ok: boolean) => void }) {
  const done = db.approvals.filter(a => a.decidedBy === userId && a.decidedAt && a.decidedAt >= startOfDay(now) && a.requestedBy !== userId).slice(0, 10);
  const who = (id: string) => db.employees.find(e => e.id === id)?.name ?? (id === 'admin' ? 'BorNiz support' : id);
  return <div className="stack">
    {queue.length === 0 && <Empty icon="circle-check" title="No approvals waiting">When a request goes over your managers’ limits it lands here, and on your phone as a notification.</Empty>}
    {queue.map(a => { const v = verbs(a); return <section key={a.id} className="card stack sm" style={{ padding: 16 }}>
      <div className="row between"><Badge tone="info">{typeLabel(a)}</Badge><b className="num">{amountOf(a)}</b></div>
      <b style={{ fontSize: 16 }}>{a.title}</b>
      <span className="muted" style={{ fontSize: 14 }}>{who(a.requestedBy)} · {db.outlets.find(o => o.id === a.outletId)?.name} · {ago(a.at, now)}{a.note && <><br />{a.note}</>}</span>
      <div className="row" style={{ marginTop: 4 }}><button className="btn btn-lg btn-danger grow" onClick={() => ask(a, false)}>{v.no}</button><button className="btn btn-lg btn-primary grow" onClick={() => ask(a, true)}>{v.ok}</button></div>
    </section>; })}
    {done.length > 0 && <><h3 style={{ marginTop: 8 }}>Decided today</h3>
      {done.map(a => <div key={a.id} className="card row between" style={{ padding: 14, opacity: .75 }}><span className="grow stack" style={{ gap: 0 }}><b style={{ fontSize: 14 }}>{a.title}</b><span className="faint" style={{ fontSize: 12 }}>{hhmm(a.decidedAt!)} · {who(a.requestedBy)}</span></span><Status s={a.status} /></div>)}</>}
  </div>;
}

function Alerts({ notices, now, by }: { notices: DB['notices']; now: number; by: string }) {
  if (!notices.length) return <Empty icon="bell-off" title="No alerts">Low stock, printer offline, cash variance and late orders show here.</Empty>;
  return <div className="stack sm">
    {notices.some(n => !n.read) && <button className="btn btn-sm" style={{ alignSelf: 'flex-end' }} onClick={() => markRead('all', by)}>Mark all read</button>}
    {notices.slice(0, 60).map(n => <div key={n.id} className="card row" style={{ padding: 14, alignItems: 'flex-start', opacity: n.read ? .6 : 1 }}>
      <span className="dot" style={{ marginTop: 7, color: n.level === 'high' ? 'var(--danger)' : n.level === 'warn' ? 'var(--warning)' : 'var(--fg-3)' }} />
      <span className="grow stack" style={{ gap: 2 }}><b style={{ fontSize: 14 }}>{n.text}</b><span className="faint" style={{ fontSize: 12 }}>{n.alert} · {ago(n.at, now)}</span></span>
      {n.href ? <Link href={n.href} className="btn btn-sm" onClick={() => markRead(n.id, by)}>Open</Link> : !n.read && <button className="btn btn-sm btn-ghost" onClick={() => markRead(n.id, by)}>Read</button>}
    </div>)}
  </div>;
}

function More({ role }: { role: 'owner' | 'manager' }) {
  const groups = useMemo(() => nav(role), [role]);
  const [open, setOpen] = useState<string | null>(null);
  return <div className="stack sm">
    <Link href="/owner/customers/loyalty-program" className="card row" style={{ padding: 14, textDecoration: 'none', color: 'var(--fg-1)', minHeight: 56 }}><Icon name="award" /><b className="grow">Loyalty</b><Icon name="chevron-right" /></Link>
    <Link href="/studios" className="card row" style={{ padding: 14, textDecoration: 'none', color: 'var(--fg-1)', minHeight: 56 }}><Icon name="palette" /><b className="grow">Customize brand & menu</b><Icon name="chevron-right" /></Link>
    <span className="cap" style={{ marginTop: 8 }}>All modules</span>
    <section className="card" style={{ padding: 0 }}>{groups.map((g, i) => <div key={g.title} style={{ borderTop: i ? '1px solid var(--border)' : 0 }}>
      <button className="row between" style={{ width: '100%', minHeight: 52, padding: '0 16px', background: 'none', border: 0, cursor: 'pointer', textAlign: 'left' }} aria-expanded={open === g.title} onClick={() => setOpen(open === g.title ? null : g.title)}>
        <b className="grow" style={{ fontSize: 15 }}>{g.title}</b><span className="faint" style={{ fontSize: 13 }}>{g.pages.length}</span><Icon name={open === g.title ? 'chevron-up' : 'chevron-down'} size={18} /></button>
      {open === g.title && <div className="stack" style={{ gap: 0, padding: '0 8px 8px' }}>{g.pages.map(p => <Link key={p.path} href={p.path} className="nav-i" style={{ minHeight: 44 }}>{p.title}</Link>)}</div>}
    </div>)}</section>
  </div>;
}
