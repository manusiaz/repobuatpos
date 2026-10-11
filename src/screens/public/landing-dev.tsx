'use client';
// Developer API docs (service events from src/system/graph.ts, tables from the live store = the ERD in src/data/schema.ts)
// and system status (devices, outlets, payments and messages from the store).
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useApp } from '../../app/context.tsx';
import { EVENTS } from '../../system/graph.ts';
import { PROTOTYPE, type Surface } from '../../system/registry.ts';
import { Badge, Icon, Status, ago, useNow, type Tone } from '../../ui/kit.tsx';
import { PageHead, Wrap } from './landing-ui.tsx';

const Code = ({ children }: { children: string }) =>
  <pre className="mono" style={{ margin: 0, padding: 16, borderRadius: 'var(--radius-md)', background: 'var(--ink-950)', color: 'var(--ink-100)', overflowX: 'auto', fontSize: 13, lineHeight: 1.55 }}>{children}</pre>;

const SECTIONS: [string, string][] = [['auth', 'Authentication'], ['rest', 'REST resources'], ['events', 'Service events'], ['webhooks', 'Webhooks'], ['tables', 'Tables'], ['rules', 'Rules the API enforces']];

export function ApiDocs() {
  const { db } = useApp();
  const [q, setQ] = useState('');
  const tables = useMemo(() => Object.entries(db).filter(([, v]) => Array.isArray(v) && v.length && typeof v[0] === 'object').map(([k, v]) => {
    const rows = v as Record<string, unknown>[];
    const cols = [...new Set(rows.slice(0, 20).flatMap(r => Object.keys(r)))];
    return { name: k, count: rows.length, cols: cols.map(c => { const s = rows.find(r => r[c] != null)?.[c]; return [c, Array.isArray(s) ? 'array' : s === null || s === undefined ? 'null' : typeof s === 'number' && /price|amount|total|subtotal|tax|service|discount|cost|wage|credit|deposit|float|tip|variance|counted/i.test(c) ? 'IDR (int)' : typeof s] as const; }) };
  }), [db]);
  const settled = db.payments.find(p => p.status === 'settled' && !p.id.startsWith('hp')) ?? db.payments.find(p => p.status === 'settled');
  const ql = q.toLowerCase();
  const evs = Object.entries(EVENTS).filter(([k, e]) => !ql || (k + e.note + e.writes.join(' ')).toLowerCase().includes(ql));
  const surf = (s: Surface) => PROTOTYPE[s];
  return <Wrap><div className="row wrap" style={{ gap: 32, alignItems: 'flex-start' }}>
    <nav className="card stack sm hide-sm" aria-label="API sections" style={{ flex: '1 1 200px', position: 'sticky', top: 88 }}><span className="cap">API v1</span>{SECTIONS.map(([id, t]) => <a key={id} href={'#' + id} style={{ fontSize: 14, color: 'var(--fg-2)' }}>{t}</a>)}</nav>
    <div className="stack lg" style={{ flex: '4 1 520px', minWidth: 0, maxWidth: '100%' }}>
      <PageHead kicker="Developers" title="BorNiz API" sub={<>REST + webhooks over the same service layer every BorNiz screen uses. Money is always an integer in rupiah. Available on <Link href="/pricing">Enterprise</Link>.</>} />

      <section id="auth" className="stack"><h2>Authentication</h2>
        <p className="muted">Create an API key in Owner › Account › API keys (owner only, approval PIN). Send it as a bearer token. Keys are scoped to one tenant; every call is written to the audit log with the key name.</p>
        <Code>{`curl https://api.bornis.id/v1/orders?outlet=sen&status=paid \\
  -H "Authorization: Bearer bnz_live_…" \\
  -H "Idempotency-Key: 7f3c…"   # required on every POST`}</Code></section>

      <section id="rest" className="stack"><h2>REST resources</h2>
        <p className="muted">Each table below is a resource: <span className="mono">GET /v1/{'{table}'}</span>, <span className="mono">GET /v1/{'{table}'}/{'{id}'}</span>. Writes go through service endpoints that emit the events below; sales records (orders, payments) are never edited, only voided or refunded.</p>
        <div className="card flat scroll-x"><table className="table"><thead><tr><th>Method</th><th>Endpoint</th><th>Does</th></tr></thead><tbody>
          {[['POST', '/v1/orders', 'order.created'], ['POST', '/v1/orders/{id}/send', 'order.sent'], ['POST', '/v1/payments', 'payment.created'], ['POST', '/v1/approvals', 'approval.requested'], ['POST', '/v1/approvals/{id}/decide', 'approval.approved'], ['POST', '/v1/products', 'product.saved'], ['POST', '/v1/customers', 'customer.created'], ['POST', '/v1/stock/opnames/{id}/submit', 'opname.submitted']].map(([m, p, e]) => <tr key={p}><td><Badge tone={m === 'GET' ? 'info' : 'accent'}>{m}</Badge></td><td className="mono">{p}</td><td><a href={'#ev-' + e} className="mono">{e}</a></td></tr>)}
        </tbody></table></div></section>

      <section id="events" className="stack"><div className="row between wrap"><h2>Service events · {Object.keys(EVENTS).length}</h2><input className="search" style={{ maxWidth: 280 }} placeholder="Filter events" value={q} onChange={e => setQ(e.target.value)} aria-label="Filter events" /></div>
        <p className="muted">Every write in BorNiz is one of these events. Effects of one event run in the same transaction; webhooks fire after commit.</p>
        <div className="card flat scroll-x"><table className="table" style={{ minWidth: 640 }}><thead><tr><th>Event</th><th>Updates</th><th>Emitted from</th><th>Notes</th></tr></thead><tbody>
          {evs.map(([k, e]) => <tr key={k} id={'ev-' + k}><td className="mono" style={{ whiteSpace: 'nowrap' }}>{k}</td><td><div className="row wrap" style={{ gap: 4, padding: '6px 0' }}>{e.writes.map(w => <Badge key={w}>{w}</Badge>)}</div></td><td style={{ fontSize: 13 }}>{e.from.map(surf).join(', ')}</td><td className="muted" style={{ fontSize: 13 }}>{e.note}</td></tr>)}
        </tbody></table></div>
        <Link href="/graph?node=e%3Apayment.settled" className="row" style={{ fontSize: 14 }}><Icon name="waypoints" size={16} />See events in the knowledge graph</Link></section>

      <section id="webhooks" className="stack"><h2>Webhooks</h2>
        <p className="muted">Subscribe a URL per event. We sign each delivery with <span className="mono">BorNiz-Signature: t=…,v1=HMAC-SHA256</span>, retry with backoff for 24 hours, and deliver at least once, so dedupe on <span className="mono">id</span>.</p>
        <Code>{JSON.stringify({ id: 'evt_' + (settled?.id ?? 'pay'), type: 'payment.settled', created: settled ? new Date(settled.at).toISOString() : '', data: settled ? { id: settled.id, orderId: settled.orderId, outletId: settled.outletId, method: settled.method, amount: settled.amount, tip: settled.tip, status: settled.status, ref: settled.ref } : {} }, null, 2)}</Code></section>

      <section id="tables" className="stack"><h2>Tables · {tables.length}</h2>
        <p className="muted">Live from the demo tenant. Every row is tenant-scoped (row-level security); ids are strings, times are Unix milliseconds.</p>
        <div className="grid" style={{ ['--min' as string]: '260px', gap: 12 }}>{tables.map(t => <details key={t.name} className="card tight">
          <summary className="row between" style={{ cursor: 'pointer' }}><b className="mono" style={{ fontSize: 14 }}>{t.name}</b><span className="faint" style={{ fontSize: 12 }}>{t.count} rows · {t.cols.length} fields</span></summary>
          <div className="stack" style={{ gap: 2, marginTop: 8 }}>{t.cols.map(([c, ty]) => <div key={c} className="row between" style={{ fontSize: 13 }}><span className="mono">{c}</span><span className="faint">{ty}</span></div>)}</div>
        </details>)}</div></section>

      <section id="rules" className="stack"><h2>Rules the API enforces</h2>
        <ul className="stack sm" style={{ paddingLeft: 20, margin: 0 }}>
          <li>A payment is settled only by the gateway webhook. QRIS expires after 5 minutes.</li>
          <li>Approvals follow the ladder: PIC (discount ≤ 20%, void/refund ≤ IDR 100,000, variance ≤ IDR 50,000) → manager (≤ IDR 500,000) → owner. Nobody decides their own request.</li>
          <li>Stock changes only through movements; an opname posts after someone other than the counter approves it.</li>
          <li>Delivery-app orders are incoming only: accept, reject with a reason, cook, ready.</li>
          <li>Permission changes (<span className="mono">perms.changed</span>) are owner-only and need the approval PIN.</li>
        </ul></section>
    </div>
  </div></Wrap>;
}

