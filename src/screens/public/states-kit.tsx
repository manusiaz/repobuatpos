'use client';
// System states (spec/BorNiz States Gallery). Reusable: any screen can import these instead of inventing its own.
// Rules: say what happened, say what to do (one verb), keep work safe, same place, color = meaning, no blame.
import { useEffect, useState, type ReactNode } from 'react';
import Link from '../../ui/Link.tsx';
import { Ctx, useApp } from '../../app/context.tsx';
import { PAGES, pageAt } from '../../system/registry.ts';
import { canOpen } from '../../system/access.ts';
import { setSession } from '../../session.ts';
import { decide, requestApproval, stockEntry, setSetting } from '../../data/actions.ts';
import { queueOffline, syncQueue, setDeviceStatus } from '../../data/actions/states.ts';
import { addRegister, issuePairCode, pairDevice, pairExpiry } from '../../data/actions/auth.ts';
import type { Employee, Role } from '../../data/schema.ts';
import { levelRequired, type Level, type RequestType } from '../../domain/approval.ts';
import { level as stockLevel } from '../../domain/stock.ts';
import { idr } from '../../domain/money.ts';
import { usePin } from '../../ui/PinSheet.tsx';
import { Avatar, Badge, copy, Icon, Numpad, Skeleton, Status, ago, hhmm, toast, useNow, type Tone } from '../../ui/kit.tsx';
import { FEATURE_PLAN, PLANS, includes, planBlock, planOf } from './plans.ts';
export { ProductImporter, SAMPLE_CSV } from './importer.tsx';

export type Kind = 'Empty' | 'Loading' | 'Error' | 'Blocked' | 'Success' | 'Offline';
const TONE: Record<Kind, Tone> = { Empty: 'neutral', Loading: 'info', Error: 'danger', Blocked: 'warning', Success: 'success', Offline: 'warning' };
const soft = (t: Tone) => t === 'neutral' ? 'var(--bg-sunken)' : `var(--${t}-soft)`;
const ink = (t: Tone) => t === 'neutral' ? 'var(--fg-2)' : `var(--${t}-fg)`;

export function StateIcon({ kind, icon, size = 56 }: { kind: Kind; icon: string; size?: number }) {
  const t = TONE[kind];
  return <span style={{ width: size, height: size, borderRadius: size / 3, background: soft(t), color: ink(t), display: 'grid', placeItems: 'center', flex: 'none' }}><Icon name={icon} size={size * .45} /></span>;
}

/** Full state, shown where the content would be. */
export function StatePanel({ kind, icon, kicker, title, children, actions, meta, full }: { kind: Kind; icon: string; kicker?: string; title: string; children?: ReactNode; actions?: ReactNode; meta?: ReactNode; full?: boolean }) {
  return <section className="stack" style={{ alignItems: 'center', textAlign: 'center', justifyContent: 'center', padding: '40px 16px', minHeight: full ? '70dvh' : undefined }} aria-live="polite">
    <StateIcon kind={kind} icon={icon} size={64} />
    {kicker && <span className="cap">{kicker}</span>}
    <h1 style={{ maxWidth: 560 }}>{title}</h1>
    {children && <div className="muted" style={{ maxWidth: 520, fontSize: 16, lineHeight: 1.55 }}>{children}</div>}
    {actions && <div className="row wrap" style={{ justifyContent: 'center' }}>{actions}</div>}
    {meta && <div className="faint" style={{ fontSize: 13 }}>{meta}</div>}
  </section>;
}

/** Compact card used in galleries, side panels and empty modules. */
export function StateCard({ kind, icon, title, children, action, rule, dark }: { kind: Kind; icon: string; title: string; children?: ReactNode; action?: ReactNode; rule?: string; dark?: boolean }) {
  return <div className="card stack sm" data-theme={dark ? 'dark' : undefined} style={{ background: 'var(--bg-surface)', color: 'var(--fg-1)' }}>
    <div className="row between"><StateIcon kind={kind} icon={icon} size={40} /><Badge tone={TONE[kind]}>{kind}</Badge></div>
    <b style={{ fontSize: 16 }}>{title}</b>
    {children && <span className="muted" style={{ fontSize: 14, lineHeight: 1.5 }}>{children}</span>}
    {action}
    {rule && <span className="faint" style={{ fontSize: 12, borderTop: '1px solid var(--border)', paddingTop: 8, marginTop: 'auto' }}><Icon name="ruler" size={12} /> {rule}</span>}
  </div>;
}

