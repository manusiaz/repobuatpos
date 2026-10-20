'use client';
// Super admin console, layout A "dense tables + detail" (spec/BorNiz Super Admin.dc.html). Dark, violet accent (shell).
// Every action goes through commit() and lands in the audit log. Never show card data: methods only, no numbers.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import Link from '../ui/Link.tsx';
import { useApp } from '../app/context.tsx';
import catalog from '../system/catalog.json' with { type: 'json' };
import { Badge, Empty, Field, Icon, Kpi, Loading, Seg, Sheet, Toggle, ago, dateShort, hhmm, human, toast } from '../ui/kit.tsx';
import { LineChart } from '../ui/Chart.tsx';
import { idr, idrShort } from '../domain/money.ts';
import { saveRecord, setSetting } from '../data/actions.ts';
import { uid } from '../data/store.ts';
import { endSupportAccess, ensurePlatform, logAdmin, patchRecord, requestSupportAccess, setTenantPlan, type TenantMeta } from '../data/actions/admin.ts';
import type { DB, Rec } from '../data/schema.ts';
import { PLANS, STATUS_TONE, accessOf, churn, mrrHistory, planName, planPrice, priceKey, tenants, withTax, type Plan, type Tenant } from './admin/platform.ts';
import { useQuery } from './insight/query.ts';
import { cnameTarget, config as hostConfig, domainRequests, liveDomain } from '../system/hosts.ts';

const DETAIL = '/admin/tenant-detail-and-plan';
const St = ({ s }: { s: string }) => <Badge tone={STATUS_TONE[s] ?? 'neutral'} dot>{human(s)}</Badge>;
const Mono = ({ children }: { children: ReactNode }) => <span className="mono">{children}</span>;

export default function Screen() {
  const { page, db } = useApp();
  useEffect(() => { ensurePlatform(); }, []);
  if (!db.records.tenant) return <Loading />;
  const v = page.slug === 'admin' ? 'platform-overview' : page.slug;
  return <div className="stack lg">
    <header className="stack sm" style={{ gap: 4 }}>
      <div className="row wrap"><h1>{v === 'platform-overview' ? 'Platform overview' : page.title}</h1><Badge tone="violet">BorNiz staff · 2FA</Badge></div>
      <span className="muted" style={{ fontSize: 14 }}>{SUB[v] ?? 'Run the platform: tenants, billing, support, releases.'} Every action is audited.</span>
    </header>
    {v === 'platform-overview' && <Overview db={db} />}
    {v === 'tenant-list' && <TenantList db={db} />}
    {v === 'tenant-detail-and-plan' && <TenantDetailPage db={db} />}
    {v === 'plans-and-pricing' && <Plans db={db} />}
    {v === 'tenant-invoices-and-payments' && <Invoices db={db} />}
    {v === 'support-tickets' && <Tickets db={db} />}
    {v === 'feature-flags-and-releases' && <Flags db={db} />}
    {v === 'audit-log' && <Audit db={db} />}
    {v === 'theme-presets-library' && <Themes db={db} />}
    {v === 'custom-domain-verification' && <Domains db={db} />}
  </div>;
}
const SUB: Record<string, string> = {
  'platform-overview': 'MRR, churn and what needs attention across every tenant.', 'tenant-list': 'Every tenant, plan and health. Select a row for details.',
  'tenant-detail-and-plan': 'One tenant: plan, billing, devices, support access.', 'plans-and-pricing': 'Per-outlet SaaS plans. Price changes apply to the next invoice.',
  'tenant-invoices-and-payments': 'Invoices and payment status. Card details stay with the payment gateway.', 'support-tickets': 'Tenant questions and incidents. Access to a tenant is time-boxed and approved by its owner.',
  'feature-flags-and-releases': 'Gradual rollouts and the release train.', 'audit-log': 'Every change in the store, newest first. Read only.',
  'theme-presets-library': 'Brand themes tenants start from in Menu Studio.', 'custom-domain-verification': 'Tenant domains for QR menu, web store and white-label apps.',
};

/** Dense table on the left, detail on the right; stacks on narrow screens. */
const Split = ({ table, detail }: { table: ReactNode; detail: ReactNode }) =>
  <div className="row wrap" style={{ alignItems: 'flex-start', gap: 'var(--gutter)' }}>
    <section className="card flat" style={{ flex: '3 1 560px', minWidth: 0 }}>{table}</section>
    <aside className="card stack" style={{ flex: '1 1 300px', minWidth: 0, position: 'sticky', top: 72 }}>{detail}</aside>
  </div>;
const Dl = ({ rows }: { rows: [string, ReactNode][] }) => <div className="stack sm">{rows.map(([l, v]) => <div key={l} className="row between" style={{ alignItems: 'flex-start', fontSize: 14, gap: 12 }}><span className="muted">{l}</span><span style={{ textAlign: 'right' }}>{v}</span></div>)}</div>;
const nameOf = (db: DB, id: string) => tenants(db).find(t => t.id === id)?.name ?? id;

