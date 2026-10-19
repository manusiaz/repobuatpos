'use client';
// Shared pieces for the Studios surface: tool type, field primitives, merchant theme vars, contrast math, real-data helpers.
import { useState, type ComponentType, type CSSProperties, type ReactNode } from 'react';
import type { DB, Employee, Order, Product, Theme } from '../../data/schema.ts';
import type { SessionUser } from '../../session.ts';
import { priceAt } from '../../data/actions.ts';
import { idr } from '../../domain/money.ts';
import { earn, tierOf } from '../../domain/loyalty.ts';
import { copy, Icon, Seg, Toggle, toast } from '../../ui/kit.tsx';
export { copy };

export type Plan = 'free' | 'basic' | 'pro' | 'enterprise';
export const PLAN_RANK: Record<Plan, number> = { free: 0, basic: 1, pro: 2, enterprise: 3 };
export const PLAN_LABEL: Record<Plan, string> = { free: 'Free', basic: 'Basic', pro: 'Pro', enterprise: 'Enterprise' };
export const planLocked = (p: Plan, db: DB) => PLAN_RANK[p] > PLAN_RANK[db.tenant.plan];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type V = Record<string, any>;
export interface Ctx { db: DB; me: Employee | undefined; user: SessionUser; outletId: string; go: (p: string) => void; by: string; owner: boolean }
export interface PP { v: V; set: (k: string, val: unknown) => void; x: Ctx }

export type Field =
  | { t: 'head'; label: string } | { t: 'note'; text: ReactNode; tone?: 'warn' | 'info' } | { t: 'node'; node: ReactNode | ((set: PP['set']) => ReactNode) }
  | { t: 'text' | 'area'; label: string; k: string; ph?: string; hint?: string }
  | { t: 'seg' | 'select'; label: string; k: string; opts: [string | number, string][] }
  | { t: 'range'; label: string; k: string; min: number; max: number; step: number; unit?: string }
  | { t: 'toggle'; label: string; k: string }
  | { t: 'swatch'; label: string; k: string; opts: [string, string, string][] };
export const F = {
  head: (label: string): Field => ({ t: 'head', label }),
  note: (text: ReactNode, tone?: 'warn' | 'info'): Field => ({ t: 'note', text, tone }),
  node: (node: ReactNode | ((set: PP['set']) => ReactNode)): Field => ({ t: 'node', node }),
  text: (label: string, k: string, ph?: string, hint?: string): Field => ({ t: 'text', label, k, ph, hint }),
  area: (label: string, k: string): Field => ({ t: 'area', label, k }),
  seg: (label: string, k: string, opts: [string | number, string][]): Field => ({ t: 'seg', label, k, opts }),
  select: (label: string, k: string, opts: [string | number, string][]): Field => ({ t: 'select', label, k, opts }),
  range: (label: string, k: string, min: number, max: number, step: number, unit = ''): Field => ({ t: 'range', label, k, min, max, step, unit }),
  toggle: (label: string, k: string): Field => ({ t: 'toggle', label, k }),
  swatch: (label: string, k: string, opts: [string, string, string][]): Field => ({ t: 'swatch', label, k, opts }),
};

export type Group = 'PRINT' | 'MARKETING' | 'MESSAGING & AUTOMATION' | 'PLATFORM' | 'WORKSPACE' | 'GOVERNANCE' | 'CUSTOMER SCREENS' | 'TEMPLATES' | 'RULES' | 'STUDIOS';
export interface Tool {
  id: string; group: Group; name: string; icon: string; plan: Plan; desc: string;
  /** Studio settings (draft → publish). Tools without defaults are management pages with their own panel. */
  def?: V;
  fields?: (v: V, x: Ctx) => Field[];
  Preview: ComponentType<PP>;
  Panel?: ComponentType<PP>;
  /** Text/background pairs checked against 4.5:1 before publish. */
  pairs?: (v: V, x: Ctx) => [string, string, string][];
  wide?: boolean;
}

