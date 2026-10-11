'use client';
// PIC cash & handover: blind drawer counts with variance sign-off, cash in/out, handover checklist, passing the PIC role.
import { useEffect, useState } from 'react';
import type { Rec, Session } from '../../data/schema.ts';
import { cashMove, sessionCash } from '../../data/actions.ts';
import { closeShift, passPic, picCountDrawer, saveHandover } from '../../data/actions/pic.ts';
import { expectedCash } from '../../domain/shift.ts';
import { LIMITS } from '../../domain/approval.ts';
import { idr } from '../../domain/money.ts';
import { usePin } from '../../ui/PinSheet.tsx';
import { Avatar, Badge, Empty, Field, Icon, Numpad, Seg, Sheet, Status, hhmm, toast } from '../../ui/kit.tsx';
import { ApprovalCard, useDecide } from '../ops/approvals.tsx';
import { allowed } from '../ops/perm.ts';
import { SLOTS, isLive, nameOf, picCandidates, slotLabel, startOfDay, emp } from '../ops/shift.ts';
import { blocker } from './approvals.tsx';
import type { PicCtx } from './ctx.ts';

const todaysSessions = (c: PicCtx) => c.db.sessions.filter(s => s.outletId === c.outletId && (s.status !== 'closed' || s.openedAt >= startOfDay(c.now) || (s.closedAt ?? 0) >= startOfDay(c.now)));

export function DrawerCounts({ c }: { c: PicCtx }) {
  const { db, user, me, outletId } = c;
  const dz = useDecide();
  const [count, setCount] = useState<Session | null>(null);
  const list = todaysSessions(c);
  const canCount = allowed(db, user.role, me, 'Close cash for the day', outletId);
  return <div className="stack">
    {dz.sheet}
    <div className="banner b-info">Blind count: the expected amount shows only after the count is submitted. Variance up to {idr(LIMITS.picVariance)} is signed by a PIC; over that goes to {c.mgr?.name ?? 'the manager'}. A variance always needs a note.</div>
    {list.length === 0 && <div className="card"><Empty icon="banknote" title="No drawer sessions today">A session starts when a cashier opens the drawer on the register.</Empty></div>}
    {list.map(s => {
      const ex = expectedCash(sessionCash(db, s.id));
      const ap = db.approvals.find(a => a.type === 'variance' && a.subjectId === s.id && a.status === 'waiting');
      const b = ap ? blocker(c, ap) : null;
      return <div key={s.id} className="card tight stack sm">
        <div className="row wrap" style={{ gap: 12 }}>
          <Avatar name={nameOf(db, s.cashierId)} color={emp(db, s.cashierId)?.color} />
          <span className="grow"><b>{nameOf(db, s.cashierId)}</b> · <span className="mono">{s.id}</span><br /><span className="muted" style={{ fontSize: 13 }}>Opened {hhmm(s.openedAt)} · float {idr(s.openingFloat)}{s.closedAt ? ' · closed ' + hhmm(s.closedAt) : ''}</span></span>
          <Status s={s.status} />
        </div>
        {s.counted != null && <div className="grid" style={{ ['--min' as string]: '140px', gap: 8 }}>
          <div className="sunken"><span className="muted" style={{ fontSize: 12 }}>Counted</span><br /><b className="num">{idr(s.counted)}</b></div>
          <div className="sunken"><span className="muted" style={{ fontSize: 12 }}>Expected</span><br /><b className="num">{idr(ex)}</b></div>
          <div className="sunken"><span className="muted" style={{ fontSize: 12 }}>Variance</span><br /><b className={'num ' + (s.variance ? 'down' : 'up')}>{idr(s.variance ?? 0)}</b></div>
        </div>}
        {s.note && <span className="muted" style={{ fontSize: 13 }}>Note: {s.note}</span>}
        <div className="row wrap">
          {(s.status === 'open' || s.status === 'counting') && (canCount ? <button className="btn btn-primary btn-pos" onClick={() => setCount(s)}>Count drawer</button> : <Badge>Counted at the register</Badge>)}
          {ap && (b ? <Badge tone="warning">{ap.level === 'pic' ? b : `With ${ap.level === 'manager' ? c.mgr?.name ?? 'manager' : 'owner'} · over ${idr(LIMITS.picVariance)}`}</Badge>
            : <><button className="btn btn-success btn-pos" onClick={() => dz.run(ap, 'approved')}>Confirm with PIN</button><button className="btn btn-danger btn-pos" onClick={() => dz.run(ap, 'rejected')}>Ask recount</button></>)}
          {s.status === 'closed' && !ap && s.counted != null && <Badge tone="success">Signed</Badge>}
        </div>
      </div>;
    })}
    <CountSheet c={c} s={count} onClose={() => setCount(null)} />
  </div>;
}

