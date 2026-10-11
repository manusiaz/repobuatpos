'use client';
// Menu Studio › Menu & products and › Per-outlet overrides. Writes go through the catalog actions:
// saveProduct (new items; manager items wait for the owner), requestPrice (owner direct, manager → approval),
// toggle86, plus studio patchProduct / setHidden / addCategory. Menu scope rules: src/domain/menu.ts.
import { useState } from 'react';
import { useApp } from '../../app/context.tsx';
import { Badge, Empty, Field, Icon, Sheet, Toggle, toast } from '../../ui/kit.tsx';
import { usePin } from '../../ui/PinSheet.tsx';
import { decide, priceAt, requestPrice, saveProduct, toggle86 } from '../../data/actions.ts';
import { addCategory, patchProduct, setHidden, type StudioProduct } from '../../data/actions/studio.ts';
import { LOCAL_PRICE_BAND, canDelete, localPriceAllowed, newItem } from '../../domain/menu.ts';
import { idr } from '../../domain/money.ts';
import type { Product } from '../../data/schema.ts';
import { Block, ImageSlot } from './Frame.tsx';
import { photoOf } from './guest.tsx';

const scopeLabel = (p: Product, outlets: { id: string; name: string }[]) => p.scope === 'global' ? 'All outlets' : (outlets.find(o => o.id === p.ownerOutletId)?.name ?? 'Outlet') + ' only';