export function Fields({ fields, v, set }: { fields: Field[]; v: V; set: PP['set'] }) {
  return <div className="stack">{fields.map((f, i) => {
    switch (f.t) {
      case 'head': return <span key={i} className="cap" style={{ paddingTop: 8, borderTop: '1px solid var(--border)' }}>{f.label}</span>;
      case 'note': return <div key={i} className="banner" style={{ background: f.tone === 'warn' ? 'var(--warning-soft)' : f.tone === 'info' ? 'var(--info-soft)' : 'var(--bg-sunken)', color: f.tone === 'warn' ? 'var(--warning-fg)' : f.tone === 'info' ? 'var(--info-fg)' : 'var(--fg-2)', fontSize: 13 }}>{f.text}</div>;
      case 'node': return <div key={i}>{typeof f.node === 'function' ? f.node(set) : f.node}</div>;
      case 'text': return <div key={i} className="field"><label className="row between"><span>{f.label}</span>{f.hint && <span className="hint">{f.hint}</span>}</label><input className="input" value={v[f.k] ?? ''} placeholder={f.ph} onChange={e => set(f.k, e.target.value)} /></div>;
      case 'area': return <div key={i} className="field"><label>{f.label}</label><textarea className="input" rows={5} value={v[f.k] ?? ''} onChange={e => set(f.k, e.target.value)} /></div>;
      case 'seg': return <div key={i} className="field"><label>{f.label}</label><Seg label={f.label} value={String(v[f.k])} options={f.opts.map(([a, b]) => [String(a), b] as const)} onChange={x => set(f.k, typeof f.opts[0][0] === 'number' ? Number(x) : x)} /></div>;
      case 'select': return <div key={i} className="field"><label>{f.label}</label><select className="input" value={String(v[f.k])} onChange={e => set(f.k, typeof f.opts[0][0] === 'number' ? Number(e.target.value) : e.target.value)}>{f.opts.map(([a, b]) => <option key={a} value={a}>{b}</option>)}</select></div>;
      case 'range': return <div key={i} className="field"><label className="row between"><span>{f.label}</span><span className="hint">{v[f.k]}{f.unit}</span></label><input type="range" min={f.min} max={f.max} step={f.step} value={v[f.k]} onChange={e => set(f.k, Number(e.target.value))} style={{ accentColor: 'var(--role)', height: 32 }} aria-label={f.label} /></div>;
      case 'toggle': return <label key={i} className="row between" style={{ minHeight: 'var(--hit)', fontSize: 14, cursor: 'pointer' }}><span>{f.label}</span><Toggle on={!!v[f.k]} onChange={x => set(f.k, x)} label={f.label} /></label>;
      case 'swatch': return <div key={i} className="field"><label>{f.label}</label><div className="row wrap">{f.opts.map(([k, c, l]) => <button key={k} type="button" title={l} aria-label={l} aria-pressed={v[f.k] === k} onClick={() => set(f.k, k)}
        style={{ width: 'var(--hit)', height: 'var(--hit)', borderRadius: 12, border: 0, background: c, cursor: 'pointer', boxShadow: v[f.k] === k ? '0 0 0 2px var(--bg-surface),0 0 0 4px var(--role)' : '0 0 0 1px var(--border)' }} />)}</div></div>;
    }
  })}</div>;
}

// ── Merchant theme (guest screens only) ──────────────────────────────────────────────────
const FONT: Record<string, string> = { space: "'Space Grotesk',sans-serif", bricolage: "'Space Grotesk',sans-serif", system: "'Instrument Sans',sans-serif", serif: "'Instrument Sans',sans-serif", instrument: "'Instrument Sans',sans-serif" };
export const fontOf = (k: string) => FONT[k] ?? FONT.space;
export const themeVars = (t: Theme): CSSProperties => ({ ['--bn-p' as string]: t.p, ['--bn-acc' as string]: t.acc, ['--bn-ink' as string]: t.ink, ['--bn-paper' as string]: t.paper, ['--bn-font' as string]: fontOf(t.font) });
/** Swatch options for merchant-colored elements. Hex values come from db.theme only. */
export const themeSwatches = (t: Theme): [string, string, string][] => [['primary', t.p, 'Primary'], ['accent', t.acc, 'Accent'], ['dark', t.ink, 'Dark']];
export const themeColor = (t: Theme, k: string) => (k === 'accent' ? t.acc : k === 'dark' ? t.ink : k === 'paper' ? t.paper : t.p);
export const WHITE = '#ffffff';

/** Phone frame with the merchant theme applied (data-guest scopes the merchant font). */
export function Phone({ theme, children, bg, w = 340 }: { theme: Theme; children: ReactNode; bg?: string; w?: number }) {
  return <div data-guest style={{ ...themeVars(theme), width: `min(${w}px,100%)`, minHeight: 600, borderRadius: 36, padding: 10, background: 'var(--ink-950)', boxShadow: 'var(--shadow-e2)' }}>
    <div style={{ minHeight: 580, borderRadius: 28, overflow: 'hidden', background: bg ?? 'var(--bn-paper)', color: 'var(--bn-ink)', display: 'flex', flexDirection: 'column', position: 'relative' }}>{children}</div>
  </div>;
}
export function Screen({ theme, children, bg }: { theme: Theme; children: ReactNode; bg?: string }) {
  return <div data-guest style={{ ...themeVars(theme), width: '100%', maxWidth: 760, aspectRatio: '16 / 9', minHeight: 240, borderRadius: 14, border: '8px solid var(--ink-950)', background: bg ?? 'var(--bn-ink)', color: 'var(--ink-0)', overflow: 'hidden', boxShadow: 'var(--shadow-e2)', display: 'flex', flexDirection: 'column' }}>{children}</div>;
}
/** Thermal paper (receipts, tickets, labels). */
export function Paper({ w = 300, children, style }: { w?: number | string; children: ReactNode; style?: CSSProperties }) {
  return <div style={{ width: typeof w === 'number' ? `min(${w}px,100%)` : w, background: 'var(--ink-0)', color: 'var(--ink-950)', boxShadow: 'var(--shadow-e2)', padding: '16px 14px', font: '500 12px/1.45 var(--font-mono)', display: 'flex', flexDirection: 'column', gap: 6, ...style }}>{children}</div>;
}
export const Line = ({ l, r, b }: { l: ReactNode; r?: ReactNode; b?: boolean }) =>
  <div className="row between" style={{ gap: 12, fontWeight: b ? 700 : 500, alignItems: 'flex-start' }}><span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{l}</span>{r != null && <span style={{ flex: 'none' }}>{r}</span>}</div>;
