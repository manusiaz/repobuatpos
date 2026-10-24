'use client';
// Single entry for every route. Resolves the registry page → session → access → shell → surface (screen or template).
import { useCallback, useEffect, useMemo, useState, type ComponentType } from 'react';
import { REMOTE } from '../data/remote.ts';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { pageAt, type Page, type Surface } from '../system/registry.ts';
import { canOpen } from '../system/access.ts';
import { useDB } from '../data/store.ts';
import { escalateDue, watchKitchen } from '../data/actions.ts';
import { endTrialIfDue } from '../data/actions/business.ts';
import { sweepAlerts } from '../data/alerts/index.ts';
import { setMoneyStyle } from '../domain/money.ts';
import { moneyFormat, roleTheme } from '../system/tools.ts';
import { leaveFor } from '../system/hosts.ts';
import { useDispatcher } from '../data/actions/dispatch.ts';
import { usePrintAgent } from '../devices/agent.ts';
import { setSession, useSession } from '../session.ts';
import { Ctx, type AppCtx } from './context.tsx';
import { BackOfficeShell, PublicShell } from './Shells.tsx';
import { useOffline } from './offline.ts';
import { Loading, Toaster, Icon } from '../ui/kit.tsx';
import Link from '../ui/Link.tsx';
import { UpgradeWall } from '../screens/public/states-kit.tsx';
import { FEATURE, pageLock } from '../screens/public/plans.ts';
import { HELD_OBJECTS, HOLD_DAYS, billingStage, unpaidSince } from '../data/billing.ts';

const L = (f: () => Promise<{ default: ComponentType }>) => dynamic(f, { ssr: false, loading: () => <div style={{ padding: 24 }}><Loading /></div> });
const SURFACES: Record<Surface, ComponentType> = {
  backoffice: L(() => import('../templates/BackOffice.tsx')),
  landing: L(() => import('../screens/landing.tsx')), auth: L(() => import('../screens/auth.tsx')),
  owner: L(() => import('../screens/owner.tsx')), manager: L(() => import('../screens/manager.tsx')), ownerMobile: L(() => import('../screens/ownerMobile.tsx')),
  pic: L(() => import('../screens/pic.tsx')), pos: L(() => import('../screens/pos.tsx')), online: L(() => import('../screens/online.tsx')),
  display: L(() => import('../screens/display.tsx')), kds: L(() => import('../screens/kds.tsx')), waiter: L(() => import('../screens/waiter.tsx')),
  selforder: L(() => import('../screens/selforder.tsx')), kiosk: L(() => import('../screens/kiosk.tsx')),
  admin: L(() => import('../screens/admin.tsx')), states: L(() => import('../screens/states.tsx')), shifts: L(() => import('../screens/shifts.tsx')),
  loyalty: L(() => import('../screens/loyalty.tsx')), studios: L(() => import('../screens/studios.tsx')), brand: L(() => import('../screens/brand.tsx')),
  menu: L(() => import('../screens/menu.tsx')), roles: L(() => import('../screens/roles.tsx')), graph: L(() => import('../screens/graph.tsx')),
};
const DARK: Partial<Record<Surface, true>> = { kds: true, display: true };
const WARM = () => [import('../screens/pos.tsx'), import('../screens/pic.tsx'), import('../screens/online.tsx'), import('../screens/waiter.tsx'),
  import('../screens/kds.tsx'), import('../screens/display.tsx'), import('../screens/owner.tsx'), import('../screens/manager.tsx')];
// selforder / kiosk: a guest link to no business (wrong slug) shows its own "not available" state
const NO_OUTLET: Partial<Record<Surface, true>> = { landing: true, auth: true, states: true, graph: true, admin: true, selforder: true, kiosk: true };
const GUEST: Partial<Record<Surface, true>> = { selforder: true, kiosk: true, display: true, landing: true, auth: true };

