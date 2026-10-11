'use client';
import { useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { nav, PAGES, surfaceHome } from '../system/registry.ts';
import { relatedPages } from '../system/graph-lite.ts';
import { Icon, Badge } from '../ui/kit.tsx';
import { useApp } from './context.tsx';
import { staffBrand } from '../data/actions/studio.ts';
import { Bell, Help, Launcher, OutletPicker, UserSwitch } from './chrome.tsx';

export function BackOfficeShell({ children }: { children: ReactNode }) {
  const { page, user, db } = useApp();
  const sb = staffBrand(db); // Brand Studio: workspace name, logo and owner accent on staff tools
  const role = user.role === 'manager' ? 'manager' : user.role === 'admin' ? 'admin' : 'owner';
  const groups = useMemo(() => nav(role), [role]);
  const [q, setQ] = useState(''), [open, setOpen] = useState<Record<string, boolean>>({}), [side, setSide] = useState(false);
  const home = role === 'admin' ? '/admin' : role === 'manager' ? '/manager' : '/owner';
  const ql = q.toLowerCase();
  return <div className="bo" data-role={role} data-theme={role === 'admin' ? 'dark' : undefined} style={role === 'owner' ? { ['--role' as string]: sb.c.primary, ['--role-soft' as string]: `color-mix(in srgb, ${sb.c.primary} 10%, var(--bg-surface))`, ['--role-fg' as string]: `color-mix(in srgb, ${sb.c.primary} 75%, var(--fg-1))` } : undefined}>
    <aside className={'bo-side' + (side ? ' open' : '')} aria-label="Navigation">
      <Link href={home} className="row" style={{ padding: '4px 6px 12px', textDecoration: 'none', color: 'var(--fg-1)' }}>
        <span style={{ width: 36, height: 36, borderRadius: 11, background: role !== 'admin' && sb.logo ? `center / cover url("${sb.logo}")` : 'var(--role)', color: '#fff', display: 'grid', placeItems: 'center', fontFamily: 'var(--font-display)', fontWeight: 700 }}>{role !== 'admin' && sb.logo ? '' : (role === 'admin' ? 'B' : sb.workspace.slice(0, 1))}</span>
        <span className="stack" style={{ gap: 0 }}><b>{role === 'admin' ? 'BorNiz' : sb.workspace}</b><span className="faint" style={{ fontSize: 12 }}>{role === 'admin' ? 'BorNiz HQ' : role === 'manager' ? 'Manager · Senayan + Kemang' : 'Owner · 3 outlets · Pro'}</span></span>
      </Link>
      <input className="search" placeholder={`Search ${PAGES.length} pages`} value={q} onChange={e => setQ(e.target.value)} aria-label="Search pages" />
      <Link className="nav-i" href={home} aria-current={page.path === home ? 'page' : undefined}><Icon name="activity" size={18} />{role === 'admin' ? 'Platform overview' : 'Live dashboard'}</Link>
      {role !== 'admin' && <Link className="nav-i" href="/graph"><Icon name="waypoints" size={18} />Knowledge graph</Link>}
      {groups.map(g => {
        const items = g.pages.filter(p => !ql || (p.name + ' ' + g.title).toLowerCase().includes(ql));
        if (!items.length) return null;
        const isOpen = ql ? true : open[g.title] ?? g.pages.some(p => p.path === page.path);
        return <div key={g.title}>
          <button className="nav-g" onClick={() => setOpen(o => ({ ...o, [g.title]: !isOpen }))} aria-expanded={isOpen}><span>{g.title}</span><span>{items.length} {isOpen ? '▾' : '▸'}</span></button>
          {isOpen && items.map(p => <Link key={p.path} href={p.path} className="nav-i" aria-current={p.path === page.path ? 'page' : undefined} onClick={() => setSide(false)}>{p.title}</Link>)}
        </div>;
      })}
    </aside>
    {side && <div className="scrim only-mobile" onClick={() => setSide(false)} />}
    <div className="bo-main">
      <header className="bo-top">
        <button className="btn btn-ghost icon-btn only-mobile" onClick={() => setSide(true)} aria-label="Menu"><Icon name="menu" /></button>
        <span className="faint grow hide-sm" style={{ fontSize: 13 }}>{page.role === 'system' ? 'System' : page.area} › {page.group}</span>
        <span className="grow only-mobile" />
        {role !== 'admin' && <OutletPicker />}
        <Help /><Launcher /><Bell /><UserSwitch />
      </header>
      <main className="bo-body">{children}<Connected /></main>
    </div>
  </div>;
}

/** "Every line is a real data dependency": pages that share this page's data, and where the data comes from. */
export function Connected() {
  const { page } = useApp();
  const rel = relatedPages(page.path).slice(0, 18);
  if (!rel.length) return null;
  return <section className="card stack" aria-label="Connected pages">
    <div className="row between"><h3>Connected · same data</h3><Link href={'/graph?node=' + encodeURIComponent(page.path)} className="row" style={{ fontSize: 13 }}><Icon name="waypoints" size={16} />Open in graph</Link></div>
    <div className="row wrap">{rel.map(p => <Link key={p.path} href={p.path} className="chip row" style={{ textDecoration: 'none', color: 'var(--fg-1)', whiteSpace: 'normal', height: 'auto', minHeight: 34, padding: '6px 12px', maxWidth: '100%', flex: '0 1 auto' }}>{p.title}<Badge>{p.role}</Badge></Link>)}</div>
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