// ── Empty states, every module (copy from the States Gallery) ───────────────────────────────
type G = [title: string, kind: Kind, icon: string, desc: string, action: string, rule: string];
export const GALLERY: { id: string; name: string; theme: 'light' | 'dark' | 'brand'; href: string; states: G[] }[] = [
  { id: 'pos', name: 'POS register', theme: 'light', href: '/pos/selling/register-order', states: [['Empty cart', 'Empty', 'shopping-bag', 'Tap a product to start an order.', '', 'Show in the cart panel, never a modal.'], ['Shift not open', 'Blocked', 'clock', 'Open a shift and count your drawer to start selling.', 'Open shift', 'Selling is blocked; history still viewable.'], ['Offline · sales queued', 'Offline', 'wifi-off', 'Sales are saved on this device and sync when you’re back online.', 'View queue', 'Amber banner on top, selling continues.'], ['Needs PIC', 'Blocked', 'shield', 'Void needs the shift PIC’s PIN. Over IDR 100,000 it goes to the manager.', 'Enter PIN', 'In place, same sheet. Log both names.'], ['Card declined', 'Error', 'credit-card', 'The issuer declined the card (code 51). Try another method.', 'Choose method', 'Keep the order; never clear the cart on fail.'], ['Printer offline', 'Error', 'printer', 'Receipt not printed. Send by WhatsApp instead?', 'Send WA', 'Payment is still successful.']] },
  { id: 'online', name: 'Online & delivery', theme: 'light', href: '/online', states: [['No online orders', 'Empty', 'bike', 'GoFood, GrabFood, ShopeeFood and web orders appear here as they come in.', 'Check channels', 'Show which channels are connected and open.'], ['Waiting to accept', 'Blocked', 'bell-ring', 'Accept within 3 min or it goes to the PIC.', 'Accept', 'Repeating sound until accepted.'], ['Past ready-by', 'Error', 'timer-off', 'The guest sees “a little late” in the app.', 'Rush it', 'Red ready-by on KDS; manager sees it at 10 min.'], ['Busy mode on', 'Blocked', 'gauge', 'New orders get +15 min prep. Ends by itself.', 'End busy mode', 'Max 30 min; reason required.'], ['Channel paused', 'Offline', 'circle-pause', 'Paused with a reason. Lost sales are estimated for the owner.', 'Resume', 'Over 60 min goes to manager and owner.'], ['Pickup code mismatch', 'Error', 'shield-alert', 'The rider’s code doesn’t match. Check the app before handing over.', 'Enter PIC PIN', 'Never hand over on a wrong code.']] },
  { id: 'kds', name: 'Kitchen display', theme: 'dark', href: '/kds/order-tickets', states: [['All caught up', 'Empty', 'check-check', 'New tickets appear here with a chime.', '', 'Large, calm, no animation.'], ['Disconnected', 'Offline', 'wifi-off', 'Reconnecting… Tickets are safe on the server.', '', 'Red top bar; keep last tickets visible.'], ['Sound blocked', 'Blocked', 'volume-x', 'Tap once to enable the order chime.', 'Enable sound', 'Browsers need a user gesture.'], ['Screen may sleep', 'Blocked', 'monitor', 'Keep this screen awake in device settings.', 'How to', 'Shown when wake lock is denied.']] },
  { id: 'opname', name: 'Stock count', theme: 'light', href: '/owner/inventory/stock-opname', states: [['Blind count', 'Loading', 'eye-off', 'System quantities are hidden until you submit. Count what you see.', 'Start counting', 'Never show expected qty before submit.'], ['Count locked', 'Blocked', 'lock', 'Submitted counts can’t be edited by anyone. Use Recount to add a corrected line.', 'Recount line', 'Both lines stay in history.'], ['Photo needed', 'Blocked', 'camera', 'Lines with a difference need a photo before sending.', 'Take photo', 'Manager can require photos on every line.'], ['Waiting for sign-off', 'Loading', 'hourglass', 'You can’t approve your own count.', '', '≤ 50k PIC · ≤ 500k manager · > 500k owner.'], ['Stock adjusted', 'Success', 'check-check', 'Posted as Opname adjustment with counter, approver, photos and time.', 'View movement', 'Stock changes only after approval.']] },
  { id: 'so', name: 'Self-order', theme: 'brand', href: '/order/qr-menu/menu-home', states: [['Store closed', 'Blocked', 'moon', 'We open again at 07:00. You can pre-order for later.', 'Pre-order', 'Menu stays browsable.'], ['Ordering paused', 'Blocked', 'timer', 'The kitchen is catching up. Back in about 10 minutes.', 'Notify me', 'Set from KDS or manager.'], ['Item sold out', 'Empty', 'package-x', 'Sold out today. Try a similar item?', 'See similar', 'Suggest one alternative only.'], ['Payment pending', 'Loading', 'loader', 'Waiting for your bank app to confirm…', '', 'Never ask to pay again while pending.'], ['QR expired', 'Error', 'qr-code', 'No money was taken. Generate a new code.', 'New code', 'Keep cart and table.'], ['Table not found', 'Error', 'map-pin-off', 'This QR isn’t linked to a table. Ask a staff member.', 'Call staff', 'Log the QR id.']] },
  { id: 'dash', name: 'Dashboards', theme: 'light', href: '/owner', states: [['No sales yet', 'Empty', 'chart-column', 'No sales today. Charts fill in after the first order.', 'Open register', 'Keep axes; show zero line.'], ['Loading', 'Loading', 'loader', 'Skeleton cards in the same layout as loaded.', '', 'Skip shimmer if < 300ms.'], ['Outlet offline', 'Offline', 'store', 'An outlet hasn’t synced for a while. Data may be late.', 'Details', 'Badge on the outlet row.'], ['No access', 'Blocked', 'lock', 'Your role can’t see profit. Ask the owner.', '', 'Hide the module from nav too.'], ['Plan limit', 'Blocked', 'sparkles', 'Kitchen display is on Pro. Try it free for 14 days.', 'Start trial', 'Show what they’d get.'], ['Export ready', 'Success', 'download', 'Your sales export is ready.', 'Download', 'Also sent by email.']] },
  { id: 'loyalty', name: 'Loyalty', theme: 'brand', href: '/owner/more-studios-marketing/loyalty-rules-and-rewards-catalog', states: [['No rewards yet', 'Empty', 'gift', 'One more coffee to your first reward!', 'See menu', 'Always show distance to next reward.'], ['Points expiring', 'Blocked', 'hourglass', 'Some beans expire at the end of the month.', 'Redeem', 'Also sent via WhatsApp 14 days before.'], ['Tier upgraded', 'Success', 'award', 'Welcome to Gold! 1.25× beans from now on.', 'See benefits', 'Spring + confetti, once.'], ['Not a member', 'Empty', 'user-plus', 'Join with your phone number to earn on this order.', 'Join free', 'One field only.']] },
];