// ── Overview ──────────────────────────────────────────────────────────────────────────────
function Overview({ db }: { db: DB }) {
  const ts = tenants(db), hist = mrrHistory(db), mrr = hist[hist.length - 1].value, prev = hist[hist.length - 2].value;
  const live = ts.filter(t => t.status !== 'churned' && t.status !== 'suspended'), c = churn(db);
  const inv = db.records.invoice ?? [], failed = inv.filter(i => i.d === 'failed' || i.d === 'past_due');
  const chart = useMemo(() => ({ labels: hist.map(h => h.label), series: [{ label: 'MRR', data: hist.map(h => h.value) }] }), [db.records, db.settings]);
  const yr = hist[0].value;
  const attention = [
    ...ts.filter(t => t.status === 'past_due' || t.status === 'churn_risk').map(t => ({ k: t.id, t: t.name, d: human(t.status) + ' · ' + idr(t.mrr) + ' MRR', href: `${DETAIL}?t=${t.id}`, s: t.status })),
    ...(db.records.ticket ?? []).filter(k => k.c === 'urgent' && k.d !== 'solved').map(k => ({ k: k.id, t: k.a, d: `${nameOf(db, k.b)} · ${ago(k.at)}`, href: `/admin/support-tickets?k=${k.id}`, s: 'urgent' })),
    ...ts.filter(t => t.status === 'trial' && t.meta.trialEnds && t.meta.trialEnds - Date.now() < 14 * 864e5).map(t => ({ k: 'tr' + t.id, t: `${t.name} trial ends ${dateShort(t.meta.trialEnds!)}`, d: `${planName(t.plan)} · ${t.outlets} outlet`, href: `${DETAIL}?t=${t.id}`, s: 'trial' })),
  ];
  return <>
    <section className="grid" style={{ ['--min' as string]: '170px' }}>
      <Kpi label="MRR" value={idrShort(mrr)} delta={prev ? `${mrr >= prev ? '+' : '−'}${Math.abs(((mrr - prev) / prev) * 100).toFixed(1)}% MoM` : 'First month'} tone={mrr >= prev ? 'up' : 'down'} />
      <Kpi label="ARR" value={idrShort(mrr * 12)} delta={yr ? `${(((mrr - yr) / yr) * 100).toFixed(0)}% vs 11 months ago` : 'Run rate'} />
      <Kpi label="Active tenants" value={live.length} delta={`${ts.filter(t => Date.now() - t.signedUp < 31 * 864e5).length} signed up this month`} />
      <Kpi label="Outlets" value={live.reduce((a, t) => a + t.outlets, 0)} delta={`${(live.reduce((a, t) => a + t.outlets, 0) / Math.max(1, live.length)).toFixed(1)} per tenant`} />
      <Kpi label="Churn (logo)" value={(c.rate * 100).toFixed(1) + '%'} delta={`${c.lost} of ${c.base} paying tenants this month`} tone={c.rate > .025 ? 'down' : 'up'} />
      <Kpi label="Failed payments" value={failed.length} delta={failed.length ? 'Retry tonight 02:00' : 'All collected'} tone={failed.length ? 'warn' : undefined} />
    </section>
    <div className="row wrap" style={{ alignItems: 'flex-start', gap: 'var(--gutter)' }}>
      <section className="card stack" style={{ flex: '2 1 480px', minWidth: 0 }}><div className="row between"><h3>MRR · last 12 months</h3><span className="faint" style={{ fontSize: 12 }}>From sign-up and churn dates, at today’s plans</span></div>
        <LineChart labels={chart.labels} series={chart.series} kind="bar" height={220} format={idrShort} /></section>
      <section className="card stack" style={{ flex: '1 1 280px', minWidth: 0 }}><h3>Tenants by plan</h3>
        {PLANS.map(p => { const n = ts.filter(t => t.plan === p.id && t.status !== 'churned').length; return <div key={p.id} className="row" style={{ fontSize: 14 }}><b style={{ width: 90 }}>{p.name}</b>
          <span className="grow" style={{ height: 8, borderRadius: 99, background: 'var(--bg-sunken)' }}><span style={{ display: 'block', height: '100%', borderRadius: 99, width: (n / Math.max(1, ts.length)) * 100 + '%', background: 'var(--role)' }} /></span><span className="num" style={{ width: 28, textAlign: 'right' }}>{n}</span></div>; })}
      </section>
    </div>
    <section className="card stack"><h3>Needs attention</h3>
      {attention.length === 0 ? <p className="muted">Nothing needs attention.</p> : attention.map(a => <Link key={a.k} href={a.href} className="row" style={{ color: 'var(--fg-1)', minHeight: 44 }}><St s={a.s} /><span className="grow"><b style={{ fontSize: 14 }}>{a.t}</b> <span className="muted" style={{ fontSize: 13 }}>· {a.d}</span></span><Icon name="chevron-right" size={18} /></Link>)}
    </section>
  </>;
}

// ── Tenants ───────────────────────────────────────────────────────────────────────────────
function TenantTable({ ts, sel, onSel }: { ts: Tenant[]; sel?: string; onSel: (id: string) => void }) {
  return <div className="scroll-x"><table className="table"><thead><tr><th>ID</th><th>Tenant</th><th>Plan</th><th className="r">Outlets</th><th className="r">MRR</th><th>Status</th></tr></thead>
    <tbody>{ts.map(t => <tr key={t.id} className="click" tabIndex={0} aria-selected={sel === t.id} style={{ background: sel === t.id ? 'var(--role-soft)' : undefined }} onClick={() => onSel(t.id)} onKeyDown={e => e.key === 'Enter' && onSel(t.id)}>
      <td><Mono>{t.id}</Mono></td><td><b>{t.name}</b>{t.real && <> <Badge tone="violet">This store</Badge></>}<br /><span className="faint" style={{ fontSize: 12 }}>{t.meta.city}</span></td>
      <td>{planName(t.plan)}</td><td className="r num">{t.outlets}</td><td className="r num">{idr(t.mrr)}</td><td><St s={t.status} /></td></tr>)}</tbody></table></div>;
}
function TenantList({ db }: { db: DB }) {
  const [q, setQ] = useQuery({ t: '', f: 'all' });
  const [search, setSearch] = useState('');
  const all = tenants(db), ts = all.filter(t => (q.f === 'all' || t.status === q.f) && (!search || (t.name + t.id + t.meta.email).toLowerCase().includes(search.toLowerCase())));
  const sel = all.find(t => t.id === q.t);
  return <>
    <div className="row wrap between"><Seg label="Status" value={q.f} onChange={f => setQ({ f })} options={[['all', 'All'], ['active', 'Active'], ['trial', 'Trial'], ['past_due', 'Past due'], ['churn_risk', 'Churn risk'], ['churned', 'Churned']]} />
      <input className="search" style={{ maxWidth: 280 }} placeholder="Search tenants" value={search} onChange={e => setSearch(e.target.value)} aria-label="Search tenants" /></div>
    <Split table={ts.length ? <TenantTable ts={ts} sel={q.t} onSel={t => setQ({ t: q.t === t ? null : t })} /> : <Empty icon="building-2" title="No tenants match" />}
      detail={sel ? <TenantSummary db={db} t={sel} /> : <Empty icon="mouse-pointer-click" title="Select a tenant">Plan, billing health and support access show here.</Empty>} />
  </>;
}
function TenantSummary({ db, t }: { db: DB; t: Tenant }) {
  const acc = accessOf(db, t.id);
  return <>
    <div className="row between"><h3>{t.name}</h3><St s={t.status} /></div>
    <Dl rows={[['Owner', <>{t.meta.owner}<br /><span className="faint mono">{t.meta.email}</span></>], ['Plan', `${planName(t.plan)} · ${t.outlets} outlet${t.outlets > 1 ? 's' : ''}`], ['MRR', idr(t.mrr)], ['Signed up', `${new Date(t.signedUp).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}${t.meta.source ? ' · ' + t.meta.source : ''}`], ['Support access', human(acc.state)]]} />
    <Link href={`${DETAIL}?t=${t.id}`} className="btn btn-primary">Open tenant</Link>
  </>;
}

