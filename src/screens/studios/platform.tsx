'use client';
import { cnameTarget, config as hostConfig, linkTo, liveDomain } from '../../system/hosts.ts';
import { productImage } from '../../ui/kit.tsx';
import { SFX, tone } from '../../ui/sound.ts';
import { TOOL_DEFAULTS } from '../../system/tools.ts';
// Platform studio: fonts, icons, app icon, sounds, languages, white-label, domain & SSO, embeds, brand kit, theme from logo,
// motion, price & number display, accessible kiosk, legal pages, saved themes. Theme changes go through publish('menu').
import { useEffect, useState } from 'react';
import { publish, saveRecord, deleteRecord } from '../../data/actions.ts';
import type { Theme } from '../../data/schema.ts';
import { flashPrice } from '../../domain/promo.ts';
import { Badge, Empty, Icon, Seg, ago, toast } from '../../ui/kit.tsx';
import { Caption, Code, contrast, CopyRow, F, fontOf, hexOf, menuOf, mix, onColor, outletName, Phone, Stage, themeColor, themePairs, themeSwatches, WHITE, type Ctx, type PP, type Tool, type V } from './core.tsx';

// ── Fonts ────────────────────────────────────────────────────────────────────────────────
const UPLOADED = 'MerchantUpload';
let uploadedName = '';
function FontUpload({ set }: { set: PP['set'] }) {
  const [err, setErr] = useState('');
  return <div className="field"><label>Upload font</label><input className="input" type="file" accept=".woff2,.woff,.ttf,.otf" style={{ paddingTop: 10 }} onChange={async e => {
    const f = e.target.files?.[0]; if (!f) return; setErr('');
    if (f.size > 2e6) return setErr('Max 2 MB');
    try { const face = new FontFace(UPLOADED, await f.arrayBuffer()); await face.load(); document.fonts.add(face); uploadedName = f.name; set('upload', f.name); set('head', 'upload'); toast(f.name + ' loaded'); } catch { setErr('That file isn’t a font we can read'); }
  }} />{err && <span className="err">{err}</span>}</div>;
}
const fam = (k: string, t: Theme) => (k === 'upload' ? `'${UPLOADED}',${fontOf(t.font)}` : k === 'body' ? "'Instrument Sans',sans-serif" : fontOf(k));
function Fonts({ v, x }: PP) {
  const t = x.db.theme, menu = menuOf(x.db, x.outletId).slice(0, 2);
  return <Stage><Phone theme={t}><div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
    <b style={{ fontFamily: fam(v.head, t), fontSize: Math.round(36 * v.scale / 100), lineHeight: 1.05, color: 'var(--bn-p)' }}>{t.name}</b>
    <p style={{ fontFamily: fam(v.body, t), fontSize: Math.round(15 * v.scale / 100) }}>Order ahead, skip the queue and earn beans on every visit.</p>
    {menu.map(g => <div key={g.c.id} className="stack sm"><b style={{ fontFamily: fam(v.head, t), fontSize: Math.round(20 * v.scale / 100) }}>{g.c.name}</b>
      {g.items.slice(0, 3).map(i => <div key={i.p.id} className="row between" style={{ fontFamily: fam(v.body, t), fontSize: Math.round(14 * v.scale / 100) }}><span>{i.p.name}</span><b style={{ fontFamily: fam(v.head, t) }}>{Math.round(i.price / 1000)}k</b></div>)}</div>)}
  </div></Phone><Caption>Headings: {v.head === 'upload' ? (v.upload || 'uploaded font') : v.head}. Body: {v.body}. {v.head === 'upload' && !uploadedName ? 'Upload the file again on this device to preview it.' : ''} Staff tools always keep BorNiz fonts.</Caption></Stage>;
}

// ── Icons ────────────────────────────────────────────────────────────────────────────────
const ICONS = ['coffee', 'cup-soda', 'croissant', 'utensils', 'ice-cream-cone', 'leaf', 'flame', 'wheat', 'milk', 'beef', 'fish', 'salad'];
function Icons({ v, x }: PP) {
  const c = themeColor(x.db.theme, v.color);
  return <Stage><div className="grid" data-guest style={{ ['--min' as string]: '76px', width: 'min(520px,100%)', padding: 20, borderRadius: 20, background: x.db.theme.paper }}>
    {ICONS.map(n => <div key={n} className="stack" style={{ alignItems: 'center', gap: 6 }}>
      <span style={{ width: 56, height: 56, display: 'grid', placeItems: 'center', borderRadius: { none: 0, rounded: 14, circle: 99 }[v.shape as 'none'], background: v.style === 'filled' ? c : v.style === 'duo' ? mix(c, WHITE, .82) : 'transparent', color: v.style === 'filled' ? onColor(c, x.db.theme.ink) : c }}>
        <Icon name={n} size={26} strokeWidth={v.stroke} fill={v.style === 'duo' ? mix(c, WHITE, .6) : 'none'} /></span><span style={{ fontSize: 11, color: x.db.theme.ink }}>{n}</span></div>)}
  </div><Caption>Used for categories and dietary badges on the menu, kiosk and member app.</Caption></Stage>;
}

