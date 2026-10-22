'use client';
// Brand Studio (spec: BorNiz Brand Studio): the team's own tools — dashboard, POS, kitchen display, login — in the
// merchant's colors, logo and type. Writes db.staffBrand via publish('brand', …): owner publishes, manager sends to owner.
// Locked for speed and safety: status colors, kitchen timer colors, POS touch sizes, payment marks, contrast < 4.5:1.
import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { useApp } from '../app/context.tsx';
import { Badge, Field, Icon, Seg, Sheet, ago, toast } from '../ui/kit.tsx';
import { priceAt } from '../data/actions.ts';
import { publishVerb } from '../domain/menu.ts';
import { idr, idrShort } from '../domain/money.ts';
import { pagesOf } from '../system/registry.ts';
import { draftOf, pendingOf, release, staffBrand, type Group, type StaffBrand, type Val } from '../data/actions/studio.ts';
import { Block, ColorRow, ContrastCard, DeviceSeg, DeviceView, Fields, ImageSlot, LockedCard, Opts, StudioFrame, f, type Device, type ToolGroup } from './studio/Frame.tsx';
import { contrast, FONTS, loadFont, mix, onColor, MIN_RATIO, type Check } from './studio/theme.ts';
import { draftState, stable, useAutosave } from './studio/draft.ts';

// slug → [tool, label, icon, subtitle]
const T: Record<string, [string, string, string, string]> = {
  'brand-studio-colors': ['colors', 'Colors', 'palette', 'Change any color directly. Themes are optional shortcuts that fill these in; you can edit everything after picking one.'],
  'brand-studio-logo-mono-logo-workspace-name': ['logo', 'Logo & name', 'image', 'Your workspace name and logos. The mono logo sits on dark sidebars and the kitchen display.'],
  'brand-studio-login-and-pin-lock-screen-photo': ['login', 'Login & PIN lock', 'lock-keyhole', 'The photo and greeting on the staff login and the POS PIN lock screen.'],
  'brand-studio-font-corners-density': ['type', 'Font, corners, density', 'type', 'Font for your team’s tools, corner radius and density.'],
  'brand-studio-sidebar-style-pos-header-kds-accent-line': ['layout', 'Sidebar, POS header, KDS', 'layout-template', 'Sidebar style, POS header and the kitchen accent line.'],
  'brand-studio-preview-dashboard-pos-kitchen-login': ['preview', 'Preview', 'eye', 'See every staff screen with your brand before you publish. Rules and plan limits are listed here.'],
  'brand-studio': ['colors', 'Brand studio', 'palette', 'Change any color directly. Every change goes to the owner before it reaches your team.'],
};
const PRESETS: [string, string, StaffBrand['c']][] = [
  ['BorNiz', 'light', { primary: '#FF6A00', sidebar: '#FFFFFF', bg: '#FAFAFA', surface: '#FFFFFF', text: '#0F172A', kpi: '#FF6A00', loginTint: '#0F172A' }],
  ['Kopi Biru', 'dark', { primary: '#1F5FBF', sidebar: '#0F2A55', bg: '#F6F8FB', surface: '#FFFFFF', text: '#0F172A', kpi: '#1F5FBF', loginTint: '#0F2A55' }],
  ['Matcha', 'light', { primary: '#3E7D4F', sidebar: '#1B2A1F', bg: '#FAF8F5', surface: '#FFFFFF', text: '#1B2A1F', kpi: '#3E7D4F', loginTint: '#1B2A1F' }],
  ['Berry', 'brand', { primary: '#B0305C', sidebar: '#3A1626', bg: '#FFF5F7', surface: '#FFFFFF', text: '#3A1626', kpi: '#B0305C', loginTint: '#3A1626' }],
];
const COLORS: [keyof StaffBrand['c'], string, string][] = [['primary', 'Primary', 'Buttons, active nav, Charge'], ['sidebar', 'Sidebar', 'Dashboard side navigation'], ['bg', 'Background', 'Behind every screen'], ['surface', 'Cards & panels', 'Tables, KPI cards, cart'], ['text', 'Text', 'All body text'], ['kpi', 'Highlight card', 'First KPI on Live monitor'], ['loginTint', 'Login backdrop', 'Used when there is no photo']];
// Colour maths needs real values: these equal --ink-0 and --ink-950.
const WHITE = '#FFFFFF', INK = '#0F172A';
const STAFF_FONTS = ['space', 'jakarta', 'dm', 'outfit', 'nunito', 'system'];
const LOCKED_STAFF = ['Payment status colors: paid, pending, void, refunded', 'Kitchen timer colors and the green Bump button', 'Minimum POS touch size (56 px) and the Charge button position', 'Text contrast below 4.5:1 cannot be published', 'QRIS and card network marks', 'Error, offline and payment-failed screens'];
const PLANS: [string, string][] = [['Free', 'Logo and workspace name.'], ['Basic', 'Primary color, sidebar style, login photo.'], ['Pro', 'Every color, fonts, corners, density, POS header, KDS line. Remove “Powered by”.'], ['Enterprise', 'Per-brand and per-outlet workspaces, custom font upload, SSO login page.']];