export function EmptyGallery() {
  const [k, setK] = useState(GALLERY[0].id);
  const g = GALLERY.find(x => x.id === k)!;
  return <div className="stack">
    <div className="row wrap" role="tablist">{GALLERY.map(x => <button key={x.id} className="chip" aria-pressed={x.id === k} onClick={() => setK(x.id)}>{x.name}</button>)}</div>
    <div className="row between wrap"><span className="muted" style={{ fontSize: 14 }}>{g.states.length} states · {g.theme === 'dark' ? 'dark theme' : g.theme === 'brand' ? 'merchant brand' : 'light theme'}</span><Link href={g.href} className="btn btn-sm">Open {g.name}<Icon name="arrow-right" size={16} /></Link></div>
    <div className="grid" style={{ ['--min' as string]: '260px' }} data-guest={g.theme === 'brand' ? '' : undefined}>
      {g.states.map(([t, kind, icon, d, a, rule]) => <StateCard key={t} kind={kind} icon={icon} title={t} rule={rule} dark={g.theme === 'dark'}
        action={a ? <button className="btn btn-sm" style={g.theme === 'brand' ? { background: 'var(--bn-p)', borderColor: 'var(--bn-p)', color: 'var(--ink-0)', alignSelf: 'flex-start' } : { alignSelf: 'flex-start' }} onClick={() => toast(`${a} · ${g.name}`)}>{a}</button> : undefined}>{d}</StateCard>)}
    </div>
  </div>;
}

// ── Loading ─────────────────────────────────────────────────────────────────────────────
export function LoadingSkeleton({ layout = 'dashboard' }: { layout?: 'dashboard' | 'list' | 'pos' | 'detail' }) {
  if (layout === 'list') return <div className="stack" aria-busy="true"><div className="row"><Skeleton h={40} w={240} /><span className="grow" /><Skeleton h={40} w={120} /></div>{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} h={48} />)}</div>;
  if (layout === 'pos') return <div className="row" style={{ alignItems: 'stretch', gap: 16 }} aria-busy="true">
    <div className="grow grid" style={{ ['--min' as string]: '120px' }}>{Array.from({ length: 12 }, (_, i) => <div key={i} className="stack sm"><Skeleton h={90} /><Skeleton h={14} w="70%" /></div>)}</div>
    <div className="stack hide-sm" style={{ width: 280 }}><Skeleton h={28} w="50%" />{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} h={40} />)}<span className="grow" /><Skeleton h={72} /></div>
  </div>;
  if (layout === 'detail') return <div className="stack" aria-busy="true"><Skeleton h={32} w="45%" /><Skeleton h={16} w="70%" /><div className="grid" style={{ ['--min' as string]: '200px' }}>{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} h={64} />)}</div><Skeleton h={220} /></div>;
  return <div className="stack" aria-busy="true">
    <div className="grid" style={{ ['--min' as string]: '180px' }}>{Array.from({ length: 4 }, (_, i) => <div key={i} className="card stack sm"><Skeleton h={12} w="50%" /><Skeleton h={28} w="70%" /><Skeleton h={12} w="40%" /></div>)}</div>
    <div className="card"><Skeleton h={220} /></div>
    <div className="card stack sm">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} h={40} />)}</div>
  </div>;
}

// ── Errors & blocked pages ──────────────────────────────────────────────────────────────
export function NotFoundState({ full = true }: { full?: boolean }) {
  const [q, setQ] = useState('');
  const hits = q.length < 2 ? [] : PAGES.filter(p => (p.name + ' ' + p.group).toLowerCase().includes(q.toLowerCase())).slice(0, 6);
  return <StatePanel full={full} kind="Error" icon="search-x" kicker="404" title="This page doesn’t exist"
    actions={<><Link className="btn btn-primary" href="/">Go home</Link><Link className="btn" href="/help-center-and-tutorials">Help center</Link></>}
    meta={<div className="stack sm" style={{ width: 'min(420px,90vw)', marginTop: 8 }}>
      <input className="search" placeholder={`Search ${PAGES.length} pages`} value={q} onChange={e => setQ(e.target.value)} aria-label="Search pages" />
      {hits.map(p => <Link key={p.path} href={p.path} className="nav-i" style={{ textAlign: 'left' }}><span className="grow">{p.name}</span><Badge>{p.role}</Badge></Link>)}
    </div>}>Check the link, or search for the page you wanted.</StatePanel>;
}

