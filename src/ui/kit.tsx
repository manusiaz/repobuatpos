'use client';
// Base components (spec: BorNiz Components). Everything else is composed from these + the CSS in app/globals.css.
import { cloneElement, isValidElement, useContext, useEffect, useId, useRef, useState, type ReactElement, type ReactNode, type CSSProperties } from 'react';
import Link from 'next/link';
import { Ctx } from '../app/context.tsx';
import { drillTo } from '../system/drill.ts';
import { icons, type LucideProps } from 'lucide-react';

const pascal = (s: string) => s.replace(/(^|-)([a-z0-9])/g, (_, __, c: string) => c.toUpperCase());
/** Lucide by kebab name (DS: 2px stroke, 20px UI, 24px POS). */
export function Icon({ name, size = 20, ...p }: { name: string; size?: number } & Omit<LucideProps, 'ref'>) {
  const C = (icons as Record<string, React.ComponentType<LucideProps>>)[pascal(name)] ?? icons.Circle;
  return <C size={size} strokeWidth={2} aria-hidden {...p} />;
}

export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'accent' | 'violet' | 'neutral';
export const Badge = ({ tone = 'neutral', children, dot }: { tone?: Tone; children: ReactNode; dot?: boolean }) =>
  <span className={'badge' + (tone === 'neutral' ? '' : ' b-' + tone)}>{dot && <i className="dot" />}{children}</span>;

const TONE: Record<string, Tone> = {
  paid: 'success', settled: 'success', live: 'success', approved: 'success', received: 'success', done: 'success', ready: 'success', active: 'success', online: 'success', published: 'success', posted: 'success', booked: 'info', delivered: 'success', read: 'success', closed: 'neutral', served: 'success', seated: 'success',
  waiting: 'warning', pending: 'warning', pending_owner: 'warning', partial: 'warning', preparing: 'warning', paying: 'warning', sent: 'info', open: 'info', counting: 'info', locked: 'info', queued: 'info', draft: 'neutral', held: 'neutral', recount: 'warning', needs_approval: 'warning', cooking: 'warning', new: 'accent',
  failed: 'danger', expired: 'danger', rejected: 'danger', voided: 'danger', refunded: 'violet', part_refunded: 'violet', offline: 'danger', overdue: 'danger', low: 'danger', cancelled: 'danger', no_show: 'danger', archived: 'neutral',
};
export const statusTone = (s: string) => TONE[s.toLowerCase().replace(/ /g, '_')] ?? 'neutral';
export const human = (s: string) => s.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
export const Status = ({ s }: { s: string }) => <Badge tone={statusTone(s)} dot>{human(s)}</Badge>;

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label?: string }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} className="toggle" onClick={() => onChange(!on)} />;
}
export function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: readonly (readonly [T, string])[] | readonly T[]; onChange: (v: T) => void; label?: string }) {
  return <div className="seg" role="group" aria-label={label}>{options.map(o => { const [k, l] = Array.isArray(o) ? o : [o, o]; return <button key={k} type="button" aria-pressed={value === k} onClick={() => onChange(k as T)}>{l}</button>; })}</div>;
}
export function Field({ label, hint, error, children, optional }: { label: string; hint?: string; error?: string; children: ReactNode; optional?: boolean }) {
  // the label names its control (screen readers, tap on the label): a single input / select / textarea child gets the id
  const auto = useId(), el = isValidElement(children) && ['input', 'select', 'textarea'].includes(children.type as string) ? children as ReactElement<{ id?: string }> : null;
  const id = el?.props.id ?? auto;
  return <div className="field"><label className="row between" htmlFor={el ? id : undefined}><span>{label}{optional && <span className="faint"> (optional)</span>}</span>{hint && <span className="hint">{hint}</span>}</label>{el ? cloneElement(el, { id }) : children}{error && <span className="err">{error}</span>}</div>;
}
export function Sheet({ open, onClose, title, children, footer, side = 'right', sub }: { open: boolean; onClose: () => void; title: ReactNode; sub?: ReactNode; children: ReactNode; footer?: ReactNode; side?: 'right' | 'bottom' | 'center' }) {
  useEffect(() => { if (!open) return; const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); addEventListener('keydown', k); return () => removeEventListener('keydown', k); }, [open, onClose]);
  if (!open) return null;
  return <>
    <div className="scrim" onClick={onClose} />
    <div className={'sheet ' + side} role="dialog" aria-modal="true">
      <div className="sheet-h"><div className="grow stack sm" style={{ gap: 2 }}><h2>{title}</h2>{sub && <span className="muted" style={{ fontSize: 14 }}>{sub}</span>}</div><button className="btn btn-ghost icon-btn" onClick={onClose} aria-label="Close"><Icon name="x" /></button></div>
      <div className="sheet-b">{children}</div>
      {footer && <div className="sheet-f">{footer}</div>}
    </div>
  </>;
}
let toastFn: (m: string) => void = () => {};
export const toast = (m: string) => toastFn(m);
/** Copy with honest feedback: the browser may block the clipboard (permissions, http, iframes). */
export function copy(text: string, what = 'Copied') {
  const blocked = () => toast('Copy blocked by the browser. Select the text and copy it.');
  try { navigator.clipboard.writeText(text).then(() => toast(what), blocked); } catch { blocked(); }
}

