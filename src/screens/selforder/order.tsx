'use client';
import { studioValue } from '../../system/studio.ts';
import { gatewayResult } from '../../data/actions/dispatch.ts';
import { productImage } from '../../ui/kit.tsx';
// QR menu views (spec: BorNiz Self Order, layout A: list rows + cart bar). The cart is the table's open order in the
// store (source 'qr'); the kitchen sees it once sent, and the status page follows the KDS line states live.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon, Empty, ago, toast } from '../../ui/kit.tsx';
import { idr } from '../../domain/money.ts';
import { balance, tierOf, TIERS } from '../../domain/loyalty.ts';
import { usable } from '../../domain/promo.ts';
import { addLine, applyVoucher, cancelPayment, patchOrder, sendToKitchen, setQty, startPayment } from '../../data/actions.ts';
import { findOrJoin, guestCall, orderPlaced, setOptIn } from '../../data/actions/selforder.ts';
import { menuDesign } from '../../data/actions/studio.ts';
import { payOn } from '../../system/settings.ts';
import { groupsOf, LINE, missingGroup, mmss, modsFrom, modsText, MUTED, OptionPicker, progress, QR, SURFACE, TINT, unit, useMenu, Wordmark, type Sel } from '../guest/kit.tsx';
import { back, Bar, CartBar, ItemRow, newLines, Notices, Pill, settledOf, so, tableNo, Totals, type G } from './shared.tsx';
import { CatSection, ComboCard, homeCount, splitOn } from './more.tsx';
import { billSplit, dueOf, referralWelcome } from '../../data/actions/selforder.ts';
import { referralOffer } from '../../system/studio.ts';
import { ReadyCard, ReadyWatch, WaitPanel } from './progress.tsx';
import { guestLanguages, itemName, LANG_NAMES, toolValue } from '../../system/tools.ts';

const card = { padding: 16, borderRadius: 18, background: SURFACE } as const;
const choice = (on: boolean) => ({ border: `2px solid ${on ? 'var(--bn-p)' : LINE}`, background: on ? TINT : SURFACE, color: 'var(--bn-ink)', borderRadius: 14, cursor: 'pointer' });
const countIn = (g: G, id: string) => newLines(g.cart).filter(l => l.productId === id).reduce((a, l) => a + l.qty, 0);
const openItem = (g: G, id: string) => g.go(so('item-detail-and-options', { p: id }));

