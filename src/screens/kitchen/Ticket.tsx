'use client';
// KDS ticket card (Kitchen Display prototype): channel + table, timer, red strip for rush / allergy / notes,
// items 20px (tap = done), 64px bump. No prices anywhere on the kitchen screen.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { Order } from '../../data/schema.ts';
import { hhmm } from '../../ui/kit.tsx';
import { CHANNEL, TIER, dueText, isOnline, lineMods, linesAt, minsLeft, mmss, ticketLabel, type Station } from './model.ts';

export interface KdsCfg { warn: number; late: number; colors: 'timer' | 'channel'; scale: number }
export const fs = (n: number): string => `calc(${n}px * var(--kds-scale, 1))`;
export const ageTone = (ms: number, c: KdsCfg) => ms > c.late * 60e3 ? 'late' : ms > c.warn * 60e3 ? 'warn' : 'ok';

/** KDS button: never smaller than the 64px kitchen hit size for the main action, 48px for secondary ones. */
export function KBtn({ children, onClick, tone = 'neutral', big, disabled, style, label }: { children: ReactNode; onClick?: () => void; tone?: 'neutral' | 'go' | 'accent' | 'danger' | 'ghost'; big?: boolean; disabled?: boolean; style?: CSSProperties; label?: string }) {
  const bg = { neutral: 'var(--bg-raised)', go: 'var(--success)', accent: 'var(--accent)', danger: 'var(--danger)', ghost: 'transparent' }[tone];
  return <button type="button" aria-label={label} disabled={disabled} onClick={onClick} className="btn" style={{ height: big ? 'var(--hit-kds)' : 48, borderRadius: big ? 16 : 12, background: bg, color: tone === 'neutral' || tone === 'ghost' ? 'var(--fg-1)' : '#fff',
    borderColor: tone === 'neutral' || tone === 'ghost' ? 'var(--border)' : 'transparent', fontSize: fs(big ? 18 : 15), fontWeight: 800, fontFamily: 'var(--font-display)', padding: '0 16px', ...style }}>{children}</button>;
}
export const Pill = ({ children, bg = 'var(--bg-sunken)', fg = 'var(--fg-1)' }: { children: ReactNode; bg?: string; fg?: string }) =>
  <span style={{ display: 'inline-flex', alignItems: 'center', height: 26, padding: '0 9px', borderRadius: 8, background: bg, color: fg, font: `800 ${fs(15)}/1 var(--font-display)`, whiteSpace: 'nowrap' }}>{children}</span>;

export function ChannelPill({ o }: { o: Order }) {
  const c = CHANNEL[o.source];
  return <Pill bg={c.color} fg="#fff">{c.short}</Pill>;
}
export function TierPill({ o }: { o: Order }) {
  if (!o.tier) return null;
  const t = TIER[o.tier];
  return <Pill bg={t.tone === 'danger' ? 'var(--danger-soft)' : t.tone === 'info' ? 'var(--info-soft)' : 'var(--bg-sunken)'} fg={t.tone === 'danger' ? 'var(--danger-fg)' : t.tone === 'info' ? 'var(--info-fg)' : 'var(--fg-2)'}>{t.l}</Pill>;
}

