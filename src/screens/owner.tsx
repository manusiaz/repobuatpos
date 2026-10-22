'use client';
// Owner dashboard, layout A (spec/BorNiz Owner Dashboard.dc.html): KPIs, revenue trend vs last week, decisions, outlets live.
// /owner = the dashboard with period filters; /owner/monitor/live-monitor = the same board pinned to today, refreshing live.
import { useMemo, useState, type ReactNode } from 'react';
import Link from '../ui/Link.tsx';
import { useApp } from '../app/context.tsx';
import { Badge, Empty, Icon, Kpi, Seg, ago, hhmm, useNow, Avatar, type Tone } from '../ui/kit.tsx';
import { LineChart } from '../ui/Chart.tsx';
import { idr, idrShort } from '../domain/money.ts';
import { setSetting } from '../data/actions.ts';
import type { DB, Order } from '../data/schema.ts';
import { byChannel, byMethod, DAY, delta, historyStart, lateOrders, openOrders, pct, period, series, soldAt, soldOrders, startOfDay, summary, topProducts, voidsAndRefunds, type Gran, type Period , SOURCE_LABEL, METHOD_LABEL } from './insight/metrics.ts';
import { amountOf, myQueue, outletsLive, typeLabel, useDecide, verbs, watchItems } from './insight/live.tsx';
import { useQuery } from './insight/query.ts';
import { TopRecommendations } from './insight/insights.tsx';
import { widgetsFor } from '../system/tools.ts';

const Q = { outlet: 'all', period: 'today', gran: 'hour' };
const PERIODS = [['today', 'Today'], ['7d', '7 days'], ['30d', '30 days'], ['12m', '12 months']] as const;
const GRANS = [['hour', 'Per hour'], ['15m', 'Per 15 min'], ['min', 'Per minute · live']] as const;