export default function App({ path }: { path: string }) {
  const page = pageAt(path) as Page;
  const db = useDB();
  const user = useSession(page.surface, page.role);
  const staff = ['pos', 'pic', 'kds', 'online', 'waiter'].includes(page.surface);
  usePrintAgent(staff, page.surface === 'pos'); // only the register stands in for an unpaired outlet register
  useOffline(!!db, WARM);
  const staffDevice = !['selforder', 'kiosk', 'display', 'landing', 'public', 'auth'].includes(page.surface); // guests never run staff work
  useDispatcher(staffDevice);
  const router = useRouter();
  const [outlet, setOutlet] = useState<string | null>(null);
  // the outlet in use is always one of this business's outlets: a choice made while the data was still loading
  // (or an outlet since removed) falls back to the person's own, then the device's, then the first
  const here = (id?: string | null) => !!id && !!db?.outlets.some(o => o.id === id);
  const outletId = here(outlet) ? outlet! : [user?.outletId, db?.device.outletId, db?.outlets[0]?.id].find(here) ?? user?.outletId ?? '';
  useEffect(() => { if (db && user && outletId && outletId !== outlet) setOutlet(outletId); }, [db, user, outlet, outletId]);
  // staff alerts, escalations and late-kitchen checks run on staff devices only (a guest phone may not write them)
  useEffect(() => { if (!staffDevice) return; const tick = () => { endTrialIfDue(); escalateDue(); watchKitchen(); sweepAlerts(); }; tick(); const t = setInterval(tick, 60e3); return () => clearInterval(t); }, [staffDevice]);
  const slug = db?.tenant.id; // the business slug (remote store) = its <slug>.bornis.id
  const go = useCallback((p: string) => { const away = leaveFor(p, slug); if (away) location.assign(away); else router.push(p); }, [router, slug]);
  // a business always has an outlet: none yet means its data is still arriving, and every business screen reads its outlet
  const loaded = !!db && (db.outlets.length > 0 || NO_OUTLET[page.surface]);
  const ctx = useMemo<AppCtx | null>(() => db && user && loaded ? { page, db, user, me: db.employees.find(e => e.id === user.id), outletId, setOutlet, go } : null, [page, db, user, loaded, outletId, go]);
  if (!ctx) return <div style={{ padding: 24 }}><Loading /></div>;
  setMoneyStyle(...moneyFormat(ctx.db, page.surface, ctx.outletId)); // Studios: price display rules, number format per outlet
  const rt = roleTheme(ctx.db, ctx.user.role); // Studios: theme per role (accent, density, dark)
  const Surface = SURFACES[page.surface];
  const allowed = canOpen(ctx.user.role, page);
  const held = page.shell === 'backoffice' && ['edit', 'settings', 'studio'].includes(page.mode) && HELD_OBJECTS.has(page.object ?? '') && billingStage(ctx.db) === 'hold';
  const lock = pageLock(ctx.db.tenant.plan, page.path); // a feature above this plan: the upgrade card over the page, read-only (spec lg-gate)
  const body = <>{!GUEST[page.surface] && page.surface !== 'admin' && <PlatformBanner />}{!allowed ? <Denied /> : held ? <div className="stack lg" style={{ padding: 16 }}><div className="banner b-danger" role="status"><Icon name="lock" size={18} />Read-only until the BorNiz invoice is paid. Sales carry on.</div><div inert style={{ contain: 'paint' }}><Surface /></div></div>
    : !lock ? <Surface />
    : GUEST[page.surface] ? <div className="empty" style={{ minHeight: '70dvh', justifyContent: 'center' }}><Icon name="concierge-bell" size={40} /><h2 style={{ color: 'var(--fg-1)' }}>Please order at the counter</h2>
      {(ctx.user.role === 'owner' || ctx.user.role === 'manager') && <Link href="/owner/account/subscription-billing">{FEATURE[lock]} is on Pro · Subscription</Link>}</div> // a guest screen: guests never see the plan
    : <div className="stack lg" style={{ padding: 16 }}><UpgradeWall need={FEATURE[lock]} /><div inert style={{ contain: 'paint' }}><Surface /></div></div>}</>; // paint containment keeps a sheet's fixed scrim inside the page, under the wall
  return <Ctx.Provider value={ctx}>
    <div data-theme={DARK[page.surface] || (rt?.dark && !GUEST[page.surface]) ? 'dark' : undefined} data-role={ctx.user.role} style={{ minHeight: '100dvh', background: 'var(--bg-canvas)', color: 'var(--fg-1)', ...(GUEST[page.surface] ? {} : rt?.style) }}>
      {page.shell === 'backoffice' || page.shell === 'admin' ? <BackOfficeShell>{body}</BackOfficeShell> : page.shell === 'public' ? <PublicShell>{body}</PublicShell> : body}
      <Toaster />
    </div>
  </Ctx.Provider>;
}