export interface TicketProps {
  o: Order; st: Station | 'all'; now: number; cfg: KdsCfg; meta: string; recalled?: boolean;
  action?: { label: string; tone: 'go' | 'accent' | 'neutral'; run: () => void } | null;
  onItem?: (lineId: string) => void; onOpen?: () => void;
}
export function Ticket({ o, st, now, cfg, meta, recalled, action, onItem, onOpen }: TicketProps) {
  const age = now - o.createdAt, tone = ageTone(age, cfg), lines = linesAt(o, st);
  const notes = [o.note, ...lines.filter(l => l.note).map(l => `${l.note} (${l.name})`)].filter(Boolean) as string[];
  const allergy = notes.some(n => /allerg|alergi|no nut|peanut|kacang|gluten|halal/i.test(n));
  const isNew = lines.every(l => l.kds === 'new') && age < 90e3;
  const online = isOnline(o);
  const border = tone === 'late' ? 'var(--danger)' : tone === 'warn' ? 'var(--warning)' : o.tier === 'rush' ? 'var(--danger-fg)' : 'var(--border)';
  const head: CSSProperties = cfg.colors === 'channel'
    ? { background: 'var(--bg-raised)', color: 'var(--fg-1)', boxShadow: `inset 8px 0 0 ${CHANNEL[o.source].color}` }
    : tone === 'late' ? { background: 'var(--danger)', color: '#fff' } : tone === 'warn' ? { background: 'var(--warning-soft)', color: 'var(--warning-fg)' } : { background: 'var(--bg-raised)', color: 'var(--fg-1)' };
  const timerColor = cfg.colors === 'channel' ? (tone === 'late' ? 'var(--danger-fg)' : tone === 'warn' ? 'var(--warning-fg)' : 'inherit') : 'inherit';
  return <article style={{ borderRadius: 18, background: 'var(--bg-surface)', border: `3px solid ${border}`, overflow: 'hidden', display: 'flex', flexDirection: 'column', animation: 'fade 220ms var(--ease-out)', minWidth: 0 }}>
    <button type="button" onClick={onOpen} style={{ ...head, border: 0, textAlign: 'left', cursor: onOpen ? 'pointer' : 'default', padding: '12px 14px', display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start', font: 'inherit' }}
      aria-label={`Open ${ticketLabel(o)} detail`}>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
        <span className="row wrap" style={{ gap: 6 }}>{(online || o.source !== 'pos') && <ChannelPill o={o} />}<b style={{ fontSize: fs(22), lineHeight: 1.1 }}>{ticketLabel(o)}</b><TierPill o={o} />
          {isNew && <Pill bg="var(--accent)" fg="#fff">New</Pill>}{recalled && <Pill bg="var(--info-soft)" fg="var(--info-fg)">Recalled</Pill>}</span>
        <span style={{ fontSize: fs(15), fontWeight: 600, opacity: .9 }}>{meta}</span>
      </span>
      <span style={{ flex: 'none', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
        <b style={{ fontSize: fs(24), color: timerColor }}>{mmss(age)}</b>
        {online && o.readyBy && <span style={{ fontSize: fs(15), fontWeight: 800, whiteSpace: 'nowrap', color: tone === 'late' && cfg.colors === 'timer' ? '#fff' : minsLeft(o.readyBy, now) < 0 ? 'var(--danger-fg)' : minsLeft(o.readyBy, now) < 4 ? 'var(--warning-fg)' : 'inherit' }}>Ready by {hhmm(o.readyBy)} · {dueText(o.readyBy, now)}</span>}
      </span>
    </button>
    {(o.tier === 'rush' || notes.length > 0) && <div style={{ padding: '8px 14px', background: 'var(--danger)', color: '#fff', fontSize: fs(15), fontWeight: 800, lineHeight: 1.35 }}>
      {[o.tier === 'rush' && 'RUSH', allergy && 'ALLERGY', !allergy && notes.length && 'NOTE'].filter(Boolean).join(' · ')}{notes.length > 0 && <>: {notes.join(' · ')}</>}</div>}
    <div style={{ padding: '4px 14px', display: 'flex', flexDirection: 'column' }}>
      {lines.map(l => <button key={l.id} type="button" onClick={onItem ? () => onItem(l.id) : undefined} disabled={!onItem}
        style={{ border: 0, borderBottom: '1px solid var(--border)', background: 'none', color: 'inherit', textAlign: 'left', padding: '10px 0', minHeight: 56, cursor: onItem ? 'pointer' : 'default', display: 'flex', flexDirection: 'column', gap: 3, opacity: l.kds === 'done' ? .4 : 1, font: 'inherit' }}
        aria-pressed={l.kds === 'done'} aria-label={`${l.qty} ${l.name}${l.kds === 'done' ? ', done' : ''}`}>
        <span style={{ fontSize: fs(20), fontWeight: 700, fontFamily: 'var(--font-display)', textDecoration: l.kds === 'done' ? 'line-through' : 'none' }}>
          <span style={{ color: 'var(--accent-fg)' }}>{l.qty}×</span> {l.name}{st === 'all' && <span style={{ fontSize: fs(15), fontWeight: 600, color: 'var(--fg-3)' }}> · {l.station}</span>}
          {l.kds === 'cooking' && <span style={{ fontSize: fs(15), fontWeight: 600, color: 'var(--warning-fg)' }}> · cooking</span>}</span>
        {l.mods.length > 0 && <span style={{ fontSize: fs(15), color: 'var(--accent-fg)' }}>— {lineMods(l)}</span>}
        {l.note && <span style={{ fontSize: fs(15), color: 'var(--danger-fg)', fontWeight: 700 }}>{l.note}</span>}
      </button>)}
    </div>
    {action && <div style={{ padding: 12, marginTop: 'auto' }}><KBtn big tone={action.tone} onClick={action.run} style={{ width: '100%' }}>{action.label}</KBtn></div>}
  </article>;
}

/** "Don't reorder while touched": while a cook's hand is on the screen, keep positions; new tickets append. */
export function useStableOrder<T extends { id: string }>(list: T[], hold: boolean): T[] {
  const prev = useRef<string[]>([]);
  if (!hold) { prev.current = list.map(x => x.id); return list; }
  const map = new Map(list.map(x => [x.id, x]));
  const kept = prev.current.filter(id => map.has(id)).map(id => map.get(id)!);
  const added = list.filter(x => !prev.current.includes(x.id));
  prev.current = [...kept, ...added].map(x => x.id);
  return [...kept, ...added];
}
export function useTouchHold(ms = 4000) {
  const [until, setUntil] = useState(0);
  return { hold: until > Date.now(), touch: () => setUntil(Date.now() + ms) };
}

/** Request a screen wake lock; re-acquired when the tab becomes visible again. */
export function useWakeLock() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    const req = async () => { try { lock = await navigator.wakeLock.request('screen'); setOn(true); lock.addEventListener('release', () => setOn(false)); } catch { setOn(false); } };
    void req();
    const vis = () => { if (document.visibilityState === 'visible') void req(); };
    document.addEventListener('visibilitychange', vis);
    return () => { document.removeEventListener('visibilitychange', vis); void lock?.release().catch(() => {}); };
  }, []);
  return on;
}
let ac: AudioContext | null = null;
/** sfx-order-in: two short tones. */
export function chime() {
  try {
    ac ??= new AudioContext();
    [660, 880].forEach((f, i) => { const o = ac!.createOscillator(), g = ac!.createGain(), t = ac!.currentTime + i * .14; o.frequency.value = f; o.connect(g); g.connect(ac!.destination); g.gain.setValueAtTime(.2, t); g.gain.exponentialRampToValueAtTime(.0001, t + .25); o.start(t); o.stop(t + .27); });
  } catch { /* audio blocked until first tap */ }
}
