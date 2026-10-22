'use client';
import { useMemo, useState, type ReactNode } from 'react';
import Link from '../ui/Link.tsx';
import { PAGES, surfaceHome } from '../system/registry.ts';
import { FEATURES, REAL, homeOf, featuresOf, type RealPage, type Release } from '../system/pagemap.ts';
import { linksOf } from '../system/connections.ts';
import { canReach } from '../system/access.ts';
import { Icon } from '../ui/kit.tsx';
import { useApp } from './context.tsx';
import { staffBrand } from '../data/actions/studio.ts';
import { moduleLabel } from '../system/tools.ts';
import { Bell, Help, Launcher, OutletPicker, UserSwitch } from './chrome.tsx';

export function BackOfficeShell({ children }: { children: ReactNode }) {
  const { page, user, db, me } = useApp();
  const sb = staffBrand(db); // Brand Studio: workspace name, logo and owner accent on staff tools
  const role = user.role === 'manager' ? 'manager' : user.role === 'admin' ? 'admin' : 'owner';
  // staff roles (PIC, cashier, kitchen, waiter) reach a few back-office pages: show only what they can open
  const groups = useMemo(() => realNav(role).map(([m, l]) => [m, l.filter(r => canReach(user.role, r.path))] as [string, RealPage[]]).filter(([, l]) => l.length), [role, user.role]);
  const [q, setQ] = useState(''), [open, setOpen] = useState<Record<string, boolean>>({}), [side, setSide] = useState(false);
  const home = STAFF_HOME[user.role] ?? '/owner';
  const here = homeOf(page.path);
  const ql = q.toLowerCase();
  return <div className="bo" data-role={role} data-theme={role === 'admin' ? 'dark' : undefined} style={role === 'owner' ? { ['--role' as string]: sb.c.primary, ['--role-soft' as string]: `color-mix(in srgb, ${sb.c.primary} 10%, var(--bg-surface))`, ['--role-fg' as string]: `color-mix(in srgb, ${sb.c.primary} 75%, var(--fg-1))` } : undefined}>
    <aside className={'bo-side' + (side ? ' open' : '')} aria-label="Navigation">
      <Link href={home} className="row" style={{ padding: '4px 6px 12px', textDecoration: 'none', color: 'var(--fg-1)' }}>
        <span style={{ width: 36, height: 36, borderRadius: 11, background: role !== 'admin' && sb.logo ? `center / cover url("${sb.logo}")` : 'var(--role)', color: '#fff', display: 'grid', placeItems: 'center', fontFamily: 'var(--font-display)', fontWeight: 700 }}>{role !== 'admin' && sb.logo ? '' : (role === 'admin' ? 'B' : sb.workspace.slice(0, 1))}</span>
        <span className="stack" style={{ gap: 0 }}><b>{role === 'admin' ? 'BorNiz' : sb.workspace}</b><span className="faint" style={{ fontSize: 12 }}>{role === 'admin' ? 'BorNiz HQ' : user.role === 'owner' ? 'Owner · 3 outlets · Pro' : `${me?.name ?? user.role} · ${user.role}`}</span></span>
      </Link>
      <input className="search" placeholder={`Search ${FEATURES.size} features`} value={q} onChange={e => setQ(e.target.value)} aria-label="Search pages and features" />
      {role !== 'admin' && <Link className="nav-i" href="/graph"><Icon name="waypoints" size={18} />Knowledge graph</Link>}
      {ql ? <div className="stack sm">{[...FEATURES.values()].filter(f => (f.name + ' ' + f.page.title).toLowerCase().includes(ql) && canReach(user.role, f.path)).slice(0, 40).map(f =>
        <Link key={f.path} href={f.path} className="nav-i" onClick={() => setSide(false)}><span className="grow">{f.name}<br /><span className="faint" style={{ fontSize: 12 }}>{f.page.title} · {f.kind}</span></span></Link>)}</div>
      : groups.map(([mod, pages]) => {
        const isOpen = open[mod] ?? pages.some(rp => rp.id === here?.id); // design v1.0: one icon row per module, the current one open
        return <div key={mod}>
          <button className="nav-m" onClick={() => setOpen(o => ({ ...o, [mod]: !isOpen }))} aria-expanded={isOpen} aria-current={!isOpen && pages.some(rp => rp.id === here?.id) ? 'true' : undefined}>
            <Icon name={MOD_ICON[mod] ?? 'circle'} size={18} /><span className="grow">{moduleLabel(db, mod)}</span><Icon name={isOpen ? 'chevron-down' : 'chevron-right'} size={16} /></button>
          {isOpen && pages.map(rp => <Link key={rp.id} href={rp.path} className="nav-i" aria-current={here?.id === rp.id ? 'page' : undefined} onClick={() => setSide(false)}>
            <span className="grow">{rp.title}</span>{rp.release !== 'MVP' && <ReleaseTag r={rp.release} />}</Link>)}
        </div>;
      })}
    </aside>
    {side && <div className="scrim only-mobile" onClick={() => setSide(false)} />}
    <div className="bo-main">
      <header className="bo-top">
        <button className="btn btn-ghost icon-btn only-mobile" onClick={() => setSide(true)} aria-label="Menu"><Icon name="menu" /></button>
        <span className="faint grow hide-sm" style={{ fontSize: 13 }}>{here ? `${moduleLabel(db, here.module)} › ${here.title}` : page.group}{here && here.path !== page.path ? ` › ${page.title}` : ''}</span>
        <span className="grow only-mobile" />
        {role !== 'admin' && <OutletPicker />}
        <Help /><Launcher /><Bell /><UserSwitch />
      </header>
      <main className="bo-body"><PageTabs />{children}<Connected /></main>
    </div>
  </div>;
}

