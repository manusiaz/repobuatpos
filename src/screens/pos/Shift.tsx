'use client';
// Shift tools: X report, cash in/out, cash drop, clock, personal report, blind close count, Z report, handover,
// and the five-step shift change (Shifts prototype, "On the device").
import { useState } from 'react';
import { cashMove, clock, closeSession, patchOrder, sessionCash, setSetting } from '../../data/actions.ts';
import { logDevice, sendReceipt } from '../../data/actions/pos.ts';
import { snapshot } from '../../data/store.ts';
import { closeCheck, expectedCash, type ClockShot } from '../../domain/shift.ts';
import { idr } from '../../domain/money.ts';
import { Badge, Empty, Field, Icon, Kpi, Seg, Status, hhmm, toast, useNow } from '../../ui/kit.tsx';
import type { DB, Order } from '../../data/schema.ts';
import { AmountPad, DenomCount, P, Row, TabLinks, isOpenBill, label, rosterSlot, startOfDay, sumDenoms, usePos, useApproval, usePerm, warnStyle } from './shared.tsx';
import { handoverKey } from './Gate.tsx';
import { ClockPhoto, useSelfie } from '../../ui/Selfie.tsx';
import { commissionOf } from '../insight/metrics.ts';

const PAID: Order['status'][] = ['paid', 'part_refunded', 'refunded'];
const MNAME: Record<string, string> = { cash: 'Cash', qris: 'QRIS', card: 'Card', ewallet: 'E-wallet', va: 'Virtual account', deposit: 'Deposit', kasbon: 'Kasbon' };
export function stats(db: DB, orders: Order[], payFilter: (p: DB['payments'][number]) => boolean) {
  const paid = orders.filter(o => PAID.includes(o.status)), ids = new Set(orders.map(o => o.id));
  const sales = paid.reduce((a, o) => a + o.total, 0);
  const pays = db.payments.filter(p => p.status === 'settled' && p.ref !== 'ROUNDING' && payFilter(p)); // rounding moves no money
  const by: Record<string, number> = {}; pays.forEach(p => { by[p.method] = (by[p.method] ?? 0) + p.amount; });
  const refunds = db.refunds.filter(r => ids.has(r.orderId));
  return { paid, sales, count: paid.length, avg: paid.length ? Math.round(sales / paid.length) : 0, by, tips: pays.reduce((a, p) => a + p.tip, 0),
    refunds: refunds.reduce((a, r) => a + r.amount, 0), refundN: refunds.length, voids: orders.filter(o => o.status === 'voided' && o.lines.length).length,
    discounts: paid.reduce((a, o) => a + o.discount, 0), service: paid.reduce((a, o) => a + o.service, 0), tax: paid.reduce((a, o) => a + o.tax, 0), open: orders.filter(isOpenBill) };
}
const ByMethod = ({ by }: { by: Record<string, number> }) => <div className="stack sm">{Object.keys(by).length === 0 ? <p className="muted">No payments yet.</p> :
  Object.entries(by).sort((a, b) => b[1] - a[1]).map(([m, v]) => <Row key={m} l={MNAME[m] ?? m} v={idr(v)} />)}</div>;