export const Rule = ({ dash }: { dash?: boolean }) => <span style={{ borderTop: `1px ${dash ? 'dashed' : 'solid'} currentColor`, opacity: .8 }} />;
export const Caption = ({ children }: { children: ReactNode }) => <p className="muted" style={{ fontSize: 13, textAlign: 'center', maxWidth: 520 }}>{children}</p>;
export const Stage = ({ children, gap = 20 }: { children: ReactNode; gap?: number }) =>
  <div className="stack" style={{ alignItems: 'center', gap, width: '100%' }}>{children}</div>;

// ── Contrast (WCAG) ──────────────────────────────────────────────────────────────────────
const rgb = (h: string) => { const x = h.replace('#', ''); const f = x.length === 3 ? x.split('').map(c => c + c).join('') : x.slice(0, 6); const n = parseInt(f, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const lum = (h: string) => { const [r, g, b] = rgb(h).map(c => { const s = c / 255; return s <= .03928 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4; }); return .2126 * r + .7152 * g + .0722 * b; };
export const contrast = (a: string, b: string) => { if (!/^#[0-9a-f]{3,8}$/i.test(a) || !/^#[0-9a-f]{3,8}$/i.test(b)) return 21; const x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
/** Readable text on a merchant color: whichever of white / ink wins. */
export const onColor = (bg: string, ink: string) => (contrast(WHITE, bg) >= contrast(ink, bg) ? WHITE : ink);
export const hexOf = (r: number, g: number, b: number) => '#' + [r, g, b].map(c => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0')).join('');
export const mix = (a: string, b: string, t: number) => { const x = rgb(a), y = rgb(b); return hexOf(x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t); };
export const themePairs = (t: Theme): [string, string, string][] => [[t.ink, t.paper, 'Text on background'], [onColor(t.p, t.ink), t.p, 'Button label on primary'], [t.p, t.paper, 'Links on background']];

// ── Real data ────────────────────────────────────────────────────────────────────────────
export { customerOf, first, fillVars, latest, orderVars, outletName } from '../../domain/messages.ts';
export const modsText = (o: Order['lines'][0]) => o.mods.map(m => m.name).join(' · ');


export interface MenuRow { p: Product; price: number; is86: boolean; hidden: boolean }
export function menuOf(db: DB, outletId: string) {
  return db.categories.map(c => ({ c, items: db.products.filter(p => p.categoryId === c.id && p.status === 'live').flatMap<MenuRow>(p => {
    const op = db.outletProducts.find(x => x.productId === p.id && x.outletId === outletId);
    return op ? [{ p, price: priceAt(db, p, outletId), is86: op.is86, hidden: op.hidden }] : [];
  }).filter(r => !r.hidden) })).filter(g => g.items.length);
}
export const thousands = (n: number) => Math.round(n / 1000);

export function CopyRow({ label, value }: { label?: string; value: string }) {
  return <div className="row" style={{ gap: 6, minWidth: 0 }}>{label && <span className="faint" style={{ fontSize: 12, flex: 'none' }}>{label}</span>}
    <code className="mono grow" style={{ background: 'var(--bg-sunken)', padding: '8px 10px', borderRadius: 8, overflowWrap: 'anywhere', fontSize: 12 }}>{value}</code>
    <button className="btn btn-sm none" onClick={() => copy(value)} aria-label={'Copy ' + (label ?? value)}><Icon name="copy" size={16} />Copy</button></div>;
}
export function Code({ children }: { children: string }) {
  return <div style={{ position: 'relative', width: '100%' }}><pre className="mono" style={{ margin: 0, padding: 14, borderRadius: 12, background: 'var(--ink-950)', color: 'var(--ink-100)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 12 }}>{children}</pre>
    <button className="btn btn-sm" style={{ position: 'absolute', top: 8, right: 8 }} onClick={() => copy(children)}><Icon name="copy" size={16} />Copy</button></div>;
}
export function useTick() { const [n, setN] = useState(0); return [n, () => setN(x => x + 1)] as const; }
export const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
