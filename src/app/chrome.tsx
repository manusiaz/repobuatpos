'use client';
// Shared chrome on every staff app: Apps launcher (⌘K, "nobody types URLs"), alerts bell, user switch, outlet picker.
import { useEffect, useMemo, useState } from 'react';
import Link from '../ui/Link.tsx';
import catalog from '../system/catalog.json' with { type: 'json' };
import { PAGES, PROTOTYPE, surfaceHome, type Surface } from '../system/registry.ts';
import { canOpen, canReach } from '../system/access.ts';
import { homeOf } from '../system/pagemap.ts';
import { Icon, Sheet, ago, Avatar, Badge, Field, Seg, toast } from '../ui/kit.tsx';
import { myTickets, openSupportTicket } from '../data/actions/admin.ts';
import type { Rec } from '../data/schema.ts';
import { markRead } from '../data/actions.ts';
import { isSharedDevice, setSession } from '../session.ts';
import { DEMO_HERE, setDemo } from '../data/remote.ts';
import { industryHides } from '../system/tools.ts';
import { useApp } from './context.tsx';

const SURFACE_OF: Record<string, Surface> = Object.fromEntries(Object.entries(PROTOTYPE).map(([s, p]) => [p, s as Surface]));

export function Launcher() {
  const { user, go, db } = useApp();
  const [open, setOpen] = useState(false), [q, setQ] = useState('');
  useEffect(() => { const k = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen(o => !o); } }; addEventListener('keydown', k); return () => removeEventListener('keydown', k); }, []);
  // Studios › Industry templates: no kitchen display or waiter app for retail, salon or laundry
  const apps = catalog.apps.filter(a => a.roles.includes(user.role) && SURFACE_OF[a.screen] && canReach(user.role, surfaceHome(SURFACE_OF[a.screen])) && !industryHides(db, SURFACE_OF[a.screen]));
  const hits = useMemo(() => q.length < 2 ? [] : PAGES.filter(p => canOpen(user.role, p) && (p.name + ' ' + p.group).toLowerCase().includes(q.toLowerCase())).slice(0, 30), [q, user.role]);
  return <>
    <button className="btn btn-ghost btn-sm" onClick={() => setOpen(true)} aria-label="Apps"><Icon name="layout-grid" size={18} /><span className="hide-sm">Apps</span><span className="mono faint hide-sm">⌘K</span></button>
    <Sheet open={open} onClose={() => setOpen(false)} side="center" title="Apps & pages" sub="Every BorNiz app you can use, and search across all pages.">
      <div className="stack">
        <input className="search" autoFocus placeholder="Search pages: opname, QRIS, payroll…" value={q} onChange={e => setQ(e.target.value)} />
        {hits.length > 0 ? <div className="stack sm">{hits.map(p => <Link key={p.path} href={p.path} onClick={() => setOpen(false)} className="nav-i"><span className="grow">{p.name}<br /><span className="faint" style={{ fontSize: 12 }}>{p.role} · {p.group}</span></span><Badge>{homeOf(p.path)?.title ?? p.prototype}</Badge></Link>)}</div>
          : <div className="grid" style={{ ['--min' as string]: '200px' }}>{apps.map(a => <button key={a.name} className="card tight row" style={{ cursor: 'pointer', textAlign: 'left' }} onClick={() => { setOpen(false); go(surfaceHome(SURFACE_OF[a.screen])); }}>
            <span style={{ width: 40, height: 40, borderRadius: 12, background: a.color, display: 'grid', placeItems: 'center', color: 'var(--ink-0)', flex: 'none' }}><Icon name={a.icon} /></span>
            <span className="stack" style={{ gap: 0 }}><b style={{ fontSize: 14 }}>{a.name}</b><span className="muted" style={{ fontSize: 12 }}>{a.job}</span></span></button>)}</div>}
      </div>
    </Sheet>
  </>;
}