export function ShiftView() {
  const { route, session, me, db } = usePos();
  const tab = route.t ?? 'x';
  const tabs: [string, string, string][] = [['x', 'X report', 'shift-summary-before-close'], ['cash', 'Cash in / out', 'cash-in-cash-out'], ['drop', 'Cash drop', 'cash-drop-to-safe'],
    ['clock', 'Clock', 'clock-in-out'], ['mine', 'My report', 'personal-shift-report'], ['handover', 'Handover', 'handover-to-next-cashier'], ['close', 'Close shift', 'close-shift'], ['z', 'Z report', 'end-of-day-print']];
  const needs = ['x', 'cash', 'drop'].includes(tab) && !session;
  return <div className="pos-page stack lg">
    <div className="row between wrap"><div className="stack" style={{ gap: 2 }}><h1>Shift</h1>
      <span className="muted">{me.name}{session ? ` · session ${session.id} · since ${hhmm(session.openedAt)} · opening cash ${idr(session.openingFloat)}` : ' · no open drawer session'}</span></div>
      {db.approvals.some(a => a.status === 'waiting' && a.requestedBy === me.id) && <Badge tone="warning" dot>{db.approvals.filter(a => a.status === 'waiting' && a.requestedBy === me.id).length} requests waiting</Badge>}</div>
    <TabLinks tabs={tabs} active={tab} />
    {needs ? <Empty icon="lock" title="No open shift">Open a shift to see its report, move cash or hand over.</Empty> :
      tab === 'x' ? <XReport /> : tab === 'cash' ? <CashMoves kind="io" /> : tab === 'drop' ? <CashMoves kind="drop" /> : tab === 'clock' ? <Clock /> : tab === 'mine' ? <Mine /> :
        tab === 'handover' ? <HandoverForm /> : tab === 'close' ? <CloseShift /> : <ZReport />}
  </div>;
}

function XReport({ sessionId }: { sessionId?: string }) {
  const { db, session, me, outletId } = usePos();
  const sid = sessionId ?? session?.id;
  if (!sid) return null;
  const s = stats(db, db.orders.filter(o => o.sessionId === sid), p => p.sessionId === sid);
  const moves = db.cashMoves.filter(c => c.sessionId === sid);
  return <div className="stack">
    <div className="grid" style={{ ['--min' as string]: '150px' }}>
      <Kpi label="Sales" value={idr(s.sales)} /><Kpi label="Transactions" value={s.count} /><Kpi label="Avg ticket" value={s.count ? idr(s.avg) : '—'} /><Kpi label="Refunds" value={idr(s.refunds)} delta={s.refundN ? `${s.refundN} refund${s.refundN > 1 ? 's' : ''}` : undefined} tone="down" />
    </div>
    <div className="grid" style={{ ['--min' as string]: '300px' }}>
      <div className="card stack"><h3>By payment method</h3><ByMethod by={s.by} />{s.tips > 0 && <Row l="Tips (kept apart)" v={idr(s.tips)} />}</div>
      <div className="card stack"><h3>Cash moves</h3>{moves.length === 0 ? <p className="muted">No cash in, out or drops.</p> : moves.map(c => <div key={c.id} className="row between" style={{ fontSize: 14 }}>
        <span>{c.kind === 'in' ? 'In' : c.kind === 'out' ? 'Out' : 'Drop'} · {c.reason} · {hhmm(c.at)}</span><span className="row" style={{ gap: 6 }}><b className="num">{idr(c.amount)}</b>{c.status === 'waiting' && <Status s="waiting" />}</span></div>)}
        <Row l="Open bills on this drawer" v={String(s.open.length)} /><Row l="Voided bills" v={String(s.voids)} /></div>
    </div>
    <p className="faint" style={{ fontSize: 13 }}>Expected cash in the drawer stays hidden until the blind count at close.</p>
    <div className="row wrap"><button className="btn btn-pos" onClick={() => { logDevice('print.x_report', sid, me.id, outletId); toast('X report printed'); }}><Icon name="printer" />Print X report</button>
      <button className="btn btn-pos" onClick={() => { sendReceipt('', 'wa', me.phone, me.id, 'x_report'); toast('X report sent to your WhatsApp'); }}><Icon name="message-circle" />Send to my WhatsApp</button></div>
  </div>;
}

