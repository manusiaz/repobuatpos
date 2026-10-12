'use client';
import { productImage } from '../../ui/kit.tsx';
// Register (layout A): search + category chips + product grid, cart on the right with the 72px Charge.
// Below 1024px (layout B) the cart becomes a bottom order bar that opens the cart as a sheet.
import { useEffect, useMemo, useRef, useState } from 'react';
import { addLine, clearOrder, patchOrder, priceAt, sendToKitchen, setQty } from '../../data/actions.ts';
import { enqueue } from '../../data/actions/pos.ts';
import { findByCode, useWedgeScanner } from '../../devices/scanner.ts';
import { playSfx } from '../../ui/sound.ts';
import { flashPrice } from '../../domain/promo.ts';
import { lineTotal } from '../../domain/order.ts';
import { balance, tierOf } from '../../domain/loyalty.ts';
import { idr } from '../../domain/money.ts';
import { Badge, Icon, Seg, Sheet, Status, toast, hhmm } from '../../ui/kit.tsx';
import type { Order, OrderLine } from '../../data/schema.ts';
import { P, paidOf, picNow, uiGet, uiSet, usePos, useApproval, usePerm, waitingFor, warnStyle, itemsOf } from './shared.tsx';

export function Register() {
  const { db, outletId, cur, me, session, ensureOrder, go, route } = usePos();
  const [cat, setCat] = useState<string>(() => uiGet('cat', 'all'));
  const [q, setQ] = useState(''), [cartOpen, setCartOpen] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  const products = useMemo(() => db.products.filter(p => p.status === 'live' && db.outletProducts.some(x => x.productId === p.id && x.outletId === outletId && !x.hidden)), [db.products, db.outletProducts, outletId]);
  const list = products.filter(p => (cat === 'all' || p.categoryId === cat) && (!q || (p.name + ' ' + p.sku).toLowerCase().includes(q.toLowerCase())));
  const counts: Record<string, number> = {}; cur?.lines.forEach(l => { counts[l.productId] = (counts[l.productId] ?? 0) + l.qty; });
  const pic = picNow(db, outletId);

  const tap = (id: string) => {
    const p = db.products.find(x => x.id === id)!;
    if (db.outletProducts.find(x => x.productId === id && x.outletId === outletId)?.is86) return;
    if (p.modifierGroupIds.length) return go(P('product-options-sheet', { p: id }));
    addLine(ensureOrder(), id, [], 1, '', me.id); enqueue('order.line_added');
  };
  // a USB/Bluetooth barcode scanner types fast and ends with Enter: add the product straight away
  useWedgeScanner(code => { const p = findByCode(db, code); if (p && products.includes(p)) { playSfx(db, 'sfx-scan'); tap(p.id); } else toast(`${code} · not on this outlet's menu`); }, { enabled: !route.s });
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (route.s) return; // a sheet owns the keyboard
      const typing = (e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA';
      if (e.key === '/' && !typing) { e.preventDefault(); search.current?.focus(); }
      if (e.key === 'Enter' && !typing && cur?.lines.length) go(P('payment-method-picker'));
    };
    addEventListener('keydown', k); return () => removeEventListener('keydown', k);
  }, [cur, go, route.s]);

  return <div className="pos-reg">
    <section className="pos-menu" aria-label="Menu">
      <div className="row wrap" style={{ gap: 10 }}>
        <div className="grow row" style={{ minWidth: 220, position: 'relative' }}>
          <Icon name="search" size={18} style={{ position: 'absolute', left: 14, color: 'var(--fg-3)' }} />
          <input id="pos-search" ref={search} className="search" style={{ height: 48, paddingLeft: 40, fontSize: 16 }} placeholder="Search menu or scan barcode  ( / )" value={q} aria-label="Search menu or scan barcode"
            onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { const hit = products.find(p => p.sku.toLowerCase() === q.trim().toLowerCase()) ?? (list.length === 1 ? list[0] : undefined); if (hit) { tap(hit.id); setQ(''); } } }} />
        </div>
        <span className="row muted hide-sm" style={{ fontSize: 13 }}><Icon name="user" size={16} />{me.name}{session ? ' · since ' + hhmm(session.openedAt) : ''}{pic ? <> · <b style={{ color: 'var(--fg-1)' }}>PIC {pic.name}</b></> : null}</span>
      </div>
      <div className="row" style={{ overflowX: 'auto', paddingBottom: 2, flex: 'none' }} role="group" aria-label="Categories">
        {[{ id: 'all', name: 'All' }, ...db.categories].map(c => <button key={c.id} className="chip" style={{ height: 44 }} aria-pressed={cat === c.id} onClick={() => { setCat(c.id); uiSet('cat', c.id); }}>{c.name}</button>)}
      </div>
      {list.length === 0 ? <div className="empty"><Icon name="search-x" size={32} /><b>No product matches “{q}”</b><span>Try the name or the SKU (KB-001).</span></div> :
        <div className="pos-grid">
          {list.map(p => {
            const op = db.outletProducts.find(x => x.productId === p.id && x.outletId === outletId);
            const sold = !!op?.is86, base = priceAt(db, p, outletId), flash = flashPrice(db.promos, p.id), c = counts[p.id] ?? 0;
            return <button key={p.id} className="pos-tile" disabled={sold} aria-disabled={sold} onClick={() => tap(p.id)} style={{ opacity: sold ? .45 : 1, cursor: sold ? 'not-allowed' : 'pointer', boxShadow: c ? '0 0 0 2px var(--accent)' : undefined }}
              aria-label={`${p.name}, ${idr(flash ?? base)}${sold ? ', sold out' : ''}${c ? `, ${c} in order` : ''}`}>
              <span className="pos-ph" style={{ background: productImage(p) }}>{sold && <span className="badge b-danger" style={{ position: 'absolute', left: 8, top: 8 }}>Sold out</span>}{flash != null && !sold && <span className="badge b-accent" style={{ position: 'absolute', left: 8, top: 8 }}>Flash</span>}</span>
              <span className="stack" style={{ gap: 2, padding: '8px 10px 10px', textAlign: 'left' }}>
                <span style={{ fontWeight: 600, fontSize: 14, lineHeight: 1.25 }}>{p.name}</span>
                <span className="row" style={{ gap: 6 }}><b className="num" style={{ fontSize: 15 }}>{idr(flash ?? base)}</b>{flash != null && <s className="faint" style={{ fontSize: 13 }}>{idr(base)}</s>}</span>
              </span>
              {c > 0 && <span className="pos-count num">{c}</span>}
            </button>;
          })}
        </div>}
      <div className="pos-bar">
        <button className="btn btn-lg pos-view" onClick={() => setCartOpen(true)} disabled={!cur?.lines.length}>
          <Icon name="shopping-basket" /><span>{cur?.lines.length ? `Order · ${itemsOf(cur)}` : 'No items'}</span></button>
        <button className="btn btn-primary btn-pay" disabled={!cur?.lines.length} onClick={() => go(P('payment-method-picker'))}>Charge {idr(cur ? cur.total - paidOf(db, cur.id) : 0)}</button>
      </div>
    </section>
    <aside className="pos-cart" aria-label="Current order"><Cart /></aside>
    <Sheet open={cartOpen} onClose={() => setCartOpen(false)} side="bottom" title={cur ? 'Order ' + cur.no : 'Order'}><Cart compact /></Sheet>
  </div>;
}