function TenantDetailPage({ db }: { db: DB }) {
  const [q, setQ] = useQuery({ t: db.tenant.id });
  const all = tenants(db), t = all.find(x => x.id === q.t);
  const [plan, setPlan] = useState<Plan | null>(null), [access, setAccess] = useState(false), [confirm, setConfirm] = useState<null | 'suspend' | 'reactivate'>(null);
  if (!t) return <Empty icon="building-2" title="Tenant not found" action={<button className="btn" onClick={() => setQ({ t: null })}>Open {db.tenant.name}</button>} />;
  const inv = (db.records.invoice ?? []).filter(i => i.a === t.id).sort((a, b) => b.at - a.at), tks = (db.records.ticket ?? []).filter(k => k.b === t.id);
  const devs = t.real ? db.devices : [], acc = accessOf(db, t.id);
  const meta = (patch: Partial<TenantMeta>) => JSON.stringify({ ...t.meta, ...patch });
  return <>
    <div className="row wrap between">
      <label className="row" style={{ fontSize: 14 }}><span className="muted">Tenant</span><select className="input" style={{ height: 40, width: 'auto' }} value={t.id} onChange={e => setQ({ t: e.target.value })}>{all.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
      <div className="row wrap">
        <button className="btn btn-primary" onClick={() => setAccess(true)} disabled={acc.state === 'requested' || acc.state === 'active'}><Icon name="key-round" size={18} />Request support access</button>
        {t.status === 'trial' && <button className="btn" onClick={() => { patchRecord('tenant', t.id, { e: meta({ trialEnds: (t.meta.trialEnds ?? Date.now()) + 14 * 864e5 }) }, 'tenant.trial_extended'); toast('Trial extended by 14 days'); }}>Extend trial</button>}
        {t.status === 'suspended' ? <button className="btn" onClick={() => setConfirm('reactivate')}>Reactivate</button> : t.status !== 'churned' && <button className="btn btn-danger" onClick={() => setConfirm('suspend')}>Suspend</button>}
      </div>
    </div>
    <section className="grid" style={{ ['--min' as string]: '170px' }}>
      <Kpi label="Status" value={human(t.status)} delta={t.status === 'trial' && t.meta.trialEnds ? `Trial ends ${dateShort(t.meta.trialEnds)}` : t.real ? 'This store · live data' : undefined} />
      <Kpi label="MRR" value={idrShort(t.mrr)} delta={`${planName(t.plan)} · ${t.outlets} outlets`} />
      <Kpi label="Devices" value={t.real ? `${devs.filter(d => d.status === 'online').length} / ${devs.length}` : '—'} delta={t.real ? 'online now' : 'Reported by the tenant’s store'} />
      <Kpi label="Signed up" value={new Date(t.signedUp).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })} delta={t.meta.source} />
    </section>
    <section className="card stack"><div className="row between"><h3>Plan</h3>{t.real && <span className="faint" style={{ fontSize: 12 }}>Changes apply to {t.name} right away</span>}</div>
      <div className="grid" style={{ ['--min' as string]: '190px', gap: 10 }}>{PLANS.map(p => <button key={p.id} className="card tight stack sm" style={{ textAlign: 'left', cursor: 'pointer', borderColor: t.plan === p.id ? 'var(--role)' : undefined, boxShadow: t.plan === p.id ? '0 0 0 2px var(--role)' : undefined }} onClick={() => t.plan !== p.id && setPlan(p.id)} aria-pressed={t.plan === p.id}>
        <div className="row between"><b>{p.name}</b>{t.plan === p.id && <Badge tone="violet">Current</Badge>}</div>
        <span className="num">{p.id === 'enterprise' ? (t.plan === 'enterprise' ? idr(t.meta.custom ?? 0) + ' / month' : 'Custom') : idr(planPrice(db, p.id)) + ' / outlet'}</span>
        <span className="muted" style={{ fontSize: 12 }}>{p.limits}</span></button>)}</div>
    </section>
    <div className="row wrap" style={{ alignItems: 'flex-start', gap: 'var(--gutter)' }}>
      <section className="card stack" style={{ flex: '1 1 320px', minWidth: 0 }}><h3>Owner & contact</h3>
        <Dl rows={[['Owner', t.meta.owner], ['Email', <Mono key="e">{t.meta.email}</Mono>], ['City', t.meta.city], ['Brand theme', t.meta.theme ?? '—'], ['White-label', t.meta.wl ? t.meta.appName ?? 'Yes' : 'No']]} /></section>
      <section className="card stack" style={{ flex: '1 1 320px', minWidth: 0 }}><h3>Support access</h3><AccessState db={db} tenant={t} /></section>
    </div>
    <section className="card flat"><div className="row between" style={{ padding: '16px 20px' }}><h3>Invoices</h3><Link href="/admin/tenant-invoices-and-payments" style={{ fontSize: 13 }}>All invoices</Link></div>
      {inv.length === 0 ? <Empty icon="file-text" title="No invoices">Free and trial tenants aren’t billed.</Empty> : <InvoiceTable db={db} rows={inv} />}</section>
    <section className="card stack"><h3>Tickets</h3>{tks.length === 0 ? <p className="muted">No tickets.</p> : tks.map(k => <Link key={k.id} href={`/admin/support-tickets?k=${k.id}`} className="row" style={{ color: 'var(--fg-1)', minHeight: 40 }}><Mono>{k.id}</Mono><span className="grow">{k.a}</span><St s={k.d} /></Link>)}</section>

    {plan && <PlanSheet db={db} t={t} plan={plan} onClose={() => setPlan(null)} />}
    {access && <AccessSheet t={t} onClose={() => setAccess(false)} />}
    <Sheet open={!!confirm} onClose={() => setConfirm(null)} side="center" title={confirm === 'suspend' ? `Suspend ${t.name}?` : `Reactivate ${t.name}?`}
      sub={confirm === 'suspend' ? 'Registers keep cash sales offline, but back office, QR menu and online payments stop until reactivated.' : 'Everything comes back on. Billing restarts next cycle.'}
      footer={<><button className="btn" onClick={() => setConfirm(null)}>Cancel</button><button className={confirm === 'suspend' ? 'btn btn-danger' : 'btn btn-primary'} onClick={() => { patchRecord('tenant', t.id, { d: confirm === 'suspend' ? 'suspended' : 'active' }, 'tenant.' + (confirm === 'suspend' ? 'suspended' : 'reactivated')); toast(confirm === 'suspend' ? 'Suspended · logged' : 'Reactivated · logged'); setConfirm(null); }}>{confirm === 'suspend' ? 'Suspend tenant' : 'Reactivate'}</button></>}>
      <p className="muted" style={{ fontSize: 14 }}>Logged in the audit log with your name and time.</p>
    </Sheet>
  </>;
}
function PlanSheet({ db, t, plan, onClose }: { db: DB; t: Tenant; plan: Plan; onClose: () => void }) {
  const [custom, setCustom] = useState(String(t.meta.custom ?? ''));
  const next = plan === 'enterprise' ? Number(custom) || 0 : planPrice(db, plan) * t.outlets;
  const blocked = plan === 'free' && t.outlets > 1 ? `Free allows 1 outlet; ${t.name} has ${t.outlets}.` : '';
  return <Sheet open onClose={onClose} side="center" title={`Change plan to ${planName(plan)}`} sub={`${t.name} · ${t.outlets} outlet${t.outlets > 1 ? 's' : ''}`}
    footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={!!blocked || (plan === 'enterprise' && !next)} onClick={() => {
      if (plan === 'enterprise') patchRecord('tenant', t.id, { e: JSON.stringify({ ...t.meta, custom: next }) }, 'tenant.custom_price');
      setTenantPlan(t.id, plan); toast(`${t.name} is now on ${planName(plan)}`); onClose(); }}>Change plan</button></>}>
    <div className="stack">
      {blocked && <div className="banner b-danger"><Icon name="circle-alert" size={18} />{blocked}</div>}
      {plan === 'enterprise' && <Field label="Monthly price (excl. PPN)"><input className="input" inputMode="numeric" value={custom} onChange={e => setCustom(e.target.value.replace(/\D/g, ''))} /></Field>}
      <Dl rows={[['MRR now', idr(t.mrr)], ['MRR after', idr(next)], ['Next invoice incl. PPN 11%', idr(withTax(next))]]} />
      <p className="faint" style={{ fontSize: 13 }}>Prorated on the next invoice. The tenant owner gets an email.</p>
    </div>
  </Sheet>;
}
function AccessState({ db, tenant }: { db: DB; tenant: Tenant }) {
  const a = accessOf(db, tenant.id);
  if (a.state === 'none') return <p className="muted" style={{ fontSize: 14 }}>No access. Request it from a ticket or here; the tenant owner approves with their approval PIN.</p>;
  return <div className="stack sm">
    <div className="row"><St s={a.state === 'active' ? 'active' : a.state === 'requested' ? 'pending' : a.state === 'denied' ? 'rejected' : 'closed'} /><span style={{ fontSize: 14 }}>{a.state === 'active' ? `Until ${hhmm(a.until!)} · ${a.hours} h` : a.state === 'requested' ? `Waiting for ${tenant.meta.owner} · requested ${ago(a.at!)}` : a.state === 'expired' ? `Expired ${hhmm(a.until!)}` : human(a.state)}</span></div>
    {a.state === 'active' && <button className="btn btn-danger" style={{ alignSelf: 'flex-start' }} onClick={() => { endSupportAccess(a.id!); toast('Access ended · logged'); }}>End access now</button>}
  </div>;
}
function AccessSheet({ t, ticketId, onClose }: { t: Tenant; ticketId?: string; onClose: () => void }) {
  const [hours, setHours] = useState('2'), [reason, setReason] = useState(ticketId ? `Ticket ${ticketId}` : '');
  return <Sheet open onClose={onClose} side="center" title="Request support access" sub={`${t.name}. ${t.meta.owner} approves it with their approval PIN; access ends by itself.`}
    footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={reason.trim().length < 3} onClick={() => { requestSupportAccess(t.id, Number(hours), reason.trim(), ticketId); toast(t.real ? `Sent to ${t.meta.owner} for approval` : `Request sent to ${t.name}`); onClose(); }}>Send request</button></>}>
    <div className="stack">
      <Field label="Duration"><Seg label="Duration" value={hours} onChange={setHours} options={[['1', '1 hour'], ['2', '2 hours'], ['4', '4 hours']]} /></Field>
      <Field label="Reason" hint="The owner sees this"><input className="input" value={reason} onChange={e => setReason(e.target.value)} placeholder="Check printer routing for kitchen tickets" /></Field>
      <p className="faint" style={{ fontSize: 13 }}>Read and fix settings only. No access to card data, payouts or approval PINs. Every action during access is in the audit log.</p>
    </div>
  </Sheet>;
}

