'use client';
// REPORT template: numbers over time with filters, comparison and export. Computed from the store; nothing is editable.
// Read-only pages that are lists (audit log, notifications, histories) fall through to the List template in read mode.
import { useMemo, useState } from 'react';
import { useApp } from '../app/context.tsx';
import { Icon, Kpi, Seg, toast } from '../ui/kit.tsx';
import { LineChart } from '../ui/Chart.tsx';
import { idr, idrShort } from '../domain/money.ts';
import { byChannel, byMethod, byOutlet, delta, pct, period, profitAndLoss, series, soldOrders, summary, topProducts, type Period } from '../screens/insight/metrics.ts';
import { level as stockLevel } from '../domain/stock.ts';
import { PageHead, downloadCSV } from './common.tsx';
import List from './List.tsx';
import { CommissionRules } from './Commission.tsx';
import type { Col, Row } from './views.ts';

const ANALYTIC = /(sales|revenue|report|summary|p&l|profit|cash flow|tax|margin|cogs|performance|comparison|insights|analytics|forecast|overview|engineering|valuation|channel|kpi|target|finance view|variance)/i;
const NOT = /(audit|notification|history|log$|status|lookup|requests|approval|who is on shift|payables|devices|price change|version|sent-to-owner|refunds over|low-stock list|stock overview|promos live|flash-sale|plan gating|subscription|^invoices|payroll approval|timesheet)/i;
export const isAnalytic = (name: string) => ANALYTIC.test(name) && !NOT.test(name);

type Dim = 'trend' | 'hour' | 'product' | 'category' | 'method' | 'outlet' | 'cashier' | 'channel' | 'pl' | 'tax' | 'discount' | 'cogs' | 'customer' | 'stock' | 'shift' | 'valuation';
function dimOf(n: string): Dim {
  const s = n.toLowerCase();
  if (/hour/.test(s)) return 'hour'; if (/by category/.test(s)) return 'category'; if (/(by product|menu engineering|menu analytics)/.test(s)) return 'product';
  if (/payment method|cash flow|settlement/.test(s)) return 'method'; if (/(by outlet|comparison|outlet sales|targets)/.test(s)) return 'outlet';
  if (/(cashier|employee|performance)/.test(s)) return 'cashier'; if (/channel/.test(s)) return 'channel'; if (/(p&l|profit|finance view|forecast|budget)/.test(s)) return 'pl';
  if (/tax/.test(s)) return 'tax'; if (/(discount|void)/.test(s)) return 'discount'; if (/(cogs|margin)/.test(s)) return 'cogs'; if (/customer/.test(s)) return 'customer';
  if (/(valuation)/.test(s)) return 'valuation'; if (/(inventory|stock|ingredient)/.test(s)) return 'stock'; if (/(shift|variance)/.test(s)) return 'shift';
  return 'trend';
}

export default function Report() {
  const { page } = useApp();
  if (page.object === 'payroll' && /commission/i.test(page.name)) return <><List readOnly /><CommissionRules /></>;
  if (!isAnalytic(page.name)) return <List readOnly />;
  return <Analytic />;
}

