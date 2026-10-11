'use client';
// Product import (CSV): parse → validate per row → import in batches through saveProduct, with progress and an error report.
// Used by onboarding (Auth) and the "Data import progress & errors" state.
import { useRef, useState } from 'react';
import { useApp } from '../../app/context.tsx';
import { saveProduct } from '../../data/actions.ts';
import { uid } from '../../data/store.ts';
import type { DB, Product } from '../../data/schema.ts';
import { idr } from '../../domain/money.ts';
import { Badge, Icon, toast } from '../../ui/kit.tsx';

export const CSV_HEADER = 'name,price,category,sku';
export const SAMPLE_CSV = `${CSV_HEADER}
Kopi Susu Pandan,27000,Coffee,KB-101
Es Teh Leci,21000,Non-coffee,KB-102
Roti Bakar Coklat,24000,Pastry,KB-103
Mie Goreng Jawa,,Rice,KB-104
Lemon Tea,"19,000",Non-coffee,KB-105
Affogato,32000,Desserts,KB-106
Americano,22000,Coffee,KB-107
Kentang Goreng,18000,Others,KB-108`;

/** RFC 4180-ish: quoted fields, doubled quotes, commas or semicolons. */
export function parseCsv(text: string): string[][] {
  const sep = (text.split('\n')[0].match(/;/g)?.length ?? 0) > (text.split('\n')[0].match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows: string[][] = []; let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; continue; }
    if (c === '"') q = true; else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); if (row.some(x => x.trim())) rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  row.push(cell); if (row.some(x => x.trim())) rows.push(row);
  return rows.map(r => r.map(x => x.trim()));
}

export interface ImportRow { line: number; name: string; price: number; categoryId: string; sku: string; error: string | null; warn: string | null }
export function validate(db: DB, text: string): { rows: ImportRow[]; headerError: string | null } {
  const all = parseCsv(text);
  if (!all.length) return { rows: [], headerError: 'The file is empty.' };
  const head = all[0].map(h => h.toLowerCase());
  const col = (k: string) => head.indexOf(k);
  if (col('name') < 0 || col('price') < 0) return { rows: [], headerError: `First row must be the header: ${CSV_HEADER}` };
  const seen = new Set<string>();
  const rows = all.slice(1).map((r, i): ImportRow => {
    const name = r[col('name')] ?? '', rawPrice = r[col('price')] ?? '', cat = col('category') >= 0 ? r[col('category')] ?? '' : '';
    const price = Number(rawPrice.replace(/^(rp|idr)\s*/i, '').replace(/[.,\s]/g, ''));
    const c = db.categories.find(x => x.id.toLowerCase() === cat.toLowerCase() || x.name.toLowerCase() === cat.toLowerCase());
    let error: string | null = null, warn: string | null = null;
    if (!name) error = 'Name is missing';
    else if (!rawPrice) error = 'Price is missing';
    else if (!Number.isInteger(price) || price <= 0) error = `Price “${rawPrice}” is not a whole rupiah amount`;
    else if (cat && !c) error = `Category “${cat}” doesn’t exist`;
    else if (seen.has(name.toLowerCase())) error = 'Duplicate row in this file';
    else if (db.products.some(p => p.name.toLowerCase() === name.toLowerCase() && p.status !== 'archived')) warn = 'Already in your menu, will be skipped';
    seen.add(name.toLowerCase());
    return { line: i + 2, name, price: price || 0, categoryId: c?.id ?? 'other', sku: (col('sku') >= 0 ? r[col('sku')] : '') || '', error, warn };
  });
  return { rows, headerError: null };
}