// ── Scan landing ───────────────────────────────────────────────────────────────────────
export function Landing({ g }: { g: G }) {
  const { db, t, out, table } = g;
  return <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
    <div style={{ flex: 1, minHeight: 320, background: 'var(--bn-banner)', color: 'var(--ink-0)', padding: '20px 18px 28px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
      <div className="row between"><Pill><Icon name="scan-line" size={14} />Table {tableNo(table)} detected</Pill><button onClick={() => g.go(so('language-picker'))} style={{ border: 0, cursor: 'pointer', background: 'none', padding: 0 }}><Pill><Icon name="languages" size={14} />{g.L.lang.toUpperCase()}</Pill></button></div>
      <div className="stack" style={{ gap: 10 }}>
        <Wordmark name={db.tenant.name} size={56} radius={16} />
        <h1 style={{ fontSize: 40, fontWeight: 800, lineHeight: 1 }}>{db.tenant.name}</h1>
        <span style={{ fontSize: 15, opacity: .9 }}>{out.name} · Table {tableNo(table)} · {g.hrs.paused ? 'Ordering paused' : g.hrs.open ? `${t('Open until')} ${out.closes}` : g.hrs.text}</span>
      </div>
    </div>
    <div className="stack" style={{ padding: '20px 16px calc(24px + env(safe-area-inset-bottom))', gap: 12 }}>
      <span style={{ fontSize: 15, color: MUTED }}>Order and pay from your phone. No app, no sign-up.</span>
      <button className="btn btn-primary btn-block" style={{ height: 58, fontSize: 17, borderRadius: 18 }} onClick={() => g.go(so('menu-home'))}>{t('Start order')}<Icon name="arrow-right" /></button>
      {g.latest && <button className="btn btn-block" style={{ height: 52, borderRadius: 16 }} onClick={() => g.go(so('order-status'))}><Icon name="chef-hat" />{t('Track my order')} · {g.latest.no}</button>}
      <div className="row" style={{ justifyContent: 'center', gap: 16, fontSize: 14 }}>
        <a href={so('language-picker')} onClick={e => { e.preventDefault(); g.go(so('language-picker')); }}>{guestLanguages(db, g.L.lang).langs.map(k => LANG_NAMES[k]?.[0] ?? k).join(' · ')}</a>
        <a href={so('member-card-and-points')} onClick={e => { e.preventDefault(); g.go(so('member-card-and-points')); }}>{db.tenant.name} Rewards</a>
      </div>
    </div>
  </div>;
}

export function Language({ g }: { g: G }) {
  const opts = guestLanguages(g.db, g.L.lang).langs.map(k => [k, ...(LANG_NAMES[k] ?? [k, k])] as const); // Studios › Languages
  return <>
    <Bar title={g.t('Choose language')} onBack={() => back(g.go, so('scan-landing'))} />
    <div className="stack" style={{ padding: 16, gap: 12 }} role="radiogroup" aria-label="Language">
      {opts.map(([k, l, s]) => <button key={k} role="radio" aria-checked={g.L.lang === k} onClick={() => { g.L.setLang(k); g.go(so('menu-home')); }} style={{ ...choice(g.L.lang === k), minHeight: 76, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 14, textAlign: 'left' }}>
        <span style={{ width: 44, height: 44, borderRadius: 99, background: 'var(--bn-p)', color: 'var(--ink-0)', display: 'grid', placeItems: 'center', fontWeight: 800 }}>{k.toUpperCase()}</span>
        <span className="stack" style={{ gap: 2, flex: 1 }}><b style={{ fontSize: 17 }}>{l}</b><span style={{ fontSize: 14, color: MUTED }}>{s}</span></span>
        {g.L.lang === k && <Icon name="check" />}</button>)}
      <span style={{ fontSize: 13, color: MUTED }}>Menu items show in your language where the store translated them.</span>
    </div>
  </>;
}

// ── Menu home (brand sections) ─────────────────────────────────────────────────────────
function Member({ g }: { g: G }) {
  const { db, me, t } = g;
  const go = () => g.go(so('member-card-and-points'));
  if (!me) return <button onClick={go} style={{ margin: '12px 14px 0', padding: '12px 14px', borderRadius: 20, background: SURFACE, border: `1px solid ${LINE}`, display: 'flex', alignItems: 'center', gap: 12, color: 'var(--bn-ink)', cursor: 'pointer', textAlign: 'left', width: 'calc(100% - 28px)' }}>
    <span style={{ width: 42, height: 42, borderRadius: 99, background: 'var(--bn-acc)', display: 'grid', placeItems: 'center' }}><Icon name="star" /></span>
    <span className="stack grow" style={{ gap: 2 }}><b style={{ fontSize: 15 }}>Join {db.tenant.name} Rewards</b><span style={{ fontSize: 12, color: MUTED }}>1 bean per IDR 1,000 · 50 welcome beans</span></span>
    <span style={{ height: 34, padding: '0 12px', borderRadius: 99, border: '1.5px solid var(--bn-p)', color: 'var(--bn-p)', fontSize: 12, fontWeight: 700, display: 'grid', placeItems: 'center' }}>{t('Join rewards')}</span></button>;
  const bal = balance(db.ledger, me.id), tier = tierOf(db.ledger, me.id), next = TIERS[TIERS.findIndex(x => x.id === tier.id) + 1];
  const year = db.ledger.filter(r => r.customerId === me.id && r.points > 0 && Date.now() - r.at < 365 * 864e5).reduce((a, r) => a + r.points, 0);
  return <button onClick={go} style={{ margin: '12px 14px 0', padding: '12px 14px', borderRadius: 20, background: SURFACE, border: `1px solid ${LINE}`, display: 'grid', gridTemplateColumns: 'auto minmax(0,1fr) auto', alignItems: 'center', gap: 12, color: 'var(--bn-ink)', cursor: 'pointer', textAlign: 'left', width: 'calc(100% - 28px)' }}>
    <span style={{ width: 42, height: 42, borderRadius: 99, background: 'var(--bn-acc)', display: 'grid', placeItems: 'center' }}><Icon name="star" /></span>
    <span className="stack" style={{ gap: 5, minWidth: 0 }}>
      <span className="row" style={{ gap: 6 }}><b style={{ fontSize: 15 }}>{bal.toLocaleString('en-US')} beans</b><span style={{ fontSize: 12, fontWeight: 700, color: MUTED }}>{tier.name}</span></span>
      {next && <span style={{ height: 6, borderRadius: 9, background: 'var(--bg-sunken)', overflow: 'hidden' }}><span style={{ display: 'block', width: Math.min(100, year / next.min * 100) + '%', height: '100%', background: 'var(--bn-acc)' }} /></span>}
      <span style={{ fontSize: 11, color: MUTED, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{next ? `${(next.min - year).toLocaleString('en-US')} more to ${next.name} · earning ${tier.multiplier}×` : `Top tier · earning ${tier.multiplier}×`}</span>
    </span>
    <span style={{ height: 34, padding: '0 12px', borderRadius: 99, border: '1.5px solid var(--bn-p)', color: 'var(--bn-p)', fontSize: 12, fontWeight: 700, display: 'grid', placeItems: 'center' }}>{t('Rewards')}</span></button>;
}

function SearchAndChips({ g, cat, onCat }: { g: G; cat?: string; onCat: (c: string) => void }) {
  const { cats } = useMenu(g.db, g.outletId);
  return <div style={{ position: 'sticky', top: 0, zIndex: 5, background: 'var(--bn-paper)', padding: '14px 14px 10px', display: 'flex', flexDirection: 'column', gap: 10 }}>
    <button onClick={() => g.go(so('search'))} style={{ height: 48, borderRadius: 14, background: SURFACE, border: `1px solid ${LINE}`, display: 'flex', alignItems: 'center', padding: '0 14px', gap: 8, color: MUTED, fontSize: 16, cursor: 'text' }}><Icon name="search" size={18} />{g.t('Search the menu')}</button>
    <div className="row" style={{ gap: 6, overflowX: 'auto', scrollbarWidth: 'none' }}>{[['all', 'All'] as const, ...cats.map(c => [c.id, c.name] as const)].map(([k, l]) =>
      <button key={k} className="chip" aria-pressed={(cat ?? '') === k} onClick={() => onCat(k)} style={{ height: 40 }}>{g.t(l)}</button>)}</div>
  </div>;
}

export function Home({ g }: { g: G }) {
  const { db, t, out, table, outletId } = g;
  const { items, best, cats } = useMenu(db, outletId);
  const bestItems = best.map(id => items.find(i => i.p.id === id)).filter((i): i is NonNullable<typeof i> => !!i && !i.sold).slice(0, 4);
  const promos = db.promos.filter(p => usable(p) && p.kind !== 'flash' && p.code);
  const flash = items.filter(i => i.flash != null && !i.sold);
  return <div style={{ paddingBottom: 96 }}>
    <div style={{ height: 210, background: 'var(--bn-banner)', color: 'var(--ink-0)', padding: 16, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
      <div className="row between"><Pill>Table {tableNo(table)} · {t('Dine-in')}</Pill>
        <button onClick={() => g.go(so('language-picker'))} aria-label="Switch language" style={{ border: 0, background: 'none', padding: 0, cursor: 'pointer' }}><Pill><Icon name="languages" size={14} />{g.L.lang.toUpperCase()}</Pill></button></div>
      <div className="stack" style={{ gap: 4 }}><h1 style={{ fontSize: 32, fontWeight: 800, lineHeight: 1 }}>{db.tenant.name}</h1><span style={{ fontSize: 13, opacity: .88 }}>{g.hrs.open ? `${t('Open until')} ${out.closes}` : g.hrs.text} · {out.name}</span></div>
    </div>
    <Notices g={g} />
    <Member g={g} />
    <SearchAndChips g={g} onCat={c => g.go(so('category-full-menu', c === 'all' ? undefined : { c }))} />
    {(flash.length > 0 || promos.length > 0) && <div className="row" style={{ gap: 10, overflowX: 'auto', padding: '2px 14px 6px', scrollbarWidth: 'none' }}>
      {flash.map(i => <button key={i.p.id} onClick={() => openItem(g, i.p.id)} style={{ flex: 'none', width: 250, padding: 14, borderRadius: 18, border: 0, background: 'var(--bn-ink)', color: 'var(--ink-0)', textAlign: 'left', cursor: 'pointer', display: 'flex', gap: 12, alignItems: 'center' }}>
        <span style={{ width: 52, height: 52, borderRadius: 12, background: productImage(i.p), flex: 'none' }} />
        <span className="stack" style={{ gap: 2 }}><span style={{ fontSize: 11, fontWeight: 800, color: 'var(--bn-acc)', textTransform: 'uppercase', letterSpacing: '.06em' }}>{t('Flash sale')}</span><b style={{ fontSize: 14 }}>{itemName(db, i.p, g.L.lang)}</b><span style={{ fontSize: 13 }}>{idr(i.flash!)} {i.strike && <s style={{ opacity: .7 }}>{idr(i.price).replace('IDR ', '')}</s>}</span></span></button>)}
      {promos.map(p => <button key={p.id} onClick={() => g.go(so('claim-voucher'))} style={{ flex: 'none', width: 220, padding: 14, borderRadius: 18, border: 0, background: 'var(--bn-acc)', color: 'var(--bn-ink)', textAlign: 'left', cursor: 'pointer' }}>
        <b style={{ display: 'block', fontSize: 15 }}>{p.name}</b><span style={{ fontSize: 13 }}>Code <b className="mono">{p.code}</b>{p.minSpend ? ` · min. ${idr(p.minSpend)}` : ''}</span></button>)}
    </div>}
    <ComboCard g={g} />
    <section className="stack" style={{ padding: '10px 14px', gap: 10 }} aria-label={t('Bestsellers')}>
      <h2 style={{ fontSize: 20, fontWeight: 800 }}>{t('Bestsellers')}</h2>
      {bestItems.map((i, k) => <ItemRow key={i.p.id} i={i} lang={g.L.lang} t={t} badge={k < 2 ? 'Bestseller' : undefined} count={countIn(g, i.p.id)} onOpen={() => openItem(g, i.p.id)} />)}
    </section>
    {cats.map(c => { const list = items.filter(i => i.cat === c.id), max = homeCount(g, c.id);
      return <CatSection key={c.id} g={g} catId={c.id} name={t(c.name)} list={list.slice(0, max)} count={id => countIn(g, id)} onOpen={id => openItem(g, id)}
        right={list.length > max && <button className="btn btn-ghost btn-sm" style={{ color: 'inherit' }} onClick={() => g.go(so('category-full-menu', { c: c.id }))}>{t('See all')} · {list.length}</button>} />; })}
    <CartBar g={g} />
  </div>;
}

/** Full list with sticky chips (also used by "Add more"). */
function MenuList({ g, cat, setCat }: { g: G; cat: string; setCat: (c: string) => void }) {
  const { items, best, cats } = useMenu(g.db, g.outletId);
  const shown = cats.filter(c => cat === 'all' || c.id === cat);
  return <>
    <SearchAndChips g={g} cat={cat} onCat={setCat} />
    {shown.map(c => <CatSection key={c.id} g={g} catId={c.id} name={g.t(c.name)} list={items.filter(i => i.cat === c.id)} count={id => countIn(g, id)} onOpen={id => openItem(g, id)}
      badge={i => best.indexOf(i.p.id) > -1 && best.indexOf(i.p.id) < 2 ? 'Bestseller' : undefined} />)}
  </>;
}
export function Category({ g }: { g: G }) {
  const cat = g.sp.get('c') ?? 'all';
  const name = g.db.categories.find(c => c.id === cat)?.name ?? 'Full menu';
  return <div style={{ paddingBottom: 96 }}>
    <Bar title={g.t(name)} onBack={() => g.go(so('menu-home'))} right={<span style={{ fontSize: 13, color: MUTED }}>Table {tableNo(g.table)}</span>} />
    <Notices g={g} />
    <MenuList g={g} cat={cat} setCat={c => g.go(so('category-full-menu', c === 'all' ? undefined : { c }))} />
    <CartBar g={g} />
  </div>;
}

export function Search({ g }: { g: G }) {
  const { items, best } = useMenu(g.db, g.outletId);
  const [q, setQ] = useState('');
  const hits = q.trim() ? items.filter(i => (i.p.name + ' ' + i.p.desc + ' ' + (g.db.categories.find(c => c.id === i.cat)?.name ?? '')).toLowerCase().includes(q.trim().toLowerCase())) : best.map(id => items.find(i => i.p.id === id)).filter((i): i is NonNullable<typeof i> => !!i).slice(0, 6);
  return <div style={{ paddingBottom: 96 }}>
    <div style={{ position: 'sticky', top: 0, zIndex: 6, display: 'flex', gap: 8, alignItems: 'center', padding: '10px 14px', background: 'var(--bn-paper)', borderBottom: `1px solid ${LINE}` }}>
      <button className="btn btn-ghost icon-btn" onClick={() => back(g.go, so('menu-home'))} aria-label="Back"><Icon name="arrow-left" /></button>
      <div style={{ flex: 1, height: 48, borderRadius: 14, background: SURFACE, border: `1px solid ${LINE}`, display: 'flex', alignItems: 'center', padding: '0 12px', gap: 8 }}>
        <Icon name="search" size={18} style={{ color: MUTED }} />
        <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder={g.t('Search the menu')} aria-label={g.t('Search the menu')} style={{ flex: 1, minWidth: 0, border: 0, background: 'transparent', fontSize: 16, outline: 'none', color: 'var(--bn-ink)' }} />
        {q && <button className="btn btn-ghost btn-sm" onClick={() => setQ('')} aria-label="Clear"><Icon name="x" size={16} /></button>}
      </div>
    </div>
    <div className="stack" style={{ padding: '12px 14px', gap: 10 }}>
      <span className="cap">{q.trim() ? `${hits.length} result${hits.length === 1 ? '' : 's'}` : g.t('Popular right now')}</span>
      {hits.map(i => <ItemRow key={i.p.id} i={i} lang={g.L.lang} t={g.t} count={countIn(g, i.p.id)} onOpen={() => openItem(g, i.p.id)} />)}
      {q.trim() && !hits.length && <Empty icon="search-x" title={g.t('No results')}>Nothing on the menu matches “{q}”. Try “kopi”, “latte” or a category.</Empty>}
    </div>
    <CartBar g={g} />
  </div>;
}

// ── Item detail & options ──────────────────────────────────────────────────────────────
export function Item({ g }: { g: G }) {
  const { db, t } = g;
  const { items, best } = useMenu(db, g.outletId);
  const it = items.find(i => i.p.id === g.sp.get('p')) ?? items.find(i => i.p.id === best[0]) ?? items[0];
  const [sel, setSel] = useState<Sel>({}), [q, setQ] = useState(1), [note, setNote] = useState('');
  useEffect(() => { setSel({}); setQ(1); setNote(''); }, [it?.p.id]);
  const up = studioValue(db, 'upsell-and-goes-well-with-rules'), ask = studioValue(db, 'checkout-flow-fields');
  const pairs = useMemo(() => { const ruled = it && it.p.id === up.trigger ? String(up.suggest).split(',').map(s => items.find(i => i.p.id === s.trim() && !i.sold)).filter((x): x is NonNullable<typeof x> => !!x) : [];
    return (ruled.length ? ruled : items.filter(i => !i.sold && i.cat === (it?.cat === 'pastry' ? 'coffee' : 'pastry') && i.p.id !== it?.p.id)).slice(0, Math.max(1, Number(up.max) || 1)); }, [items, it, up.trigger, up.suggest, up.max]);
  if (!it) return <Empty icon="utensils" title="Item not found" action={<button className="btn" onClick={() => g.go(so('menu-home'))}>{t('See the menu')}</button>} />;
  const groups = groupsOf(db, it.p), miss = missingGroup(groups, sel), mods = modsFrom(groups, sel);
  const each = unit(it) + mods.reduce((a, m) => a + m.price, 0);
  const paying = g.cart?.status === 'paying';
  const blocked = it.sold || !g.canOrder || paying;
  const add = () => {
    if (miss) return;
    addLine(g.ensureCart(), it.p.id, mods, q, note.trim(), 'guest');
    toast(`Added ${q}× ${it.p.name}`);
    back(g.go, so('menu-home'));
  };
  return <div style={{ paddingBottom: 110 }}>
    <div style={{ height: 240, background: it.sold ? 'var(--bg-sunken)' : productImage(it.p), position: 'relative' }}>
      <button className="btn icon-btn" onClick={() => back(g.go, so('menu-home'))} aria-label="Back" style={{ position: 'absolute', top: 12, left: 12, borderRadius: 99 }}><Icon name="arrow-left" /></button>
      {it.flash != null && <span style={{ position: 'absolute', top: 18, right: 14, padding: '4px 10px', borderRadius: 99, background: 'var(--bn-acc)', fontSize: 12, fontWeight: 800 }}>{t('Flash sale')}</span>}
    </div>
    <div className="stack" style={{ padding: '18px 16px', gap: 18 }}>
      <div className="stack" style={{ gap: 6 }}>
        <h1 style={{ fontSize: 26, fontWeight: 800 }}>{itemName(g.db, it.p, g.L.lang)}</h1>
        {it.p.desc && <span style={{ fontSize: 14, color: MUTED }}>{it.p.desc}</span>}
        <span>{it.sold ? <b style={{ color: 'var(--danger-fg)' }}>{t('Sold out')} today</b> : <><b style={{ fontSize: 18 }}>{idr(unit(it))}</b>{it.flash != null && it.strike && <s style={{ marginLeft: 8, color: MUTED }}>{idr(it.price)}</s>}</>}</span>
      </div>
      {groups.length > 0 && <div style={{ ...card }}><OptionPicker groups={groups} sel={sel} onChange={setSel} t={t} /></div>}
      {ask.notes && <div className="field"><label htmlFor="note">Note for the kitchen <span className="faint">(optional)</span></label>
        <input id="note" className="input" value={note} onChange={e => setNote(e.target.value)} placeholder="Allergies, less spicy…" maxLength={80} /></div>}
      {pairs.map(pair => <button key={pair.p.id} onClick={() => openItem(g, pair.p.id)} style={{ ...card, border: `1px dashed ${LINE}`, display: 'flex', gap: 12, alignItems: 'center', cursor: 'pointer', textAlign: 'left', color: 'var(--bn-ink)' }}>
        <span style={{ width: 52, height: 52, borderRadius: 12, background: productImage(pair.p), flex: 'none' }} />
        <span className="grow"><b>{up.title || 'Goes well with'} {pair.p.name}</b><br /><span style={{ fontSize: 13, color: MUTED }}>+ {idr(unit(pair))}</span></span><Icon name="chevron-right" /></button>)}
    </div>
    <div style={{ position: 'fixed', left: '50%', transform: 'translateX(-50%)', bottom: 0, width: 'min(520px,100vw)', padding: '12px 14px calc(14px + env(safe-area-inset-bottom))', background: 'var(--bn-paper)', borderTop: `1px solid ${LINE}`, display: 'flex', gap: 10, zIndex: 20 }}>
      <div className="row" style={{ gap: 4, background: SURFACE, borderRadius: 16, padding: 4, border: `1px solid ${LINE}` }}>
        <button className="btn btn-ghost icon-btn" aria-label="Fewer" onClick={() => setQ(Math.max(1, q - 1))}><Icon name="minus" /></button>
        <b style={{ minWidth: 22, textAlign: 'center' }} aria-live="polite">{q}</b>
        <button className="btn btn-ghost icon-btn" aria-label="More" onClick={() => setQ(q + 1)}><Icon name="plus" /></button>
      </div>
      <button className="btn btn-primary grow" style={{ height: 58, fontSize: 16, borderRadius: 16 }} disabled={blocked || !!miss} onClick={add}>
        {it.sold ? t('Sold out') : !g.canOrder ? 'Ordering closed' : paying ? 'Payment in progress' : miss ? `Choose ${miss.name.toLowerCase()}` : `${t('Add')} · ${idr(each * q)}`}</button>
    </div>
  </div>;
}

// ── Cart ───────────────────────────────────────────────────────────────────────────────
export function Cart({ g }: { g: G }) {
  const { db, cart, t } = g;
  const { items, best } = useMenu(db, g.outletId);
  const lines = newLines(cart), sent = cart ? cart.lines.filter(l => l.fired) : [];
  const [note, setNote] = useState(cart?.note ?? '');
  if (!cart || !cart.lines.length) return <><Bar title={t('Your order')} onBack={() => g.go(so('menu-home'))} />
    <Empty icon="shopping-basket" title={t('Your cart is empty')} action={<button className="btn btn-primary" onClick={() => g.go(so('menu-home'))}>{t('See the menu')}</button>}>Pick something from the menu. Prices include no hidden fees: service and tax show before you pay.</Empty></>;
  const ups = best.map(id => items.find(i => i.p.id === id)).filter((i): i is NonNullable<typeof i> => !!i && !i.sold && !cart.lines.some(l => l.productId === i.p.id) && !groupsOf(db, i.p).some(gr => gr.required)).slice(0, 3);
  return <div style={{ paddingBottom: 110 }}>
    <Bar title={`${t('Your order')} · Table ${tableNo(g.table)}`} onBack={() => g.go(so('menu-home'))} />
    <Notices g={g} />
    <div className="stack" style={{ padding: 14, gap: 12 }}>
      {cart.status === 'paying' && <button className="banner" onClick={() => g.go(so('qris-payment'))} style={{ background: 'var(--warning-soft)', color: 'var(--warning-fg)', border: 0, cursor: 'pointer', textAlign: 'left' }}><Icon name="qr-code" /><span className="grow"><b>Payment in progress</b><br />Finish paying, or cancel to change the order.</span><Icon name="chevron-right" /></button>}
      {lines.map(l => <div key={l.id} style={{ ...card, display: 'flex', gap: 12, alignItems: 'center' }}>
        <span className="stack grow" style={{ gap: 2 }}><b style={{ fontSize: 15 }}>{l.name}</b>{(l.mods.length > 0 || l.note) && <span style={{ fontSize: 13, color: MUTED }}>{modsText(l.mods, l.note)}</span>}
          <b style={{ fontSize: 14 }}>{idr(((l.flashPrice ?? l.unitPrice) + l.mods.reduce((a, m) => a + m.price, 0)) * l.qty)}</b></span>
        <div className="row" style={{ gap: 2, background: 'var(--bg-sunken)', borderRadius: 14, padding: 2 }}>
          <button className="btn btn-ghost icon-btn" disabled={cart.status === 'paying'} aria-label={l.combo ? `Remove ${l.note}` : `Fewer ${l.name}`} onClick={() => setQty(cart.id, l.id, l.qty - 1, 'guest')}><Icon name={l.qty > 1 && !l.combo ? 'minus' : 'trash'} size={18} /></button>
          <b style={{ minWidth: 20, textAlign: 'center' }}>{l.qty}</b>
          <button className="btn btn-ghost icon-btn" disabled={cart.status === 'paying' || !!l.combo} aria-label={`More ${l.name}`} onClick={() => setQty(cart.id, l.id, l.qty + 1, 'guest')}><Icon name="plus" size={18} /></button>
        </div>
      </div>)}
      {sent.length > 0 && <div style={{ ...card, background: 'var(--bg-sunken)' }} className="stack sm">
        <span className="cap">{t('Already ordered')} · {cart.no}</span>
        {sent.map(l => <div key={l.id} className="row between" style={{ fontSize: 14 }}><span>{l.qty}× {l.name}</span><span style={{ color: MUTED }}>{l.kds === 'done' ? 'Ready' : l.kds === 'cooking' ? 'Preparing' : 'Received'}</span></div>)}
      </div>}
      {ups.length > 0 && <><b style={{ fontSize: 16 }}>{t('People also add')}</b>
        <div className="row" style={{ gap: 10, overflowX: 'auto', scrollbarWidth: 'none' }}>{ups.map(i => <button key={i.p.id} disabled={!g.canOrder} onClick={() => { addLine(cart.id, i.p.id, [], 1, '', 'guest'); toast('Added ' + i.p.name); }} style={{ flex: 'none', width: 140, padding: 8, borderRadius: 16, border: 0, background: SURFACE, textAlign: 'left', cursor: 'pointer', color: 'var(--bn-ink)' }}>
          <span style={{ display: 'block', height: 80, borderRadius: 12, background: productImage(i.p), marginBottom: 6 }} /><b style={{ fontSize: 13 }}>{i.p.name}</b><br /><span style={{ fontSize: 13, color: MUTED }}>+ {idr(unit(i))}</span></button>)}</div></>}
      {studioValue(db, 'checkout-flow-fields').notes && <div className="field"><label htmlFor="knote">Note for the kitchen <span className="faint">(optional)</span></label>
        <textarea id="knote" className="input" rows={2} value={note} onChange={e => setNote(e.target.value)} onBlur={() => note !== (cart.note ?? '') && patchOrder(cart.id, { note }, 'guest')} placeholder="Allergies, no ice…" style={{ minHeight: 64 }} /></div>}
      <Totals db={db} o={cart} me={g.me} />
    </div>
    <div style={{ position: 'fixed', left: '50%', transform: 'translateX(-50%)', bottom: 0, width: 'min(520px,100vw)', padding: '12px 14px calc(14px + env(safe-area-inset-bottom))', background: 'var(--bn-paper)', borderTop: `1px solid ${LINE}`, zIndex: 20 }}>
      <button className="btn btn-primary btn-block" style={{ height: 58, fontSize: 16, borderRadius: 16 }} disabled={!g.canOrder || !lines.length && settledOf(db, cart) >= cart.total}
        onClick={() => { if (note !== (cart.note ?? '')) patchOrder(cart.id, { note }, 'guest'); g.go(billSplit(db, cart.id).shares.length ? so('checkout-and-payment', { split: '1' }) : so(cart.status === 'paying' ? 'qris-payment' : 'checkout-and-payment')); }}>
        {!g.canOrder ? (!g.onPlan ? 'Table not on the floor plan' : g.hrs.paused ? 'Ordering paused' : 'Closed · ' + g.hrs.text) : lines.length ? `${t('Checkout')} · ${idr(cart.total)}` : `Pay the bill · ${idr(cart.total - settledOf(db, cart))}`}</button>
    </div>
  </div>;
}

// ── Checkout & payment ─────────────────────────────────────────────────────────────────
export function Checkout({ g }: { g: G }) {
  const { db, cart, me, t } = g;
  const [name, setName] = useState(me?.name ?? ''), [phone, setPhone] = useState(me?.phone ?? ''), [tipPct, setTip] = useState(0), [pay, setPay] = useState<'qris' | 'cashier'>(db.device.online && payOn(db, 'qris') ? 'qris' : 'cashier');
  const [code, setCode] = useState(''), [err, setErr] = useState(''), [busy, setBusy] = useState(false), [promos, setPromos] = useState(false);
  useEffect(() => { if (me) { setName(n => n || me.name); setPhone(p => p || me.phone); } }, [me]);
  if (!cart || !cart.lines.length) return <><Bar title={t('Checkout')} onBack={() => g.go(so('cart'))} /><Empty icon="shopping-basket" title={t('Your cart is empty')} action={<button className="btn btn-primary" onClick={() => g.go(so('menu-home'))}>{t('See the menu')}</button>} /></>;
  const split = billSplit(db, cart.id).shares.length > 0;
  if (cart.status === 'paying' || split) return <><Bar title={t('Checkout')} onBack={() => g.go(so('cart'))} /><Empty icon={split ? 'split' : 'qr-code'} title={split ? 'Your table is splitting this bill' : 'Payment in progress'}
    action={<button className="btn btn-primary" onClick={() => g.go(split ? so('checkout-and-payment', { split: '1' }) : so('qris-payment'))}>{split ? 'Pay my share' : 'Open the QRIS code'}</button>} /></>;
  const due = cart.total - settledOf(db, cart);
  const ask = studioValue(db, 'checkout-flow-fields'), consent = toolValue(db, 'optin');
  const ro = referralOffer(db), welcome = !!me && ro.friendPct > 0 && !cart.discountPct && (db.records.referrals ?? []).some(r => r.a === me.id && r.e === 'joined');
  const tip = pay === 'qris' && ask.tips ? Math.round(cart.subtotal * tipPct / 100 / 100) * 100 : 0;
  const hasNew = newLines(cart).length > 0;
  const voucher = db.promos.find(p => cart.promoIds.includes(p.id));
  // Menu Studio → Checkout fields decides what the guest must give; the WhatsApp number is where the receipt and "ready" alert go.
  const place = () => {
    setErr('');
    if (ask.name === 'required' && !name.trim()) return setErr('Add a name so the team can call your order.');
    if (ask.phone === 'required' && phone.replace(/\D/g, '').length < 9) return setErr('Enter your WhatsApp number. Your receipt and the “order ready” message go there.');
    if (phone.trim() && phone.replace(/\D/g, '').length < 9) return setErr('Enter a full WhatsApp number, or leave it empty.');
    setBusy(true);
    try {
      let customerId = cart.customerId;
      if (phone.trim()) { const r = findOrJoin(name, phone, consent.checkout && promos, g.ref); if (!r.created && consent.checkout && promos) setOptIn(r.id, true); customerId = r.id; g.setMe(r.id); }
      if (customerId !== cart.customerId) patchOrder(cart.id, { customerId }, 'guest');
      referralWelcome(cart.id); // a friend's first order: the referral page's "% off" (Menu Studio › referral page)
      if (pay === 'cashier') { if (hasNew) { sendToKitchen(cart.id, 'guest'); orderPlaced(cart.id, true); } g.go(so('order-status')); }
      else { startPayment(cart.id, 'qris', dueOf(cart.id), 'guest', tip); g.go(so('qris-payment')); }
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  };
  const ways = ([
    ['qris', 'qr-code', 'QRIS', g.online ? 'Any bank or e-wallet · pay now on this phone' : 'Needs internet', g.online],
    ['cashier', 'store', t('Pay at the cashier'), hasNew ? 'Order goes to the kitchen now, pay later' : 'Show your table number at the counter', true]] as ['qris' | 'cashier', string, string, string, boolean][])
    .filter(([k]) => k !== 'qris' || payOn(db, 'qris')); // the owner's Payment methods decide
  return <div style={{ paddingBottom: 110 }}>
    <Bar title={t('Checkout')} onBack={() => g.go(so('cart'))} />
    <Notices g={g} />
    <div className="stack" style={{ padding: 14, gap: 14 }}>
      <div style={card} className="stack">
        <b>{t('Name for the order')}</b>
        {ask.name !== 'off' && <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder={ask.name === 'required' ? 'Your first name' : 'Your first name (optional)'} aria-label="Your first name" autoComplete="given-name" />}
        {ask.phone !== 'off' && <input className="input" value={phone} onChange={e => setPhone(e.target.value)} placeholder={ask.phone === 'required' ? 'WhatsApp number, e.g. 0812 3456 7890' : 'WhatsApp number (optional)'} aria-label="WhatsApp number" inputMode="tel" autoComplete="tel" />}
        <span style={{ fontSize: 13, color: MUTED }}>Receipt and “ready” alert go to WhatsApp. Members earn beans on this order.</span>
        {consent.checkout && ask.phone !== 'off' && !me?.optIn && <label className="row" style={{ gap: 10, minHeight: 44, fontSize: 14, cursor: 'pointer' }}><input type="checkbox" checked={promos} onChange={e => setPromos(e.target.checked)} style={{ width: 22, height: 22, accentColor: 'var(--bn-p)' }} />Send me offers and news on WhatsApp</label>}
      </div>
      {pay === 'qris' && ask.tips && <div style={card} className="stack">
        <b>{t('Tip for the team')}</b>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8 }}>{[0, 5, 10, 15].map(p => <button key={p} aria-pressed={tipPct === p} onClick={() => setTip(p)} style={{ ...choice(tipPct === p), height: 48, fontWeight: 700 }}>{p ? p + '%' : t('None')}</button>)}</div>
      </div>}
      <div style={card} className="stack" role="radiogroup" aria-label={t('Pay with')}>
        <b>{t('Pay with')}</b>
        {ways.map(([k, ic, l, s, ok]) => <button key={k} role="radio" aria-checked={pay === k} disabled={!ok} onClick={() => setPay(k)} style={{ ...choice(pay === k), minHeight: 64, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left', opacity: ok ? 1 : .5 }}>
          <Icon name={ic} style={{ color: 'var(--bn-p)' }} /><span className="stack grow" style={{ gap: 2 }}><b>{l}</b><span style={{ fontSize: 13, color: MUTED }}>{s}</span></span>
          <span style={{ width: 20, height: 20, borderRadius: 99, border: `2px solid ${pay === k ? 'var(--bn-p)' : LINE}`, display: 'grid', placeItems: 'center' }}>{pay === k && <span style={{ width: 10, height: 10, borderRadius: 99, background: 'var(--bn-p)' }} />}</span></button>)}
      </div>
      <div style={card} className="stack sm">
        <b>Voucher</b>
        {voucher ? <div role="status" className="row" style={{ padding: '10px 12px', borderRadius: 12, background: cart.discount ? 'var(--success-soft)' : 'var(--warning-soft)', color: cart.discount ? 'var(--success-fg)' : 'var(--warning-fg)', alignItems: 'flex-start' }}>
          <Icon name={cart.discount ? 'circle-check' : 'circle-alert'} size={20} style={{ flex: 'none' }} />
          <span className="stack" style={{ gap: 2 }}><b>{cart.discount ? t('Promo code applied!') : voucher.name}</b><span style={{ fontSize: 13 }}>{cart.discount ? `${voucher.name} · ${t('You save')} ${idr(cart.discount)}` : `${t('Spend at least')} ${idr(voucher.minSpend ?? 0)}`}</span></span></div>
          : <div className="row"><input className="input grow" value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="Voucher code" aria-label="Voucher code" /><button className="btn" style={{ height: 48 }} disabled={!code.trim()} onClick={() => { const e = applyVoucher(cart.id, code, 'guest'); if (e) setErr(e); else { setErr(''); toast('Voucher applied'); } }}>Apply</button></div>}
      </div>
      {welcome && <div role="status" className="banner" style={{ background: 'var(--success-soft)', color: 'var(--success-fg)' }}><Icon name="gift" /><span>Invited by a friend: <b>{ro.give}</b>. It comes off when you place this order.</span></div>}
      {splitOn(g) && settledOf(db, cart) === 0 && <button className="btn" style={{ height: 52, borderRadius: 16 }} onClick={() => g.go(so('checkout-and-payment', { split: '1' }))}><Icon name="split" />Split the bill · each phone pays its share</button>}
      <Totals db={db} o={cart} tip={tip} me={g.me} />
      {settledOf(db, cart) > 0 && <span style={{ fontSize: 14, color: MUTED }}>Already paid {idr(settledOf(db, cart))} · left to pay {idr(due)}</span>}
      {err && <div role="alert" className="banner" style={{ background: 'var(--danger-soft)', color: 'var(--danger-fg)' }}><Icon name="circle-alert" />{err}</div>}
    </div>
    <div style={{ position: 'fixed', left: '50%', transform: 'translateX(-50%)', bottom: 0, width: 'min(520px,100vw)', padding: '12px 14px calc(14px + env(safe-area-inset-bottom))', background: 'var(--bn-paper)', borderTop: `1px solid ${LINE}`, zIndex: 20 }}>
      <button className="btn btn-primary btn-block" style={{ height: 58, fontSize: 16, borderRadius: 16 }} disabled={busy || !g.canOrder || (pay === 'cashier' && !hasNew)} onClick={place}>
        {!g.canOrder ? 'Ordering closed' : pay === 'cashier' ? (hasNew ? t('Send order to kitchen') : 'Pay at the counter') : `Pay ${idr(due + tip)}`}</button>
    </div>
  </div>;
}

// ── QRIS on the phone ──────────────────────────────────────────────────────────────────
export function Qris({ g }: { g: G }) {
  const { db, cart, now } = g;
  const qp = studioValue(db, 'qris-payment-page-on-customer-phone');
  const [tick, setTick] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setTick(Date.now()), 1000); return () => clearInterval(t); }, []);
  const pend = cart ? db.payments.find(p => p.orderId === cart.id && p.status === 'pending' && p.method === 'qris') : undefined;
  const paidNow = g.recent.find(o => o.paidAt && now - o.paidAt < 10 * 60e3);
  const { go } = g, paidId = paidNow?.id;
  useEffect(() => { if (!pend && paidId) { const t = setTimeout(() => go(so('order-status')), 1500); return () => clearTimeout(t); } }, [pend, paidId, go]);
  const svg = useRef<HTMLDivElement>(null);
  const save = () => { const s = svg.current?.querySelector('svg'); if (!s) return; const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([s.outerHTML], { type: 'image/svg+xml' })); a.download = `qris-${pend?.ref ?? 'code'}.svg`; a.click(); };
  if (!pend) return <><Bar title="QRIS" onBack={() => g.go(so('cart'))} />
    {paidNow ? <Empty icon="circle-check" title="Paid · thank you!" action={<button className="btn btn-primary" onClick={() => g.go(so('order-status'))}>See order status</button>}>{idr(paidNow.total)} received for {paidNow.no}. Sending it to the kitchen.</Empty>
      : <Empty icon="qr-code" title="No payment open" action={<button className="btn btn-primary" onClick={() => g.go(so(cart?.lines.length ? 'checkout-and-payment' : 'menu-home'))}>{cart?.lines.length ? 'Go to checkout' : g.t('See the menu')}</button>}>Choose QRIS at checkout and the code shows here.</Empty>}</>;
  const left = (pend.expiresAt ?? tick) - tick, expired = left <= 0;
  const retry = () => { cancelPayment(pend.id, 'guest'); try { startPayment(pend.orderId, 'qris', pend.amount, 'guest', pend.tip); } catch (e) { toast((e as Error).message); } };
  const atCashier = () => { cancelPayment(pend.id, 'guest'); if (cart && newLines(cart).length) { sendToKitchen(cart.id, 'guest'); orderPlaced(cart.id, true); } g.go(so('order-status')); };
  return <div className="stack" style={{ padding: '18px 16px 32px', gap: 14, alignItems: 'center', textAlign: 'center' }}>
    <span className="badge" style={{ height: 32, padding: '0 14px', fontSize: 13, background: expired ? 'var(--danger-soft)' : 'var(--warning-soft)', color: expired ? 'var(--danger-fg)' : 'var(--warning-fg)' }} aria-live="polite">
      <i className="dot" />{expired ? 'This code has expired' : `${g.t('Waiting for payment')} · ${mmss(left)}`}</span>
    <span style={{ color: MUTED, fontSize: 14 }}>Total · {cart?.no} · Table {tableNo(g.table)}</span>
    <b style={{ fontFamily: 'var(--bn-font)', fontSize: 36, fontWeight: 800, lineHeight: 1 }}>{idr(pend.amount + pend.tip)}</b>
    <div ref={svg} style={{ width: 'min(280px, 78vw)', padding: 14, borderRadius: 22, background: 'var(--ink-0)', boxShadow: `0 0 0 1px ${LINE}`, opacity: expired ? .25 : 1 }}><QR value={pend.qr ?? pend.ref} label={`QRIS code for ${idr(pend.amount + pend.tip)}`} /></div>
    <span className="mono" style={{ color: MUTED }}>{pend.ref}</span>
    {expired ? <>
      <span style={{ fontSize: 14, color: MUTED }}>No money was taken.</span>
      <button className="btn btn-primary btn-block" style={{ height: 56, borderRadius: 16 }} onClick={retry}>Get a new code</button>
      <button className="btn btn-block" style={{ height: 52, borderRadius: 16 }} onClick={atCashier}>{g.t('Pay at the cashier')} instead</button>
    </> : <>
      {qp.steps && <ol style={{ textAlign: 'left', fontSize: 14, color: MUTED, paddingLeft: 20, margin: 0, lineHeight: 1.6 }}><li>Open any bank or e-wallet app</li><li>Scan or upload this code</li><li>Check the amount and pay</li></ol>}
      {qp.save && <span style={{ fontSize: 14, color: MUTED, lineHeight: 1.5 }}>On this phone? Save the QR, then open it from your bank or e-wallet app’s gallery.</span>}
      <div className="row" style={{ width: '100%', gap: 10 }}>
        {qp.save && <button className="btn grow" style={{ height: 52, borderRadius: 16 }} onClick={save}><Icon name="download" />Save QR</button>}
        <button className="btn grow" style={{ height: 52, borderRadius: 16 }} onClick={atCashier}>Pay at cashier</button>
      </div>
      <button className="btn btn-ghost btn-sm" onClick={() => gatewayResult(pend.id, 'settled').catch(e => toast((e as Error).message))}>Simulate payment (demo)</button>
    </>}
  </div>;
}

// ── Order status (live from the KDS) ───────────────────────────────────────────────────
export function Status({ g }: { g: G }) {
  const { db, latest, t, table } = g;
  if (!latest) return <><Bar title={t('Order status')} onBack={() => g.go(so('menu-home'))} />
    <Empty icon="chef-hat" title="No order yet" action={<button className="btn btn-primary" onClick={() => g.go(so('menu-home'))}>{t('See the menu')}</button>}>Orders from Table {tableNo(table)} in the last 2 hours show here.</Empty></>;
  const st = progress(latest), step = Math.max(0, st);
  const H = [[t('Order received'), 'Sent to the kitchen and bar'], [t('Being prepared'), 'The team is making your order'], [t('Almost ready'), 'Some items are done'], [t('Ready!'), `Your order is on its way to Table ${tableNo(table)}`]][step];
  const due = latest.total - settledOf(db, latest);
  const billAsked = db.notices.some(n => n.alert === 'Guest call' && n.outletId === latest.outletId && n.text === `${table} · Ask for the bill` && n.at > latest.createdAt);
  return <div style={{ paddingBottom: 32 }}>
    <div style={{ background: step === 3 ? 'var(--success)' : 'var(--bn-ink)', color: 'var(--ink-0)', padding: '18px 16px 22px', display: 'flex', flexDirection: 'column', gap: 10, transition: 'background var(--dur-slow)' }}>
      <div className="row between"><b style={{ fontFamily: 'var(--bn-font)', fontSize: 18 }}>{db.tenant.name}</b><span className="mono" style={{ opacity: .85 }}>{latest.no} · {table}</span></div>
      <h1 style={{ fontSize: 30, fontWeight: 800 }} aria-live="polite">{H[0]}</h1>
      <span style={{ fontSize: 14, opacity: .9 }}>{H[1]}</span>
      {(step === 3 || toolValue(db, 'wait').prog === 'steps') && <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 6, marginTop: 4 }}>{['Received', 'Preparing', 'Almost', 'Ready'].map((x, i) => <div key={x} className="stack" style={{ gap: 6, opacity: i <= step ? 1 : .6 }}>
        <span style={{ height: 6, borderRadius: 9, background: i <= step ? 'var(--bn-acc)' : 'color-mix(in srgb,var(--ink-0) 25%,transparent)', transition: 'background 300ms' }} /><span style={{ fontSize: 12, fontWeight: 600 }}>{t(x)}</span></div>)}</div>}
    </div>
    <Notices g={g} />
    <div className="stack" style={{ padding: 14, gap: 12 }}>
      {step === 3 ? <ReadyCard g={g} o={latest} /> : <WaitPanel g={g} o={latest} step={step} />}
      <ReadyWatch g={g} o={latest} ready={step === 3} />
      <div style={card} className="stack sm">
        {latest.lines.filter(l => l.fired).map(l => <div key={l.id} className="row between" style={{ fontSize: 14 }}><span className="grow">{l.qty}× {l.name}{l.mods.length > 0 && <span style={{ color: MUTED }}> · {modsText(l.mods)}</span>}</span>
          <span className="badge" style={{ background: l.kds === 'done' ? 'var(--success-soft)' : l.kds === 'cooking' ? 'var(--warning-soft)' : 'var(--bg-sunken)', color: l.kds === 'done' ? 'var(--success-fg)' : l.kds === 'cooking' ? 'var(--warning-fg)' : MUTED }}>{l.kds === 'done' ? t('Ready') : l.kds === 'cooking' ? t('Preparing') : t('Received')}</span></div>)}
      </div>
      <div style={card} className="row between">
        <span className="stack" style={{ gap: 2 }}><b>{due > 0 ? `To pay ${idr(due)}` : `Paid ${idr(latest.total)}`}</b><span style={{ fontSize: 13, color: MUTED }}>{due > 0 ? (billAsked ? 'Bill requested · a waiter is coming' : 'Pay at the cashier or here with QRIS') : 'Receipt in your WhatsApp if you left a number'}</span></span>
        {due > 0 ? <button className="btn btn-primary" onClick={() => g.go(so('checkout-and-payment'))} disabled={!g.online}>Pay now</button> : <button className="btn" onClick={() => g.go(so('digital-receipt', { o: latest.id }))}>Receipt</button>}
      </div>
      {due > 0 && splitOn(g) && <button className="btn" style={{ height: 52, borderRadius: 16 }} disabled={!g.online} onClick={() => g.go(so('checkout-and-payment', { split: '1' }))}><Icon name="split" />Split the bill between phones</button>}
      {g.recent.filter(o => o.id !== latest.id && o.lines.some(l => l.fired)).length > 0 && <span style={{ fontSize: 13, color: MUTED }}>Earlier at this table: {g.recent.filter(o => o.id !== latest.id && o.lines.some(l => l.fired)).map(o => o.no).join(', ')}</span>}
      <div className="row" style={{ gap: 10 }}>
        <button className="btn grow" style={{ height: 52, borderRadius: 16 }} onClick={() => g.go(so('call-waiter-request-bill'))}><Icon name="hand" />{t('Call waiter')}</button>
        <button className="btn btn-primary grow" style={{ height: 52, borderRadius: 16 }} disabled={!g.canOrder} onClick={() => g.go(so('add-more-to-existing-order'))}><Icon name="plus" />{t('Order more')}</button>
      </div>
    </div>
  </div>;
}

// ── Call waiter / request bill ─────────────────────────────────────────────────────────
const CALLS = [['hand', 'Call waiter'], ['receipt', 'Ask for the bill'], ['glass-water', 'More water'], ['utensils', 'Cutlery'], ['snowflake', 'Extra ice'], ['scroll-text', 'Tissues']] as const;
export function Call({ g }: { g: G }) {
  const { db, table, t, outletId } = g;
  const [last, setLast] = useState<string | null>(null);
  const sent = db.notices.filter(n => n.alert === 'Guest call' && n.outletId === outletId && n.text.startsWith(table + ' · ') && Date.now() - n.at < 2 * 3600e3);
  const call = (l: string) => { guestCall(outletId, table, l); setLast(l); };
  return <>
    <Bar title={t('Need something?')} onBack={() => back(g.go, so('order-status'))} right={<span style={{ fontSize: 13, color: MUTED }}>Table {tableNo(table)}</span>} />
    <div className="stack" style={{ padding: 14, gap: 14 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 10 }}>{CALLS.map(([ic, l]) => <button key={l} onClick={() => call(l)} style={{ ...choice(last === l), height: 104, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
        <Icon name={ic} size={28} style={{ color: 'var(--bn-p)' }} /><b style={{ fontSize: 15 }}>{t(l)}</b></button>)}</div>
      {last && <div role="status" className="banner" style={{ background: 'var(--success-soft)', color: 'var(--success-fg)' }}><Icon name="circle-check" />
        <span>{last === 'Ask for the bill' ? `Bill requested. A waiter will bring it to Table ${tableNo(table)}, or pay here with QRIS.` : 'Sent to the floor team. Someone will be with you shortly.'}</span></div>}
      {last === 'Ask for the bill' && g.cart && <button className="btn btn-primary" style={{ height: 52, borderRadius: 16 }} onClick={() => g.go(so('checkout-and-payment'))}>Pay {idr(g.cart.total - settledOf(db, g.cart))} with QRIS</button>}
      {sent.length > 0 && <div style={card} className="stack sm"><span className="cap">Sent from this table</span>
        {sent.slice(0, 6).map(n => <div key={n.id} className="row between" style={{ fontSize: 14 }}><span>{n.text.split(' · ')[1]}</span><span style={{ color: MUTED }}>{ago(n.at)}{n.read ? ' · seen' : ''}</span></div>)}</div>}
    </div>
  </>;
}

// ── Add more to an existing order ──────────────────────────────────────────────────────
export function AddMore({ g }: { g: G }) {
  const { latest, t } = g;
  const [cat, setCat] = useState('all');
  const paid = !!latest && !!latest.paidAt;
  return <div style={{ paddingBottom: 96 }}>
    <Bar title={t('Order more')} onBack={() => back(g.go, so('order-status'))} />
    <Notices g={g} />
    {latest ? <div style={{ ...card, margin: '12px 14px 0' }} className="stack sm">
      <div className="row between"><b>Adding to {latest.no} · Table {tableNo(g.table)}</b><span style={{ fontSize: 13, color: MUTED }}>{ago(latest.createdAt)}</span></div>
      <span style={{ fontSize: 13, color: MUTED }}>{latest.lines.filter(l => l.fired).map(l => `${l.qty}× ${l.name}`).join(', ')}</span>
      {paid && <span style={{ fontSize: 13, color: MUTED }}>Your first order is paid. New items go on a new bill for this table.</span>}
    </div> : <div style={{ ...card, margin: '12px 14px 0', fontSize: 14, color: MUTED }}>No order at this table yet. Anything you add starts a new order.</div>}
    <MenuList g={g} cat={cat} setCat={setCat} />
    <CartBar g={g} label="Review additions" />
  </div>;
}

// ── Table closed / outside opening hours ───────────────────────────────────────────────
export function Closed({ g }: { g: G }) {
  const { out, db, hrs } = g;
  const sc = studioValue(db, 'store-closed-offline-sold-out-pages'), offline = !g.online; // copy from Menu Studio › store closed pages
  return <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
    <div style={{ background: 'var(--bn-banner)', color: 'var(--ink-0)', padding: '24px 18px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <Wordmark name={db.tenant.name} size={48} radius={14} />
      <h1 style={{ fontSize: 30, fontWeight: 800 }}>{hrs.paused ? 'Ordering is paused' : offline ? sc.offline : sc.closed}</h1>
      <span style={{ opacity: .9 }}>{db.tenant.name} {out.name} · Table {tableNo(g.table)}</span>
    </div>
    <div className="stack" style={{ padding: 16, gap: 14 }}>
      <div style={card} className="stack sm">
        <div className="row" style={{ gap: 10 }}><Icon name={hrs.paused ? 'circle-pause' : 'clock'} style={{ color: 'var(--bn-p)' }} /><b>{hrs.paused ? 'The kitchen paused QR orders for a moment' : hrs.open ? `Open now until ${out.closes}` : hrs.text}</b></div>
        <span style={{ fontSize: 14, color: MUTED }}>Opening hours: every day {out.opens}–{out.closes} · {out.city}</span>
        <span style={{ fontSize: 14, color: MUTED }}>{hrs.paused ? 'Please order at the counter, or try again in a few minutes.' : offline ? sc.offlineSub : sc.closedSub}</span>
      </div>
      <button className="btn btn-primary" style={{ height: 56, borderRadius: 16 }} onClick={() => g.go(so('online-booking'))}><Icon name="calendar-plus" />Book a table</button>
      <button className="btn" style={{ height: 52, borderRadius: 16 }} onClick={() => g.go(so('menu-home'))}>Browse the menu</button>
      {hrs.open && !hrs.paused && <span style={{ fontSize: 13, color: MUTED, textAlign: 'center' }}>This is how the page looks outside {out.opens}–{out.closes}. The store is open now.</span>}
    </div>
  </div>;
}