function Analytic() {
  const { page, db, user, outletId } = useApp();
  const [p, setP] = useState<Period>('7d');
  const [scope, setScope] = useState(user.role === 'owner' ? 'all' : outletId);
  const spec = useMemo(() => period(p), [p]);
  const cur = summary(db, scope, spec.range), prev = summary(db, scope, spec.compare);
  const dim = dimOf(page.name);
  const { cols, rows } = useMemo(() => breakdown(dim), [dim, db, scope, spec]); // eslint-disable-line react-hooks/exhaustive-deps
  const labels = spec.buckets.map(b => b.label);
  const chart = useMemo(() => [{ label: 'This period', data: series(db, scope, spec.buckets).map(v => v ?? NaN) }, { label: spec.compareLabel, data: series(db, scope, spec.compareBuckets, 'revenue', Date.now()).map(v => v ?? NaN), compare: true }], [db, scope, spec]);
  const outlets = user.role === 'owner' ? [['all', 'All outlets'] as const, ...db.outlets.map(o => [o.id, o.name] as const)] : db.outlets.filter(o => o.id === outletId).map(o => [o.id, o.name] as const);

  function breakdown(d: Dim): { cols: Col[]; rows: Row[] } {
    const r = spec.range, M = (k: string, l: string): Col => ({ k, l, f: 'money' }), N = (k: string, l: string): Col => ({ k, l, f: 'num' });
    const sold = soldOrders(db, scope, r);
    switch (d) {
      case 'hour': { const h = Array.from({ length: 24 }, (_, i) => ({ id: String(i), hour: String(i).padStart(2, '0') + ':00', orders: 0, revenue: 0 })); sold.forEach(o => { const x = h[new Date(o.createdAt).getHours()]; x.orders++; x.revenue += o.total; }); return { cols: [{ k: 'hour', l: 'Hour', f: 'mono' }, N('orders', 'Orders'), M('revenue', 'Revenue')], rows: h.filter(x => x.orders) }; }
      case 'product': case 'cogs': return { cols: [{ k: 'name', l: 'Product' }, N('qty', 'Sold'), M('revenue', 'Revenue'), M('cogs', 'COGS'), { k: 'margin', l: 'Margin', f: 'pct' }], rows: topProducts(db, scope, r, 100).map(x => ({ id: x.productId, ...x, margin: x.revenue ? Math.round(((x.revenue - x.cogs) / x.revenue) * 1000) / 10 : 0 })) };
      case 'category': { const m = new Map<string, Row>(); topProducts(db, scope, r, 100).forEach(x => { const c = db.categories.find(k => k.id === db.products.find(p0 => p0.id === x.productId)?.categoryId)?.name ?? 'Other'; const y = (m.get(c) ?? { id: c, name: c, qty: 0, revenue: 0 }) as Row & { qty: number; revenue: number }; y.qty += x.qty; y.revenue += x.revenue; m.set(c, y); }); return { cols: [{ k: 'name', l: 'Category' }, N('qty', 'Sold'), M('revenue', 'Revenue')], rows: [...m.values()] }; }
      case 'method': return { cols: [{ k: 'method', l: 'Method' }, N('count', 'Payments'), M('amount', 'Amount')], rows: byMethod(db, scope, r).map(x => ({ id: x.method, ...x, method: x.method.toUpperCase() })) };
      case 'outlet': return { cols: [{ k: 'name', l: 'Outlet' }, N('orders', 'Orders'), M('revenue', 'Revenue'), { k: 'vs', l: 'vs comparison' }], rows: byOutlet(db, r).filter(x => scope === 'all' || x.outletId === scope).map(x => ({ id: x.outletId, ...x, vs: pct(delta(x.revenue, byOutlet(db, spec.compare).find(y => y.outletId === x.outletId)?.revenue ?? 0)) })) };
      case 'channel': return { cols: [{ k: 'source', l: 'Channel' }, N('orders', 'Orders'), M('revenue', 'Revenue')], rows: byChannel(db, scope, r).map(x => ({ id: x.source, ...x })) };
      case 'cashier': { const m = new Map<string, Row & { orders: number; revenue: number }>(); sold.forEach(o => { const k = o.cashierId ?? 'self-order'; const x = m.get(k) ?? { id: k, name: db.employees.find(e => e.id === k)?.name ?? 'Self-order / online', orders: 0, revenue: 0 }; x.orders++; x.revenue += o.total; m.set(k, x); }); return { cols: [{ k: 'name', l: 'Person' }, N('orders', 'Orders'), M('revenue', 'Sales'), { k: 'avg', l: 'Avg ticket', f: 'money' }], rows: [...m.values()].map(x => ({ ...x, avg: Math.round(x.revenue / x.orders) })) }; }
      case 'tax': return { cols: [{ k: 'name', l: 'Outlet' }, { k: 'rule', l: 'Rule' }, M('service', 'Service charge'), M('tax', 'Tax (PB1 / PPN)'), M('revenue', 'Gross')], rows: db.outlets.filter(o => scope === 'all' || o.id === scope).map(o => { const s = soldOrders(db, o.id, r); return { id: o.id, name: o.name, rule: `${o.taxBps / 100}%${o.taxInclusive ? ' incl.' : ''}${o.serviceBps ? ' · svc ' + o.serviceBps / 100 + '%' : ''}`, service: s.reduce((a, x) => a + x.service, 0), tax: s.reduce((a, x) => a + x.tax, 0), revenue: s.reduce((a, x) => a + x.total, 0) }; }) };
      case 'discount': return { cols: [{ k: 'k', l: 'Line' }, N('n', 'Count'), M('v', 'Amount')], rows: [{ id: 'd', k: 'Discounts', n: sold.filter(o => o.discount).length, v: cur.discounts }, { id: 'v', k: 'Voids', n: cur.voidCount, v: cur.voids }, { id: 'r', k: 'Refunds', n: cur.refundCount, v: cur.refunds }] };
      case 'pl': { const days = (r.to - r.from) / 864e5; const exp = (db.records.expense ?? []).reduce((a, x) => a + (Number(x.e) || 0), 0) || 52_250_000; const payroll = db.employees.reduce((a, e) => a + e.wage, 0); const scale = Math.min(1, days / 30);
        return { cols: [{ k: 'k', l: 'Line' }, M('v', 'Amount')], rows: profitAndLoss(cur, Math.round(payroll * scale), Math.round(exp * scale)).map(([k, v]) => ({ id: k, k, v })) }; }
      case 'customer': { const m = new Map<string, Row & { orders: number; revenue: number }>(); sold.filter(o => o.customerId).forEach(o => { const x = m.get(o.customerId!) ?? { id: o.customerId!, name: db.customers.find(c => c.id === o.customerId)?.name ?? '', orders: 0, revenue: 0 }; x.orders++; x.revenue += o.total; m.set(o.customerId!, x); }); return { cols: [{ k: 'name', l: 'Customer' }, N('orders', 'Visits'), M('revenue', 'Spend')], rows: [...m.values()].sort((a, b) => b.revenue - a.revenue) }; }
      case 'stock': case 'valuation': return { cols: [{ k: 'name', l: 'Item' }, N('qty', 'On hand'), { k: 'unit', l: 'Unit' }, M('value', 'Value (avg cost)')], rows: db.stockItems.map(s => { const q = db.outlets.filter(o => scope === 'all' || o.id === scope).reduce((a, o) => a + stockLevel(db.movements, o.id, s.id), 0); return { id: s.id, name: s.name, qty: Math.round(q * 100) / 100, unit: s.unit, value: Math.round(q * s.unitCost) }; }) };
      case 'shift': return { cols: [{ k: 'id', l: 'Session', f: 'mono' }, { k: 'who', l: 'Cashier' }, { k: 'status', l: 'Status', f: 'status' }, M('float', 'Float'), M('variance', 'Variance')], rows: db.sessions.filter(s => scope === 'all' || s.outletId === scope).map(s => ({ id: s.id, who: db.employees.find(e => e.id === s.cashierId)?.name, status: s.status, float: s.openingFloat, variance: s.variance ?? 0 })) };
      default: return { cols: [{ k: 'label', l: 'Period' }, N('orders', 'Orders'), M('revenue', 'Revenue')], rows: spec.buckets.map((b, i) => ({ id: String(i), label: b.label, orders: series(db, scope, [b], 'orders')[0] ?? 0, revenue: series(db, scope, [b])[0] ?? 0 })) };
    }
  }

  const tot = (k: string) => rows.reduce((a, r) => a + (typeof r[k] === 'number' ? (r[k] as number) : 0), 0);
  const money = cols.filter(c => c.f === 'money' || c.f === 'num');
  return <>
    <PageHead actions={<>
      <button className="btn" onClick={() => toast('Scheduled: emailed every Monday 07:00 to owner')}><Icon name="calendar-clock" size={18} />Schedule</button>
      <button className="btn btn-primary" onClick={() => { downloadCSV(page.title, cols, rows); toast('Exported CSV'); }}><Icon name="download" size={18} />Export</button>
    </>} />
    <div className="row wrap">
      {outlets.length > 1 ? <Seg value={scope} onChange={setScope} options={outlets} label="Outlet" /> : null}
      <Seg value={p} onChange={setP} options={[['today', 'Today'], ['7d', '7 days'], ['30d', '30 days'], ['12m', '12 months']] as const} label="Period" />
      <span className="faint" style={{ fontSize: 13 }}>Compared with {spec.compareLabel.toLowerCase()}</span>
    </div>
    <div className="grid" style={{ ['--min' as string]: '190px' }}>
      <Kpi label="Revenue" value={idrShort(cur.revenue)} delta={pct(delta(cur.revenue, prev.revenue)) + ' vs comparison'} tone={cur.revenue >= prev.revenue ? 'up' : 'down'} />
      <Kpi label="Orders" value={cur.orders.toLocaleString('en-US')} delta={pct(delta(cur.orders, prev.orders))} tone={cur.orders >= prev.orders ? 'up' : 'down'} />
      <Kpi label="Avg ticket" value={idrShort(cur.avgTicket)} delta={pct(delta(cur.avgTicket, prev.avgTicket))} tone={cur.avgTicket >= prev.avgTicket ? 'up' : 'down'} />
      <Kpi label="Gross margin" value={cur.grossMargin == null ? '—' : Math.round(cur.grossMargin * 100) + '%'} delta={cur.grossMargin != null && prev.grossMargin != null ? (cur.grossMargin >= prev.grossMargin ? '+' : '−') + Math.abs(Math.round((cur.grossMargin - prev.grossMargin) * 100)) + ' pt' : undefined} />
    </div>
    <section className="card stack">
      <div className="row between"><h3>Revenue · {labels.length} {p === 'today' ? 'hours' : p === '12m' ? 'months' : 'days'}</h3><span className="row faint" style={{ fontSize: 12 }}><span style={{ width: 14, height: 3, background: 'var(--role)', borderRadius: 2 }} />This period <span style={{ width: 14, borderTop: '2px dashed var(--ink-300)' }} />{spec.compareLabel}</span></div>
      {cur.orders === 0 && prev.orders === 0 ? <p className="muted">No sales data for this period yet. History starts {new Date(db.orders[0]?.createdAt ?? Date.now()).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}.</p>
        : <LineChart labels={labels} series={chart} format={idrShort} />}
    </section>
    <section className="card flat">
      <div className="scroll-x"><table className="table"><thead><tr>{cols.map(c => <th key={c.k} className={c.f === 'money' || c.f === 'num' || c.f === 'pct' ? 'r' : ''}>{c.l}</th>)}</tr></thead>
        <tbody>{rows.length === 0 && <tr><td colSpan={cols.length} className="muted">No data for this period.</td></tr>}
          {rows.map(r => <tr key={r.id}>{cols.map(c => <td key={c.k} className={c.f === 'money' || c.f === 'num' || c.f === 'pct' ? 'r' : ''} style={r.k === 'Net profit' ? { fontWeight: 700 } : undefined}>{c.f === 'money' ? idr(Number(r[c.k])) : c.f === 'num' ? Number(r[c.k]).toLocaleString('en-US') : c.f === 'pct' ? r[c.k] + '%' : String(r[c.k] ?? '—')}</td>)}</tr>)}
          {rows.length > 1 && dim !== 'pl' && money.length > 0 && <tr><td style={{ fontWeight: 700 }}>Total</td>{cols.slice(1).map(c => <td key={c.k} className="r" style={{ fontWeight: 700 }}>{c.f === 'money' ? idr(tot(c.k)) : c.f === 'num' ? tot(c.k).toLocaleString('en-US') : ''}</td>)}</tr>}
        </tbody></table></div>
    </section>
  </>;
}
