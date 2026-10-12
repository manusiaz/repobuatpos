'use client';
// Commission rules on Payroll & commission. Payroll is owner-only: the owner saves with the approval PIN,
// a manager's change goes to the owner as a payroll approval. The payroll table and "My commission" read the same rules.
import { useState } from 'react';
import { useApp } from '../app/context.tsx';
import { isGated } from '../system/access.ts';
import { Badge, Empty, Field, Icon, Sheet, toast } from '../ui/kit.tsx';
import { usePin } from '../ui/PinSheet.tsx';
import { idr } from '../domain/money.ts';
import type { CommissionRule } from '../domain/commission.ts';
import { uid } from '../data/store.ts';
import { requestCommissionRules, saveCommissionRules } from '../data/actions/payroll.ts';
import { ROLE_LABEL } from '../screens/ops/shift.ts';

const ROLES = ['cashier', 'pic', 'waiter', 'kitchen', 'manager'] as const;
const blank = (): CommissionRule => ({ id: uid('cr'), name: '', employeeId: null, role: 'cashier', salesBps: 0, perItem: 0, productIds: [], categoryIds: [] });

export function CommissionRules() {
  const { db, user, page, outletId } = useApp();
  const pin = usePin();
  const rules = db.commissionRules ?? [];
  const gated = isGated(user.role, page), canSave = user.role === 'owner' || gated;
  const [edit, setEdit] = useState<CommissionRule | null>(null);
  const waiting = db.approvals.find(a => a.type === 'payroll' && a.status === 'waiting' && Array.isArray(a.payload?.commissionRules));
  const who = (r: CommissionRule) => r.employeeId ? db.employees.find(e => e.id === r.employeeId)?.name ?? r.employeeId : 'Every ' + (ROLE_LABEL[r.role as keyof typeof ROLE_LABEL] ?? r.role ?? '').toLowerCase();
  const what = (r: CommissionRule) => [r.salesBps ? `${r.salesBps / 100}% of net sales` : '', r.perItem ? `${idr(r.perItem)} per item · ${[...r.categoryIds.map(c => db.categories.find(x => x.id === c)?.name ?? c), ...r.productIds.map(p => db.products.find(x => x.id === p)?.name ?? p)].join(', ') || 'no items chosen'}` : ''].filter(Boolean).join(' + ') || 'Nothing yet';
  const save = (next: CommissionRule[], label: string) => {
    if (gated) { requestCommissionRules(next, user.id, outletId, label); toast('Sent to the owner · applies once approved'); setEdit(null); return; }
    pin.ask({ title: 'Commission rules · ' + label, onOk: by => { saveCommissionRules(next, by); toast('Saved · payroll and staff commission use it now'); setEdit(null); } });
  };
  return <section className="card stack">
    <div className="row between wrap"><div className="stack sm"><h3>Commission rules</h3><span className="muted" style={{ fontSize: 14 }}>Net sales = paid orders the person rang up, after discounts, without PB1 and service, minus refunds. Rounded down to the rupiah.</span></div>
      {canSave && <button className="btn btn-primary" onClick={() => setEdit(blank())}><Icon name="plus" size={18} />{gated ? 'Request rule' : 'New rule'}</button>}</div>
    {waiting && <div className="banner b-info"><Icon name="send" size={18} /><span>{waiting.title} · waiting for the owner</span></div>}
    {rules.length === 0 ? <Empty icon="percent" title="No commission rules">Nobody earns commission until a rule is added.</Empty>
      : <div className="stack sm">{rules.map(r => <div key={r.id} className="row wrap" style={{ padding: '10px 0', borderTop: '1px solid var(--border)', minHeight: 44 }}>
        <span className="grow stack" style={{ gap: 2 }}><b style={{ fontSize: 14 }}>{r.name || what(r)}</b><span className="muted" style={{ fontSize: 13 }}>{what(r)}</span></span>
        <Badge tone={r.employeeId ? 'accent' : 'info'}>{who(r)}</Badge>
        {canSave && <button className="btn btn-sm" onClick={() => setEdit(r)}>Edit</button>}</div>)}</div>}
    {!canSave && <span className="faint" style={{ fontSize: 13 }}>Only the owner changes commission rules.</span>}
    {edit && <RuleSheet r={edit} gated={gated} close={() => setEdit(null)} remove={rules.some(x => x.id === edit.id) ? () => save(rules.filter(x => x.id !== edit.id), 'remove ' + (edit.name || 'rule')) : undefined}
      save={r => save(rules.some(x => x.id === r.id) ? rules.map(x => x.id === r.id ? r : x) : [...rules, r], (rules.some(x => x.id === r.id) ? 'edit ' : 'add ') + (r.name || 'rule'))} />}
    {pin.sheet}
  </section>;
}

