'use client';
// Owner / Manager › Tables & floor plan: draw the outlet's tables by area. Tap an empty cell to add a table, tap a table
// to edit it, then tap another cell (or drag it there) to move it. The POS table picker, waiter app, QR codes,
// reservations and PIC sections all read this plan (src/domain/tables.ts tablesOf).
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useApp } from '../app/context.tsx';
import { PageHead } from '../templates/common.tsx';
import { saveFloor } from '../data/actions/business.ts';
import { areasOf, checkFloor, freeCell, holdsTable, nextName, ROWS, tablesOf, type FloorTable, type TableShape } from '../domain/tables.ts';
import { FloorGrid, tableShape } from '../ui/Floor.tsx';
import { Empty, Field, Icon, Seg, toast } from '../ui/kit.tsx';

const SHAPES: [TableShape, string][] = [['square', 'Square'], ['round', 'Round'], ['long', 'Long']];
// k: the table's name when the editor opened (new tables get '+…'), so typing a name never edits another table,
// and a rename remembers the old name for QR codes already on the tables.
type Row = FloorTable & { k: string };
const aliases = (t: Row) => [...new Set([...(t.was ?? []), ...(t.k[0] !== '+' && t.k !== t.name ? [t.k] : [])])].filter(w => w !== t.name);

/** Unsaved changes belong to one outlet: switching outlet starts that outlet's plan fresh. */
export default function FloorPlanPage() { const { outletId } = useApp(); return <FloorPlan key={outletId} />; }

function FloorPlan() {
  const { db, user, outletId } = useApp();
  const out = db.outlets.find(o => o.id === outletId) ?? db.outlets[0];
  const saved = useMemo<Row[]>(() => tablesOf(out).map(t => ({ ...t, k: t.name })), [out]);
  const [plan, setPlan] = useState<Row[] | null>(null), [area, setArea] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null), [err, setErr] = useState(''), [newArea, setNewArea] = useState('');
  if (!out) return <Empty icon="store" title="No outlet yet">Add an outlet first in Outlets.</Empty>;
  const can = user.role === 'owner' || user.role === 'manager';
  const ts = plan ?? saved, dirty = plan !== null;
  const areas = areasOf(ts).length ? areasOf(ts) : ['Main'];
  const here = area && areas.includes(area) ? area : areas[0];
  const inArea = ts.filter(t => t.area === here);
  const rows = Math.min(ROWS, Math.max(6, ...inArea.map(t => t.y + 2)));
  const busy = new Set(db.orders.filter(o => o.outletId === out.id && holdsTable(o)).map(o => o.table!));
  const cur = ts.find(t => t.k === sel) ?? null;

  const change = (next: Row[]) => { setPlan(next); setErr(checkFloor(next) ?? ''); };
  const patch = (k: string, p: Partial<FloorTable>) => change(ts.map(t => t.k === k ? { ...t, ...p } : t));
  const add = (x: number, y: number, a = here) => { const t: Row = { name: nextName(ts), area: a, seats: 4, shape: 'square', x, y, k: '+' + Math.random().toString(36).slice(2) }; change([...ts, t]); setSel(t.k); };
  const move = (k: string, x: number, y: number) => { if (inArea.some(t => t.x === x && t.y === y)) return; patch(k, { x, y, area: here }); };
  const remove = (t: Row) => { if (busy.has(t.k)) return toast(`${t.k} has an open bill. Close it first.`); change(ts.filter(x => x.k !== t.k)); setSel(null); };
  const addArea = () => { const a = newArea.trim(); if (!a) return; if (areas.includes(a)) { setArea(a); setNewArea(''); return; } const c = freeCell(ts, a); add(c.x, c.y, a); setArea(a); setNewArea(''); };
  const save = () => { const e = saveFloor(out.id, ts.map(({ k: _k, ...t }) => { const was = aliases({ ...t, k: _k }); return was.length ? { ...t, was } : { ...t, was: undefined }; }), user.id); if (e) { setErr(e); toast(e); return; } setPlan(null); setErr(''); toast(`Saved · ${ts.length} tables on the POS, waiter app and QR menu`); };

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
              onClick={() => cur && cur.area === here ? move(cur.k, c.x, c.y) : add(c.x, c.y)}><Icon name={cur && cur.area === here ? 'move' : 'plus'} size={18} /></button> : undefined}
            table={t => <button type="button" draggable={can} onDragStart={e => e.dataTransfer.setData('text/table', (t as Row).k)} aria-pressed={sel === (t as Row).k}
              onClick={() => setSel(sel === (t as Row).k ? null : (t as Row).k)}
              className="btn" style={{ ...tableShape(t), height: '100%', flexDirection: 'column', gap: 0, padding: 4,
                background: sel === (t as Row).k ? 'var(--accent)' : busy.has((t as Row).k) ? 'var(--accent-soft)' : 'var(--bg-surface)', color: sel === (t as Row).k ? 'var(--ink-0)' : undefined, borderColor: sel === (t as Row).k ? 'var(--accent)' : undefined }}>
              <b style={{ fontSize: 14, lineHeight: 1.1, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.name}</b>
              <span style={{ fontSize: 13, opacity: .85 }}><Icon name="users" size={13} /> {t.seats}</span></button>} />}
        <span className="faint" style={{ fontSize: 13 }}>{can ? 'Tap an empty square to add a table. Tap a table, then another square, to move it (or drag it).' : 'Only the owner or a manager changes the floor plan.'} Orange tables have an open bill.</span>
      </section>

      <aside className="card stack" aria-label="Table">
        {!cur ? <><h3>Table</h3><p className="muted" style={{ fontSize: 14 }}>Pick a table to rename it, set its seats, shape and area, or remove it.</p>
          <Link href="/owner/outlets/table-qr-generator" style={{ fontSize: 14 }}>Print table QR codes</Link><Link href="/owner/outlets/reservations" style={{ fontSize: 14 }}>Reservations</Link></>
        : <>
          <h3>{cur.name}</h3>
          {busy.has(cur.k) && <span className="faint" style={{ fontSize: 13 }}>Open bill on this table: it can move, but not be renamed or removed until the bill closes.</span>}
          <Field label="Name"><input className="input" disabled={!can || busy.has(cur.k)} maxLength={20} value={cur.name} onChange={e => patch(cur.k, { name: e.target.value })} /></Field>
          {aliases(cur).length > 0 && <span className="faint" style={{ fontSize: 13 }}>QR codes printed as {aliases(cur).join(', ')} keep opening this table. Reprint when you can.</span>}
          <Field label="Seats"><input className="input num" disabled={!can} inputMode="numeric" value={cur.seats} onChange={e => patch(cur.k, { seats: Math.min(30, Number(e.target.value.replace(/\D/g, '')) || 0) })} /></Field>
          <Seg label="Shape" value={cur.shape} onChange={s => can && patch(cur.k, { shape: s })} options={SHAPES} />
          <Field label="Area"><select className="input" disabled={!can} value={cur.area} onChange={e => { const a = e.target.value, c = freeCell(ts.filter(t => t.k !== cur.k), a); patch(cur.k, { area: a, ...c }); setArea(a); }}>
            {areas.map(a => <option key={a} value={a}>{a}</option>)}</select></Field>
          {can && <button className="btn btn-ghost" style={{ color: 'var(--danger-fg)', alignSelf: 'flex-start' }} disabled={busy.has(cur.k)} onClick={() => remove(cur)}><Icon name="trash" size={18} />Remove table</button>}
        </>}
      </aside>
    </div>
  </div>;
}
