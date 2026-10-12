'use client';
// Customer screens: what guests see on their phone and on the TVs. Built from live orders, menu, 86 list and outlet hours.
import { same } from './same.tsx';
import { TOOL_DEFAULTS } from '../../system/tools.ts';
import { balance } from '../../domain/loyalty.ts';
import { Icon } from '../../ui/kit.tsx';
import { Caption, F, first, latest, outletName, Phone, Stage, customerOf, thousands, onColor, type PP, type Tool } from './core.tsx';
import type { Order } from '../../data/schema.ts';

const btn = (theme: { p: string; ink: string }) => ({ height: 48, borderRadius: 14, border: 0, background: 'var(--bn-p)', color: onColor(theme.p, theme.ink), fontWeight: 700, fontSize: 15, width: '100%' });
const Card = ({ children, tone }: { children: React.ReactNode; tone?: 'acc' }) =>
  <div style={{ padding: 14, borderRadius: 16, background: tone === 'acc' ? 'color-mix(in srgb,var(--bn-acc) 22%,var(--ink-0))' : 'var(--ink-0)', boxShadow: '0 1px 2px rgba(20,18,16,.08)', display: 'flex', gap: 10, alignItems: 'center', fontSize: 13 }}>{children}</div>;
const Head = ({ x, sub }: { x: PP['x']; sub?: string }) =>
  <div style={{ padding: '16px 18px', background: 'var(--bn-ink)', color: 'var(--bn-paper)', display: 'flex', alignItems: 'center', gap: 10 }}>
    <b style={{ fontFamily: 'var(--bn-font)', fontSize: 17 }}>{x.db.theme.name}</b><span style={{ marginLeft: 'auto', fontSize: 12, opacity: .8 }}>{sub ?? outletName(x.db, x.outletId)}</span></div>;
const etaMin = (o: Order) => Math.max(1, o.lines.filter(l => l.kds !== 'done').reduce((a, l) => a + l.qty * (l.station === 'kitchen' ? 4 : 2), 0));

function Waiting({ v, x }: PP) {
  const o = latest(x.db, x.outletId, o => ['sent', 'preparing'].includes(o.status)) ?? latest(x.db, x.outletId);
  const c = customerOf(x.db, o);
  const auto = !o ? 0 : o.status === 'sent' ? 0 : o.status === 'preparing' ? (o.lines.some(l => l.kds === 'done') ? 2 : 1) : 2;
  const st = v.step === 'auto' ? auto : Number(v.step);
  const pctDone = [20, 60, 88][st];
  const upsell = x.db.products.find(p => p.categoryId === 'pastry' && !o?.lines.some(l => l.productId === p.id) && !x.db.outletProducts.find(op => op.productId === p.id && op.outletId === x.outletId)?.is86);
  const promo = x.db.promos.find(p => p.code);
  const t = x.db.theme;
  return <Stage><Phone theme={t}>
    <Head x={x} sub={o ? o.no : undefined} />
    <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12, overflow: 'auto' }}>
      <b style={{ fontFamily: 'var(--bn-font)', fontSize: 20 }}>{String(v.greet).replace('{name}', first(c?.name))}</b>
      <span style={{ fontSize: 14 }}>{['We got your order', 'Your order is being made', 'Almost ready'][st]}</span>
      {v.prog === 'steps' && <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 6 }}>{['Received', 'Preparing', 'Ready'].map((l, i) => <div key={l} className="stack" style={{ gap: 4 }}><span style={{ height: 6, borderRadius: 3, background: i <= st ? 'var(--bn-p)' : 'color-mix(in srgb,var(--bn-ink) 15%,transparent)' }} /><span style={{ fontSize: 11 }}>{l}</span></div>)}</div>}
      {v.prog === 'bar' && <div style={{ height: 10, borderRadius: 5, background: 'color-mix(in srgb,var(--bn-ink) 12%,transparent)' }}><div style={{ width: pctDone + '%', height: '100%', borderRadius: 5, background: 'var(--bn-p)' }} /></div>}
      {v.prog === 'ring' && <div style={{ alignSelf: 'center', width: 110, height: 110, borderRadius: 99, background: `conic-gradient(var(--bn-p) 0 ${pctDone}%,color-mix(in srgb,var(--bn-ink) 12%,transparent) 0)`, display: 'grid', placeItems: 'center' }}><span style={{ width: 84, height: 84, borderRadius: 99, background: 'var(--bn-paper)', display: 'grid', placeItems: 'center', fontWeight: 700 }}>{pctDone}%</span></div>}
      {v.eta && o && <span style={{ fontSize: 13, opacity: .8 }}>About {st === 2 ? 1 : etaMin(o)} min · {o.lines.reduce((a, l) => a + l.qty, 0)} items</span>}
      {v.p_upsell && upsell && <Card><Icon name="croissant" /><span style={{ flex: 1 }}>Add {upsell.name}? Ready with your order.</span><b>+{thousands(upsell.basePrice)}k</b></Card>}
      {v.p_loyal && c && <Card tone="acc"><Icon name="award" /><span>{balance(x.db.ledger, c.id).toLocaleString('en-US')} beans · +{Math.floor((o?.subtotal ?? 0) / 1000)} with this order</span></Card>}
      {v.p_wifi && <Card><Icon name="wifi" /><span>Wi-Fi {x.db.tenant.name.replace(/\s/g, '').toUpperCase()}-GUEST</span></Card>}
      {v.p_music && <Card><Icon name="music" /><span>Now playing in store</span></Card>}
      {v.p_story && <Card><Icon name="book-open" /><span>Behind the bar: where our palm sugar comes from</span></Card>}
      {v.p_promo && promo && <Card tone="acc"><Icon name="ticket-percent" /><span>{promo.name} next visit · code {promo.code}</span></Card>}
      {v.p_game && <Card><Icon name="gamepad-2" /><span>Mini game: catch the beans</span></Card>}
      {v.p_ig && <Card><Icon name="camera" /><span>Follow us on Instagram</span></Card>}
      {v.p_ad && <Card><Icon name="megaphone" /><span>Sponsored · {v.adby}</span></Card>}
    </div>
  </Phone><Caption>{o ? `Live order ${o.no} (${o.status}). Placements reorder in Menu Studio → Pages; sponsored slots are capped at one per order.` : 'No order in progress; showing the layout.'}</Caption></Stage>;
}

