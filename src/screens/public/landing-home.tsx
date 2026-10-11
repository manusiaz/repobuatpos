'use client';
import { productImage } from '../../ui/kit.tsx';
// Home, features, solutions, hardware, integrations and case studies (spec/BorNiz Landing, layout A: hero + product mock).
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useApp } from '../../app/context.tsx';
import { priceAt } from '../../data/actions.ts';
import { orderTotals } from '../../domain/order.ts';
import { idr, idrShort } from '../../domain/money.ts';
import { Badge, Icon, Kpi, Status, Seg, toast } from '../../ui/kit.tsx';
import { Cards, Cta, H2, Ink, PageHead, Wrap } from './landing-ui.tsx';

/** The live apps, linked from the surfaces band. */
export const SURFACES = [
  { t: 'Register', d: 'Fast checkout with QRIS, cash, card, e-wallet, VA and split bill.', icon: 'shopping-bag', href: '/pos/selling/register-order' },
  { t: 'Kitchen display', d: 'No more lost tickets. Timers turn red before guests complain.', icon: 'chef-hat', href: '/kds/order-tickets' },
  { t: 'Customer display', d: 'Live cart, QRIS and a thank-you screen in your brand.', icon: 'monitor', href: '/display/live-cart' },
  { t: 'Self-order', d: 'Guests order and pay from the table. You keep 100% of the margin.', icon: 'qr-code', href: '/order/qr-menu/menu-home' },
  { t: 'Owner dashboard', d: 'Every outlet, every shift, live on your phone.', icon: 'activity', href: '/owner' },
  { t: 'Online orders', d: 'GoFood, GrabFood and ShopeeFood in one inbox, cooked in their own lane.', icon: 'bike', href: '/online' },
];
const QUOTES = [['We went from 3 tablets and a notebook to one system. Closing the day takes 5 minutes now.', 'Rina S.', 'Owner, Kopi Biru · 3 outlets'], ['QR ordering cut our queue in half on weekends.', 'Hendra W.', 'Bara Grill, Bandung'], ['The loyalty program paid for itself in the first month.', 'Sinta L.', 'Sakura Bakery, Surabaya']];

// ── Home ────────────────────────────────────────────────────────────────────────────────
export function Home() {
  return <>
    <Wrap style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,340px),1fr))', gap: 40, alignItems: 'center' }}>
      <div className="stack" style={{ gap: 20 }}>
        <span className="badge b-accent" style={{ alignSelf: 'flex-start', height: 30 }}>Cloud POS for Indonesia · QRIS ready</span>
        <h1 style={{ fontSize: 'clamp(48px,6.4vw,84px)', lineHeight: .95, letterSpacing: '-.045em' }}>Sell fast.<br />See everything.</h1>
        <p style={{ fontSize: 18, lineHeight: 1.55, color: 'var(--fg-2)', maxWidth: 520 }}>One system for the counter, the kitchen, your customers’ phones and your dashboard. Built for cafés, restaurants, shops, salons and franchises.</p>
        <div className="row wrap"><Link href="/account/register" className="btn btn-primary btn-pos" style={{ padding: '0 24px' }}>Start free, no card</Link><Link href="/contact-sales-book-a-demo" className="btn btn-pos" style={{ padding: '0 22px', borderWidth: 2, borderColor: 'var(--fg-1)' }}>Book a demo</Link></div>
        <span className="faint" style={{ fontSize: 13 }}>Free plan forever · Pro trial 14 days · setup in 5 minutes</span>
      </div>
      <RegisterMock />
    </Wrap>
    <Ink><Wrap style={{ paddingTop: 56, paddingBottom: 56 }}>
      <div className="stack lg"><H2 kicker="One system">Every screen, one live order</H2><Cards items={SURFACES} min={220} /></div>
    </Wrap></Ink>
    <Wrap>
      <div className="grid" style={{ ['--min' as string]: '260px', gap: 12 }}>{QUOTES.map(([t, n, b]) => <figure key={n} className="card stack" style={{ margin: 0 }}><blockquote style={{ margin: 0, fontSize: 16, lineHeight: 1.55 }}>“{t}”</blockquote><figcaption className="muted" style={{ fontSize: 13 }}><b style={{ color: 'var(--fg-1)' }}>{n}</b> · {b}</figcaption></figure>)}</div>
    </Wrap>
    <Cta />
  </>;
}

