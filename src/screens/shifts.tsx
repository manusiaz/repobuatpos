'use client';
// Shifts (spec/BorNiz Shifts.dc.html, layout A "week grid"): one PIC per shift, roster, attendance, drawer sessions per shift.
// Model: business day → shift → drawer session → orders. Roster rows live in db.roster (Mon = day 0).
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useApp } from '../app/context.tsx';
import { pagesOf } from '../system/registry.ts';
import { Avatar, Badge, Empty, Field, Icon, Kpi, Status, Toggle, hhmm, toast, useNow } from '../ui/kit.tsx';
import { idr } from '../domain/money.ts';
import { LIMITS } from '../domain/approval.ts';
import { expectedCash } from '../domain/shift.ts';
import { clock, sessionCash, setSetting } from '../data/actions.ts';
import { alertNoShow, applySwap, assignPic, assignShift, publishRoster, requestSwap } from '../data/actions/shifts.ts';
import type { DB, Employee } from '../data/schema.ts';
import { ApprovalCard, useDecide } from './ops/approvals.tsx';
import { ClockPhoto, useSelfie } from '../ui/Selfie.tsx';
import { ATTENDANCE_PAGE, photoRequired } from '../system/settings.ts';
import {
  DAY_NAMES, ROLE_LABEL, SLOTS, SLOT_TONE, attendance, clockState, dateKey, dayIdx, dayLabel, emp, nameOf, onSlot, picCandidates,
  rosterDay, slotEnd, slotHours, slotLabel, slotNow, slotOf, slotStart, slotTime, slotsOf, staffOf, startOfDay, weekStart, type Slot,
} from './ops/shift.ts';

const PAGES = pagesOf('shifts');
const NEED: Record<Slot, Employee['role'][]> = { pagi: ['cashier', 'kitchen'], siang: ['cashier', 'kitchen'], malam: ['cashier'] };
const CYCLE: (Slot | 'off')[] = ['pagi', 'siang', 'malam', 'off'];
type Ctx = ReturnType<typeof useShifts>;

function useShifts() {
  const app = useApp();
  const now = useNow(30e3);
  const { db, outletId, user, me } = app;
  return { ...app, now, today: dayIdx(now), slot: slotNow(now), meId: me?.id ?? user.id, canEdit: user.role === 'owner' || user.role === 'manager',
    outlet: db.outlets.find(o => o.id === outletId), staff: staffOf(db, outletId), week: dateKey(weekStart(now)) };
}

export default function Screen() {
  const c = useShifts();
  const { page, user, outlet, now } = c;
  const tabs = PAGES.filter(p => user.role === 'owner' ? p.slug !== 'team-roster-and-pic' : p.slug !== 'shifts-and-schedules');
  return <div className="stack lg">
    <header className="stack sm">
      <span className="cap">Shifts · {outlet?.name} · week of {dayLabel(0, now)} – {dayLabel(6, now)}</span>
      <div className="row wrap between"><h1>{page.title}</h1>{!c.canEdit && <Badge>View only · the manager edits the roster</Badge>}</div>
      <nav className="row" style={{ overflowX: 'auto', paddingBottom: 2 }} aria-label="Shifts">{tabs.map(p => <Link key={p.path} href={p.path} className="chip row" aria-current={p.path === page.path ? 'page' : undefined}
        style={{ textDecoration: 'none', color: p.path === page.path ? 'var(--bg-surface)' : 'var(--fg-1)', background: p.path === page.path ? 'var(--fg-1)' : undefined, height: 40 }}>{p.title}</Link>)}</nav>
    </header>
    {!c.db.device.online && <div className="banner b-warning"><Icon name="wifi-off" size={18} />Offline. Clock-ins are kept on this device and sync later with their original times.</div>}
    <View c={c} />
  </div>;
}

function View({ c }: { c: Ctx }) {
  switch (c.page.slug) {
    case 'shift-templates': return <Templates c={c} />;
    case 'weekly-roster-builder-and-coverage': return <Roster c={c} />;
    case 'assign-pic-per-shift': return <AssignPic c={c} />;
    case 'publish-roster-to-whatsapp': return <Publish c={c} />;
    case 'schedules-and-attendance': return <Attendance c={c} />;
    default: return <Overview c={c} team={c.page.slug === 'team-roster-and-pic'} />;
  }
}

