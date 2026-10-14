'use client';
// "+ New" action sheet (Manager Dashboard KINDS): each kind is its own URL; owner-gated kinds say "Send to owner".
import { useEffect, useState } from 'react';
import { useApp } from '../../app/context.tsx';
import { pagesOf } from '../../system/registry.ts';
import { requestApproval, saveProduct, stockEntry } from '../../data/actions.ts';
import { addReservation } from '../../data/actions/manager.ts';
import { uid } from '../../data/store.ts';
import { LIMITS } from '../../domain/approval.ts';
import { idr } from '../../domain/money.ts';
import { Field, Icon, Seg, Sheet, Toggle, toast } from '../../ui/kit.tsx';
import { tableNames } from '../../domain/tables.ts';

export type Kind = 'purchase' | 'repair' | 'product' | 'stock' | 'booking';
export const KIND_SLUG: Record<string, Kind> = { 'purchase-request': 'purchase', 'renovation-repair-request': 'repair', 'new-menu-item': 'product', 'stock-adjustment-and-waste-entry': 'stock', 'new-reservation': 'booking' };
const SLUG_OF = Object.fromEntries(Object.entries(KIND_SLUG).map(([s, k]) => [k, s])) as Record<Kind, string>;
const KINDS: [Kind, string, string, string, boolean][] = [
  ['purchase', 'Purchase request', 'Buy equipment, furniture or supplies', 'shopping-cart', true],
  ['repair', 'Renovation / repair', 'Fix or improve the outlet', 'hammer', true],
  ['product', 'New menu item', 'Outlet-only item; owner approves', 'square-plus', true],
  ['stock', 'Stock adjustment & waste', 'Add or remove stock with a reason', 'boxes', false],
  ['booking', 'Reservation', 'Book a table for a guest', 'calendar-plus', false],
];
const pathOf = (slug: string) => pagesOf('manager').find(p => p.slug === slug)?.path ?? '/manager';
const num = (v: string) => Number(v.replace(/[^0-9.-]/g, '')) || 0;

