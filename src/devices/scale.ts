// Scales over Web Serial (RS-232 or USB-serial: CAS, Digi, Ohaus, A&D, Toledo-style continuous output).
// The scale streams or answers a request with frames like "ST,GS,+  0.250kg" or "  0.250 kg"; we read until one is stable.
import { serialPort } from './transports.ts';

export interface Weight { kg: number; stable: boolean; net: boolean }

/** One frame → weight in kg (3 decimals), or null for overload / garbage. */
export function parseWeight(frame: string, unit: 'kg' | 'g' = 'kg'): Weight | null {
  const f = frame.replace(/[\x00-\x1f]/g, ' ').trim();
  if (!f || /\b(OL|ERR|OVER)\b/i.test(f)) return null;
  const m = /([+-])?\s*(\d+(?:[.,]\d+)?)\s*(kg|g|lb)?\b/i.exec(f.replace(/^[A-Z]{2},[A-Z]{2},/i, ''));
  if (!m) return null;
  const v = Number(m[2].replace(',', '.')) * (m[1] === '-' ? -1 : 1), u = (m[3] ?? unit).toLowerCase();
  const kg = u === 'g' ? v / 1000 : u === 'lb' ? v * 0.45359237 : v;
  return { kg: Math.round(kg * 1000) / 1000, stable: !/\b(US|MO)\b/i.test(f), net: /\bNT\b/i.test(f) };
}

/** Reads the scale once: optional request command (e.g. "W" or "P"), then the first stable frame within the timeout. */
export async function readScale(desc: string, opts: { baud?: number; request?: string; unit?: 'kg' | 'g'; timeout?: number } = {}): Promise<Weight> {
  const port = await serialPort(desc);
  await port.open({ baudRate: opts.baud || 9600 }).catch(e => { if (!/already open/i.test(String(e))) throw e; });
  const reader = port.readable!.getReader();
  const stop = setTimeout(() => { reader.cancel().catch(() => {}); }, opts.timeout ?? 3000);
  let buf = '', last: Weight | null = null;
  try {
    if (opts.request) { const w = port.writable!.getWriter(); await w.write(new TextEncoder().encode(opts.request + '\r\n')); w.releaseLock(); }
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += new TextDecoder().decode(value);
      const parts = buf.split(/[\r\n]+/); buf = parts.pop() ?? '';
      for (const p of parts) { const w = parseWeight(p, opts.unit); if (w) { last = w; if (w.stable) return w; } }
    }
  } finally { clearTimeout(stop); reader.releaseLock(); await port.close().catch(() => {}); }
  if (last) throw new Error(`Weight not stable (${last.kg.toFixed(3)} kg). Wait for the scale to settle and read again.`);
  throw new Error('No reading from the scale. Check the cable and the baud rate.');
}
