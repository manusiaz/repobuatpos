'use client';
// FORM template: create one thing. One column (max 640), label above, validation on blur + save, sticky save bar
// that appears on first change, leave guard. Saves through the same service calls as the list's sheet.
import { useEffect, useState } from 'react';
import { useApp } from '../app/context.tsx';
import { isGated } from '../system/access.ts';
import { Empty, Field, Icon, toast } from '../ui/kit.tsx';
import { createPO, saveModifierGroup } from '../data/actions.ts';
import { uid } from '../data/store.ts';
import { idr } from '../domain/money.ts';
import { levelRequired } from '../domain/approval.ts';
import { PageHead } from './common.tsx';
import { VIEWS, type FieldDef } from './views.ts';
import { saveRow } from './actions.ts';

const FORMS: Record<string, { key: string; fields: FieldDef[] }> = {
  product: { key: 'product', fields: VIEWS.product.form! },
  promo: { key: 'promo', fields: [{ k: 'name', l: 'Promo name', req: true }, { k: 'code', l: 'Voucher code', hint: 'Guests type it at the POS, QR menu or kiosk' }, { k: 'kind', l: 'Type', type: 'select', options: [['pct', 'Percent off'], ['amount', 'Amount off']], req: true }, { k: 'value', l: 'Value (% or IDR)', type: 'number', req: true }, { k: 'minSpend', l: 'Minimum spend', type: 'money' }] },
  employee: { key: 'employee', fields: VIEWS.employee.form! },
};

export default function Form() {
  const { page } = useApp();
  if (/modifier/i.test(page.name)) return <ModifierForm />;
  if (/^po form/i.test(page.name)) return <POForm />;
  return <Generic spec={FORMS[/promo/i.test(page.name) ? 'promo' : /invite|employee/i.test(page.name) ? 'employee' : 'product']} />;
}

function useLeaveGuard(dirty: boolean) { useEffect(() => { if (!dirty) return; const f = (e: BeforeUnloadEvent) => e.preventDefault(); addEventListener('beforeunload', f); return () => removeEventListener('beforeunload', f); }, [dirty]); }
function SaveBar({ dirty, label, onSave, onCancel }: { dirty: boolean; label: string; onSave: () => void; onCancel: () => void }) {
  if (!dirty) return null;
  return <div className="row between" style={{ position: 'sticky', bottom: 12, zIndex: 5, padding: 12, borderRadius: 16, background: 'var(--ink-950)', color: '#fff', boxShadow: 'var(--shadow-e2)', maxWidth: 640 }}>
    <span>Unsaved changes</span><span className="row"><button className="btn btn-ghost btn-sm" style={{ color: '#fff' }} onClick={onCancel}>Discard</button><button className="btn btn-primary btn-sm" onClick={onSave}>{label}</button></span></div>;
}

