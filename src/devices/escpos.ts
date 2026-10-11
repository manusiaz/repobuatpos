// ESC/POS byte encoder (Epson-compatible: Epson TM, Xprinter, RONGTA, EPPOS, Panda, most 58/80 mm thermals).
// Pure, no deps. Text is reduced to printable ASCII so every printer prints it the same on its default codepage.
export type Paper = '58' | '80';
export const COLS: Record<Paper, number> = { '58': 32, '80': 48 };

const ESC = 0x1b, GS = 0x1d;
const MAP: Record<string, string> = { '·': '-', '•': '*', '×': 'x', '–': '-', '—': '-', '−': '-', '‘': "'", '’': "'", '“': '"', '”': '"', '…': '...', '→': '>', '←': '<', '½': '1/2', '°': 'o', 'ß': 'ss', 'æ': 'ae', 'Æ': 'AE', 'ø': 'o', 'Ø': 'O', '€': 'EUR', ' ': ' ', '\t': ' ' };
/** Codepage-safe text: accents stripped (é → e), punctuation mapped, anything else becomes '?'. */
export const ascii = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7e\n]/g, c => MAP[c] ?? '?');
const bytesOf = (s: string) => Array.from(ascii(s), c => c.charCodeAt(0));

export const CMD = {
  init: [ESC, 0x40, ESC, 0x74, 0x00],
  bold: (on: boolean) => [ESC, 0x45, on ? 1 : 0],
  align: (a: 'left' | 'center' | 'right') => [ESC, 0x61, a === 'left' ? 0 : a === 'center' ? 1 : 2],
  /** GS ! n: width and height multipliers 1–8. */
  size: (w = 1, h = 1) => [GS, 0x21, ((w - 1) << 4) | (h - 1)],
  invert: (on: boolean) => [GS, 0x42, on ? 1 : 0],
  feed: (n = 1) => [ESC, 0x64, Math.max(0, Math.min(255, n))],
  /** GS V 66 0: feed to the cutter, then partial cut. */
  cut: [GS, 0x56, 0x42, 0x00],
  /** ESC p m t1 t2: pin 0 = drawer 1 (pin 2), 1 = drawer 2 (pin 5); pulse 25 × 2 ms on, 250 × 2 ms off. */
  kick: (pin: 0 | 1 = 0, on = 25, off = 250) => [ESC, 0x70, pin, on, off],
  beep: [ESC, 0x42, 0x03, 0x02],
};

/** QR via GS ( k: model 2, module size, ECC M, store, print. */
export function qr(data: string, size = 6): number[] {
  const d = Array.from(new TextEncoder().encode(data)), n = d.length + 3;
  return [GS, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00, GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, size, GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x31,
    GS, 0x28, 0x6b, n & 0xff, n >> 8, 0x31, 0x50, 0x30, ...d, GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30];
}
/** CODE128 (code set B) via GS k 73, human-readable text below. */
export function code128(data: string, height = 80, width = 2): number[] {
  const d = bytesOf(data).slice(0, 253);
  return [GS, 0x68, height, GS, 0x77, width, GS, 0x48, 0x02, GS, 0x6b, 0x49, d.length + 2, 0x7b, 0x42, ...d];
}

/** Chainable builder. `line` writes one already-laid-out line (layout.ts does the wrapping). */
export function escpos() {
  const out: number[] = [...CMD.init];
  const b = {
    raw(...xs: number[][]) { xs.forEach(x => out.push(...x)); return b; },
    text(s: string) { out.push(...bytesOf(s)); return b; },
    line(s = '') { out.push(...bytesOf(s), 0x0a); return b; },
    bold(on: boolean) { return b.raw(CMD.bold(on)); },
    align(a: 'left' | 'center' | 'right') { return b.raw(CMD.align(a)); },
    size(w = 1, h = 1) { return b.raw(CMD.size(w, h)); },
    invert(on: boolean) { return b.raw(CMD.invert(on)); },
    feed(n = 1) { return b.raw(CMD.feed(n)); },
    qr(data: string, size?: number) { return b.raw(qr(data, size)); },
    barcode(data: string) { return b.raw(code128(data)); },
    cut() { return b.raw(CMD.cut); },
    kick(pin: 0 | 1 = 0) { return b.raw(CMD.kick(pin)); },
    bytes: () => Uint8Array.from(out),
  };
  return b;
}

/** Epson DM-D style VFD: clear, line 1, cursor to line 2, line 2 (20 columns each). */
export const poleBytes = (l1: string, l2: string) => {
  const t = (s: string) => Array.from(ascii(s).slice(0, 20).padEnd(20), c => c.charCodeAt(0));
  return Uint8Array.from([0x1b, 0x40, 0x0c, ...t(l1), 0x1f, 0x24, 1, 2, ...t(l2)]);
};