export function Toaster() {
  const [m, setM] = useState<string | null>(null); const t = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => { toastFn = (x: string) => { setM(x); clearTimeout(t.current); t.current = setTimeout(() => setM(null), 2600); }; }, []);
  return m ? <div className="toast" role="status">{m}</div> : null;
}
export const Skeleton = ({ h = 16, w = '100%', style }: { h?: number; w?: number | string; style?: CSSProperties }) => <div className="skeleton" style={{ height: h, width: w, ...style }} />;
export function Loading({ rows = 6 }: { rows?: number }) {
  return <div className="stack" aria-busy="true"><Skeleton h={28} w="40%" />{Array.from({ length: rows }, (_, i) => <Skeleton key={i} h={44} />)}</div>;
}
export const Empty = ({ icon = 'inbox', title, children, action }: { icon?: string; title: string; children?: ReactNode; action?: ReactNode }) =>
  <div className="empty"><Icon name={icon} size={32} /><h3 style={{ color: 'var(--fg-1)' }}>{title}</h3>{children && <p style={{ maxWidth: 420 }}>{children}</p>}{action}</div>;
/** A KPI tile opens the list it counts (src/system/drill.ts) unless `href` says otherwise (null = static). */
const KPI_ICONS: [RegExp, string][] = [[/^open|late|wait|\bmin\b|prep|time/i, 'clock'], [/incoming|inbox|accept/i, 'inbox'], [/kitchen|cooking/i, 'chef-hat'], [/^ready|shelf/i, 'package-check'], [/complete|picked up/i, 'circle-check'], [/revenue|sales|spend|margin|target|aov|ticket/i, 'trending-up'], [/order|cover|transaction/i, 'chart-column'],
  [/void|refund|waste|variance|loss/i, 'receipt-text'], [/member|customer|guest|staff|team|shift|present/i, 'users'], [/point|bean|loyal|reward/i, 'coins'], [/approv|pending|review/i, 'shield-check'], [/cash|drawer|deposit|payout|balance/i, 'wallet'], [/stock|item|product|sku|par/i, 'package']];
const kpiIcon = (label: string) => KPI_ICONS.find(([r]) => r.test(label))?.[1] ?? 'activity';
export function Kpi({ label, value, delta, tone, href }: { label: string; value: ReactNode; delta?: ReactNode; tone?: 'up' | 'down' | 'warn'; href?: string | null }) {
  const app = useContext(Ctx);
  const to = href !== undefined ? href : app ? drillTo(label, app.user.role, app.page.path) : null;
  // design v1.0: label, big number, arrow delta, and a tinted icon tile on the right (tone decides the tint)
  const d = typeof delta === 'string' && tone !== 'warn' ? delta.replace(/^\+\s?/, '↑ ').replace(/^[-−]\s?/, '↓ ') : delta;
  const body = <><span className="row between" style={{ alignItems: 'flex-start' }}><span className="l">{label}</span><span className={'kpi-ic ' + (tone ?? '')} aria-hidden><Icon name={kpiIcon(label)} size={18} /></span></span>
    <span className="v">{value}</span>{d != null && <span className={tone} style={{ fontSize: 13, fontWeight: 600 }}>{d}</span>}</>;
  return to ? <Link href={to} className="card kpi link">{body}</Link> : <div className="card kpi">{body}</div>;
}
export const Avatar = ({ name, color, size = 36 }: { name: string; color?: string; size?: number }) =>
  <span className="avatar" style={{ background: color, width: size, height: size, fontSize: size * .4 }}>{name.slice(0, 1).toUpperCase()}</span>;

/** Numeric keypad shared by PIN login, approval PIN, cash tender and drawer counts. */
export function Numpad({ onKey, extra = '00' }: { onKey: (k: string) => void; extra?: string }) {
  return <div className="numpad">{['1', '2', '3', '4', '5', '6', '7', '8', '9', extra, '0', 'del'].map(k =>
    <button key={k} type="button" onClick={() => onKey(k)} aria-label={k === 'del' ? 'Delete' : k}>{k === 'del' ? <Icon name="delete" size={24} /> : k}</button>)}</div>;
}
export const ago = (t: number, now = Date.now()) => { const m = Math.round((now - t) / 60e3); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' d ago'; };
export const hhmm = (t: number) => new Date(t).toTimeString().slice(0, 5);
export const dateShort = (t: number) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
export function useNow(ms = 1000) { const [n, setN] = useState(() => Date.now()); useEffect(() => { const t = setInterval(() => setN(Date.now()), ms); return () => clearInterval(t); }, [ms]); return n; }
/** The one product visual: the Menu Studio photo when there is one, else a warm tile from the product hue (DS: photos on warm neutral). */
export const productImage = (p: { hue: number; photo?: string }) =>
  p.photo ? `center / cover no-repeat url("${p.photo}")` : `linear-gradient(135deg,oklch(.92 .05 ${p.hue}),oklch(.8 .08 ${p.hue}))`;
