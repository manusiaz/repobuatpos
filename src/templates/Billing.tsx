'use client';
// Owner › Account › Subscription billing: the plan and the invoices BorNiz billing issued (src/data/billing.ts). The
// platform keeps them (bn_my_invoices, owner only); nobody here creates or edits one.
import { useEffect, useState } from 'react';
import Link from '../ui/Link.tsx';
import { useApp } from '../app/context.tsx';
import { Badge, Empty, Loading } from '../ui/kit.tsx';
import { idr } from '../domain/money.ts';
import { REMOTE } from '../data/remote.ts';
import { remoteInfo } from '../data/remoteStore.ts';
import { planOf } from '../screens/public/plans.ts';
import type { Rec } from '../data/schema.ts';
import { PageHead } from './common.tsx';
import { isSharedDevice } from '../session.ts';

type Invoice = Rec & { n?: string };
const TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = { paid: 'success', unpaid: 'warning', past_due: 'danger', failed: 'danger', void: 'neutral' };

export function Billing() {
  const { db } = useApp();
  const [rows, setRows] = useState<Invoice[] | null>(REMOTE ? null : (db.records.invoice ?? []).filter(r => r.a === db.tenant.id));
  const [error, setError] = useState('');
  useEffect(() => {
    if (!REMOTE || isSharedDevice()) return;
    void import('../data/backend.ts').then(s => s.sb().rpc<Invoice[]>('bn_my_invoices', { p_tenant: remoteInfo().tenant?.id }))
      .then(r => r.error ? setError(r.error.message) : setRows(r.data ?? []));
  }, []);
  const plan = planOf(db.tenant.plan);
  return <div className="stack lg">
    <PageHead sub="What BorNiz bills this business. Invoices come from your plan and outlets; nobody here creates or edits one." />
    <section className="card row between wrap">
      <span className="stack sm" style={{ gap: 2 }}><b style={{ fontSize: 18 }}>{plan.name}</b>
        <span className="muted" style={{ fontSize: 14 }}>{db.outlets.length} {db.outlets.length === 1 ? 'outlet' : 'outlets'} · {plan.monthly ? 'billed on the 1st of each month, PPN 11% included' : plan.monthly === 0 ? 'free, never billed' : 'priced per contract'}</span></span>
      <Link className="btn" href="/account/choose-plan">Change plan</Link>
    </section>
    {isSharedDevice() ? <Empty icon="lock" title="Sign in as the owner">BorNiz invoices belong to the business account. Open this page on the owner’s phone or laptop.</Empty>
      : error ? <Empty icon="circle-alert" title="Invoices could not load">{error}</Empty>
      : !rows ? <Loading />
      : !rows.length ? <Empty icon="file-text" title="No invoices yet">Basic and Pro are billed on the 1st of each month. Free and trials are never billed.</Empty>
      : <div className="scroll-x"><table className="table"><thead><tr><th>Month</th><th>Plan</th><th className="r">Amount</th><th>Status</th></tr></thead>
        <tbody>{rows.map(r => <tr key={r.id}><td>{r.b}</td><td>{r.n ?? '—'}</td><td className="r num">{idr(Number(r.c))}</td><td><Badge tone={TONE[r.d] ?? 'neutral'} dot>{r.d.replace('_', ' ')}</Badge></td></tr>)}</tbody></table></div>}
  </div>;
}