/** Open on every create page; with no kind it shows the picker. */
export function NewSheet({ open, kind, scope }: { open: boolean; kind: Kind | null; scope: string[] }) {
  const { db, me, user, outletId, go } = useApp();
  const meId = me?.id ?? user.id;
  const [f, setF] = useState<Record<string, string>>({});
  const [promote, setPromote] = useState(false), [waste, setWaste] = useState<'adjust' | 'waste'>('adjust');
  const [tried, setTried] = useState(false);
  useEffect(() => { setF({}); setTried(false); setPromote(false); }, [kind]);
  const outlet = f.outlet || (scope.includes(outletId) ? outletId : scope[0]);
  const v = (k: string) => f[k] ?? '';
  const set = (k: string) => (e: { target: { value: string } }) => setF(x => ({ ...x, [k]: e.target.value }));
  const close = () => go('/manager');
  const K = KINDS.find(k => k[0] === kind);
  const need = (k: string) => tried && !v(k).trim() ? 'Required' : undefined;
  const outletField = scope.length > 1 && <Field label="Outlet"><select className="input" value={outlet} onChange={set('outlet')}>{scope.map(id => <option key={id} value={id}>{db.outlets.find(o => o.id === id)?.name}</option>)}</select></Field>;
  const done = (m: string) => { toast(m); setF({}); setTried(false); close(); };

  const submit = () => {
    setTried(true);
    if (kind === 'purchase' || kind === 'repair') {
      if (!v('item').trim() || !num(v('cost'))) return;
      const cost = num(v('cost'));
      const r = requestApproval({ type: 'asset', title: kind === 'purchase' ? `Purchase · ${v('item')}${v('qty') ? ' × ' + v('qty') : ''} · ${idr(cost)}` : `Repair · ${v('item')} · ${idr(cost)}`, amount: cost, requestedBy: meId, outletId: outlet,
        note: [v('sup'), v('when'), v('why')].filter(Boolean).join(' · '), payload: { kind, item: v('item'), qty: num(v('qty')) || undefined, supplier: v('sup') || undefined, when: v('when') || undefined } });
      return done(r.level === 'owner' ? 'Sent to owner · see Waiting for owner' : 'Sent for approval · you can’t approve your own request');
    }
    if (kind === 'product') {
      if (!v('item').trim() || !num(v('cost'))) return;
      const owner = user.role === 'owner';
      saveProduct({ id: uid('p'), name: v('item').trim(), categoryId: v('cat') || db.categories[0].id, basePrice: num(v('cost')), scope: owner ? 'global' : 'local', ownerOutletId: owner ? null : outlet,
        status: owner ? 'live' : 'pending_owner', hue: Math.floor(Math.random() * 360), sku: 'KB-L' + String(db.products.length + 1).padStart(3, '0'), desc: v('desc'), modifierGroupIds: [], promoteRequested: promote, cost: 0 }, meId);
      return done(owner ? 'Added to all outlets' : `Sent to owner · ${promote ? 'proposed for all outlets' : 'this outlet only'}`);
    }
    if (kind === 'stock') {
      if (!v('stock') || !num(v('qty')) || !v('why').trim()) return;
      const r = stockEntry(waste, outlet, v('stock'), num(v('qty')), v('why').trim(), meId);
      return done(`${waste === 'waste' ? 'Waste' : 'Adjustment'} sent · ${r.level === 'pic' ? 'a PIC' : r.level} signs; stock changes after approval`);
    }
    if (kind === 'booking') {
      if (!v('item').trim() || !v('when') || !v('table')) return;
      addReservation({ outletId: outlet, name: v('item').trim(), phone: v('phone'), at: new Date(v('when')).getTime(), guests: num(v('qty')) || 2, table: v('table'), deposit: num(v('dep')) }, meId);
      return done('Reservation booked · PIC notified');
    }
  };

  const ownerGated = kind === 'product' || ((kind === 'purchase' || kind === 'repair') && num(v('cost')) > LIMITS.manager);
  const tables = tableNames(db.outlets.find(o => o.id === outlet));
  return <Sheet open={open} onClose={close} title={K ? K[1] : 'What do you want to add?'} sub={K ? K[2] : 'Requests that need the owner go to Waiting for owner.'}
    footer={K ? <><button className="btn" onClick={() => go(pathOf('plus-new-action-sheet'))}>Back</button><button className="btn btn-primary" onClick={submit}>{ownerGated && user.role !== 'owner' ? 'Send to owner' : kind === 'booking' ? 'Book table' : 'Send for approval'}</button></> : undefined}>
    {!K ? <div className="stack sm">{KINDS.map(([k, l, d, ic, owner]) => <button key={k} className="card tight row" style={{ cursor: 'pointer', textAlign: 'left', minHeight: 64 }} onClick={() => go(pathOf(SLUG_OF[k]))}>
      <span style={{ width: 40, height: 40, borderRadius: 12, display: 'grid', placeItems: 'center', background: owner ? 'var(--info-soft)' : 'var(--success-soft)', color: owner ? 'var(--info-fg)' : 'var(--success-fg)', flex: 'none' }}><Icon name={ic} /></span>
      <span className="grow"><b>{l}</b><br /><span className="muted" style={{ fontSize: 13 }}>{d}</span></span>
      <span className={'badge ' + (owner ? 'b-info' : 'b-success')}>{owner ? 'Owner approves' : k === 'booking' ? 'Saved now' : 'Signed by PIC or you'}</span></button>)}</div>
    : <div className="stack">
      {(kind === 'purchase' || kind === 'repair') && <>
        <Field label={kind === 'purchase' ? 'What to buy' : 'What needs work'} error={need('item')}><input className="input" value={v('item')} onChange={set('item')} placeholder={kind === 'purchase' ? '6 terrace tables + 24 chairs' : 'Bar counter repair and new lighting'} /></Field>
        {kind === 'purchase' && <Field label="Quantity" optional><input className="input" inputMode="numeric" value={v('qty')} onChange={set('qty')} placeholder="6" /></Field>}
        <Field label="Estimated cost (IDR)" error={tried && !num(v('cost')) ? 'Required' : undefined} hint={num(v('cost')) ? idr(num(v('cost'))) : undefined}><input className="input" inputMode="numeric" value={v('cost')} onChange={set('cost')} placeholder="18600000" /></Field>
        {kind === 'purchase' ? <Field label="Supplier" optional><input className="input" value={v('sup')} onChange={set('sup')} placeholder="CV Meja Jati · 3 quotes attached" /></Field>
          : <Field label="When" optional><input className="input" value={v('when')} onChange={set('when')} placeholder="Next Monday, closed day" /></Field>}
        {outletField}
      </>}
      {kind === 'product' && <>
        <Field label="Name" error={need('item')}><input className="input" value={v('item')} onChange={set('item')} placeholder="Kopi Pandan Float" /></Field>
        <Field label="Category"><select className="input" value={v('cat') || db.categories[0].id} onChange={set('cat')}>{db.categories.map(k => <option key={k.id} value={k.id}>{k.name}</option>)}</select></Field>
        <Field label="Price (IDR)" error={tried && !num(v('cost')) ? 'Required' : undefined}><input className="input" inputMode="numeric" value={v('cost')} onChange={set('cost')} placeholder="35000" /></Field>
        <Field label="Description" optional><textarea className="input" value={v('desc')} onChange={set('desc')} /></Field>
        {outletField}
        {user.role !== 'owner' && <label className="row between card tight" style={{ cursor: 'pointer' }}><span><b>Propose for all outlets</b><br /><span className="muted" style={{ fontSize: 13 }}>The owner decides to keep it local or make it global.</span></span><Toggle on={promote} onChange={setPromote} label="Propose for all outlets" /></label>}
        <div className="banner b-info">{user.role === 'owner' ? 'Owner items go to all outlets.' : `This outlet only. It stays hidden until the owner approves.`}</div>
      </>}
      {kind === 'stock' && <>
        <Seg value={waste} onChange={setWaste} options={[['adjust', 'Stock adjustment'], ['waste', 'Waste / damaged']] as const} label="Kind" />
        <Field label="Item" error={tried && !v('stock') ? 'Required' : undefined}><select className="input" value={v('stock')} onChange={set('stock')}><option value="">Pick an item</option>{db.stockItems.map(s => <option key={s.id} value={s.id}>{s.name} · {s.unit}</option>)}</select></Field>
        <Field label={waste === 'waste' ? 'Quantity wasted' : 'Change (+ or −)'} error={tried && !num(v('qty')) ? 'Required' : undefined}><input className="input" inputMode="decimal" value={v('qty')} onChange={set('qty')} placeholder={waste === 'waste' ? '4' : '+12'} /></Field>
        <Field label="Reason" error={need('why')}><input className="input" value={v('why')} onChange={set('why')} placeholder={waste === 'waste' ? 'Freezer failed overnight' : 'Delivery received without PO'} /></Field>
        {outletField}
        <div className="banner b-info">Stock changes only after approval, as a stock movement with your name and the reason. Up to {idr(LIMITS.picVariance)} a PIC signs; above that the manager or owner.</div>
      </>}
      {kind === 'booking' && <>
        <Field label="Guest name" error={need('item')}><input className="input" value={v('item')} onChange={set('item')} placeholder="Pak Hendra" /></Field>
        <Field label="Phone" optional><input className="input" inputMode="tel" value={v('phone')} onChange={set('phone')} placeholder="0813 5656 7878" /></Field>
        <div className="row wrap" style={{ alignItems: 'flex-start' }}>
          <div className="grow"><Field label="Date & time" error={need('when')}><input className="input" type="datetime-local" value={v('when')} onChange={set('when')} /></Field></div>
          <div style={{ width: 110 }}><Field label="Guests"><input className="input" inputMode="numeric" value={v('qty')} onChange={set('qty')} placeholder="2" /></Field></div>
        </div>
        {outletField}
        <Field label="Table" error={need('table')}><select className="input" value={v('table')} onChange={set('table')}><option value="">Pick a table</option>{tables.map(t => <option key={t}>{t}</option>)}</select></Field>
        <Field label="Deposit (IDR)" optional><input className="input" inputMode="numeric" value={v('dep')} onChange={set('dep')} placeholder="0" /></Field>
      </>}
    </div>}
  </Sheet>;
}