export function ServerErrorState({ onRetry }: { onRetry?: () => void }) {
  const [id] = useState(() => 'req_' + Math.random().toString(36).slice(2, 10));
  return <StatePanel full kind="Error" icon="server-crash" kicker="500" title="Something broke on our side"
    actions={<><button className="btn btn-primary" onClick={() => (onRetry ? onRetry() : location.reload())}>Try again</button><Link className="btn" href="/system-status">System status</Link></>}
    meta={<span className="row" style={{ justifyContent: 'center' }}>Request ID <span className="mono">{id}</span><button className="btn btn-ghost btn-sm" onClick={() => copy(id, 'Request ID copied')}>Copy</button></span>}>
    We’ve been notified. Nothing you entered was lost. If it keeps happening, send support the request ID below.
  </StatePanel>;
}

export function MaintenanceState() {
  return <StatePanel full kind="Blocked" icon="wrench" kicker="Scheduled maintenance" title="Back at 03:00 WIB"
    actions={<Link className="btn btn-primary" href="/system-status">See system status</Link>}
    meta="Registers, the kitchen display and the customer display keep working offline; sales sync when we’re back.">
    We’re upgrading the database between 01:00 and 03:00 WIB. Dashboards and reports are read-only until then.
  </StatePanel>;
}

export function SessionExpiredState() {
  const { db, outletId } = useApp();
  const drafts = db.orders.filter(o => o.outletId === outletId && (o.status === 'open' || o.status === 'held')).length;
  return <StatePanel full kind="Blocked" icon="log-out" kicker="Session expired" title="Log in again to continue"
    actions={<Link className="btn btn-primary btn-lg" href="/account/login">Log in</Link>}
    meta="For your security we sign you out after 12 hours, or 30 minutes idle on shared devices.">
    Your work is saved. {drafts > 0 ? `${drafts} open ${drafts === 1 ? 'order is' : 'orders are'} kept on this outlet and will be there after you log in.` : 'Forms and drafts are kept on this device.'}
  </StatePanel>;
}

export function AccessDeniedState({ path }: { path?: string }) {
  const { db, user, me } = useApp();
  const target = (path && pageAt(path)) || PAGES.find(p => p.surface === 'owner') || PAGES[0];
  const allowed = canOpen(user.role, target);
  const who = db.employees.filter(e => e.active && canOpen(e.role, target)).slice(0, 4);
  return <StatePanel full kind="Blocked" icon="shield-x" kicker="Access denied" title="You don’t have access to this page"
    actions={<>{who.map(e => <button key={e.id} className="btn" onClick={() => setSession({ id: e.id, role: e.role, outletId: e.outlets[0] })}>Sign in as {e.name} · {e.role}</button>)}<Link className="btn btn-ghost" href="/">Go back</Link></>}
    meta={allowed ? <>You can open it now: <Link href={target.path}>{target.title}</Link></> : 'The page stays hidden from your navigation too.'}>
    Signed in as <b>{me?.name ?? user.role}</b> ({user.role}). <b>{target.title}</b> is for {target.role === 'owner' ? 'the owner and managers' : target.role}. Ask the owner if you need it.
  </StatePanel>;
}

// ── Approval: action needs someone above you (in place, same sheet, both names logged) ──────
const RANK: Record<Level, number> = { cashier: 0, pic: 1, manager: 2, owner: 3 };
const levelOf = (r: Role): Level => r === 'owner' ? 'owner' : r === 'manager' ? 'manager' : r === 'pic' ? 'pic' : 'cashier';

