'use client';
// Customer screens: what guests see on their phone and on the TVs. Built from live orders, menu, 86 list and outlet hours.
import { idr } from '../../domain/money.ts';
import { balance } from '../../domain/loyalty.ts';
import { Icon, hhmm, useNow } from '../../ui/kit.tsx';
import { Caption, F, first, latest, menuOf, outletName, Phone, Screen, Stage, customerOf, thousands, onColor, type PP, type Tool } from './core.tsx';
import type { Order } from '../../data/schema.ts';

const todayStart = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };
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

function Board({ v, x }: PP) {
  const t = x.db.theme, menu = menuOf(x.db, x.outletId);
  const bg = v.theme === 'dark' ? t.ink : v.theme === 'brand' ? t.p : t.paper, fg = v.theme === 'light' ? t.ink : onColor(bg, t.ink), ac = v.theme === 'light' ? t.p : t.acc;
  const flash = x.db.promos.find(p => p.kind === 'flash' && (!p.endsAt || p.endsAt > Date.now()));
  const cols = menu.slice(0, v.layout === '3col' ? 3 : 2);
  const sold = menu.reduce((a, g) => a + g.items.filter(i => i.is86).length, 0);
  return <Stage><Screen theme={t} bg={bg}><div style={{ color: fg, flex: 1, padding: 18, display: 'flex', flexDirection: 'column', gap: 10, fontFamily: 'var(--bn-font)' }}>
    <div className="row between"><b style={{ fontSize: 20 }}>{t.name}</b><span style={{ fontSize: 12, opacity: .8 }}>{outletName(x.db, x.outletId)} · {hhmm(Date.now())}</span></div>
    <div style={{ flex: 1, display: 'grid', gridTemplateColumns: v.layout === 'hero' ? '1.3fr 1fr' : `repeat(${v.layout === '3col' ? 3 : 2},minmax(0,1fr))${v.layout === '2col' ? ' 1fr' : ''}`, gap: 14, minHeight: 0 }}>
      {v.layout === 'hero' && menu[0] && <div style={{ borderRadius: 12, background: `hsl(${menu[0].items[0].p.hue} 40% 45%)`, padding: 14, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', color: WHITE_TEXT }}><b style={{ fontSize: 22 }}>{menu[0].items[0].p.name}</b><span style={{ fontSize: 18 }}>{thousands(menu[0].items[0].price)}k</span></div>}
      {(v.layout === 'hero' ? cols.slice(0, 1) : cols).map(g => <div key={g.c.id} className="stack" style={{ gap: 5, minWidth: 0 }}><b style={{ color: ac, fontSize: 13, textTransform: 'uppercase', letterSpacing: '.06em' }}>{g.c.name}</b>
        {g.items.filter(i => !(i.is86 && v.sold === 'hide')).slice(0, 7).map(i => <div key={i.p.id} className="row" style={{ fontSize: 13, opacity: i.is86 ? .45 : 1, textDecoration: i.is86 && v.sold === 'strike' ? 'line-through' : 'none' }}>
          <span className="grow" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{i.p.name}</span>{i.is86 && v.sold === 'badge' ? <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 99, background: 'var(--danger)', color: WHITE_TEXT }}>Sold out</span> : <b>{thousands(i.price)}</b>}</div>)}</div>)}
      {v.layout === '2col' && <div style={{ borderRadius: 12, background: ac, color: onColor(ac, t.ink), padding: 12, display: 'grid', placeItems: 'center', textAlign: 'center' }}><b>{flash?.name ?? 'Today’s special'}</b></div>}
    </div>
    {v.promo && flash && <div style={{ padding: '6px 12px', borderRadius: 8, background: ac, color: onColor(ac, t.ink), fontSize: 13, fontWeight: 700 }}>{flash.name} · IDR {thousands(flash.value)}k{flash.endsAt ? ` until ${hhmm(flash.endsAt)}` : ''}</div>}
  </div></Screen><Caption>Live from {outletName(x.db, x.outletId)}: prices in IDR thousands, {sold} item{sold === 1 ? '' : 's'} sold out (86) right now.{v.rotate ? ' Categories rotate every 15 s.' : ''}</Caption></Stage>;
}
const WHITE_TEXT = 'var(--ink-0)';

function Queue({ v, x }: PP) {
  const t0 = todayStart();
  const today = x.db.orders.filter(o => o.outletId === x.outletId && o.createdAt >= t0);
  const prep = today.filter(o => ['sent', 'preparing'].includes(o.status)), ready = today.filter(o => o.status === 'ready');
  const label = (o: Order) => o.no + (v.names ? ' · ' + first(customerOf(x.db, o)?.name ?? o.table ?? 'Guest') : '');
  const t = x.db.theme;
  return <Stage><Screen theme={t} bg={v.theme === 'dark' ? t.ink : t.p}><div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', color: onColor(v.theme === 'dark' ? t.ink : t.p, t.ink), fontFamily: 'var(--bn-font)' }}>
    <div style={{ padding: 18 }}><b style={{ fontSize: 14, opacity: .8 }}>PREPARING</b><div className="stack" style={{ gap: 6, marginTop: 10 }}>{prep.length ? prep.slice(0, 8).map(o => <b key={o.id} style={{ fontSize: 22 }}>{label(o)}</b>) : <span style={{ opacity: .7 }}>Nothing in the kitchen</span>}</div></div>
    <div style={{ padding: 18, background: 'color-mix(in srgb,var(--success) 85%,var(--ink-950))', color: 'var(--ink-0)' }}><b style={{ fontSize: 14 }}>READY · PLEASE PICK UP</b><div className="stack" style={{ gap: 6, marginTop: 10 }}>{ready.length ? ready.slice(0, 6).map(o => <b key={o.id} style={{ fontSize: 30 }}>{label(o)}</b>) : <span style={{ opacity: .8 }}>No orders ready</span>}</div></div>
  </div>{v.ad && <div style={{ padding: '8px 16px', background: 'var(--bn-acc)', color: onColor(t.acc, t.ink), fontSize: 13, fontWeight: 700 }}>{x.db.promos.find(p => p.code)?.name ?? t.name}</div>}</Screen>
    <Caption>Live: {prep.length} preparing, {ready.length} ready at {outletName(x.db, x.outletId)} today. {v.sound ? 'A chime plays when a number turns ready.' : 'Silent.'}</Caption></Stage>;
}

/** Deterministic QR-like art from the payment reference (the real QR comes from the gateway). */
function QrArt({ seed }: { seed: string }) {
  let h = 0; for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const cells = Array.from({ length: 21 * 21 }, (_, i) => { h = (h * 1103515245 + 12345) >>> 0; const r = Math.floor(i / 21), c = i % 21; const finder = (r < 7 && c < 7) || (r < 7 && c > 13) || (r > 13 && c < 7); return finder ? (r % 6 === 0 || c % 6 === 0 || (r > 13 ? r - 14 : r) % 6 === 0 || ((r % 7 > 1 && r % 7 < 5) && ((c % 7 > 1 && c % 7 < 5) || (c > 13 && (c - 14) % 7 > 1 && (c - 14) % 7 < 5)))) : (h >> 16) & 1; });
  return <div aria-label="QRIS code" style={{ display: 'grid', gridTemplateColumns: 'repeat(21,1fr)', width: 180, height: 180, padding: 8, background: 'var(--ink-0)' }}>{cells.map((on, i) => <span key={i} style={{ background: on ? 'var(--ink-950)' : 'transparent' }} />)}</div>;
}

function QrPay({ v, x }: PP) {
  const now = useNow();
  const o = latest(x.db, x.outletId, o => ['open', 'paying', 'sent', 'preparing', 'ready', 'served'].includes(o.status) && o.total > 0) ?? latest(x.db, x.outletId, o => o.total > 0);
  const pay = o && x.db.payments.find(p => p.orderId === o.id && p.method === 'qris');
  const ttl = Number(v.timer) * 60e3, left = pay?.expiresAt && pay.status === 'pending' ? Math.max(0, pay.expiresAt - now) : ttl;
  const t = x.db.theme;
  return <Stage><Phone theme={t}>
    {v.brand && <Head x={x} />}
    <div style={{ padding: 20, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, textAlign: 'center' }}>
      <span style={{ fontSize: 13 }}>{o ? `Order ${o.no}${o.table ? ' · ' + o.table : ''}` : 'No open bill'}</span>
      <b style={{ fontFamily: 'var(--font-display)', fontSize: 30 }}>{o ? idr(o.total) : '—'}</b>
      <div style={{ padding: 10, borderRadius: 16, background: 'var(--ink-0)', boxShadow: 'var(--shadow-e1)' }}><b style={{ fontSize: 13, letterSpacing: '.1em' }}>QRIS</b><QrArt seed={pay?.ref ?? o?.id ?? 'x'} /></div>
      <span style={{ fontSize: 14 }}>Pay before <b>{Math.floor(left / 60e3)}:{String(Math.floor((left % 60e3) / 1000)).padStart(2, '0')}</b></span>
      <span style={{ fontSize: 12, opacity: .75 }}>Scan with any bank or e-wallet app. We confirm automatically.</span>
      {v.save && <button style={{ ...btn(t), background: 'transparent', color: 'var(--bn-ink)', border: '1.5px solid currentColor' }}>Save QR to gallery</button>}
    </div>
  </Phone><Caption>{pay ? `Gateway reference ${pay.ref}, status ${pay.status}.` : 'QR is created when the guest checks out.'} QRIS marks and the payment confirmation are locked elements.</Caption></Stage>;
}

function Split({ v, x }: PP) {
  const o = latest(x.db, x.outletId, o => o.lines.length >= 2 && o.total > 0) ?? latest(x.db, x.outletId, o => o.total > 0);
  const n = Math.max(2, Math.min(4, o?.guests ?? 3));
  const people = Array.from({ length: n }, (_, i) => i === n - 1 ? 'You' : first(x.db.customers[i]?.name));
  const share = (i: number) => { if (!o) return 0; if (v.mode !== 'items') return Math.round(o.total / n); const ls = o.lines.filter((_, j) => j % n === i); const sub = ls.reduce((a, l) => a + (l.flashPrice ?? l.unitPrice) * l.qty, 0); return o.subtotal ? Math.round((sub / o.subtotal) * o.total) : 0; };
  const t = x.db.theme;
  return <Stage><Phone theme={t}><Head x={x} sub={o?.table ?? o?.no} />
    <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <b style={{ fontFamily: 'var(--bn-font)', fontSize: 20 }}>Split the bill</b><span style={{ fontSize: 13 }}>Total {o ? idr(o.total) : '—'} · {n} people · by {v.mode === 'items' ? 'items' : v.mode === 'even' ? 'even shares' : 'amount'}</span>
      {people.map((p, i) => <Card key={i}><span style={{ width: 30, height: 30, borderRadius: 99, display: 'grid', placeItems: 'center', background: 'var(--bn-p)', color: onColor(t.p, t.ink), fontWeight: 700 }}>{p[0]}</span>
        <span style={{ flex: 1 }}><b>{p}</b>{v.mode === 'items' && o && <><br /><span style={{ opacity: .75 }}>{o.lines.filter((_, j) => j % n === i).map(l => l.name).join(', ') || 'No items'}</span></>}</span>
        <b>{idr(share(i))}</b></Card>)}
      {v.tip && <div style={{ display: 'flex', gap: 6 }}>{['No tip', '5%', '10%'].map(l => <span key={l} style={{ flex: 1, textAlign: 'center', padding: 8, borderRadius: 10, border: '1px solid color-mix(in srgb,var(--bn-ink) 20%,transparent)', fontSize: 13 }}>{l}</span>)}</div>}
      <button style={btn(t)}>Pay my share {idr(share(n - 1))}</button>
    </div>
  </Phone><Caption>{o ? `Order ${o.no}: ${o.lines.length} lines.` : 'No order yet.'} Each guest scans the table QR and pays with QRIS; the bill closes when all shares settle.</Caption></Stage>;
}

function Track({ v, x }: PP) {
  const o = latest(x.db, x.outletId, o => o.type === 'delivery') ?? latest(x.db, null, o => o.type === 'delivery');
  const auto = !o ? 0 : o.status === 'open' || o.status === 'sent' ? 0 : o.status === 'preparing' ? 1 : o.status === 'ready' ? 2 : 3;
  const st = v.stage === 'auto' ? auto : Number(v.stage);
  const t = x.db.theme;
  return <Stage><Phone theme={t}><Head x={x} sub={o?.no} />
    {v.map && <div style={{ height: 180, position: 'relative', background: 'repeating-linear-gradient(0deg,color-mix(in srgb,var(--bn-ink) 6%,transparent) 0 1px,transparent 1px 28px),repeating-linear-gradient(90deg,color-mix(in srgb,var(--bn-ink) 6%,transparent) 0 1px,transparent 1px 28px)' }}>
      <span style={{ position: 'absolute', top: 70, left: '10%', right: '10%', height: 4, borderRadius: 2, background: 'var(--bn-p)', opacity: .4 }} />
      <span style={{ position: 'absolute', top: 58, left: ['8%', '8%', '50%', '84%'][st], width: 28, height: 28, borderRadius: 99, background: 'var(--bn-p)', color: onColor(t.p, t.ink), display: 'grid', placeItems: 'center' }}><Icon name="bike" size={16} /></span>
    </div>}
    <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <b style={{ fontFamily: 'var(--bn-font)', fontSize: 20 }}>{['Order confirmed', 'Being prepared', 'Rider is on the way', 'Your order has arrived'][st]}</b>
      <span style={{ fontSize: 13 }}>{o?.readyBy ? `${st === 3 ? 'Delivered' : 'Ready by'} ${hhmm(o.readyBy)}` : ''}{o ? ` · ${o.source}` : ''}</span>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 4 }}>{['Confirmed', 'Cooking', 'On the way', 'Arrived'].map((l, i) => <div key={l} className="stack" style={{ gap: 4 }}><span style={{ height: 6, borderRadius: 3, background: i <= st ? 'var(--bn-p)' : 'color-mix(in srgb,var(--bn-ink) 15%,transparent)' }} /><span style={{ fontSize: 10 }}>{l}</span></div>)}</div>
      {v.driver && st >= 2 && <Card><Icon name="user-round" /><span style={{ flex: 1 }}>Your rider from {o?.source ?? 'the delivery app'}</span><Icon name="phone" /></Card>}
      {o && <Card><span style={{ flex: 1 }}>{o.lines.map(l => `${l.qty}× ${l.name}`).join(', ')}</span><b>{idr(o.total)}</b></Card>}
    </div>
  </Phone><Caption>{o ? `Delivery order ${o.no} (${o.status}). The link is sent on WhatsApp when the outlet accepts.` : 'No delivery orders yet; showing the layout.'}</Caption></Stage>;
}