export function brandChecks(b: StaffBrand): Check[] {
  const side = sideBg(b);
  return ([['Text on background', b.c.text, b.c.bg], ['Text on cards', b.c.text, b.c.surface], ['Button label on primary', onColor(b.c.primary), b.c.primary], ['Sidebar labels', onColor(side) === WHITE ? WHITE : b.c.text, side]] as const)
    .map(([label, a, c]) => { const ratio = contrast(a, c); return { label, ratio, ok: ratio >= MIN_RATIO }; });
}
const sideBg = (b: StaffBrand) => b.side === 'light' ? b.c.surface : b.side === 'dark' ? b.c.sidebar : b.c.primary;

export default function Screen() { const { user } = useApp(); return <BrandStudio key={user.id} />; }

function BrandStudio() {
  const { page, db, user } = useApp();
  const owner = user.role === 'owner';
  const [tool, , , sub] = T[page.slug] ?? T['brand-studio-colors'];
  const published = useMemo(() => staffBrand(db), [db]);
  const [b, setB] = useState<StaffBrand>(() => { const v = draftOf(db, 'brand', user.id) ?? (owner ? undefined : pendingOf(db, 'brand', user.id)); return v ? { ...staffBrand(db), ...(v.data as Partial<StaffBrand>) } : staffBrand(db); });
  const [view, setView] = useState<'dash' | 'pos' | 'kds' | 'login'>(tool === 'login' ? 'login' : tool === 'layout' ? 'pos' : 'dash');
  const [device, setDevice] = useState<Device>('desktop');
  const [confirm, setConfirm] = useState(false), [note, setNote] = useState('');
  const dirty = stable(b) !== stable(published);
  useAutosave('brand', b, dirty, user.id);
  const checks = brandChecks(b), bad = checks.some(c => !c.ok);
  const { status, blocked, waiting } = draftState(db, 'brand', user.id, dirty, bad);
  const set = (patch: Partial<StaffBrand>) => setB(x => ({ ...x, ...patch, accent: patch.c?.primary ?? x.c.primary }));
  const setC = (k: keyof StaffBrand['c'], v: string) => setB(x => ({ ...x, c: { ...x.c, [k]: v }, accent: k === 'primary' ? v : x.accent }));
  const verb = publishVerb(user.role);
  const plan = db.tenant.plan, belowPro = plan === 'free' || plan === 'basic';

  const groups: ToolGroup[] = [{ title: 'Brand studio', tools: pagesOf('brand').filter(p => T[p.slug] && (p.role === 'manager' ? !owner : true)).map(p => ({ key: p.role === 'manager' ? 'manager' : T[p.slug][0], label: T[p.slug][1], icon: T[p.slug][2], path: p.path })) },
    { title: 'Customer-facing', tools: [{ key: 'menu', label: 'Menu studio', icon: 'utensils', path: '/owner/menu-studio-customer-facing/menu-studio-brand-and-all-colors' }] }];
  const current = page.role === 'manager' ? 'manager' : tool;

  const panels: Record<string, () => ReactNode> = {
    colors: () => <>
      <Block title="Quick start · optional" hint="Picking a theme only fills the colors below. Edit any of them afterwards.">
        <Opts value={PRESETS.find(p => stable(p[2]) === stable(b.c))?.[0] ?? ''} cols={2} onChange={n => { const p = PRESETS.find(x => x[0] === n)!; set({ c: { ...p[2] }, side: p[1] }); }}
          opts={PRESETS.map(([n, , c]) => [n, n, undefined, `linear-gradient(90deg,${c.sidebar} 0 35%,${c.primary} 35% 70%,${c.bg} 70%)`])} /></Block>
      <Block title="Colors">{COLORS.map(([k, l, s]) => { const chk = k === 'text' ? { ratio: contrast(b.c.text, b.c.bg), text: 'on background' } : k === 'surface' ? { ratio: contrast(b.c.text, b.c.surface), text: 'text on cards' } : k === 'primary' ? { ratio: contrast(onColor(b.c.primary), b.c.primary), text: 'button label' } : k === 'sidebar' && b.side === 'dark' ? { ratio: checks[3].ratio, text: 'sidebar labels' } : undefined;
        return <ColorRow key={k} label={l} sub={s} value={b.c[k]} onChange={v => setC(k, v)} check={chk} disabled={belowPro && k !== 'primary'} />; })}</Block>
      <Scale primary={b.c.primary} />
      <ContrastCard checks={checks} />
    </>,
    logo: () => <>
      <Fields g={b as unknown as Group} set={(k, v) => set({ [k]: String(v).slice(0, 28) } as Partial<StaffBrand>)} fs={[f.text('workspace', 'Workspace name', 'Shown in the sidebar, POS header and login')]} />
      <Block title="Logos" hint="SVG or PNG, 512 px or larger. The mono logo is used on dark sidebars and the kitchen display.">
        <div className="grid" style={{ ['--min' as string]: '130px', gap: 10 }}><ImageSlot label="Full color" ratio="1/1" maxW={512} value={b.logo} onChange={v => set({ logo: v })} /><ImageSlot label="Mono / white" ratio="1/1" maxW={512} value={b.logoMono} onChange={v => set({ logoMono: v })} /></div></Block>
    </>,
    login: () => <>
      <Fields g={b as unknown as Group} set={(k, v) => set({ [k]: String(v).slice(0, 40) } as Partial<StaffBrand>)} fs={[f.text('loginTitle', 'Login greeting')]} />
      <Block title="Login & lock screen photo" hint="1920×1200. Shown on the staff login and the POS PIN lock screen. Without a photo the login backdrop color is used.">
        <ImageSlot label="Login photo" value={b.loginImg} onChange={v => set({ loginImg: v })} disabled={belowPro && plan === 'free'} /></Block>
      <ColorRow label="Login backdrop" value={b.c.loginTint} onChange={v => setC('loginTint', v)} />
    </>,
    type: () => <>
      <Block title="Font" hint="Applies to the dashboard, POS, kitchen display and staff app. Numbers stay tabular." right={<Badge><Icon name="lock" size={12} />Custom upload · Enterprise</Badge>}>
        <Opts value={b.font} disabled={belowPro} onChange={v => { loadFont(String(v)); set({ font: String(v) }); }} opts={STAFF_FONTS.map(k => [k, FONTS[k][0], undefined, undefined, FONTS[k][1]])} /></Block>
      <Block title="Corners"><Opts value={b.radius} cols={4} disabled={belowPro} onChange={v => set({ radius: Number(v) })} opts={[[0, 'Square'], [8, 'Sharp'], [16, 'Soft'], [24, 'Round']]} /></Block>
      <Block title="Density" hint="POS buttons never go below 56 px, whatever the density."><Opts value={b.density} disabled={belowPro} onChange={v => set({ density: v as StaffBrand['density'] })} opts={[['comfy', 'Comfortable'], ['compact', 'Compact']]} /></Block>
    </>,
    layout: () => <>
      <Block title="Sidebar style"><Opts value={b.side} cols={3} onChange={v => set({ side: String(v) })} opts={[['light', 'Light', undefined, b.c.surface], ['dark', 'Dark', undefined, b.c.sidebar], ['brand', 'Brand', undefined, b.c.primary]]} /></Block>
      <Block title="POS header"><Opts value={b.posHead} cols={3} disabled={belowPro} onChange={v => set({ posHead: String(v) })} opts={[['brand', 'Brand', undefined, b.c.primary], ['dark', 'Dark', undefined, 'var(--ink-950)'], ['light', 'Light', undefined, b.c.surface]]} /></Block>
      <Fields g={b as unknown as Group} set={(k, v: Val) => set({ [k]: !!v } as Partial<StaffBrand>)} fs={[f.tog('kdsLine', 'Brand line on kitchen display', 'Thin accent under the KDS header'), f.tog('powered', 'Show “Powered by BorNiz”', belowPro ? 'Removable on Pro and up' : 'Removable on your plan', belowPro ? 'Locked by plan' : undefined)]} />
    </>,
    preview: () => <>
      <Block title="Show"><Seg value={view} onChange={setView} options={[['dash', 'Dashboard'], ['pos', 'POS'], ['kds', 'Kitchen'], ['login', 'Login']]} /></Block>
      <LockedCard items={LOCKED_STAFF} />
      <Block title={`Plans · you are on ${plan[0].toUpperCase() + plan.slice(1)}`}>{PLANS.map(([n, d]) => <div key={n} className="row" style={{ alignItems: 'flex-start', fontSize: 13 }}><Badge tone={n.toLowerCase() === plan ? 'accent' : 'neutral'}>{n}</Badge><span className="muted">{d}</span></div>)}</Block>
      <ContrastCard checks={checks} />
    </>,
  };

  const doRelease = () => { const live = release('brand', b, user.id, note.trim() || 'Staff brand update'); toast(live ? 'Published · your team sees it on next load' : 'Sent to the owner for approval'); setConfirm(false); setNote(''); };
  return <>
    {!db.device.online && <div className="banner" style={{ background: 'var(--warning-soft)', color: 'var(--warning-fg)', marginBottom: 12 }}><Icon name="wifi-off" size={18} />Offline. Your draft is kept on this device; publishing waits until you are back online.</div>}
    <StudioFrame title="Brand studio" sub="Staff tools · dashboard, POS, kitchen display, login" groups={groups} current={current} status={status}
      panelTitle={T[page.slug]?.[1] ?? 'Brand studio'} panelSub={sub} panel={(panels[tool] ?? panels.colors)()}
      actions={<button className="btn btn-primary" disabled={!!blocked} title={blocked || undefined} onClick={() => setConfirm(true)}><Icon name="send" size={16} />{waiting ? 'Waiting for owner' : verb}</button>}
      previewBar={<><Seg value={view} onChange={setView} label="Staff screen" options={[['dash', 'Dashboard'], ['pos', 'POS'], ['kds', 'Kitchen'], ['login', 'Login']]} /><DeviceSeg value={device} onChange={setDevice} /></>}
      preview={<DeviceView device={device} height={device === 'phone' ? 760 : device === 'tablet' ? 900 : 720} label="Staff screen preview"><StaffPreview b={b} view={view} compact={device === 'phone'} /></DeviceView>} />
    <Sheet open={confirm} onClose={() => setConfirm(false)} side="center" title={owner ? 'Publish staff brand?' : 'Send to owner?'} sub={owner ? `Every dashboard, POS and kitchen display in ${db.tenant.name} switches on next load.` : 'The owner approves with their approval PIN.'}
      footer={<><button className="btn" onClick={() => setConfirm(false)}>Keep editing</button><button className="btn btn-primary" disabled={!!blocked} onClick={doRelease}>{verb}</button></>}>
      <div className="stack"><ContrastCard checks={checks} /><Field label="What changed" optional><input className="input" value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. New logo and sidebar" /></Field>
        {db.versions.filter(v => v.kind === 'brand' && v.status !== 'draft').slice(0, 3).map(v => <span key={v.id} className="faint" style={{ fontSize: 13 }}>{v.note} · {db.employees.find(e => e.id === v.by)?.name} · {ago(v.at)}</span>)}</div>
    </Sheet>
  </>;
}

