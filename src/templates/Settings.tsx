'use client';
// SETTINGS template: grouped configuration. Toggles auto-save; text fields save explicitly; danger zone last.
// Manager changes on owner-gated settings become an approval ("Send to owner"); the owner signs with the approval PIN.
import { useState, type ReactNode } from 'react';
import authority from '../system/authority.json' with { type: 'json' };
import alerts from '../system/alerts.json' with { type: 'json' };
import { STAFF_WA } from '../data/alerts/staff.ts';
import { useApp } from '../app/context.tsx';
import { isGated } from '../system/access.ts';
import { Badge, Field, Icon, Toggle, toast } from '../ui/kit.tsx';
import { usePin } from '../ui/PinSheet.tsx';
import { patchOutlet, requestApproval, setLocks, setSetting, setStation } from '../data/actions.ts';
import { resetDemo, snapshot } from '../data/store.ts';
import { LIMITS } from '../domain/approval.ts';
import { idr } from '../domain/money.ts';
import { PageHead } from './common.tsx';
import { IntegrationsPanel } from '../integrations/Panel.tsx';
import { ConnectDevice } from '../devices/Connect.tsx';
import { BusinessProfile, LabelPrinting, OutletDetail, Outlets, ProfileSecurity, ReceiptDesigner, Referral, Users } from './settingsPages.tsx';
import { CANON } from '../system/settings.ts';
import { CHANNELS, channelState, setChannel } from '../data/actions/online.ts';
import { downloadJournalCsv } from '../integrations/server/accounting/journal.ts';

type Section = { t: string; body: ReactNode };