export function NeedsApproval({ type, title, amount = 0, pct = 0, subjectId = null, payload, onApproved }: { type: RequestType; title: string; amount?: number; pct?: number; subjectId?: string | null; payload?: Record<string, unknown>; onApproved?: () => void }) {
  const app = useApp(), { db, me, outletId } = app;
  const pin = usePin();
  const requester = me ?? db.employees.find(e => e.role === 'cashier' && e.outlets.includes(outletId))!;
  const lvl = levelRequired(type, amount, pct);
  const approvers = db.employees.filter(e => e.active && e.id !== requester.id && e.approvalPin && RANK[levelOf(e.role)] >= RANK[lvl] && (e.role === 'owner' || e.outlets.includes(outletId)));
  const [who, setWho] = useState<Employee | null>(null), [result, setResult] = useState<'approved' | 'sent' | null>(null);
  const ask = (e: Employee) => {
    setWho(e);
    pin.ask({ title, detail: `${requester.name} asks · ${e.name} approves. Both names go to the audit log.`, verb: `${e.name}, enter your approval PIN`, onOk: by => {
      const r = requestApproval({ type, title, amount, pct, requestedBy: requester.id, outletId, subjectId, payload });
      const err = r.level === 'cashier' ? null : decide(r.id, by, 'approved');
      if (err) return toast(err);
      setResult('approved'); toast(`Approved by ${e.name}`); onApproved?.();
    } });
  };
  const send = () => { requestApproval({ type, title, amount, pct, requestedBy: requester.id, outletId, subjectId, payload }); setResult('sent'); toast(`Sent to ${lvl}`); };
  // The approver signs on this device: the PIN sheet verifies their PIN, not the signed-in person's.
  const ctx = who ? { ...app, me: who, user: { id: who.id, role: who.role, outletId } } : app;
  if (result) return <StatePanel kind="Success" icon={result === 'approved' ? 'badge-check' : 'send'} title={result === 'approved' ? 'Approved, you can continue' : `Sent to the ${lvl}`}
    actions={<button className="btn" onClick={() => setResult(null)}>Done</button>}>{result === 'approved' ? `${who?.name} approved “${title}”. Logged with both names.` : 'You’ll get an alert when they decide. Keep serving; the order stays open.'}</StatePanel>;
  return <div className="card stack" style={{ maxWidth: 560, width: '100%', margin: '0 auto' }}>
    <div className="row"><StateIcon kind="Blocked" icon="shield" size={44} /><div className="grow stack sm" style={{ gap: 2 }}><b style={{ fontSize: 18 }}>Needs {lvl === 'pic' ? 'the shift PIC' : 'a ' + lvl}</b><span className="muted" style={{ fontSize: 14 }}>{title}{amount ? ' · ' + idr(amount) : ''}</span></div></div>
    <p className="muted" style={{ fontSize: 14 }}>Your role can’t do this alone. {lvl === 'pic' ? 'Within PIC limits (void/refund ≤ IDR 100,000, discount ≤ 20%).' : lvl === 'manager' ? 'Over the PIC limit, so a manager signs.' : 'Over IDR 500,000 or owner-only, so the owner signs.'} Nobody approves their own request.</p>
    {approvers.length ? <div className="stack sm">{approvers.slice(0, 4).map(e => <button key={e.id} className="btn btn-pos" style={{ justifyContent: 'flex-start' }} onClick={() => ask(e)}><Avatar name={e.name} color={e.color} size={32} />{e.name}<span className="grow" /><Badge>{e.role}</Badge><Icon name="key-round" size={18} /></button>)}</div>
      : <p className="warn" style={{ fontSize: 14 }}>Nobody with that level is on this outlet now. Send it to the queue instead.</p>}
    <button className="btn btn-ghost" onClick={send}>Send to {lvl} queue instead</button>
    <Ctx.Provider value={ctx}>{pin.sheet}</Ctx.Provider>
  </div>;
}

// ── Devices ─────────────────────────────────────────────────────────────────────────────
export function OfflineBanner() {
  const { db } = useApp();
  if (db.device.online && !db.device.queue.length) return null;
  return <div className="banner" role="status" style={{ background: 'var(--warning-soft)', color: 'var(--warning-fg)', alignItems: 'center' }}>
    <Icon name="wifi-off" /><span className="grow"><b>{db.device.online ? 'Back online' : 'Offline'}</b> · {db.device.queue.length} queued. Sales are saved on this device and sync when you’re back online.</span>
    {db.device.online && <button className="btn btn-sm" onClick={syncQueue}>Sync now</button>}
  </div>;
}

export function OfflineSync() {
  const { db } = useApp();
  const q = db.device.queue, online = db.device.online;
  const last = db.audit.find(a => a.action === 'device.synced');
  return <div className="stack" style={{ maxWidth: 640, width: '100%', margin: '0 auto' }}>
    <StatePanel kind={online ? (q.length ? 'Loading' : 'Success') : 'Offline'} icon={online ? (q.length ? 'refresh-cw' : 'cloud-check') : 'wifi-off'} kicker={online ? 'Online' : 'Offline'}
      title={online ? (q.length ? `${q.length} waiting to sync` : 'Everything is synced') : `Offline · ${q.length} queued`}
      actions={online ? <>{q.length > 0 && <button className="btn btn-primary" onClick={syncQueue}>Sync now</button>}<button className="btn" onClick={() => queueOffline('order.created · test sale')}>Go offline and ring a test sale</button></>
        : <><button className="btn" onClick={() => queueOffline('order.created · test sale')}>Ring a test sale offline</button><button className="btn btn-primary" onClick={syncQueue}>Reconnect & sync</button></>}
      meta={last ? `Last synced ${ago(last.at)}` : 'Not synced from this device yet'}>
      {online ? 'This device talks to the server in real time. If the internet drops, selling continues and sales are queued here.' : 'Sales are saved on this device with an idempotency key and sync when you’re back online. No duplicates after reconnect.'}
    </StatePanel>
    {q.length > 0 && <div className="card flat"><table className="table"><thead><tr><th>Queued action</th><th className="r">Saved</th></tr></thead>
      <tbody>{q.map(x => <tr key={x.id}><td><span className="mono">{x.id.slice(0, 8)}</span> · {x.action}</td><td className="r">{hhmm(x.at)}</td></tr>)}</tbody></table></div>}
  </div>;
}

