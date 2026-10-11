'use client';
// Shared studio frame (Design Notes "studios", layout A): tools list · settings panel · live preview.
// Used by Menu Studio (customer-facing + pages) and Brand Studio (staff tools).
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import Link from 'next/link';
import { Badge, Icon, Seg, Toggle, toast, type Tone } from '../../ui/kit.tsx';
import { useApp } from '../../app/context.tsx';
import type { Group, Val } from '../../data/actions/studio.ts';
import { isHex, MIN_RATIO, readImage, type Check } from './theme.ts';

const CSS = `
.st{display:grid;grid-template-columns:208px minmax(320px,400px) minmax(0,1fr);border:1px solid var(--border);border-radius:var(--radius-lg);overflow:hidden;background:var(--bg-surface);height:calc(100dvh - 150px);min-height:620px}
.st-tools{background:var(--bg-sunken);border-right:1px solid var(--border);overflow:auto;padding:8px 8px 24px}
.st-tools .nav-i{min-height:40px;font-size:13px}
.st-panel{border-right:1px solid var(--border);overflow:auto;display:flex;flex-direction:column}
.st-panel-h{padding:16px 20px 12px;border-bottom:1px solid var(--border);position:sticky;top:0;background:var(--bg-surface);z-index:2}
.st-panel-b{padding:16px 20px 32px;display:flex;flex-direction:column;gap:20px}
.st-prev{background:var(--ink-950);color:var(--ink-0);display:flex;flex-direction:column;min-width:0;overflow:hidden}
.st-prev-h{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:10px 14px;border-bottom:1px solid var(--ink-800)}
.st-prev-h .seg{background:var(--ink-800)}.st-prev-h .seg button{color:var(--ink-300)}.st-prev-h .seg button[aria-pressed=true]{background:var(--ink-0);color:var(--ink-950)}
.st-prev-b{flex:1;overflow:auto;padding:20px 16px;display:flex;flex-direction:column;align-items:center;gap:12px}
.st-dev{background:var(--ink-0);color:var(--ink-950);border-radius:28px;box-shadow:0 0 0 8px var(--ink-800),var(--shadow-e3);overflow:hidden;transform-origin:top left}
.st-dev[data-d=desktop]{border-radius:12px}
.st-top{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.st-opts{display:grid;gap:8px;grid-template-columns:repeat(var(--c,2),minmax(0,1fr))}
.st-opt{min-height:44px;border-radius:var(--radius-sm);border:1px solid var(--border);background:var(--bg-surface);padding:8px 10px;text-align:left;cursor:pointer;display:flex;flex-direction:column;gap:2px;font-size:13px;font-weight:600;min-width:0}
.st-opt[aria-pressed=true]{border-color:var(--fg-1);box-shadow:inset 0 0 0 1px var(--fg-1);background:var(--bg-canvas)}
.st-opt small{font-weight:400;color:var(--fg-2);font-size:12px}
.st-opt i{display:block;height:24px;border-radius:8px;margin-bottom:4px}
.st-slot{position:relative;border-radius:var(--radius-sm);border:1.5px dashed var(--ink-300);background:var(--bg-canvas) center/cover no-repeat;display:grid;place-items:center;cursor:pointer;color:var(--fg-2);font-size:13px;font-weight:600;overflow:hidden;min-height:72px}
.st-slot[data-has=true]{border-style:solid;border-color:var(--border)}
.st-slot input{position:absolute;inset:0;opacity:0;cursor:pointer}
.st-row{display:flex;align-items:center;gap:10px;min-height:44px}
.st-color{width:44px;height:44px;border-radius:12px;border:1px solid var(--border);padding:0;background:none;cursor:pointer;flex:none}
.st-pick{display:none}
.st-mob{display:none}
@media (max-width:1279px){.st{grid-template-columns:minmax(300px,380px) minmax(0,1fr)}.st-tools{display:none}.st-pick{display:block}}
@media (max-width:1023px){.st{grid-template-columns:minmax(0,1fr);height:auto;min-height:0}.st-panel{border-right:0}.st-prev-b{min-height:560px}
 .st-mob{display:flex}.st[data-pane=edit] .st-prev{display:none}.st[data-pane=preview] .st-panel{display:none}}
@media print{.bo-side,.bo-top,.st-tools,.st-panel,.st-prev-h,.st-top,.st-noprint{display:none!important}.st{display:block;border:0;height:auto}.st-prev,.st-prev-b{background:none;overflow:visible}.st-dev{box-shadow:none;transform:none!important}}
`;