/** What BorNiz set for this business (super admin): paused, or a paid plan on trial. */
function PlatformBanner() {
  return <Ctx.Consumer>{c => {
    const t = c?.db.tenant;
    if (!c || !t) return null;
    if (t.status === 'suspended') return <div className="banner b-danger" role="alert"><Icon name="circle-pause" size={18} />BorNiz paused this business: changes are not saved and the QR menu is off. Contact BorNiz support.</div>;
    const boss = c.user.role === 'owner' || c.user.role === 'manager', stage = boss ? billingStage(c.db) : null, since = unpaidSince(c.db) ?? Date.now();
    if (stage === 'hold') return <div className="banner b-danger" role="alert"><Icon name="lock" size={18} />A BorNiz invoice is unpaid for {HOLD_DAYS} days: menu, prices, promos, outlets and stock set-up are read-only until it is paid. Sales carry on. <Link href="/owner/account/subscription-billing">Subscription billing</Link></div>;
    if (stage === 'overdue') return <div className="banner b-warning" role="status"><Icon name="receipt-text" size={18} />A BorNiz invoice is unpaid for {Math.floor((Date.now() - since) / 864e5)} days. From day {HOLD_DAYS} the set-up is read-only until it is paid. <Link href="/owner/account/subscription-billing">Subscription billing</Link></div>;
    if (t.trialUntil && t.trialUntil > Date.now() && boss)
      return <div className="banner b-info"><Icon name="calendar" size={18} />{t.plan[0].toUpperCase() + t.plan.slice(1)} trial until {new Date(t.trialUntil).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}. After that the business is on Free unless the plan is paid. <Link href="/owner/account/subscription-billing">Subscription</Link></div>;
    return null;
  }}</Ctx.Consumer>;
}

/** System state: Access denied (States gallery). Offers the sign-ins that may open this page. */
function Denied() {
  return <Ctx.Consumer>{c => c && <div className="empty" style={{ minHeight: '70dvh', justifyContent: 'center' }}>
    <Icon name="shield-x" size={40} /><h2 style={{ color: 'var(--fg-1)' }}>You don’t have access to this page</h2>
    <p>Signed in as <b>{c.me?.name ?? c.user.role}</b> ({c.user.role}). {c.page.name} is for {c.page.surface === 'admin' ? 'BorNiz staff' : 'another role'}.</p>
    <div className="row wrap" style={{ justifyContent: 'center' }}>
      {c.db.employees.filter(e => canOpen(e.role, c.page)).slice(0, 4).map(e => <button key={e.id} className="btn" onClick={() => setSession({ id: e.id, role: e.role, outletId: e.outlets[0] })}>Sign in as {e.name} · {e.role}</button>)}
      {c.page.surface === 'admin' && !REMOTE && <button className="btn" onClick={() => setSession({ id: 'admin', role: 'admin', outletId: 'sen' })}>Sign in as BorNiz admin</button>}
    </div>
  </div>}</Ctx.Consumer>;
}
