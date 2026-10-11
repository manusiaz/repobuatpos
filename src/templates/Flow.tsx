'use client';
// FLOW template: multi-step task that can be resumed (stepper, one task per step, Back always available).
import { useState, type ReactNode } from 'react';
import { useApp } from '../app/context.tsx';
import { Badge, Field, Icon, toast } from '../ui/kit.tsx';
import { addCustomer, requestPrice, saveProduct } from '../data/actions.ts';
import { uid } from '../data/store.ts';
import { idr } from '../domain/money.ts';
import { PageHead } from './common.tsx';
import List from './List.tsx';

export default function Flow() {
  const { page } = useApp();
  if (/opname/i.test(page.name)) return <List />;
  if (/merge/i.test(page.name)) return <Merge />;
  if (/bulk edit/i.test(page.name)) return <Bulk />;
  return <Import kind={/customer/i.test(page.name) ? 'customers' : 'products'} />;
}

function Steps({ steps, at, children }: { steps: string[]; at: number; children: ReactNode }) {
  return <section className="card stack" style={{ maxWidth: 760 }}>
    <div className="row" style={{ gap: 6 }}>{steps.map((s, i) => <div key={s} className="grow stack" style={{ gap: 6 }}><div style={{ height: 4, borderRadius: 4, background: i <= at ? 'var(--role)' : 'var(--border)' }} /><span className={i === at ? '' : 'faint'} style={{ fontSize: 12, fontWeight: 600 }}>{i + 1}. {s}</span></div>)}</div>
    {children}
  </section>;
}

function Import({ kind }: { kind: 'products' | 'customers' }) {
  const { user, db } = useApp();
  const sample = kind === 'products' ? 'name,category,price\nKopi Pandan Susu,coffee,27000\nRoti Bakar Keju,pastry,24000' : 'name,phone\nAyu Wulandari,0812 5555 1212\nFajar Nugroho,0813 4444 9898';
  const [step, setStep] = useState(0), [text, setText] = useState(''), [done, setDone] = useState(0);
  const rows = text.trim().split(/\r?\n/).slice(1).map(l => l.split(',').map(x => x.trim())).filter(r => r[0]);
  const errs = rows.map(r => kind === 'products' ? (!r[2] || isNaN(Number(r[2])) ? 'Price must be a number' : !db.categories.some(c => c.id === r[1]) ? 'Unknown category' : '') : (!r[1] ? 'Phone missing' : db.customers.some(c => c.phone === r[1]) ? 'Already a customer' : ''));
  const run = () => { let n = 0; rows.forEach((r, i) => { if (errs[i]) return; n++; if (kind === 'products') saveProduct({ id: uid('p'), name: r[0], categoryId: r[1], basePrice: Number(r[2]), cost: Math.round(Number(r[2]) * .32), sku: 'KB-' + uid().slice(0, 4).toUpperCase(), desc: '', scope: user.role === 'owner' ? 'global' : 'local', status: user.role === 'owner' ? 'live' : 'pending_owner', ownerOutletId: user.role === 'owner' ? null : user.outletId, hue: 30, modifierGroupIds: [] }, user.id); else addCustomer(r[0], r[1], user.id); }); setDone(n); setStep(2); };
  return <><PageHead sub={`Paste or upload a CSV. Bad rows are skipped and listed; nothing half-imports.`} />
    <Steps steps={['Upload', 'Check rows', 'Done']} at={step}>
      {step === 0 && <><Field label="CSV" hint="first row = headers"><textarea className="input mono" style={{ minHeight: 160 }} value={text} placeholder={sample} onChange={e => setText(e.target.value)} /></Field>
        <div className="row"><label className="btn"><Icon name="upload" size={18} />Choose file<input type="file" accept=".csv,text/csv" hidden onChange={async e => { const f = e.target.files?.[0]; if (f) setText(await f.text()); }} /></label><button className="btn btn-ghost" onClick={() => setText(sample)}>Use example</button><button className="btn btn-primary" disabled={!rows.length} onClick={() => setStep(1)}>Next</button></div></>}
      {step === 1 && <><table className="table"><tbody>{rows.map((r, i) => <tr key={i}><td>{r.join(' · ')}</td><td className="r">{errs[i] ? <Badge tone="danger">{errs[i]}</Badge> : <Badge tone="success">OK</Badge>}</td></tr>)}</tbody></table>
        <div className="row"><button className="btn" onClick={() => setStep(0)}>Back</button><button className="btn btn-primary" onClick={run}>Import {errs.filter(e => !e).length} rows</button></div></>}
      {step === 2 && <><p><b>{done}</b> {kind} imported{kind === 'products' && user.role !== 'owner' ? ' as outlet-only items waiting for the owner' : ''}. {errs.filter(Boolean).length} skipped.</p><div><button className="btn" onClick={() => { setText(''); setStep(0); }}>Import more</button></div></>}
    </Steps></>;
}

function Bulk() {
  const { db, user } = useApp();
  const [pct, setPct] = useState('5'), [cat, setCat] = useState('coffee'), [step, setStep] = useState(0);
  const items = db.products.filter(p => p.categoryId === cat && p.status === 'live');
  const nv = (v: number) => Math.round((v * (1 + Number(pct) / 100)) / 500) * 500;
  return <><PageHead sub="Price changes always go to the owner unless you are the owner. Rounded to IDR 500." />
    <Steps steps={['Choose items', 'Preview', 'Apply']} at={step}>
      {step === 0 && <><div className="grid" style={{ ['--min' as string]: '200px' }}><Field label="Category"><select className="input" value={cat} onChange={e => setCat(e.target.value)}>{db.categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field><Field label="Change %"><input className="input" inputMode="decimal" value={pct} onChange={e => setPct(e.target.value)} /></Field></div><div><button className="btn btn-primary" onClick={() => setStep(1)}>Preview {items.length} items</button></div></>}
      {step === 1 && <><table className="table"><tbody>{items.map(p => <tr key={p.id}><td>{p.name}</td><td className="r">{idr(p.basePrice)} → <b>{idr(nv(p.basePrice))}</b></td></tr>)}</tbody></table><div className="row"><button className="btn" onClick={() => setStep(0)}>Back</button><button className="btn btn-primary" onClick={() => { items.forEach(p => requestPrice(p.id, nv(p.basePrice), user.id)); setStep(2); }}>{user.role === 'owner' ? 'Apply to all outlets' : 'Send to owner'}</button></div></>}
      {step === 2 && <p>{user.role === 'owner' ? 'Prices updated on every channel.' : `${items.length} price changes are waiting for the owner.`}</p>}
    </Steps></>;
}

function Merge() {
  const { db } = useApp();
  const key = (s: string) => s.replace(/\D/g, '').slice(-8);
  const groups = Object.values(db.customers.reduce<Record<string, typeof db.customers>>((a, c) => ((a[key(c.phone)] ??= []).push(c), a), {})).filter(g => g.length > 1);
  return <><PageHead sub="Matches by phone number. Merging keeps every order and the full beans ledger; the manager confirms." />
    <section className="card stack">{groups.length === 0 ? <p className="muted">No duplicates found among {db.customers.length} customers. New sign-ups are checked by phone automatically.</p>
      : groups.map(g => <div key={g[0].id} className="row between"><span>{g.map(c => c.name).join(' + ')}</span><button className="btn btn-sm" onClick={() => toast('Merge sent to manager')}>Merge</button></div>)}</section></>;
}