const SlotBadge = ({ s, pic }: { s: Slot; pic?: boolean }) => <Badge tone={SLOT_TONE[s]}>{slotLabel(s)}{pic ? ' · PIC' : ''}</Badge>;
const hoursOf = (db: DB, outletId: string, id: string) => Array.from({ length: 7 }, (_, d) => slotsOf(rosterDay(db, outletId, d), id).reduce((a, s) => a + slotHours(s), 0)).reduce((a, b) => a + b, 0);
/** Worked time today from clock pairs (in → break/out). */
function workedMin(ev: { kind: string; at: number }[], now: number) {
  let t = 0, from: number | null = null;
  for (const e of ev) { if (e.kind === 'in') from ??= e.at; else if (from != null) { t += e.at - from; from = null; } }
  if (from != null) t += now - from;
  return Math.round(t / 60e3);
}
const hm = (m: number) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
/** Missing roles per slot: PIC first, then the roles the template needs. */
function missing(db: DB, outletId: string, day: number, s: Slot) {
  const sd = rosterDay(db, outletId, day), ids = onSlot(sd, s), roles = ids.map(id => emp(db, id)?.role);
  return [...(sd?.slots[s].pic ? [] : ['PIC']), ...NEED[s].filter(r => !roles.includes(r)).map(r => r === 'cashier' ? 'cashier' : 'kitchen')];
}

