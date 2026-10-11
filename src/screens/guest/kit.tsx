'use client';
import { QR as QRCode } from '../../ui/qr.tsx';
// Shared pieces for guest screens (customer display, QR menu, kiosk, customer links). Guest screens wear the
// merchant brand from Menu Studio (db.theme → --bn-*), never BorNiz colors (Design Notes cd/so: "Read --bn-* variables").
import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import type { DB, ModifierGroup, Order, Outlet, Product, Theme } from '../../data/schema.ts';
import { priceAt, sellable } from '../../data/actions.ts';
import { flashPrice } from '../../domain/promo.ts';
import { Icon } from '../../ui/kit.tsx';

// ── Brand ───────────────────────────────────────────────────────────────────────────────
const FONTS: Record<string, string> = { space: "'Space Grotesk',sans-serif", bricolage: "'Space Grotesk',sans-serif", serif: "Georgia,'Times New Roman',serif", system: "'Instrument Sans',sans-serif" };
const BANNERS: Record<string, string> = {
  g1: 'linear-gradient(135deg,color-mix(in srgb,var(--bn-p) 55%,var(--bn-ink)),var(--bn-ink))',
  g2: 'linear-gradient(160deg,var(--bn-p),color-mix(in srgb,var(--bn-p) 35%,var(--bn-ink)))',
  g3: 'linear-gradient(135deg,color-mix(in srgb,var(--bn-acc) 70%,var(--bn-p)),var(--bn-p))',
  g4: 'linear-gradient(135deg,var(--bn-ink),color-mix(in srgb,var(--bn-p) 70%,var(--bn-ink)))',
};
export const MUTED = 'color-mix(in srgb,var(--bn-ink) 64%,transparent)';
export const LINE = 'color-mix(in srgb,var(--bn-ink) 13%,transparent)';
export const TINT = 'color-mix(in srgb,var(--bn-p) 12%,var(--ink-0))';
export const SURFACE = 'var(--ink-0)';

/** Merchant theme → CSS variables. Kit classes (btn-primary, input, chip, sheet) pick them up through the remapped tokens. */
export function brandVars(t: Theme): CSSProperties {
  return {
    '--bn-p': t.p, '--bn-acc': t.acc, '--bn-ink': t.ink, '--bn-paper': t.paper, '--bn-font': FONTS[t.font] ?? FONTS.space,
    '--bn-banner': t.img ? `url(${t.img}) center/cover no-repeat` : BANNERS[t.banner] ?? BANNERS.g1,
    '--font-display': 'var(--bn-font)', '--role': 'var(--bn-p)', '--accent': 'var(--bn-p)', '--accent-fg': 'var(--bn-p)', '--accent-soft': TINT,
    '--focus-ring': 'color-mix(in srgb,var(--bn-p) 30%,transparent)', '--bg-canvas': 'var(--bn-paper)', '--bg-surface': SURFACE, '--bg-raised': SURFACE,
    '--bg-sunken': 'color-mix(in srgb,var(--bn-ink) 6%,var(--bn-paper))', '--fg-1': 'var(--bn-ink)', '--fg-2': MUTED, '--fg-3': 'color-mix(in srgb,var(--bn-ink) 48%,transparent)', '--border': LINE,
    color: 'var(--bn-ink)', fontFamily: 'var(--font-body)',
  } as CSSProperties;
}
/** Product photo placeholder until Menu Studio images exist: a soft gradient on the product hue. */
export const initials = (name: string) => name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
export const firstName = (n?: string | null) => (n ?? '').split(' ')[0];
export const mmss = (ms: number) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
export const maskPhone = (p: string) => { const d = p.replace(/\D/g, ''); return d.length < 8 ? p : `${d.slice(0, 4)} •••• ${d.slice(-4)}`; };