// ── Plans ─────────────────────────────────────────────────────────────────────────────────
function Plans({ db }: { db: DB }) {
  const { user } = useApp();
  const ts = tenants(db), [edit, setEdit] = useState<Plan | null>(null), [price, setPrice] = useState('');
  return <>
    <section className="card flat"><div className="scroll-x"><table className="table">
      <thead><tr><th>Plan</th><th className="r">Price / outlet</th><th className="r">Tenants</th><th className="r">Outlets</th><th className="r">MRR</th><th>Limits</th><th /></tr></thead>
      <tbody>{PLANS.map(p => { const on = ts.filter(t => t.plan === p.id && t.status !== 'churned'); return <tr key={p.id}>
        <td><b>{p.name}</b></td><td className="r num">{p.id === 'enterprise' ? 'Custom' : idr(planPrice(db, p.id))}</td><td className="r num">{on.length}</td><td className="r num">{on.reduce((a, t) => a + t.outlets, 0)}</td>
        <td className="r num">{idr(on.reduce((a, t) => a + t.mrr, 0))}</td><td className="muted">{p.limits}</td>
        <td className="r">{p.id !== 'enterprise' && p.id !== 'free' && <button className="btn btn-sm" onClick={() => { setEdit(p.id); setPrice(String(planPrice(db, p.id))); }}>Edit price</button>}</td></tr>; })}</tbody></table></div></section>
    <p className="faint" style={{ fontSize: 13 }}>Prices exclude PPN 11%. Payment MDR share on QRIS and VA is billed by the gateway, not here.</p>
    <Sheet open={!!edit} onClose={() => setEdit(null)} side="center" title={`Edit ${planName(edit ?? '')} price`} sub="Applies from the next invoice for every tenant on this plan. Tenants get 30 days’ notice by email."
      footer={<><button className="btn" onClick={() => setEdit(null)}>Cancel</button><button className="btn btn-primary" disabled={!(Number(price) > 0)} onClick={() => { setSetting(priceKey(edit!), Number(price), user.id); toast(`${planName(edit!)} is now ${idr(Number(price))} / outlet`); setEdit(null); }}>Save price</button></>}>
      <Field label="Price per outlet per month (IDR)"><input className="input" inputMode="numeric" value={price} onChange={e => setPrice(e.target.value.replace(/\D/g, ''))} /></Field>
    </Sheet>
  </>;
}