function CountSheet({ c, s, onClose }: { c: PicCtx; s: Session | null; onClose: () => void }) {
  const [digits, setDigits] = useState(''), [done, setDone] = useState(false), [note, setNote] = useState('');
  const pin = usePin();
  useEffect(() => { setDigits(''); setDone(false); setNote(''); }, [s]);
  if (!s) return pin.sheet;
  const counted = Number(digits || 0), ex = expectedCash(sessionCash(c.db, s.id)), v = counted - ex;
  const key = (k: string) => setDigits(d => k === 'del' ? d.slice(0, -1) : (d + k).replace(/^0+/, '').slice(0, 10));
  const finish = () => pin.ask({ title: `${s.id} · counted ${idr(counted)} · variance ${idr(v)}`, verb: 'Sign the count', onOk: by => {
    const r = picCountDrawer(s.id, counted, note.trim(), by);
    toast(r.level && r.level !== 'pic' ? `Variance ${idr(r.variance)} sent to ${c.mgr?.name ?? 'manager'}` : r.variance ? `Counted · variance ${idr(r.variance)} waits for another PIC to sign` : 'Counted · no variance · drawer closed');
    onClose();
  } });
  return <>{pin.sheet}<Sheet open onClose={onClose} side="center" title={done ? 'Count result' : `Count ${nameOf(c.db, s.cashierId)}’s drawer`} sub={`${s.id} · blind count`}
    footer={done ? <button className="btn btn-primary btn-pos btn-block" disabled={v !== 0 && !note.trim()} onClick={finish}>{v === 0 ? 'Close drawer' : Math.abs(v) > LIMITS.picVariance ? 'Send to manager' : 'Close with note'}</button>
      : <button className="btn btn-primary btn-pos btn-block" disabled={!digits} onClick={() => setDone(true)}>Submit count</button>}>
    {!done ? <div className="stack" style={{ alignItems: 'center' }}>
      <b className="num" style={{ fontSize: 36 }}>{idr(counted)}</b>
      <span className="muted" style={{ fontSize: 13 }}>Count notes and coins together. Expected stays hidden until you submit.</span>
      <div style={{ width: 'min(320px,100%)' }}><Numpad onKey={key} extra="000" /></div>
    </div> : <div className="stack">
      {[['Counted', idr(counted)], ['Expected', idr(ex)]].map(([l, x]) => <div key={l} className="row between"><span>{l}</span><b className="num">{x}</b></div>)}
      <div className="row between"><b>Variance</b><b className={'num ' + (v ? 'down' : 'up')}>{idr(v)}</b></div>
      {v !== 0 && <div className={'banner ' + (Math.abs(v) > LIMITS.picVariance ? 'b-danger' : 'b-warning')}>{Math.abs(v) > LIMITS.picVariance ? `Over ${idr(LIMITS.picVariance)}: the manager signs.` : 'Within the PIC limit: another PIC signs.'} The count is locked; corrections are a recount.</div>}
      {v !== 0 && <Field label="Note" hint="Required for any variance"><textarea className="input" value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. coins short, recounted twice" /></Field>}
    </div>}
  </Sheet></>;
}

export function CashMoves({ c }: { c: PicCtx }) {
  const { db, outletId, meId, user, me } = c;
  const dz = useDecide();
  const open = db.sessions.filter(s => s.outletId === outletId && s.status === 'open');
  const [sid, setSid] = useState(''), [kind, setKind] = useState<'in' | 'out' | 'drop'>('in'), [amt, setAmt] = useState(''), [why, setWhy] = useState('');
  const waiting = db.approvals.filter(a => a.outletId === outletId && a.type === 'cash_out' && a.status === 'waiting');
  const moves = db.cashMoves.filter(m => m.outletId === outletId && m.at >= startOfDay(c.now));
  const session = sid || open[0]?.id || '';
  const amount = Number(amt.replace(/\D/g, ''));
  const canMove = allowed(db, user.role, me, 'Open drawer without sale', outletId);
  const submit = () => { cashMove(session, kind, amount, why.trim(), meId); toast(kind === 'out' ? 'Cash out sent for approval' : `Cash ${kind === 'in' ? 'in' : 'drop'} recorded`); setAmt(''); setWhy(''); };
  return <div className="stack">
    {dz.sheet}
    <h3>Waiting for approval</h3>
    {waiting.length === 0 ? <p className="muted">No cash out waiting.</p> : waiting.map(a => { const b = blocker(c, a); return <ApprovalCard key={a.id} a={a}>
      {b ? <Badge tone="warning">{a.level === 'pic' ? b : `With ${a.level}`}</Badge> : <><button className="btn btn-success btn-pos" onClick={() => dz.run(a, 'approved')}>Approve</button><button className="btn btn-danger btn-pos" onClick={() => dz.run(a, 'rejected')}>Reject</button></>}
    </ApprovalCard>; })}
    <div className="pic-2">
      {canMove && <section className="card stack">
        <h3>Record cash in or out</h3>
        {open.length === 0 ? <p className="muted">No drawer open. Cash moves need an open session.</p> : <>
          <Field label="Drawer"><select className="input" value={session} onChange={e => setSid(e.target.value)}>{open.map(s => <option key={s.id} value={s.id}>{s.id} · {nameOf(db, s.cashierId)} · expected {idr(expectedCash(sessionCash(db, s.id)))}</option>)}</select></Field>
          <Seg value={kind} onChange={setKind} options={[['in', 'Cash in'], ['out', 'Cash out'], ['drop', 'Safe drop']] as const} label="Kind" />
          <Field label="Amount (IDR)"><input className="input" inputMode="numeric" value={amt ? Number(amt.replace(/\D/g, '') || 0).toLocaleString('en-US') : ''} onChange={e => setAmt(e.target.value)} placeholder="0" /></Field>
          <Field label="Reason"><input className="input" value={why} onChange={e => setWhy(e.target.value)} placeholder={kind === 'in' ? 'Change from bank' : kind === 'out' ? 'Ice delivery paid at the door' : 'Drop to safe'} /></Field>
          {kind === 'out' && <span className="muted" style={{ fontSize: 13 }}>Cash out needs approval: you can’t approve your own, so another PIC or the manager signs.</span>}
          <button className="btn btn-primary btn-pos" disabled={!amount || !why.trim()} onClick={submit}>{kind === 'out' ? 'Request cash out' : 'Record'}</button>
        </>}
      </section>}
      <section className="card stack">
        <h3>Today’s cash moves</h3>
        {moves.length === 0 ? <p className="muted">No cash in or out today.</p> : moves.map(m => <div key={m.id} className="row" style={{ fontSize: 14 }}>
          <Badge tone={m.kind === 'in' ? 'success' : m.kind === 'out' ? 'danger' : 'info'}>{m.kind === 'in' ? 'In' : m.kind === 'out' ? 'Out' : 'Drop'}</Badge>
          <span className="grow">{m.reason}<br /><span className="faint">{nameOf(db, m.by)} · {hhmm(m.at)} · <span className="mono">{m.sessionId}</span></span></span>
          <span className="stack" style={{ gap: 2, alignItems: 'flex-end' }}><b className="num">{idr(m.amount)}</b>{m.status === 'waiting' && <Badge tone="warning">Waiting</Badge>}</span></div>)}
      </section>
    </div>
  </div>;
}

const CHECK = [['Count every drawer', 'Blind count, then compare'], ['Confirm variances', `Over ${idr(LIMITS.picVariance)} goes to the manager`], ['Close or hand over open bills', ''], ['Set float for next shift', 'IDR 500,000 per drawer'], ['Write notes for next shift', 'Stock, incidents, regulars'], ['Check the 86 list', '']] as const;

export function Handover({ c }: { c: PicCtx }) {
  const { db, outletId, date, slot, meId, now } = c;
  const pin = usePin();
  const id = `${outletId}|${date}|${slot}`;
  const row: Rec = db.records.handover?.find(r => r.id === id) ?? { id, a: outletId, b: slot, c: '[]', d: '', e: '', at: now };
  const ticked = JSON.parse(row.c || '[]') as number[];
  const [notes, setNotes] = useState(row.d);
  useEffect(() => setNotes(row.d), [row.d]);
  const prevSlot = SLOTS[SLOTS.indexOf(slot) - 1];
  const prev = prevSlot && db.records.handover?.find(r => r.id === `${outletId}|${date}|${prevSlot}`);
  const sessions = todaysSessions(c), openS = sessions.filter(s => s.status === 'open' || s.status === 'counting');
  const varW = db.approvals.filter(a => a.outletId === outletId && a.type === 'variance' && a.status === 'waiting');
  const bills = db.orders.filter(o => o.outletId === outletId && isLive(o.status) && o.createdAt >= startOfDay(now));
  const sold = db.outletProducts.filter(x => x.outletId === outletId && x.is86);
  const hint = [openS.length ? `${openS.length} drawer${openS.length > 1 ? 's' : ''} still open` : 'All drawers counted', varW.length ? `${varW.length} variance waiting` : CHECK[1][1],
    bills.length ? `${bills.length} open: ${bills.slice(0, 4).map(o => o.table ?? o.no).join(', ')}` : 'No open bills', CHECK[3][1], CHECK[4][1],
    sold.length ? `${sold.length} sold out: ${sold.slice(0, 3).map(x => db.products.find(p => p.id === x.productId)?.name).join(', ')}` : 'Nothing sold out'];
  const closed = !!row.e;
  const toggle = (i: number) => !closed && saveHandover({ ...row, c: JSON.stringify(ticked.includes(i) ? ticked.filter(x => x !== i) : [...ticked, i]) }, meId);
  const all = CHECK.every((_, i) => ticked.includes(i));
  const close = () => pin.ask({ title: `${slotLabel(slot)} shift · ${outletId}`, verb: 'Sign & close shift', detail: 'The shift report goes to the manager and the owner.', onOk: by => {
    const sales = db.orders.filter(o => o.outletId === outletId && o.paidAt && o.paidAt >= c.start).reduce((a, o) => a + o.total, 0);
    closeShift({ ...row, d: notes }, `${slotLabel(slot)} ${idr(sales)} · ${bills.length} open bills`, by); toast('Shift report sent to the manager and owner');
  } });
  return <div className="pic-2">
    {pin.sheet}
    <section className="stack">
      {CHECK.map(([t], i) => { const on = ticked.includes(i); return <button key={t} className="card tight row" onClick={() => toggle(i)} aria-pressed={on} disabled={closed}
        style={{ cursor: 'pointer', textAlign: 'left', minHeight: 64, borderColor: on ? 'var(--success)' : undefined, background: on ? 'var(--success-soft)' : undefined }}>
        <span style={{ width: 28, height: 28, borderRadius: 8, border: '2px solid ' + (on ? 'var(--success)' : 'var(--border)'), background: on ? 'var(--success)' : 'transparent', display: 'grid', placeItems: 'center', color: 'var(--ink-0)', flex: 'none' }}>{on && <Icon name="check" size={18} />}</span>
        <span className="grow"><b>{t}</b><br /><span className="muted" style={{ fontSize: 13 }}>{hint[i]}</span></span></button>; })}
    </section>
    <section className="stack">
      {prev?.d && <div className="card tight stack sm"><span className="cap">From {slotLabel(prevSlot!)} shift</span><span>{prev.d}</span></div>}
      <div className="card stack">
        <Field label={`Notes for the next shift`}><textarea className="input" disabled={closed} value={notes} onChange={e => setNotes(e.target.value)} onBlur={() => notes !== row.d && saveHandover({ ...row, d: notes }, meId)} placeholder="Oat milk low (request sent), printer 2 paper almost out, T-12 regular wants the corner seat tomorrow." /></Field>
        {closed ? <div className="banner b-success">Shift closed by {nameOf(db, row.e)} at {hhmm(row.at)} · report sent.</div>
          : <button className="btn btn-primary btn-pos" disabled={!all} onClick={close}>{all ? 'Close shift & send report' : `Finish checklist (${ticked.length}/6)`}</button>}
      </div>
    </section>
  </div>;
}

export function PassPic({ c }: { c: PicCtx }) {
  const { db, outletId, slot, day, picId, meId, user, now } = c;
  const pin = usePin();
  const cands = picCandidates(db, outletId).filter(e => e.id !== picId);
  const [to, setTo] = useState(''), [note, setNote] = useState('');
  const can = picId === meId || user.role === 'manager' || user.role === 'owner';
  const log = (db.records.pic_pass ?? []).filter(r => r.a === outletId && r.at >= startOfDay(now));
  const go = () => pin.ask({ title: `PIC ${slotLabel(slot)} · ${nameOf(db, picId)} → ${nameOf(db, to)}`, verb: 'Sign the handover', detail: 'Open approvals and the handover checklist move to the new PIC.', onOk: by => { passPic(outletId, day, slot, to, note.trim(), by); toast(`PIC passed to ${nameOf(db, to)} · manager notified`); setTo(''); setNote(''); } });
  return <div className="pic-2">
    {pin.sheet}
    <section className="card stack">
      <div className="row"><Avatar name={nameOf(db, picId) || '?'} color={emp(db, picId)?.color} size={44} /><span className="grow"><span className="cap">PIC now · {slotLabel(slot)}</span><br /><b style={{ fontSize: 18 }}>{picId ? nameOf(db, picId) : 'Nobody'}</b></span></div>
      {!can ? <div className="banner b-info">Only the PIC on shift or the manager can pass the PIC role.</div> : cands.length === 0 ? <p className="muted">No other PIC or manager at this outlet. Ask the manager to add one in Shifts.</p> : <>
        <Field label="Pass to"><select className="input" value={to} onChange={e => setTo(e.target.value)}><option value="">Pick a person</option>{cands.map(e => <option key={e.id} value={e.id}>{e.name} · {e.role === 'pic' ? 'PIC' : 'Manager'}</option>)}</select></Field>
        <Field label="Reason" optional><input className="input" value={note} onChange={e => setNote(e.target.value)} placeholder="Leaving early, family matter" /></Field>
        <button className="btn btn-primary btn-pos" disabled={!to} onClick={go}>Pass PIC</button>
      </>}
    </section>
    <section className="card stack">
      <h3>Passed today</h3>
      {log.length === 0 ? <p className="muted">The PIC role hasn’t changed hands today.</p> : log.map(r => <div key={r.id} className="row" style={{ fontSize: 14 }}><Badge tone="info">{slotLabel(r.b as 'pagi')}</Badge><span className="grow">{nameOf(db, r.c)} → <b>{nameOf(db, r.d)}</b>{r.e ? ' · ' + r.e : ''}</span><span className="faint">{hhmm(r.at)}</span></div>)}
    </section>
  </div>;
}
