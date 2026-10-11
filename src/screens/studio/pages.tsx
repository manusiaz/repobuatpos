'use client';
import { linkTo } from '../../system/hosts.ts';
// Page Builder inside Menu Studio (spec: BorNiz Page Builder): pages, section library, section settings,
// visibility rules, preview-as, devices and the promo blocks. Flash sales write db.promos (kind 'flash') for the POS.
import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { Badge, Empty, Icon, Seg, toast } from '../../ui/kit.tsx';
import { idr } from '../../domain/money.ts';
import { flashPrice } from '../../domain/promo.ts';
import { priceAt } from '../../data/actions.ts';
import { ALL_VIS, SECTION_LIB, endFlash, flashSold, newSection, promosTemplate, startFlash, type FlashPromo, type Section, type Site, type SitePage, type Slide, type Val } from '../../data/actions/studio.ts';
import { Block, Fields, ImageSlot, Opts, f, type F } from './Frame.tsx';
import { Guest, SectionView, promoCards, PromoCardView, visibleTo, type GuestCtx, type Viewer } from './guest.tsx';
import { DisplayPreview, KioskPreview } from './surfaces.tsx';

export interface SiteApi {
  site: Site; mut: (fn: (s: Site) => void) => void; pageId: string; setPageId: (id: string) => void;
  sel: string | null; setSel: (id: string | null) => void; viewer: Viewer; setViewer: (v: Viewer) => void;
  ctx: GuestCtx; owner: boolean; by: string; started: number;
}
export const PROMO_TYPES = ['banner', 'carousel', 'flash', 'tiles', 'vouchers', 'bundle', 'popup'];
const curPage = (a: SiteApi) => a.site.find(p => p.id === a.pageId) ?? a.site[0];
const ruleText = (v: Section['vis'], outlets: { id: string; name: string }[]) => [v.aud !== 'all' && ({ member: 'Members', guest: 'Guests', new: 'New visitors' } as Record<string, string>)[v.aud], v.time !== 'all' && v.time, v.outlet !== 'all' && outlets.find(o => o.id === v.outlet)?.name, v.dev !== 'all' && v.dev + ' only', v.dates].filter(Boolean).join(' · ');