// ── Invoices ──────────────────────────────────────────────────────────────────────────────
const invNo = (r: Rec) => `INV-${r.b.slice(2)}-${r.a.slice(0, 4).toUpperCase()}`;
function InvoiceTable({ db, rows, sel, onSel }: { db: DB; rows: Rec[]; sel?: string; onSel?: (id: string) => void }) {
  return <div className="scroll-x"><table className="table"><thead><tr><th>Invoice</th><th>Tenant</th><th>Period</th><th className="r">Amount</th><th>Method</th><th>Status</th></tr></thead>
    <tbody>{rows.map(r => <tr key={r.id} className={onSel ? 'click' : undefined} tabIndex={onSel ? 0 : undefined} style={{ background: sel === r.id ? 'var(--role-soft)' : undefined }} onClick={() => onSel?.(r.id)} onKeyDown={e => e.key === 'Enter' && onSel?.(r.id)}>
      <td><Mono>{invNo(r)}</Mono></td><td>{nameOf(db, r.a)}</td><td>{new Date(r.at).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}</td><td className="r num">{idr(Number(r.c))}</td><td>{r.e}</td><td><St s={r.d} /></td></tr>)}</tbody></table></div>;
}
function Invoices({ db }: { db: DB }) {
  const [q, setQ] = useQuery({ i: '', f: 'all' });
  const all = (db.records.invoice ?? []).slice().sort((a, b) => b.at - a.at), rows = all.filter(r => q.f === 'all' || (q.f === 'unpaid' ? r.d !== 'paid' : r.d === q.f));
  const sel = all.find(r => r.id === q.i);
  const due = all.filter(r => r.d !== 'paid' && r.d !== 'void').reduce((a, r) => a + Number(r.c), 0), m0 = new Date(); m0.setDate(1); m0.setHours(0, 0, 0, 0);
  const collected = all.filter(r => r.d === 'paid' && r.at >= m0.getTime()).reduce((a, r) => a + Number(r.c), 0);
  return <>
    <section className="grid" style={{ ['--min' as string]: '180px' }}>
      <Kpi label="Collected this month" value={idrShort(collected)} />
      <Kpi label="Outstanding" value={idrShort(due)} delta={`${all.filter(r => r.d !== 'paid').length} invoices`} tone={due ? 'warn' : undefined} />
      <Kpi label="Failed" value={all.filter(r => r.d === 'failed').length} delta="Card or auto-debit declined" tone={all.some(r => r.d === 'failed') ? 'down' : undefined} />
    </section>
    <Seg label="Status" value={q.f} onChange={f => setQ({ f })} options={[['all', 'All'], ['unpaid', 'Unpaid'], ['failed', 'Failed'], ['past_due', 'Past due'], ['paid', 'Paid']]} />
    <Split table={rows.length ? <InvoiceTable db={db} rows={rows} sel={q.i} onSel={i => setQ({ i: q.i === i ? null : i })} /> : <Empty icon="file-text" title="No invoices here" />}
      detail={!sel ? <Empty icon="mouse-pointer-click" title="Select an invoice" /> : <>
        <div className="row between"><h3><Mono>{invNo(sel)}</Mono></h3><St s={sel.d} /></div>
        <Dl rows={[['Tenant', <Link key="t" href={`${DETAIL}?t=${sel.a}`}>{nameOf(db, sel.a)}</Link>], ['Issued', dateShort(sel.at)], ['Subtotal', idr(Math.round(Number(sel.c) / 1.11))], ['PPN 11%', idr(Number(sel.c) - Math.round(Number(sel.c) / 1.11))], ['Total', <b key="v" className="num">{idr(Number(sel.c))}</b>], ['Method', sel.e]]} />
        <p className="faint" style={{ fontSize: 12 }}><Icon name="shield" size={12} /> Card and account numbers are held by the payment gateway. BorNiz never stores or shows them.</p>
        {sel.d !== 'paid' && <div className="stack sm">
          {(sel.d === 'failed' || sel.d === 'past_due') && <button className="btn btn-primary" onClick={() => { patchRecord('invoice', sel.id, { d: 'retry_scheduled' }, 'invoice.retry_scheduled'); toast('Retry scheduled for 02:00 · logged'); }}>Retry payment</button>}
          <button className="btn" onClick={() => { logAdmin('invoice.reminder_sent', invNo(sel)); toast('WhatsApp reminder sent · logged'); }}>Send reminder (WhatsApp)</button>
          <button className="btn" onClick={() => { patchRecord('invoice', sel.id, { d: 'paid' }, 'invoice.marked_paid'); toast('Marked as paid · logged'); }}>Mark as paid</button>
        </div>}
      </>} />
  </>;
}

