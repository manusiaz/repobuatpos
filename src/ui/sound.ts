// The app's sounds: short WebAudio sine tones (each under 400 ms). Which tone plays where, and how loud, is the
// Customization Studio "Custom sounds" tool (POS, kitchen display, customer display).
import type { DB } from '../data/schema.ts';
import { toolValue } from '../system/tools.ts';

let ac: AudioContext | null = null;
export function tone(hz: number[], vol = 70, step = .1, dur = .14) {
  if (!hz.length || vol <= 0) return;
  try {
    ac ??= new AudioContext(); const c = ac;
    hz.forEach((f, i) => { const o = c.createOscillator(), g = c.createGain(), t = c.currentTime + i * step; o.type = 'sine'; o.frequency.value = f; o.connect(g); g.connect(c.destination);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.25 * vol / 100, t + .01); g.gain.exponentialRampToValueAtTime(.0001, t + dur); o.start(t); o.stop(t + dur + .01); });
  } catch { /* audio blocked until the first tap */ }
}
export const SFX: Record<string, Record<string, number[]>> = {
  'sfx-order-in': { default: [880, 1320], bell: [1046, 1568, 1318], marimba: [523, 784, 1046], off: [] },
  'sfx-pay-success': { default: [523, 659, 784], coin: [1568, 2093], soft: [659, 784], off: [] },
  'sfx-pay-fail': { default: [440, 330], low: [330, 247], off: [] },
  'sfx-scan': { default: [1760], click: [2637], off: [] },
};
export type Sfx = keyof typeof SFX;
/** Tones of one published sound; the kitchen and the customer display each have their own on/off switch. */
export function sfxOf(db: DB, key: Sfx, where: 'pos' | 'kds' | 'display' = 'pos') {
  const v = toolValue(db, 'sounds');
  if ((where === 'kds' && !v.kds) || (where === 'display' && !v.disp)) return { hz: [] as number[], vol: 0 };
  return { hz: SFX[key][String(v[key])] ?? SFX[key].default, vol: Number(v.vol) };
}
export const playSfx = (db: DB, key: Sfx, where: 'pos' | 'kds' | 'display' = 'pos') => { const s = sfxOf(db, key, where); tone(s.hz, s.vol); };