export default function Settings() {
  const app = useApp();
  const { page, db, user } = app;
  const pin = usePin();
  const gated = isGated(user.role, page) || (user.role === 'manager' && /(tax|payment method|franchise|limit|api|backup|delete|bank)/i.test(page.name));
  const key = (id: string) => (CANON[id] ?? page.path) + ':' + id; // one switch, one key, whichever page shows it
  const get = (id: string, d: boolean | string | number) => db.settings[key(id)] ?? d;
  const set = (id: string, v: boolean | string | number, label: string) => {
    if (gated) { requestApproval({ type: 'perm', title: `${page.title} · ${label} → ${typeof v === 'boolean' ? (v ? 'on' : 'off') : v}`, requestedBy: user.id, outletId: app.outletId, payload: { settingKey: key(id), settingValue: v } }); toast('Sent to owner for approval'); return; }
    setSetting(key(id), v, user.id); toast('Saved · applies to every device now');
  };
  const T = (id: string, l: string, d: string, def = true, locked = false) => <div key={id} className="row" style={{ padding: '12px 0', borderTop: '1px solid var(--border)', alignItems: 'flex-start' }}>
    <div className="grow stack" style={{ gap: 2 }}><b style={{ fontSize: 14, fontFamily: 'var(--font-body)' }}>{l}{locked && <Badge tone="neutral"><Icon name="lock" size={12} />Locked</Badge>}</b><span className="muted" style={{ fontSize: 13 }}>{d}</span></div>
    {locked ? <Toggle on onChange={() => toast('This can’t be turned off')} label={l} /> : <Toggle on={Boolean(get(id, def))} onChange={v => set(id, v, l)} label={l} />}</div>;

  const sections = build();
  const [cur, setCur] = useState(0);
  const s = sections[Math.min(cur, sections.length - 1)];
  return <>
    <PageHead />
    {gated && <div className="banner b-info"><Icon name="send" size={18} />You are signed in as manager: changes here are sent to the owner and apply once approved.</div>}
    <div className="row" style={{ alignItems: 'flex-start', gap: 20, flexWrap: 'wrap' }}>
      {sections.length > 1 && <nav className="stack sm hide-sm" style={{ width: 200, flex: 'none' }}>{sections.map((x, i) => <button key={x.t} className="nav-i" style={{ border: 0, background: i === cur ? 'var(--role-soft)' : 'none', color: i === cur ? 'var(--role-fg)' : undefined, cursor: 'pointer', textAlign: 'left' }} onClick={() => setCur(i)}>{x.t}</button>)}</nav>}
      {sections.length > 1 && <select className="input only-sm" value={cur} onChange={e => setCur(Number(e.target.value))} aria-label="Section">{sections.map((x, i) => <option key={x.t} value={i}>{x.t}</option>)}</select>}
      <section className="card stack grow" style={{ minWidth: 0, flexBasis: 420 }}><h2>{s.t}</h2>{s.body}</section>
    </div>
    {pin.sheet}
  </>;

  function build(): Section[] {
    const n = page.name.toLowerCase();
    if (/business profile/.test(n)) return [{ t: 'Business profile', body: <BusinessProfile /> }];
    if (/profile & security/.test(n)) return [{ t: 'Profile & security', body: <ProfileSecurity /> }];
    if (/receipt designer/.test(n)) return [{ t: 'Receipt', body: <ReceiptDesigner /> }];
    if (/label printing/.test(n)) return [{ t: 'Labels', body: <LabelPrinting /> }];
    if (/referral/.test(n)) return [{ t: 'Invite a friend', body: <Referral /> }];
    if (/^outlets$/.test(n)) return [{ t: 'Outlets', body: <Outlets /> }];
    if (/outlet detail/.test(n)) return [{ t: 'Outlet', body: <OutletDetail /> }];
    if (/users & invites/.test(n)) return [{ t: 'Staff', body: <Users /> }];
    if (/accounting/.test(n)) return [{ t: 'Accounting', body: <IntegrationsPanel kinds={['accounting']} /> }, { t: 'Journal export', body: <JournalExport /> }];
    if (/bank account/.test(n)) return [{ t: 'Bank & payouts', body: <IntegrationsPanel kinds={['bank']} /> }];
    if (/tax|fees/.test(n)) return db.outlets.map(o => ({ t: o.name, body: <OutletTax o={o} /> }));
    if (/opening hours/.test(n)) return [{ t: 'Opening hours', body: <div className="stack">{db.outlets.map(o => <OutletHours key={o.id} o={o} />)}</div> }];
    if (/payment method/.test(n)) return [{ t: 'Payment gateway', body: <IntegrationsPanel kinds={['payment']} /> }, { t: 'Card terminals (EDC)', body: <IntegrationsPanel kinds={['edc']} /> }, { t: 'QR & e-wallet', body: <>{T('qris', 'QRIS', 'All banks & e-wallets · dynamic QR, expires in 5 min')}{T('ewallet', 'GoPay / OVO / DANA / ShopeePay', 'Push to customer app')}{T('va', 'Virtual account', 'BCA · BNI · Mandiri · BRI', false)}</> },
      { t: 'Card & cash', body: <>{T('card', 'Card via EDC', 'BCA EDC · Terminal 01')}{T('cash', 'Cash', 'Numpad, quick notes and change', true, true)}{T('rounding', 'Cash rounding', 'A separate line, applied last, on cash only')}
        {get('rounding', true) && <Field label="Round cash to"><select className="input" value={String(get('roundStep', 100))} onChange={e => set('roundStep', Number(e.target.value), 'Round cash to')}>{[100, 500, 1000].map(v => <option key={v} value={v}>IDR {v.toLocaleString('en-US')}</option>)}</select></Field>}{T('split', 'Split bill', 'Evenly, by item or custom amounts')}</> },
      { t: 'Credit & deposits', body: <>{T('kasbon', 'Customer credit (kasbon)', 'Over limit goes to the manager', false)}{T('deposit', 'Deposits & gift cards', 'Pay from balance')}</> }];
    if (/franchise|brand lock|lock \(/.test(n)) return [{ t: 'Franchise lock', body: <>
      <p className="muted">HQ decides what outlets may change. Changing a lock needs the owner’s approval PIN.</p>
      {([['menuPrices', 'Menu prices', 'Outlets can’t set local prices (±10% band is off)'], ['outletOnlyItems', 'Allow outlet-only items', 'Managers may add local items that wait for the owner'], ['brand', 'Brand elements', 'Logo, colors and fonts are set by HQ only']] as const).map(([k, l, d]) =>
        <div key={k} className="row" style={{ padding: '12px 0', borderTop: '1px solid var(--border)' }}><div className="grow stack" style={{ gap: 2 }}><b style={{ fontSize: 14 }}>{l}</b><span className="muted" style={{ fontSize: 13 }}>{d}</span></div>
          <Toggle on={db.tenant.locks[k]} label={l} onChange={v => user.role === 'owner' ? pin.ask({ title: `${l} → ${v ? 'on' : 'off'}`, onOk: by => { setLocks({ [k]: v }, by); toast('Lock updated on every outlet'); } }) : (requestApproval({ type: 'perm', title: `Franchise lock · ${l} → ${v ? 'on' : 'off'}`, requestedBy: user.id, outletId: app.outletId }), toast('Sent to owner'))} /></div>)}
    </> }];
    if (/(limits|approval flow)/.test(n)) return [{ t: 'Approval ladder', body: <div className="stack">
      {authority.ladder.map(([who, can, cant, esc]) => <div key={who} className="sunken stack sm"><b>{who}</b><span style={{ fontSize: 14 }}>{can}</span><span className="muted" style={{ fontSize: 13 }}>Can’t: {cant}</span><span className="faint" style={{ fontSize: 12 }}>Escalation: {esc}</span></div>)}
      <div className="row wrap"><Badge tone="info">Discount: cashier ≤ {LIMITS.cashierDiscountPct}% · PIC ≤ {LIMITS.picDiscountPct}%</Badge><Badge tone="info">Void / refund / cash out: PIC ≤ {idr(LIMITS.pic)}</Badge><Badge tone="info">Variance / waste: PIC ≤ {idr(LIMITS.picVariance)}</Badge><Badge tone="info">Manager ≤ {idr(LIMITS.manager)}</Badge></div>
      {T('pin-every', 'Approval PIN on every decision', '6 digits, separate from the password, 5 wrong tries lock 15 min', true, true)}
      {T('timeouts', 'Escalate when unanswered', 'PIC 5 min → manager 30 min → owner')}</div> }];
    if (/routing/.test(n)) return [{ t: 'Kitchen stations', body: <div className="stack">{db.categories.map(c => <div key={c.id} className="row between"><b style={{ fontSize: 14 }}>{c.name}</b>
      <select className="input" style={{ width: 180 }} value={c.station} onChange={e => { setStation(c.id, e.target.value as typeof c.station, user.id); toast(`${c.name} → ${e.target.value} station`); }}><option value="bar">Bar</option><option value="kitchen">Kitchen</option><option value="pastry">Pastry</option></select></div>)}
      {T('expo', 'Expo / pass screen sees the whole order', 'Runner checks every station before serving')}{T('print-ticket', 'Print kitchen ticket as backup', 'When the KDS is offline', false)}</div> },
      { t: 'Kitchen & receipt printers', body: <IntegrationsPanel kinds={['printer']} /> }];
    if (/notification/.test(n)) return [{ t: 'WhatsApp to staff', body: <>{T('staff-wa', 'Send WhatsApp to staff', `${STAFF_WA.size} alerts also go to the phone of the staff they are for (${[...STAFF_WA.keys()].slice(0, 3).join(', ')} …). Needs a WhatsApp connection; each message costs the business. In the app they always arrive.`, false)}</> },
      ...(alerts.groups as [string, string, [string, string, unknown, string, string][]][]).map(([g, , list]) => ({ t: g.charAt(0) + g.slice(1).toLowerCase(), body: <>{list.map(a => T('al-' + a[0], a[0], a[1] + ' · ' + a[3], true, /fraud|audit|pin locked|cash variance/i.test(a[0] + g)))}</> }))];
    if (/devices|kiosk management/.test(n)) return [{ t: 'Connect a device', body: <ConnectDevice /> }, { t: 'Printers', body: <IntegrationsPanel kinds={['printer']} /> }, { t: 'Card terminals (EDC)', body: <IntegrationsPanel kinds={['edc']} /> },
      { t: 'Cash drawers', body: <IntegrationsPanel kinds={['drawer']} /> }, { t: 'Scanners & scales', body: <IntegrationsPanel kinds={['scanner', 'scale']} /> }, { t: 'Customer displays', body: <IntegrationsPanel kinds={['display']} /> }, { t: 'Paired devices', body: <div className="stack">{db.devices.map(d => <div key={d.id} className="row between"><span className="row"><Icon name={d.kind === 'printer' ? 'printer' : d.kind === 'kds' ? 'chef-hat' : d.kind === 'display' ? 'monitor' : d.kind === 'edc' ? 'credit-card' : 'tablet'} size={18} />{d.name} · {db.outlets.find(o => o.id === d.outletId)?.name}</span><Badge tone={d.status === 'online' ? 'success' : 'danger'} dot>{d.status}</Badge></div>)}
      <PairCode /></div> }];
    if (/api key|webhook/.test(n)) return [{ t: 'API keys', body: <ApiKeys /> }, { t: 'Webhook endpoints', body: <IntegrationsPanel kinds={['webhook']} /> }];
    if (/backup|delete account/.test(n)) return [{ t: 'Export', body: <button className="btn" onClick={() => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(snapshot(), null, 1)], { type: 'application/json' })); a.download = 'borniz-backup.json'; a.click(); }}><Icon name="download" size={18} />Download full backup (JSON)</button> },
      { t: 'Danger zone', body: <Danger /> }];
    if (/language|currency|number/.test(n)) return [{ t: 'Language & currency', body: <div className="stack"><Field label="Language guests see first" hint="QR menu and kiosk open in this language; guests can still switch."><select className="input" value={String(get('lang', 'en'))} onChange={e => set('lang', e.target.value, 'Language')}><option value="en">English</option><option value="id">Bahasa Indonesia</option></select></Field>
      <Field label="Money format"><select className="input" value={String(get('fmt', 'idr'))} onChange={e => set('fmt', e.target.value, 'Money format')}><option value="idr">IDR 25,000 · charts IDR 2,4 jt</option><option value="rp">Rp25.000</option></select></Field></div> }];
    if (/(integration|channel|ride-hailing|online order link)/.test(n)) return [{ t: 'Delivery apps', body: <IntegrationsPanel kinds={['delivery']} /> },
      { t: 'Auto-accept per outlet', body: <div className="stack">{db.outlets.map(o => <div key={o.id} className="stack sm"><b style={{ fontSize: 14 }}>{o.name}</b>
        <div className="row wrap">{CHANNELS.map(ch => { const st = channelState(db, o.id, ch); return <label key={ch} className="row" style={{ gap: 8 }}><Toggle on={st.auto} onChange={v => { setChannel(o.id, ch, 'auto', v, user.id); toast(`${ch} ${v ? 'auto-accepts' : 'waits for a person'} at ${o.name}`); }} label={`Auto-accept ${ch} at ${o.name}`} /><span style={{ fontSize: 14 }}>{ch}</span></label>; })}</div></div>)}
        <span className="muted" style={{ fontSize: 13 }}>Same switches as the online orders screen at each outlet. Accepted orders go to the POS inbox and the KDS; prices, photos and sold-out sync from Menu Studio.</span></div> }];
    return [{ t: page.title, body: <p className="muted">Nothing to set on this page yet.</p> }];
  }
}