// ── Support ───────────────────────────────────────────────────────────────────────────────
function Tickets({ db }: { db: DB }) {
  const [q, setQ] = useQuery({ k: '', f: 'open' });
  const [access, setAccess] = useState(false);
  const RANK: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
  const all = (db.records.ticket ?? []).slice().sort((a, b) => RANK[a.c] - RANK[b.c] || b.at - a.at), rows = all.filter(k => q.f === 'all' || (q.f === 'open' ? k.d !== 'solved' : k.d === q.f));
  const sel = all.find(k => k.id === q.k), t = sel && tenants(db).find(x => x.id === sel.b);
  const ME = 'ops@bornis.id';
  return <>
    <Seg label="Status" value={q.f} onChange={f => setQ({ f })} options={[['open', 'Open'], ['waiting', 'Waiting on tenant'], ['solved', 'Solved'], ['all', 'All']]} />
    <Split table={rows.length ? <div className="scroll-x"><table className="table"><thead><tr><th>Ticket</th><th>Subject</th><th>Tenant</th><th>Priority</th><th>Status</th><th>Age</th></tr></thead>
      <tbody>{rows.map(k => <tr key={k.id} className="click" tabIndex={0} style={{ background: q.k === k.id ? 'var(--role-soft)' : undefined }} onClick={() => setQ({ k: q.k === k.id ? null : k.id })} onKeyDown={e => e.key === 'Enter' && setQ({ k: k.id })}>
        <td><Mono>{k.id}</Mono></td><td><b>{k.a}</b></td><td>{nameOf(db, k.b)}</td><td><St s={k.c} /></td><td><St s={k.d} /></td><td className="faint">{ago(k.at)}</td></tr>)}</tbody></table></div>
      : <Empty icon="life-buoy" title="No tickets here">Nice. New tickets from tenants show up here.</Empty>}
      detail={!sel || !t ? <Empty icon="mouse-pointer-click" title="Select a ticket" /> : <>
        <div className="row between"><Mono>{sel.id}</Mono><St s={sel.d} /></div>
        <h3>{sel.a}</h3>
        <Dl rows={[['Tenant', <Link key="t" href={`${DETAIL}?t=${t.id}`}>{t.name}</Link>], ['Plan', planName(t.plan)], ['Priority', human(sel.c)], ['Assignee', sel.e || 'Unassigned'], ['Opened', `${dateShort(sel.at)} ${hhmm(sel.at)}`]]} />
        <div className="sunken stack sm"><span className="cap">Support access</span><AccessState db={db} tenant={t} /></div>
        <div className="stack sm">
          {sel.e !== ME && <button className="btn" onClick={() => patchRecord('ticket', sel.id, { e: ME }, 'ticket.assigned')}>Assign to me</button>}
          {['none', 'expired', 'denied', 'ended'].includes(accessOf(db, t.id).state) && sel.d !== 'solved' && <button className="btn btn-primary" onClick={() => setAccess(true)}>Request support access</button>}
          {sel.c !== 'urgent' && sel.d !== 'solved' && <button className="btn btn-danger" onClick={() => patchRecord('ticket', sel.id, { c: 'urgent' }, 'ticket.escalated')}>Escalate to urgent</button>}
          <button className="btn" onClick={() => { patchRecord('ticket', sel.id, { d: sel.d === 'solved' ? 'open' : 'solved' }, sel.d === 'solved' ? 'ticket.reopened' : 'ticket.solved'); toast(sel.d === 'solved' ? 'Reopened' : 'Marked solved'); }}>{sel.d === 'solved' ? 'Reopen' : 'Mark solved'}</button>
        </div>
        {access && <AccessSheet t={t} ticketId={sel.id} onClose={() => setAccess(false)} />}
      </>} />
  </>;
}

// ── Flags & releases ──────────────────────────────────────────────────────────────────────
function Flags({ db }: { db: DB }) {
  const { user } = useApp();
  const [q, setQ] = useQuery({ g: '' });
  const flags = db.records.flag ?? [], sel = flags.find(f => f.id === q.g);
  const [pct, setPct] = useState(0);
  useEffect(() => { if (sel) setPct(Number(sel.b)); }, [sel?.id]);
  const live = tenants(db).filter(t => t.status !== 'churned').length;
  const releases = (db.records.release ?? []).slice().sort((a, b) => b.at - a.at);
  return <>
    <Split table={<div className="scroll-x"><table className="table"><thead><tr><th>Flag</th><th className="r">Rollout</th><th className="r">Tenants</th><th>Owner</th><th>State</th></tr></thead>
      <tbody>{flags.map(f => <tr key={f.id} className="click" tabIndex={0} style={{ background: q.g === f.id ? 'var(--role-soft)' : undefined }} onClick={() => setQ({ g: q.g === f.id ? null : f.id })} onKeyDown={e => e.key === 'Enter' && setQ({ g: f.id })}>
        <td><Mono>{f.a}</Mono></td><td className="r num">{f.d === 'on' ? f.b + '%' : '—'}</td><td className="r num">{f.d === 'on' ? Math.round((live * Number(f.b)) / 100) : 0}</td><td>{f.c}</td><td><St s={f.d} /></td></tr>)}</tbody></table></div>}
      detail={!sel ? <Empty icon="flag" title="Select a flag">Change rollout or switch it off. Saved changes reach devices within a minute.</Empty> : <>
        <div className="row between"><Mono>{sel.a}</Mono><Toggle on={sel.d === 'on'} label="Flag on" onChange={on => { saveRecord('flag', { ...sel, d: on ? 'on' : 'off' }, user.id); toast(`${sel.a} ${on ? 'on' : 'off'} · logged`); }} /></div>
        <p className="muted" style={{ fontSize: 14 }}>{sel.e}</p>
        <Field label={`Rollout · ${pct}% of tenants`} hint={`≈ ${Math.round((live * pct) / 100)} of ${live}`}><input type="range" min={0} max={100} step={5} value={pct} onChange={e => setPct(Number(e.target.value))} disabled={sel.d !== 'on'} style={{ width: '100%', accentColor: 'var(--role)', height: 44 }} /></Field>
        <button className="btn btn-primary" disabled={sel.d !== 'on' || String(pct) === sel.b} onClick={() => { saveRecord('flag', { ...sel, b: String(pct) }, user.id); toast(`${sel.a} ${sel.b}% → ${pct}% · logged`); }}>Save rollout</button>
      </>} />
    <section className="card flat"><div className="row between" style={{ padding: '16px 20px' }}><h3>Releases</h3></div>
      <div className="scroll-x"><table className="table"><thead><tr><th>Version</th><th>Notes</th><th>Date</th><th className="r">Rollout</th><th>Status</th><th /></tr></thead>
        <tbody>{releases.map(r => <tr key={r.id}><td><Mono>{r.a}</Mono></td><td>{r.c}</td><td>{dateShort(r.at)}</td><td className="r num">{r.d}%</td><td><St s={r.b} /></td>
          <td className="r">{r.b === 'rolling' && <button className="btn btn-sm" onClick={() => { const n = Math.min(100, Number(r.d) + 20); saveRecord('release', { ...r, d: String(n), b: n >= 100 ? 'shipped' : 'rolling' }, user.id); toast(`${r.a} at ${n}%`); }}>Roll out to {Math.min(100, Number(r.d) + 20)}%</button>}</td></tr>)}</tbody></table></div>
    </section>
  </>;
}