function Closed({ v, x }: PP) {
  const out = x.db.outlets.find(o => o.id === x.outletId)!;
  const menu = menuOf(x.db, x.outletId).flatMap(g => g.items);
  const gone = menu.find(i => i.is86), alt = gone && menu.find(i => !i.is86 && i.p.categoryId === gone.p.categoryId);
  const t = x.db.theme;
  const title = { closed: 'We’re closed right now', busy: 'Orders paused for a moment', soldout: 'Sold out' }[v.state as 'closed'];
  const msg = v.state === 'busy' ? 'The kitchen is catching up. Ordering reopens in about 10 minutes.' : v.state === 'soldout' ? (gone ? `${gone.p.name} is sold out for today.${alt ? ` Try ${alt.p.name} instead?` : ''}` : 'Nothing is sold out right now.') : (v.msg || `We open again at ${out.opens}.`);
  return <Stage><Phone theme={t}><Head x={x} />
    <div style={{ flex: 1, padding: 24, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, textAlign: 'center' }}>
      <span style={{ width: 72, height: 72, borderRadius: 99, background: 'color-mix(in srgb,var(--bn-p) 14%,transparent)', color: 'var(--bn-p)', display: 'grid', placeItems: 'center' }}><Icon name={{ closed: 'moon', busy: 'timer', soldout: 'package-x' }[v.state as 'closed']} size={34} /></span>
      <b style={{ fontFamily: 'var(--bn-font)', fontSize: 22 }}>{title}</b><span style={{ fontSize: 14 }}>{msg}</span>
      <span style={{ fontSize: 12, opacity: .7 }}>{out.name} · open {out.opens}–{out.closes}</span>
      {v.pre && v.state !== 'soldout' && <button style={{ ...btn(t), marginTop: 8 }}>Pre-order for later</button>}
      {v.state === 'soldout' && alt && <button style={{ ...btn(t), marginTop: 8 }}>Add {alt.p.name} · {thousands(alt.price)}k</button>}
    </div>
  </Phone><Caption>Hours from outlet settings ({out.opens}–{out.closes}); sold-out uses the live 86 list. Error screens are locked: wording here, layout fixed.</Caption></Stage>;
}

