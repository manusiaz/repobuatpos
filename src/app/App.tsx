'use client';
// Single entry for every route. Resolves the registry page → session → access → shell → surface (screen or template).
import { useCallback, useEffect, useMemo, useState, type ComponentType } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { pageAt, type Page, type Surface } from '../system/registry.ts';
import { canOpen } from '../system/access.ts';
import { useDB } from '../data/store.ts';
import { setSession, useSession } from '../session.ts';
import { Ctx, type AppCtx } from './context.tsx';
import { BackOfficeShell, PublicShell } from './Shells.tsx';
import { DeviceChrome } from './chrome.tsx';
import { Loading, Toaster, Icon } from '../ui/kit.tsx';

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

export default function App({ path }: { path: string }) {
  const page = pageAt(path) as Page;
  const db = useDB();
  const user = useSession(page.surface, page.role);
  const router = useRouter();
  const [outlet, setOutlet] = useState<string | null>(null);
  useEffect(() => { if (db && !outlet) setOutlet(user?.outletId ?? db.device.outletId); }, [db, user, outlet]);
  const go = useCallback((p: string) => router.push(p), [router]);
  const ctx = useMemo<AppCtx | null>(() => db && user ? { page, db, user, me: db.employees.find(e => e.id === user.id), outletId: outlet ?? user.outletId, setOutlet, go } : null, [page, db, user, outlet, go]);
  if (!ctx) return <div style={{ padding: 24 }}><Loading /></div>;
  const Surface = SURFACES[page.surface];
  const allowed = canOpen(ctx.user.role, page);
  const body = allowed ? <Surface /> : <Denied />;
  const staffDevice = ['pos', 'pic', 'kds', 'online', 'waiter'].includes(page.surface);
  return <Ctx.Provider value={ctx}>
    <div data-theme={DARK[page.surface] ? 'dark' : undefined} data-role={ctx.user.role} style={{ minHeight: '100dvh', background: 'var(--bg-canvas)', color: 'var(--fg-1)' }}>
      {page.shell === 'backoffice' || page.shell === 'admin' ? <BackOfficeShell>{body}</BackOfficeShell> : page.shell === 'public' ? <PublicShell>{body}</PublicShell> : body}
      {staffDevice && allowed && <DeviceChrome dark={DARK[page.surface]} />}
      <Toaster />
    </div>
  </Ctx.Provider>;
}

/** System state: Access denied (States gallery). Offers the sign-ins that may open this page. */
function Denied() {
  return <Ctx.Consumer>{c => c && <div className="empty" style={{ minHeight: '70dvh', justifyContent: 'center' }}>
    <Icon name="shield-x" size={40} /><h2 style={{ color: 'var(--fg-1)' }}>You don’t have access to this page</h2>
    <p>Signed in as <b>{c.me?.name ?? c.user.role}</b> ({c.user.role}). {c.page.name} is for {c.page.surface === 'admin' ? 'BorNiz staff' : 'another role'}.</p>
    <div className="row wrap" style={{ justifyContent: 'center' }}>
      {c.db.employees.filter(e => canOpen(e.role, c.page)).slice(0, 4).map(e => <button key={e.id} className="btn" onClick={() => setSession({ id: e.id, role: e.role, outletId: e.outlets[0] })}>Sign in as {e.name} · {e.role}</button>)}
      {c.page.surface === 'admin' && <button className="btn" onClick={() => setSession({ id: 'admin', role: 'admin', outletId: 'sen' })}>Sign in as BorNiz admin</button>}
    </div>
  </div>}</Ctx.Consumer>;
}