function contentFields(s: Section, cats: { id: string; name: string }[]): F[] {
  switch (s.type) {
    case 'hero': return [f.text('title', 'Title'), f.area('sub', 'Subtext'), f.text('cta', 'Button', 'Leave empty to hide'), f.img('img', 'Hero photo'), f.seg('align', 'Alignment', 'left:Left|center:Center'), f.seg('height', 'Height', 'short:Short|tall:Tall'), f.range('overlay', 'Photo shade', 0, 80, 5, '%')];
    case 'text': return [f.text('title', 'Title'), f.area('body', 'Text'), f.seg('align', 'Alignment', 'left:Left|center:Center')];
    case 'gallery': return [f.seg('cols', 'Columns (desktop)', '2:2|3:3|4:4'), f.range('count', 'Photos', 2, 12, 1), f.note('Uses your product photos. Upload them in Menu & products.')];
    case 'products': return [f.text('title', 'Title'), f.seg('cat', 'Show', ['best:Best sellers', ...cats.map(c => `${c.id}:${c.name}`)].join('|'), 2), f.range('count', 'Products', 2, 12, 1), f.seg('cols', 'Columns', '2:2|3:3|4:4'), f.seg('card', 'Card', 'photo:Photo card|list:List row')];
    case 'cats': return [f.seg('style', 'Chip style', 'pill:Pill|square:Square')];
    case 'buttons': return [f.text('b1', 'Button 1'), f.text('b2', 'Button 2'), f.text('b3', 'Button 3'), f.seg('align', 'Width', 'center:Full width|left:Fit text')];
    case 'hours': return [f.text('title', 'Title'), f.tog('map', 'Show map', 'Pinned at the selected outlet'), f.note('Opening hours come from each outlet’s settings.')];
    case 'reviews': return [f.text('title', 'Title'), f.seg('min', 'Show reviews from', '3:3 stars|4:4 stars|5:5 stars'), f.note('Reviews come from BorNiz feedback. Nothing is invented.')];
    case 'faq': return [f.text('title', 'Title'), ...[1, 2, 3].flatMap(i => [f.text('q' + i, 'Question ' + i), f.area('a' + i, 'Answer ' + i)])];
    case 'countdown': return [f.text('title', 'Title'), f.range('endsIn', 'Ends in', 15, 1440, 15, ' min'), f.text('cta', 'Button')];
    case 'spacer': return [f.range('h', 'Height', 8, 120, 8, ' px'), f.tog('line', 'Divider line')];
    case 'announce': return [f.text('text', 'Text')];
    case 'banner': return [f.seg('layout', 'Layout', 'image:Full image|split:Image + color|card:Card|color:Color only'), ...(s.props.layout !== 'color' ? [f.img('img', 'Banner image')] : []), f.text('badge', 'Badge', 'e.g. −20%, Fri only'), f.text('title', 'Title'), f.area('sub', 'Subtext'), f.text('cta', 'Button', 'Leave empty to hide'), f.seg('align', 'Text alignment', 'left:Left|center:Center'), f.range('overlay', 'Photo shade', 0, 80, 5, '%'), f.tog('countdown', 'Countdown'), ...(s.props.countdown ? [f.range('endsIn', 'Ends in', 15, 1440, 15, ' min')] : [])];
    case 'carousel': return [f.seg('ratio', 'Slide ratio', '16/9:16:9|1/1:1:1|4/5:4:5'), f.tog('auto', 'Auto-play'), f.range('every', 'Next slide every', 3, 10, 1, ' s')];
    case 'flash': return [f.text('title', 'Title'), f.range('endsIn', 'Runs for', 15, 1440, 15, ' min'), f.range('disc', 'Discount', 5, 70, 5, '%'), f.num('quota', 'Units per item', 'Sold bar fills against this'), f.tog('stock', 'Show “sold” bar'), f.seg('style', 'Style', 'bold:Bold|clean:Clean')];
    case 'tiles': return [f.text('title', 'Title'), f.seg('layout', 'Layout', 'feature:Feature + 3|grid:Even grid')];
    case 'vouchers': return [f.text('title', 'Title'), f.tog('member', 'Members only'), f.note('Vouchers are your promotions with a code. Create them in Promos & vouchers.')];
    case 'bundle': return [f.text('title', 'Title'), f.num('price', 'Combo price (IDR)'), f.text('cta', 'Button'), f.img('img', 'Combo photo')];
    case 'popup': return [f.text('title', 'Title'), f.text('sub', 'Subtext'), f.text('code', 'Voucher code'), f.text('cta', 'Button'), f.seg('when', 'Show', 'first:First visit|every:Every visit|exit:On exit'), f.range('delay', 'After', 0, 20, 1, ' s'), f.img('img', 'Pop-up image')];
    case 'member': return [f.text('title', 'Title'), f.text('sub', 'Subtext'), f.text('cta', 'Button')];
    case 'links': return [f.text('title', 'Title'), ...[1, 2, 3, 4].map(i => f.text('l' + i, 'Link ' + i))];
    default: return [];
  }
}

function ProductPicker({ value, onChange, a }: { value: string; onChange: (v: string) => void; a: SiteApi }) {
  const ids = value.split(',').filter(Boolean), db = a.ctx.db;
  return <Block title="Products" hint={`${ids.length} selected · prices from ${db.outlets.find(o => o.id === a.ctx.outletId)?.name}`}>
    <div className="row wrap">{db.products.filter(p => p.status === 'live').map(p => <button key={p.id} type="button" className="chip" aria-pressed={ids.includes(p.id)} onClick={() => onChange((ids.includes(p.id) ? ids.filter(x => x !== p.id) : [...ids, p.id]).join(','))}>{p.name}</button>)}</div>
  </Block>;
}
function SlidesEditor({ s, a }: { s: Section; a: SiteApi }) {
  const set = (i: number, patch: Partial<Slide>) => a.mut(site => { const x = findSec(site, s.id); if (x) Object.assign(x.items[i], patch); });
  return <Block title={s.type === 'tiles' ? 'Tiles' : 'Slides'} right={<button className="btn btn-sm" onClick={() => a.mut(site => { findSec(site, s.id)?.items.push({ title: 'New slide', sub: '', img: '', badge: '' }); })}><Icon name="plus" size={14} />Add</button>}>
    {s.items.map((x, i) => <div key={i} className="sunken stack sm">
      <div className="row between"><b style={{ fontSize: 13 }}>{i + 1}. {x.title || 'Untitled'}</b><button className="btn btn-ghost btn-sm" aria-label="Remove" onClick={() => a.mut(site => { findSec(site, s.id)?.items.splice(i, 1); })}><Icon name="trash-2" size={14} /></button></div>
      <input className="input" value={x.title} onChange={e => set(i, { title: e.target.value })} aria-label="Title" placeholder="Title" />
      <input className="input" value={x.sub} onChange={e => set(i, { sub: e.target.value })} aria-label="Subtext" placeholder="Subtext" />
      <input className="input" value={x.badge} onChange={e => set(i, { badge: e.target.value })} aria-label="Badge" placeholder="Badge (optional)" />
      <ImageSlot label="Slide image" value={x.img} onChange={v => set(i, { img: v })} />
    </div>)}
  </Block>;
}
const findSec = (site: Site, id: string) => site.flatMap(p => p.sections).find(x => x.id === id);

