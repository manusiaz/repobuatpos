'use client';
// Combo builder (Menu Studio › combo builder steps) for the QR menu and the kiosk: one item per step from the step's
// category, options where the item has them, priced at the published combo price (addCombo shares it over the items).
import { useState } from 'react';
import type { DB } from '../../data/schema.ts';
import { comboOf } from '../../system/studio.ts';
import { idr } from '../../domain/money.ts';
import { Icon, productImage } from '../../ui/kit.tsx';
import { groupsOf, LINE, menuOf, missingGroup, modsFrom, MUTED, OptionPicker, SURFACE, TINT, type Sel } from './kit.tsx';

export type ComboPick = { productId: string; mods: { name: string; price: number }[] };
/** The published combo with each step's sellable items; null when it can't be built at this outlet right now. */
export function comboHere(db: DB, outletId: string) {
  const c = comboOf(db), items = menuOf(db, outletId);
  const steps = c.steps.map(s => ({ ...s, items: items.filter(i => i.cat === s.cat && !i.sold) }));
  return c.price > 0 && steps.length && steps.every(s => s.items.length) ? { ...c, steps } : null;
}

export function ComboBuilder({ db, outletId, kiosk, disabled, onAdd, onClose }: { db: DB; outletId: string; kiosk?: boolean; disabled?: string; onAdd: (picks: ComboPick[]) => void; onClose: () => void }) {
  const c = comboHere(db, outletId);
  const [at, setAt] = useState(0), [picks, setPicks] = useState<{ id: string; sel: Sel }[]>([]);
  const z = (px: number) => (kiosk ? `${(px / 3.75).toFixed(2)}cqw` : px + 'px'); // kiosk scales with its 9:16 canvas
  const touch = kiosk ? 'max(64px, 13cqw)' : '52px';
  if (!c) return <div style={{ padding: z(24), textAlign: 'center', color: MUTED, fontSize: z(15) }}>This combo isn’t available right now.</div>;
  const step = c.steps[Math.min(at, c.steps.length - 1)], cur = picks[at];
  const item = (id: string) => c.steps.flatMap(s => s.items).find(i => i.p.id === id)!;
  const groups = cur ? groupsOf(db, item(cur.id).p) : [], miss = cur ? missingGroup(groups, cur.sel) : undefined;
  const mods = picks.map(p => modsFrom(groupsOf(db, item(p.id).p), p.sel));
  const total = c.price + mods.flat().reduce((a, m) => a + m.price, 0), last = at === c.steps.length - 1;
  const pick = (id: string) => setPicks(ps => { const n = [...ps]; n[at] = { id, sel: ps[at]?.id === id ? ps[at].sel : {} }; return n; });
  const next = () => last ? onAdd(picks.map((p, i) => ({ productId: p.id, mods: mods[i] }))) : setAt(at + 1);
  return <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
    <div style={{ flex: 'none', padding: `${z(14)} ${z(16)} ${z(10)}`, display: 'flex', flexDirection: 'column', gap: z(10) }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: z(10) }}>
        <span style={{ flex: 1, minWidth: 0 }}><b style={{ display: 'block', fontFamily: 'var(--bn-font)', fontSize: z(22), fontWeight: 800, lineHeight: 1.1 }}>{c.name}</b><span style={{ fontSize: z(14), color: MUTED }}>{idr(c.price)} · {c.steps.length} steps</span></span>
        <button onClick={onClose} aria-label="Close" style={{ width: touch, height: touch, flex: 'none', borderRadius: 99, border: `1px solid ${LINE}`, background: SURFACE, color: 'var(--bn-ink)', cursor: 'pointer', display: 'grid', placeItems: 'center' }}><Icon name="x" size={kiosk ? 28 : 20} /></button>
      </div>
      <ol style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', gap: z(6) }} aria-label="Steps">{c.steps.map((s, i) =>
        <li key={i} style={{ flex: 1, minWidth: 0 }}><button disabled={i > picks.length} onClick={() => setAt(i)} aria-current={i === at ? 'step' : undefined} style={{ width: '100%', minHeight: z(44), padding: `${z(6)} ${z(8)}`, borderRadius: z(12), border: 0, cursor: i > picks.length ? 'default' : 'pointer', textAlign: 'left',
          background: i === at ? 'var(--bn-p)' : picks[i] ? TINT : 'var(--bg-sunken)', color: i === at ? 'var(--ink-0)' : 'var(--bn-ink)', fontSize: z(12), fontWeight: 700, display: 'flex', gap: z(6), alignItems: 'center' }}>
          <span style={{ flex: 'none' }}>{picks[i] && i !== at ? <Icon name="check" size={kiosk ? 18 : 14} /> : i + 1}</span><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{picks[i] ? item(picks[i].id).p.name : s.title}</span></button></li>)}</ol>
    </div>
    <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: `${z(4)} ${z(16)} ${z(16)}`, display: 'flex', flexDirection: 'column', gap: z(14) }}>
      <b style={{ fontSize: z(18) }}>{step.title}</b>
      <div role="radiogroup" aria-label={step.title} style={{ display: 'grid', gridTemplateColumns: kiosk ? '1fr 1fr' : 'repeat(auto-fill,minmax(140px,1fr))', gap: z(10) }}>{step.items.map(i => { const on = cur?.id === i.p.id;
        return <button key={i.p.id} role="radio" aria-checked={on} onClick={() => pick(i.p.id)} style={{ padding: z(8), borderRadius: z(16), border: `2px solid ${on ? 'var(--bn-p)' : LINE}`, background: on ? TINT : SURFACE, color: 'var(--bn-ink)', cursor: 'pointer', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: z(6) }}>
          <span style={{ display: 'block', aspectRatio: '4/3', borderRadius: z(12), background: productImage(i.p) }} />
          <b style={{ fontSize: z(14), lineHeight: 1.25 }}>{i.p.name}</b><span style={{ fontSize: z(12), color: MUTED }}>{on ? 'Picked' : 'Usually ' + idr(i.flash ?? i.price)}</span></button>; })}</div>
      {cur && groups.length > 0 && <div style={{ padding: z(14), borderRadius: z(16), background: SURFACE }}><OptionPicker groups={groups} sel={cur.sel} onChange={sel => setPicks(ps => ps.map((p, i) => i === at ? { ...p, sel } : p))} t={s => s} h={kiosk ? touch : 48} font={z(15)} /></div>}
    </div>
    <div style={{ flex: 'none', display: 'flex', gap: z(10), padding: `${z(12)} ${z(16)} calc(${z(14)} + env(safe-area-inset-bottom))`, borderTop: `1px solid ${LINE}`, background: 'var(--bn-paper)' }}>
      {at > 0 && <button onClick={() => setAt(at - 1)} style={{ height: touch, padding: `0 ${z(16)}`, borderRadius: z(16), border: `1px solid ${LINE}`, background: SURFACE, color: 'var(--bn-ink)', fontWeight: 700, fontSize: z(15), cursor: 'pointer' }}>Back</button>}
      <button className="btn btn-primary grow" disabled={!cur || !!miss || (last && !!disabled)} onClick={next} style={{ height: kiosk ? 'max(72px, 17cqw)' : 58, borderRadius: z(16), fontSize: z(16), fontWeight: 800 }}>
        {!cur ? `Pick one · ${step.title}` : miss ? `Choose ${miss.name.toLowerCase()}` : last ? (disabled || `Add combo · ${idr(total)}`) : `Next · ${c.steps[at + 1].title}`}</button>
    </div>
  </div>;
}