/** Hero product mock built from the real menu, real outlet tax and the real totals function. Tapping adds to the cart. */
function RegisterMock() {
  const { db } = useApp();
  const outlet = db.outlets[0];
  const items = db.products.filter(p => p.status === 'live' && p.scope === 'global').slice(0, 6);
  const [cart, setCart] = useState<Record<string, number>>(() => items.length > 2 ? { [items[0].id]: 2, [items[3]?.id ?? items[1].id]: 1 } : {});
  const lines = items.filter(p => cart[p.id]).map(p => ({ p, qty: cart[p.id], unitPrice: priceAt(db, p, outlet.id) }));
  const t = orderTotals(lines.map(l => ({ unitPrice: l.unitPrice, qty: l.qty })), outlet);
  return <div style={{ borderRadius: 'var(--radius-xl)', background: 'var(--ink-950)', padding: 12 }} aria-label="Register preview">
    <div style={{ borderRadius: 18, background: 'var(--ink-50)', color: 'var(--ink-950)', display: 'flex', overflow: 'hidden', minHeight: 300 }}>
      <div style={{ flex: 1, padding: 12, display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(88px,1fr))', gap: 8, alignContent: 'start' }}>
        {items.map(p => <button key={p.id} onClick={() => setCart(c => ({ ...c, [p.id]: (c[p.id] ?? 0) + 1 }))} style={{ border: 0, padding: 0, borderRadius: 12, background: 'var(--ink-0)', boxShadow: '0 0 0 1px var(--ink-200)', overflow: 'hidden', display: 'flex', flexDirection: 'column', cursor: 'pointer', textAlign: 'left' }}>
          <span style={{ aspectRatio: '4/3', background: productImage(p) }} />
          <span style={{ padding: '6px 8px', fontSize: 11, fontWeight: 700, lineHeight: 1.2 }}>{p.name}<br /><span style={{ fontWeight: 500, color: 'var(--ink-600)' }}>{idrShort(priceAt(db, p, outlet.id))}</span></span>
        </button>)}
      </div>
      <div style={{ width: '40%', minWidth: 140, background: 'var(--ink-0)', borderLeft: '1px solid var(--ink-200)', padding: 12, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12 }}>
        <b style={{ fontSize: 13 }}>Order · T-07</b>
        {lines.length ? lines.map(l => <div key={l.p.id} className="row between"><span>{l.qty}× {l.p.name}</span><button aria-label={'Remove ' + l.p.name} onClick={() => setCart(c => { const n = { ...c }; if (n[l.p.id] > 1) n[l.p.id]--; else delete n[l.p.id]; return n; })} style={{ border: 0, background: 'none', cursor: 'pointer', color: 'var(--ink-500)' }}><Icon name="minus" size={14} /></button></div>)
          : <span style={{ color: 'var(--ink-500)' }}>Tap a product to start an order.</span>}
        <div style={{ marginTop: 'auto', fontSize: 11, color: 'var(--ink-600)' }}>{t.service > 0 && <div className="row between"><span>Service</span><span>{idr(t.service)}</span></div>}<div className="row between"><span>Tax</span><span>{idr(t.tax)}</span></div></div>
        <button onClick={() => toast('Preview only. Open the register to sell for real.')} style={{ height: 44, border: 0, borderRadius: 12, background: 'var(--ember-500)', color: 'var(--ink-0)', fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font-display)' }}>Charge {idr(t.total)}</button>
      </div>
    </div>
  </div>;
}

// ── Features ────────────────────────────────────────────────────────────────────────────
const FEATURES = [
  { t: 'Register', d: 'Tablet POS with 6 payment methods, split bill, open bills and offline mode.', icon: 'shopping-bag', href: '/pos/selling/register-order' },
  { t: 'Kitchen display', d: 'Tickets by station, timers, recall and an 86 list synced to every channel.', icon: 'chef-hat', href: '/kds/order-tickets' },
  { t: 'Self-order & kiosk', d: 'QR menu with your brand. Guests order, pay and track from their phone.', icon: 'qr-code', href: '/order/qr-menu/menu-home' },
  { t: 'Loyalty', d: 'Beans, tiers, stamps, streaks and rewards. Members always see how close the next reward is.', icon: 'award', href: '/owner/more-studios-marketing/loyalty-rules-and-rewards-catalog' },
  { t: 'Inventory & COGS', d: 'Recipes, stock per outlet, purchase orders, waste and blind stock counts with photos.', icon: 'boxes', href: '/owner/inventory/stock-opname' },
  { t: 'Owner dashboard', d: 'Live monitor of every outlet, P&L, shifts, cash close and alerts.', icon: 'activity', href: '/owner' },
  { t: 'Shifts & approvals', d: 'One PIC per shift approves within limits; bigger money goes to the manager, then you.', icon: 'badge-check', href: '/manager' },
  { t: 'Online orders', d: 'Delivery apps in one inbox with ready-by times, busy mode and a pickup shelf.', icon: 'bike', href: '/online' },
  { t: 'Customization studios', d: 'Your logo, colors, menu pages, receipts and kiosk, published with versions.', icon: 'palette', href: '/studios' },
];
export function Features() {
  return <><Wrap><div className="stack lg">
    <PageHead kicker="Features" title="Everything in one system" sub="Each part works on its own and gets better together. One order touches the register, the kitchen, the guest’s phone, loyalty and your reports, without re-typing anything." />
    <Cards items={FEATURES} />
  </div></Wrap>
    <Ink><Wrap><div className="grid" style={{ ['--min' as string]: '240px' }}>{[['Real offline', 'Sales queue on the tablet with an idempotency key. No duplicates after reconnect.'], ['Approvals built in', 'Cashier → PIC → manager → owner, by amount. Every step logged with both names.'], ['Your brand, not ours', 'Guests see your colors and fonts on QR, kiosk, display and receipts.'], ['Money you can trust', 'Integer rupiah, tax per outlet, blind cash counts and settlement reports.']].map(([t, d]) => <div key={t} className="stack sm"><b style={{ fontSize: 18 }}>{t}</b><span className="muted" style={{ fontSize: 14 }}>{d}</span></div>)}</div></Wrap></Ink>
    <Cta /></>;
}

// ── Solutions ───────────────────────────────────────────────────────────────────────────
const SOL: Record<'fnb' | 'retail', { title: string; sub: string; cards: { t: string; d: string; icon: string }[]; flow: string[] }> = {
  fnb: { title: 'Built for cafés and restaurants', sub: 'Tables, kitchen tickets, QR ordering and delivery apps, set up from the F&B template in minutes.', flow: ['Guest scans the table QR', 'Order fires to bar and kitchen stations', 'KDS bump sets it ready', 'Waiter serves, guest pays QRIS at the table', 'Beans land on the member’s phone'],
    cards: [{ t: 'Cafés & coffee bars', d: 'Modifiers for size, sugar, ice and milk. Cup stickers and a bar station on the KDS.', icon: 'coffee' }, { t: 'Restaurants', d: 'Floor plan, open bills, course firing, split bill by item or amount.', icon: 'utensils' }, { t: 'Bakeries', d: 'Pastry station, pre-orders and daily sold-out (86) synced to every channel.', icon: 'croissant' }, { t: 'Bars', d: 'Tabs, happy-hour flash prices and age-check notes on tickets.', icon: 'wine' }, { t: 'Food courts', d: 'One cart across many tenants, settlement per tenant.', icon: 'store' }, { t: 'Franchises', d: 'Brand lock, global menu with local prices within ±10%, royalty reports.', icon: 'building' }] },
  retail: { title: 'Built for shops and services', sub: 'Variants, barcodes, bookings and commissions. Same register, same dashboard, set up from the retail or services template.', flow: ['Scan a barcode or pick a variant', 'Apply member price or voucher', 'Pay QRIS, card or split', 'Stock moves per outlet', 'Exchange later with the receipt QR'],
    cards: [{ t: 'Retail & minimarket', d: 'Variants by size and color, barcode labels, exchanges and an online catalog.', icon: 'shopping-basket' }, { t: 'Fashion', d: 'Size runs, transfers between outlets, low-stock alerts per variant.', icon: 'shirt' }, { t: 'Salon & spa', d: 'Bookings per stylist, service duration, commission per service.', icon: 'scissors' }, { t: 'Laundry', d: 'Orders by kg, status tracking links and WhatsApp ready alerts.', icon: 'shirt' }, { t: 'Services', d: 'Deposits, packages and recurring customers with credit balance.', icon: 'calendar-check' }, { t: 'Franchises', d: 'Head office owns products and prices; outlets sell and count.', icon: 'building' }] },
};
export function Solutions({ kind }: { kind: 'fnb' | 'retail' }) {
  const { go } = useApp();
  const s = SOL[kind];
  return <><Wrap><div className="stack lg">
    <Seg value={kind} onChange={k => go(k === 'fnb' ? '/solutions-f-and-b' : '/solutions-retail')} label="Industry" options={[['fnb', 'F&B'], ['retail', 'Retail & services']]} />
    <PageHead kicker="Solutions" title={s.title} sub={s.sub} />
    <Cards items={s.cards} />
    <div className="stack"><H2>How a sale flows</H2>
      <ol className="grid" style={{ ['--min' as string]: '180px', listStyle: 'none', padding: 0, margin: 0 }}>{s.flow.map((f, i) => <li key={f} className="card stack sm"><span className="cap" style={{ color: 'var(--accent-fg)' }}>Step {i + 1}</span><b>{f}</b></li>)}</ol></div>
  </div></Wrap><Cta /></>;
}

// ── Hardware ────────────────────────────────────────────────────────────────────────────
export function Hardware() {
  const { db } = useApp();
  const kinds: [string, string, string, string][] = [['pos', 'Tablets', 'iPad and Android 10" or larger. Landscape recommended.', 'tablet'], ['printer', 'Printers', 'Bluetooth, USB and LAN thermal printers, 58 and 80 mm.', 'printer'], ['edc', 'EDC', 'BCA, Mandiri, BRI and BNI terminals with auto amount.', 'credit-card'], ['drawer', 'Cash drawer', 'Opens from the printer on cash sales.', 'archive'], ['display', 'Customer display', 'Any second screen or a 10" tablet.', 'monitor'], ['kds', 'Kitchen screen', 'Wall tablet or TV with a mini PC.', 'chef-hat']];
  return <><Wrap><div className="stack lg">
    <PageHead kicker="Hardware" title="Hardware that just works" sub="Use your own tablet or buy a bundle from us. Everything pairs with a 6-digit code in under a minute." />
    <Cards items={kinds.map(([k, t, d, icon]) => ({ t, d, icon, meta: db.devices.some(x => x.kind === k) ? <Badge tone="success">In the demo store</Badge> : undefined }))} />
    <div className="card flat scroll-x"><table className="table"><thead><tr><th>Device</th><th>Minimum</th><th>Connects by</th></tr></thead><tbody>
      {[['Register tablet', 'Android 10 / iPadOS 16, 3 GB RAM, 10"', 'Wi-Fi or 4G; works offline'], ['Thermal printer', 'ESC/POS, 58 or 80 mm', 'Bluetooth, USB, LAN'], ['EDC', 'BCA, Mandiri, BRI, BNI', 'Bluetooth or cable, amount sent from the register'], ['Kitchen display', 'Any browser, 21" or larger', 'Wi-Fi or LAN'], ['Kiosk', 'Portrait 21–32" touch screen', 'LAN recommended']].map(r => <tr key={r[0]}>{r.map((c, i) => <td key={i}>{c}</td>)}</tr>)}
    </tbody></table></div>
    <div className="row wrap"><Link href="/contact-sales-book-a-demo" className="btn btn-primary">Ask for a bundle quote</Link></div>
  </div></Wrap></>;
}

// ── Integrations ────────────────────────────────────────────────────────────────────────
export function Integrations() {
  const groups: [string, [string, string, string][]][] = [
    ['Payments', [['QRIS', 'All banks and e-wallets through one QR, confirmed by gateway webhook.', 'live'], ['Virtual account', 'BCA, Mandiri, BNI, BRI, with automatic reconciliation.', 'live'], ['E-wallet', 'GoPay, OVO, DANA and ShopeePay deep links.', 'live'], ['EDC terminals', 'Amount sent from the register, no double typing.', 'live']]],
    ['Delivery apps', [['GoFood', 'Orders land in the online inbox and a kitchen lane.', 'live'], ['GrabFood', 'Same inbox, ready-by from tier and kitchen load.', 'v1.2'], ['ShopeeFood', 'Same inbox, pickup code check at handover.', 'v1.2']]],
    ['Messaging', [['WhatsApp Business', 'Receipts, OTP, thank-you and win-back messages from Meta-approved templates.', 'live'], ['Email', 'Receipts and reports.', 'live']]],
    ['Accounting & platform', [['Jurnal', 'Daily sales journal and settlements.', 'v2'], ['Accurate', 'Sales, tax and inventory sync.', 'v2'], ['API & webhooks', 'Every service event, documented.', 'Enterprise']]],
  ];
  return <><Wrap><div className="stack lg">
    <PageHead kicker="Integrations" title="Works with what you already use" sub="Payments, delivery apps, WhatsApp and accounting. Everything flows into the same orders, so reports never disagree." />
    {groups.map(([g, list]) => <div key={g} className="stack"><h3>{g}</h3><Cards min={240} items={list.map(([t, d, s]) => ({ t, d, meta: <Badge tone={s === 'live' ? 'success' : 'info'}>{s === 'live' ? 'Live' : s}</Badge> }))} /></div>)}
    <Link href="/developer-api-docs" className="btn" style={{ alignSelf: 'flex-start' }}>Read the API docs<Icon name="arrow-right" size={16} /></Link>
  </div></Wrap></>;
}

// ── Case studies (Kopi Biru numbers come from the live demo store) ──────────────────────
export function CaseStudies() {
  const { db } = useApp();
  const s = useMemo(() => {
    const paid = db.orders.filter(o => o.status === 'paid' || o.status === 'served' || o.paidAt);
    const guest = paid.filter(o => o.source === 'qr' || o.source === 'kiosk' || o.source === 'web').length;
    const rev = paid.reduce((a, o) => a + o.total, 0);
    const days = new Set(paid.map(o => new Date(o.createdAt).toDateString())).size || 1;
    const members = paid.filter(o => o.customerId).length;
    return { orders: paid.length, perDay: Math.round(paid.length / days), guestShare: Math.round((guest / (paid.length || 1)) * 100), avg: Math.round(rev / (paid.length || 1)), memberShare: Math.round((members / (paid.length || 1)) * 100), days };
  }, [db.orders]);
  return <><Wrap><div className="stack lg">
    <PageHead kicker="Case studies" title="Outlets that run on BorNiz" sub="Real numbers from the live Kopi Biru demo store, updated as orders come in." />
    <div className="card stack">
      <div className="row between wrap"><div className="stack sm" style={{ gap: 2 }}><b style={{ fontSize: 22 }}>Kopi Biru</b><span className="muted">{db.outlets.length} outlets · {db.outlets.map(o => o.name).join(', ')}</span></div><Status s="live" /></div>
      <div className="grid" style={{ ['--min' as string]: '180px' }}>
        <Kpi label={`Orders, last ${s.days} days`} value={s.orders.toLocaleString('en-US')} delta={`${s.perDay} a day`} />
        <Kpi label="Ordered by guests (QR, kiosk, web)" value={s.guestShare + '%'} />
        <Kpi label="Average ticket" value={idr(s.avg)} />
        <Kpi label="Orders with a member" value={s.memberShare + '%'} />
      </div>
      <blockquote style={{ margin: 0, fontSize: 17 }}>“{QUOTES[0][0]}” <span className="muted">· {QUOTES[0][1]}</span></blockquote>
      <Link href="/owner" className="btn btn-sm" style={{ alignSelf: 'flex-start' }}>See their live dashboard<Icon name="arrow-right" size={16} /></Link>
    </div>
    <div className="grid" style={{ ['--min' as string]: '300px' }}>{QUOTES.slice(1).map(([t, n, b]) => <figure key={n} className="card stack" style={{ margin: 0 }}><span className="cap">{b}</span><blockquote style={{ margin: 0, fontSize: 17 }}>“{t}”</blockquote><figcaption className="muted">{n}</figcaption></figure>)}</div>
  </div></Wrap><Cta title="Be the next one" /></>;
}
