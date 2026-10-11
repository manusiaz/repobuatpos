// Browser print: the same Doc as the thermal bytes, as an HTML page sized to the roll (58 / 80 mm). Works on any
// device with any printer the OS knows (AirPrint, Android print service, Windows driver). Chrome with --kiosk-printing prints silently.
import { qrMatrix } from '../ui/qr.tsx';
import { COLS } from './escpos.ts';
import { colsOf, linesOf, type Doc } from './layout.ts';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
function qrSvg(data: string) {
  const m = qrMatrix(data), n = m.length + 8; let d = '';
  m.forEach((row, y) => row.forEach((on, x) => { if (on) d += `M${x + 4} ${y + 4}h1v1h-1z`; }));
  return `<svg viewBox="0 0 ${n} ${n}" width="140" height="140" shape-rendering="crispEdges"><path d="${d}" fill="currentColor"/></svg>`;
}

export function docToHtml(doc: Doc, copies = 1): string {
  const W = COLS[doc.paper], body: string[] = [];
  for (const op of doc.ops) {
    if (op.t === 'text' || op.t === 'lr') {
      const cls = [op.bold && 'b', op.size === 'wide' && 'w', op.size === 'tall' && 't', op.t === 'text' && op.invert && 'i'].filter(Boolean).join(' ');
      const align = op.t === 'text' ? op.align ?? 'left' : 'left';
      body.push(`<div class="${cls}" style="text-align:${align}">${linesOf(op, doc.paper).map(l => esc(op.t === 'lr' ? l : l.trim())).join('<br>')}</div>`);
    } else if (op.t === 'rule') body.push(`<div>${esc(linesOf(op, doc.paper)[0])}</div>`);
    else if (op.t === 'feed') body.push('<br>'.repeat(Math.min(op.n, 2)));
    else if (op.t === 'qr') body.push(`<div class="c">${qrSvg(op.data)}</div>`);
    else if (op.t === 'barcode') body.push(`<div class="c">${esc(op.data)}</div>`);
  }
  const mm = doc.paper === '58' ? 58 : 80;
  return `<!doctype html><html><head><meta charset="utf-8"><title>Receipt</title><style>
@page{size:${mm}mm auto;margin:0}html,body{margin:0}
body{width:${mm - 6}mm;padding:3mm;font:${doc.paper === '58' ? 11 : 12}px/1.35 "JetBrains Mono",ui-monospace,monospace;white-space:pre}
.b{font-weight:700}.w{font-size:200%;line-height:1.15;white-space:pre-wrap}.t{font-size:150%}.i{border:2px solid;font-weight:700}.c{text-align:center}
</style></head><body data-cols="${W}" data-wide-cols="${colsOf(doc.paper, 'wide')}">${Array.from({ length: copies }, () => body.join('\n')).join('<div style="break-after:page"></div>')}</body></html>`;
}

/** Prints through a hidden iframe so the register page stays as it is. */
export function browserPrint(doc: Doc, copies = 1): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof document === 'undefined') return reject(new Error('Browser print needs a screen'));
    const f = document.createElement('iframe');
    f.setAttribute('aria-hidden', 'true');
    Object.assign(f.style, { position: 'fixed', width: '0', height: '0', border: '0', right: '0', bottom: '0' });
    document.body.appendChild(f);
    const w = f.contentWindow!;
    w.document.open(); w.document.write(docToHtml(doc, copies)); w.document.close();
    setTimeout(() => {
      try { w.focus(); w.print(); resolve(); } catch (e) { reject(e as Error); }
      setTimeout(() => f.remove(), 60e3);
    }, 250);
  });
}
