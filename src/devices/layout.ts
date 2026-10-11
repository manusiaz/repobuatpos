// One printed document, three renderers: ESC/POS bytes (thermal), text lines (on-screen preview), HTML (browser print, html.ts).
import { ascii, COLS, escpos, type Paper } from './escpos.ts';

export type Align = 'left' | 'center' | 'right';
/** wide = double width + height (headers, kitchen items) · tall = double height only (totals). */
export type Size = 'normal' | 'tall' | 'wide';
export type Op =
  | { t: 'text'; s: string; align?: Align; bold?: boolean; size?: Size; invert?: boolean }
  | { t: 'lr'; l: string; r: string; bold?: boolean; size?: Size }
  | { t: 'rule'; ch?: string }
  | { t: 'feed'; n: number }
  | { t: 'qr'; data: string; size?: number }
  | { t: 'barcode'; data: string }
  | { t: 'cut' }
  | { t: 'kick'; pin?: 0 | 1 };
export interface Doc { paper: Paper; ops: Op[] }

export const colsOf = (paper: Paper, size: Size = 'normal') => size === 'wide' ? COLS[paper] / 2 : COLS[paper];

/** Word wrap to `w` columns; words longer than a line are split. */
export function wrap(s: string, w: number): string[] {
  const out: string[] = [];
  for (const para of ascii(s).split('\n')) {
    const ind = (/^ */.exec(para)?.[0] ?? '').slice(0, w >> 2), room = w - ind.length;
    const lines: string[] = [];
    let cur = '';
    for (let word of para.trim().split(/ +/)) {
      while (word.length > room) { if (cur) { lines.push(cur); cur = ''; } lines.push(word.slice(0, room)); word = word.slice(room); }
      if (!word) continue;
      if (!cur) cur = word; else if (cur.length + 1 + word.length <= room) cur += ' ' + word; else { lines.push(cur); cur = word; }
    }
    lines.push(cur);
    out.push(...lines.map(l => l ? ind + l : l));
  }
  return out;
}
/** Left text + right-aligned value; the left side wraps, the value sits on the last line. */
export function lr(l: string, r: string, w: number): string[] {
  r = ascii(r);
  const ls = wrap(l, w), last = ls[ls.length - 1];
  if (last.length + 1 + r.length <= w) ls[ls.length - 1] = last + ' '.repeat(w - last.length - r.length) + r;
  else ls.push(' '.repeat(Math.max(0, w - r.length)) + r.slice(-w));
  return ls;
}
const pad = (s: string, w: number, a: Align = 'left') => {
  const gap = Math.max(0, w - s.length);
  return a === 'left' ? s : a === 'right' ? ' '.repeat(gap) + s : ' '.repeat(Math.floor(gap / 2)) + s;
};

/** Laid-out lines of one op (what the paper shows), used by both the bytes and the preview. */
export function linesOf(op: Op, paper: Paper): string[] {
  if (op.t === 'text') return wrap(op.s, colsOf(paper, op.size));
  if (op.t === 'lr') return lr(op.l, op.r, colsOf(paper, op.size));
  if (op.t === 'rule') return [(op.ch ?? '-').repeat(COLS[paper])];
  return [];
}

export function toEscPos(doc: Doc): Uint8Array {
  const b = escpos();
  for (const op of doc.ops) {
    if (op.t === 'text' || op.t === 'lr') {
      const sz = op.size ?? 'normal';
      const al = op.t === 'text' && op.align && op.align !== 'left' ? op.align : null;
      if (al) b.align(al);
      if (op.bold) b.bold(true);
      if (sz !== 'normal') b.size(sz === 'wide' ? 2 : 1, 2);
      if (op.t === 'text' && op.invert) b.invert(true);
      const w = colsOf(doc.paper, sz), inv = op.t === 'text' && op.invert;
      linesOf(op, doc.paper).forEach(l => b.line(inv ? pad(l, w, op.t === 'text' ? op.align : 'left').padEnd(w) : l));
      if (op.t === 'text' && op.invert) b.invert(false);
      if (sz !== 'normal') b.size(1, 1);
      if (op.bold) b.bold(false);
      if (al) b.align('left');
    } else if (op.t === 'rule') linesOf(op, doc.paper).forEach(l => b.line(l));
    else if (op.t === 'feed') b.feed(op.n);
    else if (op.t === 'qr') b.align('center').qr(op.data, op.size ?? (doc.paper === '58' ? 5 : 6)).align('left');
    else if (op.t === 'barcode') b.align('center').barcode(op.data).line().align('left');
    else if (op.t === 'cut') b.cut();
    else if (op.t === 'kick') b.kick(op.pin ?? 0);
  }
  return b.bytes();
}

/** Plain preview: every line padded to the paper width, so the screen shows exactly what prints. */
export function toText(doc: Doc): string[] {
  const W = COLS[doc.paper], out: string[] = [];
  for (const op of doc.ops) {
    if (op.t === 'text') { const w = colsOf(doc.paper, op.size); wrap(op.s, w).forEach(l => out.push(pad(l, op.size === 'wide' ? W : w, op.align))); }
    else if (op.t === 'lr') { const w = colsOf(doc.paper, op.size); out.push(...lr(op.l, op.r, w)); }
    else if (op.t === 'rule') out.push(...linesOf(op, doc.paper));
    else if (op.t === 'feed') out.push(...Array.from({ length: Math.min(op.n, 2) }, () => ''));
    else if (op.t === 'qr') out.push(pad('[QR] ' + op.data, W, 'center'));
    else if (op.t === 'barcode') out.push(pad('||| ' + op.data + ' |||', W, 'center'));
    else if (op.t === 'cut') out.push('- '.repeat(W / 2).trimEnd());
  }
  return out.map(l => l.trimEnd());
}

export const toBase64 = (b: Uint8Array) => { let s = ''; b.forEach(x => { s += String.fromCharCode(x); }); return btoa(s); };
