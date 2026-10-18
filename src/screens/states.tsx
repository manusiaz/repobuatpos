'use client';
// System states (spec/BorNiz States Gallery). Every state is a real, reusable component from ./public/states-kit.tsx;
// this screen shows each one on its own URL with live data.
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Ctx, useApp } from '../app/context.tsx';
import { seed } from '../data/seed.ts';
import { pagesOf } from '../system/registry.ts';
import { level as stockLevel } from '../domain/stock.ts';
import { Icon, Seg } from '../ui/kit.tsx';
import {
  AccessDeniedState, DeviceNotPaired, EmptyGallery, GatewayDown, LoadingSkeleton, MaintenanceState, NeedsApproval, NotFoundState,
  OfflineBanner, OfflineSync, PrinterOffline, ProductImporter, SAMPLE_CSV, ServerErrorState, SessionExpiredState, SyncConflict, UpgradeWall,
} from './public/states-kit.tsx';

const RULES = [['Say what happened', 'in plain words, no error codes as the headline.'], ['Say what to do', 'one clear action, as a verb.'], ['Keep work safe', 'never clear a cart, form or draft on error.'], ['Same place', 'show the state where the content would be.'], ['Color = meaning', 'amber blocked/offline, red error, green success, ink empty.'], ['No blame', '“Card declined”, not “You entered a wrong card”.']];

export default function Screen() {
  const app = useApp();
  // the gallery shows each state with demo data; a visitor on a live deployment has no business of their own yet
  const demo = useMemo(() => (app.db.outlets.length ? null : seed()), [app.db]);
  return demo ? <Ctx.Provider value={{ ...app, db: demo, me: demo.employees.find(e => e.role === 'owner'), outletId: demo.outlets[0].id }}><Gallery /></Ctx.Provider> : <Gallery />;
}
function Gallery() {
  const { page } = useApp();
  const pages = pagesOf('states');
  const full = ['404-not-found', '500-server-error', 'maintenance', 'session-expired', 'access-denied'].includes(page.slug);
  return <div className="stack lg" style={{ maxWidth: 1200, margin: '0 auto', padding: '16px var(--margin) 64px' }}>
    <header className="stack sm">
      <div className="row between wrap"><Link href="/" className="row" style={{ font: '700 20px var(--font-display)', color: 'var(--fg-1)', letterSpacing: '-.03em' }}>BorNiz</Link><span className="cap">System states · {pages.indexOf(page) + 1} of {pages.length}</span></div>
      <nav className="row" style={{ overflowX: 'auto', paddingBottom: 4 }} aria-label="System states">
        {pages.map(p => <Link key={p.path} href={p.path} className="chip row" aria-current={p.path === page.path ? 'page' : undefined} style={{ textDecoration: 'none', color: p.path === page.path ? 'var(--bg-surface)' : 'var(--fg-1)', background: p.path === page.path ? 'var(--fg-1)' : undefined }}>{p.title}</Link>)}
      </nav>
    </header>
    {!full && <div className="stack sm"><h1>{page.title}</h1></div>}
    <main><View slug={page.slug} /></main>
    <details className="card"><summary style={{ cursor: 'pointer', fontWeight: 600 }}>How we write every state</summary>
      <div className="grid" style={{ ['--min' as string]: '240px', marginTop: 12 }}>{RULES.map(([k, v]) => <div key={k} style={{ fontSize: 14 }}><b>{k}</b> <span className="muted">{v}</span></div>)}</div>
    </details>
  </div>;
}

function View({ slug }: { slug: string }) {
  switch (slug) {
    case 'empty-states': return <EmptyGallery />;
    case 'loading-skeleton': return <Skeletons />;
    case '404-not-found': return <NotFoundState />;
    case '500-server-error': return <ServerErrorState />;
    case 'maintenance': return <MaintenanceState />;
    case 'offline-and-sync': return <div className="stack"><OfflineBanner /><OfflineSync /></div>;
    case 'plan-limit-upgrade-wall': return <UpgradeWall />;
    case 'session-expired': return <SessionExpiredState />;
    case 'access-denied': return <AccessDeniedState path="/owner" />;
    case 'permission-denied-for-action': return <Permission />;
    case 'device-not-paired': return <DeviceNotPaired />;
    case 'printer-offline': return <PrinterOffline />;
    case 'payment-gateway-down': return <GatewayDown />;
    case 'sync-conflict-resolution': return <Conflict />;
    case 'data-import-progress-and-errors': return <div className="card" style={{ maxWidth: 820 }}><ProductImporter initial={SAMPLE_CSV} /></div>;
  }
  return <NotFoundState full={false} />;
}

function Skeletons() {
  const [l, setL] = useState<'dashboard' | 'list' | 'pos' | 'detail'>('dashboard');
  return <div className="stack">
    <div className="row wrap between"><Seg value={l} onChange={setL} label="Layout" options={[['dashboard', 'Dashboard'], ['list', 'List'], ['pos', 'Register'], ['detail', 'Detail']]} /><span className="faint" style={{ fontSize: 13 }}>Same layout as loaded · skip shimmer under 300 ms</span></div>
    <LoadingSkeleton layout={l} />
  </div>;
}

function Permission() {
  const { db } = useApp();
  const p = db.products.find(x => x.id === 'p4') ?? db.products[0];
  return <div className="stack" style={{ alignItems: 'center' }}>
    <p className="muted" style={{ maxWidth: 560, textAlign: 'center' }}><Icon name="info" size={16} /> A cashier tried to void 4× {p.name}. Over the PIC limit, so it needs a manager’s approval PIN on this register.</p>
    <NeedsApproval type="void" title={`Void 4× ${p.name} · guest changed order`} amount={p.basePrice * 4} />
  </div>;
}

function Conflict() {
  const { db, outletId } = useApp();
  const it = db.stockItems.find(s => s.id === 'oat') ?? db.stockItems[0];
  const server = stockLevel(db.movements, outletId, it.id);
  // The offline count from this tablet, taken in the last hour (stable within the hour so the resolution sticks).
  const [at] = useState(() => Math.floor(Date.now() / 3600e3) * 3600e3 - 18 * 60e3);
  const [qty] = useState(() => Math.max(0, Math.round((server - Math.max(1, server * .15)) * 10) / 10));
  return <SyncConflict stockItemId={it.id} deviceQty={qty} countedAt={at} />;
}