export default function Screen() {
  const { page, db, user } = useApp();
  const live = page.path === '/owner/monitor/live-monitor';
  const [q, setQ] = useQuery(Q);
  const now = useNow(5000), minute = Math.floor(now / 60e3);
  const outlet = q.outlet, per = (live ? 'today' : q.period) as Period, gran = (q.gran as Gran);
  const tick = per === 'today' && gran === 'min' ? Math.floor(now / 5000) : minute;
  // recompute buckets once a minute (every 5 s on the per-minute view), not on every clock tick
  const spec = useMemo(() => period(per, gran, now), [per, gran, tick]);
  const cur = useMemo(() => summary(db, outlet, spec.range), [db, outlet, spec]);
  const prev = useMemo(() => summary(db, outlet, spec.compare), [db, outlet, spec]);
  const dec = useDecide();
  const queue = myQueue(db, user, outlet), watch = watchItems(db, outlet, now);
  const open = openOrders(db, outlet), late = lateOrders(db, outlet, now), vr = voidsAndRefunds(db, outlet, spec.range);
  const dRev = delta(cur.revenue, prev.revenue);
  const gm = cur.grossMargin, gmPrev = prev.grossMargin;
  const outlets = db.outlets.map(o => [o.id, o.name] as const);
  const wg = widgetsFor(db, 'owner'), show = (k: string) => !wg || wg.on.includes(k); // Studios › Dashboard widgets per role
  const cards: Record<string, ReactNode> = {
    w_reco: <TopRecommendations key="w_reco" outlet={outlet} />,
    w_live: <LiveTx key="w_live" db={db} outlet={outlet} now={now} />,
    w_top: <TopProducts key="w_top" db={db} outlet={outlet} range={spec.range} label={per === 'today' ? 'today' : PERIODS.find(p => p[0] === per)?.[1].toLowerCase() ?? ''} />,
    w_mix: <Mix key="w_mix" db={db} outlet={outlet} range={spec.range} />,
    w_alert: <Alerts key="w_alert" db={db} outlet={outlet} now={now} />,
  };

  return <div className="stack lg">
    <header className="row wrap between" style={{ gap: 12 }}>
      <div className="stack sm" style={{ gap: 4 }}>
        <div className="row wrap"><h1>{live ? 'Live monitor' : 'Live dashboard'}</h1><Badge tone="info">Report · read only</Badge>{!db.device.online && <Badge tone="danger" dot>Offline · numbers may be stale</Badge>}</div>
        <span className="muted" style={{ fontSize: 14 }}>Live numbers from every outlet. Act on Needs your decision; nothing else is edited here.</span>
      </div>
      <div className="row wrap">
        <Seg label="Outlet" value={outlet} onChange={v => setQ({ outlet: v })} options={[['all', 'All outlets'], ...outlets]} />
        {!live && <Seg label="Period" value={per} onChange={v => setQ({ period: v })} options={PERIODS} />}
      </div>
    </header>

    {!live && <Setup db={db} by={user.id} />}

    {show('w_rev') && <section className="grid" style={{ ['--min' as string]: '190px' }} aria-label="Key numbers">
      <Kpi label="Revenue" value={idrShort(cur.revenue)} delta={dRev == null ? 'No comparison yet' : `${pct(dRev)} vs ${spec.compareLabel.replace(/^./, c => c.toLowerCase())}`} tone={dRev == null ? undefined : dRev >= 0 ? 'up' : 'down'} />
      <Kpi label="Orders" value={cur.orders.toLocaleString('en-US')} delta={`Avg ticket ${idrShort(cur.avgTicket)}`} />
      <Kpi label="Gross margin" value={gm == null ? '—' : Math.round(gm * 100) + '%'} delta={gm == null || gmPrev == null ? 'From product cost' : `${gm >= gmPrev ? '+' : '−'}${Math.abs(Math.round((gm - gmPrev) * 100))} pt`} tone={gm != null && gmPrev != null ? (gm >= gmPrev ? 'up' : 'down') : undefined} />
      <Kpi label="Open orders" value={open.length} delta={late.length ? `${late.length} over 12 min` : 'None over 12 min'} tone={late.length ? 'warn' : undefined} />
      <Kpi label="Voids & refunds" value={idrShort(cur.voids + cur.refunds)} delta={vr.pending.length ? `${vr.pending.length} need review` : `${cur.voidCount + cur.refundCount} this period`} tone={vr.pending.length ? 'down' : undefined} />
    </section>}

    <section className="row wrap" style={{ alignItems: 'flex-start', gap: 'var(--gutter)' }}>
      {show('w_trend') && <div style={{ flex: '2 1 520px', minWidth: 0 }}><Trend db={db} outlet={outlet} per={per} gran={gran} spec={spec} now={now} live={live} setGran={g => setQ({ gran: g })} /></div>}
      <section className="card stack" aria-label="Needs your decision" style={{ flex: '1 1 300px', minWidth: 0 }}>
        <div className="row between"><h3>Needs your decision</h3><Badge tone={queue.length ? 'accent' : 'success'}>{queue.length} waiting</Badge></div>
        {queue.length + watch.length === 0 && <Empty icon="circle-check" title="Nothing needs you">Approvals over your managers’ limits land here.</Empty>}
        {queue.slice(0, 6).map(a => { const v = verbs(a), who = db.employees.find(e => e.id === a.requestedBy)?.name ?? (a.requestedBy === 'admin' ? 'BorNiz support' : a.requestedBy); return <div key={a.id} className="sunken stack sm">
          <div className="row between"><Badge tone="info">{typeLabel(a)}</Badge><b className="num">{amountOf(a)}</b></div>
          <b style={{ fontSize: 15 }}>{a.title}</b>
          <span className="muted" style={{ fontSize: 13 }}>{who} · {db.outlets.find(o => o.id === a.outletId)?.name} · {ago(a.at, now)}{a.note && <> · {a.note}</>}</span>
          <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn btn-sm btn-danger" onClick={() => dec.ask(a, false)}>{v.no}</button>{a.type === 'local_item' && (a.payload as { promote?: boolean } | undefined)?.promote !== false && db.products.find(p => p.id === a.subjectId)?.promoteRequested && <button className="btn btn-sm" onClick={() => dec.ask(a, true, { promote: false })}>Keep local</button>}<button className="btn btn-sm btn-primary" onClick={() => dec.ask(a, true)}>{v.ok}</button></div>
        </div>; })}
        {queue.length > 6 && <Link href="/system/mobile/owner-mobile-approvals">{queue.length - 6} more approvals</Link>}
        {watch.slice(0, 4).map(w => <div key={w.id} className="row" style={{ alignItems: 'flex-start' }}>
          <Badge tone={w.tone} dot>{w.tone === 'danger' ? 'Act' : 'Watch'}</Badge>
          <span className="grow stack" style={{ gap: 0 }}><b style={{ fontSize: 14 }}>{w.title}</b><span className="muted" style={{ fontSize: 13 }}>{w.detail}</span></span>
          <Link href={w.href} className="btn btn-sm">{w.cta}</Link>
        </div>)}
      </section>
    </section>

    <Outlets db={db} outlet={outlet} now={now} onPick={id => setQ({ outlet: id })} />

    <section className="grid" style={{ ['--min' as string]: wg ? `max(260px, calc(100% / ${wg.cols} - var(--gutter)))` : '280px', alignItems: 'start' }}>
      {(wg ? wg.on : Object.keys(cards)).map(k => cards[k]).filter(Boolean)}
    </section>
    {dec.sheet}
    <span className="sr" aria-live="polite">{live ? `Updated ${hhmm(now)}` : ''}</span>
  </div>;
}