const STAFF_HOME: Partial<Record<string, string>> = { owner: '/owner', manager: '/manager', pic: '/pic', cashier: '/pos', kitchen: '/kds', waiter: '/waiter', admin: '/admin' };
const MOD_ICON: Record<string, string> = { Home: 'activity', Sales: 'receipt', Catalog: 'utensils-crossed', Inventory: 'package', Customers: 'users', Team: 'user-round-cog', Outlets: 'store', Finance: 'wallet', Reports: 'chart-column', Marketing: 'megaphone', Studios: 'palette', Settings: 'settings', Platform: 'server' };
const MODULES = ['Home', 'Sales', 'Catalog', 'Inventory', 'Customers', 'Team', 'Outlets', 'Finance', 'Reports', 'Marketing', 'Studios', 'Settings', 'Platform'];
/** Navigation = real pages (src/system/pagemap.ts), not the ~600 sitemap features. */
export function realNav(role: 'owner' | 'manager' | 'admin'): [string, RealPage[]][] {
  const mine = REAL.filter(r => !r.hidden && (role === 'admin' ? r.app === 'admin' : r.app === 'backoffice' && (role === 'manager' ? r.id !== 'bo.dashboard' : !r.managerOnly)));
  return MODULES.map(m => [m, mine.filter(r => r.module === m)] as [string, RealPage[]]).filter(([, l]) => l.length);
}
export const ReleaseTag = ({ r }: { r: Release }) => <span className="badge" style={{ height: 18, padding: '0 6px', fontSize: 12, fontFamily: 'var(--font-mono)' }} title={'Planned for ' + r}>{r}</span>;