// ── Status ──────────────────────────────────────────────────────────────────────────────
type Health = 'operational' | 'degraded' | 'down';
const HT: Record<Health, [Tone, string]> = { operational: ['success', 'Operational'], degraded: ['warning', 'Degraded'], down: ['danger', 'Down'] };

export function SystemStatus() {
  const { db } = useApp();
  const now = useNow(15000);
  const recent = db.payments.filter(p => now - p.at < 3600e3);
  const lastPay = db.payments.reduce((a, p) => p.status === 'settled' ? Math.max(a, p.at) : a, 0);
  const stuck = db.payments.filter(p => p.status === 'pending' && p.expiresAt && p.expiresAt < now).length;
  const failedMsg = db.messages.filter(m => m.status === 'failed' && now - m.at < 864e5).length;
  const offline = db.devices.filter(d => d.status === 'offline');
  const services: [string, string, Health][] = [
    ['Cloud API', 'Orders, products, reports', 'operational'],
    ['Realtime sync', db.device.queue.length ? `${db.device.queue.length} actions waiting on a device` : 'Registers, kitchen and displays in sync', db.device.online ? 'operational' : 'degraded'],
    ['Payments (QRIS, VA, e-wallet)', lastPay ? `Last confirmation ${ago(lastPay, now)} · ${recent.length} in the last hour` : 'No payments yet', stuck ? 'degraded' : 'operational'],
    ['WhatsApp messaging', failedMsg ? `${failedMsg} failed in 24 h` : 'Receipts and OTP delivering', failedMsg > 5 ? 'degraded' : 'operational'],
    ['Devices', offline.length ? `${offline.length} of ${db.devices.length} offline` : `All ${db.devices.length} online`, offline.length ? 'degraded' : 'operational'],
  ];
  const worst: Health = services.some(s => s[2] === 'down') ? 'down' : services.some(s => s[2] === 'degraded') ? 'degraded' : 'operational';
  const incidents = db.notices.filter(n => n.level !== 'info').slice(0, 5);
  return <Wrap><div className="stack lg" style={{ maxWidth: 880 }}>
    <PageHead kicker="System status" title={worst === 'operational' ? 'All systems operational' : 'Some systems need attention'} sub={`Checked ${ago(now - 1000, now)} · updates every 15 seconds.`} />
    <div className={'banner b-' + HT[worst][0]} style={{ alignItems: 'center' }}><Icon name={worst === 'operational' ? 'circle-check' : 'triangle-alert'} /><b className="grow">{HT[worst][1]}</b><span style={{ fontSize: 13 }}>Registers keep selling offline during any outage.</span></div>
    <div className="card flat">{services.map(([t, d, h]) => <div key={t} className="row" style={{ padding: '14px 18px', borderTop: '1px solid var(--border)', minHeight: 64 }}>
      <span className="grow"><b style={{ fontSize: 15 }}>{t}</b><br /><span className="faint" style={{ fontSize: 13 }}>{d}</span></span><Badge tone={HT[h][0]} dot>{HT[h][1]}</Badge></div>)}</div>
    <div className="stack"><h2>Outlets</h2>
      <div className="grid" style={{ ['--min' as string]: '260px', gap: 12 }}>{db.outlets.map(o => { const ds = db.devices.filter(d => d.outletId === o.id); return <div key={o.id} className="card stack sm">
        <div className="row between"><b>{o.name}</b><Status s={o.online ? 'online' : 'offline'} /></div><span className="faint" style={{ fontSize: 13 }}>{o.city} · {o.opens}–{o.closes}</span>
        {ds.map(d => <div key={d.id} className="row between" style={{ fontSize: 13 }}><span>{d.name}</span><span className="row" style={{ gap: 6 }}><span className="faint">{d.status === 'online' ? 'now' : d.lastSeen ? ago(d.lastSeen, now) : 'never'}</span><span className="dot" style={{ color: d.status === 'online' ? 'var(--success)' : 'var(--danger)' }} /></span></div>)}
        {!ds.length && <span className="faint" style={{ fontSize: 13 }}>No devices paired</span>}
      </div>; })}</div></div>
    <div className="stack"><h2>Recent alerts</h2>
      {incidents.length ? incidents.map(n => <div key={n.id} className="row" style={{ alignItems: 'flex-start', padding: '10px 0', borderTop: '1px solid var(--border)' }}><Badge tone={n.level === 'high' ? 'danger' : 'warning'} dot>{n.alert}</Badge><span className="grow" style={{ fontSize: 14 }}>{n.text}</span><span className="faint" style={{ fontSize: 13 }}>{ago(n.at, now)}</span></div>)
        : <span className="muted">No incidents.</span>}</div>
  </div></Wrap>;
}