function Trend({ db, outlet, per, gran, spec, now, live, setGran }: { db: DB; outlet: string; per: Period; gran: Gran; spec: ReturnType<typeof period>; now: number; live: boolean; setGran: (g: Gran) => void }) {
  const since = historyStart(db);
  const data = useMemo(() => {
    const c = series(db, outlet, spec.buckets, 'revenue', now, per === 'today' ? -Infinity : startOfDay(since));
    const p = series(db, outlet, spec.compareBuckets, 'revenue', Infinity, startOfDay(since));
    return { labels: spec.buckets.map(b => b.label), c, p };
  }, [db, outlet, spec]);
  const chartSeries = useMemo(() => [{ label: per === 'today' ? 'Today' : 'This period', data: data.c as number[] }, { label: spec.compareLabel, data: data.p as number[], compare: true }], [data, per, spec.compareLabel]);
  const today = per === 'today', vals = data.c.filter((v): v is number => v != null), total = vals.reduce((a, b) => a + b, 0);
  const nowIdx = spec.buckets.findIndex(b => now >= b.from && now < b.to);
  const empty = today && total === 0;
  let stats: [string, string, string?][] = [];
  if (today && gran === 'min') {
    const last = (n: number) => vals.slice(-n).reduce((a, b) => a + b, 0);
    const orders = soldOrders(db, outlet, { from: now - 3600e3, to: now }).length;
    stats = [['Last minute', idrShort(last(1))], ['Last 15 min', idrShort(last(15))], ['Last 60 min', idrShort(last(60))], ['Orders / min', (orders / 60).toFixed(1), 'avg last hour']];
  } else if (today) {
    const hourFrom = Math.floor(now / 3600e3) * 3600e3, thisHour = soldOrders(db, outlet, { from: hourFrom, to: now }).reduce((a, o) => a + o.total, 0);
    const hourly = series(db, outlet, period('today', 'hour', now).buckets, 'revenue', now).map(v => v ?? 0), best = hourly.indexOf(Math.max(...hourly));
    const opened = hourly.findIndex(v => v > 0), hrs = opened < 0 ? 0 : Math.max(1, new Date(now).getHours() - 6 - opened + 1);
    // projection: today so far × (last week's full day / last week up to this time)
    const lwDay = summary(db, outlet, { from: spec.compare.from, to: spec.compare.from + DAY }).revenue, lwSoFar = summary(db, outlet, spec.compare).revenue;
    stats = [['This hour so far', idrShort(thisHour), `${new Date(now).getMinutes()} min in`], ['Best hour', hourly[best] ? `${String(best + 6).padStart(2, '0')}:00 · ${idrShort(hourly[best])}` : '—'],
      ['Avg per hour', hrs ? idrShort(Math.round(total / hrs)) : '—', opened >= 0 ? `since ${String(opened + 6).padStart(2, '0')}:00` : undefined], ['Projected close', lwSoFar ? idrShort(Math.round(total * lwDay / lwSoFar)) : '—', 'from last week’s shape']];
  } else {
    const prevTotal = (data.p.filter(v => v != null) as number[]).reduce((a, b) => a + b, 0), withData = vals.filter(v => v > 0);
    const bi = data.c.reduce<number>((bi, v, i) => (v ?? -1) > (data.c[bi] ?? -1) ? i : bi, 0);
    stats = [['Total', idrShort(total), prevTotal ? `${pct(delta(total, prevTotal))} vs previous` : 'No earlier data'], [per === '12m' ? 'Best month' : 'Best day', withData.length ? spec.buckets[bi].label : '—'],
      [per === '12m' ? 'Avg / month' : 'Avg / day', withData.length ? idrShort(Math.round(total / withData.length)) : '—', `${withData.length} with sales`], ['Orders', soldOrders(db, outlet, spec.range).length.toLocaleString('en-US')]];
  }
  const missing = per !== 'today' && spec.buckets.some(b => b.to <= startOfDay(since));
  return <section className="card stack" aria-label="Revenue trend">
    <div className="row wrap between">
      <div className="stack" style={{ gap: 2 }}>
        <h3>{today ? { hour: 'Revenue per hour · today', '15m': 'Revenue per 15 minutes · today', min: 'Revenue per minute · last 60 minutes' }[gran] : 'Revenue trend'}</h3>
        <span className="muted" style={{ fontSize: 13 }}>{today && nowIdx >= 0 && gran !== 'min' ? <><b style={{ color: 'var(--danger-fg)' }}>Now {hhmm(now)}</b> · {spec.buckets[nowIdx].label} bucket. </> : today && gran === 'min' ? `Updates every 5 seconds · ${hhmm(now)}. ` : ''}Dashed = {spec.compareLabel.replace(/^./, c => c.toLowerCase())}{today ? ', same hours' : ''}.</span>
      </div>
      {today && <Seg label="Granularity" value={gran} onChange={setGran} options={GRANS} />}
    </div>
    <div className="grid" style={{ ['--min' as string]: '140px', gap: 10 }}>{stats.map(([l, v, d]) => <div key={l} className="sunken stack" style={{ gap: 2, padding: 12 }}><span className="muted" style={{ fontSize: 12 }}>{l}</span><b className="num" style={{ fontSize: 16 }}>{v}</b>{d && <span className="faint" style={{ fontSize: 12 }}>{d}</span>}</div>)}</div>
    {empty ? <Empty icon="sun" title="No sales yet today">{live ? 'The first order shows here within seconds.' : 'Orders appear here as soon as an outlet opens and takes its first payment.'}</Empty>
      : <LineChart labels={data.labels} series={chartSeries} height={240} format={idrShort} />}
    {missing && <p className="faint" style={{ fontSize: 13 }}><Icon name="rotate-ccw-clock" size={14} /> Sales history starts {new Date(since).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}. Earlier {per === '12m' ? 'months' : 'days'} show no data, not zero.</p>}
    {!live && today && <span className="faint" style={{ fontSize: 12 }}>Today so far vs {spec.compareLabel}: {idrShort(total)} vs {idrShort((data.p.slice(0, nowIdx + 1).filter(v => v != null) as number[]).reduce((a, b) => a + b, 0))}</span>}
  </section>;
}

