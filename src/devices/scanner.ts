// Barcode scanners. Keyboard mode (USB/Bluetooth "HID keyboard", every scanner's default) works with no driver:
// the scanner types the code very fast and ends with Enter; we tell it apart from a person by the gap between keys.
import { useEffect, useRef } from 'react';
import type { DB, Product } from '../data/schema.ts';
import { hidDevice } from './transports.ts';

export interface WedgeOpts { minLength?: number; maxGap?: number }
/** Burst detector: feed keys with their time; returns the code when a fast burst ends with Enter, else null. */
export function createWedge({ minLength = 4, maxGap = 35 }: WedgeOpts = {}) {
  let buf = '', last = 0;
  return (key: string, t: number): string | null => {
    if (t - last > maxGap) buf = '';
    last = t;
    if (key === 'Enter' || key === 'Tab') { const code = buf; buf = ''; return code.length >= minLength ? code : null; }
    if (key.length === 1) buf += key;
    return null;
  };
}

/** Product by scanned code: SKU (case-insensitive, with or without dashes). Product has no separate EAN field yet. */
export function findByCode(db: DB, code: string): Product | undefined {
  const norm = (s: string) => s.toLowerCase().replace(/[\s-]/g, '');
  const c = norm(code);
  return c ? db.products.find(p => p.status !== 'archived' && norm(p.sku) === c) : undefined;
}

/** Listens on the whole page. Scans typed into an input still reach the input; we stop the trailing Enter there. */
export function useWedgeScanner(onScan: (code: string) => void, opts: WedgeOpts & { enabled?: boolean } = {}) {
  const cb = useRef(onScan); cb.current = onScan;
  const { minLength, maxGap, enabled = true } = opts;
  useEffect(() => {
    if (!enabled) return;
    const feed = createWedge({ minLength, maxGap });
    const k = (e: KeyboardEvent) => {
      const code = feed(e.key, e.timeStamp || performance.now());
      if (code) { e.preventDefault(); e.stopPropagation(); cb.current(code); }
    };
    addEventListener('keydown', k, true);
    return () => removeEventListener('keydown', k, true);
  }, [enabled, minLength, maxGap]);
}

/** HID POS scanner (usage page 0x8C): decoded data arrives as input reports; printable bytes are the code. */
export function hidCode(data: DataView): string {
  let s = '';
  for (let i = 0; i < data.byteLength; i++) { const b = data.getUint8(i); if (b >= 0x20 && b < 0x7f) s += String.fromCharCode(b); }
  return s.trim();
}
export async function listenHid(desc: string, onScan: (code: string) => void): Promise<() => void> {
  const d = await hidDevice(desc);
  const f = (e: { data: DataView }) => { const c = hidCode(e.data); if (c) onScan(c); };
  d.addEventListener('inputreport', f);
  return () => d.removeEventListener('inputreport', f);
}