// ── Per-viewer conveniences (language, remembered member). Store data never lives here. ──
export function useLocal<T>(key: string, init: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(init);
  useEffect(() => { try { const s = localStorage.getItem(key); if (s != null) setV(JSON.parse(s)); } catch { /* blocked storage: keep default */ } }, [key]);
  const set = useCallback((x: T) => { setV(x); try { localStorage.setItem(key, JSON.stringify(x)); } catch { /* ignore */ } }, [key]);
  return [v, set];
}
export type Lang = 'en' | 'id';
const ID: Record<string, string> = {
  'Search the menu': 'Cari menu', 'View cart': 'Lihat keranjang', All: 'Semua', Coffee: 'Kopi', 'Non-coffee': 'Non-kopi', Pastry: 'Pastry', Rice: 'Nasi', Others: 'Lainnya',
  'Sold out': 'Habis', Add: 'Tambah', 'Your order': 'Pesananmu', Checkout: 'Lanjut bayar', 'Start order': 'Mulai pesan', 'Open until': 'Buka sampai', Rewards: 'Hadiah',
  Bestsellers: 'Terlaris', 'Flash sale': 'Flash sale', 'See all': 'Lihat semua', Required: 'Wajib', Optional: 'Opsional', 'Call waiter': 'Panggil pelayan', 'Order more': 'Pesan lagi',
  Subtotal: 'Subtotal', Total: 'Total', Service: 'Layanan', 'Dine-in': 'Makan di sini', Takeaway: 'Bawa pulang', Menu: 'Menu', 'Track my order': 'Lacak pesanan',
  'Choose language': 'Pilih bahasa', 'Order status': 'Status pesanan', 'Need something?': 'Butuh sesuatu?', 'Ask for the bill': 'Minta tagihan', 'More water': 'Tambah air',
  Cutlery: 'Alat makan', 'Extra ice': 'Tambah es', Tissues: 'Tisu', 'Your cart is empty': 'Keranjangmu kosong', 'See the menu': 'Lihat menu', 'Pay with': 'Bayar dengan',
  'Pay at the cashier': 'Bayar di kasir', 'Send order to kitchen': 'Kirim pesanan ke dapur', 'Tip for the team': 'Tip untuk tim', None: 'Tidak', 'Name for the order': 'Nama pemesan',
  'Order received': 'Pesanan diterima', 'Being prepared': 'Sedang disiapkan', 'Almost ready': 'Hampir siap', 'Ready!': 'Siap!', Received: 'Diterima', Preparing: 'Disiapkan', Almost: 'Hampir', Ready: 'Siap',
  'People also add': 'Sering ditambah', 'Already ordered': 'Sudah dipesan', 'Tap to start': 'Sentuh untuk mulai', 'Where will you eat?': 'Makan di mana?', 'Eat here': 'Makan di sini', 'Take away': 'Bawa pulang',
  'Waiting for payment': 'Menunggu pembayaran', Back: 'Kembali', 'Join rewards': 'Gabung member', Closed: 'Tutup', 'Popular right now': 'Populer sekarang', 'No results': 'Tidak ditemukan',
};
export function useLang() {
  const [lang, setLang] = useLocal<Lang>('bn-lang', 'en');
  const t = useCallback((s: string) => (lang === 'id' ? ID[s] ?? s : s), [lang]);
  return { lang, setLang, t };
}

// ── Menu (same rules as POS: outlet scope, hidden, 86, local price, flash price) ────────
export interface MenuItem { p: Product; price: number; flash: number | null; sold: boolean; cat: string }
export function menuOf(db: DB, outletId: string): MenuItem[] {
  const ok = sellable(db, outletId);
  return db.products.filter(p => p.status === 'live').flatMap(p => {
    const op = db.outletProducts.find(x => x.productId === p.id && x.outletId === outletId);
    if (!op || op.hidden) return [];
    return [{ p, price: priceAt(db, p, outletId), flash: flashPrice(db.promos, p.id), sold: !ok(p.id), cat: p.categoryId }];
  });
}
export function useMenu(db: DB, outletId: string) {
  const items = useMemo(() => menuOf(db, outletId), [db, outletId]);
  // Bestsellers: most sold over the last 14 days at this outlet (paid history).
  const best = useMemo(() => {
    const n: Record<string, number> = {};
    for (const o of db.orders) if (o.outletId === outletId && o.status === 'paid') for (const l of o.lines) n[l.productId] = (n[l.productId] ?? 0) + l.qty;
    return Object.entries(n).sort((a, b) => b[1] - a[1]).map(([id]) => id);
  }, [db.orders, outletId]);
  return { items, best, cats: db.categories.filter(c => items.some(i => i.cat === c.id)) };
}
export const groupsOf = (db: DB, p: Product) => p.modifierGroupIds.map(id => db.modifierGroups.find(g => g.id === id)).filter((g): g is ModifierGroup => !!g);
export const unit = (i: MenuItem) => i.flash ?? i.price;
export const modsText = (mods: { name: string }[], note?: string) => [...mods.map(m => m.name), note].filter(Boolean).join(' · ');