function FlashControls({ s, a }: { s: Section; a: SiteApi }) {
  const db = a.ctx.db, ids = String(s.props.products).split(',').filter(Boolean);
  const live = db.promos.filter(p => (p as FlashPromo).sectionId === s.id && (p.endsAt ?? 0) > Date.now()) as FlashPromo[];
  return <Block title="At the POS, QR menu and kiosk" hint="Starting the sale writes flash prices the POS uses on every new line. Ending it restores normal prices.">
    {live.length ? <div className="stack sm">
      {live.map(p => <div key={p.id} className="row between" style={{ fontSize: 13 }}><span>{p.name.split(' · ').pop()}</span><span><b>{idr(p.value)}</b> · sold {flashSold(db, p)}/{p.quota}</span></div>)}
      {a.owner && <button className="btn btn-danger" onClick={() => { endFlash(live.map(p => p.id), a.by); toast('Flash sale ended'); }}><Icon name="square" size={16} />End flash sale</button>}
    </div> : a.owner
      ? <button className="btn btn-primary" disabled={!ids.length} onClick={() => { startFlash(s.id, String(s.props.title), ids, Number(s.props.disc), Number(s.props.endsIn), Number(s.props.quota) || 0, a.by); toast('Flash sale live on POS, QR menu and kiosk'); }}><Icon name="zap" size={16} />Start flash sale now</button>
      : <p className="banner" style={{ background: 'var(--warning-soft)', color: 'var(--warning-fg)' }}><Icon name="lock" size={16} />Promotions need the owner. Send your pages to the owner; they start the sale.</p>}
  </Block>;
}

export function SectionEditor({ s, a, tab, setTab }: { s: Section; a: SiteApi; tab: string; setTab: (t: string) => void }) {
  const set = (group: 'props' | 'style' | 'vis', k: string, v: Val) => a.mut(site => { const x = findSec(site, s.id); if (x) (x[group] as Record<string, Val>)[k] = v; });
  const outlets = a.ctx.db.outlets;
  return <div className="stack lg">
    <div className="row between"><b>{SECTION_LIB[s.type][0]}</b><Seg value={tab} onChange={setTab} label="Section settings" options={[['content', 'Content'], ['style', 'Style'], ['vis', 'Visibility']]} /></div>
    {tab === 'content' && <>
      <Fields g={s.props} fs={contentFields(s, a.ctx.db.categories)} set={(k, v) => set('props', k, v)} />
      {(s.type === 'flash' || s.type === 'bundle') && <ProductPicker value={String(s.props.products)} onChange={v => set('props', 'products', v)} a={a} />}
      {s.type === 'bundle' && <p className="faint" style={{ fontSize: 12 }}>Items bought separately: {idr(String(s.props.products).split(',').map(id => a.ctx.db.products.find(p => p.id === id)).reduce((t, p) => t + (p ? priceAt(a.ctx.db, p, a.ctx.outletId) : 0), 0))}</p>}
      {(s.type === 'carousel' || s.type === 'tiles') && <SlidesEditor s={s} a={a} />}
      {s.type === 'flash' && <FlashControls s={s} a={a} />}
    </>}
    {tab === 'style' && <Fields g={s.style} fs={[f.seg('bg', 'Background', 'page:Page|surface:Card|brand:Brand|ink:Dark', 2), f.seg('pad', 'Spacing', 's:Tight|m:Normal|l:Airy')]} set={(k, v) => set('style', k, v)} />}
    {tab === 'vis' && <VisFields s={s} set={(k, v) => set('vis', k, v)} outlets={outlets} />}
  </div>;
}
function VisFields({ s, set, outlets }: { s: Section; set: (k: string, v: Val) => void; outlets: { id: string; name: string }[] }) {
  return <Fields g={s.vis as unknown as Record<string, Val>} set={set} fs={[
    f.seg('aud', 'Audience', 'all:Everyone|member:Members|guest:Guests|new:New visitors', 2), f.seg('time', 'Time of day', 'all:All day|breakfast:06–11|lunch:11–15|dinner:17–22', 2),
    f.seg('outlet', 'Outlet', ['all:All outlets', ...outlets.map(o => `${o.id}:${o.name}`)].join('|'), 2), f.seg('dev', 'Device', 'all:All|mobile:Phone & tablet|desktop:Desktop'),
    f.text('dates', 'Show between dates', 'e.g. 18 Feb – 19 Mar · leave empty for always')]} />;
}