// ── Overview: now, timeline, sessions per shift, handover notes, team ───────────────────
function Overview({ c, team }: { c: Ctx; team: boolean }) {
  const { db, outletId, now, today, slot, staff } = c;
  const sd = rosterDay(db, outletId, today);
  const crew = onSlot(sd, slot), late = SLOTS.flatMap(s => onSlot(sd, s).filter(id => now >= slotStart(s, now) && attendance(db, id, outletId, s, now).flag));
  const sessions = db.sessions.filter(s => s.outletId === outletId && (s.openedAt >= startOfDay(now) || s.status !== 'closed'));
  const notes = (db.records.handover ?? []).filter(r => r.a === outletId && r.id.includes(dateKey(now)) && (r.d || r.e));
  const pos = (t: number) => Math.max(0, Math.min(100, ((t - startOfDay(now)) / 3600e3 - 6) / 17 * 100));
  const people = [...new Set(SLOTS.flatMap(s => onSlot(sd, s)))];
  const nowMark = <span aria-hidden style={{ position: 'absolute', top: -2, bottom: -4, left: pos(now) + '%', width: 2, background: 'var(--danger)', zIndex: 1 }} />;
  return <>
    <div className="grid" style={{ ['--min' as string]: '180px' }}>
      <Kpi label="Shift now" value={slotLabel(slot)} delta={slotTime(slot)} />
      <Kpi label="PIC now" value={nameOf(db, sd?.slots[slot].pic) || 'None'} delta={sd?.slots[slot].pic ? 'One PIC per shift' : 'Pick a PIC'} tone={sd?.slots[slot].pic ? undefined : 'down'} />
      <Kpi label="On shift" value={crew.filter(id => clockState(db, id, outletId).state === 'in').length + ' of ' + crew.length} delta="Clocked in vs rostered" />
      <Kpi label="Late or no-show" value={late.length} delta={late.length ? late.map(id => nameOf(db, id)).join(', ') : 'Everyone on time'} tone={late.length ? 'warn' : 'up'} />
    </div>
    <section className="card stack">
      <div className="row between wrap"><h3>{new Date(now).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })} · {c.outlet?.name}</h3><span className="muted">06:00 – 23:00 · now {hhmm(now)}</span></div>
      {people.length === 0 ? <Empty icon="calendar-x" title="Nobody rostered today" action={c.canEdit ? <Link className="btn" href={PAGES.find(p => p.slug === 'weekly-roster-builder-and-coverage')!.path}>Build the roster</Link> : undefined} /> :
      <div style={{ position: 'relative' }}>
        {SLOTS.map(s => <div key={s} className="row" style={{ height: 30, marginBottom: 4 }}><span className="hide-sm" style={{ width: 110, fontSize: 12 }} /><div className="grow" style={{ position: 'relative', height: '100%' }}>{nowMark}
          <span className={'badge b-' + SLOT_TONE[s]} style={{ position: 'absolute', left: pos(slotStart(s, now)) + '%', width: `calc(${pos(slotEnd(s, now)) - pos(slotStart(s, now))}% - 4px)`, height: 26, borderRadius: 8, overflow: 'hidden' }}>{slotLabel(s)} · {slotTime(s)}</span></div></div>)}
        {people.map(id => { const e = emp(db, id); const ss = slotsOf(sd, id); const st = clockState(db, id, outletId).state; return <div key={id} className="row" style={{ height: 30, marginBottom: 2 }}>
          <span className="hide-sm" style={{ width: 110, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e?.name}</span>
          <div className="grow" style={{ position: 'relative', height: '100%' }}>{nowMark}{ss.map(s => <span key={s} className="row" style={{ position: 'absolute', left: pos(slotStart(s, now)) + '%', width: `calc(${pos(slotEnd(s, now)) - pos(slotStart(s, now))}% - 4px)`, height: 26, padding: '0 8px', borderRadius: 8, fontSize: 12, fontWeight: 600, background: st === 'in' ? 'var(--bg-surface)' : 'var(--bg-sunken)', border: '1px solid ' + (st === 'in' ? 'var(--success)' : 'var(--border)'), overflow: 'hidden', whiteSpace: 'nowrap' }}>
            <i className="dot" style={{ color: st === 'in' ? 'var(--success)' : st === 'break' ? 'var(--warning)' : 'var(--ink-300)' }} />{e?.name} · {sd?.slots[s].pic === id ? 'PIC' : ROLE_LABEL[e?.role ?? 'cashier']}</span>)}</div></div>; })}
      </div>}
    </section>
    <section className="card flat">
      <div className="row between" style={{ padding: 16 }}><h3>Drawer sessions & cash close per shift</h3><Badge>Counted at the register · read only</Badge></div>
      {sessions.length === 0 ? <Empty icon="banknote" title="No drawer sessions today" /> : <div className="scroll-x"><table className="table">
        <thead><tr><th>Shift</th><th>Session</th><th>Cashier</th><th className="r">Expected</th><th className="r">Counted</th><th className="r">Variance</th><th>Status</th></tr></thead>
        <tbody>{sessions.map(s => { const ex = expectedCash(sessionCash(db, s.id)); const stale = s.status === 'open' && c.outlet && hhmm(now) > c.outlet.closes && now - s.openedAt > 12 * 3600e3; return <tr key={s.id}>
          <td><SlotBadge s={slotOf(s.openedAt)} /></td><td className="mono">{s.id}</td><td>{nameOf(db, s.cashierId)}</td><td className="r num">{idr(ex)}</td>
          <td className="r num">{s.counted != null ? idr(s.counted) : '—'}</td><td className={'r num ' + (s.variance ? 'down' : '')}>{s.variance != null ? idr(s.variance) : '—'}</td>
          <td>{stale ? <Badge tone="danger">Session not closed</Badge> : <Status s={s.status} />}{s.note ? <span className="faint" style={{ fontSize: 12 }}> · {s.note}</span> : null}</td></tr>; })}</tbody></table></div>}
    </section>
    <section className="card stack">
      <h3>Handover notes today</h3>
      {notes.length === 0 ? <p className="muted">No handover notes yet. The PIC writes them on the tablet at the end of each shift.</p> : notes.map(r => <div key={r.id} className="row" style={{ alignItems: 'flex-start' }}>
        <SlotBadge s={r.b as Slot} /><span className="grow">{r.d || 'No notes'}<br /><span className="faint" style={{ fontSize: 12 }}>{r.e ? `Closed by ${nameOf(db, r.e)} · ${hhmm(r.at)}` : 'Shift still open'}</span></span></div>)}
    </section>
    {(team || c.user.role === 'owner') && <section className="card flat">
      <div className="row between" style={{ padding: 16 }}><h3>Team · {staff.length}</h3><span className="muted">Hours this week from the roster</span></div>
      <div className="scroll-x"><table className="table"><thead><tr><th>Person</th><th>Role</th><th>Outlets</th><th className="r">Hours</th><th className="r">PIC shifts</th><th>Phone</th></tr></thead>
        <tbody>{staff.map(e => { const h = hoursOf(db, outletId, e.id); const picN = db.roster.filter(r => r.outletId === outletId).reduce((a, r) => a + SLOTS.filter(s => r.slots[s].pic === e.id).length, 0); return <tr key={e.id}>
          <td><div className="row"><Avatar name={e.name} color={e.color} size={28} /><b>{e.name}</b></div></td><td>{ROLE_LABEL[e.role]}</td><td>{e.outlets.map(o => db.outlets.find(x => x.id === o)?.name).join(', ')}</td>
          <td className={'r num ' + (h > 40 ? 'down' : '')}>{h}</td><td className="r num">{picN}</td><td className="mono">{e.phone}</td></tr>; })}</tbody></table></div>
    </section>}
  </>;
}

