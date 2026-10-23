'use client';
// Insights & recommendations and Budget & sales forecast (owner back office; a manager sees only their outlets),
// plus the owner dashboard's top-3 card. Numbers come from domain/recommend.ts and domain/forecast.ts.
import { useMemo, useState } from 'react';
import Link from '../../ui/Link.tsx';
import { useApp } from '../../app/context.tsx';
import { Badge, Empty, Icon, Kpi, Seg, useNow, type Tone } from '../../ui/kit.tsx';
import { LineChart } from '../../ui/Chart.tsx';
import { idr, idrShort } from '../../domain/money.ts';
import type { DB } from '../../data/schema.ts';
import { KIND_LABEL, RULES, needsReorder, recommend, type Kind, type Recommendation, type Severity } from '../../domain/recommend.ts';
import { FORECAST, LEAD_NOTE, dailyActuals, salesForecast, stockRunway, type Runway } from '../../domain/forecast.ts';
import { PageHead } from '../../templates/common.tsx';
import { DAY, delta, pct, startOfDay, summary } from './metrics.ts';
import { useQuery } from './query.ts';

export const INSIGHTS = '/owner/monitor/insights-and-recommendations', FORECAST_PAGE = '/owner/finance/budget-and-sales-forecast';
const SEV_TONE: Record<Severity, Tone> = { high: 'danger', medium: 'warning', low: 'info' };
const SEV_LABEL: Record<Severity, string> = { high: 'High', medium: 'Medium', low: 'Low' };
const KIND_ICON: Record<Kind, string> = { reorder: 'package', staffing: 'users', 'outlet-forecast': 'trending-down', 'outlet-network': 'store', margin: 'percent', customers: 'user-x', 'slow-hours': 'clock', 'dead-menu': 'eye-off', 'dead-stock': 'archive' };
const PAST = 28;

/** Outlets this person may see (owner: all; manager: their own) and the picked one, kept in the URL. */
const Q = { outlet: 'all', days: '14' };
function useScope() {
  const { db, user, me } = useApp();
  const [q, setQ] = useQuery(Q);
  const mine = user.role === 'owner' ? db.outlets : db.outlets.filter(o => me?.outlets.includes(o.id));
  const picked = mine.some(o => o.id === q.outlet) ? q.outlet : 'all';
  const ids = picked === 'all' ? mine.map(o => o.id) : [picked];
  const options = [...(mine.length > 1 ? [['all', user.role === 'owner' ? 'All outlets' : 'My outlets'] as const] : []), ...mine.map(o => [o.id, o.name] as const)];
  const picker = options.length > 1 ? <Seg label="Outlet" value={picked} onChange={v => setQ({ outlet: v })} options={options} /> : null;
  return { q, setQ, ids, key: ids.join(','), picker, name: (id: string | null) => db.outlets.find(o => o.id === id)?.name };
}
/** Recompute once a minute, not on every render. */
const useMinute = () => Math.floor(useNow(60e3) / 60e3);

function RecRow({ r, outlet, compact }: { r: Recommendation; outlet?: string; compact?: boolean }) {
  const { go } = useApp();
  if (compact) return <div className="sunken stack sm">
    <span className="row wrap" style={{ gap: 6 }}><Badge tone={SEV_TONE[r.severity]} dot>{SEV_LABEL[r.severity]}</Badge><span className="faint" style={{ fontSize: 13 }}>{KIND_LABEL[r.kind]}{outlet ? ` · ${outlet}` : ''}</span></span>
    <b style={{ fontSize: 14 }}>{r.title}</b>
    <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn btn-sm btn-primary" onClick={() => go(r.href)}>{r.action}</button></div>
  </div>;
  return <div className="sunken row wrap" style={{ alignItems: 'flex-start', gap: 12 }}>
    <span className="kpi-ic" aria-hidden style={{ margin: 0 }}><Icon name={KIND_ICON[r.kind]} size={18} /></span>
    <span className="stack grow" style={{ gap: 4, minWidth: 220 }}>
      <span className="row wrap" style={{ gap: 6 }}><Badge tone={SEV_TONE[r.severity]} dot>{SEV_LABEL[r.severity]}</Badge><span className="faint" style={{ fontSize: 13 }}>{KIND_LABEL[r.kind]}{outlet ? ` · ${outlet}` : ''}</span></span>
      <b style={{ fontSize: 15 }}>{r.title}</b>
      <span className="muted" style={{ fontSize: 14 }}>{r.why}</span>
    </span>
    <button className="btn btn-primary" style={{ marginLeft: 'auto' }} onClick={() => go(r.href)}>{r.action}<Icon name="arrow-right" size={16} /></button>
  </div>;
}