function Layers({ a, onPick, extra }: { a: SiteApi; onPick?: (s: Section) => void; extra?: (s: Section) => ReactNode }) {
  const pg = curPage(a);
  const act = (id: string, k: 'up' | 'down' | 'dup' | 'hide' | 'del') => a.mut(site => {
    const arr = site.find(p => p.id === pg.id)!.sections, i = arr.findIndex(x => x.id === id);
    if (k === 'up' && i > 0) [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]];
    if (k === 'down' && i < arr.length - 1) [arr[i + 1], arr[i]] = [arr[i], arr[i + 1]];
    if (k === 'dup') arr.splice(i + 1, 0, { ...structuredClone(arr[i]), id: newSection(arr[i].type).id });
    if (k === 'hide') arr[i].hidden = !arr[i].hidden;
    if (k === 'del') arr.splice(i, 1);
  });
  if (!pg.sections.length) return <Empty icon="layers" title="This page is empty">Add a section from the library.</Empty>;
  return <div className="stack sm" role="list">{pg.sections.map((s, i) => {
    const sel = a.sel === s.id, rules = ruleText(s.vis, a.ctx.db.outlets);
    return <div key={s.id} role="listitem" className="row" style={{ padding: '6px 8px', borderRadius: 12, border: '1px solid ' + (sel ? 'var(--role)' : 'var(--border)'), background: sel ? 'var(--role-soft)' : 'var(--bg-surface)', opacity: s.hidden ? .55 : 1 }}>
      <button type="button" className="grow row" style={{ minHeight: 40, border: 0, background: 'none', cursor: 'pointer', textAlign: 'left', padding: 0 }} onClick={() => { a.setSel(s.id); onPick?.(s); }}>
        <Icon name={SECTION_LIB[s.type][1]} size={16} /><span className="stack" style={{ gap: 0, minWidth: 0 }}><b style={{ fontSize: 13 }}>{SECTION_LIB[s.type][0]}{s.props.title ? ' · ' + s.props.title : ''}</b>{rules && <span className="faint" style={{ fontSize: 11 }}><Icon name="filter" size={10} /> {rules}</span>}</span>
      </button>
      {extra?.(s)}
      <button className="btn btn-ghost btn-sm" aria-label="Move up" disabled={i === 0} onClick={() => act(s.id, 'up')}><Icon name="arrow-up" size={14} /></button>
      <button className="btn btn-ghost btn-sm" aria-label="Move down" disabled={i === pg.sections.length - 1} onClick={() => act(s.id, 'down')}><Icon name="arrow-down" size={14} /></button>
      <button className="btn btn-ghost btn-sm" aria-label={s.hidden ? 'Show' : 'Hide'} onClick={() => act(s.id, 'hide')}><Icon name={s.hidden ? 'eye-off' : 'eye'} size={14} /></button>
      <button className="btn btn-ghost btn-sm hide-sm" aria-label="Duplicate" onClick={() => act(s.id, 'dup')}><Icon name="copy" size={14} /></button>
      <button className="btn btn-ghost btn-sm" aria-label="Delete" onClick={() => { act(s.id, 'del'); if (sel) a.setSel(null); }}><Icon name="trash-2" size={14} /></button>
    </div>;
  })}</div>;
}
function PagePicker({ a }: { a: SiteApi }) {
  return <select className="input" aria-label="Page" value={a.pageId} onChange={e => { a.setPageId(e.target.value); a.setSel(null); }}>{a.site.map(p => <option key={p.id} value={p.id}>{p.name} · {p.slug}</option>)}</select>;
}
const addSection = (a: SiteApi, type: string, pageId = a.pageId) => {
  const ns = newSection(type);
  a.mut(site => { const arr = site.find(p => p.id === pageId)!.sections, i = arr.findIndex(x => x.id === a.sel); arr.splice(i < 0 ? arr.length : i + 1, 0, ns); });
  a.setSel(ns.id); return ns;
};