// ── Audit ─────────────────────────────────────────────────────────────────────────────────
function Audit({ db }: { db: DB }) {
  const [q, setQ] = useQuery({ a: '', who: 'all' });
  const [search, setSearch] = useState('');
  const who = (id: string) => db.employees.find(e => e.id === id)?.name ?? (id === 'admin' ? 'BorNiz admin' : human(id));
  const actors = [...new Set(db.audit.map(a => a.actor))];
  const rows = db.audit.filter(a => (q.who === 'all' || a.actor === q.who) && (!search || (a.action + ' ' + a.subject + ' ' + who(a.actor)).toLowerCase().includes(search.toLowerCase())));
  const sel = db.audit.find(a => a.id === q.a);
  const exportCsv = () => {
    const csv = ['time,actor,action,subject,outlet', ...rows.map(a => [new Date(a.at).toISOString(), who(a.actor), a.action, a.subject, a.outletId ?? ''].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))].join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), el = document.createElement('a');
    el.href = url; el.download = `borniz-audit-${new Date().toISOString().slice(0, 10)}.csv`; el.click(); URL.revokeObjectURL(url);
    logAdmin('audit.exported', `${rows.length} rows`);
  };
  return <>
    <div className="row wrap between">
      <div className="row wrap"><select className="input" style={{ height: 40, width: 'auto' }} value={q.who} onChange={e => setQ({ who: e.target.value })} aria-label="Actor"><option value="all">Everyone</option>{actors.map(a => <option key={a} value={a}>{who(a)}</option>)}</select>
        <input className="search" style={{ maxWidth: 280 }} placeholder="Search action or subject" value={search} onChange={e => setSearch(e.target.value)} aria-label="Search audit log" /></div>
      <button className="btn" onClick={exportCsv} disabled={!rows.length}><Icon name="download" size={18} />Export CSV</button>
    </div>
    <Split table={rows.length === 0 ? <Empty icon="scroll-text" title={db.audit.length ? 'No entries match' : 'No activity yet'}>Every change made anywhere in the product is written here and never edited.</Empty>
      : <div className="scroll-x" style={{ maxHeight: '70dvh', overflowY: 'auto' }}><table className="table"><thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Subject</th><th>Outlet</th></tr></thead>
        <tbody>{rows.slice(0, 300).map(a => <tr key={a.id} className="click" tabIndex={0} style={{ background: q.a === a.id ? 'var(--role-soft)' : undefined }} onClick={() => setQ({ a: q.a === a.id ? null : a.id })} onKeyDown={e => e.key === 'Enter' && setQ({ a: a.id })}>
          <td className="mono" style={{ whiteSpace: 'nowrap' }}>{dateShort(a.at)} {new Date(a.at).toTimeString().slice(0, 8)}</td><td>{who(a.actor)}</td><td><Mono>{a.action}</Mono></td><td style={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.subject}</td><td>{db.outlets.find(o => o.id === a.outletId)?.name ?? '—'}</td></tr>)}</tbody></table></div>}
      detail={!sel ? <Empty icon="mouse-pointer-click" title="Select an entry">{rows.length > 300 ? `Showing the newest 300 of ${rows.length}.` : `${rows.length} entries.`}</Empty> : <>
        <Mono>{sel.id}</Mono>
        <Dl rows={[['Time', `${dateShort(sel.at)} ${new Date(sel.at).toTimeString().slice(0, 8)}`], ['Actor', who(sel.actor)], ['Action', <Mono key="a">{sel.action}</Mono>], ['Subject', sel.subject || '—'], ['Outlet', db.outlets.find(o => o.id === sel.outletId)?.name ?? 'All / none']]} />
        {(sel.before !== undefined || sel.after !== undefined) && <pre className="sunken mono" style={{ whiteSpace: 'pre-wrap', fontSize: 12, margin: 0 }}>{JSON.stringify({ before: sel.before, after: sel.after }, null, 2)}</pre>}
        <span className="faint" style={{ fontSize: 12 }}>Entries can’t be edited or deleted.</span>
      </>} />
  </>;
}

