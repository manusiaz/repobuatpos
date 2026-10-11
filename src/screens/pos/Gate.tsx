'use client';
// Before selling: staff PIN sign-in (lock screen) and the blind opening-float count that opens the drawer session.
import { useEffect, useState } from 'react';
import { openSession, patchOrder, requestApproval, setSetting } from '../../data/actions.ts';
import { setSession } from '../../session.ts';
import { idr } from '../../domain/money.ts';
import { Avatar, Icon, Numpad, hhmm, toast, useNow } from '../../ui/kit.tsx';
import { DenomCount, P, REG, picNow, rosterSlot, sumDenoms, usePos } from './shared.tsx';

export interface Handover { from: string; to: string; notes: string; float: number; bills: string[]; at: number }
export const handoverKey = (outletId: string) => 'pos:handover:' + outletId;
export function readHandover(settings: Record<string, unknown>, outletId: string): Handover | null {
  try { const v = settings[handoverKey(outletId)]; return typeof v === 'string' && v ? JSON.parse(v) as Handover : null; } catch { return null; }
}

/** Lock screen / PIN sign-in. `next` = shift change: the next cashier signs in while the last one is still on the session. */
export function PinGate({ next }: { next?: boolean }) {
  const { db, outletId, me, go } = usePos();
  const now = useNow(15000);
  const out = db.outlets.find(o => o.id === outletId)!;
  const ho = readHandover(db.settings, outletId);
  const staff = db.employees.filter(e => e.active && e.outlets.includes(outletId) && ['cashier', 'pic', 'manager'].includes(e.role) && !(next && e.id === me.id))
    .sort((a, b) => (rosterSlot(db, outletId, b.id) ? 1 : 0) - (rosterSlot(db, outletId, a.id) ? 1 : 0));
  const [who, setWho] = useState(() => (next && ho?.to) || (staff.find(e => e.id === me.id) ?? staff[0])?.id);
  const [pin, setPin] = useState(''), [err, setErr] = useState(''), [shake, setShake] = useState(false);
  const emp = db.employees.find(e => e.id === who);
  const devs = db.devices.filter(d => d.outletId === outletId && ['printer', 'edc'].includes(d.kind));
  const key = (k: string) => {
    if (k === 'del') { setPin(p => p.slice(0, -1)); setErr(''); return; }
    if (!/^\d$/.test(k) || !emp) return;
    const p = (pin + k).slice(0, 4); setPin(p); setErr('');
    if (p.length < 4) return;
    setTimeout(() => {
      if (p === emp.pin) { setSession({ id: emp.id, role: emp.role, outletId }); setPin(''); if (!next) go(REG); }
      else { setErr('Wrong PIN. Try again.'); setShake(true); setTimeout(() => { setShake(false); setPin(''); }, 320); }
    }, 120);
  };
  useEffect(() => { const k = (e: KeyboardEvent) => key(e.key === 'Backspace' ? 'del' : e.key); addEventListener('keydown', k); return () => removeEventListener('keydown', k); });
  return <div data-theme="dark" className="pos-gate">
    <div className="stack" style={{ gap: 6 }}>
      <b style={{ fontSize: 28, letterSpacing: '-.03em' }}>BorNiz</b>
      <span className="muted">{db.tenant.name} · {out.name} · {db.devices.find(d => d.outletId === outletId && d.kind === 'pos')?.name ?? 'Register'}</span>
      <b className="num" style={{ fontSize: 56, lineHeight: 1 }}>{hhmm(now)}</b>
      <span className="muted">{new Date(now).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</span>
      <span className="row" style={{ fontSize: 14, color: db.device.online ? 'var(--success-fg)' : 'var(--danger-fg)' }}><i className="dot" />
        {db.device.online ? 'Online' : `Offline · ${db.device.queue.length} queued`}{devs.length ? ' · ' + devs.map(d => `${d.kind === 'edc' ? 'EDC' : 'printer'} ${d.status}`).join(' · ') : ''}</span>
      {next && ho && <div className="banner b-info" style={{ marginTop: 16, maxWidth: 420 }}><Icon name="message-square-text" /><span>From {db.employees.find(e => e.id === ho.from)?.name}: {ho.notes || 'no notes'}. {ho.bills.length} open bill{ho.bills.length === 1 ? '' : 's'} handed over.</span></div>}
    </div>
    <div className="stack" style={{ alignItems: 'center', gap: 16, width: 'min(360px,100%)' }}>
      {next && <h2>Next cashier, sign in</h2>}
      <div className="row wrap" style={{ justifyContent: 'center', gap: 8 }} role="radiogroup" aria-label="Who is signing in">
        {staff.map(e => <button key={e.id} role="radio" aria-checked={who === e.id} onClick={() => { setWho(e.id); setPin(''); setErr(''); }} className="stack"
          style={{ alignItems: 'center', gap: 4, padding: '10px 8px', minWidth: 76, borderRadius: 16, border: 0, cursor: 'pointer', color: 'var(--fg-1)', background: who === e.id ? 'var(--bg-raised)' : 'transparent' }}>
          <Avatar name={e.name} color={e.color} size={48} /><span style={{ fontSize: 14, fontWeight: 600 }}>{e.name}</span><span className="faint" style={{ fontSize: 13 }}>{e.role}</span></button>)}
      </div>
      <span>Enter PIN for <b>{emp?.name}</b></span>
      <div className={'pin-dots' + (shake ? ' shake' : '')} aria-label={`${pin.length} of 4 digits`} style={err ? { ['--fg-1' as string]: 'var(--danger-fg)' } : undefined}>{[0, 1, 2, 3].map(i => <i key={i} className={i < pin.length ? 'on' : ''} />)}</div>
      <span role="alert" style={{ minHeight: 20, color: 'var(--danger-fg)', fontSize: 14 }}>{err}</span>
      <div style={{ width: '100%' }}><Numpad onKey={key} extra="" /></div>
      <span className="faint" style={{ fontSize: 13 }}>Demo PIN: 1234</span>
    </div>
  </div>;
}

/** Open shift: blind count of the opening float by denomination, then openSession. A handed-over float is compared after the count. */
export function OpenShift({ closedNotice }: { closedNotice?: boolean }) {
  const { db, me, outletId, session, go } = usePos();
  const ho = readHandover(db.settings, outletId);
  const mine = ho && (!ho.to || ho.to === me.id) ? ho : null;
  const [counts, setCounts] = useState<Record<number, number>>({});
  const total = sumDenoms(counts), slot = rosterSlot(db, outletId, me.id), pic = picNow(db, outletId);
  const out = db.outlets.find(o => o.id === outletId)!;
  if (session) return <div className="pos-gate" style={{ background: 'var(--bg-canvas)', color: 'var(--fg-1)' }}>
    <div className="card stack" style={{ maxWidth: 480, margin: '0 auto', alignItems: 'flex-start' }}><Icon name="circle-check" size={32} style={{ color: 'var(--success)' }} />
      <h2>Your shift is open</h2><p className="muted">Session <span className="mono">{session.id}</span> since {hhmm(session.openedAt)} · opening cash {idr(session.openingFloat)}</p>
      <button className="btn btn-primary btn-pos" onClick={() => go(REG)}>Go to register</button></div></div>;
  const start = () => {
    const id = openSession(outletId, me.id, total);
    if (mine) {
      mine.bills.forEach(b => { if (db.orders.some(o => o.id === b)) patchOrder(b, { sessionId: id, cashierId: me.id }, me.id); });
      if (total !== mine.float) {
        requestApproval({ type: 'variance', title: `Opening float ${idr(total)} vs handed over ${idr(mine.float)} · ${id}`, amount: Math.abs(total - mine.float), requestedBy: me.id, outletId, subjectId: null, note: 'Float count at clock-in differs from handover' });
        toast(`Float differs by ${idr(Math.abs(total - mine.float))} · flagged to the manager`);
      }
      setSetting(handoverKey(outletId), '', me.id);
    }
    go(REG);
  };
  return <div className="pos-gate" style={{ background: 'var(--bg-canvas)', color: 'var(--fg-1)', alignItems: 'flex-start' }}>
    <div className="stack" style={{ maxWidth: 760, width: '100%', margin: '0 auto' }}>
      <div className="row between wrap"><span className="cap">Hi {me.name} · {out.name}{slot ? ` · ${slot.name} ${slot.from}–${slot.to}` : ''}{pic ? ` · PIC ${pic.name}` : ''}</span>
        <button className="btn btn-ghost btn-sm" onClick={() => go(P('lock-screen'))}><Icon name="lock" size={16} />Not you? Switch</button></div>
      <h1>Open shift</h1>
      {closedNotice && <div className="banner b-warning"><Icon name="lock-open" /><span>No open shift on this register for you. Count the drawer to start selling.</span></div>}
      {mine && <div className="banner b-info"><Icon name="message-square-text" /><span><b>Handover from {db.employees.find(e => e.id === mine.from)?.name}</b> · {mine.notes || 'no notes'} · {mine.bills.length} open bill{mine.bills.length === 1 ? '' : 's'} move to you.</span></div>}
      <p className="muted">Count the cash in the drawer before you start selling. The expected amount stays hidden until you submit.</p>
      <DenomCount counts={counts} onChange={setCounts} />
      <div className="sunken row between"><span className="muted">Opening cash</span><b className="num" style={{ fontSize: 30 }}>{idr(total)}</b></div>
      <button className="btn btn-primary btn-pay" onClick={start}>{mine ? `Confirm float ${idr(total)} · start` : 'Start selling'}</button>
    </div>
  </div>;
}