/** Settings panel for every Pages / promo-block view. */
export function PagesPanel({ view, a }: { view: string; a: SiteApi }) {
  const [tab, setTab] = useState('content');
  const pg = curPage(a), sel = pg.sections.find(s => s.id === a.sel);
  const promoTarget = PROMO_TYPES.includes(view) ? (sel?.type === view ? sel : pg.sections.find(s => s.type === view)) : undefined;
  useEffect(() => { if (promoTarget && a.sel !== promoTarget.id) a.setSel(promoTarget.id); }, [promoTarget?.id]);
  const setPage = (k: keyof SitePage, v: Val) => a.mut(site => { (site.find(p => p.id === pg.id) as unknown as Record<string, Val>)[k] = v; });

  if (view === 'pages') return <>
    <div className="stack sm">{a.site.map(p => <button key={p.id} type="button" className="st-opt" aria-pressed={p.id === pg.id} onClick={() => { a.setPageId(p.id); a.setSel(null); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <Icon name={p.icon} size={18} /><span className="grow stack" style={{ gap: 0 }}><span>{p.name}</span><small className="mono">{p.slug} · {p.sections.length} sections</small></span>
      {p.nav ? <Badge tone="info">In menu</Badge> : <Badge>Hidden link</Badge>}{p.sched !== 'always' && <Badge tone="warning">{p.sched}</Badge>}</button>)}</div>
    <div className="row wrap">{[['Blank page', []], ['Promos page', promosTemplate()], ['Link in bio', ['hero', 'links', 'member']]].map(([l, types]) =>
      <button key={l as string} className="btn btn-sm" onClick={() => { const id = 'pg' + Date.now().toString(36); a.mut(site => { site.push({ id, name: l as string, slug: '/' + (l as string).toLowerCase().replace(/\s+/g, '-'), icon: 'file', nav: false, sched: 'always', seo: l as string, sections: (types as (string | [string, Record<string, Val>])[]).map(t => Array.isArray(t) ? newSection(t[0], t[1]) : newSection(t)) }); }); a.setPageId(id); }}><Icon name="plus" size={14} />{l as string}</button>)}</div>
    <Block title={'Page · ' + pg.name}>
      <Fields g={pg as unknown as Record<string, Val>} set={(k, v) => setPage(k as keyof SitePage, v)} fs={[f.text('name', 'Name'), f.text('slug', 'Address', linkTo('/order').replace(/^https?:\/\//, '') + pg.slug), f.tog('nav', 'Show in menu bar'), f.seg('sched', 'Live', 'always:Always|season:Seasonal|hidden:Hidden'), f.text('seo', 'SEO title')]} />
      {!['home', 'menu'].includes(pg.id) && <button className="btn btn-danger" onClick={() => { a.mut(site => { site.splice(site.findIndex(p => p.id === pg.id), 1); }); a.setPageId('home'); }}><Icon name="trash-2" size={16} />Delete page</button>}
    </Block>
  </>;

  if (view === 'library') return <>
    <PagePicker a={a} />
    {[['Content', Object.keys(SECTION_LIB).filter(k => !SECTION_LIB[k][3])], ['Promo blocks', PROMO_TYPES]].map(([t, keys]) => <Block key={t as string} title={t as string} hint={t === 'Content' ? 'Adds after the selected section.' : undefined}>
      <div className="st-opts" style={{ ['--c' as string]: 2 }}>{(keys as string[]).map(k => <button key={k} type="button" className="st-opt" onClick={() => { addSection(a, k); toast(SECTION_LIB[k][0] + ' added to ' + pg.name); }}>
        <span className="row"><Icon name={SECTION_LIB[k][1]} size={16} />{SECTION_LIB[k][0]}</span></button>)}</div></Block>)}
  </>;

  if (view === 'section') return <>
    <PagePicker a={a} /><Layers a={a} />
    {sel ? <SectionEditor s={sel} a={a} tab={tab} setTab={setTab} /> : <p className="muted">Select a section to edit its content, style and visibility.</p>}
  </>;

  if (view === 'rules') return <>
    <PagePicker a={a} /><Layers a={a} />
    {sel ? <Block title={'Visibility · ' + SECTION_LIB[sel.type][0]}><VisFields s={sel} outlets={a.ctx.db.outlets} set={(k, v) => a.mut(site => { const x = findSec(site, sel.id); if (x) (x.vis as unknown as Record<string, Val>)[k] = v; })} />
      <button className="btn btn-ghost" onClick={() => a.mut(site => { const x = findSec(site, sel.id); if (x) x.vis = { ...ALL_VIS }; })}>Reset to everyone</button></Block>
      : <p className="muted">Pick a section to set who sees it, when, where and on which device.</p>}
  </>;

  if (view === 'previewas') return <>
    <p className="muted" style={{ fontSize: 14 }}>The preview applies every visibility rule as this visitor would see it.</p>
    <Fields g={a.viewer as unknown as Record<string, Val>} set={(k, v) => a.setViewer({ ...a.viewer, [k]: String(v) })} fs={[
      f.seg('aud', 'Visitor', 'member:Member|guest:Guest|new:New visitor'), f.seg('time', 'Time', 'all:Now|breakfast:Breakfast|lunch:Lunch|dinner:Dinner', 2),
      f.seg('outlet', 'Outlet', a.ctx.db.outlets.map(o => `${o.id}:${o.name}`).join('|'))]} />
    <PagePicker a={a} />
    <p className="faint" style={{ fontSize: 13 }}>{pg.sections.filter(s => !visibleTo(s, a.viewer)).length} of {pg.sections.length} sections hidden for this visitor.</p>
  </>;

  if (view === 'devices') return <>
    <p className="muted" style={{ fontSize: 14 }}>Switch Phone, Tablet and Desktop above the preview. Sections can be limited to one device.</p>
    <PagePicker a={a} />
    <Layers a={a} extra={s => <Badge tone={s.vis.dev === 'all' ? 'neutral' : 'info'}>{s.vis.dev === 'all' ? 'All' : s.vis.dev}</Badge>} />
    {sel && <Block title="Show on"><Opts value={sel.vis.dev} opts={[['all', 'All devices'], ['mobile', 'Phone & tablet'], ['desktop', 'Desktop']]} cols={3} onChange={v => a.mut(site => { const x = findSec(site, sel.id); if (x) x.vis.dev = String(v); })} /></Block>}
  </>;

  if (view === 'promospage') {
    const promo = a.site.find(p => p.id === 'promo');
    return <>
      <p className="muted" style={{ fontSize: 14 }}>One page with every promo block: carousel, flash sale, vouchers, tiles, combo, referral banner and a welcome pop-up. Linked from the menu bar as “Promos”.</p>
      <button className="btn btn-primary" onClick={() => { a.mut(site => { const i = site.findIndex(p => p.id === 'promo'), fresh = { id: 'promo', name: 'Promos', slug: '/promo', icon: 'badge-percent', nav: true, sched: 'always', seo: 'Promos', sections: promosTemplate().map(t => Array.isArray(t) ? newSection(t[0], t[1]) : newSection(t)) }; if (i >= 0) site[i] = fresh; else site.push(fresh); }); a.setPageId('promo'); toast('Promos page reset to the template'); }}>
        <Icon name="layout-template" size={16} />{promo ? 'Reset Promos page to template' : 'Create Promos page'}</button>
      {promo && (a.pageId !== 'promo' ? <button className="btn" onClick={() => a.setPageId('promo')}>Open Promos page</button> : <Block title="Blocks on the Promos page"><Layers a={a} /></Block>)}
    </>;
  }

  if (view === 'promoslive') {
    const cards = promoCards(a.site, a.ctx.db), flash = a.ctx.db.promos.filter(p => p.kind === 'flash' && (p.endsAt ?? 0) > Date.now());
    return <>
      <p className="muted" style={{ fontSize: 14 }}>Promo blocks from every page feed one strip that shows on the QR menu home, the kiosk menu and the customer display idle loop. Hidden sections are skipped.</p>
      <Block title={`${cards.length} cards in the strip`}>{cards.length ? cards.map((c, i) => <div key={i} className="row between" style={{ fontSize: 13 }}><span>{c.t}</span><Badge tone={c.flash ? 'danger' : 'accent'}>{c.tag || 'Promo'}</Badge></div>) : <p className="faint">No promo blocks yet. Add a banner, carousel, combo or flash sale.</p>}</Block>
      <Block title="Live flash prices">{flash.length ? flash.map(p => <div key={p.id} className="row between" style={{ fontSize: 13 }}><span>{p.name}</span><b>{idr(p.value)}</b></div>) : <p className="faint">No flash sale running.</p>}</Block>
      <div className="row wrap"><Link className="btn btn-sm" href="/order/qr-menu/menu-home">Open QR menu</Link><Link className="btn btn-sm" href="/kiosk/kiosk-attract-screen">Open kiosk</Link><Link className="btn btn-sm" href="/display/idle-promo-slideshow">Open customer display</Link></div>
    </>;
  }

  if (view === 'flashpos') {
    const db = a.ctx.db, now = Date.now(), flash = db.promos.filter(p => p.kind === 'flash') as FlashPromo[];
    return <>
      <p className="muted" style={{ fontSize: 14 }}>While a flash sale runs, the POS rings the sale price on every new line automatically and shows it as a price, not a discount. The receipt shows the normal price struck through.</p>
      {flash.length ? flash.map(p => { const on = (p.endsAt ?? 0) > now, prod = db.products.find(x => x.id === p.productIds?.[0]);
        return <div key={p.id} className="card tight stack sm"><div className="row between"><b style={{ fontSize: 14 }}>{prod?.name ?? p.name}</b><Badge tone={on ? 'success' : 'neutral'} dot>{on ? 'Live' : 'Ended'}</Badge></div>
          <div className="row between" style={{ fontSize: 13 }}><span>{prod && <s className="faint">{idr(priceAt(db, prod, a.ctx.outletId))}</s>} <b>{idr(p.value)}</b></span><span className="faint">{on ? `ends ${new Date(p.endsAt!).toTimeString().slice(0, 5)}` : 'ended'}{p.quota ? ` · sold ${flashSold(db, p)}/${p.quota}` : ''}</span></div>
          {on && a.owner && <button className="btn btn-sm btn-danger" onClick={() => endFlash([p.id], a.by)}>End now</button>}</div>; })
        : <Empty icon="zap" title="No flash sales yet">Build one in Flash sale and start it.</Empty>}
      <Link className="btn" href="/pos/selling/register-order"><Icon name="monitor" size={16} />Open POS register</Link>
    </>;
  }

  // promo block views: focus that block (prefer the current page, then the Promos page)
  if (PROMO_TYPES.includes(view)) {
    const anywhere = a.site.find(p => p.sections.some(s => s.type === view)), target = promoTarget;
    if (!target) return <>
      <PagePicker a={a} />
      <Empty icon={SECTION_LIB[view][1]} title={`No ${SECTION_LIB[view][0].toLowerCase()} on ${pg.name}`} action={<div className="row wrap" style={{ justifyContent: 'center' }}>
        <button className="btn btn-primary" onClick={() => addSection(a, view)}><Icon name="plus" size={16} />Add to {pg.name}</button>
        {anywhere && <button className="btn" onClick={() => { a.setPageId(anywhere.id); a.setSel(anywhere.sections.find(s => s.type === view)!.id); }}>Edit the one on {anywhere.name}</button>}</div>} />
    </>;
    return <><PagePicker a={a} /><SectionEditor s={target} a={a} tab={tab} setTab={setTab} /></>;
  }
  return null;
}

/** The current page as a visitor sees it, with the selected section outlined. */
export function SitePreview({ a, device, focus }: { a: SiteApi; device: string; focus?: boolean }) {
  const pg = curPage(a), mobile = device !== 'desktop';
  const nav = a.site.filter(p => p.nav);
  return <Guest d={a.ctx.d}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', background: 'var(--bn-surface)', boxShadow: '0 1px 0 var(--bn-line)', position: 'sticky', top: 0, zIndex: 3, overflowX: 'auto' }}>
      <b style={{ fontFamily: 'var(--bn-font)', flex: 'none' }}>{a.ctx.d.name}</b><span style={{ flex: 1 }} />
      {nav.map(p => <button key={p.id} type="button" onClick={() => { a.setPageId(p.id); a.setSel(null); }} style={{ flex: 'none', border: 0, background: 'none', color: 'inherit', font: '600 13px var(--bn-body)', cursor: 'pointer', borderBottom: p.id === pg.id ? '2px solid var(--bn-p)' : '2px solid transparent', padding: '6px 0' }}>{p.name}</button>)}
    </div>
    {pg.sections.filter(s => focus ? visibleTo(s, a.viewer) : !s.hidden && (s.vis.dev === 'all' || s.vis.dev === (mobile ? 'mobile' : 'desktop'))).map(s =>
      <div key={s.id} onClick={() => a.setSel(s.id)} style={{ outline: a.sel === s.id ? '2px solid var(--accent)' : 'none', outlineOffset: -2, cursor: 'pointer', position: 'relative' }}>
        <SectionView s={s} ctx={a.ctx} start={a.started} mobile={mobile} />
      </div>)}
    {!pg.sections.length && <p style={{ padding: 24, textAlign: 'center', opacity: .7 }}>Empty page. Add sections from the library.</p>}
  </Guest>;
}

/** "Promos live on QR menu, kiosk, customer display": the same promo strip on three surfaces. */
export function PromosEverywhere({ a }: { a: SiteApi }) {
  const cards = promoCards(a.site, a.ctx.db);
  const d = a.ctx.d, ctx = { ...a.ctx, site: a.site };
  return <div className="stack" style={{ width: '100%', alignItems: 'center', gap: 20 }}>
    <span className="cap" style={{ color: 'var(--ink-300)' }}>QR menu home</span>
    <Guest d={d} style={{ width: 360, minHeight: 0, borderRadius: 20, padding: '14px 0', overflow: 'hidden' }}><div style={{ display: 'flex', gap: 10, overflowX: 'auto', padding: '0 14px' }}>{cards.map((c, i) => <PromoCardView key={i} c={c} />)}</div></Guest>
    <span className="cap" style={{ color: 'var(--ink-300)' }}>Customer display · idle</span>
    <div style={{ width: 480, height: 270, borderRadius: 14, overflow: 'hidden', maxWidth: '100%' }}><div style={{ width: 960, height: 540, transform: 'scale(.5)', transformOrigin: 'top left' }}><DisplayPreview ctx={{ ...ctx, d: { ...d, dc: { ...d.dc, idle: 'promo' } } }} view="idle" /></div></div>
    <span className="cap" style={{ color: 'var(--ink-300)' }}>Kiosk</span>
    <div style={{ width: 300, height: 400, borderRadius: 14, overflow: 'hidden' }}><div style={{ width: 600, height: 800, transform: 'scale(.5)', transformOrigin: 'top left' }}><KioskPreview ctx={ctx} /></div></div>
  </div>;
}

/** Flash prices as the POS rings them (live store). */
export function PosPrices({ a }: { a: SiteApi }) {
  const db = a.ctx.db;
  const rows = db.products.filter(p => p.status === 'live').map(p => ({ p, base: priceAt(db, p, a.ctx.outletId), flash: flashPrice(db.promos, p.id) }));
  return <div style={{ width: '100%', maxWidth: 640, background: 'var(--bg-surface)', color: 'var(--fg-1)', borderRadius: 16, overflow: 'hidden' }}>
    <div className="row between" style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}><b>POS register · {db.outlets.find(o => o.id === a.ctx.outletId)?.name}</b><Badge tone="danger">{rows.filter(r => r.flash != null).length} flash prices</Badge></div>
    <div className="grid" style={{ ['--min' as string]: '140px', padding: 12, gap: 8 }}>{rows.map(r => <div key={r.p.id} style={{ minHeight: 72, borderRadius: 12, border: '1px solid ' + (r.flash != null ? 'var(--danger)' : 'var(--border)'), padding: 10, display: 'flex', flexDirection: 'column', gap: 2 }}>
      <b style={{ fontSize: 13 }}>{r.p.name}</b>{r.flash != null ? <span><b style={{ color: 'var(--danger-fg)' }}>{idr(r.flash)}</b> <s className="faint" style={{ fontSize: 11 }}>{idr(r.base)}</s></span> : <span className="muted" style={{ fontSize: 13 }}>{idr(r.base)}</span>}</div>)}</div>
  </div>;
}