function Ready({ v, x }: PP) {
  const o = latest(x.db, x.outletId, o => o.status === 'ready') ?? latest(x.db, x.outletId, o => o.status === 'paid');
  const name = first(customerOf(x.db, o)?.name), no = o?.no ?? '';
  const fill = (s: string) => s.replace('{name}', name).replace('{order}', no);
  const t = x.db.theme;
  return <Stage><div className="row wrap" style={{ gap: 20, justifyContent: 'center', alignItems: 'flex-start' }}>
    <Phone theme={t}>
      {v.c_push && <div style={{ margin: 10, padding: 10, borderRadius: 14, background: 'color-mix(in srgb,var(--ink-0) 92%,transparent)', fontSize: 12, boxShadow: 'var(--shadow-e2)' }}><b>{t.name}</b> · now<br />{fill(v.head)}</div>}
      <div style={{ flex: 1, padding: 22, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, textAlign: 'center' }}>
        <span style={{ width: 84, height: 84, borderRadius: 99, background: 'var(--bn-p)', color: onColor(t.p, t.ink), display: 'grid', placeItems: 'center' }}><Icon name="party-popper" size={40} /></span>
        <b style={{ fontFamily: 'var(--bn-font)', fontSize: 24 }}>{fill(v.head)}</b><span>{fill(v.sub)}</span>
        <span style={{ padding: '6px 12px', borderRadius: 99, background: 'color-mix(in srgb,var(--bn-acc) 30%,transparent)', fontSize: 13 }}>{{ pickup: 'Show this at the counter', table: `On its way to ${o?.table ?? 'your table'}`, delivery: 'Delivered to your door' }[v.where as 'pickup']}</span>
        {v.confetti && <span aria-hidden style={{ fontSize: 12, opacity: .6 }}>Confetti plays once</span>}
      </div>
      <div style={{ padding: 18 }}><button style={btn(t)}>{{ rate: 'Rate your visit', reorder: 'Order again', share: 'Share on Instagram' }[v.cta as 'rate']}</button></div>
    </Phone>
    <div className="stack" style={{ width: 'min(280px,100%)' }}>
      <span className="cap">Notify through</span>
      <div className="row wrap">{[['Phone screen', v.c_page], ['Push', v.c_push], ['WhatsApp', v.c_wa], ['Display', v.c_disp], ['Vibrate', v.c_vibe]].map(([l, on]) => <span key={l as string} className={'badge' + (on ? ' b-success' : '')}>{l as string}</span>)}</div>
      {v.c_wa && <div className="card tight" style={{ fontSize: 13 }}><b>WhatsApp</b><br />{fill(v.head)} {fill(v.sub)}</div>}
      <div className="card tight" style={{ fontSize: 13 }}><b>1 hour later</b><br />{v.later}</div>
    </div>
  </div><Caption>{o ? `Order ${o.no} for ${name}.` : 'No ready orders yet.'} Set the follow-up in Messaging & automation.</Caption></Stage>;
}