type Phase = 'pick' | 'preview' | 'importing' | 'done';
export function ProductImporter({ initial = '', onDone, compact }: { initial?: string; onDone?: (n: number) => void; compact?: boolean }) {
  const { db, me, user, outletId } = useApp();
  const [text, setText] = useState(initial), [phase, setPhase] = useState<Phase>(initial ? 'preview' : 'pick');
  const [done, setDone] = useState(0), [paused, setPaused] = useState(false);
  const stop = useRef(false), file = useRef<HTMLInputElement>(null);
  // Freeze the preview once importing starts: imported rows would otherwise re-validate as duplicates.
  const [frozen, setFrozen] = useState<ReturnType<typeof validate> | null>(null);
  const { rows, headerError } = frozen ?? validate(db, text);
  const ok = rows.filter(r => !r.error && !r.warn), bad = rows.filter(r => r.error), skip = rows.filter(r => r.warn);
  const actor = me?.id ?? db.employees.find(e => e.role === 'owner')!.id;
  const role = me?.role ?? user.role;

  const load = (t: string) => { setText(t); setPhase('preview'); setDone(0); setFrozen(null); };
  const run = () => {
    setFrozen({ rows, headerError }); setPhase('importing'); setDone(0); stop.current = false; setPaused(false);
    let i = 0;
    const step = () => {
      if (stop.current) { setPaused(true); return; }
      const r = ok[i];
      // Manager imports are local items waiting for the owner (menu scope rules).
      const local = role === 'manager';
      const p: Product = { id: uid('p'), name: r.name, categoryId: r.categoryId, basePrice: r.price, scope: local ? 'local' : 'global', ownerOutletId: local ? outletId : null,
        status: local ? 'pending_owner' : 'live', hue: [...r.name].reduce((a, c) => a + c.charCodeAt(0), 0) % 360, sku: r.sku || 'IMP-' + r.line, desc: '', modifierGroupIds: [], cost: 0 };
      saveProduct(p, actor);
      i++; setDone(i);
      if (i < ok.length) setTimeout(step, 220); else { setPhase('done'); onDone?.(i); toast(`${i} products imported`); }
    };
    if (ok.length) setTimeout(step, 200); else setPhase('done');
  };
  const report = () => {
    const csv = 'line,name,error\n' + bad.map(r => `${r.line},"${r.name.replace(/"/g, '""')}","${r.error}"`).join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'import-errors.csv'; a.click();
  };
  const template = () => {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([CSV_HEADER + '\nEs Kopi Susu,25000,Coffee,KB-001\n'], { type: 'text/csv' })); a.download = 'borniz-products-template.csv'; a.click();
  };

  if (phase === 'pick') return <div className="stack">
    <button type="button" className="card stack" style={{ alignItems: 'center', textAlign: 'center', borderStyle: 'dashed', cursor: 'pointer', padding: compact ? 20 : 32 }} onClick={() => file.current?.click()}>
      <Icon name="file-up" size={28} /><b>Choose a CSV file</b><span className="muted" style={{ fontSize: 13 }}>Columns: <span className="mono">{CSV_HEADER}</span>. Excel: File › Save as › CSV.</span>
    </button>
    <input ref={file} type="file" accept=".csv,text/csv" className="sr" onChange={e => { const f = e.target.files?.[0]; if (f) f.text().then(load); }} />
    <div className="row wrap"><button type="button" className="btn btn-sm" onClick={template}><Icon name="download" size={16} />Download template</button><button type="button" className="btn btn-sm btn-ghost" onClick={() => load(SAMPLE_CSV)}>Try the sample file</button></div>
  </div>;

  const pct = ok.length ? Math.round((done / ok.length) * 100) : 100;
  return <div className="stack">
    {headerError ? <div className="banner b-danger" style={{ background: 'var(--danger-soft)', color: 'var(--danger-fg)' }}><Icon name="file-x" />{headerError}</div> : <>
      <div className="row wrap">
        <Badge tone="success" dot>{ok.length} ready</Badge>
        {bad.length > 0 && <Badge tone="danger" dot>{bad.length} with errors</Badge>}
        {skip.length > 0 && <Badge tone="warning" dot>{skip.length} skipped</Badge>}
        <span className="grow" />
        {phase === 'preview' && <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setText(''); setPhase('pick'); setFrozen(null); }}>Choose another file</button>}
      </div>
      {(phase === 'importing' || phase === 'done') && <div className="stack sm" aria-live="polite">
        <div className="row between" style={{ fontSize: 14 }}><b>{phase === 'done' ? 'Import finished' : paused ? 'Paused' : 'Importing…'}</b><span className="num">{done} / {ok.length}</span></div>
        <div style={{ height: 8, borderRadius: 99, background: 'var(--bg-sunken)', overflow: 'hidden' }}><div style={{ height: '100%', width: pct + '%', background: phase === 'done' ? 'var(--success)' : 'var(--accent)', transition: 'width var(--dur-base) var(--ease-out)' }} /></div>
      </div>}
      <div className="card flat scroll-x" style={{ maxHeight: compact ? 240 : 360, overflowY: 'auto' }}>
        <table className="table"><thead><tr><th>Line</th><th>Name</th><th className="r">Price</th><th>Status</th></tr></thead>
          <tbody>{rows.map((r, i) => {
            const st = r.error ? <span style={{ color: 'var(--danger-fg)', fontSize: 13 }}>{r.error}</span> : r.warn ? <span className="warn" style={{ fontSize: 13 }}>{r.warn}</span>
              : phase === 'preview' ? <Badge>Ready</Badge> : ok.indexOf(r) < done ? <Badge tone="success" dot>Imported</Badge> : <Badge tone="info">Queued</Badge>;
            return <tr key={i}><td className="mono">{r.line}</td><td>{r.name || <span className="faint">—</span>}</td><td className="r num">{r.price ? idr(r.price) : '—'}</td><td>{st}</td></tr>;
          })}</tbody></table>
      </div>
      <div className="row wrap">
        {phase === 'preview' && <button type="button" className="btn btn-primary" disabled={!ok.length} onClick={run}>Import {ok.length} products</button>}
        {phase === 'importing' && !paused && <button type="button" className="btn" onClick={() => { stop.current = true; }}>Pause</button>}
        {phase === 'importing' && paused && <span className="muted" style={{ fontSize: 14 }}>{done} imported. Products already added stay; you can import the rest from Owner › Catalog.</span>}
        {bad.length > 0 && <button type="button" className="btn btn-ghost" onClick={report}><Icon name="download" size={16} />Download error report</button>}
      </div>
    </>}
  </div>;
}
