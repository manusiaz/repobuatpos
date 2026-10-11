'use client';
// Online & ride-hailing orders (spec: BorNiz Online Orders). Incoming only: accept / reject with reason, never add items
// or change prices. Inbox, pickup shelf, scheduled orders, busy mode & pause, delivery kanban, integrations.
// /pos/... pages run full screen on the register; back-office pages render inside the shell (page.shell).
import { useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useApp } from '../app/context.tsx';
import { IntegrationsPanel } from '../integrations/Panel.tsx';
import { OutletPicker, DeviceChrome } from '../app/chrome.tsx';
import { Badge, Empty, Field, Icon, Kpi, Seg, Sheet, Toggle, ago, hhmm, toast, useNow } from '../ui/kit.tsx';
import { usePin } from '../ui/PinSheet.tsx';
import { idr } from '../domain/money.ts';
import { isPlatform, type Source } from '../domain/order.ts';
import { perm, type PermCode } from '../system/perms.ts';
import { canOpen } from '../system/access.ts';
import { pagesOf } from '../system/registry.ts';
import { readyBy, rejectOnline } from '../data/actions.ts';
import { accept, askOnline, BUSY_MAX_MIN, busyState, channelState, CHANNELS, fireAt, fireScheduled, handOver, handOverWithoutCode, isScheduled, PAUSE_MAX_MIN, pendingAsk, pickupCode, receiveDemoOrder, setBusy, setChannel, setPause, ACCEPT_WINDOW_MS, type Channel, type OnlineAsk } from '../data/actions/online.ts';
import type { DB, Order } from '../data/schema.ts';
import { bumpTimes, CHANNEL, dueText, empName, isOnline, lineMods, minsLeft, mmss, startOfDay, TIER } from './kitchen/model.ts';
import { useOnlineAutomation } from './kitchen/onlineAuto.ts';

type Tab = 'inbox' | 'shelf' | 'scheduled' | 'busy';
const REASONS = ['Item sold out', 'Kitchen too busy', 'Store closing', 'Other'];
const LIVE = ['open', 'held', 'sent', 'preparing', 'ready'];

interface Ctx { inbox: boolean; db: DB; outletId: string; by: string; now: number; can: (a: string) => PermCode; ask: ReturnType<typeof usePin>['ask']; askPic: (a: OnlineAsk, title: string) => void }