const auto: [string, string] = ['auto', 'Live'];
export const GUEST: Tool[] = [
  { id: 'wait', group: 'CUSTOMER SCREENS', name: 'Waiting screen', icon: 'hourglass', plan: 'free', desc: 'What guests see on their phone while the order is being prepared. Fill the wait with hospitality, not a spinner.', Preview: Waiting,
    def: { ...TOOL_DEFAULTS.wait },
    fields: () => [F.seg('Show step', 'step', [auto, ['0', 'Received'], ['1', 'Preparing'], ['2', 'Almost']]), F.seg('Progress style', 'prog', [['steps', 'Steps'], ['bar', 'Bar'], ['ring', 'Ring']]), F.toggle('Show estimated time', 'eta'), F.text('Greeting', 'greet'), F.head('PLACEMENTS WHILE WAITING'), F.toggle('Add-on suggestion', 'p_upsell'), F.toggle('Points progress', 'p_loyal'), F.toggle('Wi-Fi card', 'p_wifi'), F.toggle('Now playing in store', 'p_music'), F.toggle('Mini game', 'p_game'), F.toggle('Brand story', 'p_story'), F.toggle('Promo for next visit', 'p_promo'), F.toggle('Follow on Instagram', 'p_ig'), F.toggle('Sponsored partner placement', 'p_ad'), F.text('Partner name', 'adby')] },
  { id: 'ready', group: 'CUSTOMER SCREENS', name: 'Order ready & enjoy', icon: 'party-popper', plan: 'free', desc: 'The moment the order is ready: notification, ready screen and the after-meal follow-up.', Preview: Ready,
    def: { ...TOOL_DEFAULTS.ready },
    pairs: (_, x) => [[onColor(x.db.theme.p, x.db.theme.ink), x.db.theme.p, 'Button label on primary']],
    fields: () => [F.text('Headline', 'head'), F.text('Subtext', 'sub'), F.seg('Order is', 'where', [['pickup', 'Pickup'], ['table', 'Served'], ['delivery', 'Delivered']]), F.head('NOTIFY THROUGH'), F.toggle('Ready screen on phone', 'c_page'), F.toggle('Push notification', 'c_push'), F.toggle('WhatsApp (WABA)', 'c_wa'), F.toggle('Queue / customer display', 'c_disp'), F.toggle('Sound + vibrate on phone', 'c_vibe'), F.head('AFTER'), F.seg('Main action', 'cta', [['rate', 'Rate'], ['reorder', 'Reorder'], ['share', 'Share']]), F.toggle('Confetti', 'confetti'), F.text('Message 1 hour later', 'later')] },
  { id: 'board', group: 'CUSTOMER SCREENS', name: 'Menu board (TV)', icon: 'tv', plan: 'pro', desc: 'Digital menu boards for TVs above the counter. Prices and sold-out items update live.', ...same('menu-board-tv-digital-signage') },
  { id: 'queue', group: 'CUSTOMER SCREENS', name: 'Queue & pickup screen', icon: 'list-ordered', plan: 'free', desc: 'Shows preparing and ready numbers on a TV near the pickup counter.', ...same('queue-pickup-screen') },
  { id: 'qrpay', group: 'CUSTOMER SCREENS', name: 'QRIS payment on phone', icon: 'qr-code', plan: 'free', desc: 'The payment page guests see after checking out from the QR menu.', ...same('qris-payment-page-on-customer-phone') },
  { id: 'split', group: 'CUSTOMER SCREENS', name: 'Split bill from phone', icon: 'split', plan: 'pro', desc: 'Each guest at the table scans and pays their own items or share.', ...same('split-bill-and-pay-together-from-phones') },
  { id: 'track', group: 'CUSTOMER SCREENS', name: 'Delivery tracking', icon: 'bike', plan: 'free', desc: 'Live tracking page sent by WhatsApp for delivery orders.', ...same('delivery-tracking-page') },
  { id: 'closed', group: 'CUSTOMER SCREENS', name: 'Closed, paused & sold out', icon: 'store', plan: 'free', desc: 'What guests see when the store is closed, ordering is paused or an item runs out.', ...same('store-closed-offline-sold-out-pages') },
];
