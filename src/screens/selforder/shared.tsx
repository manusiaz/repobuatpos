'use client';
import { guestLang } from '../../system/settings.ts';
import { guestLanguages, itemName } from '../../system/tools.ts';
import { productImage } from '../../ui/kit.tsx';
// Self-order plumbing: table from the URL, the table's open bill (a real store order, source 'qr'), the remembered
// member, language, and the small building blocks every QR-menu and customer-link view shares.
import { useEffect, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';
import { routeQuery } from '../../system/hosts.ts';
import { useApp } from '../../app/context.tsx';
import { pagesOf } from '../../system/registry.ts';
import { Icon, useNow } from '../../ui/kit.tsx';
import { idr } from '../../domain/money.ts';
import { earn, tierOf } from '../../domain/loyalty.ts';
import { newOrder } from '../../data/actions.ts';
import type { DB, Order } from '../../data/schema.ts';
import { groupsOf, hours, LINE, MUTED, SURFACE, unit, unpaid, useLang, useLocal, type MenuItem } from '../guest/kit.tsx';

const PATHS: Record<string, string> = Object.fromEntries(pagesOf('selforder').map(p => [p.slug, p.path]));
export const so = (slug: string, q?: Record<string, string>) => (PATHS[slug] ?? PATHS.order ?? '/') + (q ? '?' + new URLSearchParams(q) : '');
const TWO_H = 2 * 3600e3;

export function useGuest() {
  const { db, outletId: deviceOutlet, go } = useApp();
  const sp = useSearchParams();
  // The table QR names its branch (?o=kem); a guest's phone has no device outlet, so the scanned branch is remembered with the table.
  const [savedOutlet, setSavedOutlet] = useLocal<string | null>('bn-qr-outlet', null);
  const qo = sp.get('o') ?? routeQuery().o ?? null;
  const outletId = [qo, savedOutlet].find(x => x && db.outlets.some(o => o.id === x)) ?? deviceOutlet;
  useEffect(() => { if (qo && qo === outletId && qo !== savedOutlet) setSavedOutlet(qo); }, [qo, outletId, savedOutlet, setSavedOutlet]);
  const [saved, setSaved] = useLocal('bn-qr-table', 'T-07');
  const [ref, setRef] = useLocal<string | null>('bn-ref', null); // invite link ?ref=<member id>, kept until they join
  const qref = sp.get('ref');
  useEffect(() => { if (qref && qref !== ref) setRef(qref); }, [qref, ref, setRef]);
  const qt = sp.get('t') ?? routeQuery().t ?? null; // order.bornis.id/<tenant>/t/07 carries the table in the path
  const table = qt ? 'T-' + qt.replace(/^T-?/i, '').padStart(2, '0') : saved;
  useEffect(() => { if (qt && table !== saved) setSaved(table); }, [qt, table, saved, setSaved]);
  const L = useLang(guestLanguages(db, guestLang(db)).first);
  const [meId, setMe] = useLocal<string | null>('bn-guest-customer', null);
  const me = db.customers.find(c => c.id === meId) ?? null;
  const out = db.outlets.find(o => o.id === outletId)!;
  const now = useNow(15000);
  const hrs = hours(out, now);
  const recent = db.orders.filter(o => o.outletId === outletId && o.source === 'qr' && o.table === table && o.status !== 'voided' && Date.now() - o.createdAt < TWO_H).sort((a, b) => b.createdAt - a.createdAt);
  const cart = recent.find(unpaid) ?? null;               // the table's open bill
  const latest = recent.find(o => o.lines.some(l => l.fired)) ?? null; // the order the kitchen knows about
  const ensureCart = () => cart?.id ?? newOrder(outletId, 'guest', 'qr', { table, type: 'dine', customerId: meId });
  return { db, outletId, go, sp, ref, table, L, t: L.t, me, setMe, out, hrs, canOrder: hrs.open && !hrs.paused, online: db.device.online, recent, cart, latest, ensureCart, now };
}
export type G = ReturnType<typeof useGuest>;

export const back = (go: (p: string) => void, fallback: string) => { if (typeof window !== 'undefined' && window.history.length > 1) window.history.back(); else go(fallback); };
export const tableNo = (t: string) => t.replace(/^T-?/, '');
export const newLines = (o: Order | null) => o ? o.lines.filter(l => !l.fired) : [];
export const settledOf = (db: DB, o: Order) => db.payments.filter(p => p.orderId === o.id && p.status === 'settled').reduce((a, p) => a + p.amount, 0);
export const itemDesc = (db: DB, i: MenuItem) => i.p.desc || (groupsOf(db, i.p).length ? 'Choose ' + groupsOf(db, i.p).map(g => g.name.toLowerCase()).join(', ') : db.categories.find(c => c.id === i.cat)?.name ?? '');

/** Screen header for inner pages: back, title, optional right slot. */
export function Bar({ title, onBack, right }: { title: ReactNode; onBack?: () => void; right?: ReactNode }) {
  return <div className="glass" style={{ position: 'sticky', top: 0, zIndex: 6, display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', ['--glass-bg' as string]: 'color-mix(in srgb,var(--bn-paper) 92%,transparent)', borderBottom: `1px solid ${LINE}` }}>
    {onBack && <button className="btn btn-ghost icon-btn" onClick={onBack} aria-label="Back"><Icon name="arrow-left" /></button>}
    <h1 style={{ flex: 1, fontSize: 20, fontWeight: 800, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</h1>{right}
  </div>;
}

export function ItemRow({ i, onOpen, badge, t, count = 0, lang = 'en' }: { i: MenuItem; onOpen: () => void; badge?: string; t: (s: string) => string; count?: number; lang?: string }) {
  const { db } = useApp(), name = itemName(db, i.p, lang);
  return <button type="button" onClick={onOpen} disabled={i.sold} aria-label={`${name}, ${i.sold ? t('Sold out') : idr(unit(i))}`}
    style={{ border: 0, padding: 10, borderRadius: 18, background: SURFACE, display: 'flex', gap: 12, alignItems: 'center', textAlign: 'left', cursor: i.sold ? 'not-allowed' : 'pointer', opacity: i.sold ? .55 : 1, color: 'var(--bn-ink)', width: '100%' }}>
    <span style={{ width: 84, height: 84, flex: 'none', borderRadius: 14, background: i.sold ? 'var(--bg-sunken)' : productImage(i.p), position: 'relative' }}>
      {(badge || i.flash != null) && !i.sold && <span style={{ position: 'absolute', top: 6, left: 6, height: 20, padding: '0 7px', borderRadius: 99, background: 'var(--bn-acc)', fontSize: 10, fontWeight: 800, lineHeight: '20px' }}>{i.flash != null ? t('Flash sale') : badge}</span>}
    </span>
    <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
      <b style={{ fontSize: 15 }}>{name}{i.badges.map(([k, l, ic]) => <Icon key={k} name={ic} size={14} aria-label={l} className="bn-ico" style={{ marginLeft: 4, verticalAlign: '-2px', color: 'var(--bn-icon, var(--bn-p))' }} />)}</b>
      <span style={{ fontSize: 13, color: MUTED, lineHeight: 1.35 }}>{itemDesc(db, i)}</span>
      {i.sold ? <b style={{ fontSize: 14, color: MUTED }}>{t('Sold out')}</b> : <span><b style={{ fontSize: 14 }}>{idr(unit(i))}</b>{i.flash != null && <s style={{ fontSize: 12, color: MUTED, marginLeft: 6 }}>{idr(i.price).replace('IDR ', '')}</s>}</span>}
    </span>
    <span aria-hidden style={{ width: 44, height: 44, flex: 'none', borderRadius: 14, background: i.sold ? 'var(--bg-sunken)' : count ? 'var(--bn-acc)' : 'var(--bn-p)', color: count ? 'var(--bn-ink)' : 'var(--ink-0)', display: 'grid', placeItems: 'center', fontWeight: 800 }}>
      {count || <Icon name={i.sold ? 'ban' : 'plus'} size={20} />}</span>
  </button>;
}

/** Sticky cart bar (56–60px CTA above the safe area). */
export function CartBar({ g, label, onClick }: { g: G; label?: string; onClick?: () => void }) {
  const n = newLines(g.cart).reduce((a, l) => a + l.qty, 0);
  if (!n || !g.cart) return null;
  return <button onClick={onClick ?? (() => g.go(so('cart')))} style={{ position: 'fixed', left: '50%', transform: 'translateX(-50%)', width: 'min(492px, calc(100vw - 28px))', bottom: 'calc(18px + env(safe-area-inset-bottom))', zIndex: 20, height: 60, border: 0, borderRadius: 18,
    background: 'var(--bn-p)', color: 'var(--ink-0)', display: 'flex', alignItems: 'center', padding: '0 18px', gap: 10, cursor: 'pointer', boxShadow: '0 14px 28px -10px color-mix(in srgb,var(--bn-p) 60%,transparent)' }}>
    <span style={{ width: 30, height: 30, borderRadius: 99, background: 'var(--ink-0)', color: 'var(--bn-p)', display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 13 }}>{n}</span>
    <b style={{ fontSize: 15 }}>{label ?? g.t('View cart')}</b><b style={{ marginLeft: 'auto', fontSize: 16 }}>{idr(g.cart.total)}</b>
  </button>;
}

export function Totals({ db, o, tip = 0, me }: { db: DB; o: Order; tip?: number; me?: { id: string } | null }) {
  const out = db.outlets.find(x => x.id === o.outletId)!;
  const Row = ({ l, v, b }: { l: ReactNode; v: ReactNode; b?: boolean }) => <div className="row between" style={{ fontSize: b ? 17 : 14, fontWeight: b ? 800 : 400, color: b ? 'var(--bn-ink)' : MUTED, fontFamily: b ? 'var(--bn-font)' : undefined }}><span>{l}</span><span>{v}</span></div>;
  const pts = earn(o.subtotal - o.discount, me ? tierOf(db.ledger, me.id) : undefined);
  return <div className="stack sm" style={{ padding: 16, borderRadius: 18, background: SURFACE }}>
    <Row l="Subtotal" v={idr(o.subtotal)} />
    {o.discount > 0 && <Row l="Discount" v={'−' + idr(o.discount)} />}
    {out.serviceBps > 0 && <Row l={`Service ${out.serviceBps / 100}%`} v={idr(o.service)} />}
    <Row l={`PB1 ${out.taxBps / 100}%${out.taxInclusive ? ' (included)' : ''}`} v={idr(o.tax)} />
    {tip > 0 && <Row l="Tip for the team" v={idr(tip)} />}
    {me && pts > 0 && <Row l="You’ll earn" v={<span style={{ color: 'var(--bn-ink)', fontWeight: 700 }}>+{pts} beans</span>} />}
    <div style={{ borderTop: `1px solid ${LINE}`, margin: '4px 0' }} />
    <Row l="Total" v={idr(o.total + tip)} b />
  </div>;
}

/** Closed / paused / offline notices shown above the menu. */
export function Notices({ g }: { g: G }) {
  const n: [string, string, ReactNode][] = [];
  if (g.hrs.paused) n.push(['pause-circle', 'Ordering is paused right now', 'Ask the staff, or browse the menu.']);
  else if (!g.hrs.open) n.push(['moon', `Closed · ${g.hrs.text}`, <a key="b" href={so('online-booking')} onClick={e => { e.preventDefault(); g.go(so('online-booking')); }}>Book a table</a>]);
  if (!g.online) n.push(['wifi-off', 'You’re offline', 'Your cart is kept. QRIS needs internet.']);
  return <>{n.map(([ic, h, s]) => <div key={h} role="status" className="banner" style={{ margin: '12px 14px 0', background: 'var(--warning-soft)', color: 'var(--warning-fg)' }}>
    <Icon name={ic} /><div className="stack" style={{ gap: 2 }}><b>{h}</b><span>{s}</span></div></div>)}</>;
}

export const Pill = ({ children }: { children: ReactNode }) =>
  <span style={{ height: 32, padding: '0 12px', borderRadius: 99, background: 'color-mix(in srgb,var(--ink-0) 18%,transparent)', fontSize: 12, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--ink-0)' }}>{children}</span>;