/** Features of the current page as tabs (page, tab, setting). Sheets and steps open from inside the page. */
function PageTabs() {
  const { page, user } = useApp();
  const here = homeOf(page.path);
  if (!here || page.surface !== 'backoffice') return null;
  const tabs = featuresOf(here.id).filter(f => (f.kind === 'page' || f.kind === 'tab' || f.kind === 'setting') && canReach(user.role, f.path));
  if (tabs.length < 2) return null;
  return <nav className="row" style={{ overflowX: 'auto', gap: 6, flex: 'none', maxWidth: '100%' }} aria-label={here.title + ' sections'}>
    {tabs.map(f => <Link key={f.path} href={f.path} className="chip" aria-pressed={f.path === page.path} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none', color: f.path === page.path ? 'var(--bg-surface)' : 'var(--fg-1)' }}>{f.name.replace(/^(Settings|Menu studio|Brand studio) · /, '').replace(/\s*\([^)]*\)$/, '')}{f.release !== here.release && <ReleaseTag r={f.release} />}</Link>)}
  </nav>;
}

/** Linked pages, from the design rules: LINKS (spec Connections) first, then pages that share this page's data. */
export function Connected() {
  const { page, user } = useApp();
  const here = homeOf(page.path);
  const links = useMemo(() => (here ? linksOf(here).filter(l => canReach(user.role, l.to.path)) : []), [here, user.role]);
  if (!here || !links.length) return null;
  const design = links.filter(l => l.kind === 'design'), data = links.filter(l => l.kind === 'data').slice(0, 10);
  const chip = { textDecoration: 'none', color: 'var(--fg-1)', whiteSpace: 'normal', height: 'auto', minHeight: 34, padding: '6px 12px', maxWidth: '100%', flex: '0 1 auto', textAlign: 'left' } as const;
  return <section className="card stack" aria-label="Linked pages">
    <div className="row between wrap"><h3>Linked pages · {here.title}</h3><Link href={'/graph?node=' + encodeURIComponent(page.path)} className="row" style={{ fontSize: 13 }}><Icon name="waypoints" size={16} />Open in graph</Link></div>
    {design.length > 0 && <div className="stack sm"><span className="cap">Design connection</span><div className="row wrap">{design.map(l => <Link key={l.to.id} href={l.to.path} className="chip" style={chip}><b style={{ fontFamily: 'var(--font-body)' }}>{l.to.title}</b><span className="faint" style={{ fontSize: 12 }}> · {l.why}</span></Link>)}</div></div>}
    {data.length > 0 && <div className="stack sm"><span className="cap">Same data</span><div className="row wrap">{data.map(l => <Link key={l.to.id} href={l.to.path} className="chip" style={chip}><b style={{ fontFamily: 'var(--font-body)' }}>{l.to.title}</b><span className="faint" style={{ fontSize: 12 }}> · {l.why}</span></Link>)}</div></div>}
  </section>;
}

export function PublicShell({ children }: { children: ReactNode }) {
  const { page } = useApp();
  if (page.surface !== 'landing') return <>{children}</>;
  const links = [['Features', '/features'], ['Pricing', '/pricing'], ['Solutions', '/solutions-f-and-b'], ['Help', '/help-center-and-tutorials']];
  return <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
    <header className="row between" style={{ padding: '14px var(--margin)', borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)', position: 'sticky', top: 0, zIndex: 20 }}>
      <Link href="/" style={{ font: '700 22px var(--font-display)', color: 'var(--fg-1)', letterSpacing: '-.03em' }}>BorNiz</Link>
      <nav className="row hide-sm">{links.map(([l, h]) => <Link key={h} href={h} className="btn btn-ghost btn-sm">{l}</Link>)}</nav>
      <div className="row"><Link href="/account/login" className="btn btn-ghost btn-sm">Log in</Link><Link href="/account/register" className="btn btn-primary btn-sm">Start free</Link></div>
    </header>
    <div style={{ flex: 1 }}>{children}</div>
    <footer style={{ padding: '32px var(--margin)', borderTop: '1px solid var(--border)', background: 'var(--bg-surface)' }}>
      <div className="grid" style={{ ['--min' as string]: '180px', maxWidth: 1200, margin: '0 auto' }}>
        {Object.entries(PAGES.filter(p => p.surface === 'landing').reduce<Record<string, typeof PAGES>>((a, p) => ((a[p.group] ??= []).push(p), a), {})).map(([g, ps]) =>
          <div key={g} className="stack sm"><span className="cap">{g}</span>{ps.map(p => <Link key={p.path} href={p.path} style={{ color: 'var(--fg-2)', fontSize: 14 }}>{p.title}</Link>)}</div>)}
      </div>
    </footer>
  </div>;
}

export const surfaceLink = surfaceHome;