export function Bell() {
  const { db, user, outletId } = useApp();
  const [open, setOpen] = useState(false);
  const mine = db.notices.filter(n => (n.to.includes(user.role) || user.role === 'owner') && (!n.outletId || user.role === 'owner' || n.outletId === outletId));
  const unread = mine.filter(n => !n.read).length;
  return <>
    <button className="btn btn-ghost btn-sm" onClick={() => setOpen(true)} aria-label={`Alerts, ${unread} unread`} style={{ position: 'relative' }}><Icon name="bell" size={18} />{unread > 0 && <span className="badge b-accent" style={{ position: 'absolute', top: -4, right: -6, height: 18, padding: '0 6px', fontSize: 12 }}>{unread}</span>}</button>
    <Sheet open={open} onClose={() => setOpen(false)} title="Alerts" sub="Routed by the alert engine to your role and outlet." footer={<button className="btn" onClick={() => markRead('all', user.id)}>Mark all read</button>}>
      <div className="stack">{mine.length === 0 && <p className="muted">Nothing needs you right now.</p>}
        {mine.slice(0, 60).map(n => <div key={n.id} className="row" style={{ alignItems: 'flex-start', opacity: n.read ? .6 : 1 }}>
          <Badge tone={n.level === 'high' ? 'danger' : n.level === 'warn' ? 'warning' : 'info'} dot>{n.alert}</Badge>
          <div className="grow stack sm" style={{ gap: 2 }}><span style={{ fontSize: 14 }}>{n.text}</span><span className="faint" style={{ fontSize: 12 }}>{ago(n.at)}{n.href && <> · <Link href={n.href} onClick={() => { markRead(n.id, user.id); setOpen(false); }}>Open</Link></>}</span></div>
        </div>)}</div>
    </Sheet>
  </>;
}

/** Demo sign-in switch. Production: account + 2FA for owner/manager, PIN on paired devices. */
export function UserSwitch({ compact }: { compact?: boolean }) {
  const { db, me, user, outletId } = useApp();
  const [open, setOpen] = useState(false);
  return <>
    <button className="btn btn-ghost btn-sm" onClick={() => setOpen(true)} aria-label="Switch user"><Avatar name={me?.name ?? user.role} color={me?.color} size={26} />{!compact && <span className="hide-sm">{me?.name ?? 'Admin'} · {user.role}</span>}</button>
    <Sheet open={open} onClose={() => setOpen(false)} side="center" title="Switch user" sub="Each tab keeps its own sign-in, so you can run POS, kitchen and owner side by side.">
      <div className="stack sm">
        {[...db.employees.map(e => ({ id: e.id, role: e.role, name: e.name, color: e.color, outlets: e.outlets })), { id: 'admin', role: 'admin' as const, name: 'BorNiz admin', color: '#7C3AED', outlets: ['sen'] }].map(e =>
          <button key={e.id} className="nav-i" style={{ border: 0, background: e.id === user.id ? 'var(--role-soft)' : 'none', cursor: 'pointer', textAlign: 'left' }}
            onClick={() => { setSession({ id: e.id, role: e.role, outletId: e.outlets.includes(outletId) ? outletId : e.outlets[0] }); setOpen(false); }}>
            <Avatar name={e.name} color={e.color} size={32} /><span className="grow">{e.name}</span><Badge>{e.role}</Badge></button>)}
        <button className="btn btn-ghost" onClick={() => { setSession(null); setOpen(false); }}>Sign out (back to default for this app)</button>
        {DEMO_HERE && <button className="btn" onClick={() => setDemo(false)}><Icon name="log-out" size={18} />Leave the demo, log in to my business</button>}
      </div>
    </Sheet>
  </>;
}