// ── Templates & limits ──────────────────────────────────────────────────────────────────
function Templates({ c }: { c: Ctx }) {
  const { db, outletId, today } = c;
  const sd = rosterDay(db, outletId, today);
  return <>
    <div className="grid" style={{ ['--min' as string]: '260px' }}>
      {SLOTS.map(s => <section key={s} className="card stack sm">
        <div className="row between"><SlotBadge s={s} /><span className="muted">{slotHours(s)} h</span></div>
        <b className="num" style={{ fontSize: 26 }}>{slotTime(s)}</b>
        <span className="muted" style={{ fontSize: 14 }}>Needs one PIC + {NEED[s].map(r => ROLE_LABEL[r]?.toLowerCase()).join(' + ')}</span>
        <span style={{ fontSize: 14 }}>Today: PIC <b>{nameOf(db, sd?.slots[s].pic) || 'none'}</b> · {onSlot(sd, s).length} people</span>
      </section>)}
    </div>
    <div className="grid" style={{ ['--min' as string]: '320px' }}>
      <PicLimits />
      <section className="card stack sm">
        <h3>Outlet shift rules</h3>
        {[['Drawer mode', 'One session per cashier'], ['Blind cash count', 'On'], ['Variance', `Any variance needs a note · PIC signs up to ${idr(LIMITS.picVariance)} · manager up to ${idr(LIMITS.manager)}`],
          ['Float left for next shift', 'IDR 500,000'], ['Late threshold', '10 minutes'], ['No-show alert', '15 minutes after start, to the manager'], ['Past midnight', 'Close shift belongs to the date it started'],
          ['Opening hours', `${c.outlet?.opens} – ${c.outlet?.closes}`]].map(([k, v]) => <div key={k} className="row between" style={{ fontSize: 14, gap: 16 }}><span className="muted">{k}</span><b style={{ textAlign: 'right' }}>{v}</b></div>)}
        <div className="row between" style={{ fontSize: 14, gap: 16, minHeight: 44 }}><span className="stack" style={{ gap: 2 }}><span className="muted">Require photo at clock in / out</span><span className="faint" style={{ fontSize: 12 }}>{photoRequired(db) ? 'No photo, no clock-in. Stops buddy punching.' : 'Without a camera staff still clock in; the event is marked “no photo”.'}</span></span>
          {c.canEdit ? <Toggle on={photoRequired(db)} label="Require photo at clock in / out" onChange={v => { setSetting(ATTENDANCE_PAGE + ':clock-photo', v, c.meId); toast(v ? 'Photo required at clock in / out' : 'Clocking without a photo allowed, marked for review'); }} /> : <b>{photoRequired(db) ? 'On' : 'Off'}</b>}</div>
        <span className="faint" style={{ fontSize: 12 }}>Shift times and rules are set per outlet by the owner. Shift colors are labels only.</span>
      </section>
    </div>
  </>;
}
function PicLimits() {
  return <section className="card stack sm">
    <h3>PIC limits</h3>
    {[['Discount', `up to ${LIMITS.picDiscountPct}% (cashier ${LIMITS.cashierDiscountPct}%)`], ['Void, refund, cash out', `up to ${idr(LIMITS.pic)} each`], ['Drawer variance, waste, opname', `up to ${idr(LIMITS.picVariance)}`],
      ['Over the PIC limit', `Manager up to ${idr(LIMITS.manager)}`], ['Owner only', 'Prices, publishing, payroll, refunds over IDR 500k']].map(([k, v]) =>
      <div key={k} className="row between" style={{ fontSize: 14, gap: 16 }}><span className="muted">{k}</span><b style={{ textAlign: 'right' }}>{v}</b></div>)}
    <span className="faint" style={{ fontSize: 12 }}>Nobody approves their own request. Each approval asks the approver’s 6-digit PIN.</span>
  </section>;
}