// ── Themes & white-label ──────────────────────────────────────────────────────────────────
type BrandTheme = { p: string; acc: string; ink: string; paper: string; font: string; banner: string };
function Themes({ db }: { db: DB }) {
  const { user } = useApp();
  const themes = Object.entries(catalog.brandThemes as Record<string, BrandTheme>), ts = tenants(db);
  const def = String(db.settings['/admin/theme-presets-library:default'] ?? themes[0][0]);
  return <>
    <div className="grid" style={{ ['--min' as string]: '240px' }}>{themes.map(([name, t]) => { const used = ts.filter(x => x.meta.theme === name).length; return <section key={name} className="card stack sm">
      <div data-guest style={{ background: t.paper, color: t.ink, borderRadius: 'var(--radius-md)', padding: 16, border: '1px solid var(--border)' }}>
        <b style={{ fontSize: 18, color: t.ink }}>{name}</b>
        <div className="row" style={{ marginTop: 10 }}><span style={{ background: t.p, color: t.paper, borderRadius: 10, padding: '8px 14px', fontWeight: 700, fontSize: 13 }}>Order now</span><span style={{ background: t.acc, color: t.ink, borderRadius: 99, padding: '4px 10px', fontWeight: 700, fontSize: 12 }}>Promo</span></div>
      </div>
      <div className="row">{[t.p, t.acc, t.ink, t.paper].map(c => <span key={c} title={c} style={{ width: 22, height: 22, borderRadius: 99, background: c, border: '1px solid var(--border)' }} />)}<span className="faint mono grow" style={{ textAlign: 'right' }}>{t.font}</span></div>
      <span className="muted" style={{ fontSize: 13 }}>Used by {used} tenant{used === 1 ? '' : 's'}</span>
      {def === name ? <Badge tone="violet">Default for new tenants</Badge> : <button className="btn btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => { setSetting('/admin/theme-presets-library:default', name, user.id); toast(`${name} is the default for new tenants`); }}>Make default</button>}
    </section>; })}</div>
    <WhiteLabel db={db} />
  </>;
}
function WhiteLabel({ db }: { db: DB }) {
  const wl = tenants(db).filter(t => t.meta.wl);
  return <section className="card flat"><div className="row between" style={{ padding: '16px 20px' }}><h3>White-label tenants</h3><Badge>Enterprise and add-on</Badge></div>
    {wl.length === 0 ? <Empty icon="badge" title="No white-label tenants" /> : <div className="scroll-x"><table className="table"><thead><tr><th>Tenant</th><th>App name</th><th>Plan</th><th>Domain</th></tr></thead>
      <tbody>{wl.map(t => { return <tr key={t.id}><td><Link href={`${DETAIL}?t=${t.id}`}>{t.name}</Link></td><td>{t.meta.appName ?? '—'}</td><td>{planName(t.plan)}</td><td>{liveDomain(t.meta.slug ?? t.id) ? <Mono>{liveDomain(t.meta.slug ?? t.id)}</Mono> : <span className="faint">None</span>}</td></tr>; })}</tbody></table></div>}
  </section>;
}

// ── Custom domains: the ones this deployment serves (NEXT_PUBLIC_BORNIZ_CUSTOM_DOMAINS), switched on by deploy/add-domain.sh ──
function Domains({ db }: { db: DB }) {
  const [q, setQ] = useQuery({ d: '' });
  const [dns, setDns] = useState(''), [add, setAdd] = useState(false), [host, setHost] = useState(''), [chosen, setPick] = useState('');
  const live = hostConfig().customDomains, ts = tenants(db), slug = (t: Tenant) => t.meta.slug ?? t.id;
  const pick = chosen || (ts[0] ? slug(ts[0]) : ''); // the select shows the first business until one is picked
  // live ones, then the ones a business asked for in Studios that are not switched on yet
  const asked = domainRequests(ts.map(t => ({ slug: slug(t), domain: t.meta.domain })), live);
  const rows: [string, string, boolean, string?][] = [...Object.entries(live).map(([h, t]) => [h, t, true] as [string, string, boolean]),
    ...asked.map(a => [a.host, a.slug, false, a.problem] as [string, string, boolean, string?])];
  const sel = rows.find(([h]) => h === q.d);
  const check = async (h: string) => {
    setDns('Checking…');
    try {
      const j = await (await fetch(`https://dns.google/resolve?name=${encodeURIComponent(h)}&type=CNAME`)).json() as { Answer?: { data: string }[] };
      setDns((j.Answer ?? []).some(a => a.data.replace(/\.$/, '') === cnameTarget()) ? 'CNAME is right' : 'CNAME not found yet. DNS can take up to 24 h.');
    } catch { setDns('Couldn’t reach DNS. Check your connection and try again.'); }
  };
  const cmd = (h: string, t: string) => `sudo sh /srv/borniz/deploy/add-domain.sh ${h} ${t}`;
  const okHost = /^(?!-)[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host.trim().toLowerCase());
  return <>
    <div className="row between"><span className="muted" style={{ fontSize: 14 }}>{rows.filter(r => r[2]).length} live · {rows.filter(r => !r[2]).length} asked for</span><button className="btn btn-primary" onClick={() => setAdd(true)}><Icon name="plus" size={18} />Switch on a domain</button></div>
    <Split table={rows.length === 0 ? <Empty icon="globe" title="No custom domains live" /> : <div className="scroll-x"><table className="table"><thead><tr><th>Domain</th><th>Business</th><th>Status</th></tr></thead>
      <tbody>{rows.map(([h, t, on]) => <tr key={h + '|' + t} className="click" tabIndex={0} style={{ background: q.d === h ? 'var(--role-soft)' : undefined }} onClick={() => { setDns(''); setQ({ d: q.d === h ? null : h }); }} onKeyDown={e => e.key === 'Enter' && setQ({ d: h })}>
        <td><Mono>{h}</Mono></td><td>{ts.find(x => slug(x) === t)?.name ?? t}</td><td>{on ? <Badge tone="success">Live</Badge> : <Badge tone="warning">Asked for</Badge>}</td></tr>)}</tbody></table></div>}
      detail={!sel ? <Empty icon="mouse-pointer-click" title="Select a domain">Its DNS record and a live check show here.</Empty> : <>
        <Mono>{sel[0]}</Mono>
        <div className="sunken stack sm" style={{ fontSize: 13 }}><span className="cap">CNAME</span><Mono>{sel[0]} → {cnameTarget()}</Mono></div>
        <button className="btn" onClick={() => check(sel[0])}>Check DNS now</button>{dns && <span className="muted" style={{ fontSize: 13 }}>{dns}</span>}
        {sel[3] && <Badge tone="warning">{sel[3]}: ask them who owns it before switching it on</Badge>}
        {!sel[2] && !sel[3] && <><div className="sunken stack sm" style={{ fontSize: 13 }}><span className="cap">Switch it on, on the server</span><Mono>{cmd(sel[0], sel[1])}</Mono></div>
          <button className="btn btn-ghost" onClick={() => navigator.clipboard?.writeText(cmd(sel[0], sel[1])).then(() => toast('Command copied'))}><Icon name="copy" size={18} />Copy command</button></>}
      </>} />
    <WhiteLabel db={db} />
    <Sheet open={add} onClose={() => setAdd(false)} side="center" title="Switch on a custom domain" sub="After the business points a CNAME at BorNiz, run this once on the server: it gets the certificate, serves the domain and rebuilds."
      footer={<button className="btn btn-primary" onClick={() => setAdd(false)}>Done</button>}>
      <div className="stack">
        <Field label="Business"><select className="input" value={pick} onChange={e => setPick(e.target.value)}>{ts.map(t => <option key={t.id} value={slug(t)}>{t.name}</option>)}</select></Field>
        <Field label="Domain" error={host && !okHost ? 'Enter a domain like order.yourbrand.id' : undefined}><input className="input" value={host} onChange={e => setHost(e.target.value)} placeholder="order.yourbrand.id" autoCapitalize="none" /></Field>
        <div className="sunken stack sm" style={{ fontSize: 13 }}><span className="cap">CNAME at their DNS</span><Mono>{(okHost ? host.trim().toLowerCase() : 'order.yourbrand.id') + ' → ' + cnameTarget()}</Mono></div>
        {okHost && <><button className="btn" onClick={() => check(host.trim().toLowerCase())}>Check DNS now</button>{dns && <span className="muted" style={{ fontSize: 13 }}>{dns}</span>}
          <div className="sunken stack sm" style={{ fontSize: 13 }}><span className="cap">On the server</span><Mono>{cmd(host.trim().toLowerCase(), pick)}</Mono></div>
          <button className="btn btn-ghost" onClick={() => navigator.clipboard?.writeText(cmd(host.trim().toLowerCase(), pick)).then(() => toast('Command copied'))}><Icon name="copy" size={18} />Copy command</button></>}
      </div>
    </Sheet>
  </>;
}