function Scale({ primary }: { primary: string }) {
  const steps = [.92, .84, .68, .46, .22, 0, .14, .3, .46, .62].map((v, i) => i < 5 ? mix(primary, '#FFFFFF', v) : i === 5 ? primary : mix(primary, '#000000', v));
  const w = contrast('#FFFFFF', primary);
  return <Block title="Generated scale" hint={w >= MIN_RATIO ? `White on your color: ${w.toFixed(1)}:1.` : `${w.toFixed(1)}:1 with white. Buttons switch to dark text automatically; small links use a darker step.`}>
    <div className="row" style={{ gap: 2 }}>{steps.map((c, i) => <span key={i} title={c} style={{ flex: 1, height: 28, borderRadius: 6, background: c, boxShadow: i === 5 ? '0 0 0 2px var(--bg-surface),0 0 0 4px var(--fg-1)' : undefined }} />)}</div></Block>;
}

/** Staff screens in the draft brand, from live store data. Hex values are the merchant's staff brand. */
function StaffPreview({ b, view, compact }: { b: StaffBrand; view: string; compact: boolean }) {
  const { db, outletId } = useApp();
  const C = b.c, P = C.primary, onP = onColor(P), R = b.radius, dense = b.density === 'compact';
  const border = mix(C.surface, C.text, .1), sunken = mix(C.bg, C.text, .06), muted = mix(C.text, C.bg, .4);
  const side = sideBg(b), sideFg = onColor(side) === WHITE ? WHITE : C.text;
  const logo = sideFg === WHITE && b.logoMono ? b.logoMono : b.logo;
  const initials = b.workspace.split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
  const root: CSSProperties = { height: '100%', background: C.bg, color: C.text, fontFamily: FONTS[b.font]?.[1], fontVariantNumeric: 'tabular-nums', fontSize: dense ? 13 : 14 };
  const card: CSSProperties = { background: C.surface, borderRadius: R, boxShadow: `0 0 0 1px ${border}`, padding: dense ? 12 : 16 };
  const Tile = ({ s = 36, fg = sideFg }: { s?: number; fg?: string }) => <span style={{ width: s, height: s, borderRadius: Math.round(R * .6), background: logo ? `url(${logo}) center/80% no-repeat` : fg === WHITE ? WHITE : P, color: fg === WHITE ? P : onP, display: 'grid', placeItems: 'center', fontWeight: 800, flex: 'none' }}>{!logo && initials}</span>;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const paid = db.orders.filter(o => o.status === 'paid' && (o.paidAt ?? 0) >= today.getTime());
  const revenue = paid.reduce((a, o) => a + o.total, 0);
  const powered = b.powered && <span style={{ fontSize: 12, opacity: .6 }}>Powered by BorNiz</span>;

  if (view === 'login') return <div style={{ ...root, display: 'grid', placeItems: 'center', background: b.loginImg ? `url(${b.loginImg}) center/cover` : `linear-gradient(135deg,${C.loginTint},${mix(C.loginTint, '#000000', .45)})`, padding: 20 }}>
    <div style={{ ...card, width: 'min(360px,100%)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, padding: 24 }}>
      <Tile s={56} fg={C.text} /><b style={{ fontSize: 20 }}>{b.loginTitle}</b><span style={{ color: muted }}>{b.workspace} · enter your PIN</span>
      <div style={{ display: 'flex', gap: 12 }}>{[0, 1, 2, 3].map(i => <i key={i} style={{ width: 14, height: 14, borderRadius: 99, border: `2px solid ${C.text}`, background: i < 2 ? C.text : 'transparent' }} />)}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, width: '100%' }}>{['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].map((k, i) => <span key={i} style={{ height: 56, borderRadius: Math.round(R * .6), background: k ? sunken : 'transparent', display: 'grid', placeItems: 'center', fontSize: 22, fontWeight: 700 }}>{k}</span>)}</div>
      {powered}</div></div>;

  if (view === 'kds') {
    const tickets = db.orders.filter(o => o.outletId === outletId && ['sent', 'preparing'].includes(o.status)).slice(0, 6);
    return <div data-theme="dark" style={{ ...root, background: 'var(--bg-canvas)', color: 'var(--fg-1)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', background: 'var(--bg-surface)', borderBottom: `3px solid ${b.kdsLine ? mix(P, '#FFFFFF', .22) : 'var(--border)'}` }}><Tile s={32} fg="#FFFFFF" /><b style={{ flex: 1 }}>{b.workspace} · Kitchen</b><span>{tickets.length} open</span></div>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${compact ? 1 : 3},1fr)`, gap: 12, padding: 16 }}>{tickets.length ? tickets.map(o => { const mins = (Date.now() - o.createdAt) / 60e3;
        return <div key={o.id} style={{ background: 'var(--bg-surface)', borderRadius: R, overflow: 'hidden', fontSize: 15 }}><div style={{ padding: '8px 12px', background: mins > 12 ? 'var(--danger)' : mins > 8 ? 'var(--warning)' : 'var(--border)', display: 'flex', justifyContent: 'space-between' }}><b>{o.table ?? o.no}</b><span>{ago(o.createdAt)}</span></div>
          <div style={{ padding: 12 }}>{o.lines.map(l => <div key={l.id}>{l.qty}× {l.name}</div>)}</div><div style={{ margin: 12, height: 56, borderRadius: Math.round(R * .6), background: 'var(--success)', color: 'var(--ink-0)', display: 'grid', placeItems: 'center', fontWeight: 700 }}>Bump</div></div>; })
        : <span style={{ opacity: .6 }}>No open tickets at this outlet right now.</span>}</div></div>;
  }

  if (view === 'pos') {
    const head = b.posHead === 'brand' ? P : b.posHead === 'dark' ? INK : C.surface, headFg = onColor(head) === WHITE ? WHITE : C.text;
    const prods = db.products.filter(p => p.status === 'live').slice(0, compact ? 6 : 12);
    const o = db.orders.filter(x => x.outletId === outletId && x.lines.length).sort((a, c) => c.createdAt - a.createdAt)[0];
    return <div style={{ ...root, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: head, color: headFg, boxShadow: `0 1px 0 ${border}` }}><Tile s={32} fg={headFg} /><b>{b.workspace}</b><span style={{ flex: 1, height: 36, borderRadius: 99, background: headFg === WHITE ? 'rgba(255,255,255,.18)' : sunken, padding: '0 14px', display: 'flex', alignItems: 'center', opacity: .8 }}>Search menu or scan barcode</span></div>
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <div style={{ flex: 1, padding: 12, display: 'grid', gridTemplateColumns: `repeat(${compact ? 2 : 4},1fr)`, gap: 8, alignContent: 'start' }}>{prods.map((p, i) => <div key={p.id} style={{ ...card, padding: 10, minHeight: 72, boxShadow: `0 0 0 ${i ? 1 : 2}px ${i ? border : P}` }}><b>{p.name}</b><div style={{ color: muted }}>{idr(priceAt(db, p, outletId))}</div></div>)}</div>
        {!compact && <div style={{ width: 280, background: C.surface, borderLeft: `1px solid ${border}`, padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}><b>Order {o?.no}</b>
          {o?.lines.map(l => <div key={l.id} style={{ display: 'flex', justifyContent: 'space-between' }}><span>{l.qty}× {l.name}</span><span>{(l.unitPrice * l.qty).toLocaleString('en-US')}</span></div>)}
          <div style={{ marginTop: 'auto', height: 72, borderRadius: R, background: P, color: onP, display: 'grid', placeItems: 'center', fontSize: 20, fontWeight: 700 }}>Charge {o ? idr(o.total) : ''}</div></div>}
      </div></div>;
  }

  const days = Array.from({ length: 14 }, (_, i) => { const s = today.getTime() - (13 - i) * 864e5; return db.orders.filter(o => o.status === 'paid' && (o.paidAt ?? 0) >= s && (o.paidAt ?? 0) < s + 864e5).reduce((a, o) => a + o.total, 0); });
  const max = Math.max(1, ...days), waiting = db.approvals.filter(a => a.status === 'waiting').slice(0, 3);
  const kpis: [string, string][] = [['Revenue today', idrShort(revenue)], ['Transactions', String(paid.length)], ['Avg ticket', idrShort(paid.length ? revenue / paid.length : 0)], ['Open orders', String(db.orders.filter(o => ['open', 'sent', 'preparing'].includes(o.status)).length)]];
  return <div style={{ ...root, display: 'flex' }}>
    {!compact && <aside style={{ width: 210, background: side, color: sideFg, padding: 14, display: 'flex', flexDirection: 'column', gap: 4, borderRight: b.side === 'light' ? `1px solid ${border}` : 0 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12 }}><Tile /><b>{b.workspace}</b></div>
      {[['Live monitor', 'activity'], ['Overview', 'layout-dashboard'], ['Sales', 'receipt'], ['Products', 'package'], ['Inventory', 'boxes'], ['Customers', 'users'], ['Team', 'user-cog'], ['Settings', 'settings']].map(([l, ic], i) =>
        <span key={l} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 10px', borderRadius: Math.round(R * .6), background: i === 0 ? (sideFg === WHITE ? 'rgba(255,255,255,.14)' : mix(P, C.surface, .88)) : 'transparent', fontWeight: i === 0 ? 700 : 500 }}><Icon name={ic} size={16} />{l}</span>)}
      <span style={{ marginTop: 'auto' }}>{powered}</span></aside>}
    <div style={{ flex: 1, padding: dense ? 14 : 20, display: 'flex', flexDirection: 'column', gap: dense ? 10 : 14, minWidth: 0 }}>
      <b style={{ fontSize: 22 }}>Live monitor</b>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${compact ? 2 : 4},1fr)`, gap: 10 }}>{kpis.map(([l, v], i) => <div key={l} style={{ ...card, background: i === 0 ? C.kpi : C.surface, color: i === 0 ? onColor(C.kpi) : C.text, boxShadow: i === 0 ? 'none' : card.boxShadow }}><span style={{ fontSize: 12, opacity: .8 }}>{l}</span><b style={{ display: 'block', fontSize: 22 }}>{v}</b></div>)}</div>
      <div style={{ ...card, display: 'flex', alignItems: 'flex-end', gap: 4, height: 160 }}>{days.map((v, i) => <span key={i} style={{ flex: 1, height: Math.max(4, (v / max) * 100) + '%', background: i === 13 ? P : mix(P, C.surface, .7), borderRadius: 4 }} />)}</div>
      <div style={card}><b>Approvals waiting · {waiting.length}</b>{waiting.map(a => <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderTop: `1px solid ${border}` }}><span>{a.title}</span><span className="badge b-warning">Waiting</span></div>)}</div>
    </div></div>;
}