// ── Options (required groups block Add) ────────────────────────────────────────────────
export type Sel = Record<string, string[]>;
export const missingGroup = (groups: ModifierGroup[], sel: Sel) => groups.find(g => g.required && !(sel[g.id]?.length));
export const modsFrom = (groups: ModifierGroup[], sel: Sel) => groups.flatMap(g => (sel[g.id] ?? []).map(id => g.options.find(o => o.id === id)!).filter(Boolean).map(o => ({ name: o.name, price: o.price })));
export function OptionPicker({ groups, sel, onChange, t, h = 48, font = 15 }: { groups: ModifierGroup[]; sel: Sel; onChange: (s: Sel) => void; t: (s: string) => string; h?: number | string; font?: number | string }) {
  const pick = (g: ModifierGroup, id: string) => {
    const cur = sel[g.id] ?? [];
    const next = g.max === 1 ? [id] : cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id].slice(-g.max);
    onChange({ ...sel, [g.id]: g.max === 1 && !g.required && cur[0] === id ? [] : next });
  };
  return <div className="stack" style={{ gap: 18 }}>{groups.map(g => {
    const ok = !!sel[g.id]?.length;
    return <div key={g.id} className="stack sm" role="group" aria-label={g.name}>
      <div className="row between"><b style={{ fontSize: font }}>{g.name}</b>
        <span style={{ fontSize: 12, fontWeight: 700, padding: '3px 9px', borderRadius: 99, background: g.required && !ok ? 'var(--bn-acc)' : 'var(--bg-sunken)', color: 'var(--bn-ink)' }}>
          {g.required ? (ok ? <><Icon name="check" size={12} /> {t('Required')}</> : t('Required')) : g.max > 1 ? `Up to ${g.max}` : t('Optional')}</span></div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(min(100%,120px),1fr))', gap: 8 }}>{g.options.map(o => {
        const on = !!sel[g.id]?.includes(o.id);
        return <button key={o.id} type="button" aria-pressed={on} onClick={() => pick(g, o.id)} style={{ minHeight: h, padding: '6px 12px', borderRadius: 14, cursor: 'pointer', textAlign: 'left',
          border: `2px solid ${on ? 'var(--bn-p)' : LINE}`, background: on ? TINT : SURFACE, color: 'var(--bn-ink)', fontWeight: 600, fontSize: font, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          {o.name}{o.price > 0 && <span style={{ fontSize: '.8em', color: MUTED }}>+{Math.round(o.price / 1000)}k</span>}</button>;
      })}</div>
    </div>;
  })}</div>;
}

// ── Order progress from the KDS line states ─────────────────────────────────────────────
/** -1 not sent · 0 received · 1 preparing · 2 almost (some lines done) · 3 ready / served */
export function progress(o: Order): -1 | 0 | 1 | 2 | 3 {
  const fired = o.lines.filter(l => l.fired);
  if (!fired.length) return -1;
  if (o.status === 'served' || o.status === 'ready' || fired.every(l => l.kds === 'done')) return 3;
  if (fired.some(l => l.kds === 'done')) return 2;
  return fired.some(l => l.kds === 'cooking') ? 1 : 0;
}
export const unpaid = (o: Order) => !['paid', 'voided', 'refunded', 'part_refunded'].includes(o.status) && !o.paidAt;

// ── Opening hours ───────────────────────────────────────────────────────────────────────
const mins = (hm: string) => { const [h, m] = hm.split(':').map(Number); return h * 60 + m; };
export function hours(out: Outlet, now = Date.now()) {
  const d = new Date(now), m = d.getHours() * 60 + d.getMinutes();
  const open = m >= mins(out.opens) && m < mins(out.closes);
  return { open, paused: !out.online, text: open ? `Open until ${out.closes}` : m < mins(out.opens) ? `Opens today at ${out.opens}` : `Opens tomorrow at ${out.opens}` };
}

// ── QR: the one encoder (src/ui/qr.tsx). Payment screens encode the gateway reference; production encodes the gateway's QRIS payload.
export function QR({ value, label }: { value: string; label?: string }) {
  return <div style={{ width: '100%', height: '100%', background: 'var(--ink-0)', color: 'var(--ink-950)' }}><QRCode value={value} size="100%" label={label} /></div>;
}

export const Wordmark = ({ name, size = 40, radius = 12 }: { name: string; size?: number | string; radius?: number | string }) =>
  <span aria-hidden style={{ width: size, height: size, borderRadius: radius, background: 'var(--ink-0)', color: 'var(--bn-p)', display: 'grid', placeItems: 'center', fontFamily: 'var(--bn-font)', fontWeight: 800, fontSize: `calc(${typeof size === 'number' ? size + 'px' : size} * .36)`, flex: 'none' }}>{initials(name)}</span>;

/** Merchant-branded section heading. */
export const H = ({ children, sub }: { children: ReactNode; sub?: ReactNode }) =>
  <div className="stack" style={{ gap: 2 }}><h2 style={{ fontSize: 22, fontWeight: 800 }}>{children}</h2>{sub && <span style={{ fontSize: 14, color: MUTED }}>{sub}</span>}</div>;