const REASONS = { in: ['Change from bank', 'Owner top-up', 'Other'], out: ['Ice cubes', 'Gas / LPG', 'Parking', 'Supplier COD', 'Other'], drop: ['Safe drop', 'Bank deposit'] };
function CashMoves({ kind }: { kind: 'io' | 'drop' }) {
  const { db, session, me } = usePos();
  const flow = useApproval();
  const [k, setK] = useState<'in' | 'out'>('out'), [amt, setAmt] = useState(0), [why, setWhy] = useState(''), [bag, setBag] = useState('');
  const mk = kind === 'drop' ? 'drop' : k;
  const list = db.cashMoves.filter(c => c.sessionId === session!.id && (kind === 'drop' ? c.kind === 'drop' : c.kind !== 'drop'));
  const submit = () => {
    const reason = mk === 'drop' ? [why || 'Safe drop', bag && 'bag ' + bag].filter(Boolean).join(' · ') : why;
    const id = cashMove(session!.id, mk, amt, reason, me.id);
    if (mk === 'out') { const a = snapshot().approvals.find(x => x.subjectId === id); if (a?.status === 'waiting') flow.resume(a.id, a.title, a.level, () => toast('Cash out approved')); }
    else toast(mk === 'drop' ? `Dropped ${idr(amt)} to the safe` : `Cash in ${idr(amt)} recorded`);
    setAmt(0); setWhy(''); setBag('');
  };
  if (flow.node) return <div className="card" style={{ maxWidth: 520 }}>{flow.node}</div>;
  return <div className="grid" style={{ ['--min' as string]: '320px', alignItems: 'start' }}>
    <div className="card stack">
      {kind === 'io' ? <Seg label="Direction" value={k} options={[['in', 'Cash in'], ['out', 'Cash out (petty cash)']] as const} onChange={setK} /> : <h3>Drop cash to the safe</h3>}
      <AmountPad value={amt} onChange={setAmt} title={mk === 'in' ? 'Cash in' : mk === 'out' ? 'Cash out' : 'Drop amount'} />
      <Field label="Reason"><div className="row wrap" style={{ gap: 6 }}>{REASONS[mk].map(r => <button key={r} className="chip" aria-pressed={why === r} onClick={() => setWhy(r)}>{r}</button>)}</div>
        <input className="input" value={why} onChange={e => setWhy(e.target.value)} placeholder="Or type a reason" /></Field>
      {mk === 'drop' && <Field label="Safe bag number" optional><input className="input mono" value={bag} onChange={e => setBag(e.target.value)} placeholder="e.g. 0042" /></Field>}
      {mk === 'out' && <p className="faint" style={{ fontSize: 13 }}>Cash out needs the PIC’s PIN (manager above IDR 100,000).</p>}
      <button className="btn btn-primary btn-pos" disabled={!amt || !why.trim()} onClick={submit}>{mk === 'in' ? 'Record cash in' : mk === 'out' ? 'Request cash out' : 'Record drop'}</button>
    </div>
    <div className="card stack"><h3>{kind === 'drop' ? 'Drops this shift' : 'Cash in / out this shift'}</h3>
      {list.length === 0 ? <p className="muted">Nothing yet.</p> : list.map(c => { const ap = db.approvals.find(a => a.subjectId === c.id);
        return <div key={c.id} className="row" style={{ fontSize: 14 }}><span className="grow">{c.kind === 'in' ? 'In' : c.kind === 'out' ? 'Out' : 'Drop'} · {c.reason}<br /><span className="faint">{hhmm(c.at)} · {db.employees.find(e => e.id === c.by)?.name}</span></span>
          <b className="num">{idr(c.amount)}</b>{c.status === 'waiting' ? <button className="btn btn-sm" onClick={() => ap && flow.resume(ap.id, ap.title, ap.level)}>Enter PIN</button> : <Status s={ap?.status === 'rejected' ? 'rejected' : 'done'} />}</div>; })}
    </div>
  </div>;
}