export function Insights() {
  const { db } = useApp();
  const sc = useScope(), minute = useMinute();
  const [sev, setSev] = useState<'all' | Severity>('all');
  const recs = useMemo(() => recommend(db, sc.ids, Date.now()), [db, sc.key, minute]); // eslint-disable-line react-hooks/exhaustive-deps
  const next7 = useMemo(() => sc.ids.reduce((a, id) => a + salesForecast(db, id, 7).total, 0), [db, sc.key, minute]); // eslint-disable-line react-hooks/exhaustive-deps
  const last7 = useMemo(() => sc.ids.reduce((a, id) => a + dailyActuals(db, id, 7).values.reduce<number>((b, v) => b + (v ?? 0), 0), 0), [db, sc.key, minute]); // eslint-disable-line react-hooks/exhaustive-deps
  const count = (s: Severity) => recs.filter(r => r.severity === s).length;
  const shown = sev === 'all' ? recs : recs.filter(r => r.severity === sev);
  const qs = sc.q.outlet !== 'all' ? '?outlet=' + sc.q.outlet : '';
  return <>
    <PageHead sub="What the numbers say to do next: stock, staffing, prices, outlets and guests. Each card shows the numbers behind it and opens the page where you act." />
    {sc.picker && <div className="row wrap">{sc.picker}</div>}
    <section className="grid" style={{ ['--min' as string]: '260px' }} aria-label="Summary">
      <Kpi label="Recommendations" value={recs.length} delta={`${count('high')} high priority`} tone={count('high') ? 'warn' : undefined} href={null} />
      <Kpi label="Sales forecast · next 7 days" value={idrShort(next7)} delta={`${pct(delta(next7, last7))} vs last 7 days`} tone={next7 >= last7 ? 'up' : 'down'} href={FORECAST_PAGE + qs} />
      <Kpi label="Stock running out" value={recs.filter(r => r.kind === 'reorder').length} delta="Before a new delivery could arrive" href={null} />
    </section>
    <section className="card stack" aria-label="Recommendations">
      <div className="row wrap between"><h3>Recommendations</h3>
        <Seg label="Priority" value={sev} onChange={setSev} options={[['all', `All · ${recs.length}`], ['high', `High · ${count('high')}`], ['medium', `Medium · ${count('medium')}`], ['low', `Low · ${count('low')}`]] as const} /></div>
      {shown.length === 0 && <Empty icon="circle-check" title={recs.length ? 'Nothing at this priority' : 'Nothing to act on'}>Rules run on live sales, stock, roster and guests every minute. New recommendations appear here.</Empty>}
      {shown.map(r => <RecRow key={r.id} r={r} outlet={sc.ids.length > 1 ? sc.name(r.outletId) : undefined} />)}
    </section>
    <details className="card">
      <summary style={{ cursor: 'pointer', fontWeight: 600 }}>How these are worked out</summary>
      <ul className="muted" style={{ margin: '12px 0 0', paddingLeft: 18, fontSize: 14, lineHeight: 1.6 }}>
        <li><b>Reorder</b>: stock lasts no longer than the supplier lead time + {RULES.reorderBuffer} day, counting open POs. Use = average of the last {FORECAST.usageDays} days.</li>
        <li><b>Staffing</b>: forecast orders in the busiest hour of the next 7 days over {RULES.ordersPerStaffHour} per rostered person.</li>
        <li><b>Below forecast</b>: last 7 days under {Math.round(RULES.underForecast * 100)}% of the forecast made a week ago. <b>Outlet vs others</b>: under {Math.round(RULES.underNetwork * 100)}% of the average outlet.</li>
        <li><b>Margin</b>: a top-{RULES.topN} seller of the last {RULES.marginDays} days with cost of goods over {Math.round(RULES.cogsRatio * 100)}%.</li>
        <li><b>Customers at risk</b>: away {RULES.riskMinDays}+ days and over {RULES.riskGapX}× their usual gap between visits ({RULES.riskMinVisits}+ visits).</li>
        <li><b>Slow hours</b>: under {Math.round(RULES.slowShare * 100)}% of the average opening hour in every week of the last {RULES.slowWeeks} with sales (at least {RULES.slowMinWeeks}).</li>
        <li><b>Not selling / dead stock</b>: no sale or use in {RULES.deadDays} days at an outlet with that much history.</li>
      </ul>
    </details>
  </>;
}