function Generic({ spec }: { spec: { key: string; fields: FieldDef[] } }) {
  const { page, db, user, outletId } = useApp();
  const gated = isGated(user.role, page) || (spec.key === 'promo' && user.role !== 'owner');
  const [f, setF] = useState<Record<string, string>>({}), [blur, setBlur] = useState<Record<string, boolean>>({}), [tried, setTried] = useState(false);
  const dirty = Object.values(f).some(Boolean); useLeaveGuard(dirty);
  const bad = (x: FieldDef) => x.req && !f[x.k]?.trim() && (tried || blur[x.k]);
  const save = () => { setTried(true); const miss = spec.fields.find(x => x.req && !f[x.k]?.trim()); if (miss) { document.getElementById('f-' + miss.k)?.focus(); return; } toast(saveRow(spec.key, f, null, { db, by: user.id, role: user.role, outletId, gated })); setF({}); setTried(false); setBlur({}); };
  return <>
    <PageHead />
    <section className="card stack" style={{ maxWidth: 640 }}>
      {spec.fields.map(x => <Field key={x.k} label={x.l} optional={!x.req} hint={x.hint} error={bad(x) ? 'Required' : undefined}>
        {x.type === 'select' ? <select id={'f-' + x.k} className="input" value={f[x.k] ?? ''} onChange={e => setF({ ...f, [x.k]: e.target.value })} onBlur={() => setBlur({ ...blur, [x.k]: true })}><option value="">Choose…</option>{x.options!.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          : x.type === 'textarea' ? <textarea id={'f-' + x.k} className="input" value={f[x.k] ?? ''} onChange={e => setF({ ...f, [x.k]: e.target.value })} />
          : <input id={'f-' + x.k} className={'input' + (bad(x) ? ' bad' : '')} inputMode={x.type === 'money' || x.type === 'number' ? 'numeric' : undefined} value={f[x.k] ?? ''} onChange={e => setF({ ...f, [x.k]: e.target.value })} onBlur={() => setBlur({ ...blur, [x.k]: true })} />}
      </Field>)}
      {spec.key === 'product' && <div className="banner b-info"><Icon name="info" size={18} />{user.role === 'owner' ? 'Owner items go live at all outlets.' : 'Your item is outlet-only and waits for the owner.'}</div>}
      <div className="row"><button className="btn btn-primary btn-lg" onClick={save}>{gated ? 'Send to owner' : 'Save'}</button></div>
    </section>
    <SaveBar dirty={dirty} label={gated ? 'Send to owner' : 'Save'} onSave={save} onCancel={() => setF({})} />
  </>;
}

function ModifierForm() {
  const { db, user } = useApp();
  const [name, setName] = useState(''), [req, setReq] = useState(false), [opts, setOpts] = useState([{ name: '', price: '' }]);
  const save = () => { if (!name.trim() || !opts.some(o => o.name.trim())) return toast('Name the group and add at least one option'); saveModifierGroup({ id: uid('mg'), name, required: req, max: 1, options: opts.filter(o => o.name.trim()).map(o => ({ id: uid('mo'), name: o.name, price: Number(o.price.replace(/\D/g, '')) || 0 })) }, user.id); toast('Modifier group saved · available in product options'); setName(''); setOpts([{ name: '', price: '' }]); };
  return <>
    <PageHead sub={`${db.modifierGroups.length} groups in use: ${db.modifierGroups.map(g => g.name).join(', ')}.`} />
    <section className="card stack" style={{ maxWidth: 640 }}>
      <Field label="Group name"><input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="Sweetness" /></Field>
      <label className="row"><input type="checkbox" checked={req} onChange={e => setReq(e.target.checked)} />Required (blocks Add until chosen)</label>
      {opts.map((o, i) => <div key={i} className="row"><input className="input" placeholder="Option" value={o.name} onChange={e => setOpts(opts.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} /><input className="input" style={{ width: 160 }} inputMode="numeric" placeholder="+ IDR" value={o.price} onChange={e => setOpts(opts.map((x, j) => j === i ? { ...x, price: e.target.value } : x))} /></div>)}
      <div className="row"><button className="btn" onClick={() => setOpts([...opts, { name: '', price: '' }])}><Icon name="plus" size={18} />Add option</button><button className="btn btn-primary" onClick={save}>Save group</button></div>
    </section>
  </>;
}

function POForm() {
  const { db, user, outletId } = useApp();
  const [pick, setSup] = useState(''), [out, setOut] = useState(outletId), [lines, setLines] = useState<{ stockItemId: string; qty: number; price: number }[]>([]);
  const total = lines.reduce((a, l) => a + l.qty * l.price, 0), lvl = levelRequired('po', total);
  const sup = pick || db.suppliers[0]?.id;
  if (!sup) return <><PageHead sub="A purchase order goes to one supplier." /><Empty icon="truck" title="Add a supplier first">Inventory → Suppliers, then come back here.</Empty></>;
  const add = (id: string) => { const s = db.stockItems.find(x => x.id === id)!; setLines([...lines, { stockItemId: id, qty: Math.max(1, s.par), price: s.unitCost }]); };
  return <>
    <PageHead sub="≤ IDR 500k the manager approves, above that the owner. The approver can’t be the requester." />
    <section className="card stack" style={{ maxWidth: 640 }}>
      <div className="grid" style={{ ['--min' as string]: '200px' }}><Field label="Supplier"><select className="input" value={sup} onChange={e => setSup(e.target.value)}>{db.suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        <Field label="Deliver to"><select className="input" value={out} onChange={e => setOut(e.target.value)}>{db.outlets.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></Field></div>
      {lines.map((l, i) => { const s = db.stockItems.find(x => x.id === l.stockItemId)!; return <div key={i} className="row"><span className="grow">{s.name}</span><input className="input" style={{ width: 96 }} type="number" min={0} value={l.qty} onChange={e => setLines(lines.map((x, j) => j === i ? { ...x, qty: Number(e.target.value) } : x))} aria-label="Qty" /><span className="faint">{s.unit}</span><b style={{ width: 120, textAlign: 'right' }}>{idr(l.qty * l.price)}</b></div>; })}
      <select className="input" value="" onChange={e => e.target.value && add(e.target.value)} aria-label="Add item"><option value="">+ Add item…</option>{db.stockItems.filter(s => !lines.some(l => l.stockItemId === s.id)).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
      <div className="row between"><span>Total <b>{idr(total)}</b> · approver: <b>{user.role === 'owner' ? 'you (owner)' : lvl}</b></span>
        <button className="btn btn-primary" disabled={!lines.length} onClick={() => { createPO(sup, out, lines, user.id); toast(user.role === 'owner' ? 'PO sent to supplier' : 'PO waiting for ' + lvl + ' approval'); setLines([]); }}>{user.role === 'owner' ? 'Create & send' : 'Submit for approval'}</button></div>
    </section>
  </>;
}
