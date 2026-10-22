'use client';
// Kitchen display (spec: BorNiz Kitchen Display). Dark, readable from 2 m, tickets from the live order stream at this outlet.
// Every KDS page is one view of this screen; station is per device, layout / sound / colors / targets are KDS settings.
import { DeviceChrome } from '../app/chrome.tsx';
import { expoOn } from '../system/settings.ts';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Link from '../ui/Link.tsx';
import { useApp } from '../app/context.tsx';
import { Sheet, toast, useNow, hhmm, Icon } from '../ui/kit.tsx';
import { pagesOf } from '../system/registry.ts';
import { perm, type PermCode } from '../system/perms.ts';
import { apply86, bumpStation, demoTicket, startStation, toggleLine } from '../data/actions/kds.ts';
import { useOnlineAutomation } from './kitchen/onlineAuto.ts';
import type { Order } from '../data/schema.ts';
import { pickupLanes } from '../domain/order.ts';
import { activeTickets, allDay, CHANNEL, empName, isOnline, linesAt, openLinesAt, prepStats, STATIONS, TIER, type Station } from './kitchen/model.ts';
import { chime, fs, KBtn, Ticket, useStableOrder, useTouchHold, useWakeLock, type KdsCfg } from './kitchen/Ticket.tsx';
import { KdsPage } from './kitchen/kdsPages.tsx';
import { markRead, simulatePlatformOrder } from '../data/actions.ts';

export type View = 'tickets' | 'station' | 'lanes' | 'rush' | 'expo' | 'allday' | 'done' | 'recall' | '86' | 'detail' | 'runner' | 'clock' | 'recipes' | 'targets' | 'perf' | 'settings';
const VIEW: Record<string, View> = {
  'order-tickets': 'tickets', 'station-filter': 'station', 'delivery-and-online-order-lane': 'lanes', 'rush-priority-orders': 'rush', 'expo-pass-screen': 'expo',
  'all-day-item-count': 'allday', 'completed-orders': 'done', 'recall-bumped-order': 'recall', 'mark-items-out-of-stock': '86', 'order-detail-and-notes': 'detail',
  'call-runner-waiter': 'runner', 'clock-in-out': 'clock', 'recipes-and-prep-guide': 'recipes', 'prep-timers-and-targets': 'targets', 'kitchen-performance': 'perf', 'kds-settings': 'settings',
};
export const kdsPath = (v: View) => '/kds/' + Object.entries(VIEW).find(([, x]) => x === v)![0];
const NAV: [View, string][] = [['tickets', 'Tickets'], ['lanes', 'Delivery lane'], ['rush', 'Rush'], ['expo', 'Expo'], ['allday', 'All day'], ['recall', 'Recall'], ['86', '86 list'], ['runner', 'Call runner']];

export const SET = (id: string) => '/kds/kds-settings:' + id;
export const TGT = (id: string) => '/kds/prep-timers-and-targets:' + id;
const STATION_KEY = 'bn-kds-station';

export interface Kctx {
  db: ReturnType<typeof useApp>['db']; outletId: string; by: string; role: ReturnType<typeof useApp>['user']['role'];
  now: number; st: Station | 'all'; setSt: (s: Station | 'all') => void; cfg: KdsCfg; layout: 'A' | 'B' | 'C'; sound: boolean;
  go: (p: string) => void; can: (action: string) => PermCode; tickets: Order[]; meta: (o: Order) => string; open: (id: string) => void; recalled: Set<string>;
}

const CHANGE = ['Item voided', 'Table moved'];