// ── Weekly roster builder & coverage ────────────────────────────────────────────────────
const GRID = { display: 'grid', gridTemplateColumns: '150px repeat(7, minmax(84px, 1fr)) 64px', gap: 4, alignItems: 'stretch', minWidth: 820 } as const;
function Roster({ c }: { c: Ctx }) {
  const { db, outletId, staff, canEdit, meId, now } = c;
  const cycle = (id: string, d: number) => {
    if (!canEdit) return;
    const cur = slotsOf(rosterDay(db, outletId, d), id)[0] ?? 'off';
    const next = CYCLE[(CYCLE.indexOf(cur) + 1) % CYCLE.length];
    assignShift(outletId, d, id, next, meId);
  };
  if (!db.roster.some(r => r.outletId === outletId)) return <Empty icon="calendar" title="No roster for this outlet yet" />;
  const gaps = Array.from({ length: 7 }, (_, d) => SLOTS.filter(s => missing(db, outletId, d, s).length)).flat().length;
  return <>
    <div className={'banner ' + (gaps ? 'b-warning' : 'b-success')}>{canEdit ? 'Tap a cell to cycle a person through Morning, Afternoon, Close and Off. ' : ''}{gaps ? `${gaps} shifts are missing a PIC or a role.` : 'Every shift has a PIC and the roles it needs.'} Set the PIC per shift in Assign PIC.</div>
    <section className="card" style={{ overflowX: 'auto', padding: 12 }}>
      <div style={GRID}>
        <span className="cap" style={{ alignSelf: 'center' }}>Staff</span>{DAY_NAMES.map((_, d) => <span key={d} className="cap" style={{ textAlign: 'center', alignSelf: 'center', color: d === c.today ? 'var(--role-fg)' : undefined }}>{dayLabel(d, now)}</span>)}<span className="cap" style={{ textAlign: 'right', alignSelf: 'center' }}>Hours</span>
        {staff.map(e => { const h = hoursOf(db, outletId, e.id); return <div key={e.id} style={{ display: 'contents' }}>
          <span className="row" style={{ minHeight: 48 }}><Avatar name={e.name} color={e.color} size={28} /><span className="stack" style={{ gap: 0 }}><b style={{ fontSize: 14 }}>{e.name}</b><span className="faint" style={{ fontSize: 12 }}>{ROLE_LABEL[e.role]}</span></span></span>
          {DAY_NAMES.map((_, d) => { const sd = rosterDay(db, outletId, d), ss = slotsOf(sd, e.id); const s = ss[0];
            return <button key={d} type="button" onClick={() => cycle(e.id, d)} disabled={!canEdit} aria-label={`${e.name} ${DAY_NAMES[d]}: ${ss.map(slotLabel).join(' + ') || 'Off'}`}
              className={s ? 'badge b-' + SLOT_TONE[s] : 'badge'} style={{ height: 48, borderRadius: 10, border: 0, justifyContent: 'center', cursor: canEdit ? 'pointer' : 'default', whiteSpace: 'normal', textAlign: 'center', lineHeight: 1.15, opacity: 1 }}>
              {ss.length ? ss.map(x => slotLabel(x) + (sd?.slots[x].pic === e.id ? ' · PIC' : '')).join(' + ') : 'Off'}</button>; })}
          <b className={'num ' + (h > 40 ? 'down' : '')} style={{ textAlign: 'right', alignSelf: 'center' }}>{h}</b>
        </div>; })}
        {SLOTS.map(s => <div key={'p' + s} style={{ display: 'contents' }}>
          <span className="row" style={{ fontSize: 13 }}><SlotBadge s={s} /> PIC</span>
          {DAY_NAMES.map((_, d) => { const p = rosterDay(db, outletId, d)?.slots[s].pic; return <span key={d} className={'badge ' + (p ? 'b-info' : 'b-danger')} style={{ height: 36, justifyContent: 'center', borderRadius: 10 }}>{p ? nameOf(db, p) : 'Pick PIC'}</span>; })}<span />
        </div>)}
        {SLOTS.map(s => <div key={'c' + s} style={{ display: 'contents' }}>
          <span className="faint" style={{ fontSize: 12, alignSelf: 'center' }}>{slotLabel(s)} coverage</span>
          {DAY_NAMES.map((_, d) => { const m = missing(db, outletId, d, s); return <span key={d} className={m.length ? 'down' : 'up'} style={{ fontSize: 12, fontWeight: 600, textAlign: 'center', alignSelf: 'center' }}>{m.length ? 'No ' + m.join(', ') : onSlot(rosterDay(db, outletId, d), s).length + ' staff'}</span>; })}<span />
        </div>)}
      </div>
    </section>
  </>;
}

