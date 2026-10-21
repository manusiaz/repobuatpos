'use client';
// Marketing building blocks (spec/BorNiz Landing): 1200px container, fluid display type, ink bands, 20–24px card radius.
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import Link from '../../ui/Link.tsx';
import { Icon } from '../../ui/kit.tsx';
import { useApp } from '../../app/context.tsx';
import { REMOTE } from '../../data/remote.ts';
import { priceKey, priced, type PlanId } from './plans.ts';

/** The plans at the prices BorNiz set in the console: the server's (bn_public_prices), or this browser's console in demo mode. */
export function usePlans() {
  const { db } = useApp();
  const [live, setLive] = useState<Record<string, unknown> | null>(null);
  useEffect(() => { if (REMOTE) void import('../../data/backend.ts').then(s => s.sb().rpc('bn_public_prices')).then(r => setLive(r.data ?? {})); }, []);
  const plans = priced(live ?? { basic: db.settings[priceKey('basic')], pro: db.settings[priceKey('pro')] });
  return { plans, of: (id: PlanId) => plans.find(p => p.id === id)! };
}

export const Wrap = ({ children, style, as: Tag = 'section' }: { children: ReactNode; style?: CSSProperties; as?: 'section' | 'div' | 'article' }) =>
  <Tag style={{ maxWidth: 1200, width: '100%', margin: '0 auto', padding: 'clamp(40px,6vw,72px) var(--margin)', ...style }}>{children}</Tag>;

export function PageHead({ kicker, title, sub, children, center }: { kicker?: string; title: ReactNode; sub?: ReactNode; children?: ReactNode; center?: boolean }) {
  return <div className="stack" style={{ gap: 14, alignItems: center ? 'center' : undefined, textAlign: center ? 'center' : undefined }}>
    {kicker && <span className="cap" style={{ color: 'var(--accent-fg)' }}>{kicker}</span>}
    <h1 style={{ fontSize: 'clamp(40px,5vw,60px)', lineHeight: 1, letterSpacing: '-.04em' }}>{title}</h1>
    {sub && <p className="muted" style={{ fontSize: 17, lineHeight: 1.55, maxWidth: 680 }}>{sub}</p>}
    {children}
  </div>;
}

export const H2 = ({ children, kicker }: { children: ReactNode; kicker?: string }) =>
  <div className="stack sm">{kicker && <span className="cap" style={{ color: 'var(--accent-fg)' }}>{kicker}</span>}<h2 style={{ fontSize: 'clamp(28px,3.4vw,40px)', letterSpacing: '-.03em' }}>{children}</h2></div>;

export function Cards({ items, min = 260 }: { items: { t: string; d: ReactNode; icon?: string; href?: string; meta?: ReactNode }[]; min?: number }) {
  return <div className="grid" style={{ ['--min' as string]: min + 'px', gap: 12 }}>{items.map(c => {
    const body = <><div className="row between">{c.icon && <span style={{ width: 40, height: 40, borderRadius: 12, background: 'var(--accent-soft)', color: 'var(--accent-fg)', display: 'grid', placeItems: 'center' }}><Icon name={c.icon} /></span>}{c.meta}</div>
      <b style={{ fontSize: 18 }}>{c.t}</b><span className="muted" style={{ fontSize: 14, lineHeight: 1.5 }}>{c.d}</span>
      {c.href && <span className="row" style={{ marginTop: 'auto', fontSize: 14, fontWeight: 600, color: 'var(--accent-fg)' }}>Open<Icon name="arrow-right" size={16} /></span>}</>;
    const st: CSSProperties = { borderRadius: 'var(--radius-lg)', display: 'flex', flexDirection: 'column', gap: 8, color: 'var(--fg-1)', textDecoration: 'none' };
    return c.href ? <Link key={c.t} href={c.href} className="card" style={st}>{body}</Link> : <div key={c.t} className="card" style={st}>{body}</div>;
  })}</div>;
}

/** Ink band: dark tokens inside, so cards and text follow the dark theme. */
export const Ink = ({ children }: { children: ReactNode }) =>
  <div data-theme="dark" style={{ background: 'var(--ink-950)', color: 'var(--fg-1)' }}>{children}</div>;

export function Cta({ title = 'Start selling in 5 minutes', sub = 'Free plan forever · Pro trial 14 days · no card needed' }: { title?: string; sub?: string }) {
  return <Ink><Wrap style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'center', justifyContent: 'space-between' }}>
    <div className="stack sm"><h2 style={{ fontSize: 'clamp(28px,3.4vw,40px)', letterSpacing: '-.03em' }}>{title}</h2><span className="muted">{sub}</span></div>
    <div className="row wrap"><Link href="/account/register" className="btn btn-primary btn-lg">Start free</Link><Link href="/contact-sales-book-a-demo" className="btn btn-lg">Book a demo</Link></div>
  </Wrap></Ink>;
}

/** Long-form text (blog, legal): readable measure. */
export function Prose({ children }: { children: ReactNode }) {
  return <div className="stack" style={{ maxWidth: 720, fontSize: 17, lineHeight: 1.65, gap: 16 }}>{children}</div>;
}

export function Toc({ items }: { items: [string, string][] }) {
  return <nav className="card stack sm" aria-label="On this page" style={{ position: 'sticky', top: 88, alignSelf: 'start' }}><span className="cap">On this page</span>
    {items.map(([id, t]) => <a key={id} href={'#' + id} style={{ fontSize: 14, color: 'var(--fg-2)' }}>{t}</a>)}</nav>;
}