/** Owner dashboard card: the three most urgent recommendations. */
export function TopRecommendations({ outlet }: { outlet: string }) {
  const { db } = useApp(), minute = useMinute();
  const ids = useMemo(() => (outlet === 'all' ? db.outlets.map(o => o.id) : [outlet]), [db.outlets, outlet]);
  const recs = useMemo(() => recommend(db, ids, Date.now()), [db, ids, minute]); // eslint-disable-line react-hooks/exhaustive-deps
  return <section className="card stack" aria-label="Top recommendations">
    <div className="row between"><h3>Recommendations</h3><Link href={INSIGHTS + (outlet !== 'all' ? '?outlet=' + outlet : '')} style={{ fontSize: 13 }}>All {recs.length}</Link></div>
    {recs.length === 0 && <p className="muted">Nothing to act on right now.</p>}
    {recs.slice(0, 3).map(r => <RecRow key={r.id} r={r} compact outlet={outlet === 'all' ? db.outlets.find(o => o.id === r.outletId)?.name : undefined} />)}
  </section>;
}

// ── Budget & sales forecast ────────────────────────────────────────────────────────────
const num = (s: unknown) => Number(String(s ?? '').replace(/[^\d.-]/g, '')) || 0;
/** This month's "Sales target" budget lines per outlet (Budget records, read only here). */
function salesTargets(db: DB, now: number) {
  const d = new Date(now), m = new Map<string, number>();
  for (const r of db.records.budget ?? []) {
    const p = new Date(Date.parse('1 ' + r.d));
    const o = db.outlets.find(x => x.name === r.b);
    if (o && /sales target/i.test(r.a) && p.getFullYear() === d.getFullYear() && p.getMonth() === d.getMonth()) m.set(o.id, (m.get(o.id) ?? 0) + num(r.e));
  }
  return m;
}
const label = (t: number) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const sumAt = (xs: (number | null)[][], i: number) => xs.every(x => x[i] == null) ? null : xs.reduce((a, x) => a + (x[i] ?? 0), 0);
const fmtDays = (r: Runway) => r.daysLeft == null ? '—' : r.daysLeft >= 99 ? '99+' : (Math.round(r.daysLeft * 10) / 10).toLocaleString('en-US');