const MORE: [string, string, string][] = [['item-note-and-kitchen-note', 'Notes', 'notebook-pen'], ['guest-count-and-service-charge', 'Guests', 'users'], ['move-table', 'Move table', 'move'],
  ['merge-tables', 'Merge', 'merge'], ['split-order-to-new-bill', 'Split bill', 'split'], ['course-firing-send-to-kitchen', 'Courses', 'chef-hat'], ['reprint-kitchen-ticket', 'Reprint ticket', 'printer'],
  ['redeem-points', 'Redeem beans', 'gift'], ['gift-card-deposit-balance', 'Deposit', 'wallet-cards'], ['barcode-scan-and-quick-add', 'Scan', 'scan-barcode'], ['open-item-custom-price', 'Open item', 'square-pen'],
  ['weighed-items', 'Weighed', 'scale'], ['order-type-and-channel', 'Order type', 'store'], ['change-price', 'Change price', 'tag']];

export function Cart({ compact }: { compact?: boolean }) {
  const { db, cur, me, outletId, go, ensureOrder } = usePos();
  const can = usePerm(), flow = useApproval();
  const [sel, setSel] = useState<string | null>(null), [more, setMore] = useState(false);
  const out = db.outlets.find(o => o.id === outletId)!;
  const cust = db.customers.find(c => c.id === cur?.customerId);
  const empty = !cur?.lines.length, paid = cur ? paidOf(db, cur.id) : 0, due = cur ? cur.total - paid : 0;
  const unfired = cur?.lines.filter(l => !l.fired).length ?? 0;
  const promo = cur?.promoIds.map(id => db.promos.find(p => p.id === id)?.name).filter(Boolean).join(', ');
  const waiting = cur ? waitingFor(db, cur.id) : [];

  const remove = (o: Order, l: OrderLine) => {
    if (!l.fired) return setQty(o.id, l.id, 0, me.id);
    const amount = lineTotal({ unitPrice: l.unitPrice, flashPrice: l.flashPrice, modifiers: l.mods.map(m => m.price), qty: l.qty, discountPct: l.discountPct });
    flow.run({ action: 'Void item', type: 'void', amount, subjectId: o.id, payload: { lineId: l.id }, title: `Void ${l.qty}× ${l.name} · ${o.no}`, note: 'Already sent to kitchen',
      direct: () => patchOrder(o.id, { lines: o.lines.filter(x => x.id !== l.id) }, me.id), done: () => toast('Item voided') });
  };
  const fire = () => { if (!cur || !unfired) return; sendToKitchen(cur.id, me.id); enqueue('order.sent'); toast(`Sent ${unfired} item${unfired > 1 ? 's' : ''} to Kitchen & Bar`); };

  return <div className="stack" style={{ height: '100%', gap: 0, position: 'relative' }}>
    <div className="stack sm" style={{ padding: compact ? 0 : '16px 16px 12px', borderBottom: '1px solid var(--border)', paddingBottom: 12 }}>
      {!compact && <div className="row between"><h2 style={{ fontSize: 20 }}>{cur ? 'Order ' + cur.no : 'New order'}</h2>
        <button className="btn btn-ghost btn-sm" disabled={!unfired} onClick={() => cur && clearOrder(cur.id, me.id)}>Clear</button></div>}
      <Seg label="Order type" value={cur?.type ?? 'dine'} options={[['dine', 'Dine-in'], ['take', 'Takeaway'], ['delivery', 'Delivery']] as const}
        onChange={v => patchOrder(ensureOrder(), { type: v, table: v === 'dine' ? cur?.table ?? null : null }, me.id)} />
      <div className="row wrap" style={{ gap: 6 }}>
        {(cur?.type ?? 'dine') === 'dine' && <button className="btn btn-sm" onClick={() => go(P('table-picker'))}><Icon name="armchair" size={16} />{cur?.table ? 'Table ' + cur.table : 'Pick table'}</button>}
        {(cur?.type ?? 'dine') === 'dine' && <button className="btn btn-sm" onClick={() => go(P('guest-count-and-service-charge'))}><Icon name="users" size={16} />{cur?.guests ?? 1} pax</button>}
        <button className="btn btn-sm grow" onClick={() => go(P('customer-lookup-and-points'))} style={cust ? { background: 'var(--accent-soft)', borderColor: 'var(--accent)', justifyContent: 'flex-start' } : { justifyContent: 'flex-start' }}>
          <Icon name={cust ? 'user-check' : 'user-plus'} size={16} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{cust ? `${cust.name} · ${tierOf(db.ledger, cust.id).name} · ${balance(db.ledger, cust.id).toLocaleString('en-US')} beans` : 'Add customer'}</span></button>
      </div>
      {waiting.map(a => <div key={a.id} className="banner b-warning" style={{ padding: '8px 12px' }}><Icon name="hourglass" size={18} /><span className="grow">{a.title} · waiting for {a.level.toUpperCase()}</span>
        <button className="btn btn-sm" onClick={() => flow.resume(a.id, a.title, a.level)}>Enter PIN</button></div>)}
    </div>
    <div className="grow" style={{ overflowY: 'auto', padding: compact ? '8px 0' : '8px 16px' }}>
      {empty ? <div className="empty" style={{ padding: '40px 8px' }}><Icon name="shopping-basket" size={32} /><span>Tap a product to start an order.</span>
        <span className="faint" style={{ fontSize: 13 }}>Press / to search, Enter to charge.</span></div> :
        cur!.lines.map(l => {
          const t = lineTotal({ unitPrice: l.unitPrice, flashPrice: l.flashPrice, modifiers: l.mods.map(m => m.price), qty: l.qty, discountPct: l.discountPct });
          const open = sel === l.id;
          return <div key={l.id} style={{ borderBottom: '1px solid var(--border)', padding: '10px 0' }}>
            <div className="row" style={{ alignItems: 'flex-start' }}>
              <button className="grow stack" style={{ gap: 2, background: 'none', border: 0, padding: 0, textAlign: 'left', cursor: 'pointer', minHeight: 44 }} onClick={() => setSel(open ? null : l.id)} aria-expanded={open}>
                <b style={{ fontSize: 15 }}>{l.name}</b>
                {(l.mods.length > 0 || l.note) && <span className="muted" style={{ fontSize: 13 }}>{[...l.mods.map(m => m.name), l.note && '“' + l.note + '”'].filter(Boolean).join(' · ')}</span>}
                <span className="row wrap" style={{ gap: 4 }}>
                  <span className="faint" style={{ fontSize: 13 }}>@ {idr((l.flashPrice ?? l.unitPrice) + l.mods.reduce((a, m) => a + m.price, 0))}</span>
                  {l.flashPrice != null && <Badge tone="accent">Flash</Badge>}{l.discountPct > 0 && <Badge tone="success">−{l.discountPct}%</Badge>}{l.fired && <Status s={l.kds === 'new' ? 'sent' : l.kds === 'cooking' ? 'cooking' : 'ready'} />}
                </span>
              </button>
              <div className="stack" style={{ alignItems: 'flex-end', gap: 4 }}>
                <b className="num">{idr(t)}</b>
                <div className="row" style={{ gap: 4 }}>
                  <button className="btn icon-btn" style={{ width: 40, height: 40, ...warnStyle(l.fired ? can('Void item') : 'y') }} aria-label={l.fired ? 'Void item' : 'Less'} onClick={() => l.qty > 1 && !l.fired ? setQty(cur!.id, l.id, l.qty - 1, me.id) : remove(cur!, l)}><Icon name={l.qty > 1 && !l.fired ? 'minus' : 'trash-2'} size={18} /></button>
                  <b className="num" style={{ minWidth: 22, textAlign: 'center' }}>{l.qty}</b>
                  <button className="btn icon-btn" style={{ width: 40, height: 40 }} aria-label="More" disabled={l.fired} onClick={() => setQty(cur!.id, l.id, l.qty + 1, me.id)}><Icon name="plus" size={18} /></button>
                </div>
              </div>
            </div>
            {open && <div className="row wrap" style={{ gap: 6, marginTop: 8 }}>
              <button className="btn btn-sm" onClick={() => go(P('item-note-and-kitchen-note', { line: l.id }))}><Icon name="notebook-pen" size={16} />Note</button>
              <button className="btn btn-sm" style={warnStyle(can('Apply discount'))} onClick={() => go(P('item-discount', { line: l.id }))}><Icon name="percent" size={16} />Discount</button>
              <button className="btn btn-sm" onClick={() => go(P('change-price', { line: l.id }))}><Icon name="tag" size={16} />Price</button>
              <button className="btn btn-sm btn-danger" style={warnStyle(l.fired ? can('Void item') : 'y')} onClick={() => remove(cur!, l)}><Icon name="trash-2" size={16} />{l.fired ? 'Void' : 'Remove'}</button>
            </div>}
          </div>;
        })}
    </div>
    <div className="stack sm" style={{ padding: compact ? '12px 0 0' : '12px 16px', borderTop: '1px solid var(--border)', paddingBottom: compact ? 0 : 76 }}>
      <div className="row" style={{ gap: 6 }}>
        <button className="btn btn-sm grow" style={warnStyle(can('Apply discount'))} disabled={empty} onClick={() => go(P('order-discount'))}>{cur?.discountPct ? `Discount ${cur.discountPct}%` : 'Discount'}</button>
        <button className="btn btn-sm grow" disabled={empty} onClick={() => go(P('apply-promo-voucher'))}>{cur?.promoIds.length ? 'Voucher on' : 'Voucher'}</button>
        <button className="btn btn-sm grow" disabled={empty} onClick={() => go(P('hold-order'))}>Save bill</button>
        <button className="btn btn-sm grow" disabled={!unfired} onClick={fire}>To kitchen</button>
        <button className="btn btn-sm icon-btn" style={{ width: 34 }} aria-label="More order actions" aria-expanded={more} onClick={() => setMore(!more)}><Icon name="ellipsis" size={18} /></button>
      </div>
      {more && <div className="grid" style={{ ['--min' as string]: '96px', gap: 6 }}>{MORE.map(([slug, l, ic]) =>
        <button key={slug} className="btn btn-sm" style={{ height: 44, flexDirection: 'column', gap: 0, fontSize: 13 }} onClick={() => go(P(slug))}><Icon name={ic} size={16} />{l}</button>)}</div>}
      <div className="stack" style={{ gap: 2 }}>
        <Line l={`Subtotal · ${cur ? itemsOf(cur) : 0} items`} v={idr(cur?.subtotal ?? 0)} />
        {!!cur?.discount && <Line l={promo || `Discount ${cur.discountPct}%`} v={'− ' + idr(cur.discount)} tone="var(--success-fg)" />}
        {!!cur?.service && <Line l={`Service ${out.serviceBps / 100}%`} v={idr(cur.service)} />}
        <Line l={`PB1 ${out.taxBps / 100}%${out.taxInclusive ? ' (included)' : ''}`} v={idr(cur?.tax ?? 0)} />
        {paid > 0 && <Line l="Paid so far" v={'− ' + idr(paid)} tone="var(--success-fg)" />}
      </div>
      <button className="btn btn-primary btn-pay btn-block" style={{ justifyContent: 'space-between', padding: '0 22px' }} disabled={empty} onClick={() => go(P('payment-method-picker'))}>
        <span>Charge</span><span className="num">{idr(due)}</span></button>
    </div>
    {flow.node && (compact ? <div style={{ position: 'absolute', inset: 0, background: 'var(--bg-surface)', padding: 16, overflow: 'auto' }}>{flow.node}</div> : <Sheet open onClose={flow.close} side="center" title="Approval needed">{flow.node}</Sheet>)}
  </div>;
}
const Line = ({ l, v, tone }: { l: string; v: string; tone?: string }) => <div className="row between" style={{ fontSize: 14, color: tone ?? 'var(--fg-2)' }}><span>{l}</span><span className="num" style={{ color: tone ?? 'var(--fg-1)', fontWeight: 600 }}>{v}</span></div>;