// ── App icon, favicon, share image (generated with canvas) ───────────────────────────────
function drawIcon(size: number, v: V, t: Theme, logo?: HTMLImageElement | null, w = size, h = size) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d')!;
  const bg = themeColor(t, v.bg); g.fillStyle = bg;
  const r = v.shape === 'circle' ? size / 2 : v.shape === 'square' ? size * .06 : size * .22;
  g.beginPath(); g.roundRect(0, 0, w, h, w === h ? r : 0); g.fill();
  if (logo) { const s = Math.min(w, h) * .62; g.drawImage(logo, (w - s) / 2, (h - s) / 2, s, s); }
  else { g.fillStyle = onColor(bg, t.ink); g.font = `700 ${Math.min(w, h) * .42}px 'Space Grotesk', sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(initials(v.name), w / 2, h / 2 + Math.min(w, h) * .03); }
  if (w !== h) { g.fillStyle = onColor(bg, t.ink); g.font = `700 64px 'Space Grotesk', sans-serif`; g.textAlign = 'left'; g.fillText(v.og, 60, h - 80); }
  return c.toDataURL('image/png');
}
const initials = (n: string) => String(n || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
function useLogo(src?: string) { const [img, setImg] = useState<HTMLImageElement | null>(null); useEffect(() => { if (!src) return setImg(null); const i = new Image(); i.onload = () => setImg(i); i.src = src; }, [src]); return img; }
function AppIconPanel({ v, set, x }: PP) {
  const logo = useLogo(v.logo);
  const dl = (name: string, size: number, w?: number, h?: number) => { const a = document.createElement('a'); a.href = drawIcon(size, v, x.db.theme, logo, w, h); a.download = name; a.click(); };
  return <div className="stack">
    <div className="field"><label>Logo (PNG or SVG, square)</label><input className="input" type="file" accept="image/png,image/svg+xml,image/jpeg" style={{ paddingTop: 10 }} onChange={e => { const f = e.target.files?.[0]; if (!f) return; if (f.size > 300e3) return toast('Max 300 KB'); const r = new FileReader(); r.onload = () => set('logo', r.result as string); r.readAsDataURL(f); }} /></div>
    {v.logo && <button className="btn btn-ghost btn-sm" onClick={() => set('logo', '')}>Use initials instead</button>}
    <div className="field"><label>App name</label><input className="input" value={v.name} onChange={e => set('name', e.target.value)} /></div>
    <div className="field"><label>Background</label><div className="row">{themeSwatches(x.db.theme).map(([k, c, l]) => <button key={k} aria-label={l} aria-pressed={v.bg === k} onClick={() => set('bg', k)} style={{ width: 44, height: 44, borderRadius: 12, border: 0, background: c, boxShadow: v.bg === k ? '0 0 0 2px var(--bg-surface),0 0 0 4px var(--role)' : '0 0 0 1px var(--border)' }} />)}</div></div>
    <div className="field"><label>Shape</label><Seg value={v.shape} options={[['squircle', 'Squircle'], ['circle', 'Circle'], ['square', 'Square']] as const} onChange={s => set('shape', s)} /></div>
    <div className="field"><label>Share title</label><input className="input" value={v.og} onChange={e => set('og', e.target.value)} /></div>
    <span className="cap">Download</span>
    <div className="row wrap"><button className="btn btn-sm" onClick={() => dl('favicon-32.png', 32)}>Favicon 32</button><button className="btn btn-sm" onClick={() => dl('apple-touch-icon.png', 180)}>Apple 180</button><button className="btn btn-sm" onClick={() => dl('icon-512.png', 512)}>PWA 512</button><button className="btn btn-sm" onClick={() => dl('share-1200x630.png', 630, 1200, 630)}>Share 1200×630</button></div>
  </div>;
}
function AppIcon({ v, x }: PP) {
  const t = x.db.theme, bg = themeColor(t, v.bg), r = { squircle: '22%', circle: '50%', square: '6px' }[v.shape as 'squircle'];
  const Ico = ({ s }: { s: number }) => <span style={{ width: s, height: s, borderRadius: r, background: bg, color: onColor(bg, t.ink), display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: s * .4, fontFamily: 'var(--font-display)', overflow: 'hidden', flex: 'none' }}>{v.logo ? <img src={v.logo} alt="" style={{ width: '62%', height: '62%', objectFit: 'contain' }} /> : initials(v.name)}</span>;
  return <Stage>
    <div className="card tight row" style={{ width: 'min(420px,100%)' }}><Ico s={18} /><span className="grow" style={{ fontSize: 13 }}>{v.name} · Order online</span><Icon name="x" size={14} /></div>
    <div className="row wrap" style={{ gap: 18, justifyContent: 'center', padding: 20, borderRadius: 24, background: `linear-gradient(160deg,${t.ink},${t.p})` }}>{[0, 1, 2, 3].map(i => <div key={i} className="stack" style={{ alignItems: 'center', gap: 4 }}>{i === 1 ? <Ico s={60} /> : <span style={{ width: 60, height: 60, borderRadius: 14, background: 'color-mix(in srgb,var(--ink-0) 25%,transparent)' }} />}<span style={{ fontSize: 11, color: 'var(--ink-0)' }}>{i === 1 ? v.name : ' '}</span></div>)}</div>
    <div className="card flat" style={{ width: 'min(420px,100%)' }}><div style={{ height: 180, background: bg, color: onColor(bg, t.ink), padding: 20, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}><Ico s={48} /><b style={{ fontSize: 22, fontFamily: 'var(--font-display)' }}>{v.og}</b></div><div style={{ padding: 12, fontSize: 13 }} className="muted">order.{t.name.toLowerCase().replace(/\s/g, '')}.id</div></div>
    <Caption>Browser tab, home screen and the card shown when a link is shared on WhatsApp or Instagram.</Caption>
  </Stage>;
}

// ── Sounds (WebAudio sine tones, each under 400 ms) ──────────────────────────────────────
const SFX_LABEL: Record<string, string> = { 'sfx-order-in': 'New order (POS, KDS)', 'sfx-pay-success': 'Payment success', 'sfx-pay-fail': 'Payment failed', 'sfx-scan': 'Barcode scan' };
function Sounds({ v }: PP) {
  return <Stage><div className="stack" style={{ width: 'min(480px,100%)' }}>{Object.keys(SFX).map(k => { const hz = SFX[k][v[k]] ?? []; return <div key={k} className="card tight row">
    <span style={{ width: 40, height: 40, borderRadius: 12, background: 'var(--accent-soft)', color: 'var(--accent-fg)', display: 'grid', placeItems: 'center' }}><Icon name="volume-2" /></span>
    <div className="grow stack" style={{ gap: 0 }}><b>{SFX_LABEL[k]}</b><span className="faint mono">{k} · {v[k]} · {hz.length ? Math.round(((hz.length - 1) * .1 + .15) * 1000) + ' ms' : 'off'}</span></div>
    <button className="btn btn-sm" disabled={!hz.length} onClick={() => tone(hz, v.vol)}><Icon name="play" size={16} />Play</button></div>; })}</div>
    <Caption>Volume {v.vol}%. Kitchen display chime {v.kds ? 'on' : 'off'}, customer display sounds {v.disp ? 'on' : 'off'}. Uploads: MP3 or OGG under 2 seconds.</Caption></Stage>;
}

// ── Languages ────────────────────────────────────────────────────────────────────────────
const UI: Record<string, [string, string]> = { id: ['Tambah', 'Pesan sekarang'], en: ['Add', 'Order now'], zh: ['添加', '立即下单'], ja: ['追加', '今すぐ注文'], ko: ['추가', '지금 주문'] };
const LANGS: [string, string][] = [['id', 'Indonesia'], ['en', 'English'], ['zh', '中文'], ['ja', '日本語'], ['ko', '한국어']];
function LangPanel({ v, set, x }: PP) {
  const ps = x.db.products.filter(p => p.status === 'live').slice(0, 8), lang = v.edit ?? 'en';
  const on = LANGS.filter(([k]) => k === v.def || v[k]);
  return <div className="stack">
    <div className="field"><label>Default language</label><Seg value={v.def} options={[['id', 'Indonesia'], ['en', 'English']] as const} onChange={d => set('def', d)} /></div>
    {LANGS.filter(([k]) => k !== v.def).map(([k, l]) => <label key={k} className="row between" style={{ minHeight: 44 }}><span>{l}</span><input type="checkbox" checked={!!v[k]} onChange={e => set(k, e.target.checked)} style={{ width: 22, height: 22, accentColor: 'var(--role)' }} /></label>)}
    <span className="cap">Translate menu items</span>
    <Seg value={lang} options={on.filter(([k]) => k !== v.def) as [string, string][]} onChange={l => set('edit', l)} />
    {ps.map(p => <div key={p.id} className="field"><label className="row between"><span>{p.name}</span>{!v[`tr:${p.id}:${lang}`] && <span className="hint">uses {v.def.toUpperCase()}</span>}</label>
      <input className="input" value={v[`tr:${p.id}:${lang}`] ?? ''} placeholder={p.name} onChange={e => set(`tr:${p.id}:${lang}`, e.target.value)} /></div>)}
  </div>;
}
function Lang({ v, set, x }: PP) {
  const t = x.db.theme, prev = v.prev ?? v.edit ?? 'en', ui = UI[prev] ?? UI.en;
  const menu = menuOf(x.db, x.outletId).flatMap(g => g.items).slice(0, 5);
  const on = LANGS.filter(([k]) => k === v.def || v[k]);
  const missing = menu.filter(i => !v[`tr:${i.p.id}:${prev}`] && prev !== v.def).length;
  return <Stage><Phone theme={t}>
    <div style={{ padding: 14, display: 'flex', gap: 6, flexWrap: 'wrap' }}>{on.map(([k, l]) => <span key={k} style={{ padding: '4px 10px', borderRadius: 99, fontSize: 12, background: k === prev ? 'var(--bn-p)' : 'transparent', color: k === prev ? onColor(t.p, t.ink) : 'inherit', border: '1px solid color-mix(in srgb,var(--bn-ink) 20%,transparent)' }}>{l}</span>)}</div>
    <div style={{ padding: '0 14px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>{menu.map(i => <div key={i.p.id} className="row" style={{ padding: 10, borderRadius: 14, background: 'var(--ink-0)', gap: 10 }}>
      <span style={{ width: 44, height: 44, borderRadius: 10, background: productImage(i.p), flex: 'none' }} />
      <span className="grow" style={{ fontSize: 14 }}><b>{v[`tr:${i.p.id}:${prev}`] || i.p.name}</b><br /><span style={{ fontSize: 12, opacity: .7 }}>{Math.round(i.price / 1000)}k</span></span>
      <span style={{ padding: '6px 12px', borderRadius: 10, background: 'var(--bn-p)', color: onColor(t.p, t.ink), fontSize: 13, fontWeight: 700 }}>{ui[0]}</span></div>)}</div>
  </Phone>
    <Seg value={prev} options={on as [string, string][]} onChange={l => set('prev', l)} label="Preview language" />
    <Caption>{missing ? `${missing} item${missing > 1 ? 's' : ''} fall back to ${v.def.toUpperCase()}.` : 'All shown items translated.'} Use the chips in settings to edit; customers switch language on the menu cover.</Caption></Stage>;
}

// ── White-label, domain & SSO, embeds ────────────────────────────────────────────────────
function White({ v, x }: PP) {
  const t = x.db.theme, c = themeColor(t, v.color);
  return <Stage><div className="card stack" style={{ width: 'min(440px,100%)' }}>
    <div className="row" style={{ gap: 14 }}><span style={{ width: 84, height: 84, borderRadius: '22%', background: c, color: onColor(c, t.ink), display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 30, fontFamily: 'var(--font-display)' }}>{initials(v.name)}</span>
      <div className="stack" style={{ gap: 2 }}><b style={{ fontSize: 20 }}>{v.name}</b><span className="muted">{v.sub}</span><span className="faint mono">{v.bundle}</span></div></div>
    <div className="row"><span className="btn btn-primary btn-sm">Get</span><span className="faint" style={{ fontSize: 12 }}>App Store · Google Play</span></div>
    <div className="row" style={{ gap: 8, overflow: 'hidden' }}>{['Menu', 'Beans', 'Order'].map(s => <div key={s} style={{ flex: 1, aspectRatio: '9/16', borderRadius: 12, background: `linear-gradient(180deg,${c},${t.ink})`, color: onColor(c, t.ink), padding: 8, fontSize: 12, fontWeight: 700 }}>{s}</div>)}</div>
  </div><Caption>BorNiz builds, signs and submits the app under your developer accounts. Members, beans and orders stay the same data.</Caption></Stage>;
}
function DomainPanel({ v, set, x }: PP) {
  const [st, setSt] = useState('');
  const host = String(v.menu ?? '').trim().toLowerCase(), live = liveDomain(x.db.tenant.id);
  const check = async () => { setSt('Checking…'); try { const r = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(host)}&type=CNAME`); const j = await r.json() as { Answer?: { data: string }[] }; setSt((j.Answer ?? []).some(a => a.data.replace(/\.$/, '') === cnameTarget()) ? 'CNAME is right' : 'CNAME not found yet'); } catch { setSt('Couldn’t check'); } };
  return <div className="stack">
    <div className="field"><label>Menu & store domain</label><input className="input" value={String(v.menu ?? '')} onChange={e => set('menu', e.target.value)} placeholder="order.yourbrand.id" autoCapitalize="none" /></div>
    <CopyRow label="CNAME" value={cnameTarget()} />
    <div className="row between"><button className="btn btn-sm" disabled={!host} onClick={check}>Check DNS</button>{st && <Badge tone={st === 'CNAME is right' ? 'success' : 'warning'}>{st}</Badge>}</div>
    {live ? <Badge tone="success" dot>Live at {live}</Badge> : <Badge tone="warning" dot>Not live yet</Badge>}
    <p className="faint" style={{ fontSize: 13 }}>Your domain serves the QR menu, kiosk and online store; staff keep using {x.db.tenant.id}.{hostConfig().root}. Once the CNAME is right, BorNiz switches it on with its certificate, and QR codes, receipts and shared links move to it then, not before.</p>
  </div>;
}
function Domain({ v, x }: PP) {
  const live = liveDomain(x.db.tenant.id);
  return <Stage><div className="card stack" style={{ width: 'min(400px,100%)', alignItems: 'stretch' }}>
    <span className="faint mono" style={{ fontSize: 12 }}>https://{live || String(v.menu || 'order.yourbrand.id')}</span><b style={{ fontSize: 22 }}>{x.db.tenant.name}</b>
    <span className="muted">QR menu, kiosk and online store on your own domain.</span>
  </div><Caption>{live ? `Live: QR codes and receipts link to ${live}.` : 'Not live yet: links stay on your BorNiz address until it is switched on.'}</Caption></Stage>;
}
function Embed({ v, x }: PP) {
  const tenant = x.db.tenant.id, rv = x.db.reviews, avg = rv.length ? rv.reduce((a, r) => a + r.stars, 0) / rv.length : 0;
  const order = linkTo(`/order?o=${x.outletId}`, tenant);
  const snip = `<a href="${order}" target="_blank" rel="noopener" style="display:inline-block;padding:12px 20px;border-radius:999px;background:#F26B1D;color:#fff;font:600 15px sans-serif;text-decoration:none">Order online</a>`;
  const iframe = `<iframe src="${order}&embed=1" width="100%" height="720" style="border:0" loading="lazy"></iframe>`;
  return <div className="stack" style={{ width: '100%' }}>
    <div className="card" style={{ position: 'relative', minHeight: 260 }}>
      <b>{x.db.tenant.name} website</b><p className="muted" style={{ fontSize: 13 }}>Your own site with BorNiz widgets.</p>
      <div className="row wrap" style={{ marginTop: 12 }}><span className="btn btn-primary btn-sm">Order online</span>
        {v.reviews && <span className="badge b-warning"><Icon name="star" size={14} /> {avg.toFixed(1)} · {rv.length} Google reviews</span>}</div>
      {v.ig && <div className="row" style={{ marginTop: 12, gap: 6 }}>{[0, 1, 2, 3].map(i => <span key={i} style={{ flex: 1, aspectRatio: '1', borderRadius: 8, background: mix(x.db.theme.p, WHITE, i * .2) }} />)}</div>}
      {v.wa && <span style={{ position: 'absolute', right: 16, bottom: 16, width: 52, height: 52, borderRadius: 99, background: 'var(--success)', color: 'var(--ink-0)', display: 'grid', placeItems: 'center' }}><Icon name="message-circle" /></span>}
    </div>
    <span className="cap">Widget snippet</span><Code>{snip}</Code>
    <span className="cap">Full menu (iframe)</span><Code>{iframe}</Code>
    {v.code && v.code.trim() && <><span className="cap">Custom head script</span><Code>{v.code}</Code></>}
  </div>;
}