export function PrinterOffline({ outletId: only }: { outletId?: string }) {
  const { db, me, user } = useApp();
  const printers = db.devices.filter(d => d.kind === 'printer' && (!only || d.outletId === only));
  const down = printers.filter(p => p.status === 'offline');
  const name = (id: string) => db.outlets.find(o => o.id === id)?.name;
  if (!printers.length) return <StatePanel kind="Empty" icon="printer" title="No printer set up" actions={<Link className="btn btn-primary" href="/owner/account/devices">Add a printer</Link>}>Receipts go by WhatsApp or email until you pair one.</StatePanel>;
  return <div className="stack" style={{ maxWidth: 680, width: '100%', margin: '0 auto' }}>
    <StatePanel kind={down.length ? 'Error' : 'Success'} icon="printer" kicker="Printer" title={down.length ? 'Receipt not printed' : 'All printers online'}
      actions={down.length ? <><button className="btn btn-primary" onClick={() => toast('Receipt sent by WhatsApp')}>Send by WhatsApp</button><Link className="btn" href="/owner/account/devices">Devices settings</Link></> : undefined}>
      {down.length ? 'The payment is still successful. Send the receipt by WhatsApp, or reconnect the printer and reprint from history.' : 'Receipts and kitchen tickets will print as normal.'}
    </StatePanel>
    <div className="card flat">{printers.map(p => <div key={p.id} className="row" style={{ padding: '12px 16px', borderTop: '1px solid var(--border)' }}>
      <Icon name="printer" /><div className="grow stack sm" style={{ gap: 0 }}><b style={{ fontSize: 14 }}>{p.name}</b><span className="faint" style={{ fontSize: 13 }}>{name(p.outletId)} · last seen {p.lastSeen ? ago(p.lastSeen) : 'never'}</span></div>
      <Status s={p.status} />
      {p.status === 'offline' ? <button className="btn btn-sm" onClick={() => { setDeviceStatus(p.id, 'online', me?.id ?? user.id); toast(p.name + ' reconnected'); }}>Reconnect</button>
        : <button className="btn btn-sm btn-ghost" onClick={() => setDeviceStatus(p.id, 'offline', me?.id ?? user.id)}>Disconnect</button>}
    </div>)}</div>
    {down.length > 0 && <div className="sunken stack sm" style={{ fontSize: 14 }}><b>Check, in this order</b><span>1. Printer is on and the paper roll isn’t empty.</span><span>2. Bluetooth is on and the tablet is within 5 m, or the LAN cable is in.</span><span>3. Tap Reconnect. If it still fails, restart the printer.</span></div>}
  </div>;
}

export function GatewayDown() {
  const { db, outletId } = useApp();
  const now = useNow(5000);
  const pays = db.payments.filter(p => p.outletId === outletId);
  const pending = pays.filter(p => p.status === 'pending');
  const lastOk = (m: string) => pays.filter(p => p.method === m && p.status === 'settled').reduce((a, p) => Math.max(a, p.at), 0);
  const edc = db.devices.find(d => d.kind === 'edc' && d.outletId === outletId);
  const rows: [string, string, boolean][] = [['QRIS', 'qris', false], ['Virtual account', 'va', false], ['E-wallet', 'ewallet', false], ['Card on EDC', 'card', edc?.status === 'online'], ['Cash', 'cash', true]];
  return <div className="stack" style={{ maxWidth: 680, width: '100%', margin: '0 auto' }}>
    <StatePanel kind="Error" icon="credit-card" kicker="Payment gateway" title="QRIS and e-wallet can’t be confirmed right now"
      actions={<><Link className="btn btn-primary" href="/pos/selling/register-order">Take cash or card</Link><Link className="btn" href="/system-status">System status</Link></>}>
      The gateway isn’t answering. Pending payments are kept and confirm by themselves when it’s back. Never ask a guest to pay twice.
    </StatePanel>
    <div className="card flat">{rows.map(([l, m, up]) => <div key={m} className="row" style={{ padding: '12px 16px', borderTop: '1px solid var(--border)' }}>
      <span className="grow"><b style={{ fontSize: 14 }}>{l}</b><br /><span className="faint" style={{ fontSize: 13 }}>{lastOk(m) ? 'Last confirmed ' + ago(lastOk(m), now) : 'No payments yet'}</span></span>
      <Badge tone={up ? 'success' : 'danger'} dot>{up ? 'Available' : 'Down'}</Badge></div>)}</div>
    {pending.length > 0 && <div className="card stack sm"><b>Waiting for the gateway · {pending.length}</b>{pending.map(p => <div key={p.id} className="row between" style={{ fontSize: 14 }}><span className="mono">{p.ref}</span><span>{idr(p.amount)}</span><Status s="pending" /></div>)}</div>}
  </div>;
}