function OutletTax({ o }: { o: { id: string; name: string; serviceBps: number; taxBps: number; taxInclusive: boolean } }) {
  const { user } = useApp(); const pin = usePin();
  const [f, setF] = useState({ svc: String(o.serviceBps / 100), tax: String(o.taxBps / 100), inc: o.taxInclusive });
  const save = () => { const patch = { serviceBps: Math.round(Number(f.svc) * 100), taxBps: Math.round(Number(f.tax) * 100), taxInclusive: f.inc };
    if (user.role !== 'owner') { requestApproval({ type: 'perm', title: `Tax & fees ${o.name}: service ${f.svc}% · tax ${f.tax}%${f.inc ? ' incl.' : ''}`, requestedBy: user.id, outletId: o.id, payload: { outletPatch: { id: o.id, patch } } }); toast('Sent to owner'); return; }
    pin.ask({ title: `Tax & fees · ${o.name}`, onOk: by => { patchOutlet(o.id, patch, by); toast('Saved · every register uses it on the next order'); } }); };
  return <div className="stack">
    <div className="grid" style={{ ['--min' as string]: '160px' }}><Field label="Service charge %"><input className="input" inputMode="decimal" value={f.svc} onChange={e => setF({ ...f, svc: e.target.value })} /></Field><Field label="PB1 / PPN %"><input className="input" inputMode="decimal" value={f.tax} onChange={e => setF({ ...f, tax: e.target.value })} /></Field></div>
    <label className="row"><Toggle on={f.inc} onChange={v => setF({ ...f, inc: v })} label="Tax inclusive" />Prices include tax (back-calculated at checkout)</label>
    <div><button className="btn btn-primary" onClick={save}>{user.role === 'owner' ? 'Save' : 'Send to owner'}</button></div>{pin.sheet}
  </div>;
}
function OutletHours({ o }: { o: { id: string; name: string; opens: string; closes: string } }) {
  const { user } = useApp(); const [f, setF] = useState({ opens: o.opens, closes: o.closes });
  return <div className="row wrap" style={{ alignItems: 'flex-end' }}><b style={{ width: 100 }}>{o.name}</b><Field label="Opens"><input className="input" type="time" value={f.opens} onChange={e => setF({ ...f, opens: e.target.value })} /></Field><Field label="Closes"><input className="input" type="time" value={f.closes} onChange={e => setF({ ...f, closes: e.target.value })} /></Field>
    <button className="btn" onClick={() => { patchOutlet(o.id, f, user.id); toast(`${o.name} hours saved · QR menu shows “closed” outside them`); }}>Save</button></div>;
}
function PairCode() {
  const [c, setC] = useState<{ code: string; until: number } | null>(null);
  return <div className="sunken row between wrap"><span>{c ? <>Pairing code <b className="mono" style={{ fontSize: 22 }}>{c.code}</b> · expires {new Date(c.until).toTimeString().slice(0, 5)} · single use</> : 'Pair a new POS, KDS, display or kiosk'}</span>
    <button className="btn btn-primary" onClick={() => setC({ code: String(Math.floor(100000 + Math.random() * 900000)), until: Date.now() + 10 * 60e3 })}>New pairing code</button></div>;
}
function ApiKeys() {
  const [k, setK] = useState<string | null>(null);
  return <div className="stack"><p className="muted">Keys are shown once. Every call is scoped to your tenant and logged.</p>{k && <code className="sunken mono" style={{ wordBreak: 'break-all' }}>{k}</code>}
    <div><button className="btn btn-primary" onClick={() => setK('bn_live_' + Array.from(crypto.getRandomValues(new Uint8Array(20)), b => b.toString(16).padStart(2, '0')).join(''))}>Create API key</button></div></div>;
}
function Danger() {
  const { user, db } = useApp(); const [t, setT] = useState('');
  return <div className="stack" style={{ border: '1px solid var(--danger)', borderRadius: 16, padding: 16 }}>
    <b>Reset demo data</b><p className="muted">Restores the Kopi Biru demo. Production accounts are deleted only by the owner after a 14-day hold; data is exported first.</p>
    <Field label={`Type ${db.tenant.name} to confirm`}><input className="input" value={t} onChange={e => setT(e.target.value)} /></Field>
    <div><button className="btn btn-danger" disabled={t !== db.tenant.name || user.role !== 'owner'} onClick={() => { resetDemo(); toast('Demo data restored'); }}>Reset everything</button></div>
  </div>;
}

/** Daily journal (sales, PB1, service, discounts, payments per method, refunds) from the one sales math, for any accounting tool. */
function JournalExport() {
  const { db } = useApp();
  const [out, setOut] = useState('all'), [days, setDays] = useState(30);
  const csv = db.integrations.find(i => i.connector === 'journal-csv');
  return <div className="stack">
    <div className="row wrap"><Field label="Outlet"><select className="input" value={out} onChange={e => setOut(e.target.value)}><option value="all">All outlets</option>{db.outlets.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></Field>
      <Field label="Period"><select className="input" value={days} onChange={e => setDays(Number(e.target.value))}>{[7, 30, 90].map(d => <option key={d} value={d}>Last {d} days</option>)}</select></Field></div>
    <button className="btn btn-primary" style={{ alignSelf: 'flex-start' }} onClick={() => { const to = Date.now(); downloadJournalCsv(db, out, { from: to - days * 864e5, to }, csv?.config); toast('Journal CSV downloaded'); }}><Icon name="download" size={18} />Export journal CSV</button>
  </div>;
}