export interface Tool { key: string; label: string; icon: string; path: string }
export interface ToolGroup { title: string; tools: Tool[] }
export type Device = 'phone' | 'tablet' | 'desktop';
export const DEVICES: Record<Device, [w: number, h: number, label: string]> = { phone: [390, 780, 'Phone'], tablet: [768, 1000, 'Tablet'], desktop: [1200, 760, 'Desktop'] };

export interface StudioStatus { tone: Tone; text: string }
export function StudioFrame({ title, sub, groups, current, panelTitle, panelSub, panel, preview, previewBar, status, actions }: {
  title: string; sub?: ReactNode; groups: ToolGroup[]; current: string; panelTitle: string; panelSub?: string; panel: ReactNode;
  preview: ReactNode; previewBar?: ReactNode; status: StudioStatus; actions: ReactNode;
}) {
  const { go } = useApp();
  const [pane, setPane] = useState<'edit' | 'preview'>('edit');
  return <div className="stack" style={{ gap: 12 }}>
    <style>{CSS}</style>
    <div className="st-top">
      <div className="stack grow" style={{ gap: 2, minWidth: 200 }}><h1 style={{ fontSize: 26 }}>{title}</h1>{sub && <span className="muted" style={{ fontSize: 13 }}>{sub}</span>}</div>
      <Badge tone={status.tone} dot>{status.text}</Badge>
      {actions}
    </div>
    <select className="input st-pick" aria-label="Studio tool" value={groups.flatMap(g => g.tools).find(t => t.key === current)?.path} onChange={e => go(e.target.value)}>
      {groups.map(g => <optgroup key={g.title} label={g.title}>{g.tools.map(t => <option key={t.key + t.path} value={t.path}>{t.label}</option>)}</optgroup>)}
    </select>
    <div className="st-mob"><Seg value={pane} onChange={setPane} label="Show" options={[['edit', 'Settings'], ['preview', 'Live preview']]} /></div>
    <div className="st" data-pane={pane}>
      <nav className="st-tools" aria-label="Studio tools">
        {groups.map(g => <div key={g.title}>
          <div className="nav-g" style={{ cursor: 'default' }}>{g.title}</div>
          {g.tools.map(t => <Link key={t.key + t.path} href={t.path} className="nav-i" aria-current={t.key === current ? 'page' : undefined}><Icon name={t.icon} size={16} />{t.label}</Link>)}
        </div>)}
      </nav>
      <section className="st-panel" aria-label="Settings">
        <div className="st-panel-h"><h2 style={{ fontSize: 19 }}>{panelTitle}</h2>{panelSub && <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>{panelSub}</p>}</div>
        <div className="st-panel-b">{panel}</div>
      </section>
      <section className="st-prev" aria-label="Live preview">
        {previewBar && <div className="st-prev-h">{previewBar}</div>}
        <div className="st-prev-b">{preview}</div>
      </section>
    </div>
  </div>;
}

/** Scales a fixed-size device to the preview column. Children render at true device width. */
export function DeviceView({ device, children, height, style, label }: { device: Device; children: ReactNode; height?: number; style?: CSSProperties; label?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, h] = DEVICES[device];
  const H = height ?? h;
  const [k, setK] = useState(1);
  useLayoutEffect(() => {
    const el = ref.current?.parentElement; if (!el) return;
    const fit = () => { if (el.clientWidth > 0) setK(Math.max(0.2, Math.min(1, (el.clientWidth - 32) / w))); };
    fit(); const ro = new ResizeObserver(fit); ro.observe(el); return () => ro.disconnect();
  }, [w]);
  return <div ref={ref} style={{ width: w * k + 16, height: H * k + 16, flex: 'none', padding: 8 }} aria-label={label}>
    <div className="st-dev" data-d={device} style={{ width: w, height: H, transform: `scale(${k})`, ...style }}>
      <div style={{ width: '100%', height: '100%', overflow: 'auto' }}>{children}</div>
    </div>
  </div>;
}

export const DeviceSeg = ({ value, onChange, only }: { value: Device; onChange: (d: Device) => void; only?: Device[] }) =>
  <Seg value={value} onChange={onChange} label="Preview device" options={(only ?? (Object.keys(DEVICES) as Device[])).map(d => [d, DEVICES[d][2]] as const)} />;