// ── Assign PIC per shift ────────────────────────────────────────────────────────────────
function AssignPic({ c }: { c: Ctx }) {
  const { db, outletId, canEdit, meId, now } = c;
  const cands = picCandidates(db, outletId);
  return <>
    <div className="banner b-info">Exactly one PIC per shift: the person in charge answers for the shift and approves within the PIC limits. A new PIC replaces the old one, who stays on the crew. With no PIC, approvals go to the manager.</div>
    <section className="card" style={{ overflowX: 'auto', padding: 12 }}>
      <div style={{ ...GRID, gridTemplateColumns: '130px repeat(7, minmax(110px, 1fr))', minWidth: 900 }}>
        <span className="cap">Shift</span>{DAY_NAMES.map((_, d) => <span key={d} className="cap" style={{ textAlign: 'center' }}>{dayLabel(d, now)}</span>)}
        {SLOTS.map(s => <div key={s} style={{ display: 'contents' }}>
          <span className="stack" style={{ gap: 2, justifyContent: 'center' }}><SlotBadge s={s} /><span className="faint" style={{ fontSize: 12 }}>{slotTime(s)}</span></span>
          {DAY_NAMES.map((_, d) => { const p = rosterDay(db, outletId, d)?.slots[s].pic ?? ''; return <select key={d} className={'input' + (p ? '' : ' bad')} style={{ height: 48, fontSize: 14, padding: '0 28px 0 10px' }} disabled={!canEdit} value={p}
            aria-label={`PIC ${slotLabel(s)} ${DAY_NAMES[d]}`} onChange={e => { assignPic(outletId, d, s, e.target.value, meId); toast(`${nameOf(db, e.target.value)} is PIC · ${DAY_NAMES[d]} ${slotLabel(s)}`); }}>
            {!p && <option value="">Pick PIC</option>}{cands.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select>; })}
        </div>)}
      </div>
    </section>
    {cands.length === 0 && <div className="banner b-danger">No PIC or manager works at this outlet. Add one in Team & roles first.</div>}
    <div className="grid" style={{ ['--min' as string]: '320px' }}><PicLimits /></div>
  </>;
}

// ── Publish roster to WhatsApp ──────────────────────────────────────────────────────────
function message(db: DB, outletId: string, e: Employee, now: number) {
  const outlet = db.outlets.find(o => o.id === outletId)?.name;
  const days = DAY_NAMES.map((_, d) => { const sd = rosterDay(db, outletId, d); const ss = slotsOf(sd, e.id); return ss.length ? `${dayLabel(d, now)}: ${ss.map(s => `${slotLabel(s)} ${slotTime(s)}${sd?.slots[s].pic === e.id ? ' (PIC)' : ''}`).join(', ')}` : null; }).filter(Boolean);
  return `Hi ${e.name}, your shifts at Kopi Biru ${outlet} for ${dayLabel(0, now)} – ${dayLabel(6, now)}:\n${days.length ? days.join('\n') : 'No shifts this week.'}\nTotal ${hoursOf(db, outletId, e.id)} h. Reply SWAP to ask for a swap.`;
}
function Publish({ c }: { c: Ctx }) {
  const { db, outletId, staff, canEdit, meId, now, week } = c;
  const [who, setWho] = useState(staff[0]?.id ?? '');
  const sel = staff.find(e => e.id === who) ?? staff[0];
  const gaps = Array.from({ length: 7 }, (_, d) => SLOTS.map(s => ({ d, s, m: missing(db, outletId, d, s) }))).flat().filter(x => x.m.length);
  const last = db.records.roster_publish?.find(r => r.id === `${outletId}|${week}`);
  const sent = db.messages.filter(m => m.template === 'roster_week').slice(0, 8);
  const go = () => { publishRoster(outletId, `${dayLabel(0, now)} – ${dayLabel(6, now)}`, staff.map(e => ({ employeeId: e.id, phone: e.phone, text: message(db, outletId, e, now) })), meId); toast(`Roster sent to ${staff.length} people on WhatsApp`); };
  if (!staff.length) return <Empty icon="users" title="No staff at this outlet" />;
  return <div className="grid" style={{ ['--min' as string]: '340px' }}>
    <section className="card stack">
      <h3>Before you send</h3>
      {gaps.length ? <div className="banner b-warning">{gaps.length} shifts have gaps: {gaps.slice(0, 4).map(g => `${DAY_NAMES[g.d]} ${slotLabel(g.s)} (no ${g.m.join(', ')})`).join(' · ')}{gaps.length > 4 ? ' …' : ''}</div> : <div className="banner b-success">Every shift has a PIC and the roles it needs.</div>}
      <div className="stack sm">{staff.map(e => <button key={e.id} className="nav-i" onClick={() => setWho(e.id)} aria-current={e.id === sel?.id ? 'page' : undefined} style={{ border: 0, background: e.id === sel?.id ? 'var(--role-soft)' : 'none', cursor: 'pointer', textAlign: 'left', minHeight: 44 }}>
        <Avatar name={e.name} color={e.color} size={28} /><span className="grow">{e.name} · <span className="muted">{ROLE_LABEL[e.role]}</span></span><span className="mono faint">{e.phone}</span></button>)}</div>
      {last && <span className="muted" style={{ fontSize: 13 }}>Last sent {hhmm(last.at)} by {nameOf(db, last.c)} to {last.d} people. Sending again replaces it.</span>}
      {canEdit ? <button className="btn btn-primary btn-pos" onClick={go}><Icon name="send" />{last ? 'Send updated roster' : 'Publish to WhatsApp'}</button> : <Badge>The manager publishes the roster</Badge>}
    </section>
    <section className="card stack">
      <h3>Message preview · {sel?.name}</h3>
      <div className="sunken" style={{ maxWidth: 380 }}><div style={{ background: 'var(--success-soft)', color: 'var(--fg-1)', borderRadius: '16px 16px 4px 16px', padding: '12px 14px', whiteSpace: 'pre-wrap', fontSize: 14 }}>{sel && message(db, outletId, sel, now)}</div>
        <span className="faint" style={{ fontSize: 12 }}>WhatsApp Business · template roster_week</span></div>
      <h3>Sent</h3>
      {sent.length === 0 ? <p className="muted">Nothing sent yet this week.</p> : sent.map(m => <div key={m.id} className="row" style={{ fontSize: 14 }}><span className="mono grow">{m.to}</span><span className="faint">{hhmm(m.at)}</span><Status s={m.status} /></div>)}
    </section>
  </div>;
}

// ── Schedules & attendance, clock in/out, swaps & no-shows ──────────────────────────────
function Attendance({ c }: { c: Ctx }) {
  const { db, outletId, now, today, me, meId, canEdit, staff, user } = c;
  const dz = useDecide();
  const sd = rosterDay(db, outletId, today);
  const mine = me && me.outlets.includes(outletId) ? clockState(db, me.id, outletId) : null;
  const selfie = useSelfie();
  const doClock = (k: 'in' | 'out' | 'break', msg: string) => k === 'break' ? (clock(meId, outletId, k), toast(msg))
    : selfie.ask({ who: me?.name ?? '', kind: k, label: mine?.state === 'break' ? 'End break' : undefined, onShot: shot => toast(clock(meId, outletId, k, shot) ?? msg) });
  const rows = SLOTS.flatMap(s => onSlot(sd, s).map(id => ({ s, id, e: emp(db, id), a: attendance(db, id, outletId, s, now) })));
  const swaps = db.approvals.filter(a => a.outletId === outletId && a.type === 'leave' && (a.payload as { kind?: string } | undefined)?.kind === 'swap').slice(0, 12);
  const myShifts = useMemo(() => me ? DAY_NAMES.flatMap((_, d) => slotsOf(rosterDay(db, outletId, d), me.id).map(s => ({ d, s }))).filter(x => x.d >= today) : [], [db, outletId, me, today]);
  const [sw, setSw] = useState(''), [to, setTo] = useState(''), [note, setNote] = useState(''), [rep, setRep] = useState<Record<string, string>>({});
  const ask = () => { const [d, s] = sw.split('|'); const day = Number(d), slot = s as Slot;
    requestSwap({ outletId, day, slot, from: meId, to, title: `Swap · ${dayLabel(day, now)} ${slotLabel(slot)} · ${nameOf(db, meId)} → ${nameOf(db, to)}`, note: note.trim() || 'Swap request' }, meId); toast('Swap sent to the manager'); setSw(''); setTo(''); setNote(''); };
  return <>
    {dz.sheet}{selfie.sheet}
    <div className="grid" style={{ ['--min' as string]: '320px' }}>
      {me && <section className="card stack">
        <div className="row"><Avatar name={me.name} color={me.color} /><span className="grow"><b>{me.name}</b><br /><span className="muted" style={{ fontSize: 13 }}>{mine?.state === 'in' ? 'Clocked in since ' + hhmm(mine.at!) : mine?.state === 'break' ? 'On break since ' + hhmm(mine.at!) : mine?.state === 'out' ? 'Clocked out ' + hhmm(mine.at!) : 'Not clocked in today'}</span></span>
          {mine && <b className="num">{hm(workedMin(mine.events, now))}</b>}</div>
        <div className="row wrap">
          {(!mine || mine.state === 'none' || mine.state === 'out') && <button className="btn btn-primary btn-pos" onClick={() => doClock('in', 'Clocked in · have a good shift')}><Icon name="log-in" />Clock in</button>}
          {mine?.state === 'in' && <><button className="btn btn-pos" onClick={() => doClock('break', 'Break started')}><Icon name="coffee" />Start break</button><button className="btn btn-pos" onClick={() => doClock('out', 'Clocked out')}><Icon name="log-out" />Clock out</button></>}
          {mine?.state === 'break' && <button className="btn btn-primary btn-pos" onClick={() => doClock('in', 'Back from break')}>End break</button>}
        </div>
        <span className="cap">My week</span>
        <div className="row wrap">{DAY_NAMES.map((_, d) => { const ss = slotsOf(rosterDay(db, outletId, d), me.id); return <span key={d} className={'badge' + (ss[0] ? ' b-' + SLOT_TONE[ss[0]] : '')} style={{ outline: d === today ? '2px solid var(--fg-1)' : undefined }}>{DAY_NAMES[d]} · {ss.length ? ss.map(slotLabel).join(' + ') : 'Off'}</span>; })}</div>
      </section>}
      {me && <section className="card stack">
        <h3>Ask for a swap</h3>
        {myShifts.length === 0 ? <p className="muted">You have no more shifts this week.</p> : <>
          <Field label="My shift"><select className="input" value={sw} onChange={e => setSw(e.target.value)}><option value="">Pick a shift</option>{myShifts.map(x => <option key={x.d + x.s} value={`${x.d}|${x.s}`}>{dayLabel(x.d, now)} · {slotLabel(x.s)} {slotTime(x.s)}</option>)}</select></Field>
          <Field label="Swap with"><select className="input" value={to} onChange={e => setTo(e.target.value)}><option value="">Pick a colleague</option>{staff.filter(e => e.id !== meId).map(e => <option key={e.id} value={e.id}>{e.name} · {ROLE_LABEL[e.role]}</option>)}</select></Field>
          <Field label="Note" optional><input className="input" value={note} onChange={e => setNote(e.target.value)} placeholder="Family event, agreed with Tono" /></Field>
          <button className="btn btn-primary btn-pos" disabled={!sw || !to} onClick={ask}>Send swap request</button>
        </>}
      </section>}
    </div>
    <section className="card flat">
      <div className="row between" style={{ padding: 16 }}><h3>Today · {new Date(now).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })}</h3><span className="muted">Late after 10 min · no-show after 15 min</span></div>
      {rows.length === 0 ? <Empty icon="calendar-x" title="Nobody rostered today" /> : <div className="scroll-x"><table className="table">
        <thead><tr><th>Person</th><th>Shift</th><th>Clock in</th><th>Status</th><th className="r">Worked</th>{canEdit && <th />}</tr></thead>
        <tbody>{rows.map(({ s, id, e, a }) => { const started = now >= slotStart(s, now); return <tr key={s + id}>
          <td><div className="row"><Avatar name={e?.name ?? '?'} color={e?.color} size={28} /><b>{e?.name}</b>{sd?.slots[s].pic === id && <Badge tone="info">PIC</Badge>}</div></td>
          <td><SlotBadge s={s} /> <span className="faint" style={{ fontSize: 12 }}>{slotTime(s)}</span></td>
          <td>{a.firstIn ? <div className="row" style={{ gap: 8 }}>{a.events.filter(x => x.kind !== 'break').slice(-2).map(x => <ClockPhoto key={x.id} c={x} />)}<span>{hhmm(a.firstIn)}</span></div> : '—'}</td>
          <td>{a.flag === 'no_show' ? <Badge tone="danger" dot>No-show</Badge> : a.flag === 'late' ? <Badge tone="warning" dot>Late {a.lateMin} min</Badge> : a.firstIn ? <Badge tone="success" dot>{a.state === 'break' ? 'On break' : a.state === 'out' ? 'Done' : 'On time'}</Badge> : <Badge>{started ? 'Not in yet' : 'Starts ' + slotTime(s).split('–')[0]}</Badge>}</td>
          <td className="r num">{a.firstIn ? hm(workedMin(a.events, now)) : '—'}</td>
          {canEdit && <td>{a.flag === 'no_show' && <div className="row">
            <button className="btn btn-sm" onClick={() => { alertNoShow(outletId, e?.name ?? id, slotLabel(s), meId); toast('Alert sent to manager and PIC'); }}>Alert</button>
            <select className="input" style={{ height: 34, width: 130, fontSize: 13 }} value={rep[s + id] ?? ''} aria-label="Cover with" onChange={ev => { const nid = ev.target.value; setRep(r => ({ ...r, [s + id]: nid }));
              if (nid) { assignShift(outletId, today, id, 'off', meId); assignShift(outletId, today, nid, s, meId); if (sd?.slots[s].pic === id) assignPic(outletId, today, s, nid, meId); toast(`${nameOf(db, nid)} covers ${slotLabel(s)}`); } }}>
              <option value="">Cover with…</option>{staff.filter(x => x.id !== id && !onSlot(sd, s).includes(x.id)).map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></div>}</td>}
        </tr>; })}</tbody></table></div>}
    </section>
    <section className="stack">
      <h3>Swap requests</h3>
      {swaps.length === 0 ? <p className="muted">No swap requests this week.</p> : swaps.map(a => { const applied = !!(a.payload as { applied?: boolean })?.applied; return <ApprovalCard key={a.id} a={a}>
        {a.status === 'waiting' && canEdit && a.requestedBy !== meId ? <><button className="btn btn-success" onClick={() => dz.run(a, 'approved', () => { applySwap(a.id, meId); })}>Approve swap</button><button className="btn btn-danger" onClick={() => dz.run(a, 'rejected')}>Reject</button></>
          : a.status === 'waiting' ? <Badge tone="warning">Waiting for {user.role === 'manager' ? 'another manager or the owner' : 'the manager'}</Badge>
          : a.status === 'approved' && !applied && canEdit ? <button className="btn" onClick={() => { applySwap(a.id, meId); toast('Roster updated'); }}>Apply to roster</button>
          : a.status === 'approved' ? <Badge tone="success">Roster updated</Badge> : null}
      </ApprovalCard>; })}
    </section>
  </>;
}