export function ProductsPanel({ onPreview }: { onPreview: (id: string) => void }) {
  const { db, user, outletId } = useApp();
  const pin = usePin();
  const owner = user.role === 'owner';
  const [scope, setScope] = useState<string>('all'), [cat, setCat] = useState(''), [newCat, setNewCat] = useState('');
  const [edit, setEdit] = useState<StudioProduct | null>(null), [isNew, setIsNew] = useState(false), [price, setPrice] = useState(0), [promote, setPromote] = useState(false);
  const list = db.products.filter(p => p.status !== 'archived' && (!cat || p.categoryId === cat) && (scope === 'all' || db.outletProducts.some(x => x.productId === p.id && x.outletId === scope)));
  const mine = (p: Product) => owner || (p.scope === 'local' && p.ownerOutletId === user.outletId);
  const approvalOf = (p: Product) => db.approvals.find(a => a.type === 'local_item' && a.subjectId === p.id && a.status === 'waiting');

  const startNew = () => {
    try {
      const sc = newItem(owner ? 'owner' : 'manager', db.tenant.locks);
      const local = scope !== 'all' || sc.scope === 'local';
      setEdit({ id: 'p' + Date.now().toString(36), name: '', categoryId: cat || db.categories[0].id, basePrice: 25000, scope: local ? 'local' : 'global', ownerOutletId: local ? (owner ? (scope === 'all' ? outletId : scope) : user.outletId) : null, status: sc.status, hue: Math.floor(Math.random() * 360), sku: '', desc: '', modifierGroupIds: [], cost: 0 });
      setPrice(25000); setIsNew(true); setPromote(false);
    } catch (e) { toast((e as Error).message); }
  };
  const save = () => {
    if (!edit || !edit.name.trim()) return toast('Give the product a name');
    if (isNew) {
      saveProduct({ ...edit, basePrice: price, sku: 'KB-' + edit.id.slice(-4).toUpperCase(), cost: Math.round(price * 0.32), promoteRequested: promote || undefined } as Product, user.id);
      toast(owner ? `${edit.name} is live on ${edit.scope === 'global' ? 'every outlet' : scopeLabel(edit, db.outlets)}` : `${edit.name} sent to the owner`);
    } else {
      const { basePrice, ...rest } = edit; void basePrice;
      patchProduct(edit.id, rest, user.id);
      if (price !== db.products.find(p => p.id === edit.id)?.basePrice) { requestPrice(edit.id, price, user.id); toast(owner ? 'Saved · new price is live' : 'Saved · price change sent to the owner'); } else toast('Saved');
    }
    setEdit(null);
  };
  const decideLocal = (p: Product, verdict: 'approved' | 'rejected') => {
    const a = approvalOf(p); if (!a) return;
    pin.ask({ title: `${verdict === 'approved' ? 'Approve' : 'Reject'} · ${p.name}`, detail: a.title, verb: verdict === 'approved' ? 'Approve with your PIN' : 'Reject with your PIN', onOk: by => { const e = decide(a.id, by, verdict); toast(e ?? (verdict === 'approved' ? `${p.name} is live` : `${p.name} rejected`)); setEdit(null); } });
  };

  return <>
    {pin.sheet}
    <Block title="Scope">
      <div className="row wrap"><button className="chip" aria-pressed={scope === 'all'} onClick={() => setScope('all')}>All outlets</button>{db.outlets.map(o => <button key={o.id} className="chip" aria-pressed={scope === o.id} onClick={() => setScope(o.id)}>{o.name}</button>)}</div>
    </Block>
    <Block title="Categories" hint="Tap a category to filter. New categories go to the bar station; change stations in Products › Categories.">
      <div className="row wrap"><button className="chip" aria-pressed={!cat} onClick={() => setCat('')}>All</button>
        {db.categories.map(c => <button key={c.id} className="chip" aria-pressed={cat === c.id} onClick={() => setCat(c.id)}>{c.name} · {db.products.filter(p => p.categoryId === c.id && p.status !== 'archived').length}</button>)}</div>
      <div className="row"><input className="input" value={newCat} onChange={e => setNewCat(e.target.value)} placeholder="New category" aria-label="New category" /><button className="btn" disabled={!newCat.trim()} onClick={() => { setCat(addCategory(newCat.trim(), user.id)); setNewCat(''); }}>Add</button></div>
    </Block>
    <div className="row between"><span className="cap">{list.length} products</span><button className="btn btn-primary btn-sm" onClick={startNew}><Icon name="plus" size={14} />Add product</button></div>
    {!owner && <p className="faint" style={{ fontSize: 12 }}>Items you add are for {db.outlets.find(o => o.id === user.outletId)?.name} only and wait for the owner. Global items can be hidden or marked sold out here, not deleted.</p>}
    {list.length === 0 ? <Empty icon="utensils" title="No products here yet" action={<button className="btn btn-primary" onClick={startNew}>Add product</button>} /> :
      <div className="stack sm">{list.map(p => {
        const op = scope === 'all' ? null : db.outletProducts.find(x => x.productId === p.id && x.outletId === scope), sp = p as StudioProduct;
        return <div key={p.id} className="row" style={{ padding: 8, borderRadius: 14, border: '1px solid var(--border)', opacity: op?.hidden ? .55 : 1, alignItems: 'flex-start' }}>
          <button type="button" aria-label={'Preview ' + p.name} onClick={() => onPreview(p.id)} style={{ width: 56, height: 56, borderRadius: 12, border: 0, background: photoOf(p), flex: 'none', cursor: 'pointer' }} />
          <div className="grow stack" style={{ gap: 2 }}>
            <b style={{ fontSize: 14 }}>{p.name}</b>
            <span className="muted" style={{ fontSize: 12 }}>{db.categories.find(c => c.id === p.categoryId)?.name} · {idr(op ? priceAt(db, p, scope) : p.basePrice)}{op?.localPrice != null ? ' (local)' : ''}{!sp.photo ? ' · no photo' : ''}</span>
            <div className="row wrap" style={{ gap: 4 }}><Badge tone={p.scope === 'global' ? 'info' : 'warning'}>{scopeLabel(p, db.outlets)}</Badge>{p.status === 'pending_owner' && <Badge tone="warning" dot>Waiting for owner</Badge>}{op?.is86 && <Badge tone="danger">Sold out</Badge>}{op?.hidden && <Badge>Hidden</Badge>}</div>
          </div>
          <div className="stack sm" style={{ alignItems: 'flex-end' }}>
            <button className="btn btn-sm" onClick={() => { setEdit({ ...sp }); setPrice(p.basePrice); setIsNew(false); }}>{mine(p) ? 'Edit' : 'View'}</button>
            {op && <div className="row" style={{ gap: 4 }}>
              <button className="btn btn-ghost btn-sm" onClick={() => { toggle86(scope, p.id, user.id); }}>{op.is86 ? 'Back in stock' : 'Sold out'}</button>
              <button className="btn btn-ghost btn-sm" aria-label={op.hidden ? 'Show here' : 'Hide here'} onClick={() => setHidden(scope, p.id, !op.hidden, user.id)}><Icon name={op.hidden ? 'eye-off' : 'eye'} size={14} /></button></div>}
          </div>
        </div>;
      })}</div>}

    <Sheet open={!!edit} onClose={() => setEdit(null)} title={isNew ? 'Add product' : edit?.name ?? ''} sub={edit ? scopeLabel(edit, db.outlets) + (edit.status === 'pending_owner' ? ' · waiting for owner' : '') : ''}
      footer={edit && <>
        {!isNew && canDelete(edit, { role: user.role, outletId: user.outletId }) && <button className="btn btn-danger" onClick={() => { patchProduct(edit.id, { status: 'archived' }, user.id); toast(edit.scope === 'global' ? 'Removed from every outlet' : 'Archived'); setEdit(null); }}>{edit.scope === 'global' ? 'Delete everywhere' : 'Archive'}</button>}
        <span className="grow" />
        {owner && !isNew && approvalOf(edit) ? <><button className="btn" onClick={() => decideLocal(edit, 'rejected')}>Reject</button><button className="btn btn-success" onClick={() => decideLocal(edit, 'approved')}>Approve item</button></>
          : (isNew || mine(edit)) && <button className="btn btn-primary" onClick={save}>{isNew ? (owner ? 'Add product' : 'Send to owner') : 'Save'}</button>}
      </>}>
      {edit && <div className="stack">
        <ImageSlot label="Product photo" value={edit.photo ?? ''} ratio="1/1" maxW={800} disabled={!isNew && !mine(edit)} onChange={v => { setEdit({ ...edit, photo: v }); if (!isNew && mine(edit)) { patchProduct(edit.id, { photo: v }, user.id); toast(v ? 'Photo saved' : 'Photo removed'); } }} />
        <Field label="Name"><input className="input" value={edit.name} disabled={!isNew && !mine(edit)} onChange={e => setEdit({ ...edit, name: e.target.value })} /></Field>
        <Field label="Description" optional><textarea className="input" value={edit.desc} disabled={!isNew && !mine(edit)} onChange={e => setEdit({ ...edit, desc: e.target.value })} /></Field>
        <Field label="Category"><select className="input" value={edit.categoryId} disabled={!isNew && !mine(edit)} onChange={e => setEdit({ ...edit, categoryId: e.target.value })}>{db.categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
        <Field label="Base price (IDR)" hint={owner ? 'Live immediately' : 'Price changes need the owner'}><input className="input num" inputMode="numeric" value={price || ''} disabled={!isNew && !mine(edit)} onChange={e => setPrice(parseInt(e.target.value.replace(/\D/g, ''), 10) || 0)} /></Field>
        {isNew && owner && <Field label="Where"><select className="input" value={edit.scope === 'global' ? 'all' : edit.ownerOutletId ?? ''} onChange={e => setEdit({ ...edit, scope: e.target.value === 'all' ? 'global' : 'local', ownerOutletId: e.target.value === 'all' ? null : e.target.value })}>
          <option value="all">All outlets (global)</option>{db.outlets.map(o => <option key={o.id} value={o.id}>{o.name} only</option>)}</select></Field>}
        {isNew && !owner && <label className="row" style={{ minHeight: 44 }}><Toggle on={promote} onChange={setPromote} label="Propose for all outlets" /><span>Propose for all outlets <span className="faint">· the owner decides</span></span></label>}
        {!isNew && edit.promoteRequested && <p className="banner" style={{ background: 'var(--info-soft)', color: 'var(--info-fg)' }}><Icon name="globe" size={16} />The manager proposed this for all outlets. Approving promotes it to a global item.</p>}
      </div>}
    </Sheet>
  </>;
}

export function OverridesPanel({ g, set }: { g: Record<string, string | number | boolean>; set: (k: string, v: boolean) => void }) {
  const { db, user, outletId, setOutlet } = useApp();
  const owner = user.role === 'owner', lock = db.tenant.locks;
  const [draft, setDraft] = useState<Record<string, number>>({});
  const outlet = db.outlets.find(o => o.id === outletId)!;
  const rows = db.products.filter(p => p.status === 'live' && db.outletProducts.some(x => x.productId === p.id && x.outletId === outletId));
  return <>
    <Block title="Outlet"><div className="row wrap">{db.outlets.map(o => <button key={o.id} className="chip" aria-pressed={o.id === outletId} onClick={() => setOutlet(o.id)}>{o.name}</button>)}</div></Block>
    <Block title="What outlets may change" hint={lock.brand ? 'Franchise lock “Brand” is on: colors, fonts and logo stay the same everywhere.' : undefined}>
      {db.outlets.map(o => <div key={o.id} className="st-row"><span className="grow"><b style={{ fontSize: 14 }}>{o.name}</b><br /><span className="faint" style={{ fontSize: 12 }}>Photos, sections and local prices</span></span>
        {owner ? <Toggle on={!!g['ov_' + o.id]} onChange={v => set('ov_' + o.id, v)} label={o.name + ' can override'} /> : <Badge tone={g['ov_' + o.id] ? 'success' : 'neutral'}>{g['ov_' + o.id] ? 'Allowed' : 'Off'}</Badge>}</div>)}
    </Block>
    {lock.menuPrices
      ? <p className="banner" style={{ background: 'var(--warning-soft)', color: 'var(--warning-fg)' }}><Icon name="lock" size={16} />Franchise lock “Menu prices” is on. Every outlet sells at the base price.</p>
      : <Block title={`Local prices · ${outlet.name}`} hint={`Within ±${LOCAL_PRICE_BAND * 100}% of the base price. ${owner ? 'Saved immediately.' : 'Each change goes to the owner.'}`}>
        {rows.map(p => { const op = db.outletProducts.find(x => x.productId === p.id && x.outletId === outletId)!, cur = op.localPrice ?? p.basePrice, v = draft[p.id] ?? cur, ok = localPriceAllowed(p.basePrice, v, lock);
          return <div key={p.id} className="st-row" style={{ alignItems: 'flex-start' }}>
            <span className="grow stack" style={{ gap: 0 }}><b style={{ fontSize: 14 }}>{p.name}</b><span className="faint" style={{ fontSize: 12 }}>Base {idr(p.basePrice)} · allowed {idr(Math.ceil(p.basePrice * (1 - LOCAL_PRICE_BAND)))}–{idr(Math.floor(p.basePrice * (1 + LOCAL_PRICE_BAND)))}</span>{!ok && <span style={{ fontSize: 12, color: 'var(--danger-fg)' }}>Outside ±10%</span>}</span>
            <input className={'input num' + (ok ? '' : ' bad')} style={{ width: 110, height: 44 }} inputMode="numeric" aria-label={'Local price ' + p.name} value={v} onChange={e => setDraft({ ...draft, [p.id]: parseInt(e.target.value.replace(/\D/g, ''), 10) || 0 })} />
            <button className="btn btn-sm" style={{ height: 44 }} disabled={!ok || v === cur} onClick={() => { const r = requestPrice(p.id, v, user.id, outletId); toast(r ? 'Sent to the owner' : `${p.name} is ${idr(v)} at ${outlet.name}`); setDraft(d => { const n = { ...d }; delete n[p.id]; return n; }); }}>{owner ? 'Save' : 'Request'}</button>
          </div>; })}
      </Block>}
  </>;
}