// ── Brand kit import & theme from logo → db.theme via publish('menu') ────────────────────
function applyTheme(x: Ctx, data: Partial<Theme>, note: string) {
  const t = { ...x.db.theme, ...data } as Theme;
  const bad = themePairs(t).find(([fg, bg]) => contrast(fg, bg) < 4.5);
  if (bad) return toast(`Blocked: ${bad[2]} is ${contrast(bad[0], bad[1]).toFixed(1)}:1 (needs 4.5:1)`);
  toast(publish('menu', data, x.by, note) ? 'Theme published to guest screens' : 'Sent to owner for approval');
}
const HEX = /#[0-9a-f]{6}\b|#[0-9a-f]{3}\b/gi;
export function parseKit(text: string): { colors: string[]; fonts: string[]; map: Partial<Theme> } {
  let colors: string[] = [], fonts: string[] = []; const map: Partial<Theme> = {};
  try {
    const j = JSON.parse(text); const walk = (o: unknown, path: string) => { if (typeof o === 'string') { if (/^#[0-9a-f]{3,6}$/i.test(o)) { colors.push(o); const p = path.toLowerCase(); if (/primary|brand/.test(p) && !map.p) map.p = o; else if (/accent|secondary/.test(p) && !map.acc) map.acc = o; else if (/ink|text|foreground|dark/.test(p) && !map.ink) map.ink = o; else if (/paper|background|surface|light/.test(p) && !map.paper) map.paper = o; } else if (/font|family/i.test(path)) fonts.push(o); } else if (o && typeof o === 'object') Object.entries(o).forEach(([k, val]) => walk(val, path + '.' + k)); };
    walk(j, '');
  } catch { colors = text.match(HEX) ?? []; fonts = [...text.matchAll(/font-family:\s*['"]?([^;'",]+)/gi)].map(m => m[1]); }
  colors = [...new Set(colors.map(c => c.toLowerCase()))];
  map.p ??= colors[0]; map.acc ??= colors[1]; map.ink ??= colors.find(c => contrast(c, WHITE) > 10); map.paper ??= colors.find(c => contrast(c, '#000000') > 15);
  Object.keys(map).forEach(k => map[k as keyof Theme] === undefined && delete map[k as keyof Theme]);
  return { colors, fonts: [...new Set(fonts)], map };
}
function KitPanel({ v, set, x }: PP) {
  const kit = parseKit(v.text ?? '');
  return <div className="stack">
    <div className="field"><label>File</label><input className="input" type="file" accept=".json,.css,.txt" style={{ paddingTop: 10 }} onChange={async e => { const f = e.target.files?.[0]; if (f) set('text', await f.text()); }} /></div>
    <div className="field"><label>Or paste tokens (JSON or CSS)</label><textarea className="input mono" rows={8} value={v.text ?? ''} placeholder='{ "color": { "primary": "#1F4FD8" } }' onChange={e => set('text', e.target.value)} /></div>
    <p className="faint" style={{ fontSize: 13 }}>Works with Figma Tokens Studio JSON, Canva brand kit exports and CSS variables. Nothing changes until you apply.</p>
    <button className="btn btn-primary" disabled={!Object.keys(kit.map).length} onClick={() => applyTheme(x, kit.map, 'Brand kit import')}>{x.owner ? 'Apply to guest screens' : 'Send to owner'}</button>
  </div>;
}
function Kit({ v, x }: PP) {
  const kit = parseKit(v.text ?? ''), t = { ...x.db.theme, ...kit.map };
  if (!kit.colors.length) return <Empty icon="download" title="Nothing imported yet">Upload or paste a tokens file. Found colors and fonts show here, with a preview of your guest screens.</Empty>;
  return <Stage>
    <div className="row wrap" style={{ justifyContent: 'center' }}>{kit.colors.slice(0, 10).map(c => <div key={c} className="stack" style={{ alignItems: 'center', gap: 4 }}><span style={{ width: 48, height: 48, borderRadius: 12, background: c, boxShadow: 'var(--shadow-e1)' }} /><span className="mono faint" style={{ fontSize: 11 }}>{c}</span></div>)}</div>
    {kit.fonts.length > 0 && <Caption>Fonts found: {kit.fonts.join(', ')}. Upload the files in Custom fonts.</Caption>}
    <ThemePhone x={x} t={t} />
  </Stage>;
}
function ThemePhone({ x, t }: { x: Ctx; t: Theme }) {
  const items = menuOf(x.db, x.outletId).flatMap(g => g.items).slice(0, 3);
  return <Phone theme={t}><div style={{ padding: 18, background: 'var(--bn-ink)', color: 'var(--bn-paper)' }}><b style={{ fontFamily: 'var(--bn-font)', fontSize: 20 }}>{t.name}</b></div>
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>{items.map(i => <div key={i.p.id} className="row" style={{ padding: 10, borderRadius: 12, background: 'var(--ink-0)' }}><span className="grow">{i.p.name}</span><span style={{ padding: '4px 10px', borderRadius: 8, background: 'var(--bn-p)', color: onColor(t.p, t.ink), fontWeight: 700, fontSize: 13 }}>{Math.round(i.price / 1000)}k</span></div>)}
      <span style={{ alignSelf: 'flex-start', padding: '4px 10px', borderRadius: 99, background: 'var(--bn-acc)', color: onColor(t.acc, t.ink), fontSize: 12, fontWeight: 700 }}>+25 beans</span></div></Phone>;
}

/** Dominant colors from an image: quantize, bucket, rank by count × saturation. */
function extract(img: HTMLImageElement) {
  const c = document.createElement('canvas'), s = 64; c.width = s; c.height = s; const g = c.getContext('2d', { willReadFrequently: true })!; g.drawImage(img, 0, 0, s, s);
  const d = g.getImageData(0, 0, s, s).data, b: Record<string, { n: number; r: number; g: number; b: number }> = {};
  for (let i = 0; i < d.length; i += 4) { if (d[i + 3] < 128) continue; const k = `${d[i] >> 5},${d[i + 1] >> 5},${d[i + 2] >> 5}`; const x = (b[k] ??= { n: 0, r: 0, g: 0, b: 0 }); x.n++; x.r += d[i]; x.g += d[i + 1]; x.b += d[i + 2]; }
  return Object.values(b).map(x => { const r = x.r / x.n, gg = x.g / x.n, bb = x.b / x.n, mx = Math.max(r, gg, bb), mn = Math.min(r, gg, bb); return { hex: hexOf(r, gg, bb), score: x.n * (.25 + (mx - mn) / 255), sat: (mx - mn) / 255 }; }).sort((a, z) => z.score - a.score);
}
function darken(h: string, target: string, ratio: number) { let c = h; for (let i = 0; i < 20 && contrast(c, target) < ratio; i++) c = mix(c, '#000000', .12); return c; }
export function optionsFrom(cols: { hex: string; sat: number }[], mood: string, base: Theme): Theme[] {
  const vivid = cols.filter(c => c.sat > .25).map(c => c.hex), main = vivid[0] ?? cols[0]?.hex ?? base.p, second = vivid[1] ?? mix(main, '#ffffff', .5);
  return [0, 1, 2].map(i => {
    const p0 = [main, second, mix(main, second, .5)][i];
    const paper = mood === 'dark' ? darken(mix(p0, '#000000', .8), WHITE, 15) : mood === 'soft' ? mix(p0, WHITE, .92) : mix(p0, WHITE, .95);
    const ink = mood === 'dark' ? mix(p0, WHITE, .92) : darken(mix(p0, '#000000', .75), paper, 12);
    const p = mood === 'dark' ? p0 : darken(mood === 'soft' ? mix(p0, WHITE, .15) : p0, paper, 4.5);
    return { ...base, p, acc: [second, main, mix(second, WHITE, .3)][i], ink, paper };
  });
}
function AutoPanel({ v, set, x }: PP) {
  const opts: Theme[] = v.opts ?? [];
  const onFile = (f?: File) => { if (!f) return; const r = new FileReader(); r.onload = () => { const img = new Image(); img.onload = () => { const cols = extract(img).slice(0, 8); set('cols', cols); set('opts', optionsFrom(cols, v.mood, x.db.theme)); set('src', f.name); }; img.src = r.result as string; }; r.readAsDataURL(f); };
  return <div className="stack">
    <div className="field"><label>Logo or cover photo</label><input className="input" type="file" accept="image/*" style={{ paddingTop: 10 }} onChange={e => onFile(e.target.files?.[0])} /></div>
    <div className="field"><label>Mood</label><Seg value={v.mood} options={[['bold', 'Bold'], ['soft', 'Soft'], ['dark', 'Dark']] as const} onChange={m => { set('mood', m); if (v.cols) set('opts', optionsFrom(v.cols, m, x.db.theme)); }} /></div>
    {opts.length > 0 && <div className="field"><label>Pick option</label><Seg value={String(v.pick)} options={[['0', 'A'], ['1', 'B'], ['2', 'C']] as const} onChange={p => set('pick', Number(p))} /></div>}
    <p className="faint" style={{ fontSize: 13 }}>Every option passes the 4.5:1 contrast check before it is offered.</p>
    <button className="btn btn-primary" disabled={!opts.length} onClick={() => { const o = opts[v.pick]; applyTheme(x, { p: o.p, acc: o.acc, ink: o.ink, paper: o.paper }, 'Theme from ' + (v.src || 'logo')); }}>{x.owner ? 'Apply to guest screens' : 'Send to owner'}</button>
  </div>;
}
function Auto({ v, set, x }: PP) {
  const opts: Theme[] = v.opts ?? [], pick = v.pick ?? 0;
  if (!opts.length) return <Empty icon="wand-sparkles" title="Upload a logo or photo">We read its main colors on this device (nothing is uploaded) and build three theme options.</Empty>;
  return <Stage>
    <div className="row wrap" style={{ justifyContent: 'center' }}>{(v.cols as { hex: string }[]).slice(0, 6).map(c => <span key={c.hex} title={c.hex} style={{ width: 32, height: 32, borderRadius: 8, background: c.hex, boxShadow: 'var(--shadow-e1)' }} />)}</div>
    <div className="row wrap" style={{ justifyContent: 'center' }}>{opts.map((o, i) => <button key={i} onClick={() => set('pick', i)} aria-pressed={pick === i} className="card tight stack sm" style={{ cursor: 'pointer', boxShadow: pick === i ? '0 0 0 3px var(--role)' : undefined }}>
      <div className="row" style={{ gap: 4 }}>{[o.p, o.acc, o.ink, o.paper].map((c, j) => <span key={j} style={{ width: 28, height: 28, borderRadius: 8, background: c, boxShadow: 'var(--shadow-e1)' }} />)}</div><b>Option {'ABC'[i]}</b>
      <span className="faint" style={{ fontSize: 12 }}>{contrast(o.ink, o.paper).toFixed(1)}:1 text</span></button>)}</div>
    <ThemePhone x={x} t={opts[pick] ?? opts[0]} />
  </Stage>;
}

// ── Motion, prices, numbers, kiosk, legal ────────────────────────────────────────────────
function Anim({ v, x }: PP) {
  const [hover, setHover] = useState(false);
  const tr = { none: 'none', subtle: 'transform var(--dur-base) var(--ease-out)', playful: 'transform 420ms var(--ease-spring)' }[v.level as 'none'];
  const tf = !hover ? 'none' : { none: 'none', subtle: 'translateY(-4px)', playful: 'translateY(-8px) rotate(-2deg) scale(1.03)' }[v.level as 'none'];
  const it = menuOf(x.db, x.outletId)[0]?.items[0];
  return <Stage><div data-guest onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} onFocus={() => setHover(true)} onBlur={() => setHover(false)} tabIndex={0}
    style={{ width: 240, padding: 16, borderRadius: 20, background: x.db.theme.paper, color: x.db.theme.ink, boxShadow: 'var(--shadow-e2)', transition: tr, transform: tf, cursor: 'pointer' }}>
    <div style={{ height: 120, borderRadius: 14, background: productImage(it?.p ?? { hue: 30 }) }} /><b style={{ display: 'block', marginTop: 10 }}>{it?.p.name}</b><span>{it && Math.round(it.price / 1000)}k</span></div>
    <Caption>Hover or focus the card. {{ none: 'No entrance or hover motion; instant state changes.', subtle: 'Fade and rise 8px on enter, small lift on hover. Default.', playful: 'Spring pops, tilt on hover, confetti on order placed.' }[v.level as 'none']} {v.reduce ? 'Devices set to reduce motion get none.' : ''} Payment success always animates as a short fade.</Caption></Stage>;
}
const round = (n: number, step: number, mode: string) => step <= 1 ? n : (mode === 'up' ? Math.ceil(n / step) : mode === 'down' ? Math.floor(n / step) : Math.round(n / step)) * step;
export function fmtMoney(n: number, f: V) { const s = Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, f.sep === 'dot' ? '.' : ','); return f.short && n >= 1000 && n % 1000 === 0 ? `${n / 1000}k` : `${f.sym === 'rp' ? 'Rp' : 'IDR'}${f.sym === 'rp' ? '' : ' '}${s}`; }
function Prices({ v, x }: PP) {
  const out = x.db.outlets.find(o => o.id === x.outletId)!, rows = menuOf(x.db, x.outletId).flatMap(g => g.items).slice(0, 6);
  const shown = (n: number) => { const withTax = v.tax === 'incl' && !out.taxInclusive ? n * (1 + out.taxBps / 1e4) * (1 + out.serviceBps / 1e4) : n; return round(withTax, Number(v.step), v.mode); };
  return <Stage><Phone theme={x.db.theme}><div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
    {rows.map(r => { const fp = flashPrice(x.db.promos, r.p.id); return <div key={r.p.id} className="row" style={{ padding: 10, borderRadius: 12, background: 'var(--ink-0)' }}><span className="grow">{r.p.name}</span>
      {fp != null && v.strike && <s style={{ opacity: .55, fontSize: 12, marginRight: 6 }}>{fmtMoney(shown(r.price), v)}</s>}<b>{fmtMoney(shown(fp ?? r.price), v)}</b></div>; })}
    <span style={{ fontSize: 12, opacity: .7 }}>{v.tax === 'incl' ? 'Prices include tax & service' : `+ service ${out.serviceBps / 100}% + PB1 ${out.taxBps / 100}% at checkout`}</span>
  </div></Phone><Caption>{outletName(x.db, x.outletId)} prices from the catalog ({out.taxInclusive ? 'outlet is tax-inclusive' : 'outlet adds tax on top'}). Rounding changes display only; the bill total is computed once on the server.</Caption></Stage>;
}
function NumFmt({ v, x }: PP) {
  const out = x.db.outlets.find(o => o.id === (v.outlet || x.outletId)) ?? x.db.outlets[0];
  const t0 = new Date(); t0.setHours(0, 0, 0, 0);
  const sales = x.db.orders.filter(o => o.outletId === out.id && o.status === 'paid' && o.createdAt >= t0.getTime()).reduce((a, o) => a + o.total, 0);
  const d = new Date(), date = v.date === 'dmy' ? d.toLocaleDateString('en-GB') : v.date === 'long' ? d.toLocaleDateString(v.sep === 'dot' ? 'id-ID' : 'en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : d.toISOString().slice(0, 10);
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: v.clock === '12' }).replace(':', v.sep === 'dot' && v.clock === '24' ? '.' : ':');
  return <Stage><div className="card stack" style={{ width: 'min(420px,100%)' }}><span className="cap">{out.name} · today</span><b style={{ fontSize: 30, fontFamily: 'var(--font-display)' }}>{fmtMoney(sales, v)}</b><span>{date} · {time}{v.tz ? ' WIB' : ''}</span>
    <span className="muted" style={{ fontSize: 13 }}>Applies to receipts, the QR menu, kiosk and customer display at {out.name}. Dashboards and exports keep IDR 1,250,000.</span></div></Stage>;
}
function Kiosk({ v, x }: PP) {
  const t = x.db.theme, items = menuOf(x.db, x.outletId).flatMap(g => g.items).slice(0, 4), s = v.scale / 100;
  const bg = v.hc ? t.ink : t.paper, fg = v.hc ? onColor(t.ink, t.paper) : t.ink;
  return <Stage><div data-guest style={{ width: 'min(520px,100%)', padding: 20 * s, borderRadius: 20, background: bg, color: fg, boxShadow: 'var(--shadow-e2)', display: 'grid', gridTemplateColumns: s > 1.3 ? '1fr' : '1fr 1fr', gap: 12 }}>
    {items.map(i => <div key={i.p.id} style={{ padding: 12, borderRadius: 16, border: v.hc ? `2px solid ${fg}` : '1px solid color-mix(in srgb,currentColor 20%,transparent)', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <b style={{ fontSize: 17 * s }}>{i.p.name}</b><span style={{ fontSize: 15 * s }}>{Math.round(i.price / 1000)}k</span>
      <span style={{ height: Math.max(64, 64 * s), borderRadius: 14, background: t.p, color: onColor(t.p, t.ink), display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 16 * s }}>Add</span></div>)}
  </div><Caption>Text {v.scale}%, buttons at least {Math.max(64, Math.round(64 * s))}px. {v.lower ? 'Content moves to the lower half so it’s reachable from a wheelchair.' : ''} {v.voice ? 'Screen-reader labels on every tile.' : ''} Guests turn it on from the attract screen.</Caption></Stage>;
}
const LEGAL: Record<string, string> = { terms: 'Terms of service', privacy: 'Privacy policy', refund: 'Refund policy' };
function Legal({ v, x }: PP) {
  return <Stage><Phone theme={x.db.theme}><div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 10, overflow: 'auto' }}>
    <b style={{ fontSize: 22, fontFamily: 'var(--bn-font)' }}>{LEGAL[v.page]}</b><span style={{ fontSize: 12, opacity: .7 }}>{v.co} · updated {new Date().toLocaleDateString('en-GB')}</span>
    <p style={{ fontSize: 14, whiteSpace: 'pre-wrap' }}>{v['b_' + v.page]}</p>
    <span style={{ fontSize: 12, opacity: .7, borderTop: '1px solid color-mix(in srgb,currentColor 20%,transparent)', paddingTop: 8 }}>Payments processed by BorNiz Payments (PJP licensed by Bank Indonesia). This line is locked.</span>
  </div></Phone><Caption>Linked from the QR menu footer, kiosk, member app and every e-receipt.</Caption></Stage>;
}

// ── Saved themes & marketplace ───────────────────────────────────────────────────────────
function MarketPanel({ v, set, x }: PP) {
  const save = () => { saveRecord('theme_template', { id: 'th' + Date.now().toString(36), a: v.name || x.db.theme.name, b: JSON.stringify(x.db.theme), c: v.share ? 'shared' : 'private', d: x.by, e: '', at: Date.now() }, x.by); toast('Theme saved'); };
  return <div className="stack">
    <div className="field"><label>Save current theme as</label><input className="input" value={v.name ?? ''} placeholder={x.db.theme.name} onChange={e => set('name', e.target.value)} /></div>
    <label className="row between" style={{ minHeight: 44 }}><span>Share with other BorNiz merchants</span><input type="checkbox" checked={!!v.share} onChange={e => set('share', e.target.checked)} style={{ width: 22, height: 22, accentColor: 'var(--role)' }} /></label>
    <button className="btn btn-primary" onClick={save}>Save theme</button>
    <p className="faint" style={{ fontSize: 13 }}>Shared themes list colors and fonts only, never your logo, photos or menu.</p>
  </div>;
}
function Market({ x }: PP) {
  const saved = x.db.records.theme_template ?? [], hist = x.db.versions.filter(ver => ver.kind === 'menu').slice(0, 8);
  const Sw = ({ t }: { t: Partial<Theme> }) => <div className="row" style={{ gap: 4 }}>{[t.p, t.acc, t.ink, t.paper].map((c, i) => <span key={i} style={{ width: 24, height: 24, borderRadius: 6, background: c, boxShadow: 'var(--shadow-e1)' }} />)}</div>;
  return <div className="stack" style={{ width: '100%' }}>
    <div className="card tight row"><Sw t={x.db.theme} /><b className="grow">{x.db.theme.name} · live now</b></div>
    <span className="cap">Saved themes</span>
    {saved.length ? <div className="grid" style={{ ['--min' as string]: '220px' }}>{saved.map(r => { const t = JSON.parse(r.b) as Theme; return <div key={r.id} className="card tight stack sm"><Sw t={t} /><b>{r.a}</b><span className="faint" style={{ fontSize: 12 }}>{r.c === 'shared' ? 'Shared' : 'Private'} · {ago(r.at)}</span>
      <div className="row"><button className="btn btn-sm" onClick={() => applyTheme(x, { p: t.p, acc: t.acc, ink: t.ink, paper: t.paper, font: t.font }, 'Saved theme ' + r.a)}>{x.owner ? 'Apply' : 'Send to owner'}</button><button className="btn btn-ghost btn-sm" onClick={() => deleteRecord('theme_template', r.id, x.by)}>Delete</button></div></div>; })}</div>
      : <Empty icon="palette" title="No saved themes">Save the live theme to keep it, share it or switch back later.</Empty>}
    <span className="cap">Published theme versions</span>
    {hist.length ? hist.map(h => <div key={h.id} className="row" style={{ fontSize: 13 }}><Sw t={h.data as Partial<Theme>} /><span className="grow">{h.note || 'Theme update'} · {ago(h.at)}</span><Badge tone={h.status === 'published' ? 'success' : 'warning'}>{h.status === 'published' ? 'Published' : 'Waiting'}</Badge>
      <button className="btn btn-ghost btn-sm" onClick={() => applyTheme(x, h.data as Partial<Theme>, 'Rollback')}>Roll back</button></div>) : <p className="faint" style={{ fontSize: 13 }}>No theme versions yet.</p>}
  </div>;
}

export const PLATFORM: Tool[] = [
  { id: 'fonts', group: 'PLATFORM', name: 'Custom fonts', icon: 'type', plan: 'pro', desc: 'Upload your own font files or pick from the library. Used on every customer-facing surface.', def: { ...TOOL_DEFAULTS.fonts }, Preview: Fonts,
    fields: () => [F.seg('Headings', 'head', [['space', 'Space Grotesk'], ['body', 'Instrument'], ['upload', 'Uploaded']]), F.seg('Body', 'body', [['body', 'Instrument'], ['space', 'Space Grotesk']]), F.range('Size scale', 'scale', 85, 120, 5, '%'), F.node(set => <FontUpload set={set} />), F.note('WOFF2, WOFF, TTF or OTF up to 2 MB. Make sure your license allows web use.', 'warn')] },
  { id: 'icons', group: 'PLATFORM', name: 'Icon style', icon: 'shapes', plan: 'free', desc: 'One icon style across the menu, kiosk and member app.', def: { ...TOOL_DEFAULTS.icons }, Preview: Icons,
    pairs: (v, x) => { const c = themeColor(x.db.theme, v.color); return v.style === 'filled' ? [[onColor(c, x.db.theme.ink), c, 'Icon on fill']] : [[c, x.db.theme.paper, 'Icon on background']]; },
    fields: (_, x) => [F.seg('Style', 'style', [['outline', 'Outline'], ['filled', 'Filled'], ['duo', 'Duotone']]), F.range('Stroke', 'stroke', 1, 3, .5, 'px'), F.seg('Container', 'shape', [['none', 'None'], ['rounded', 'Rounded'], ['circle', 'Circle']]), F.swatch('Color', 'color', themeSwatches(x.db.theme))] },
  { id: 'appicon', group: 'PLATFORM', name: 'Favicon, app icon & share image', icon: 'app-window', plan: 'free', desc: 'What customers see in browser tabs, on their home screen and when a link is shared.', def: { ...TOOL_DEFAULTS.appicon }, Preview: AppIcon, Panel: AppIconPanel,
    pairs: (v, x) => { const c = themeColor(x.db.theme, v.bg); return [[onColor(c, x.db.theme.ink), c, 'Initials on icon']]; } },
  { id: 'sounds', group: 'PLATFORM', name: 'Custom sounds', icon: 'volume-2', plan: 'pro', desc: 'Order chime, payment sounds and scan beep for POS, kitchen and customer display.', def: { ...TOOL_DEFAULTS.sounds }, Preview: Sounds,
    fields: v => [...Object.keys(SFX).map(k => F.seg(SFX_LABEL[k], k, Object.keys(SFX[k]).map(o => [o, o[0].toUpperCase() + o.slice(1)] as [string, string]))), F.range('Volume', 'vol', 0, 100, 5, '%'), F.toggle('Kitchen display chime', 'kds'), F.toggle('Customer display sounds', 'disp'), F.node(<button className="btn btn-block" onClick={() => Object.keys(SFX).forEach((k, i) => setTimeout(() => tone(SFX[k][v[k]] ?? [], v.vol), i * 600))}><Icon name="play" size={18} />Play all</button>)] },
  { id: 'lang', group: 'PLATFORM', name: 'Languages & translations', icon: 'languages', plan: 'free', desc: 'Add languages and translate any menu item. Customers switch language on the menu.', def: { ...TOOL_DEFAULTS.lang }, Preview: Lang, Panel: LangPanel },
  { id: 'white', group: 'PLATFORM', name: 'White-label app', icon: 'smartphone', plan: 'enterprise', desc: 'Your own member app on the App Store and Google Play, built on BorNiz.', def: { name: 'Kopi Biru', sub: 'Order ahead & earn beans', bundle: 'id.kopibiru.app', color: 'primary' }, Preview: White,
    fields: (_, x) => [F.text('App name', 'name'), F.text('Subtitle', 'sub'), F.text('Bundle ID', 'bundle'), F.swatch('Brand color', 'color', themeSwatches(x.db.theme)), F.note('You need Apple Developer and Google Play accounts in your company name.', 'warn')] },
  { id: 'domain', group: 'PLATFORM', name: 'Custom domain', icon: 'globe', plan: 'enterprise', desc: 'Serve the QR menu, kiosk and online store from your own domain.', def: { menu: '' }, Preview: Domain, Panel: DomainPanel },
  { id: 'embed', group: 'PLATFORM', name: 'Embeds & widgets', icon: 'code', plan: 'pro', desc: 'Put ordering, reviews and chat on your own website, and add third-party widgets to your menu pages.', def: { wa: true, reviews: true, ig: false, code: '' }, Preview: Embed,
    fields: () => [F.toggle('WhatsApp chat button', 'wa'), F.toggle('Google Reviews widget', 'reviews'), F.toggle('Instagram feed', 'ig'), F.area('Custom HTML / script (head)', 'code'), F.note('Custom scripts run on menu pages only, never on checkout or payment pages.', 'warn')] },
  { id: 'kit', group: 'PLATFORM', name: 'Import brand kit', icon: 'download', plan: 'free', desc: 'Pull colors and fonts from a tokens file you already have (Figma, Canva, JSON or CSS).', Preview: Kit, Panel: KitPanel },
  { id: 'auto', group: 'PLATFORM', name: 'Auto theme from logo', icon: 'wand-sparkles', plan: 'free', desc: 'Upload a logo or photo and get three theme options built from its colors.', Preview: Auto, Panel: p => <AutoPanel {...p} v={{ mood: 'bold', pick: 0, ...p.v }} /> },
  { id: 'anim', group: 'PLATFORM', name: 'Animation style', icon: 'sparkles', plan: 'free', desc: 'How much movement customers see on the menu and kiosk.', def: { ...TOOL_DEFAULTS.anim }, Preview: Anim,
    fields: () => [F.seg('Level', 'level', [['none', 'None'], ['subtle', 'Subtle'], ['playful', 'Playful']]), F.toggle('Respect device reduced-motion setting', 'reduce')] },
  { id: 'prices', group: 'PLATFORM', name: 'Price display rules', icon: 'badge-dollar-sign', plan: 'free', desc: 'Rounding, strike-through for sale prices and whether menu prices include tax.', def: { step: 1, mode: 'nearest', strike: true, tax: 'excl', sym: 'idr', sep: 'comma', short: false }, Preview: Prices,
    fields: () => [F.seg('Round to', 'step', [[1, 'None'], [100, '100'], [500, '500'], [1000, '1,000']]), F.seg('Direction', 'mode', [['nearest', 'Nearest'], ['up', 'Up'], ['down', 'Down']]), F.toggle('Strike-through original on sale items', 'strike'), F.seg('Menu prices', 'tax', [['excl', 'Before tax'], ['incl', 'Tax-inclusive']]), F.seg('Currency', 'sym', [['idr', 'IDR'], ['rp', 'Rp']]), F.toggle('Short form (25k)', 'short')] },
  { id: 'numfmt', group: 'PLATFORM', name: 'Number & currency format per outlet', icon: 'hash', plan: 'free', desc: 'How money, dates and times read for guests at each outlet.', def: { outlet: '', sep: 'comma', sym: 'idr', short: false, date: 'long', clock: '24', tz: true }, Preview: NumFmt,
    fields: (_, x) => [F.seg('Outlet', 'outlet', [['', 'Current'], ...x.db.outlets.map(o => [o.id, o.name] as [string, string])]), F.seg('Thousands', 'sep', [['comma', '1,250,000'], ['dot', '1.250.000']]), F.seg('Currency', 'sym', [['idr', 'IDR'], ['rp', 'Rp']]), F.seg('Date', 'date', [['long', 'Fri, 10 Oct'], ['dmy', '10/10/2026'], ['iso', '2026-10-10']]), F.seg('Clock', 'clock', [['24', '24 h'], ['12', '12 h']]), F.toggle('Show time zone (WIB)', 'tz')] },
  { id: 'a11y', group: 'PLATFORM', name: 'Large-text & accessible kiosk', icon: 'accessibility', plan: 'free', desc: 'A kiosk mode with bigger text and buttons, high contrast and a lower reach zone.', def: { scale: 130, hc: false, lower: true, voice: true }, Preview: Kiosk,
    pairs: (v, x) => v.hc ? [[onColor(x.db.theme.ink, x.db.theme.paper), x.db.theme.ink, 'High-contrast text']] : [[x.db.theme.ink, x.db.theme.paper, 'Kiosk text']],
    fields: () => [F.range('Text size', 'scale', 100, 160, 10, '%'), F.toggle('High contrast', 'hc'), F.toggle('Lower reach zone', 'lower'), F.toggle('Screen-reader labels', 'voice')] },
  { id: 'legal', group: 'PLATFORM', name: 'Legal pages per merchant', icon: 'scale', plan: 'free', desc: 'Your terms, privacy and refund policy, linked from every guest screen and receipt.', def: { page: 'terms', co: 'PT Kopi Biru Nusantara', b_terms: 'Dengan memesan, kamu setuju dengan syarat layanan ini.', b_privacy: 'Kami menyimpan nama, nomor WhatsApp dan riwayat pesanan untuk struk, poin dan promo (jika kamu setuju).', b_refund: 'Pesanan yang salah atau kurang kami ganti atau refund ke metode bayar awal dalam 1×24 jam.' }, Preview: Legal,
    fields: v => [F.seg('Page', 'page', Object.entries(LEGAL) as [string, string][]), F.text('Company', 'co'), F.area('Text', 'b_' + v.page), F.note('Payment provider and tax lines are locked and always shown.')] },
  { id: 'market', group: 'PLATFORM', name: 'Theme save, share & marketplace', icon: 'palette', plan: 'pro', desc: 'Keep themes you like, share them, and roll back to any published theme.', Preview: Market, Panel: MarketPanel },
];