function Clock() {
  const { db, me, outletId } = usePos();
  const now = useNow(30000);
  const selfie = useSelfie();
  const today = db.clock.filter(c => c.employeeId === me.id && c.at >= startOfDay()).sort((a, b) => a.at - b.at);
  const last = today.at(-1), slot = rosterSlot(db, outletId, me.id);
  const state = !last || last.kind === 'out' ? 'out' : last.kind;
  const punch = (kind: 'in' | 'out', msg: string) => selfie.ask({ who: me.name, kind, label: kind === 'in' && state === 'break' ? 'End break' : undefined, onShot: shot => toast(clock(me.id, outletId, kind, shot) ?? msg) });
  const firstIn = today.find(c => c.kind === 'in');
  return <div className="grid" style={{ ['--min' as string]: '320px', alignItems: 'start' }}>
    <div className="card stack">
      <span className="cap">{slot ? `Rostered ${slot.name} · ${slot.from}–${slot.to}` : 'Not on today’s roster'}</span>
      <h2>{state === 'in' ? `Clocked in since ${hhmm(last!.at)}` : state === 'break' ? `On break since ${hhmm(last!.at)}` : 'Clocked out'}</h2>
      {firstIn && <span className="muted">Worked {Math.floor(Math.max(0, now - firstIn.at) / 3600e3)}h {Math.floor(Math.max(0, now - firstIn.at) / 60e3) % 60}m today{slot && firstIn && hhmm(firstIn.at) > slot.from ? ` · started after ${slot.from}` : ''}</span>}
      <div className="row wrap">
        {state !== 'in' && <button className="btn btn-primary btn-pos" onClick={() => punch('in', state === 'break' ? 'Back from break' : 'Clocked in')}><Icon name="camera" />{state === 'break' ? 'End break' : 'Clock in'}</button>}
        {state === 'in' && <button className="btn btn-pos" onClick={() => { clock(me.id, outletId, 'break'); toast('Break started'); }}>Start break</button>}
        {state !== 'out' && <button className="btn btn-pos" onClick={() => punch('out', 'Clocked out')}><Icon name="camera" />Clock out</button>}
      </div>
      <p className="faint" style={{ fontSize: 13 }}>Clock in and out take a quick photo. Opening a shift clocks you in. Clocking out doesn’t close your drawer.</p>
    </div>
    <div className="card stack"><h3>Today</h3>{today.length === 0 ? <p className="muted">No clock events yet.</p> : today.map(c => <div key={c.id} className="row" style={{ fontSize: 14 }}><ClockPhoto c={c} /><span className="grow">{c.kind === 'in' ? 'In' : c.kind === 'out' ? 'Out' : 'Break'}</span><b className="num">{hhmm(c.at)}</b></div>)}</div>
    {selfie.sheet}
  </div>;
}

function Mine() {
  const { db, me, outletId } = usePos();
  const mine = db.orders.filter(o => o.outletId === outletId && o.cashierId === me.id && o.createdAt >= startOfDay());
  const s = stats(db, mine, p => mine.some(o => o.id === p.orderId));
  const items: Record<string, number> = {}; s.paid.forEach(o => o.lines.forEach(l => { items[l.name] = (items[l.name] ?? 0) + l.qty; }));
  const ins = db.clock.filter(c => c.employeeId === me.id && c.at >= startOfDay());
  const k = commissionOf(db, me, { from: startOfDay(), to: Date.now() + 1 });
  return <div className="stack">
    <div className="grid" style={{ ['--min' as string]: '150px' }}><Kpi label="My sales today" value={idr(s.sales)} /><Kpi label="Orders" value={s.count} /><Kpi label="Avg ticket" value={s.count ? idr(s.avg) : '—'} /><Kpi label="Tips" value={idr(s.tips)} />
      <Kpi label="My commission today" value={idr(k.total)} delta={k.rules.length ? `${idr(k.net)} net sales${k.items ? ` · ${k.items} bonus items` : ''}` : 'No commission rule for you'} /></div>
    <div className="grid" style={{ ['--min' as string]: '300px' }}>
      <div className="card stack"><h3>Top items</h3>{Object.keys(items).length === 0 ? <p className="muted">No sales yet today.</p> : Object.entries(items).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([n, q]) => <Row key={n} l={n} v={q + '×'} />)}</div>
      <div className="card stack"><h3>By method</h3><ByMethod by={s.by} /><Row l="Clock events today" v={String(ins.length)} /></div>
    </div>
  </div>;
}