export default function Screen() {
  const { page, db, user, me, outletId, go } = useApp();
  const view = VIEW[page.slug] ?? 'tickets';
  const now = useNow(1000);
  const wake = useWakeLock();
  const [st, setStRaw] = useState<Station | 'all'>('all');
  useEffect(() => { try { const s = localStorage.getItem(STATION_KEY); if (s && STATIONS.some(([k]) => k === s)) setStRaw(s as Station | 'all'); } catch { /* storage blocked */ } }, []);
  const setSt = (s: Station | 'all') => { setStRaw(s); try { localStorage.setItem(STATION_KEY, s); } catch { /* storage blocked */ } };
  const [more, setMore] = useState(false);
  const g = db.settings, by = me?.id ?? user.id;
  const cfg: KdsCfg = { warn: Number(g[TGT('warn')] ?? 8), late: Number(g[TGT('late')] ?? 12), colors: g[SET('colors')] === 'channel' ? 'channel' : 'timer', scale: g[SET('size')] === 'large' ? 1.15 : 1 };
  const layout = (['A', 'B', 'C'].includes(String(g[SET('layout')])) ? g[SET('layout')] : 'B') as 'A' | 'B' | 'C'; // design v1.0: queue → in progress → ready
  const sound = g[SET('sound')] !== false;
  const outlet = db.outlets.find(o => o.id === outletId);
  const tickets = useMemo(() => activeTickets(db, outletId), [db, outletId]);
  const recalled = useMemo(() => {
    const s = new Set<string>(), seen = new Set<string>();
    for (const a of db.audit) if (a.action.startsWith('ticket.') && !seen.has(a.subject)) { seen.add(a.subject); if (a.action === 'ticket.recalled') s.add(a.subject); }
    return s;
  }, [db.audit]);

  // Chime + toast when a ticket arrives (not on first paint).
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    const ids = new Set(tickets.map(t => t.id));
    if (seen.current) { const fresh = tickets.filter(t => !seen.current!.has(t.id)); if (fresh.length) { if (sound) chime(db); toast(`New ticket · ${fresh.map(t => t.table ?? t.no).join(', ')}`); } }
    seen.current = ids;
  }, [tickets, sound]); // eslint-disable-line react-hooks/exhaustive-deps

  // A void or a table move after the food was fired: a banner until the kitchen taps "Got it" (POS › Void item / Move table).
  const changes = db.notices.filter(n => CHANGE.includes(n.alert) && n.outletId === outletId && !n.read && now - n.at < 4 * 3600e3);
  const heard = useRef<number | null>(null);
  useEffect(() => { if (heard.current !== null && changes.length > heard.current && sound) chime(db); heard.current = changes.length; }, [changes.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Scheduled online orders fire and approved sold-out requests (permission 'a') apply even when only the KDS is open.
  useOnlineAutomation(db, outletId, now);
  useEffect(() => { db.approvals.forEach(a => { const pl = a.payload as { kds86?: string; applied?: boolean } | undefined; if (a.status === 'approved' && pl?.kds86 && !pl.applied && a.outletId === outletId) apply86(a.id); }); }, [db.approvals, outletId]);

  const can = (action: string) => { const c = perm(db, user.role, action, outletId); return c === 'o' && !(me?.outlets.includes(outletId) ?? user.role === 'owner') ? 'n' : c; };
  const meta = (o: Order) => [isOnline(o) ? CHANNEL[o.source].name + (o.type === 'delivery' ? ' · delivery' : '') : o.type === 'take' ? 'Takeaway' : 'Dine-in', o.type === 'dine' && o.guests ? o.guests + ' pax' : null, o.source === 'qr' ? 'QR' : empName(db, o.cashierId)].filter(Boolean).join(' · ');
  const k: Kctx = { db, outletId, by, role: user.role, now, st, setSt, cfg, layout, sound, go, can, tickets, meta, open: id => go(kdsPath('detail') + '?o=' + id), recalled };
  const count = (s: Station | 'all') => tickets.filter(t => openLinesAt(t, s).length).length;

  return <div data-theme="dark" style={{ ['--kds-scale' as string]: cfg.scale, minHeight: '100dvh', background: 'var(--bg-canvas)', color: 'var(--fg-1)', display: 'flex', flexDirection: 'column', fontSize: fs(15) }}>
    <header style={{ position: 'sticky', top: 0, zIndex: 20, background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)' }}>
      <div className="row wrap" style={{ minHeight: 64, padding: '8px 16px', gap: 12 }}>
        <b style={{ fontSize: fs(18), whiteSpace: 'nowrap' }}>Kitchen · {outlet?.name}</b>
        <span style={{ order: 99, marginLeft: 'auto' }}><DeviceChrome dark /></span>
        <div className="row" role="group" aria-label="Station" style={{ gap: 4, padding: 4, borderRadius: 12, background: 'var(--bg-sunken)', overflowX: 'auto', maxWidth: '100%' }}>
          {STATIONS.map(([s, l]) => <button key={s} type="button" aria-pressed={st === s} onClick={() => setSt(s)} style={{ height: 44, padding: '0 14px', border: 0, borderRadius: 9, cursor: 'pointer', whiteSpace: 'nowrap', fontWeight: 700, fontSize: fs(15),
            background: st === s ? 'var(--accent)' : 'transparent', color: st === s ? 'var(--ink-0)' : 'var(--fg-2)' }}>{l} <span style={{ opacity: .75 }}>{count(s)}</span></button>)}
        </div>
        <span className="grow" />
        {!db.device.online && <span style={{ fontSize: fs(15), fontWeight: 800, color: 'var(--danger-fg)' }}>Disconnected</span>}
        {wake && <span className="hide-sm" style={{ fontSize: fs(15), color: 'var(--fg-3)' }}>Screen stays on</span>}
        <b style={{ fontSize: fs(22) }}>{hhmm(now)}</b>
      </div>
      <nav className="row" aria-label="KDS views" style={{ gap: 6, padding: '0 16px 10px', overflowX: 'auto' }}>
        {NAV.filter(([v]) => v !== 'expo' || expoOn(db)).map(([v, l]) => <Link key={v} href={kdsPath(v)} aria-current={view === v || (v === 'recall' && view === 'done') ? 'page' : undefined} className="btn" style={{ height: 48, fontSize: fs(15), flex: 'none',
          background: view === v ? 'var(--bg-raised)' : 'transparent', borderColor: view === v ? 'var(--fg-3)' : 'var(--border)' }}>{l}</Link>)}
        <button type="button" className="btn" style={{ height: 48, fontSize: fs(15), flex: 'none' }} onClick={() => setMore(true)}><Icon name="ellipsis" />More</button>
      </nav>
    </header>
    {!db.device.online && <div role="alert" style={{ padding: '12px 16px', background: 'var(--danger)', color: 'var(--ink-0)', fontWeight: 700, fontSize: fs(16) }}>
      Disconnected. Showing the last tickets this screen received. Bumps are kept here and sync when the connection is back; ask the cashier for new orders.</div>}
    {changes.map(n => <div key={n.id} role="alert" className="row" style={{ padding: '8px 16px', gap: 12, background: n.alert === 'Item voided' ? 'var(--danger)' : 'var(--info)', color: 'var(--ink-0)', fontWeight: 700, fontSize: fs(17) }}>
      <Icon name={n.alert === 'Item voided' ? 'ban' : 'move'} /><span className="grow">{n.alert} · {n.text}</span>
      <button type="button" className="btn" style={{ height: 48, fontSize: fs(15) }} onClick={() => markRead(n.id, by)}>Got it</button></div>)}
    <main style={{ flex: 1, minHeight: 0, padding: '12px 12px 96px' }}>
      {view === 'tickets' ? <Tickets k={k} /> : view === 'lanes' ? <Lanes k={k} split forced /> : view === 'rush' ? <Rush k={k} /> : <KdsPage view={view} k={k} />}
    </main>
    <Sheet open={more} onClose={() => setMore(false)} title="Kitchen display" sub="Every kitchen page. Station and layout stay on this screen.">
      <div className="stack sm">
        {pagesOf('kds').map(p => <Link key={p.path} href={p.path} onClick={() => setMore(false)} className="btn" style={{ height: 52, justifyContent: 'flex-start', fontSize: 15 }} aria-current={p.path === page.path ? 'page' : undefined}>{p.title}</Link>)}
        <span className="cap" style={{ marginTop: 12 }}>Demo</span>
        <button type="button" className="btn" style={{ height: 52, fontSize: 15 }} onClick={() => { demoTicket(db, outletId); setMore(false); }}>Simulate new table order</button>
        <button type="button" className="btn" style={{ height: 52, fontSize: 15 }} onClick={() => { simulatePlatformOrder(outletId, 'gofood'); setMore(false); toast('GoFood order is waiting in the online inbox · accept it to fire'); }}>Simulate GoFood order (goes to the online inbox)</button>
      </div>
    </Sheet>
  </div>;
}

// ── Ticket views ────────────────────────────────────────────────────────────────────────
const byAge = (a: Order, b: Order) => a.createdAt - b.createdAt;
const byLane = (a: Order, b: Order) => (TIER[a.tier ?? 'standard'].rank - TIER[b.tier ?? 'standard'].rank) || ((a.readyBy ?? a.createdAt) - (b.readyBy ?? b.createdAt));
const readyAt = (o: Order, k: Kctx) => o.readyBy ?? o.createdAt + k.cfg.late * 60e3;

export function TicketGrid({ k, list, empty, action, min = 260 }: { k: Kctx; list: Order[]; empty?: ReactNode; action?: (o: Order) => { label: string; tone: 'go' | 'accent' | 'neutral'; run: () => void } | null; min?: number }) {
  const { hold, touch } = useTouchHold();
  const shown = useStableOrder(list, hold);
  const canBump = k.can('See & bump tickets') === 'y' || k.can('See & bump tickets') === 'o';
  const def = (o: Order) => canBump ? { label: 'Bump · ready', tone: 'go' as const, run: () => { bumpStation(o.id, k.st, k.by); toast(`${o.table ?? o.no} ready · ${isOnline(o) ? 'bag to the pickup shelf' : 'runner notified'}`); } } : null;
  if (!shown.length) return <>{empty ?? <Caught />}</>;
  return <div onPointerDown={touch} style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill,minmax(min(100%,${min}px),1fr))`, gridAutoRows: 'min-content', gap: 12 }}>
    {shown.map(o => <Ticket key={o.id} o={o} st={k.st} now={k.now} cfg={k.cfg} meta={k.meta(o)} recalled={k.recalled.has(o.id)} onOpen={() => k.open(o.id)}
      onItem={canBump ? id => toggleLine(o.id, id, k.by) : undefined} action={(action ?? def)(o)} />)}
  </div>;
}
export const Caught = ({ children }: { children?: ReactNode }) => <div style={{ padding: '80px 20px', textAlign: 'center', color: 'var(--fg-3)', fontSize: fs(20) }}>{children ?? 'All caught up. New tickets appear here with a chime.'}</div>;
const LaneBox = ({ title, n, children, tint, done }: { title: string; n: number; children: ReactNode; tint?: boolean; done?: boolean }) =>
  <section style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0, padding: 10, borderRadius: 18, background: done ? 'var(--success-soft)' : tint ? 'var(--bg-sunken)' : 'transparent', border: `1px solid ${done ? 'color-mix(in srgb,var(--success) 40%,transparent)' : 'var(--border)'}` }}>
    <div className="row between" style={{ padding: '0 4px' }}><b style={{ fontSize: fs(17) }}>{title}</b><span style={{ fontSize: fs(15), color: 'var(--fg-2)' }}>{n} ticket{n === 1 ? '' : 's'}</span></div>{children}</section>;
const LaneEmpty = () => <span style={{ padding: 24, borderRadius: 14, border: '1px dashed var(--border)', color: 'var(--fg-3)', fontSize: fs(15), textAlign: 'center' }}>Nothing in this lane</span>;

function Tickets({ k }: { k: Kctx }) {
  if (k.layout === 'B') return <StatusLanes k={k} />;
  if (k.layout === 'C') return <ItemFirst k={k} />;
  return <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
    <div className="grow"><Lanes k={k} /></div>
    <AllDayRail k={k} />
  </div>;
}

/** Layout A. Split: dine-in & QR oldest first | delivery by tier then ready-by (rush never jumps the dine-in lane). One queue: by ready-by. */
function Lanes({ k, split: forceSplit, forced }: { k: Kctx; split?: boolean; forced?: boolean }) {
  const [mode, setMode] = useState<'split' | 'one'>('split');
  const split = forceSplit || mode === 'split';
  const mine = k.tickets.filter(o => openLinesAt(o, k.st).length);
  const dine = mine.filter(o => !isOnline(o)).sort(byAge), del = mine.filter(isOnline).sort(byLane);
  return <div className="stack">
    <div className="row wrap" style={{ gap: 10 }}>
      {!forced && <div className="row" role="group" aria-label="Lanes" style={{ gap: 3, padding: 3, borderRadius: 12, background: 'var(--bg-sunken)' }}>
        {([['split', 'Split lanes'], ['one', 'One queue']] as const).map(([m, l]) => <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)} style={{ height: 44, padding: '0 14px', border: 0, borderRadius: 9, fontWeight: 700, fontSize: fs(15), cursor: 'pointer', background: mode === m ? 'var(--accent)' : 'transparent', color: mode === m ? 'var(--ink-0)' : 'var(--fg-2)' }}>{l}</button>)}
      </div>}
      <span style={{ fontSize: fs(15), color: 'var(--fg-2)' }}>{split ? 'Delivery sorted by tier, then ready-by. Tables keep their own pace.' : 'Quiet hours: everything by ready-by time.'}</span>
    </div>
    {!mine.length ? <Caught /> : split
      ? <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,300px),1fr))', gap: 12, alignItems: 'start' }}>
        <LaneBox title="Dine-in & QR" n={dine.length}><TicketGrid k={k} list={dine} empty={<LaneEmpty />} min={240} /></LaneBox>
        <LaneBox title="Delivery & pickup" n={del.length} tint><TicketGrid k={k} list={del} empty={<LaneEmpty />} min={240} /></LaneBox>
      </div>
      : <TicketGrid k={k} list={[...mine].sort((a, b) => readyAt(a, k) - readyAt(b, k))} />}
  </div>;
}

function Rush({ k }: { k: Kctx }) {
  const mine = k.tickets.filter(o => openLinesAt(o, k.st).length);
  const rush = mine.filter(o => o.tier === 'rush').sort(byLane);
  const late = mine.filter(o => o.tier !== 'rush' && k.now - o.createdAt > k.cfg.late * 60e3).sort(byAge);
  return <div className="stack lg">
    <p style={{ fontSize: fs(15), color: 'var(--fg-2)' }}>Rush is the platforms’ instant tier: top of the delivery lane, by ready-by. It never jumps tables in the dine-in lane. Late tickets (over {k.cfg.late} min) from any channel are listed below.</p>
    <LaneBox title="Rush · delivery" n={rush.length}><TicketGrid k={k} list={rush} empty={<LaneEmpty />} /></LaneBox>
    <LaneBox title={`Late · over ${k.cfg.late} min`} n={late.length} tint><TicketGrid k={k} list={late} empty={<LaneEmpty />} /></LaneBox>
  </div>;
}

/** Layout B: New → Cooking → Ready. */
function StatusLanes({ k }: { k: Kctx }) {
  const mine = k.tickets.filter(o => openLinesAt(o, k.st).length).sort(byAge);
  const isNew = (o: Order) => openLinesAt(o, k.st).every(l => l.kds === 'new');
  // line state, not order status: a paid-first QR / kiosk order stays 'paid' while it is ready (same rule as the pickup board)
  const ready = pickupLanes(k.db.orders.filter(o => o.outletId === k.outletId && linesAt(o, k.st).length), k.now).ready.sort(byAge);
  const canBump = k.can('See & bump tickets') !== 'n' && k.can('See & bump tickets') !== 'a';
  return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,280px),1fr))', gap: 12, alignItems: 'start' }}>
    <LaneBox title="Order queue" n={mine.filter(isNew).length}><TicketGrid k={k} list={mine.filter(isNew)} empty={<LaneEmpty />} min={240} action={o => canBump ? { label: 'Start cooking', tone: 'accent', run: () => startStation(o.id, k.st, k.by) } : null} /></LaneBox>
    <LaneBox title="In progress" n={mine.filter(o => !isNew(o)).length} tint><TicketGrid k={k} list={mine.filter(o => !isNew(o))} empty={<LaneEmpty />} min={240} /></LaneBox>
    <LaneBox title="Ready" n={ready.length} done>{ready.length ? <TicketGrid k={k} list={ready} min={240} action={() => null} /> : <LaneEmpty />}</LaneBox>
  </div>;
}

/** Layout C: cook by item; each table chip marks that table's line done. */
function ItemFirst({ k }: { k: Kctx }) {
  const mine = k.tickets.filter(o => openLinesAt(o, k.st).length).sort(byAge);
  const groups = new Map<string, { o: Order; lineId: string; qty: number; mods: string }[]>();
  mine.forEach(o => openLinesAt(o, k.st).forEach(l => { const g = groups.get(l.name) ?? []; g.push({ o, lineId: l.id, qty: l.qty, mods: l.mods.map(m => m.name).join(', ') + (l.note ? ' · ' + l.note : '') }); groups.set(l.name, g); }));
  const canBump = k.can('See & bump tickets') !== 'n' && k.can('See & bump tickets') !== 'a';
  if (!mine.length) return <Caught />;
  return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,340px),1fr))', gap: 12, alignItems: 'start' }}>
    <LaneBox title="Items × qty" n={mine.length} tint>
      {[...groups.entries()].sort((a, b) => b[1].reduce((s, x) => s + x.qty, 0) - a[1].reduce((s, x) => s + x.qty, 0)).map(([name, rows]) =>
        <div key={name} style={{ padding: 12, borderRadius: 14, background: 'var(--bg-surface)', border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="row between"><b style={{ fontSize: fs(20) }}>{name}</b><b style={{ fontSize: fs(24), color: 'var(--accent-fg)' }}>{rows.reduce((s, x) => s + x.qty, 0)}</b></div>
          <div className="row wrap">{rows.map(r => <KBtn key={r.lineId} disabled={!canBump} onClick={() => toggleLine(r.o.id, r.lineId, k.by)} label={`Mark ${name} for ${r.o.table ?? r.o.no} done`}>
            {r.o.table ?? r.o.no} ×{r.qty}{r.mods && <span style={{ fontWeight: 500, color: 'var(--accent-fg)' }}> · {r.mods}</span>}</KBtn>)}</div>
        </div>)}
    </LaneBox>
    <LaneBox title="Tables" n={mine.length}>
      {mine.map(o => { const ls = linesAt(o, k.st), done = ls.filter(l => l.kds === 'done').length;
        return <div key={o.id} className="row" style={{ padding: 12, borderRadius: 14, background: 'var(--bg-surface)', border: '1px solid var(--border)', gap: 12 }}>
          <button type="button" onClick={() => k.open(o.id)} style={{ all: 'unset', cursor: 'pointer', flex: 1, minWidth: 0 }}><b style={{ fontSize: fs(20) }}>{o.table ?? o.no}</b><br /><span style={{ fontSize: fs(15), color: 'var(--fg-2)' }}>{done}/{ls.length} done · {k.meta(o)}</span></button>
          {canBump && <KBtn big tone="go" onClick={() => bumpStation(o.id, k.st, k.by)}>Bump</KBtn>}
        </div>; })}
    </LaneBox>
  </div>;
}

function AllDayRail({ k }: { k: Kctx }) {
  const ad = allDay(k.tickets, k.st), ps = prepStats(k.db, k.outletId);
  return <aside className="kds-rail" style={{ width: 250, flex: 'none', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 18, padding: 14, display: 'flex', flexDirection: 'column', gap: 8, position: 'sticky', top: 140 }}>
    <style>{'@media (max-width:1099px){.kds-rail{display:none!important}}'}</style>
    <b style={{ fontSize: fs(15), color: 'var(--fg-2)', letterSpacing: '.04em' }}>ALL DAY · {STATIONS.find(s => s[0] === k.st)![1].toUpperCase()}</b>
    {ad.length === 0 && <span style={{ fontSize: fs(15), color: 'var(--fg-3)' }}>Nothing open</span>}
    {ad.slice(0, 14).map(([n, q]) => <div key={n} className="row between" style={{ padding: '10px 12px', borderRadius: 12, background: 'var(--bg-raised)' }}><span style={{ fontSize: fs(15), fontWeight: 600 }}>{n}</span><b style={{ fontSize: fs(22), color: 'var(--accent-fg)' }}>{q}</b></div>)}
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 8 }}>
      <Link href={kdsPath('perf')} style={{ padding: 10, borderRadius: 12, background: 'var(--bg-raised)', color: 'var(--fg-1)' }}><span style={{ fontSize: fs(15), color: 'var(--fg-2)' }}>Avg prep</span><br /><b style={{ fontSize: fs(18) }}>{ps.avg == null ? '—' : ps.avg.toFixed(1) + ' min'}</b></Link>
      <Link href={kdsPath('done')} style={{ padding: 10, borderRadius: 12, background: 'var(--bg-raised)', color: 'var(--fg-1)' }}><span style={{ fontSize: fs(15), color: 'var(--fg-2)' }}>Bumped</span><br /><b style={{ fontSize: fs(18) }}>{ps.n}</b></Link>
    </div>
  </aside>;
}
