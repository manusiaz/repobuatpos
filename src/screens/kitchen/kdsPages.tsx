'use client';
// The KDS pages beyond the live ticket views: station, expo, all-day, completed / recall, 86, detail, runner, clock,
// recipes, targets, performance, settings. Same dark tokens, 15px minimum, no prices.
import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ago, hhmm, toast, Toggle } from '../../ui/kit.tsx';
import { LineChart } from '../../ui/Chart.tsx';
import { ClockPhoto, useSelfie } from '../../ui/Selfie.tsx';
import { clock, recall, setSetting, toggle86 } from '../../data/actions.ts';
import { ask86, bumpStation, callRunner } from '../../data/actions/kds.ts';
import { level } from '../../domain/stock.ts';
import type { Order } from '../../data/schema.ts';
import { Caught, kdsPath, SET, TGT, type Kctx, type View } from '../kds.tsx';
import { allDay, CHANNEL, completedToday, empName, isHistory, isOnline, linesAt, mmss, openLinesAt, prepStats, startOfDay, STATIONS, ticketLabel, type Station } from './model.ts';
import { chime, fs, KBtn, Pill, Ticket } from './Ticket.tsx';
import catalog from '../../system/catalog.json' with { type: 'json' };

const H = ({ children, sub }: { children: ReactNode; sub?: ReactNode }) => <div className="stack sm" style={{ marginBottom: 12 }}><b style={{ fontSize: fs(22) }}>{children}</b>{sub && <span style={{ fontSize: fs(15), color: 'var(--fg-2)', maxWidth: 820 }}>{sub}</span>}</div>;
const Box = ({ children, style }: { children: ReactNode; style?: CSSProperties }) => <div style={{ padding: 16, borderRadius: 18, background: 'var(--bg-surface)', border: '1px solid var(--border)', ...style }}>{children}</div>;
const Stat = ({ l, v }: { l: string; v: ReactNode }) => <Box><span style={{ fontSize: fs(15), color: 'var(--fg-2)' }}>{l}</span><br /><b style={{ fontSize: fs(28) }}>{v}</b></Box>;
const Grid = ({ min = 240, children }: { min?: number; children: ReactNode }) => <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill,minmax(min(100%,${min}px),1fr))`, gap: 10 }}>{children}</div>;
const stationName = (s: Station | 'all') => STATIONS.find(x => x[0] === s)![1];

export function KdsPage({ view, k }: { view: View; k: Kctx }) {
  switch (view) {
    case 'station': return <StationPick k={k} />;
    case 'expo': return <Expo k={k} />;
    case 'allday': return <AllDay k={k} />;
    case 'done': return <Done k={k} recallOnly={false} />;
    case 'recall': return <Done k={k} recallOnly />;
    case '86': return <SoldOut k={k} />;
    case 'detail': return <Detail k={k} />;
    case 'runner': return <Runner k={k} />;
    case 'clock': return <Clock k={k} />;
    case 'recipes': return <Recipes k={k} />;
    case 'targets': return <Targets k={k} />;
    case 'perf': return <Perf k={k} />;
    case 'settings': return <Settings k={k} />;
    default: return null;
  }
}

function StationPick({ k }: { k: Kctx }) {
  return <div>
    <H sub="Pick what this screen cooks. Each screen keeps its own station; tickets split by the station set on each menu category.">Station filter</H>
    <Grid min={220}>{STATIONS.map(([s, l]) => { const t = k.tickets.filter(o => openLinesAt(o, s).length), items = t.reduce((a, o) => a + openLinesAt(o, s).reduce((b, x) => b + x.qty, 0), 0);
      return <button key={s} type="button" aria-pressed={k.st === s} onClick={() => { k.setSt(s); k.go(kdsPath('tickets')); }} style={{ minHeight: 140, borderRadius: 18, border: `3px solid ${k.st === s ? 'var(--accent)' : 'var(--border)'}`, background: 'var(--bg-surface)', color: 'var(--fg-1)', cursor: 'pointer', textAlign: 'left', padding: 18, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <b style={{ fontSize: fs(26) }}>{l}</b><span style={{ fontSize: fs(16), color: 'var(--fg-2)' }}>{t.length} tickets · {items} items open</span>{k.st === s && <Pill bg="var(--accent)" fg="#fff">This screen</Pill>}</button>; })}</Grid>
  </div>;
}

function Expo({ k }: { k: Kctx }) {
  const ready = k.db.orders.filter(o => o.outletId === k.outletId && o.status === 'ready' && !isHistory(o));
  const list = [...k.tickets, ...ready].sort((a, b) => a.createdAt - b.createdAt);
  const canBump = k.can('See & bump tickets') !== 'n';
  return <div>
    <H sub="The pass sees the whole order across stations. Complete it when every plate is up, then send a runner.">Expo / pass</H>
    {!list.length ? <Caught /> : <Grid min={280}>{list.map(o => { const done = o.status === 'ready';
      return <Ticket key={o.id} o={o} st="all" now={k.now} cfg={k.cfg} meta={`${k.meta(o)} · ${linesAt(o, 'all').filter(l => l.kds === 'done').length}/${linesAt(o, 'all').length} up`} recalled={k.recalled.has(o.id)} onOpen={() => k.open(o.id)}
        action={!canBump ? null : !done ? { label: 'Complete order', tone: 'go', run: () => bumpStation(o.id, 'all', k.by) }
          : isOnline(o) ? null : { label: 'Call runner', tone: 'accent', run: () => { callRunner(k.outletId, `${ticketLabel(o)} ready at the pass · ${o.lines.length} items`, k.by); toast('Runner called'); } }} />; })}</Grid>}
  </div>;
}

function AllDay({ k }: { k: Kctx }) {
  const sts = k.st === 'all' ? STATIONS.filter(s => s[0] !== 'all').map(s => s[0]) : [k.st];
  return <div>
    <H sub="Everything still to make, summed across open tickets. Cook in batches from here.">All-day item count</H>
    <div className="stack lg">{sts.map(s => { const ad = allDay(k.tickets, s);
      return <section key={s}><b style={{ fontSize: fs(17), color: 'var(--fg-2)' }}>{stationName(s).toUpperCase()}</b>
        {!ad.length ? <p style={{ fontSize: fs(15), color: 'var(--fg-3)', padding: '10px 0' }}>Nothing open</p>
          : <div style={{ marginTop: 8 }}><Grid min={220}>{ad.map(([n, q]) => <Box key={n} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}><span style={{ fontSize: fs(18), fontWeight: 700 }}>{n}</span><b style={{ fontSize: fs(32), color: 'var(--accent-fg)' }}>{q}</b></Box>)}</Grid></div>}
      </section>; })}</div>
  </div>;
}

function Done({ k, recallOnly }: { k: Kctx; recallOnly: boolean }) {
  const all = completedToday(k.db, k.outletId).filter(x => k.st === 'all' || linesAt(x.o, k.st).length);
  const list = recallOnly ? all.filter(x => x.live && k.now - x.at < 2 * 3600e3) : all.slice(0, 80);
  const canRecall = k.can('See & bump tickets') !== 'n';
  return <div>
    <H sub={recallOnly ? 'Bumped by mistake? Recall brings the ticket back to the station with every item cooking again.' : `${all.length} orders finished today at this outlet. Tickets bumped on this screen can be recalled.`}>{recallOnly ? 'Recall bumped order' : 'Completed orders'}</H>
    {!list.length && <Caught>{recallOnly ? 'Nothing bumped in the last 2 hours.' : 'Nothing bumped yet this shift.'}</Caught>}
    <div className="stack sm">{list.map(({ o, at, live }) =>
      <div key={o.id} className="row wrap" style={{ minHeight: 72, padding: '12px 16px', borderRadius: 16, background: 'var(--bg-surface)', border: '1px solid var(--border)', gap: 14 }}>
        <b style={{ fontSize: fs(22), minWidth: 90 }}>{ticketLabel(o)}</b>
        <span className="grow" style={{ fontSize: fs(15), color: 'var(--fg-2)', minWidth: 180 }}>{linesAt(o, k.st).map(l => `${l.qty}× ${l.name}`).join(' · ')}</span>
        <span style={{ fontSize: fs(15), color: 'var(--fg-2)' }}>{live ? `Bumped ${hhmm(at)} · prep ${mmss(at - o.createdAt)}` : `Closed ${hhmm(at)}`}</span>
        {live && canRecall && <KBtn tone="accent" onClick={() => { recall(o.id, k.by); toast(`${ticketLabel(o)} recalled`); k.go(kdsPath('tickets')); }}>Recall</KBtn>}
      </div>)}</div>
  </div>;
}

function SoldOut({ k }: { k: Kctx }) {
  const outlet = k.db.outlets.find(o => o.id === k.outletId)?.name;
  const code = k.can('Mark item sold out');
  const rows = k.db.outletProducts.filter(x => x.outletId === k.outletId && !x.hidden).map(x => ({ x, p: k.db.products.find(p => p.id === x.productId)! }))
    .filter(r => r.p && r.p.status === 'live').map(r => ({ ...r, st: k.db.categories.find(c => c.id === r.p.categoryId)?.station ?? 'bar' }))
    .filter(r => k.st === 'all' || r.st === k.st).sort((a, b) => Number(b.x.is86) - Number(a.x.is86) || a.p.name.localeCompare(b.p.name));
  const waiting = new Set(k.db.approvals.filter(a => a.status === 'waiting' && (a.payload as { kds86?: string } | undefined)?.kds86).map(a => a.subjectId));
  return <div>
    <H sub={`Sold out is per outlet. Marking it here hides it at ${outlet} only: POS, QR menu, kiosk, waiter phone and delivery apps. Other outlets keep selling.${code === 'a' ? ' Your role needs PIC approval for this.' : ''}`}>86 list · tap to mark sold out</H>
    <Grid min={220}>{rows.map(({ x, p, st }) => <button key={p.id} type="button" disabled={code === 'n' || waiting.has(p.id)} aria-pressed={x.is86}
      onClick={() => { if (code === 'a') { ask86(k.outletId, p.id, p.name, k.by); toast('Sent to the PIC for approval'); return; } toggle86(k.outletId, p.id, k.by); toast(x.is86 ? `${p.name} back on the menu` : `${p.name} sold out at ${outlet} · POS, QR menu, kiosk, delivery apps`); }}
      style={{ minHeight: 84, borderRadius: 16, border: `2px solid ${x.is86 ? 'var(--danger)' : code === 'a' ? 'var(--warning)' : 'var(--border)'}`, background: x.is86 ? 'var(--danger-soft)' : 'var(--bg-surface)', color: 'var(--fg-1)', cursor: 'pointer', textAlign: 'left', padding: '10px 16px', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 4 }}>
      <b style={{ fontSize: fs(17) }}>{p.name}</b>
      <span style={{ fontSize: fs(15), fontWeight: 700, color: x.is86 ? 'var(--danger-fg)' : 'var(--success-fg)' }}>{waiting.has(p.id) ? 'Waiting for PIC' : x.is86 ? 'Sold out · tap to restock' : 'Available'} <span style={{ color: 'var(--fg-3)', fontWeight: 500 }}>· {st}</span></span>
    </button>)}</Grid>
  </div>;
}

function Detail({ k }: { k: Kctx }) {
  const q = useSearchParams();
  const id = q?.get('o');
  const o = k.db.orders.find(x => x.id === id);
  if (!o) {
    const recent = [...k.tickets, ...completedToday(k.db, k.outletId).filter(x => x.live).map(x => x.o)].slice(0, 40);
    return <div><H sub="Tap a ticket header anywhere on the KDS to open it here.">Order detail & notes</H>
      {!recent.length ? <Caught /> : <Grid min={200}>{recent.map(r => <KBtn key={r.id} big onClick={() => k.open(r.id)} style={{ justifyContent: 'space-between' }}><span>{ticketLabel(r)}</span><span style={{ color: 'var(--fg-2)', fontWeight: 600 }}>{mmss(k.now - r.createdAt)}</span></KBtn>)}</Grid>}</div>;
  }
  const done = linesAt(o, 'all').every(l => l.kds === 'done');
  const trail = k.db.audit.filter(a => a.subject === o.id).slice(0, 20);
  const canBump = k.can('See & bump tickets') !== 'n';
  return <div className="stack lg">
    <div className="row wrap between"><H sub={`${k.meta(o)} · placed ${hhmm(o.createdAt)}`}>{ticketLabel(o)} · <span className="mono" style={{ fontSize: fs(18) }}>{o.no}</span></H><KBtn onClick={() => k.go(kdsPath('tickets'))}>Back to tickets</KBtn></div>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,320px),1fr))', gap: 12, alignItems: 'start' }}>
      <Ticket o={o} st="all" now={k.now} cfg={k.cfg} meta={k.meta(o)} recalled={k.recalled.has(o.id)}
        action={!canBump ? null : done ? (isHistory(o) ? null : { label: 'Recall', tone: 'accent', run: () => { recall(o.id, k.by); toast('Recalled'); } }) : { label: 'Bump whole order', tone: 'go', run: () => bumpStation(o.id, 'all', k.by) }} />
      <div className="stack">
        <Box><b style={{ fontSize: fs(17) }}>Order</b>
          <div className="stack sm" style={{ marginTop: 8, fontSize: fs(15) }}>
            <span>Channel: <b>{CHANNEL[o.source].name}</b>{o.tier && <> · {o.tier}</>}</span>
            <span>{o.type === 'delivery' ? 'Delivery' : o.type === 'take' ? 'Takeaway' : `Dine-in · ${o.table ?? 'no table'} · ${o.guests} pax`}</span>
            {o.readyBy && <span>Ready by <b>{hhmm(o.readyBy)}</b></span>}
            <span>Taken by {empName(k.db, o.cashierId) ?? (o.source === 'qr' ? 'guest (QR)' : CHANNEL[o.source].name)}</span>
            <span>Notes: {[o.note, ...o.lines.filter(l => l.note).map(l => `${l.name}: ${l.note}`)].filter(Boolean).join(' · ') || 'none'}</span>
          </div></Box>
        <Box><b style={{ fontSize: fs(17) }}>Timeline</b>
          <div className="stack sm" style={{ marginTop: 8 }}>{trail.map(a => <span key={a.id} style={{ fontSize: fs(15) }}><b>{hhmm(a.at)}</b> · {a.action.replace(/[._]/g, ' ')} · <span style={{ color: 'var(--fg-2)' }}>{empName(k.db, a.actor) ?? a.actor}</span></span>)}
            {!trail.length && <span style={{ fontSize: fs(15), color: 'var(--fg-3)' }}>No events on this device yet.</span>}</div></Box>
        {canBump && <KBtn onClick={() => { callRunner(k.outletId, `${ticketLabel(o)}: runner to the pass`, k.by); toast('Runner called'); }}>Call runner for this order</KBtn>}
      </div>
    </div>
  </div>;
}

function Runner({ k }: { k: Kctx }) {
  const outlet = k.db.outlets.find(o => o.id === k.outletId)?.name;
  const ready = k.db.orders.filter(o => o.outletId === k.outletId && o.status === 'ready' && !isOnline(o) && !isHistory(o));
  const calls = k.db.notices.filter(n => n.alert === 'Runner call' && n.outletId === k.outletId).slice(0, 12);
  const call = (t: string) => { callRunner(k.outletId, t, k.by); toast('Called · shows on the waiter phone'); };
  return <div className="stack lg">
    <H sub="Sends a call to every waiter phone and the shift lead at this outlet.">Call runner / waiter</H>
    <Grid min={240}>
      <KBtn big tone="accent" onClick={() => call(`${outlet} kitchen: runner to the pass`)}>Runner to the pass</KBtn>
      <KBtn big onClick={() => call(`${outlet} kitchen: waiter to the kitchen`)}>Waiter to the kitchen</KBtn>
      {ready.map(o => <KBtn key={o.id} big tone="go" onClick={() => call(`${ticketLabel(o)} ready at the pass · ${o.lines.length} items`)}>Call for {ticketLabel(o)}</KBtn>)}
    </Grid>
    <Box><b style={{ fontSize: fs(17) }}>Recent calls</b>
      <div className="stack sm" style={{ marginTop: 8 }}>{!calls.length && <span style={{ fontSize: fs(15), color: 'var(--fg-3)' }}>No calls yet this shift.</span>}
        {calls.map(n => <div key={n.id} className="row between wrap" style={{ fontSize: fs(15), padding: '8px 0', borderTop: '1px solid var(--border)' }}><span>{n.text}</span><span style={{ color: n.read ? 'var(--success-fg)' : 'var(--warning-fg)', fontWeight: 700 }}>{n.read ? 'On the way' : 'Waiting'} · {ago(n.at, k.now)}</span></div>)}</div></Box>
  </div>;
}

export function ClockCard({ db, outletId, by, now, big = true }: { db: Kctx['db']; outletId: string; by: string; now: number; big?: boolean }) {
  const mine = db.clock.filter(c => c.employeeId === by && c.at >= startOfDay(now));
  const last = mine[mine.length - 1];
  const inSince = last && last.kind !== 'out' ? mine.filter(c => c.kind === 'in').pop()?.at : null;
  const selfie = useSelfie();
  const punch = (kind: 'in' | 'out', msg: string) => selfie.ask({ who: empName(db, by) ?? by, kind, label: kind === 'in' && last?.kind === 'break' ? 'End break' : undefined, onShot: shot => toast(clock(by, outletId, kind, shot) ?? msg) });
  return <div className="stack" style={{ padding: 18, borderRadius: 20, background: 'var(--bg-raised)', border: '1px solid var(--border)' }}>
    <span style={{ fontSize: big ? fs(15) : 14, color: 'var(--fg-2)' }}>{empName(db, by) ?? by} · {last?.kind === 'break' ? 'On break since' : inSince ? 'Clocked in since' : 'Not clocked in'}</span>
    <b style={{ fontSize: big ? fs(32) : 28 }}>{last?.kind === 'break' ? hhmm(last.at) : inSince ? hhmm(inSince) : '—'}</b>
    <div className="row wrap">
      {!inSince || last?.kind === 'break' ? <button type="button" className="btn btn-success" style={{ height: big ? 64 : 56, flex: 1, fontSize: 16 }} onClick={() => punch('in', 'Clocked in')}>{last?.kind === 'break' ? 'End break' : 'Clock in'}</button>
        : <><button type="button" className="btn" style={{ height: big ? 64 : 56, flex: 1, fontSize: 16 }} onClick={() => { clock(by, outletId, 'break'); toast('Break started'); }}>Start break</button>
          <button type="button" className="btn btn-danger" style={{ height: big ? 64 : 56, flex: 1, fontSize: 16 }} onClick={() => punch('out', 'Clocked out')}>Clock out</button></>}
    </div>
    {mine.length > 0 && <div className="row wrap" style={{ fontSize: big ? fs(15) : 13, color: 'var(--fg-2)' }}>Today: {mine.map(c => <span key={c.id} className="row" style={{ gap: 6 }}><ClockPhoto c={c} />{c.kind} {hhmm(c.at)}</span>)}</div>}
    {selfie.sheet}
  </div>;
}

function Clock({ k }: { k: Kctx }) {
  const crew = k.db.employees.filter(e => e.outlets.includes(k.outletId) && ['kitchen', 'waiter', 'cashier', 'pic'].includes(e.role));
  const status = (id: string) => { const c = k.db.clock.filter(x => x.employeeId === id && x.at >= startOfDay(k.now)).pop(); return !c ? 'Not in' : c.kind === 'in' ? `In since ${hhmm(c.at)}` : c.kind === 'break' ? `Break since ${hhmm(c.at)}` : `Out at ${hhmm(c.at)}`; };
  return <div className="stack lg" style={{ maxWidth: 900 }}>
    <H sub="Clock in on the kitchen screen at the start of your shift. Times go to Shifts and payroll.">Clock in / out</H>
    <ClockCard db={k.db} outletId={k.outletId} by={k.by} now={k.now} />
    <Box><b style={{ fontSize: fs(17) }}>Crew today</b>
      <div className="stack sm" style={{ marginTop: 8 }}>{crew.map(e => <div key={e.id} className="row between" style={{ fontSize: fs(15), padding: '8px 0', borderTop: '1px solid var(--border)' }}><span><b>{e.name}</b> · {e.role}</span><span style={{ color: 'var(--fg-2)' }}>{status(e.id)}</span></div>)}</div></Box>
  </div>;
}

function Recipes({ k }: { k: Kctx }) {
  const prods = k.db.outletProducts.filter(x => x.outletId === k.outletId && !x.hidden).map(x => k.db.products.find(p => p.id === x.productId)!)
    .filter(p => p && p.status === 'live' && (k.st === 'all' || k.db.categories.find(c => c.id === p.categoryId)?.station === k.st));
  const [sel, setSel] = useState<string | null>(null);
  const p = prods.find(x => x.id === sel) ?? prods[0];
  if (!p) return <Caught>No items for this station.</Caught>;
  const st = k.db.categories.find(c => c.id === p.categoryId)?.station ?? 'bar';
  const rec = k.db.recipes.filter(r => r.productId === p.id);
  const op = k.db.outletProducts.find(x => x.productId === p.id && x.outletId === k.outletId);
  return <div>
    <H sub="What goes into each item, per serving, and what is on hand at this outlet. Recipes are set in the back office.">Recipes & prep guide</H>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,300px),1fr))', gap: 12, alignItems: 'start' }}>
      <div className="stack sm">{prods.map(x => <KBtn key={x.id} onClick={() => setSel(x.id)} style={{ justifyContent: 'flex-start', background: x.id === p.id ? 'var(--accent)' : undefined, color: x.id === p.id ? '#fff' : undefined }}>{x.name}</KBtn>)}</div>
      <div className="stack">
        <Box><div className="row between wrap"><b style={{ fontSize: fs(24) }}>{p.name}</b><span className="row">{op?.is86 && <Pill bg="var(--danger)" fg="#fff">Sold out</Pill>}<Pill>{st}</Pill></span></div>
          <p style={{ fontSize: fs(15), color: 'var(--fg-2)', marginTop: 6 }}>{p.desc || `Target ${Number(k.db.settings[TGT('target.' + st)] ?? DEF_TARGET[st])} min from ticket to pass.`}</p></Box>
        <Box><b style={{ fontSize: fs(17) }}>Per serving</b>
          <div className="stack sm" style={{ marginTop: 8 }}>{!rec.length && <span style={{ fontSize: fs(15), color: 'var(--fg-3)' }}>No recipe on file. Ask the manager to add one in Inventory.</span>}
            {rec.map(r => { const s = k.db.stockItems.find(x => x.id === r.stockItemId)!, have = level(k.db.movements, k.outletId, s.id);
              return <div key={r.stockItemId} className="row between wrap" style={{ fontSize: fs(16), padding: '8px 0', borderTop: '1px solid var(--border)' }}>
                <span><b>{s.unit === 'pcs' ? r.qty : r.qty < 1 ? Math.round(r.qty * 1000) + (s.unit === 'kg' ? ' g' : ' ml') : r.qty + ' ' + s.unit}</b> {s.name}</span>
                <span style={{ color: have < s.par ? 'var(--danger-fg)' : 'var(--fg-2)', fontWeight: have < s.par ? 700 : 400 }}>{Math.round(have * 100) / 100} {s.unit} on hand{have < s.par ? ' · below par' : ''}</span></div>; })}</div></Box>
        {p.modifierGroupIds.length > 0 && <Box><b style={{ fontSize: fs(17) }}>Options guests can pick</b>
          <div className="stack sm" style={{ marginTop: 8 }}>{p.modifierGroupIds.map(g => k.db.modifierGroups.find(m => m.id === g)).filter(Boolean).map(g => <span key={g!.id} style={{ fontSize: fs(15) }}><b>{g!.name}</b>: {g!.options.map(o => o.name).join(', ')}</span>)}</div></Box>}
      </div>
    </div>
  </div>;
}

const DEF_TARGET: Record<Station, number> = { bar: 5, kitchen: 12, pastry: 4 };
function Stepper({ v, set, min = 1, max = 60 }: { v: number; set: (n: number) => void; min?: number; max?: number }) {
  return <span className="row"><KBtn onClick={() => set(Math.max(min, v - 1))} label="Less">−</KBtn><b style={{ fontSize: fs(22), minWidth: 72, textAlign: 'center' }}>{v} min</b><KBtn onClick={() => set(Math.min(max, v + 1))} label="More">+</KBtn></span>;
}
function Targets({ k }: { k: Kctx }) {
  const g = k.db.settings, put = (id: string, n: number) => setSetting(TGT(id), n, k.by);
  const tgt = (s: Station) => Number(g[TGT('target.' + s)] ?? DEF_TARGET[s]);
  const rows = k.tickets.map(o => { const sts = [...new Set(openLinesAt(o, 'all').map(l => l.station))]; const target = Math.max(...sts.map(tgt)); const el = (k.now - o.createdAt) / 60e3; return { o, sts, target, el }; }).sort((a, b) => b.el - a.el);
  return <div className="stack lg">
    <H sub="Timer colors on every ticket: normal under the warning time, amber up to the late time, red after. Targets per station feed the prep guide and performance.">Prep timers & targets</H>
    <Grid min={300}>
      <Box><b style={{ fontSize: fs(17) }}>Amber after</b><div style={{ marginTop: 8 }}><Stepper v={k.cfg.warn} set={n => put('warn', Math.min(n, k.cfg.late - 1))} /></div></Box>
      <Box><b style={{ fontSize: fs(17) }}>Red (late) after</b><div style={{ marginTop: 8 }}><Stepper v={k.cfg.late} set={n => put('late', Math.max(n, k.cfg.warn + 1))} /></div></Box>
      {(['bar', 'kitchen', 'pastry'] as const).map(s => <Box key={s}><b style={{ fontSize: fs(17) }}>{stationName(s)} target</b><div style={{ marginTop: 8 }}><Stepper v={tgt(s)} set={n => put('target.' + s, n)} /></div></Box>)}
    </Grid>
    <Box><b style={{ fontSize: fs(17) }}>Open tickets against target</b>
      <div className="stack sm" style={{ marginTop: 8 }}>{!rows.length && <span style={{ fontSize: fs(15), color: 'var(--fg-3)' }}>No open tickets.</span>}
        {rows.map(({ o, sts, target, el }) => <div key={o.id} className="row between wrap" style={{ fontSize: fs(16), padding: '8px 0', borderTop: '1px solid var(--border)' }}>
          <span><b>{ticketLabel(o)}</b> · {sts.join(', ')}</span>
          <b style={{ color: el > k.cfg.late ? 'var(--danger-fg)' : el > k.cfg.warn ? 'var(--warning-fg)' : el > target ? 'var(--warning-fg)' : 'var(--success-fg)' }}>{mmss(k.now - o.createdAt)} / target {target} min</b></div>)}</div></Box>
  </div>;
}

function Perf({ k }: { k: Kctx }) {
  const ps = prepStats(k.db, k.outletId);
  const late = ps.mins.filter(m => m > k.cfg.late).length;
  const by = (f: (o: Order) => boolean) => { const xs = ps.done.filter(x => f(x.o)).map(x => (x.at - x.o.createdAt) / 60e3); return xs.length ? (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1) + ' min' : '—'; };
  const chart = useMemo(() => {
    const t0 = startOfDay(k.now), hours = Array.from({ length: 16 }, (_, i) => i + 7);
    const os = k.db.orders.filter(o => o.outletId === k.outletId && o.createdAt >= t0 - 7 * 864e5 && o.lines.some(l => l.fired));
    const today = hours.map(h => os.filter(o => o.createdAt >= t0 && new Date(o.createdAt).getHours() === h).length);
    const avg = hours.map(h => Math.round(os.filter(o => o.createdAt < t0 && new Date(o.createdAt).getHours() === h).length / 7 * 10) / 10);
    return { labels: hours.map(h => String(h).padStart(2, '0')), series: [{ label: 'Today', data: today }, { label: '7-day avg', data: avg, compare: true }] };
  }, [k.db.orders, k.outletId, Math.floor(k.now / 60e3)]);
  const slow = [...ps.done].sort((a, b) => (b.at - b.o.createdAt) - (a.at - a.o.createdAt)).slice(0, 6);
  return <div className="stack lg">
    <H sub="Prep time runs from the order’s created time to the bump on the KDS, today at this outlet.">Kitchen performance</H>
    <Grid min={200}>
      <Stat l="Avg prep today" v={ps.avg == null ? '—' : ps.avg.toFixed(1) + ' min'} />
      <Stat l="Bumped on KDS today" v={ps.n} />
      <Stat l={`Over ${k.cfg.late} min`} v={ps.n ? Math.round(late / ps.n * 100) + '%' : '—'} />
      <Stat l="Open now" v={k.tickets.length} />
      <Stat l="Dine-in & QR avg" v={by(o => !isOnline(o))} />
      <Stat l="Delivery avg" v={by(isOnline)} />
    </Grid>
    {ps.avg == null && <p style={{ fontSize: fs(15), color: 'var(--fg-2)' }}>Prep times appear after the first ticket is bumped today.</p>}
    <Box><b style={{ fontSize: fs(17) }}>Tickets by hour · today vs 7-day average</b><div style={{ marginTop: 12 }}><LineChart kind="bar" labels={chart.labels} series={chart.series} height={240} /></div></Box>
    {slow.length > 0 && <Box><b style={{ fontSize: fs(17) }}>Slowest today</b>
      <div className="stack sm" style={{ marginTop: 8 }}>{slow.map(({ o, at }) => <div key={o.id} className="row between" style={{ fontSize: fs(16), padding: '8px 0', borderTop: '1px solid var(--border)' }}><span><b>{ticketLabel(o)}</b> · {o.lines.filter(l => l.fired).map(l => l.name).join(', ')}</span><b>{mmss(at - o.createdAt)}</b></div>)}</div></Box>}
  </div>;
}

const LAYOUTS = (catalog.surfaces as unknown as Record<string, unknown[]>).kds[5] as { id: 'A' | 'B' | 'C'; t: string; d: string; when: string }[];
function Settings({ k }: { k: Kctx }) {
  const put = (id: string, v: string | boolean) => setSetting(SET(id), v, k.by);
  const seg = (id: string, cur: string, opts: [string, string][]) => <div className="row wrap" role="group" style={{ gap: 6 }}>{opts.map(([v, l]) => <KBtn key={v} onClick={() => put(id, v)} tone={cur === v ? 'accent' : 'neutral'}>{l}</KBtn>)}</div>;
  return <div className="stack lg" style={{ maxWidth: 1000 }}>
    <H sub="Saved for every kitchen screen at this business. The station stays per screen.">KDS settings</H>
    <Box><b style={{ fontSize: fs(17) }}>Layout</b>
      <div style={{ marginTop: 10 }}><Grid min={220}>{LAYOUTS.map(l => <button key={l.id} type="button" aria-pressed={k.layout === l.id} onClick={() => put('layout', l.id)} style={{ minHeight: 120, borderRadius: 16, padding: 16, textAlign: 'left', cursor: 'pointer', background: 'var(--bg-raised)', color: 'var(--fg-1)', border: `3px solid ${k.layout === l.id ? 'var(--accent)' : 'var(--border)'}`, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <b style={{ fontSize: fs(18) }}>{l.id} · {l.t}</b><span style={{ fontSize: fs(15), color: 'var(--fg-2)' }}>{l.d} {l.when}</span></button>)}</Grid></div></Box>
    <Box><div className="row between wrap"><span><b style={{ fontSize: fs(17) }}>Sound on new ticket</b><br /><span style={{ fontSize: fs(15), color: 'var(--fg-2)' }}>Two-tone chime when a ticket arrives.</span></span>
      <span className="row"><KBtn onClick={chime}>Play test sound</KBtn><Toggle on={k.sound} onChange={v => put('sound', v)} label="Sound on new ticket" /></span></div></Box>
    <Box><b style={{ fontSize: fs(17) }}>Ticket colors</b><p style={{ fontSize: fs(15), color: 'var(--fg-2)', margin: '4px 0 10px' }}>By timer colors the whole header amber and red. By channel keeps a channel band and colors only the timer.</p>
      {seg('colors', k.cfg.colors, [['timer', 'By timer'], ['channel', 'By channel']])}</Box>
    <Box><b style={{ fontSize: fs(17) }}>Text size</b><div style={{ marginTop: 10 }}>{seg('size', k.cfg.scale > 1 ? 'large' : 'normal', [['normal', 'Normal'], ['large', 'Large']])}</div></Box>
    <Box><b style={{ fontSize: fs(17) }}>Timers & targets</b><p style={{ fontSize: fs(15), color: 'var(--fg-2)', margin: '4px 0 10px' }}>Amber after {k.cfg.warn} min, red after {k.cfg.late} min.</p><Link href={kdsPath('targets')} className="btn" style={{ height: 48 }}>Change timers</Link></Box>
    <Box><b style={{ fontSize: fs(17) }}>Connection</b><p style={{ fontSize: fs(15), color: k.db.device.online ? 'var(--success-fg)' : 'var(--danger-fg)', marginTop: 4 }}>{k.db.device.online ? 'Connected · tickets arrive live' : 'Disconnected · showing the last tickets received'}</p></Box>
  </div>;
}