function Outlets({ db, outlet, now, onPick }: { db: DB; outlet: string; now: number; onPick: (id: string) => void }) {
  const rows = outletsLive(db, now);
  return <section className="card flat" aria-label="Outlets live">
    <div className="row between" style={{ padding: '16px 20px' }}><h3>Outlets now</h3><Link href="/owner/outlets/targets-and-kpis" style={{ fontSize: 13 }}>Set targets</Link></div>
    <div className="scroll-x"><table className="table">
      <thead><tr><th>Outlet</th><th className="r">Revenue today</th><th>vs target</th><th className="r">Orders</th><th className="r">Open</th><th>PIC on shift</th><th>Devices</th></tr></thead>
      <tbody>{rows.map(r => { const p = Math.round(r.ofTarget * 100), tone: Tone = r.pace == null ? 'neutral' : r.pace >= 1 ? 'success' : r.pace >= .85 ? 'accent' : 'warning';
        return <tr key={r.id} className="click" tabIndex={0} aria-selected={outlet === r.id} onKeyDown={e => e.key === 'Enter' && onPick(outlet === r.id ? 'all' : r.id)} onClick={() => onPick(outlet === r.id ? 'all' : r.id)} style={{ background: outlet === r.id ? 'var(--role-soft)' : undefined }}>
          <td><div className="row"><b>{r.name}</b>{r.offline ? <Badge tone="danger" dot>Offline</Badge> : !r.trading ? <Badge>Closed</Badge> : null}</div></td>
          <td className="r num">{idrShort(r.revenue)}</td>
          <td style={{ minWidth: 150 }}><div className="row"><span style={{ flex: 1, height: 6, borderRadius: 99, background: 'var(--bg-sunken)', overflow: 'hidden' }}><span style={{ display: 'block', height: '100%', width: Math.min(100, p) + '%', background: `var(--${tone === 'success' ? 'success' : tone === 'warning' ? 'warning' : tone === 'accent' ? 'accent' : 'ink-300'})` }} /></span><span className="num" style={{ fontSize: 13, width: 44, textAlign: 'right' }}>{p}%</span></div><span className="faint" style={{ fontSize: 12 }}>of {idrShort(r.target)}{r.autoTarget ? ' · 7-day avg' : ''}</span></td>
          <td className="r num">{r.orders}</td>
          <td className="r"><span className="num">{r.open}</span>{r.late > 0 && <span className="down" style={{ fontSize: 12 }}> · {r.late} late</span>}</td>
          <td>{r.pic ? <span className="row"><Avatar name={r.pic.name} color={r.pic.color} size={24} />{r.pic.name}<span className="faint" style={{ fontSize: 12 }}>+{r.staff - 1}</span></span> : <span className="faint">{r.trading ? 'No PIC rostered' : '—'}</span>}</td>
          <td><Badge tone={r.devices && r.devicesOnline === r.devices ? 'success' : r.devicesOnline ? 'warning' : r.devices ? 'danger' : 'neutral'}>{r.devices ? `${r.devicesOnline} of ${r.devices} online` : 'None paired'}</Badge></td>
        </tr>; })}</tbody>
    </table></div>
  </section>;
}