export default function Screen() {
  const { page, db, user, me, outletId } = useApp();
  const now = useNow(1000);
  useOnlineAutomation(db, outletId, now);
  const pin = usePin();
  const by = me?.id ?? user.id;
  const embedded = page.shell === 'backoffice' || page.shell === 'admin';
  const view = page.slug === 'delivery-order-kanban' ? 'kanban' : page.slug === 'ride-hailing-integrations' ? 'integrations' : 'hub';
  const can = (a: string) => { const c = perm(db, user.role, a, outletId); return c === 'o' && !(me?.outlets.includes(outletId) ?? user.role === 'owner') ? 'n' : c; };
  const links = pagesOf('online').filter(p => canOpen(user.role, p));
  const c: Ctx = { inbox: links.some(p => p.path === '/online'), db, outletId, by, now, can, ask: pin.ask, askPic: (a, title) => { askOnline(a, title, by, outletId); toast('Sent to the PIC for approval'); } };
  const title = view === 'kanban' ? 'Delivery order kanban' : view === 'integrations' ? 'Ride-hailing integrations' : page.slug === 'ride-hailing-orders-inbox' ? 'Ride-hailing orders' : page.slug === 'online-and-qr-orders-inbox' ? 'Online & QR orders' : 'Online orders';
  return <div style={embedded ? undefined : { minHeight: '100dvh', background: 'var(--bg-canvas)' }}>
    {!embedded && <header className="row wrap" style={{ position: 'sticky', top: 0, zIndex: 20, padding: '10px var(--margin)', gap: 10, background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)' }}>
      <b style={{ fontSize: 18 }}>{title}</b><span className="grow" />
      <nav className="row" style={{ overflowX: 'auto', maxWidth: '100%' }} aria-label="Online pages">{links.filter((p, i, a) => a.findIndex(x => x.title === p.title) === i).map(p =>
        <Link key={p.path} href={p.path} className="btn btn-ghost btn-sm" aria-current={p.path === page.path ? 'page' : undefined} style={{ flex: 'none', fontWeight: p.path === page.path ? 700 : 500, background: p.path === page.path ? 'var(--role-soft)' : undefined }}>{p.title.replace(/ \(.*\)$/, '')}</Link>)}</nav>
      <OutletPicker /><DeviceChrome />
    </header>}
    <div className="stack lg" style={{ padding: embedded ? 0 : '20px var(--margin) 110px', maxWidth: 1360, margin: '0 auto' }}>
      {view === 'kanban' ? <Kanban c={c} title={embedded ? title : null} /> : view === 'integrations' ? <Integrations c={c} title={embedded ? title : null} />
        : <Hub c={c} scope={page.slug === 'ride-hailing-orders-inbox' ? 'platform' : 'all'} title={embedded ? title : null} />}
    </div>
    {pin.sheet}
  </div>;
}

// ── shared bits ─────────────────────────────────────────────────────────────────────────
const ChPill = ({ s }: { s: Source }) => <span style={{ display: 'inline-grid', placeItems: 'center', height: 24, padding: '0 8px', borderRadius: 7, background: CHANNEL[s].color, color: '#fff', font: '800 11px/1 var(--font-display)' }}>{CHANNEL[s].short}</span>;
const TierBadge = ({ o }: { o: Order }) => isScheduled(o) ? <Badge tone="warning">Scheduled</Badge> : o.tier ? <Badge tone={TIER[o.tier].tone === 'danger' ? 'danger' : TIER[o.tier].tone === 'info' ? 'info' : 'neutral'}>{TIER[o.tier].l}</Badge> : null;
const items = (o: Order) => o.lines.map(l => <span key={l.id} style={{ fontSize: 14, fontWeight: 600 }}>{l.qty}× {l.name}{l.mods.length > 0 && <span className="muted" style={{ fontWeight: 400 }}> — {lineMods(l)}</span>}{l.note && <span style={{ color: 'var(--danger-fg)' }}> · {l.note}</span>}</span>);
const dueColor = (o: Order, now: number) => !o.readyBy ? undefined : minsLeft(o.readyBy, now) < 0 ? 'var(--danger-fg)' : minsLeft(o.readyBy, now) < 4 ? 'var(--warning-fg)' : undefined;
const Head = ({ title, sub, right }: { title: string | null; sub: string; right?: ReactNode }) => <div className="row wrap between" style={{ alignItems: 'flex-end' }}>
  <div className="stack sm" style={{ maxWidth: 760 }}>{title && <h1>{title}</h1>}<p className="muted">{sub}</p></div>{right}</div>;
const inScope = (o: Order, scope: 'platform' | 'all') => scope === 'platform' ? isPlatform(o.source) : isPlatform(o.source) || o.source === 'web' || o.source === 'qr';

function Demo({ c }: { c: Ctx }) {
  const run = (ch: Channel, sched = false) => { const e = receiveDemoOrder(c.outletId, ch, sched, c.by); toast(e ? `${e}: the platform isn’t sending orders` : `New ${CHANNEL[ch].name} ${sched ? 'pre-order' : 'order'} received`); };
  return <div className="row wrap" style={{ gap: 6 }}>
    <span className="cap">Demo</span>
    {(['gofood', 'grabfood', 'shopeefood'] as const).map(ch => <button key={ch} type="button" className="btn btn-sm" onClick={() => run(ch)}><Icon name="plus" size={16} />Simulate {CHANNEL[ch].name} order</button>)}
    <button type="button" className="btn btn-sm" onClick={() => run(CHANNELS[Math.floor(Math.random() * 3)], true)}><Icon name="calendar-clock" size={16} />Simulate scheduled order</button>
  </div>;
}

function Banners({ c }: { c: Ctx }) {
  const busy = busyState(c.db, c.outletId, c.now), paused = CHANNELS.map(ch => [ch, channelState(c.db, c.outletId, ch, c.now)] as const).filter(([, s]) => s.paused);
  const waiting = pendingAsk(c.db, c.outletId);
  return <>
    {!c.db.device.online && <div className="banner" role="alert" style={{ background: 'var(--danger-soft)', color: 'var(--danger-fg)' }}><Icon name="wifi-off" /><span><b>Offline.</b> Platforms can’t reach this outlet. New orders wait on the platform and arrive when the connection is back; accepted orders keep cooking.</span></div>}
    {busy.on && <div className="banner" style={{ background: 'var(--warning-soft)', color: 'var(--warning-fg)' }}><Icon name="timer" /><span><b>Busy mode +{busy.extra} min</b> until {hhmm(busy.until)} · {busy.reason}. New platform orders get the longer ready-by.</span></div>}
    {paused.map(([ch, s]) => <div key={ch} className="banner" style={{ background: 'var(--danger-soft)', color: 'var(--danger-fg)' }}><Icon name="pause" /><span><b>{CHANNEL[ch].name} paused</b> until {hhmm(s.pausedUntil)} · {s.pauseReason}. The store shows as closed on {CHANNEL[ch].name}.</span></div>)}
    {waiting.length > 0 && <div className="banner" style={{ background: 'var(--info-soft)', color: 'var(--info-fg)' }}><Icon name="hourglass" /><span>{waiting.length} request{waiting.length > 1 ? 's' : ''} waiting for the PIC: {waiting.map(a => a.title).join(' · ')}</span></div>}
  </>;
}

// ── Hub: inbox, shelf, scheduled, busy ──────────────────────────────────────────────────
function Hub({ c, scope, title }: { c: Ctx; scope: 'platform' | 'all'; title: string | null }) {
  const [tab, setTab] = useState<Tab>('inbox');
  const t0 = startOfDay(c.now);
  const mine = c.db.orders.filter(o => o.outletId === c.outletId && o.createdAt >= t0 && inScope(o, scope));
  const nNew = mine.filter(o => o.status === 'open' && o.lines.length).length, nCook = mine.filter(o => ['sent', 'preparing'].includes(o.status)).length;
  const nShelf = mine.filter(o => o.status === 'ready' && isOnline(o)).length, nSched = mine.filter(o => o.status === 'held' && isScheduled(o)).length;
  return <>
    <Head title={title} sub={scope === 'platform' ? 'GoFood, GrabFood and ShopeeFood orders arrive by themselves. Accept or reject; the kitchen cooks by ready-by time, and bags go on the platform’s shelf for the driver.'
      : 'Platform, web store and QR table orders arrive by themselves. Nobody types them. Accept to send to the kitchen, or reject with a reason.'} />
    <Banners c={c} />
    <div className="grid" style={{ ['--min' as string]: '150px' }}>
      <Kpi label="Needs accept" value={nNew} tone={nNew ? 'warn' : undefined} delta={nNew ? 'Accept before the window closes' : undefined} /><Kpi label="Cooking" value={nCook} />
      <Kpi label="On the shelf" value={nShelf} /><Kpi label="Scheduled · held" value={nSched} />
    </div>
    <div className="row wrap between"><Seg value={tab} onChange={setTab} label="View" options={[['inbox', `Inbox${nNew ? ' · ' + nNew : ''}`], ['shelf', 'Pickup shelf'], ['scheduled', 'Scheduled'], ['busy', 'Busy & pause']] as const} /><Demo c={c} /></div>
    {tab === 'inbox' ? <Inbox c={c} scope={scope} list={mine} /> : tab === 'shelf' ? <Shelf c={c} /> : tab === 'scheduled' ? <Scheduled c={c} /> : <Busy c={c} />}
  </>;
}

function Inbox({ c, scope, list }: { c: Ctx; scope: 'platform' | 'all'; list: Order[] }) {
  const [ch, setCh] = useState<Source | 'all'>('all');
  const [rej, setRej] = useState<Order | null>(null);
  const chans: Source[] = scope === 'platform' ? ['gofood', 'grabfood', 'shopeefood'] : ['gofood', 'grabfood', 'shopeefood', 'web', 'qr'];
  const shown = list.filter(o => (ch === 'all' || o.source === ch) && o.lines.length && (LIVE.includes(o.status) || (o.status === 'voided' && c.now - o.createdAt < 3 * 3600e3)))
    .sort((a, b) => Number(b.status === 'open') - Number(a.status === 'open') || (a.status === 'open' ? a.createdAt - b.createdAt : (a.readyBy ?? a.createdAt) - (b.readyBy ?? b.createdAt)));
  const canAccept = c.can('Accept online order') !== 'n', rejCode = c.can('Reject online order (reason)');
  return <>
    <div className="row" style={{ gap: 6, overflowX: 'auto' }}>{(['all', ...chans] as const).map(k => { const n = list.filter(o => (k === 'all' || o.source === k) && ['open', 'sent', 'preparing', 'ready', 'held'].includes(o.status)).length;
      return <button key={k} type="button" className="chip row" aria-pressed={ch === k} onClick={() => setCh(k)} style={{ height: 40 }}>{k !== 'all' && <i style={{ width: 10, height: 10, borderRadius: 3, background: CHANNEL[k].color }} />}{k === 'all' ? 'All' : CHANNEL[k].name}<span className="faint">{n}</span></button>; })}</div>
    {!shown.length ? <Empty icon="inbox" title="No online orders right now">New orders from the platforms appear here by themselves, with a chime on the register.</Empty>
      : <div className="grid" style={{ ['--min' as string]: '300px' }}>{shown.map(o => {
        const left = ACCEPT_WINDOW_MS - (c.now - o.createdAt), sched = isScheduled(o);
        const st = o.status === 'open' ? 'New · needs accept' : o.status === 'held' ? `Held · fires ${hhmm(fireAt(o))}` : o.status === 'ready' ? (isOnline(o) ? 'On the shelf' : 'Ready') : o.status === 'voided' ? (o.note?.startsWith('Missed') ? 'Missed' : 'Rejected') : 'Cooking';
        return <article key={o.id} className="card flat" style={{ display: 'flex', flexDirection: 'column', borderColor: o.status === 'open' ? 'var(--accent)' : undefined, borderWidth: o.status === 'open' ? 2 : 1, opacity: o.status === 'voided' ? .7 : 1 }}>
          <div style={{ height: 6, background: CHANNEL[o.source].color }} />
          <div className="stack sm" style={{ padding: 14 }}>
            <div className="row wrap"><ChPill s={o.source} /><b className="mono">{o.no}</b><TierBadge o={o} /><span className="grow" /><b style={{ fontSize: 12, color: o.status === 'open' ? 'var(--accent-fg)' : o.status === 'voided' ? 'var(--danger-fg)' : 'var(--success-fg)' }}>{st}</b></div>
            {items(o)}
            <div className="grid" style={{ ['--min' as string]: '120px', gap: 6 }}>
              <span className="sunken" style={{ padding: 8, fontSize: 12 }}>{o.source === 'qr' ? 'Table' : 'Ready by'}<br /><b style={{ fontSize: 16, color: dueColor(o, c.now) }}>{o.source === 'qr' ? o.table ?? '—' : o.readyBy ? `${hhmm(o.readyBy)} · ${dueText(o.readyBy, c.now)}` : '—'}</b></span>
              <span className="sunken" style={{ padding: 8, fontSize: 12 }}>Platform total<br /><b style={{ fontSize: 16 }}>{idr(o.total)}</b></span>
            </div>
            {o.status === 'open' && isPlatform(o.source) && <div className="stack sm" style={{ gap: 4 }}>
              <div style={{ height: 6, borderRadius: 9, background: 'var(--bg-sunken)', overflow: 'hidden' }}><span style={{ display: 'block', height: '100%', width: Math.max(0, left / ACCEPT_WINDOW_MS * 100) + '%', background: left < 60e3 ? 'var(--danger)' : 'var(--accent)' }} /></div>
              <span className="faint" style={{ fontSize: 12 }}>Accept within {mmss(left)} or the platform cancels it{sched ? ` · pre-order, fires to the kitchen at ${hhmm(fireAt(o))}` : ''}</span></div>}
            {o.status === 'open' && <div className="row">
              {canAccept && <button type="button" className="btn btn-primary btn-pos" style={{ flex: 2 }} onClick={() => { accept(o.id, c.by); toast(sched ? `${o.no} accepted · held until ${hhmm(fireAt(o))}` : `${o.no} accepted · sent to the kitchen`); }}>{sched ? 'Accept & hold' : 'Accept'}</button>}
              {rejCode !== 'n' && <button type="button" className="btn btn-pos" style={{ flex: 1, borderColor: rejCode === 'a' ? 'var(--warning)' : undefined }} onClick={() => setRej(o)}>Reject…</button>}
            </div>}
            {o.status === 'voided' && <span className="faint" style={{ fontSize: 12 }}>{o.note}. Logged with the person; the platform notifies the guest.</span>}
            {o.cashierId && o.status !== 'open' && o.status !== 'voided' && <span className="faint" style={{ fontSize: 12 }}>Accepted by {empName(c.db, o.cashierId) ?? (o.cashierId === 'system' ? 'auto-accept' : o.cashierId)}</span>}
          </div>
        </article>; })}</div>}
    <p className="faint" style={{ fontSize: 12 }}>The inbox is read-and-respond only. Nobody can create, edit or re-price an online order in BorNiz. Cancellations and refunds go through the platform and come back as status updates.</p>
    <RejectSheet c={c} o={rej} code={rejCode} onClose={() => setRej(null)} />
  </>;
}

function RejectSheet({ c, o, code, onClose }: { c: Ctx; o: Order | null; code: PermCode; onClose: () => void }) {
  const [pick, setPick] = useState(''), [text, setText] = useState('');
  const reason = pick === 'Other' ? text.trim() : [pick, text.trim()].filter(Boolean).join(' · ');
  const close = () => { setPick(''); setText(''); onClose(); };
  const go = () => {
    if (!o || !reason) return;
    if (code === 'a') c.askPic({ kind: 'reject', orderId: o.id, reason }, `Reject ${CHANNEL[o.source].name} ${o.no} · ${reason}`);
    else { rejectOnline(o.id, reason, c.by); toast(`${o.no} rejected · ${reason}`); }
    close();
  };
  return <Sheet open={!!o} onClose={close} title={`Reject ${o?.no ?? ''}`} sub="The platform tells the guest. Your name and the reason are logged." side="center"
    footer={<><button type="button" className="btn" onClick={close}>Keep order</button><button type="button" className="btn btn-danger" disabled={!reason} onClick={go}>{code === 'a' ? 'Ask PIC to reject' : 'Reject order'}</button></>}>
    <div className="stack">
      <div className="grid" style={{ ['--min' as string]: '150px', gap: 8 }}>{REASONS.map(r => <button key={r} type="button" className="btn" aria-pressed={pick === r} onClick={() => setPick(r)} style={{ borderColor: pick === r ? 'var(--accent)' : undefined, background: pick === r ? 'var(--accent-soft)' : undefined }}>{r}</button>)}</div>
      <Field label="Reason" hint="Required" optional={pick !== '' && pick !== 'Other'}><textarea className="input" value={text} onChange={e => setText(e.target.value)} placeholder={pick === 'Other' ? 'Tell the platform why' : 'Add detail (optional)'} /></Field>
      {code === 'a' && <p className="banner" style={{ background: 'var(--warning-soft)', color: 'var(--warning-fg)' }}>Rejecting needs the PIC’s approval in your role. The order stays in the inbox until the PIC decides.</p>}
    </div>
  </Sheet>;
}

function Shelf({ c }: { c: Ctx }) {
  const [bag, setBag] = useState<Order | null>(null);
  const bt = useMemo(() => bumpTimes(c.db), [c.db]);
  const bags = c.db.orders.filter(o => o.outletId === c.outletId && o.status === 'ready' && isOnline(o));
  return <>
    <div className="grid" style={{ ['--min' as string]: '240px' }}>{CHANNELS.map(ch => { const mine = bags.filter(o => o.source === ch);
      return <section key={ch} className="card flat" style={{ display: 'flex', flexDirection: 'column' }}>
        <div className="row between" style={{ padding: '12px 14px', background: CHANNEL[ch].color, color: '#fff' }}><b>{CHANNEL[ch].name} shelf</b><span style={{ fontSize: 12, fontWeight: 700 }}>{mine.length} bags</span></div>
        <div className="stack sm" style={{ padding: 12 }}>{!mine.length && <span className="faint" style={{ padding: 14, borderRadius: 12, border: '1px dashed var(--border)', textAlign: 'center', fontSize: 13 }}>Empty</span>}
          {mine.map(o => { const w = Math.max(0, Math.round((c.now - (bt.get(o.id) ?? o.createdAt)) / 60e3));
            return <div key={o.id} className="sunken stack sm" style={{ padding: 12 }}>
              <div className="row between" style={{ alignItems: 'baseline' }}><b className="mono" style={{ fontSize: 26, fontWeight: 800, letterSpacing: '.06em' }}>{pickupCode(o)}</b><span style={{ fontSize: 12, fontWeight: 700, color: w >= 10 ? 'var(--danger-fg)' : 'var(--fg-2)' }}>{w ? `waiting ${w} min` : 'just packed'}</span></div>
              <span className="muted" style={{ fontSize: 12 }}>{o.no} · {o.lines.reduce((a, l) => a + l.qty, 0)} items · {TIER[o.tier ?? 'standard'].l}</span>
              <button type="button" className="btn btn-dark" onClick={() => setBag(o)}>Driver here · hand over</button>
            </div>; })}</div>
      </section>; })}</div>
    <p className="faint" style={{ fontSize: 12 }}>Bags sit on their platform’s shelf with the last 4 characters of the order code in big type. Check the code in the driver’s app; when it matches, hand over and the platform gets “picked up”. Bags waiting over 10 minutes alert the PIC.</p>
    <HandOver c={c} o={bag} onClose={() => setBag(null)} />
  </>;
}

function HandOver({ c, o, onClose }: { c: Ctx; o: Order | null; onClose: () => void }) {
  const [code, setCode] = useState(''), [bad, setBad] = useState(false), [reason, setReason] = useState('');
  const close = () => { setCode(''); setBad(false); setReason(''); onClose(); };
  const p = c.can('Hand bag over without pickup code');
  const check = () => { if (!o) return; if (code.trim().toUpperCase() === pickupCode(o)) { handOver(o.id, c.by); toast(`${o.no} picked up · ${CHANNEL[o.source].name} notified`); close(); } else setBad(true); };
  const without = () => {
    if (!o || !reason.trim()) return;
    if (p === 'a') { c.askPic({ kind: 'handover', orderId: o.id, reason: reason.trim() }, `Hand ${o.no} over without pickup code · ${reason.trim()}`); close(); return; }
    c.ask({ title: `Hand ${CHANNEL[o.source].name} ${o.no} over without pickup code`, detail: reason.trim(), verb: 'Approve hand-over', onOk: approver => { handOverWithoutCode(o.id, reason.trim(), approver, c.by); toast(`${o.no} handed over · logged`); close(); } });
  };
  return <Sheet open={!!o} onClose={close} side="center" title={`Hand over ${o?.no ?? ''}`} sub={o ? `${CHANNEL[o.source].name} · ask the driver for the pickup code in their app.` : ''}
    footer={<><button type="button" className="btn" onClick={close}>Cancel</button><button type="button" className="btn btn-primary" disabled={code.trim().length < 4} onClick={check}>Confirm code</button></>}>
    <div className="stack">
      <Field label="Pickup code from the driver" error={bad ? 'Code doesn’t match this bag. Check the platform and the bag label.' : undefined}>
        <input className={'input mono' + (bad ? ' bad' : '')} style={{ fontSize: 24, letterSpacing: '.2em', textTransform: 'uppercase', height: 56 }} maxLength={4} autoFocus value={code} onChange={e => { setCode(e.target.value.toUpperCase()); setBad(false); }} onKeyDown={e => e.key === 'Enter' && check()} aria-label="Pickup code" />
      </Field>
      {bad && p !== 'n' && <div className="sunken stack sm">
        <b>Hand over without the code</b>
        <span className="muted" style={{ fontSize: 13 }}>{p === 'a' ? 'Needs the PIC’s approval in your role. The bag stays on the shelf until the PIC decides.' : 'Needs your approval PIN. The reason and your name are kept on the order.'}</span>
        <Field label="Reason" hint="Required"><input className="input" value={reason} onChange={e => setReason(e.target.value)} placeholder="Driver’s app crashed, code shown on another phone…" /></Field>
        <button type="button" className="btn" style={{ borderColor: 'var(--warning)' }} disabled={!reason.trim()} onClick={without}>{p === 'a' ? 'Ask PIC to approve' : 'Hand over with approval PIN'}</button>
      </div>}
    </div>
  </Sheet>;
}

function Scheduled({ c }: { c: Ctx }) {
  const list = c.db.orders.filter(o => o.outletId === c.outletId && isScheduled(o) && ['open', 'held'].includes(o.status)).sort((a, b) => fireAt(a) - fireAt(b));
  const p = c.can('Fire scheduled order early');
  if (!list.length) return <Empty icon="calendar-clock" title="No scheduled orders">Pre-orders from the platforms are held here and fire to the kitchen at ready-by minus prep time, so a catering order doesn’t clog lunch.</Empty>;
  return <div className="card flat scroll-x"><table className="table"><thead><tr><th>Order</th><th className="hide-sm">Items</th><th>Fires to kitchen</th><th>Ready by</th><th /></tr></thead>
    <tbody>{list.map(o => <tr key={o.id}>
      <td><span className="row"><ChPill s={o.source} /><b className="mono">{o.no}</b></span></td>
      <td className="hide-sm">{o.lines.map(l => `${l.qty}× ${l.name}`).join(', ')}</td>
      <td><b>{hhmm(fireAt(o))}</b> <span className="faint">· {dueText(fireAt(o), c.now).replace('late', 'ago')}</span></td><td>{hhmm(o.readyBy!)}</td>
      <td className="r">{o.status === 'open' ? <Badge tone="accent">Accept in the inbox</Badge> : p !== 'n' && <button type="button" className="btn btn-sm" style={{ borderColor: p === 'a' ? 'var(--warning)' : undefined }}
        onClick={() => { if (p === 'a') c.askPic({ kind: 'fire', orderId: o.id }, `Fire scheduled ${o.no} early`); else { fireScheduled(o.id, c.by); toast(`${o.no} fired to the kitchen`); } }}>Fire now</button>}</td>
    </tr>)}</tbody></table></div>;
}

function Busy({ c }: { c: Ctx }) {
  const p = c.can('Busy mode / pause channel');
  const busy = busyState(c.db, c.outletId, c.now);
  const [extra, setExtra] = useState<'10' | '20'>('10'), [mins, setMins] = useState<'15' | '30'>('30'), [reason, setReason] = useState('');
  const [pauseCh, setPauseCh] = useState<Channel | null>(null), [pMins, setPMins] = useState<'30' | '60'>('30'), [pReason, setPReason] = useState('');
  if (p === 'n') return <Empty icon="lock" title="Busy mode is set by the shift lead">Ask the PIC to add prep time or pause a channel.</Empty>;
  const onBusy = () => { const r = reason.trim(); if (!r) return;
    if (p === 'a') c.askPic({ kind: 'busy', extra: Number(extra) as 10 | 20, minutes: Number(mins), reason: r }, `Busy mode +${extra} min for ${mins} min · ${r}`);
    else { setBusy(c.outletId, Number(extra) as 10 | 20, Number(mins), r, c.by); toast(`Busy mode on · +${extra} min`); }
    setReason(''); };
  const onPause = () => { const r = pReason.trim(); if (!pauseCh || !r) return;
    if (p === 'a') c.askPic({ kind: 'pause', ch: pauseCh, minutes: Number(pMins), reason: r }, `Pause ${CHANNEL[pauseCh].name} for ${pMins} min · ${r}`);
    else { setPause(c.outletId, pauseCh, Number(pMins), r, c.by); toast(`${CHANNEL[pauseCh].name} paused for ${pMins} min`); }
    setPauseCh(null); setPReason(''); };
  return <div className="grid" style={{ ['--min' as string]: '320px' }}>
    <section className="card stack">
      <h3>Busy mode</h3><p className="muted" style={{ fontSize: 14 }}>When the kitchen is behind, add prep time on every platform at once, for {BUSY_MAX_MIN} minutes at most. Orders already accepted keep their ready-by. Dine-in is never paused.</p>
      {busy.on ? <><div className="banner" style={{ background: 'var(--warning-soft)', color: 'var(--warning-fg)' }}><span><b>+{busy.extra} min</b> until {hhmm(busy.until)} · {busy.reason}</span></div>
        <button type="button" className="btn" onClick={() => { setBusy(c.outletId, 0, 0, '', c.by); toast('Busy mode off'); }}>End busy mode</button></>
        : <>
          <div className="row wrap"><Seg value={extra} onChange={setExtra} label="Extra prep" options={[['10', '+10 min'], ['20', '+20 min']] as const} /><Seg value={mins} onChange={setMins} label="For" options={[['15', 'For 15 min'], ['30', 'For 30 min']] as const} /></div>
          <Field label="Reason" hint="Required"><input className="input" value={reason} onChange={e => setReason(e.target.value)} placeholder="Two cooks out, big dine-in group…" /></Field>
          <button type="button" className="btn btn-primary" disabled={!reason.trim()} style={{ borderColor: p === 'a' ? 'var(--warning)' : undefined }} onClick={onBusy}>{p === 'a' ? 'Ask PIC to turn on' : 'Turn on busy mode'}</button></>}
    </section>
    <section className="card stack">
      <h3>Pause a channel</h3><p className="muted" style={{ fontSize: 14 }}>The store shows as closed on that platform for {PAUSE_MAX_MIN} minutes at most, then opens by itself.</p>
      {CHANNELS.map(ch => { const s = channelState(c.db, c.outletId, ch, c.now);
        return <div key={ch} className="row wrap" style={{ padding: '8px 0', borderTop: '1px solid var(--border)' }}>
          <ChPill s={ch} /><b className="grow">{CHANNEL[ch].name}</b>
          {!s.connected ? <Badge>Not connected</Badge> : s.paused ? <><Badge tone="danger">Paused until {hhmm(s.pausedUntil)}</Badge><button type="button" className="btn btn-sm" onClick={() => { setPause(c.outletId, ch, 0, '', c.by); toast(`${CHANNEL[ch].name} open again`); }}>Resume</button></>
            : <><Badge tone="success">Open</Badge><button type="button" className="btn btn-sm" onClick={() => setPauseCh(ch)}>Pause…</button></>}
        </div>; })}
    </section>
    <Sheet open={!!pauseCh} onClose={() => setPauseCh(null)} side="center" title={`Pause ${pauseCh ? CHANNEL[pauseCh].name : ''}`} sub="New orders stop on this platform. Accepted orders keep cooking."
      footer={<><button type="button" className="btn" onClick={() => setPauseCh(null)}>Cancel</button><button type="button" className="btn btn-danger" disabled={!pReason.trim()} onClick={onPause}>{p === 'a' ? 'Ask PIC to pause' : 'Pause channel'}</button></>}>
      <div className="stack"><Seg value={pMins} onChange={setPMins} label="For" options={[['30', '30 min'], ['60', '60 min']] as const} />
        <Field label="Reason" hint="Required"><input className="input" value={pReason} onChange={e => setPReason(e.target.value)} placeholder="Rider queue blocking the door…" /></Field></div>
    </Sheet>
  </div>;
}

// ── Kanban (owner / manager) ────────────────────────────────────────────────────────────
function Kanban({ c, title }: { c: Ctx; title: string | null }) {
  const t0 = startOfDay(c.now);
  const os = c.db.orders.filter(o => o.outletId === c.outletId && o.createdAt >= t0 && (isPlatform(o.source) || o.source === 'web'));
  const pickAt = new Map(c.db.audit.filter(a => a.action === 'online.picked_up').map(a => [a.subject, a.at]));
  const col = (k: string) => k === 'new' ? os.filter(o => o.status === 'open') : k === 'prep' ? os.filter(o => ['held', 'sent', 'preparing'].includes(o.status)) : k === 'ready' ? os.filter(o => o.status === 'ready') : os.filter(o => o.status === 'paid').sort((a, b) => (b.paidAt ?? 0) - (a.paidAt ?? 0));
  const waits = os.filter(o => pickAt.has(o.id)).map(o => (pickAt.get(o.id)! - o.createdAt) / 60e3);
  const late = os.filter(o => ['sent', 'preparing'].includes(o.status) && o.readyBy && o.readyBy < c.now).length;
  const lost = os.filter(o => o.status === 'voided').length;
  const gross = os.filter(o => o.status === 'paid').reduce((a, o) => a + o.total, 0);
  const COLS: [string, string, string][] = [['new', 'New', 'Waiting for accept'], ['prep', 'Preparing', 'Accepted, in the kitchen or held'], ['ready', 'Ready', 'On the pickup shelf'], ['done', 'Picked up', 'Handed to the driver today']];
  return <>
    <Head title={title} sub={`Every platform and web order at ${c.db.outlets.find(o => o.id === c.outletId)?.name} today, moving by itself as the register accepts, the kitchen bumps and drivers pick up.`}
      right={c.inbox && <Link href="/online" className="btn btn-sm"><Icon name="inbox" size={16} />Open the inbox</Link>} />
    <Banners c={c} />
    <div className="grid" style={{ ['--min' as string]: '160px' }}>
      <Kpi label="Online orders today" value={os.length} /><Kpi label="Picked up · gross" value={idr(gross)} /><Kpi label="Late in the kitchen" value={late} tone={late ? 'down' : undefined} delta={late ? 'past ready-by' : undefined} />
      <Kpi label="Rejected or missed" value={lost} /><Kpi label="Order to pickup" value={waits.length ? (waits.reduce((a, b) => a + b, 0) / waits.length).toFixed(0) + ' min' : '—'} />
    </div>
    <Demo c={c} />
    <div className="grid" style={{ ['--min' as string]: '240px', alignItems: 'start' }}>{COLS.map(([k, l, d]) => { const list = col(k);
      return <section key={k} className="stack sm" style={{ padding: 10, borderRadius: 'var(--radius-lg)', background: 'var(--bg-sunken)' }}>
        <div className="row between" style={{ padding: '2px 4px' }}><span><b>{l}</b> <span className="faint" style={{ fontSize: 12 }}>{d}</span></span><Badge tone={k === 'new' && list.length ? 'accent' : 'neutral'}>{list.length}</Badge></div>
        {!list.length && <span className="faint" style={{ padding: 14, borderRadius: 12, border: '1px dashed var(--border)', textAlign: 'center', fontSize: 13 }}>Nothing here</span>}
        {list.slice(0, 12).map(o => <div key={o.id} className="card tight stack sm" style={{ gap: 6 }}>
          <div className="row"><ChPill s={o.source} /><b className="mono">{o.no}</b><TierBadge o={o} /></div>
          <span style={{ fontSize: 13 }}>{o.lines.map(l => `${l.qty}× ${l.name}`).join(', ')}</span>
          <span className="faint" style={{ fontSize: 12 }}>{k === 'done' ? `Picked up ${o.paidAt ? hhmm(o.paidAt) : ''} · ${idr(o.total)}` : o.status === 'held' ? `Scheduled · fires ${hhmm(fireAt(o))}` : o.readyBy ? <span style={{ color: dueColor(o, c.now) }}>Ready by {hhmm(o.readyBy)} · {dueText(o.readyBy, c.now)}</span> : ago(o.createdAt, c.now)}</span>
        </div>)}
        {list.length > 12 && <span className="faint" style={{ fontSize: 12, textAlign: 'center' }}>+{list.length - 12} more</span>}
      </section>; })}</div>
  </>;
}

// ── Integrations (owner) ────────────────────────────────────────────────────────────────
const LOGIN: Record<Channel, string> = { gofood: 'GoBiz merchant account', grabfood: 'GrabMerchant account', shopeefood: 'ShopeeFood Partner account', web: 'BorNiz web store' };
function Integrations({ c, title }: { c: Ctx; title: string | null }) {
  const t0 = startOfDay(c.now);
  const n86 = c.db.outletProducts.filter(x => x.outletId === c.outletId && x.is86).length;
  const live = c.db.outletProducts.filter(x => x.outletId === c.outletId && !x.hidden && !x.is86 && c.db.products.find(p => p.id === x.productId)?.status === 'live').length;
  const busy = busyState(c.db, c.outletId, c.now);
  return <>
    <Head title={title} sub={`Connection and order settings per platform at ${c.db.outlets.find(o => o.id === c.outletId)?.name}. Prep time sent to the platform is calculated from the tier, the channel and the kitchen load, never typed.`} />
    <Banners c={c} />
    <IntegrationsPanel kinds={['delivery']} outletId={c.outletId} title="Platform connection" />
    <div className="grid" style={{ ['--min' as string]: '300px' }}>{CHANNELS.map(ch => { const s = channelState(c.db, c.outletId, ch, c.now), link = c.db.integrations.find(i => i.connector === ch && i.outletId === c.outletId);
      const today = c.db.orders.filter(o => o.outletId === c.outletId && o.source === ch && o.createdAt >= t0);
      return <section key={ch} className="card stack">
        <div className="row"><ChPill s={ch} /><h3 className="grow">{CHANNEL[ch].name}</h3>{!s.connected ? <Badge tone="danger" dot>Disconnected</Badge> : s.paused ? <Badge tone="warning" dot>Paused until {hhmm(s.pausedUntil)}</Badge> : <Badge tone="success" dot>Connected</Badge>}</div>
        <span className="muted" style={{ fontSize: 13 }}>{LOGIN[ch]} · {!link ? 'API not connected yet: orders come in only after the platform connection above is set' : link.status === 'ok' ? 'API connected · duplicate orders ignored' : link.status === 'error' ? 'API error: ' + link.lastError : 'API saved · not tested'}</span>
        <div className="row between"><span>Connected<br /><span className="faint" style={{ fontSize: 12 }}>Off stops new orders from this platform</span></span><Toggle on={s.connected} onChange={v => { setChannel(c.outletId, ch, 'connected', v, c.by); toast(`${CHANNEL[ch].name} ${v ? 'connected' : 'disconnected'}`); }} label={`${CHANNEL[ch].name} connected`} /></div>
        <div className="row between"><span>Auto-accept<br /><span className="faint" style={{ fontSize: 12 }}>Fire to the kitchen without a tap</span></span><Toggle on={s.auto} onChange={v => setChannel(c.outletId, ch, 'auto', v, c.by)} label={`${CHANNEL[ch].name} auto-accept`} /></div>
        <div className="sunken" style={{ fontSize: 13 }}><b>Prep sent to the platform</b><br />{(['rush', 'standard', 'saver'] as const).map(t => `${TIER[t].l} ${Math.round(readyBy(t, ch, 0, 0) / 60e3) + busy.extra} min`).join(' · ')} <span className="faint">+ 1 min per open ticket{busy.on ? ` · busy +${busy.extra}` : ''}</span></div>
        <div className="row between" style={{ fontSize: 13 }}><span className="muted">Menu sync</span><span>{live} items live · {n86} sold out synced</span></div>
        <div className="row between" style={{ fontSize: 13 }}><span className="muted">Today</span><span>{today.length} orders · {idr(today.filter(o => o.status === 'paid').reduce((a, o) => a + o.total, 0))} picked up</span></div>
      </section>; })}</div>
    <p className="faint" style={{ fontSize: 12 }}>Busy mode and channel pauses are run from the online orders screen on the register. Prices on each platform follow the menu price list; orders are never re-priced in BorNiz.</p>
  </>;
}