/** Blind close: count → submit → only then expected and variance show. Over the limit asks the approver's PIN in place. */
export function CloseShift({ onClosed }: { onClosed?: () => void }) {
  const { db, session, me, go } = usePos();
  const can = usePerm(), flow = useApproval();
  const [counts, setCounts] = useState<Record<number, number>>({}), [phase, setPhase] = useState<'count' | 'review' | 'done'>('count'), [note, setNote] = useState('');
  const [closed, setClosed] = useState<string | null>(null);
  const selfie = useSelfie();
  if (flow.node) return <div className="card" style={{ maxWidth: 560 }}>{flow.node}</div>;
  const sid = session?.id ?? closed;
  if (!sid) return <Empty icon="lock" title="No open shift">There’s no drawer session to close.</Empty>;
  const s0 = db.sessions.find(s => s.id === sid)!;
  if (phase === 'done' || s0.status !== 'open') {
    const ap = db.approvals.find(a => a.type === 'variance' && a.subjectId === sid);
    return <div className="card stack" style={{ maxWidth: 560 }}>
      <Icon name="circle-check" size={32} style={{ color: 'var(--success)' }} /><h2>{s0.status === 'needs_approval' ? 'Count submitted · waiting for sign-off' : 'Shift closed'}</h2>
      <Row l="Counted" v={idr(s0.counted ?? 0)} /><Row l="Variance" v={idr(s0.variance ?? 0)} tone={(s0.variance ?? 0) === 0 ? undefined : 'var(--danger-fg)'} />
      {ap && <Row l="Sign-off" v={`${ap.level.toUpperCase()} · ${ap.status}`} />}
      {ap?.status === 'waiting' && <button className="btn btn-pos" onClick={() => flow.resume(ap.id, ap.title, ap.level)}>Enter approver PIN</button>}
      <div className="row wrap">{onClosed ? <button className="btn btn-primary btn-pos" onClick={onClosed}>Continue to handover</button> : <>
        <button className="btn btn-pos" onClick={() => go(P('end-of-day-print'))}>Z report</button><button className="btn btn-primary btn-pos" onClick={() => go(P('lock-screen'))}>Lock register</button></>}</div>
    </div>;
  }
  const counted = sumDenoms(counts), cash = sessionCash(db, sid), exp = expectedCash(cash), chk = closeCheck(cash, counted, note);
  const nonCash = stats(db, db.orders.filter(o => o.sessionId === sid), p => p.sessionId === sid && p.method !== 'cash').by;
  const open = db.orders.filter(o => o.sessionId === sid && isOpenBill(o) && o.lines.length);
  const submit = () => {
    // closing your own drawer clocks you out, so it takes the clock-out photo first
    const done = () => s0.cashierId === me.id ? selfie.ask({ who: me.name, kind: 'out', label: 'Close shift', optional: true, onShot: close }) : close({});
    const close = (shot: ClockShot) => {
      const r = closeSession(sid, counted, note, me.id, shot); setClosed(sid); setPhase('done');
      if (r.level) { const row = snapshot().approvals.find(x => x.type === 'variance' && x.subjectId === sid && x.status === 'waiting'); if (row) flow.resume(row.id, row.title, row.level); }
      else toast('Shift closed · balanced');
    };
    if (can('Close cash for the day') === 'a') flow.verify('Close cash for the day', `Close drawer ${sid}`, done); else done();
  };
  if (can('Close cash for the day') === 'n') return <Empty icon="shield-x" title="Closing cash is turned off for your role">Ask the PIC or manager to close this drawer.</Empty>;
  return <div className="stack">
    {selfie.sheet}
    {open.length > 0 && <div className="banner b-warning"><Icon name="clipboard-list" /><span>{open.length} open bill{open.length > 1 ? 's' : ''} on this drawer. Hand them over or settle them before closing.</span></div>}
    {phase === 'count' ? <>
      <span className="cap">Count the drawer · blind</span>
      <DenomCount counts={counts} onChange={setCounts} />
      <div className="sunken row between"><span className="muted">Counted</span><b className="num" style={{ fontSize: 30 }}>{idr(counted)}</b></div>
      <div className="card stack sm"><b>From the system, no counting</b><ByMethod by={nonCash} /></div>
      <button className="btn btn-primary btn-pay" onClick={() => setPhase('review')}>Submit count</button>
    </> : <div className="grid" style={{ ['--min' as string]: '320px', alignItems: 'start' }}>
      <div className="card stack">
        <Row l="Opening cash" v={idr(cash.openingFloat)} /><Row l="Cash sales" v={idr(cash.cashSales)} />{!!cash.cashTips && <Row l="Cash tips" v={idr(cash.cashTips)} />}<Row l="Cash in" v={idr(cash.cashIn)} />
        <Row l="Cash out & drops" v={'− ' + idr(cash.cashOut)} /><Row l="Cash refunds" v={'− ' + idr(cash.cashRefunds)} /><hr style={{ border: 0, borderTop: '1px solid var(--border)', width: '100%' }} />
        <Row l="Expected in drawer" v={idr(exp)} strong /><Row l="Counted" v={idr(counted)} strong />
      </div>
      <div className="card stack">
        <span className={'badge ' + (chk.variance === 0 ? 'b-success' : chk.level === 'pic' ? 'b-warning' : 'b-danger')} style={{ alignSelf: 'flex-start' }}>{chk.variance === 0 ? 'Balanced' : chk.variance > 0 ? 'Over' : 'Short'}</span>
        <b className="num" style={{ fontSize: 34 }}>{chk.variance > 0 ? '+ ' : chk.variance < 0 ? '− ' : ''}{idr(Math.abs(chk.variance))}</b>
        <p className="muted" style={{ fontSize: 14 }}>{chk.variance === 0 ? 'Drawer matches expected cash. Ready to close.' : chk.level === 'pic' ? 'Within the PIC limit (IDR 50,000). Add a reason; the PIC signs with their PIN.' : `Above the PIC limit. A reason and the ${chk.level}’s PIN are needed.`}</p>
        {chk.variance !== 0 && <Field label="Reason for variance"><textarea className="input" value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. change given twice on #2051" /></Field>}
        <p className="faint" style={{ fontSize: 13 }}>The count is locked once submitted. A recount is a new count, both kept.</p>
        <button className="btn btn-primary btn-pay" style={warnStyle(can('Close cash for the day'))} disabled={chk.variance !== 0 && !note.trim()} onClick={submit}>Close shift & print report</button>
      </div>
    </div>}
  </div>;
}

function ZReport() {
  const { db, outletId, me } = usePos();
  const t0 = startOfDay(), out = db.outlets.find(o => o.id === outletId)!;
  const day = db.orders.filter(o => o.outletId === outletId && (o.paidAt ?? o.createdAt) >= t0);
  const s = stats(db, day, p => p.outletId === outletId && p.at >= t0);
  const bySrc: Record<string, number> = {}; s.paid.forEach(o => { bySrc[o.source] = (bySrc[o.source] ?? 0) + o.total; });
  const sessions = db.sessions.filter(x => x.outletId === outletId && x.openedAt >= t0 - 12 * 3600e3);
  return <div className="stack">
    <div className="row between wrap"><span className="muted">{out.name} · business day {new Date(t0).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} · all registers</span>
      <button className="btn btn-primary btn-pos" onClick={() => { logDevice('print.z_report', out.name, me.id, outletId); toast('Z report printed'); }}><Icon name="printer" />Print Z report</button></div>
    <div className="grid" style={{ ['--min' as string]: '150px' }}><Kpi label="Net sales" value={idr(s.sales)} /><Kpi label="Orders" value={s.count} /><Kpi label="Avg ticket" value={idr(s.avg)} /><Kpi label="Refunds" value={idr(s.refunds)} /></div>
    <div className="grid" style={{ ['--min' as string]: '300px' }}>
      <div className="card stack"><h3>Totals</h3><Row l="Gross (after item discounts)" v={idr(s.paid.reduce((a, o) => a + o.subtotal, 0))} /><Row l="Order discounts" v={'− ' + idr(s.discounts)} />
        <Row l="Service charge" v={idr(s.service)} /><Row l={`PB1 ${out.taxBps / 100}%`} v={idr(s.tax)} /><Row l="Net sales" v={idr(s.sales)} strong /><Row l="Voided bills" v={String(s.voids)} /><Row l="Tips" v={idr(s.tips)} /></div>
      <div className="card stack"><h3>By payment method</h3><ByMethod by={s.by} /></div>
      <div className="card stack"><h3>By channel</h3>{Object.entries(bySrc).sort((a, b) => b[1] - a[1]).map(([k, v]) => <Row key={k} l={k === 'pos' ? 'Register' : k === 'qr' ? 'QR menu' : k[0].toUpperCase() + k.slice(1)} v={idr(v)} />)}</div>
      <div className="card stack"><h3>Drawer sessions</h3>{sessions.length === 0 ? <p className="muted">No sessions today.</p> : sessions.map(x => <div key={x.id} className="row between" style={{ fontSize: 14 }}>
        <span><span className="mono">{x.id}</span> · {db.employees.find(e => e.id === x.cashierId)?.name}</span><span className="row" style={{ gap: 6 }}>{x.variance != null && <span className="num">{idr(x.variance)}</span>}<Status s={x.status} /></span></div>)}</div>
    </div>
  </div>;
}

export function HandoverForm({ onDone }: { onDone?: () => void }) {
  const { db, me, outletId, session, setting, go } = usePos();
  const bills = db.orders.filter(o => o.outletId === outletId && isOpenBill(o) && o.lines.length && (o.cashierId === me.id || (session && o.sessionId === session.id)));
  const next = db.employees.filter(e => e.active && e.id !== me.id && e.outlets.includes(outletId) && ['cashier', 'pic', 'manager'].includes(e.role));
  const [to, setTo] = useState(next.find(e => e.role === 'cashier')?.id ?? next[0]?.id ?? ''), [float, setFloat] = useState<number>(setting('float', 500000)), [notes, setNotes] = useState('');
  const save = () => {
    setSetting(handoverKey(outletId), JSON.stringify({ from: me.id, to, notes: notes.trim(), float, bills: bills.map(b => b.id), at: Date.now() }), me.id);
    bills.forEach(b => patchOrder(b.id, { cashierId: to }, me.id));
    toast(`Handed over to ${db.employees.find(e => e.id === to)?.name}`);
    if (onDone) onDone(); else go(P('clock-out-and-x-report'));
  };
  return <div className="grid" style={{ ['--min' as string]: '320px', alignItems: 'start' }}>
    <div className="card stack"><h3>Open bills on your drawer · {bills.length}</h3>
      {bills.length === 0 ? <p className="muted">No open bills. Nothing to transfer.</p> : bills.map(b => <Row key={b.id} l={`${label(b)} · ${b.no} · ${b.lines.length} items`} v={idr(b.total)} />)}
      <p className="faint" style={{ fontSize: 13 }}>Bills move to the next cashier with their table. Kitchen tickets stay with the outlet.</p></div>
    <div className="card stack">
      <Field label="Next cashier"><select className="input" value={to} onChange={e => setTo(e.target.value)}>{next.map(e => <option key={e.id} value={e.id}>{e.name} · {e.role}</option>)}</select></Field>
      <Field label="Float left in the drawer"><input className="input num" inputMode="numeric" value={float} onChange={e => setFloat(Number(e.target.value.replace(/\D/g, '')) || 0)} /></Field>
      <Field label="Notes for the next shift" optional><textarea className="input" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Oat milk low, 2 GoFood orders waiting for pickup…" /></Field>
      <button className="btn btn-primary btn-pos" disabled={!to} onClick={save}>Hand over</button>
    </div>
  </div>;
}

const STEPS: [string, string][] = [['shift-ending-reminder', 'Shift ending'], ['blind-drawer-count', 'Count the drawer'], ['handover', 'Hand over'], ['clock-out-and-x-report', 'Clock out'], ['next-cashier-clock-in-and-float-confirm', 'Next cashier in']];
export function ShiftChange() {
  const { route, db, me, outletId, session, go } = usePos();
  const step = Number(route.t ?? 0);
  const now = useNow(30000);
  const slot = rosterSlot(db, outletId, me.id);
  const end = (() => { if (slot) { const [h, m] = slot.to.split(':').map(Number); const d = new Date(); d.setHours(h, m, 0, 0); return d.getTime(); } return session ? session.openedAt + 8 * 3600e3 : now; })();
  const left = Math.round((end - now) / 60e3);
  const bills = db.orders.filter(o => o.outletId === outletId && isOpenBill(o) && o.lines.length && o.cashierId === me.id);
  const last = db.sessions.filter(s => s.cashierId === me.id && s.outletId === outletId).sort((a, b) => b.openedAt - a.openedAt)[0];
  const clockedIn = (() => { const c = db.clock.filter(x => x.employeeId === me.id && x.at >= startOfDay()).at(-1); return c && c.kind !== 'out'; })();
  const selfie = useSelfie();
  return <div className="pos-page stack lg">
    {selfie.sheet}
    <h1>Shift change</h1>
    <ol className="row wrap" style={{ listStyle: 'none', padding: 0, margin: 0, gap: 6 }}>{STEPS.map(([slug, l], i) =>
      <li key={slug}><button className="chip row" aria-pressed={i === step} onClick={() => go(P(slug))} style={{ height: 44 }}><span className="num" style={{ width: 22, height: 22, borderRadius: 99, display: 'grid', placeItems: 'center', background: i < step ? 'var(--success)' : i === step ? 'var(--accent)' : 'var(--bg-sunken)', color: i <= step ? 'var(--ink-0)' : 'var(--fg-2)', fontSize: 13 }}>{i + 1}</span>{l}</button></li>)}</ol>
    {step === 0 && <div className="stack">
      <div className="banner b-warning"><Icon name="alarm-clock" /><span className="grow"><b>Your shift ends at {hhmm(end)}</b> · {left > 0 ? `${left} min left` : `${-left} min over`}. Selling continues while you wrap up.</span>
        <button className="btn btn-primary" onClick={() => go(P('blind-drawer-count'))}>Start handover</button></div>
      <div className="card stack"><h3>Open bills on your drawer · {bills.length}</h3>{bills.length === 0 ? <p className="muted">None. You can close cleanly.</p> : bills.map(b => <Row key={b.id} l={`${label(b)} · ${b.no} · ${b.lines.length} items`} v={idr(b.total)} />)}</div>
      {!slot && <p className="faint" style={{ fontSize: 13 }}>You’re not on today’s roster; the end time is 8 hours after your drawer opened.</p>}
    </div>}
    {step === 1 && <CloseShift onClosed={() => go(P('handover'))} />}
    {step === 2 && <HandoverForm />}
    {step === 3 && <div className="stack">
      {last ? <><span className="cap">X report · session {last.id} · {hhmm(last.openedAt)}–{last.closedAt ? hhmm(last.closedAt) : 'now'}</span><XReport sessionId={last.id} /></> : <Empty icon="receipt" title="No drawer session yet" />}
      <div className="row wrap">
        {clockedIn ? <button className="btn btn-primary btn-pos" onClick={() => selfie.ask({ who: me.name, kind: 'out', onShot: shot => toast(clock(me.id, outletId, 'out', shot) ?? `Thanks, ${me.name}. You’re clocked out.`) })}><Icon name="camera" />Clock out</button> : <Badge tone="success" dot>Clocked out</Badge>}
        <button className="btn btn-pos" onClick={() => go(P('next-cashier-clock-in-and-float-confirm'))}>Next cashier in</button>
        <button className="btn btn-pos" onClick={() => go(P('lock-screen'))}><Icon name="lock" />Back to lock screen</button></div>
    </div>}
  </div>;
}
