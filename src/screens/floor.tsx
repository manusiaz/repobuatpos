'use client';
// Owner / Manager › Tables & floor plan: draw the outlet's tables by area. Tap an empty cell to add a table, tap a table
// to edit it, then tap another cell (or drag it there) to move it. The POS table picker, waiter app, QR codes,
// reservations and PIC sections all read this plan (src/domain/tables.ts tablesOf).
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useApp } from '../app/context.tsx';
import { PageHead } from '../templates/common.tsx';
import { saveFloor } from '../data/actions/business.ts';
import { CLOSED } from '../data/actions.ts';
import { areasOf, checkFloor, freeCell, nextName, ROWS, tablesOf, type FloorTable, type TableShape } from '../domain/tables.ts';
import { FloorGrid, tableShape } from '../ui/Floor.tsx';
import { Empty, Field, Icon, Seg, toast } from '../ui/kit.tsx';

const SHAPES: [TableShape, string][] = [['square', 'Square'], ['round', 'Round'], ['long', 'Long']];

export default function FloorPlan() {
  const { db, user, outletId } = useApp();
  const out = db.outlets.find(o => o.id === outletId) ?? db.outlets[0];
  const saved = useMemo(() => tablesOf(out), [out]);
  const [plan, setPlan] = useState<FloorTable[] | null>(null), [area, setArea] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null), [err, setErr] = useState(''), [newArea, setNewArea] = useState('');
  if (!out) return <Empty icon="store" title="No outlet yet">Add an outlet first in Outlets.</Empty>;
  const can = user.role === 'owner' || user.role === 'manager';
  const ts = plan ?? saved, dirty = plan !== null;
  const areas = areasOf(ts).length ? areasOf(ts) : ['Main'];
  const here = area && areas.includes(area) ? area : areas[0];
  const inArea = ts.filter(t => t.area === here);
  const rows = Math.min(ROWS, Math.max(6, ...inArea.map(t => t.y + 2)));
  const busy = new Set(db.orders.filter(o => o.outletId === out.id && o.table && !CLOSED.includes(o.status)).map(o => o.table!));
  const cur = ts.find(t => t.name === sel) ?? null;

  const change = (next: FloorTable[]) => { setPlan(next); setErr(checkFloor(next) ?? ''); };
  const patch = (name: string, p: Partial<FloorTable>) => { change(ts.map(t => t.name === name ? { ...t, ...p } : t)); if (p.name !== undefined) setSel(p.name); };
  const add = (x: number, y: number, a = here) => { const t: FloorTable = { name: nextName(ts), area: a, seats: 4, shape: 'square', x, y }; change([...ts, t]); setSel(t.name); };
  const move = (name: string, x: number, y: number) => { if (inArea.some(t => t.x === x && t.y === y)) return; patch(name, { x, y, area: here }); };
  const remove = (name: string) => { if (busy.has(name)) return toast(`${name} has an open bill. Close it first.`); change(ts.filter(t => t.name !== name)); setSel(null); };
  const addArea = () => { const a = newArea.trim(); if (!a) return; if (areas.includes(a)) { setArea(a); setNewArea(''); return; } const c = freeCell(ts, a); add(c.x, c.y, a); setArea(a); setNewArea(''); };
  const save = () => { const e = saveFloor(out.id, ts, user.id); if (e) { setErr(e); toast(e); return; } setPlan(null); setErr(''); toast(`Saved · ${ts.length} tables on the POS, waiter app and QR menu`); };

  return <div className="stack lg">
    <PageHead sub={<>{out.name} · {ts.length} tables · {ts.reduce((a, t) => a + t.seats, 0)} seats. The POS table picker, waiter app, table QR codes and reservations use this plan.</>}
      actions={can && <><button className="btn" disabled={!dirty} onClick={() => { setPlan(null); setErr(''); setSel(null); }}>Undo changes</button>
        <button className="btn btn-primary" disabled={!dirty || !!err} onClick={save}><Icon name="check" size={18} />Save plan</button></>} />
    {!out.floor?.length && <div className="banner b-info"><Icon name="info" /><span>This outlet has no drawn plan yet: it uses {out.tables} numbered tables. Move, rename or add tables and save to make it yours.</span></div>}
    {err && <div className="banner b-danger" role="alert"><Icon name="circle-alert" /><span>{err}</span></div>}

    <div className="row wrap" style={{ gap: 8 }}>
      <Seg label="Area" value={here} onChange={a => { setArea(a); setSel(null); }} options={areas.map(a => [a, `${a} · ${ts.filter(t => t.area === a).length}`] as const)} />
      {can && <form className="row" style={{ gap: 6 }} onSubmit={e => { e.preventDefault(); addArea(); }}>
        <input className="input" style={{ width: 160 }} placeholder="New area (Outdoor…)" aria-label="New area" value={newArea} maxLength={20} onChange={e => setNewArea(e.target.value)} />
        <button className="btn" disabled={!newArea.trim()}><Icon name="plus" size={18} />Area</button></form>}
    </div>

    <div className="grid" style={{ ['--min' as string]: '300px', alignItems: 'start' }}>
      <section className="stack sm" style={{ gridColumn: 'span 2', minWidth: 0 }}>
        {inArea.length === 0 && !can ? <Empty icon="armchair" title={`No tables in ${here}`} /> :
          <FloorGrid tables={inArea} rows={rows} size={64}
            onDropAt={can ? (n, c) => move(n, c.x, c.y) : undefined}
            cell={can ? c => <button type="button" className="btn btn-ghost" aria-label={cur ? `Move ${cur.name} here` : `Add a table here`}
              style={{ height: '100%', border: '1px dashed var(--border)', color: 'var(--fg-2)' }}
              onClick={() => cur && cur.area === here ? move(cur.name, c.x, c.y) : add(c.x, c.y)}><Icon name={cur && cur.area === here ? 'move' : 'plus'} size={18} /></button> : undefined}
            table={t => <button type="button" draggable={can} onDragStart={e => e.dataTransfer.setData('text/table', t.name)} aria-pressed={sel === t.name}
              onClick={() => setSel(sel === t.name ? null : t.name)}
              className="btn" style={{ ...tableShape(t), height: '100%', flexDirection: 'column', gap: 0, padding: 4,
                background: sel === t.name ? 'var(--accent)' : busy.has(t.name) ? 'var(--accent-soft)' : 'var(--bg-surface)', color: sel === t.name ? 'var(--ink-0)' : undefined, borderColor: sel === t.name ? 'var(--accent)' : undefined }}>
              <b style={{ fontSize: 14, lineHeight: 1.1, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.name}</b>
              <span style={{ fontSize: 13, opacity: .85 }}><Icon name="users" size={13} /> {t.seats}</span></button>} />}
        <span className="faint" style={{ fontSize: 13 }}>{can ? 'Tap an empty square to add a table. Tap a table, then another square, to move it (or drag it).' : 'Only the owner or a manager changes the floor plan.'} Orange tables have an open bill.</span>
      </section>

      <aside className="card stack" aria-label="Table">
        {!cur ? <><h3>Table</h3><p className="muted" style={{ fontSize: 14 }}>Pick a table to rename it, set its seats, shape and area, or remove it.</p>
          <Link href="/owner/outlets/table-qr-generator" style={{ fontSize: 14 }}>Print table QR codes</Link><Link href="/owner/outlets/reservations" style={{ fontSize: 14 }}>Reservations</Link></>
        : <>
          <h3>{cur.name}</h3>
          {busy.has(cur.name) && <span className="faint" style={{ fontSize: 13 }}>Open bill on this table: it can move, but not be renamed or removed until the bill closes.</span>}
          <Field label="Name"><input className="input" disabled={!can || busy.has(cur.name)} maxLength={20} value={cur.name} onChange={e => patch(cur.name, { name: e.target.value })} /></Field>
          <Field label="Seats"><input className="input num" disabled={!can} inputMode="numeric" value={cur.seats} onChange={e => patch(cur.name, { seats: Math.min(30, Number(e.target.value.replace(/\D/g, '')) || 0) })} /></Field>
          <Seg label="Shape" value={cur.shape} onChange={s => can && patch(cur.name, { shape: s })} options={SHAPES} />
          <Field label="Area"><select className="input" disabled={!can} value={cur.area} onChange={e => { const a = e.target.value, c = freeCell(ts.filter(t => t.name !== cur.name), a); patch(cur.name, { area: a, ...c }); setArea(a); }}>
            {areas.map(a => <option key={a} value={a}>{a}</option>)}</select></Field>
          {can && <button className="btn btn-ghost" style={{ color: 'var(--danger-fg)', alignSelf: 'flex-start' }} disabled={busy.has(cur.name)} onClick={() => remove(cur.name)}><Icon name="trash" size={18} />Remove table</button>}
        </>}
      </aside>
    </div>
  </div>;
}