export function OutletPicker() {
  const { db, user, outletId, setOutlet, me } = useApp();
  const mine = user.role === 'owner' || user.role === 'admin' ? db.outlets : db.outlets.filter(o => me?.outlets.includes(o.id));
  if (mine.length < 2) return <span className="badge"><Icon name="store" size={14} />{db.outlets.find(o => o.id === outletId)?.name}</span>;
  return <select className="input" style={{ height: 36, width: 'auto', fontSize: 14, borderRadius: 10 }} value={outletId} onChange={e => setOutlet(e.target.value)} aria-label="Outlet">
    {mine.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select>;
}

/** Help: the day-to-day tasks for your role (Operations Guide) and the rules that apply. Each task opens its app. */
export function Help() {
  const { user, page } = useApp();
  const [open, setOpen] = useState(false);
  const tasks = (catalog.help as unknown as Record<string, [string, string, [string, string][]][]>)[user.role] ?? [];
  const m = page.mode;
  return <>
    <button className="btn btn-ghost btn-sm" onClick={() => setOpen(true)} aria-label="Help"><Icon name="circle-question-mark" size={18} /><span className="hide-sm">Help</span></button>
    <Sheet open={open} onClose={() => setOpen(false)} title="Help" sub={`${page.title} · ${m === 'record' ? 'created at the POS, read only here' : m === 'incoming' ? 'incoming: accept, update or reply' : m === 'approve' ? 'approve or reject with your approval PIN' : 'what you do here, step by step'}`}>
      <div className="stack lg">
        {tasks.length === 0 && <p className="muted">Guests and BorNiz staff don’t have a task list. Ask your manager.</p>}
        {tasks.map(([when, title, list]) => <section key={when} className="stack sm"><span className="cap">{when} · {title}</span>
          {list.map(([t, app]) => { const s = SURFACE_OF[app]; return <div key={t} className="row between" style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}><span style={{ fontSize: 14 }}>{t}</span>{s ? <Link className="btn btn-sm" href={surfaceHome(s)} onClick={() => setOpen(false)}>Show me</Link> : <span className="faint" style={{ fontSize: 12 }}>{app}</span>}</div>; })}
        </section>)}
        {(user.role === 'owner' || user.role === 'manager') && (isSharedDevice()
          ? <p className="muted" style={{ fontSize: 14 }}>To contact BorNiz support, sign in as the owner or a manager on a phone or laptop. A shared register can't.</p> : <Support />)}
        <section className="stack sm"><span className="cap">Rules everyone follows</span>{(catalog.rules as unknown as [string, string, string, [string, string][]][]).slice(0, 6).map(([t, , where, rs]) => <details key={t}><summary style={{ cursor: 'pointer', fontWeight: 600 }}>{t} <span className="faint" style={{ fontWeight: 400 }}>· {where}</span></summary><ul style={{ margin: '6px 0', paddingLeft: 18, fontSize: 14 }}>{rs.map(([m, x]) => <li key={x}><b>{m}</b> {x}</li>)}</ul></details>)}</section>
      </div>
    </Sheet>
  </>;
}

/** Help › Contact BorNiz support (owner / manager): the ticket lands in the console's Support tickets; replies come back
 *  as its status here. */
function Support() {
  const { user } = useApp();
  const [mine, setMine] = useState<(Rec & { m?: string })[] | null>(null), [f, setF] = useState({ a: '', m: '', c: 'normal' as 'normal' | 'high' }), [busy, setBusy] = useState(false);
  const load = () => myTickets().then(setMine, () => setMine([]));
  useEffect(() => { void load(); }, []);
  const send = async () => {
    setBusy(true); const no = await openSupportTicket(f.a, f.m, f.c, user.id); setBusy(false);
    if (no) return toast(no);
    toast('Sent to BorNiz support'); setF({ a: '', m: '', c: 'normal' }); void load();
  };
  return <section className="stack sm"><span className="cap">Contact BorNiz support</span>
    <Field label="Subject"><input className="input" maxLength={120} value={f.a} onChange={e => setF({ ...f, a: e.target.value })} placeholder="What is wrong, in a few words" /></Field>
    <Field label="What happened"><textarea className="input" rows={4} maxLength={4000} value={f.m} onChange={e => setF({ ...f, m: e.target.value })} placeholder="Where, when, and what you expected" /></Field>
    <Seg label="Priority" value={f.c} onChange={c => setF({ ...f, c })} options={[['normal', 'Normal'], ['high', 'Sales are blocked']]} />
    <button className="btn btn-primary" style={{ alignSelf: 'flex-start' }} disabled={busy || f.a.trim().length < 3 || f.m.trim().length < 3} onClick={send}>Send to support</button>
    {mine?.map(t => <div key={t.id} className="row between" style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}><span className="stack" style={{ gap: 0 }}><b style={{ fontSize: 14 }}>{t.a}</b><span className="faint" style={{ fontSize: 12 }}>{t.id} · {ago(t.at)}</span></span>
      <Badge tone={t.d === 'solved' ? 'success' : t.d === 'waiting' ? 'warning' : 'info'} dot>{t.d === 'waiting' ? 'Waiting on you' : t.d === 'solved' ? 'Solved' : 'Open'}</Badge></div>)}
  </section>;
}

/** Apps, help, alerts and user for full-screen device apps (POS, KDS, PIC, waiter, online). Sits in each app's own
 * header or rail, never floating: on a phone the bottom belongs to the app's one action bar (Responsive spec). */
export function DeviceChrome({ dark, vertical }: { dark?: boolean; vertical?: boolean }) {
  return <div className={'dev-chrome' + (vertical ? ' v' : '')} data-theme={dark ? 'dark' : undefined}>
    <Help /><Launcher /><Bell /><UserSwitch compact />
  </div>;
}