function LiveTx({ db, outlet, now }: { db: DB; outlet: string; now: number }) {
  const rows = soldOrders(db, outlet, { from: startOfDay(now), to: now + 1 }).sort((a, b) => soldAt(b) - soldAt(a)).slice(0, 7);
  const method = (o: Order) => db.payments.find(p => p.orderId === o.id && p.status === 'settled')?.method;
  return <section className="card stack" aria-label="Live transactions">
    <div className="row between"><h3>Live transactions</h3><Link href="/owner/sales/sales-transactions" style={{ fontSize: 13 }}>All sales</Link></div>
    {rows.length === 0 && <p className="muted">No payments yet today.</p>}
    {rows.map(o => <div key={o.id} className="row between" style={{ fontSize: 14 }}>
      <span className="grow" style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}><b className="mono">{o.no}</b> · {db.outlets.find(x => x.id === o.outletId)?.name} · {(() => { const m = method(o); return m ? METHOD_LABEL[m] : SOURCE_LABEL[o.source]; })()} · <span className="faint">{hhmm(soldAt(o))}</span></span>
      <b className="num">{idr(o.total)}</b></div>)}
  </section>;
}

function TopProducts({ db, outlet, range, label }: { db: DB; outlet: string; range: { from: number; to: number }; label: string }) {
  const rows = topProducts(db, outlet, range, 5), max = rows[0]?.qty ?? 1;
  return <section className="card stack" aria-label="Top products">
    <div className="row between"><h3>Top products</h3><span className="faint" style={{ fontSize: 13 }}>Sold {label}</span></div>
    {rows.length === 0 && <p className="muted">Nothing sold in this period.</p>}
    {rows.map(r => <div key={r.productId} className="stack" style={{ gap: 4 }}>
      <div className="row between" style={{ fontSize: 14 }}><b style={{ fontSize: 14 }}>{r.name}</b><span className="num">{r.qty} · {r.revenue ? Math.round((1 - r.cogs / r.revenue) * 100) : 0}% margin</span></div>
      <span style={{ height: 6, borderRadius: 99, background: 'var(--bg-sunken)' }}><span style={{ display: 'block', height: '100%', width: (r.qty / max) * 100 + '%', borderRadius: 99, background: 'var(--role)' }} /></span>
    </div>)}
  </section>;
}

function Mix({ db, outlet, range }: { db: DB; outlet: string; range: { from: number; to: number } }) {
  const [by, setBy] = useState<'channel' | 'method'>('channel');
  const rows = by === 'channel' ? byChannel(db, outlet, range).map(r => ({ k: SOURCE_LABEL[r.source] ?? r.source, v: r.revenue, n: r.orders }))
    : byMethod(db, outlet, range).map(r => ({ k: METHOD_LABEL[r.method] ?? r.method, v: r.amount, n: r.count }));
  const total = rows.reduce((a, r) => a + r.v, 0) || 1;
  return <section className="card stack" aria-label="Sales mix">
    <div className="row between"><h3>Sales mix</h3><Seg label="Group by" value={by} onChange={setBy} options={[['channel', 'Channel'], ['method', 'Payment']]} /></div>
    {rows.length === 0 && <p className="muted">No sales in this period.</p>}
    {rows.slice(0, 6).map(r => <div key={r.k} className="row between" style={{ fontSize: 14 }}><span className="grow">{r.k} <span className="faint">· {r.n}</span></span><span className="num">{idrShort(r.v)}</span><span className="faint num" style={{ width: 40, textAlign: 'right' }}>{Math.round((r.v / total) * 100)}%</span></div>)}
  </section>;
}