const auto: [string, string] = ['auto', 'Live'];
export const GUEST: Tool[] = [
  { id: 'wait', group: 'CUSTOMER SCREENS', name: 'Waiting screen', icon: 'hourglass', plan: 'free', desc: 'What guests see on their phone while the order is being prepared. Fill the wait with hospitality, not a spinner.', Preview: Waiting,
    def: { step: 'auto', prog: 'steps', eta: true, greet: 'Sit back, {name}. We’re brewing.', p_upsell: true, p_loyal: true, p_wifi: true, p_music: true, p_game: false, p_story: true, p_promo: true, p_ig: false, p_ad: false, adby: 'Susu Segar Lembang' },
    fields: () => [F.seg('Show step', 'step', [auto, ['0', 'Received'], ['1', 'Preparing'], ['2', 'Almost']]), F.seg('Progress style', 'prog', [['steps', 'Steps'], ['bar', 'Bar'], ['ring', 'Ring']]), F.toggle('Show estimated time', 'eta'), F.text('Greeting', 'greet'), F.head('PLACEMENTS WHILE WAITING'), F.toggle('Add-on suggestion', 'p_upsell'), F.toggle('Points progress', 'p_loyal'), F.toggle('Wi-Fi card', 'p_wifi'), F.toggle('Now playing in store', 'p_music'), F.toggle('Mini game', 'p_game'), F.toggle('Brand story', 'p_story'), F.toggle('Promo for next visit', 'p_promo'), F.toggle('Follow on Instagram', 'p_ig'), F.toggle('Sponsored partner placement', 'p_ad'), F.text('Partner name', 'adby')] },
  { id: 'ready', group: 'CUSTOMER SCREENS', name: 'Order ready & enjoy', icon: 'party-popper', plan: 'free', desc: 'The moment the order is ready: notification, ready screen and the after-meal follow-up.', Preview: Ready,
    def: { head: 'Selamat menikmati, {name}!', sub: 'Pesanan {order} siap di counter.', where: 'pickup', c_page: true, c_push: true, c_wa: true, c_disp: true, c_vibe: true, cta: 'rate', confetti: true, later: 'Terima kasih sudah mampir. Sampai jumpa lagi!' },
    pairs: (_, x) => [[onColor(x.db.theme.p, x.db.theme.ink), x.db.theme.p, 'Button label on primary']],
    fields: () => [F.text('Headline', 'head'), F.text('Subtext', 'sub'), F.seg('Order is', 'where', [['pickup', 'Pickup'], ['table', 'Served'], ['delivery', 'Delivered']]), F.head('NOTIFY THROUGH'), F.toggle('Ready screen on phone', 'c_page'), F.toggle('Push notification', 'c_push'), F.toggle('WhatsApp (WABA)', 'c_wa'), F.toggle('Queue / customer display', 'c_disp'), F.toggle('Sound + vibrate on phone', 'c_vibe'), F.head('AFTER'), F.seg('Main action', 'cta', [['rate', 'Rate'], ['reorder', 'Reorder'], ['share', 'Share']]), F.toggle('Confetti', 'confetti'), F.text('Message 1 hour later', 'later')] },
  { id: 'board', group: 'CUSTOMER SCREENS', name: 'Menu board (TV)', icon: 'tv', plan: 'pro', desc: 'Digital menu boards for TVs above the counter. Prices and sold-out items update live.', Preview: Board, wide: true,
    def: { layout: '3col', theme: 'dark', rotate: true, sold: 'strike', promo: true },
    pairs: (v, x) => { const t = x.db.theme; const bg = v.theme === 'dark' ? t.ink : v.theme === 'brand' ? t.p : t.paper; return [[v.theme === 'light' ? t.ink : onColor(bg, t.ink), bg, 'Menu text on board']]; },
    fields: () => [F.seg('Layout', 'layout', [['3col', '3 columns'], ['2col', '2 + promo'], ['hero', 'Hero item']]), F.seg('Theme', 'theme', [['dark', 'Dark'], ['brand', 'Brand'], ['light', 'Light']]), F.toggle('Rotate categories every 15s', 'rotate'), F.seg('Sold-out items', 'sold', [['strike', 'Strike'], ['hide', 'Hide'], ['badge', 'Badge']]), F.toggle('Promo strip', 'promo')] },
  { id: 'queue', group: 'CUSTOMER SCREENS', name: 'Queue & pickup screen', icon: 'list-ordered', plan: 'free', desc: 'Shows preparing and ready numbers on a TV near the pickup counter.', Preview: Queue, wide: true,
    def: { names: false, sound: true, ad: true, theme: 'dark' },
    fields: () => [F.toggle('Show first names', 'names'), F.toggle('Chime when a number is ready', 'sound'), F.toggle('Promo slot', 'ad'), F.seg('Theme', 'theme', [['dark', 'Dark'], ['brand', 'Brand']])] },
  { id: 'qrpay', group: 'CUSTOMER SCREENS', name: 'QRIS payment on phone', icon: 'qr-code', plan: 'free', desc: 'The payment page guests see after checking out from the QR menu.', Preview: QrPay,
    def: { timer: '5', save: true, brand: true },
    fields: () => [F.seg('QR valid for', 'timer', [['5', '5 min'], ['15', '15 min'], ['30', '30 min']]), F.toggle('Save QR to gallery button', 'save'), F.toggle('Brand header', 'brand'), F.note('The QRIS mark, amount and confirmation step are locked.')] },
  { id: 'split', group: 'CUSTOMER SCREENS', name: 'Split bill from phone', icon: 'split', plan: 'pro', desc: 'Each guest at the table scans and pays their own items or share.', Preview: Split,
    def: { mode: 'items', tip: true }, fields: () => [F.seg('Split by', 'mode', [['items', 'Items'], ['even', 'Evenly'], ['amount', 'Amount']]), F.toggle('Ask for tip', 'tip')] },
  { id: 'track', group: 'CUSTOMER SCREENS', name: 'Delivery tracking', icon: 'bike', plan: 'free', desc: 'Live tracking page sent by WhatsApp for delivery orders.', Preview: Track,
    def: { stage: 'auto', map: true, driver: true }, fields: () => [F.seg('Show stage', 'stage', [auto, ['0', 'Confirmed'], ['1', 'Cooking'], ['2', 'On the way'], ['3', 'Arrived']]), F.toggle('Live map', 'map'), F.toggle('Rider name & call', 'driver')] },
  { id: 'closed', group: 'CUSTOMER SCREENS', name: 'Closed, paused & sold out', icon: 'store', plan: 'free', desc: 'What guests see when the store is closed, ordering is paused or an item runs out.', Preview: Closed,
    def: { state: 'closed', msg: '', pre: true }, fields: () => [F.seg('State', 'state', [['closed', 'Closed'], ['busy', 'Paused'], ['soldout', 'Sold out']]), F.text('Closed message', 'msg', 'We open again at opening time'), F.toggle('Allow pre-order for later', 'pre')] },
];