/** Offline count vs server stock. Server is the source of truth; a different count becomes an adjustment request. */
export function SyncConflict({ stockItemId, deviceQty, countedAt }: { stockItemId: string; deviceQty: number; countedAt: number }) {
  const { db, me, user, outletId } = useApp();
  const it = db.stockItems.find(s => s.id === stockItemId)!;
  const server = Math.round(stockLevel(db.movements, outletId, stockItemId) * 100) / 100;
  const key = `conflict:${outletId}:${stockItemId}:${countedAt}`, done = db.settings[key];
  const by = me?.id ?? user.id, diff = Math.round((deviceQty - server) * 100) / 100;
  const pick = (c: 'server' | 'device') => {
    if (c === 'device') stockEntry('adjust', outletId, stockItemId, diff, 'Offline count on this device', by);
    setSetting(key, c, by); toast(c === 'device' ? 'Adjustment sent for approval' : 'Kept the server value');
  };
  if (done) return <StatePanel kind="Success" icon="check-check" title="Conflict resolved"
    actions={<button className="btn" onClick={() => setSetting(key, '', by)}>Show again</button>}>
    {done === 'device' ? `Your count of ${deviceQty} ${it.unit} was sent as an adjustment. Stock changes when it’s approved.` : `Kept ${server} ${it.unit} from the server.`}
  </StatePanel>;
  return <div className="stack" style={{ maxWidth: 680, width: '100%', margin: '0 auto' }}>
    <StatePanel kind="Blocked" icon="git-compare" kicker="Sync conflict" title={`${it.name} changed while you were offline`}>Pick which number is right. Nothing is overwritten silently, and both are kept in the audit log.</StatePanel>
    <div className="grid" style={{ ['--min' as string]: '240px' }}>
      <button className="card stack sm" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => pick('server')}><span className="cap">Server · live</span><span className="num" style={{ fontSize: 32 }}>{server} {it.unit}</span><span className="muted" style={{ fontSize: 13 }}>Sales, receipts and counts from every device</span><span className="btn btn-primary btn-sm" style={{ alignSelf: 'flex-start' }}>Keep server</span></button>
      <button className="card stack sm" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => pick('device')}><span className="cap">This device · {hhmm(countedAt)}</span><span className="num" style={{ fontSize: 32 }}>{deviceQty} {it.unit}</span><span className="muted" style={{ fontSize: 13 }}>Difference {diff > 0 ? '+' : ''}{diff} {it.unit} · {idr(Math.round(Math.abs(diff) * it.unitCost))}</span><span className="btn btn-sm" style={{ alignSelf: 'flex-start' }}>Use my count</span></button>
    </div>
  </div>;
}

/** Register pairing: Owner › Devices issues a 6-digit code (10 min); the tablet types it. */
export function PairDevice({ outletId, onPaired }: { outletId: string; onPaired?: (deviceId: string) => void }) {
  const { db, me } = useApp();
  const now = useNow(1000);
  const regs = db.devices.filter(d => d.kind === 'pos' && d.outletId === outletId);
  const [sel, setSel] = useState<string | null>(null), [code, setCode] = useState(''), [err, setErr] = useState('');
  const dev = regs.find(r => r.id === sel);
  const owner = me?.id ?? db.employees.find(e => e.role === 'owner')!.id;
  const left = dev ? pairExpiry(db, dev.id) - now : 0;
  const atLimit = planBlock(db, 'pos', outletId);
  useEffect(() => { setCode(''); setErr(''); }, [sel]);
  const key = (k: string) => {
    if (k === 'del') return setCode(c => c.slice(0, -1));
    if (!/^\d$/.test(k)) return;
    const c = (code + k).slice(0, 6); setCode(c); setErr('');
    if (c.length === 6 && dev) { const e = pairDevice(dev.id, c); if (e) { setErr(e); setCode(''); } else { toast(dev.name + ' paired'); onPaired?.(dev.id); } }
  };
  if (!dev) return <div className="stack">
    {regs.map(r => <button key={r.id} className="card tight row" style={{ cursor: 'pointer', textAlign: 'left' }} onClick={() => setSel(r.id)}>
      <Icon name="monitor-smartphone" /><span className="grow"><b>{r.name}</b><br /><span className="faint" style={{ fontSize: 13 }}>{db.device.paired.pos === r.id ? 'Paired to this tablet' : r.lastSeen ? 'Last seen ' + ago(r.lastSeen) : 'Never paired'}</span></span><Status s={r.status} /><Icon name="chevron-right" /></button>)}
    {atLimit ? <div className="banner" style={{ background: 'var(--warning-soft)', color: 'var(--warning-fg)' }}><Icon name="sparkles" /><span className="grow">{atLimit} <Link href="/account/choose-plan">Upgrade</Link></span></div>
      : <button className="btn" onClick={() => setSel(addRegister(outletId, owner))}><Icon name="plus" size={18} />Add a register</button>}
  </div>;
  return <div className="stack" onKeyDown={e => key(e.key === 'Backspace' ? 'del' : e.key)} tabIndex={-1}>
    <button className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setSel(null)}><Icon name="arrow-left" size={16} />All registers</button>
    <b style={{ fontSize: 18 }}>Pair {dev.name}</b>
    <span className="muted" style={{ fontSize: 14 }}>Open Owner › Devices on a phone or laptop, tap “Pair” on {dev.name} and type the 6-digit code here. Codes work for 10 minutes.</span>
    <div className={'row' + (err ? ' shake' : '')} style={{ gap: 8 }} aria-label={`${code.length} of 6 digits`}>{Array.from({ length: 6 }, (_, i) => <span key={i} className="num" style={{ flex: 1, height: 56, borderRadius: 'var(--radius-sm)', border: '1.5px solid ' + (i === code.length ? 'var(--accent)' : 'var(--border)'), background: 'var(--bg-surface)', display: 'grid', placeItems: 'center', fontSize: 24 }}>{code[i] ?? ''}</span>)}</div>
    {err && <span role="alert" style={{ color: 'var(--danger-fg)', fontSize: 14 }}>{err}</span>}
    <Numpad onKey={key} extra="" />
    <div className="sunken row wrap" style={{ fontSize: 14 }}>
      {dev.pairCode && left > 0 ? <><span className="grow">Code in Owner › Devices: <b className="mono" style={{ fontSize: 16 }}>{dev.pairCode}</b></span><Badge tone="info">expires in {Math.floor(left / 60e3)}:{String(Math.floor(left / 1000) % 60).padStart(2, '0')}</Badge></>
        : <><span className="grow">{dev.pairCode ? 'The last code expired.' : 'No code issued yet.'}</span><button className="btn btn-sm" onClick={() => { issuePairCode(dev.id, owner); setErr(''); }}>Issue a code as owner</button></>}
    </div>
  </div>;
}