export function Forecast() {
  const { db } = useApp();
  const sc = useScope(), minute = useMinute();
  const h = [7, 14, 30].includes(Number(sc.q.days)) ? Number(sc.q.days) : 14;
  const [allStock, setAllStock] = useState(false);
  const d = useMemo(() => {
    const now = Date.now(), t0 = startOfDay(now), month = new Date(t0), m0 = new Date(month.getFullYear(), month.getMonth(), 1).getTime(), m1 = new Date(month.getFullYear(), month.getMonth() + 1, 1).getTime();
    const targets = salesTargets(db, now);
    const rows = sc.ids.map(id => {
      const f = salesForecast(db, id, h, now), past = dailyActuals(db, id, PAST, now), lastH = dailyActuals(db, id, h, now).values.reduce<number>((a, v) => a + (v ?? 0), 0);
      const outlook = summary(db, id, { from: m0, to: t0 }).revenue + salesForecast(db, id, Math.round((m1 - t0) / DAY), now).total;
      return { id, name: db.outlets.find(o => o.id === id)?.name ?? id, f, past, lastH, outlook, target: targets.get(id) ?? 0 };
    });
    const buckets = rows[0]?.past.buckets ?? [], fdays = rows[0]?.f.days ?? [];
    const pastV = buckets.map((_, i) => sumAt(rows.map(r => r.past.values), i));
    const fsum = (k: 'value' | 'low' | 'high') => fdays.map((_, i) => rows.reduce((a, r) => a + r.f.days[i][k], 0));
    const N = (n: number) => Array<number>(n).fill(NaN);
    const series = [
      { label: 'Actual', data: [...pastV.map(v => v ?? NaN), ...N(h)] },
      { label: 'Forecast', data: [...N(PAST), ...fsum('value')], forecast: true },
      { label: 'Low', data: [...N(PAST), ...fsum('low')], band: 'low' as const },
      { label: 'High', data: [...N(PAST), ...fsum('high')], band: 'high' as const },
    ];
    const stock = sc.ids.flatMap(id => stockRunway(db, id, now)).filter(r => r.perDay > 0).sort((a, b) => (a.daysLeft ?? Infinity) - (b.daysLeft ?? Infinity) || a.name.localeCompare(b.name));
    const tot = (f: (r: typeof rows[0]) => number) => rows.reduce((a, r) => a + f(r), 0);
    return { rows, series, labels: [...buckets.map(b => label(b.from)), ...fdays.map((x, i) => (i === 0 ? 'Today' : label(x.from)))], stock,
      total: tot(r => r.f.total), low: tot(r => r.f.low), high: tot(r => r.f.high), lastH: tot(r => r.lastH), outlook: tot(r => r.outlook), target: tot(r => r.target), outlookTargeted: tot(r => (r.target ? r.outlook : 0)), monthName: month.toLocaleDateString('en-GB', { month: 'long' }), hasPast: pastV.some(v => v != null) };
  }, [db, sc.key, h, minute]); // eslint-disable-line react-hooks/exhaustive-deps
  const atRisk = d.stock.filter(needsReorder);
  const stock = allStock ? d.stock : d.stock.slice(0, 10);
  const trend = (t: number, samples: number) => samples < 28 ? <span className="faint">Flat · needs 4 weeks</span> : <span className={t >= 1 ? 'up' : 'down'}>{pct(t - 1)}</span>;
  return <>
    <PageHead sub={`Daily sales forecast per outlet: the same weekday over the last ${FORECAST.weeks} weeks × the recent trend, with a likely range. Stock days left from average daily use.`} />
    <div className="row wrap">{sc.picker}<Seg label="Forecast" value={String(h)} onChange={v => sc.setQ({ days: v })} options={[['7', 'Next 7 days'], ['14', 'Next 14 days'], ['30', 'Next 30 days']] as const} /></div>
    <section className="grid" style={{ ['--min' as string]: '190px' }} aria-label="Forecast summary">
      <Kpi label={`Forecast sales · next ${h} days`} value={idrShort(d.total)} delta={`Range ${idrShort(d.low)} – ${idrShort(d.high)}`} href={null} />
      <Kpi label={`Last ${h} days`} value={idrShort(d.lastH)} delta={`${pct(delta(d.total, d.lastH))} forecast vs actual`} tone={d.total >= d.lastH ? 'up' : 'down'} href={null} />
      <Kpi label={`${d.monthName} outlook`} value={idrShort(d.outlook)} delta={d.target ? `${Math.round((d.outlookTargeted / d.target) * 100)}% of ${idrShort(d.target)} target${d.outlookTargeted < d.outlook ? ' (outlets with one)' : ''}` : 'No sales target in Budget'} tone={d.target ? (d.outlookTargeted >= d.target ? 'up' : 'down') : undefined} href={null} />
      <Kpi label="Stock running out" value={atRisk.length} delta="Before a new delivery could arrive" tone={atRisk.length ? 'warn' : undefined} href={INSIGHTS + (sc.q.outlet !== 'all' ? '?outlet=' + sc.q.outlet : '')} />
    </section>
    <section className="card stack" aria-label="Sales forecast chart">
      <div className="row wrap between"><h3>Sales · last {PAST} days and next {h}</h3>
        <span className="row wrap faint" style={{ fontSize: 12 }}><span style={{ width: 14, height: 3, background: 'var(--role)', borderRadius: 2 }} />Actual <span style={{ width: 14, borderTop: '2px dashed var(--role)' }} />Forecast <span style={{ width: 14, height: 10, background: 'var(--role-soft)', borderRadius: 2 }} />Likely range</span></div>
      {d.hasPast ? <LineChart kind="line" labels={d.labels} series={d.series} height={260} format={idrShort} />
        : <Empty icon="chart-line" title="No sales history yet">The forecast starts after the first day of sales.</Empty>}
    </section>
    <section className="card flat" aria-label="Forecast per outlet">
      <div style={{ padding: '16px 20px' }}><h3>Per outlet</h3></div>
      <div className="scroll-x"><table className="table">
        <thead><tr><th>Outlet</th><th className="r">Last {h} days</th><th className="r">Next {h} days</th><th className="r">Trend</th><th className="r">{d.monthName} outlook</th><th className="r">Sales target</th></tr></thead>
        <tbody>{d.rows.map(r => <tr key={r.id}>
          <td><b>{r.name}</b></td><td className="r num">{idr(r.lastH)}</td><td className="r"><b className="num">{idr(r.f.total)}</b><br /><span className="faint" style={{ fontSize: 12 }}>{idrShort(r.f.low)} – {idrShort(r.f.high)}</span></td><td className="r">{trend(r.f.trend, r.f.samples)}</td>
          <td className="r num">{idr(r.outlook)}</td><td className="r">{r.target ? <>{idrShort(r.target)} <span className={r.outlook >= r.target ? 'up' : 'down'}>· {Math.round((r.outlook / r.target) * 100)}%</span></> : <span className="faint">Not set</span>}</td>
        </tr>)}</tbody>
      </table></div>
      <p className="faint" style={{ fontSize: 13, padding: '12px 20px' }}>Trend = last {FORECAST.trendDays} days vs the {FORECAST.trendDays} before, capped at ±{Math.round((FORECAST.trendHigh - 1) * 100)}%. Outlook = this month’s sales so far + forecast to month end. Sales targets come from Budget lines.</p>
    </section>
    <section className="card flat" aria-label="Stock days left">
      <div className="row wrap between" style={{ padding: '16px 20px' }}><h3>Stock days left</h3><span className="faint" style={{ fontSize: 13 }}>Average use over the last {FORECAST.usageDays} days</span></div>
      {d.stock.length === 0 ? <div style={{ padding: '0 20px 20px' }}><Empty icon="package" title="No stock used yet">Days left appear once sales use recipe ingredients.</Empty></div> : <div className="scroll-x"><table className="table">
        <thead><tr><th>Item</th><th className="r">Days left</th><th className="r">On hand</th><th className="r">Use per day</th><th className="r">Lead time</th><th className="r">On order</th></tr></thead>
        <tbody>{stock.map(r => { const tone: Tone = r.daysLeft! <= r.leadDays ? 'danger' : r.daysLeft! <= r.leadDays + RULES.reorderBuffer ? 'warning' : 'neutral';
          return <tr key={r.outletId + r.stockItemId}>
            <td><b style={{ whiteSpace: 'nowrap' }}>{r.name}</b>{sc.ids.length > 1 && <><br /><span className="faint" style={{ fontSize: 12 }}>{sc.name(r.outletId)}</span></>}</td>
            <td className="r">{tone === 'neutral' ? <span className="num">{fmtDays(r)}</span> : <Badge tone={tone}>{fmtDays(r)} days</Badge>}</td>
            <td className="r num">{(Math.round(r.level * 100) / 100).toLocaleString('en-US')} {r.unit}</td><td className="r">{(Math.round(r.perDay * 100) / 100).toLocaleString('en-US')} {r.unit}</td>
            <td className="r" title={LEAD_NOTE[r.leadFrom]}>{r.leadDays} d</td><td className="r">{r.onOrder ? `${r.onOrder.toLocaleString('en-US')} ${r.unit}` : '—'}</td>
          </tr>; })}</tbody>
      </table></div>}
      {d.stock.length > 10 && <div style={{ padding: '12px 20px' }}><button className="btn btn-ghost" onClick={() => setAllStock(!allStock)}>{allStock ? 'Show the 10 soonest' : `Show all ${d.stock.length}`}</button></div>}
    </section>
  </>;
}