function Alerts({ db, outlet, now }: { db: DB; outlet: string; now: number }) {
  const rows = db.notices.filter(n => outlet === 'all' || !n.outletId || n.outletId === outlet).slice(0, 6);
  return <section className="card stack" aria-label="Alerts">
    <div className="row between"><h3>Alerts</h3><Link href="/owner/monitor/notifications-and-activity-center" style={{ fontSize: 13 }}>Activity center</Link></div>
    {rows.length === 0 && <p className="muted">All quiet.</p>}
    {rows.map(n => <div key={n.id} className="row" style={{ alignItems: 'flex-start', fontSize: 14, opacity: n.read ? .65 : 1 }}>
      <span className="dot" style={{ marginTop: 7, color: n.level === 'high' ? 'var(--danger)' : n.level === 'warn' ? 'var(--warning)' : 'var(--fg-3)' }} />
      <span className="grow">{n.href ? <Link href={n.href} style={{ color: 'var(--fg-1)' }}>{n.text}</Link> : n.text}<br /><span className="faint" style={{ fontSize: 12 }}>{n.alert} · {ago(n.at, now)}</span></span>
    </div>)}
  </section>;
}

const SETUP = [
  { id: 'menu', t: 'Add your menu', d: 'Products, prices and photos, for every outlet.', href: '/owner/catalog/products-and-menu', auto: (db: DB) => db.products.some(p => p.status === 'live') },
  { id: 'team', t: 'Invite your team', d: 'Managers, PICs, cashiers and kitchen, each with a PIN.', href: '/owner/team/invite-employee', auto: (db: DB) => db.employees.length > 1 },
  { id: 'tax', t: 'Check tax and service', d: 'PB1 / PPN and service charge per outlet.', href: '/owner/finance/tax-and-service-charge', auto: () => false },
  { id: 'payments', t: 'Turn on payment methods', d: 'QRIS, cards and e-wallets, and the bank account for payouts.', href: '/owner/settings/settings-payment-methods', auto: () => false },
  { id: 'loyalty', t: 'Set up loyalty rewards', d: 'Give regulars something to collect beans for.', href: '/owner/customers/rewards-catalog', auto: (db: DB) => (db.records.reward ?? []).length > 0 },
];
const SETUP_KEY = '/owner:setup';
function Setup({ db, by }: { db: DB; by: string }) {
  const done = SETUP.map(s => s.auto(db) || db.settings[`${SETUP_KEY}-${s.id}`] === true), n = done.filter(Boolean).length;
  if (n === SETUP.length || db.settings[`${SETUP_KEY}-dismissed`] === true) return null;
  return <section className="card stack" aria-label="Get started">
    <div className="row wrap between">
      <div className="stack" style={{ gap: 2 }}><h3>Get started</h3><span className="muted" style={{ fontSize: 13 }}>{n} of {SETUP.length} done. Every step can be changed later.</span></div>
      <button className="btn btn-ghost btn-sm" onClick={() => setSetting(`${SETUP_KEY}-dismissed`, true, by)}>Hide checklist</button>
    </div>
    <span style={{ height: 6, borderRadius: 99, background: 'var(--bg-sunken)' }}><span style={{ display: 'block', height: '100%', width: (n / SETUP.length) * 100 + '%', borderRadius: 99, background: 'var(--success)' }} /></span>
    <div className="grid" style={{ ['--min' as string]: '220px', gap: 10 }}>{SETUP.map((s, i) => <div key={s.id} className="sunken stack sm" style={{ opacity: done[i] ? .6 : 1 }}>
      <div className="row"><Icon name={done[i] ? 'circle-check' : 'circle'} size={18} style={{ color: done[i] ? 'var(--success)' : 'var(--fg-3)' }} /><b style={{ fontSize: 14 }}>{s.t}</b></div>
      <span className="muted" style={{ fontSize: 13 }}>{s.d}</span>
      {!done[i] && <div className="row"><Link href={s.href} className="btn btn-sm btn-primary">Open</Link><button className="btn btn-sm btn-ghost" onClick={() => setSetting(`${SETUP_KEY}-${s.id}`, true, by)}>Mark done</button></div>}
    </div>)}</div>
  </section>;
}