export function DeviceNotPaired() {
  const { db } = useApp();
  const [outlet, setOutlet] = useState(db.device.outletId);
  const paired = db.devices.find(d => d.id === db.device.paired.pos);
  return <div className="stack" style={{ maxWidth: 520, width: '100%', margin: '0 auto' }}>
    <StatePanel kind={paired ? 'Success' : 'Blocked'} icon="tablet-smartphone" kicker="This device" title={paired ? `Paired as ${paired.name}` : 'This tablet isn’t paired yet'}>
      {paired ? `Selling at ${db.outlets.find(o => o.id === paired.outletId)?.name}. Pair again to move it to another register.` : 'Pair it to a register so sales land in the right outlet and drawer.'}
    </StatePanel>
    <select className="input" value={outlet} onChange={e => setOutlet(e.target.value)} aria-label="Outlet">{db.outlets.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select>
    <PairDevice outletId={outlet} />
  </div>;
}

export function UpgradeWall({ need }: { need?: string }) {
  const { db } = useApp();
  const have = db.tenant.plan, plan = planOf(have);
  const locked = FEATURE_PLAN.filter(([, p]) => !includes(have, p));
  const feature = (need && FEATURE_PLAN.find(([f]) => f === need)) || locked[0];
  const regs = db.devices.filter(d => d.kind === 'pos').length;
  const usage: [string, number, number][] = [['Outlets', db.outlets.length, plan.outlets], ['Registers', regs, plan.registers]];
  const next = feature ? planOf(feature[1]) : null;
  return <div className="stack" style={{ maxWidth: 720, width: '100%', margin: '0 auto' }}>
    {next ? <StatePanel kind="Blocked" icon="sparkles" kicker={`You’re on ${plan.name}`} title={`${feature![0]} is on ${next.name}`}
      actions={<>{next.id === 'enterprise' ? <Link className="btn btn-primary btn-lg" href="/contact-sales-book-a-demo">Contact sales</Link> : <Link className="btn btn-primary btn-lg" href="/account/choose-plan">Try {next.name} free for 14 days</Link>}<Link className="btn btn-lg" href="/pricing">Compare plans</Link></>}
      meta="No card needed for the trial. Your data stays if you go back.">
      Here’s what you’d get with {next.name}:
    </StatePanel> : <StatePanel kind="Success" icon="crown" title={`You’re on ${plan.name}`}>Every feature is included. Talk to your success manager for more outlets.</StatePanel>}
    {next && <div className="grid" style={{ ['--min' as string]: '220px' }}>{FEATURE_PLAN.filter(([, p]) => p === next.id).map(([f]) => <div key={f} className="card tight row"><Icon name="check" style={{ color: 'var(--success)' }} /><span style={{ fontSize: 14 }}>{f}</span></div>)}</div>}
    <div className="card stack sm"><b>Usage on {plan.name}</b>{usage.map(([l, n, max]) => {
      const pct = max === Infinity ? 0 : Math.min(100, (n / max) * 100);
      return <div key={l} className="stack sm" style={{ gap: 4 }}><div className="row between" style={{ fontSize: 14 }}><span>{l}</span><span className="num">{n} / {max === Infinity ? 'unlimited' : max}</span></div>
        <div style={{ height: 8, borderRadius: 99, background: 'var(--bg-sunken)' }}><div style={{ width: pct + '%', height: '100%', borderRadius: 99, background: pct >= 100 ? 'var(--danger)' : pct >= 80 ? 'var(--warning)' : 'var(--success)' }} /></div></div>;
    })}<span className="faint" style={{ fontSize: 12 }}>Plans: {PLANS.map(p => p.name).join(' · ')}</span></div>
  </div>;
}

/** Hook for screens that only need to know whether to show a skeleton (skip shimmer under 300 ms). */
export function useSlow(ms = 300) { const [slow, setSlow] = useState(false); useEffect(() => { const t = setTimeout(() => setSlow(true), ms); return () => clearTimeout(t); }, [ms]); return slow; }