// ── Settings controls ──────────────────────────────────────────────────────────────────
export const Cap = ({ children, right }: { children: ReactNode; right?: ReactNode }) => <div className="row between"><span className="cap">{children}</span>{right}</div>;
export function Block({ title, hint, children, right }: { title: string; hint?: ReactNode; children: ReactNode; right?: ReactNode }) {
  return <div className="stack sm"><Cap right={right}>{title}</Cap>{children}{hint && <p className="faint" style={{ fontSize: 12 }}>{hint}</p>}</div>;
}
export type Opt = [value: Val, label: string, sub?: string, swatch?: string, font?: string];
export function Opts({ value, opts, onChange, cols = 2, disabled }: { value: Val; opts: Opt[]; onChange: (v: Val) => void; cols?: number; disabled?: boolean }) {
  return <div className="st-opts" style={{ '--c': cols } as CSSProperties} role="group">
    {opts.map(([v, l, s, sw, font]) => <button key={String(v)} type="button" className="st-opt" aria-pressed={value === v} disabled={disabled} onClick={() => onChange(v)} style={{ fontFamily: font }}>
      {sw && <i style={{ background: sw }} />}<span>{l}</span>{s && <small>{s}</small>}
    </button>)}
  </div>;
}
export function ColorRow({ label, sub, value, onChange, check, disabled }: { label: string; sub?: string; value: string; onChange: (v: string) => void; check?: { ratio: number; text: string }; disabled?: boolean }) {
  const [txt, setTxt] = useState(value);
  useEffect(() => setTxt(value), [value]);
  const bad = check && check.ratio < MIN_RATIO;
  return <div className="st-row">
    <input type="color" className="st-color" value={value} disabled={disabled} onChange={e => onChange(e.target.value.toUpperCase())} aria-label={label + ' color'} />
    <div className="grow stack" style={{ gap: 0 }}><b style={{ fontSize: 14 }}>{label}</b>{sub && <span className="faint" style={{ fontSize: 12 }}>{sub}</span>}
      {check && <span style={{ fontSize: 12, fontWeight: 600, color: bad ? 'var(--danger-fg)' : 'var(--success-fg)' }}>{check.ratio.toFixed(1)}:1 {check.text}{bad ? ' · blocks publish' : ''}</span>}</div>
    <input className="input mono" style={{ width: 104, height: 40, fontSize: 14 }} value={txt} disabled={disabled} aria-label={label + ' hex'}
      onChange={e => { const v = e.target.value.trim(); setTxt(v); const h = v.startsWith('#') ? v : '#' + v; if (isHex(h)) onChange(h.toUpperCase()); }} />
  </div>;
}
export function ImageSlot({ label, value, onChange, ratio = '16/9', maxW = 1200, disabled }: { label: string; value: string; onChange: (v: string) => void; ratio?: string; maxW?: number; disabled?: boolean }) {
  return <div className="stack" style={{ gap: 4 }}>
    <label className="st-slot" data-has={!!value} style={{ aspectRatio: ratio, backgroundImage: value ? `url(${value})` : undefined }}>
      {!value && <span className="row"><Icon name="image-plus" size={18} />{label}</span>}
      {!disabled && <input type="file" accept="image/*" aria-label={'Upload ' + label} onChange={e => { readImage(e.target.files?.[0], maxW).then(onChange, () => toast('That file is not an image')); e.target.value = ''; }} />}
    </label>
    {value && !disabled && <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange('')}><Icon name="trash-2" size={14} />Remove {label.toLowerCase()}</button>}
  </div>;
}
export function ToggleRow({ label, sub, on, onChange, locked }: { label: string; sub?: string; on: boolean; onChange: (v: boolean) => void; locked?: string }) {
  return <div className="st-row"><div className="grow stack" style={{ gap: 0 }}><span style={{ fontWeight: 600, fontSize: 14 }}>{label}</span>{sub && <span className="faint" style={{ fontSize: 12 }}>{sub}</span>}</div>
    {locked ? <Badge tone="neutral"><Icon name="lock" size={12} />{locked}</Badge> : <Toggle on={on} onChange={onChange} label={label} />}</div>;
}

/** Declarative settings: compact field specs so every studio page reads the same. Options "a:Label|b:Label". */
export type F =
  | { t: 'seg'; k: string; label: string; opts: string; cols?: number; hint?: string }
  | { t: 'text' | 'area' | 'number' | 'date' | 'datetime-local'; k: string; label: string; hint?: string }
  | { t: 'toggle'; k: string; label: string; sub?: string; locked?: string }
  | { t: 'range'; k: string; label: string; min: number; max: number; step: number; unit: string }
  | { t: 'img'; k: string; label: string; ratio?: string }
  | { t: 'color'; k: string; label: string }
  | { t: 'note'; text: string };
