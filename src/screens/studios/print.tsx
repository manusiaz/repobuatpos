'use client';
import { same } from './same.tsx';
import { TOOL_DEFAULTS } from '../../system/tools.ts';
// Print studio: labels, tickets, coupons, letterhead, printed menu, receipts. Every preview prints a real order / PO / catalog.
import { idr } from '../../domain/money.ts';
import { Empty, hhmm } from '../../ui/kit.tsx';
import { Caption, F, first, latest, Line, modsText, outletName, Paper, Rule, Stage, themeColor, themeSwatches, onColor, customerOf, type PP, type Tool } from './core.tsx';

const NoOrder = () => <Empty icon="receipt" title="No orders yet at this outlet">The preview prints the latest real order. Ring one up on the POS and it shows here.</Empty>;

function Cup({ v, x }: PP) {
  // A drink gets a label when its recipe uses a cup.
  const cupped = new Set(x.db.recipes.filter(r => r.stockItemId === 'cups').map(r => r.productId));
  const o = latest(x.db, x.outletId, o => o.lines.some(l => cupped.has(l.productId)));
  if (!o) return <NoOrder />;
  const cups = o.lines.filter(l => cupped.has(l.productId)).flatMap(l => Array.from({ length: l.qty }, () => l));
  const who = first(customerOf(x.db, o)?.name ?? (o.table ? 'Table ' + o.table : 'Guest'));
  const w = v.size === '40x30' ? 200 : v.size === '50x30' ? 250 : 290;
  const foot = String(v.foot).replace('{name}', who).replace('{table}', o.table ?? '-').replace('{queue}', o.no);
  return <Stage>
    <div className="row wrap" style={{ justifyContent: 'center', gap: 16 }}>{cups.slice(0, 6).map((l, i) =>
      <Paper key={i} w={w} style={{ minHeight: v.size === '58' ? 180 : 150, borderRadius: 6, padding: '10px 12px', gap: 4 }}>
        <div className="row" style={{ gap: 6 }}>
          {v.logo && <span style={{ width: 22, height: 22, borderRadius: 5, background: 'var(--ink-950)', color: 'var(--ink-0)', display: 'grid', placeItems: 'center', fontSize: 9, fontWeight: 800 }}>{x.db.tenant.name.split(' ').map(w => w[0]).join('').slice(0, 2)}</span>}
          <b className="grow" style={{ fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.name}</b>
          {v.queue && <span style={{ padding: '0 6px', height: 22, borderRadius: 5, border: '1.5px solid currentColor', display: 'grid', placeItems: 'center', fontWeight: 800 }}>{o.no}</span>}
        </div>
        {v.mods && <span style={{ fontSize: 11 }}>{modsText(l) || 'No modifiers'}{l.note && ' · ' + l.note}</span>}
        {v.name && <span style={{ fontSize: 15, fontWeight: 800, marginTop: 'auto' }}>{who}</span>}
        <span style={{ fontSize: 10, borderTop: '1px dashed currentColor', paddingTop: 4 }}>{foot} · {i + 1}/{cups.length}</span>
      </Paper>)}</div>
    <Caption>One label per cup. {cups.length} drink{cups.length === 1 ? '' : 's'} in order {o.no} at {outletName(x.db, o.outletId)}, {hhmm(o.createdAt)}.</Caption>
  </Stage>;
}

function Ticket({ v, x }: PP) {
  const st = v.station as 'bar' | 'kitchen' | 'pastry';
  const o = latest(x.db, x.outletId, o => o.lines.some(l => l.station === st));
  if (!o) return <Empty icon="chef-hat" title={`No ${st} items ordered yet`}>Pick another station or ring up an order.</Empty>;
  const fs = { m: 14, l: 17, xl: 21 }[v.fs as 'm'] ?? 17;
  const cashier = x.db.employees.find(e => e.id === o.cashierId)?.name ?? o.source.toUpperCase();
  return <Stage><div className="row wrap" style={{ gap: 16, justifyContent: 'center', alignItems: 'flex-start' }}>
    <Paper w={300} style={{ fontSize: 13, gap: 8 }}>
      <div className="row between"><b style={{ fontSize: v.table ? 34 : 16 }}>{o.table ?? (o.type === 'delivery' ? 'DLV' : 'TA')}</b><span style={{ textAlign: 'right' }}>{st.toUpperCase()}<br />{hhmm(o.createdAt)} · {cashier}</span></div>
      <Rule />
      {o.lines.filter(l => l.station === st).map(l => <div key={l.id} className="stack" style={{ gap: 4 }}>
        <b style={{ fontSize: fs }}>{l.qty} × {l.name}</b>
        {(l.mods.length > 0 || l.note) && <span style={{ alignSelf: 'flex-start', padding: '2px 6px', fontWeight: 700, background: v.notes ? 'var(--ink-950)' : 'transparent', color: v.notes ? 'var(--ink-0)' : 'inherit' }}>» {[modsText(l), l.note].filter(Boolean).join(', ')}</span>}
      </div>)}
      <Rule />
      <span>{o.type === 'dine' ? 'Dine-in' : o.type === 'take' ? 'Takeaway' : 'Delivery'} · {o.guests} pax · {o.no}</span>
      {v.cut && <span style={{ textAlign: 'center', fontSize: 11, opacity: .6 }}>— — — cut — — —</span>}
    </Paper>
    {v.dup && <div className="card tight stack sm" style={{ width: 220, borderStyle: 'dashed' }}><b>Expo copy</b><span className="muted" style={{ fontSize: 13 }}>All {o.lines.length} lines of {o.no} on one ticket, printed at the pass.</span></div>}
  </div>
    <Caption>Routing: {x.db.categories.map(c => `${c.name} → ${c.station}`).join(' · ')}</Caption>
  </Stage>;
}

function Coupon({ v, x }: PP) {
  const o = latest(x.db, x.outletId, o => o.status === 'paid');
  if (!o) return <NoOrder />;
  const until = new Date(Date.now() + Number(v.exp) * 864e5).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const prints = v.rule === 'every' || (v.rule === 'member' && !!o.customerId) || (v.rule === 'over' && o.total > 100000);
  return <Stage>
    <Paper w={300}>
      {o.lines.map(l => <Line key={l.id} l={`${l.qty}× ${l.name}`} r={(l.unitPrice * l.qty).toLocaleString('en-US')} />)}
      <div style={{ borderTop: '1px dashed currentColor', paddingTop: 6 }}><Line b l="TOTAL" r={o.total.toLocaleString('en-US')} /></div>
      {prints ? <div style={{ marginTop: 10, border: '2px dashed currentColor', padding: 12, display: 'flex', flexDirection: 'column', gap: 4, textAlign: 'center' }}>
        <b style={{ fontSize: 13 }}>{v.head}</b><b style={{ fontSize: 18, fontFamily: 'var(--font-display)' }}>{v.offer}</b>
        <span>Code <b>{v.code}-{o.no.replace(/\D/g, '').slice(-4)}</b></span><span>Valid until {until}</span><span>{v.min}</span>
        {v.bar && <span aria-hidden style={{ height: 36, marginTop: 4, background: 'repeating-linear-gradient(90deg,var(--ink-950) 0 2px,transparent 2px 4px,var(--ink-950) 4px 5px,transparent 5px 8px)' }} />}
      </div> : <span style={{ marginTop: 10, textAlign: 'center', opacity: .6 }}>No coupon on this receipt (rule not met)</span>}
    </Paper>
    <Caption>Receipt {o.no} · {idr(o.total)}. {{ every: 'Printed on every receipt', member: 'Printed for members only', over: 'Printed when the bill is over IDR 100,000' }[v.rule as 'every']}. Each code is unique and tracked in Promos & vouchers.</Caption>
  </Stage>;
}

function Letter({ v, x }: PP) {
  const po = x.db.pos.find(p => p.outletId === x.outletId) ?? x.db.pos[0];
  const ac = themeColor(x.db.theme, v.accent);
  if (!po) return <Empty icon="file-text" title="No purchase orders yet" />;
  const sup = x.db.suppliers.find(s => s.id === po.supplierId);
  const total = po.lines.reduce((a, l) => a + l.qty * l.price, 0);
  return <Stage><div style={{ width: 'min(460px,100%)', background: 'var(--ink-0)', color: 'var(--ink-950)', boxShadow: 'var(--shadow-e2)', padding: 24, display: 'flex', flexDirection: 'column', gap: 14, fontSize: 12 }}>
    <div style={{ display: 'flex', flexDirection: v.pos === 'center' ? 'column' : 'row', alignItems: v.pos === 'center' ? 'center' : 'flex-start', gap: 12, textAlign: v.pos === 'center' ? 'center' : 'left', borderBottom: `3px solid ${ac}`, paddingBottom: 12 }}>
      <span style={{ width: 44, height: 44, borderRadius: 10, background: ac, color: onColor(ac, x.db.theme.ink), display: 'grid', placeItems: 'center', fontWeight: 800, flex: 'none' }}>{x.db.tenant.name.split(' ').map(w => w[0]).join('')}</span>
      <div className="stack" style={{ gap: 2 }}><b style={{ fontSize: 15 }}>{v.co}</b><span>{v.addr}</span><span>NPWP {v.npwp}</span></div>
    </div>
    <div className="row between"><b style={{ fontSize: 16 }}>Purchase order {po.no}</b><span>{new Date(po.at).toLocaleDateString('en-GB')}</span></div>
    <span>To: {sup?.name} · {sup?.terms}</span>
    <table className="table" style={{ fontSize: 12 }}><thead><tr><th>Item</th><th className="r">Qty</th><th className="r">Amount</th></tr></thead>
      <tbody>{po.lines.map(l => { const s = x.db.stockItems.find(i => i.id === l.stockItemId); return <tr key={l.stockItemId}><td>{s?.name}</td><td className="r">{l.qty} {s?.unit}</td><td className="r">{idr(l.qty * l.price)}</td></tr>; })}</tbody></table>
    <Line b l="Total" r={idr(total)} />
    {v.sign && <div className="row between" style={{ marginTop: 16 }}>{['Prepared by', 'Approved by'].map(k => <div key={k} style={{ width: '44%', borderTop: '1px solid currentColor', paddingTop: 4, minHeight: 40 }}>{k}</div>)}</div>}
    <span style={{ textAlign: 'center', opacity: .7, borderTop: '1px solid var(--ink-200)', paddingTop: 8 }}>{v.foot}</span>
  </div><Caption>Shown on {po.no}. Applies to invoices, POs, transfer notes and every PDF exported from Reports.</Caption></Stage>;
}

function Receipt({ v, x }: PP) {
  const out = x.db.outlets.find(o => o.id === (v.outlet || x.outletId)) ?? x.db.outlets[0];
  const o = latest(x.db, out.id, o => o.status === 'paid');
  const wifi = `${x.db.tenant.name.replace(/\s/g, '').toUpperCase()}-${out.name.slice(0, 3).toUpperCase()}`;
  const h1 = v.inherit || !v.h1 ? `${x.db.tenant.name} ${out.name}` : v.h1, h2 = v.inherit || !v.h2 ? out.city : v.h2, wf = v.inherit || !v.wifi ? wifi : v.wifi;
  const pay = o && x.db.payments.find(p => p.orderId === o.id);
  return <Stage><Paper w={v.paper === '58' ? 230 : 300}>
    <div style={{ textAlign: 'center' }}><b style={{ fontSize: 14 }}>{h1}</b><br />{h2}</div><Rule dash />
    {o ? <>
      <Line l={`${o.no} · ${new Date(o.createdAt).toLocaleDateString('en-GB')} ${hhmm(o.createdAt)}`} />
      {o.lines.map(l => <Line key={l.id} l={`${l.qty}× ${l.name}`} r={(l.unitPrice * l.qty).toLocaleString('en-US')} />)}<Rule dash />
      <Line l="Subtotal" r={o.subtotal.toLocaleString('en-US')} />{o.discount > 0 && <Line l="Discount" r={'-' + o.discount.toLocaleString('en-US')} />}
      {o.service > 0 && <Line l={`Service ${out.serviceBps / 100}%`} r={o.service.toLocaleString('en-US')} />}
      <Line l={`PB1 ${out.taxBps / 100}%${out.taxInclusive ? ' (incl.)' : ''}`} r={o.tax.toLocaleString('en-US')} />
      <Line b l="TOTAL" r={o.total.toLocaleString('en-US')} />{pay && <Line l={pay.method.toUpperCase()} r={pay.ref} />}
    </> : <span>No paid orders at {out.name} yet.</span>}
    <Rule dash /><div style={{ textAlign: 'center' }}>{v.f1}<br />Wi-Fi {wf}</div>
  </Paper><Caption>{v.inherit ? `Inherited from brand · ${out.name}` : `Custom for ${out.name}`}. Tax and service follow the outlet settings ({out.taxInclusive ? 'tax-inclusive' : 'tax on top'}).</Caption></Stage>;
}

export const PRINT: Tool[] = [
  { id: 'cup', group: 'PRINT', name: 'Cup sticker & drink label', icon: 'cup-soda', desc: 'Labels printed per drink on a 40–58mm label printer, so baristas and customers can tell orders apart.', def: { ...TOOL_DEFAULTS.cup }, Preview: Cup,
    fields: () => [F.seg('Label size', 'size', [['40x30', '40×30'], ['50x30', '50×30'], ['58', '58 roll']]), F.toggle('Customer name', 'name'), F.toggle('Modifiers (sugar, ice, size)', 'mods'), F.toggle('Queue number', 'queue'), F.toggle('Logo', 'logo'), F.text('Footer line', 'foot'), F.note('Use {name}, {table} or {queue} as placeholders. Prints automatically when a drink is sent to the bar.')] },
  { id: 'kticket', group: 'PRINT', name: 'Kitchen ticket & stations', icon: 'chef-hat', desc: 'Layout of printed kitchen tickets and which items print at which station.', def: { ...TOOL_DEFAULTS.kticket }, Preview: Ticket,
    fields: () => [F.seg('Preview station', 'station', [['bar', 'Bar'], ['kitchen', 'Kitchen'], ['pastry', 'Pastry']]), F.seg('Item text size', 'fs', [['m', 'Medium'], ['l', 'Large'], ['xl', 'XL']]), F.toggle('Large table number', 'table'), F.toggle('Highlight notes (inverted)', 'notes'), F.toggle('Auto-cut per ticket', 'cut'), F.toggle('Print a copy for expo', 'dup'), F.note('Stations come from each category. Edit printers in Settings → Devices.')] },
  { id: 'coupon', group: 'PRINT', name: 'Coupon on receipt', icon: 'ticket-percent', desc: 'Prints a bounce-back coupon under the receipt to bring guests back.', def: { ...TOOL_DEFAULTS.coupon }, Preview: Coupon,
    fields: () => [F.text('Headline', 'head'), F.text('Offer', 'offer'), F.text('Code', 'code'), F.range('Valid for', 'exp', 1, 30, 1, ' days'), F.text('Condition', 'min'), F.seg('Print when', 'rule', [['every', 'Every receipt'], ['member', 'Members'], ['over', 'Over 100k']]), F.toggle('Barcode for scanning', 'bar')] },
  { id: 'letter', group: 'PRINT', name: 'Letterhead, invoices & PDF reports', icon: 'file-text', desc: 'Header and footer used on invoices, purchase orders and exported PDF reports.', def: { co: '', addr: '', npwp: '', pos: 'left', accent: 'primary', foot: 'Thank you for your business.', sign: true }, Preview: Letter,
    pairs: (v, x) => { const c = themeColor(x.db.theme, v.accent); return [[onColor(c, x.db.theme.ink), c, 'Logo initials on accent']]; },
    fields: (_, x) => [F.text('Company name', 'co'), F.text('Address', 'addr'), F.text('NPWP', 'npwp'), F.seg('Logo position', 'pos', [['left', 'Left'], ['center', 'Center']]), F.swatch('Accent', 'accent', themeSwatches(x.db.theme)), F.text('Footer', 'foot'), F.toggle('Signature & stamp area', 'sign')] },
  { id: 'pmenu', group: 'PRINT', name: 'Printed menu (PDF)', icon: 'book-open', desc: 'Generates a print-ready menu from your catalog, so prices are never out of date.', ...same('printable-menu-pdf-generator') },
  { id: 'rcpt', group: 'PRINT', name: 'Receipt template per outlet', icon: 'receipt', desc: 'Each outlet can override the header, footer and Wi-Fi on its receipts.', def: { outlet: '', paper: '80', h1: '', h2: '', f1: 'Terima kasih!', wifi: '', inherit: true }, Preview: Receipt,
    fields: (v, x) => [F.seg('Outlet', 'outlet', [['', 'Current'], ...x.db.outlets.map(o => [o.id, o.name] as [string, string])]), F.toggle('Inherit from brand receipt', 'inherit'), F.seg('Paper', 'paper', [['58', '58 mm'], ['80', '80 mm']]), ...(v.inherit ? [] : [F.text('Header line 1', 'h1'), F.text('Header line 2', 'h2'), F.text('Wi-Fi', 'wifi')]), F.text('Footer', 'f1'), F.note('Legal lines (NPWP, tax) are locked and always print.')] },
];