function RuleSheet({ r, gated, close, save, remove }: { r: CommissionRule; gated: boolean; close: () => void; save: (r: CommissionRule) => void; remove?: () => void }) {
  const { db } = useApp();
  const [f, setF] = useState(r), [pct, setPct] = useState(r.salesBps ? String(r.salesBps / 100) : '');
  const bps = Math.round(Number(pct.replace(',', '.')) * 100) || 0;
  const ok = (bps > 0 || f.perItem > 0) && bps <= 10000 && (f.perItem === 0 || f.productIds.length + f.categoryIds.length > 0);
  const flip = (k: 'productIds' | 'categoryIds', id: string) => setF({ ...f, [k]: f[k].includes(id) ? f[k].filter(x => x !== id) : [...f[k], id] });
  const whoVal = f.employeeId ? 'e:' + f.employeeId : 'r:' + f.role;
  return <Sheet open onClose={close} title={r.name || 'New commission rule'} sub={gated ? 'Payroll needs the owner: saving sends this to the owner for approval.' : 'Saving asks your approval PIN and is logged in the audit log.'}
    footer={<>{remove && <button className="btn btn-danger" style={{ marginRight: 'auto' }} onClick={remove}>Remove</button>}<button className="btn" onClick={close}>Cancel</button>
      <button className="btn btn-primary" disabled={!ok} onClick={() => save({ ...f, name: f.name.trim(), salesBps: bps })}>{gated ? 'Send to owner' : 'Save'}</button></>}>
    <div className="stack">
      <Field label="Name"><input className="input" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} placeholder="Cashiers · 1% of net sales" /></Field>
      <Field label="Applies to" hint="A person with their own rule gets only their own rules, not the role's."><select className="input" value={whoVal} onChange={e => { const [k, v] = [e.target.value.slice(0, 1), e.target.value.slice(2)]; setF({ ...f, employeeId: k === 'e' ? v : null, role: k === 'r' ? v : null }); }}>
        <optgroup label="Everyone with role">{ROLES.map(x => <option key={x} value={'r:' + x}>{ROLE_LABEL[x]}</option>)}</optgroup>
        <optgroup label="One person">{db.employees.filter(e => e.active && e.role !== 'owner').map(e => <option key={e.id} value={'e:' + e.id}>{e.name} · {ROLE_LABEL[e.role] ?? e.role}</option>)}</optgroup></select></Field>
      <Field label="% of net sales" optional hint="e.g. 1 or 0.5" error={bps > 10000 ? 'At most 100%' : undefined}><input className="input" inputMode="decimal" value={pct} onChange={e => setPct(e.target.value.replace(/[^\d.,]/g, ''))} /></Field>
      <Field label="IDR per item sold" optional hint="Paid for each item of the products or categories below"><input className="input" inputMode="numeric" value={f.perItem || ''} onChange={e => setF({ ...f, perItem: Number(e.target.value.replace(/\D/g, '')) || 0 })} /></Field>
      {f.perItem > 0 && <>
        <Field label="Categories" error={f.productIds.length + f.categoryIds.length ? undefined : 'Pick at least one category or product'}><div className="row wrap" style={{ gap: 6 }}>{db.categories.map(c => <button key={c.id} type="button" className="chip" aria-pressed={f.categoryIds.includes(c.id)} onClick={() => flip('categoryIds', c.id)}>{c.name}</button>)}</div></Field>
        <Field label="Products" optional><div className="row wrap" style={{ gap: 6 }}>{db.products.filter(p => p.status === 'live').map(p => <button key={p.id} type="button" className="chip" aria-pressed={f.productIds.includes(p.id)} onClick={() => flip('productIds', p.id)}>{p.name}</button>)}</div></Field>
      </>}
    </div>
  </Sheet>;
}