export const f = {
  seg: (k: string, label: string, opts: string, cols?: number, hint?: string): F => ({ t: 'seg', k, label, opts, cols, hint }),
  text: (k: string, label: string, hint?: string): F => ({ t: 'text', k, label, hint }),
  area: (k: string, label: string): F => ({ t: 'area', k, label }),
  num: (k: string, label: string, hint?: string): F => ({ t: 'number', k, label, hint }),
  date: (k: string, label: string): F => ({ t: 'datetime-local', k, label }),
  tog: (k: string, label: string, sub?: string, locked?: string): F => ({ t: 'toggle', k, label, sub, locked }),
  range: (k: string, label: string, min: number, max: number, step: number, unit = ''): F => ({ t: 'range', k, label, min, max, step, unit }),
  img: (k: string, label: string, ratio?: string): F => ({ t: 'img', k, label, ratio }),
  color: (k: string, label: string): F => ({ t: 'color', k, label }),
  note: (text: string): F => ({ t: 'note', text }),
};
const parseOpts = (s: string): Opt[] => s.split('|').map(x => { const [v, l, sub] = x.split(':'); return [/^-?\d+$/.test(v) ? +v : v, l ?? v, sub]; });

export function Fields({ g, fs, set, disabled }: { g: Group; fs: F[]; set: (k: string, v: Val) => void; disabled?: boolean }) {
  return <>{fs.map((x, i) => {
    if (x.t === 'note') return <p key={i} className="sunken" style={{ fontSize: 13 }}>{x.text}</p>;
    const v = g[x.k];
    switch (x.t) {
      case 'seg': { const o = parseOpts(x.opts); return <Block key={x.k} title={x.label} hint={x.hint}><Opts value={v} opts={o} onChange={nv => set(x.k, nv)} cols={x.cols ?? (o.length > 3 ? 2 : o.length)} disabled={disabled} /></Block>; }
      case 'toggle': return <ToggleRow key={x.k} label={x.label} sub={x.sub} on={!!v} onChange={nv => set(x.k, nv)} locked={x.locked} />;
      case 'range': return <Block key={x.k} title={x.label} right={<b className="num" style={{ fontSize: 14 }}>{String(v)}{x.unit}</b>}>
        <input type="range" min={x.min} max={x.max} step={x.step} value={Number(v)} disabled={disabled} onChange={e => set(x.k, +e.target.value)} aria-label={x.label} style={{ width: '100%', height: 32, accentColor: 'var(--role)' }} /></Block>;
      case 'img': return <Block key={x.k} title={x.label}><ImageSlot label={x.label} value={String(v ?? '')} ratio={x.ratio} onChange={nv => set(x.k, nv)} disabled={disabled} /></Block>;
      case 'color': return <ColorRow key={x.k} label={x.label} value={String(v ?? '#000000')} onChange={nv => set(x.k, nv)} disabled={disabled} />;
      case 'area': return <Block key={x.k} title={x.label}><textarea className="input" value={String(v ?? '')} disabled={disabled} onChange={e => set(x.k, e.target.value)} aria-label={x.label} /></Block>;
      default: return <Block key={x.k} title={x.label} hint={x.hint}><input className="input" type={x.t} value={String(v ?? '')} disabled={disabled} aria-label={x.label}
        onChange={e => set(x.k, x.t === 'number' ? +e.target.value : e.target.value)} /></Block>;
    }
  })}</>;
}

// ── Contrast + locked rules (Design Notes: "Contrast check blocks publish", "Status colors, payment marks, legal lines locked") ──
export function ContrastCard({ checks }: { checks: Check[] }) {
  const bad = checks.filter(c => !c.ok);
  return <div className="banner" style={{ background: bad.length ? 'var(--danger-soft)' : 'var(--success-soft)', color: bad.length ? 'var(--danger-fg)' : 'var(--success-fg)' }} role="status">
    <Icon name={bad.length ? 'circle-alert' : 'circle-check'} />
    <div className="stack" style={{ gap: 4 }}>
      <b>{bad.length ? 'Contrast fail · publishing is blocked' : 'Contrast passes WCAG AA'}</b>
      {checks.map(c => <span key={c.label} style={{ fontSize: 13 }}>{c.label}: <b className="num">{c.ratio.toFixed(1)}:1</b> {c.ok ? '' : `(needs ${MIN_RATIO}:1)`}</span>)}
    </div>
  </div>;
}
export const LOCKED = ['Payment status colors: paid, pending, void, refunded, sold out', 'QRIS, GPN and card network marks', 'Legal lines: NPWP, tax (PB1) and receipt footer', 'Text contrast below 4.5:1 cannot be published', 'Error, offline and payment-failed screens'];
export function LockedCard({ items = LOCKED }: { items?: string[] }) {
  return <Block title="Locked · can’t be changed">
    <div className="stack sm">{items.map(t => <div key={t} className="row" style={{ fontSize: 13, color: 'var(--fg-2)' }}><Icon name="lock" size={14} />{t}</div>)}</div>
  </Block>;
}
