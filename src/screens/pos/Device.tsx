'use client';
// Register hardware and local settings: printer & drawer, customer display pairing, EDC, scanner & scale,
// register settings, sync status & offline queue.
import { roundStep } from '../../system/settings.ts';
import { useState } from 'react';
import { setDeviceOnline, setSetting } from '../../data/actions.ts';
import { issuePairCode, pairDevice, pairExpiry } from '../../data/actions/auth.ts';
import { flushQueue } from '../../data/actions/pos.ts';
import { idr } from '../../domain/money.ts';
import { Badge, Empty, Field, Icon, Seg, Status, Toggle, ago, hhmm, toast, useNow } from '../../ui/kit.tsx';
import type { Device, Integration } from '../../data/schema.ts';
import { IntegrationsPanel } from '../../integrations/Panel.tsx';
import { HardwareList, PrintQueue, ReadScale } from '../../devices/ui.tsx';
import { ConnectDevice } from '../../devices/Connect.tsx';
import { ownerOf, receiptPrinter, stationPrinter, thisDevice } from '../../devices/routing.ts';
import { edcDriver } from '../../devices/edc.ts';
import { findByCode, useWedgeScanner } from '../../devices/scanner.ts';
import { P, Row, SETTINGS_PATH, TabLinks, usePos, usePerm, warnStyle } from './shared.tsx';

export function DeviceView() {
  const { route } = usePos();
  const tab = route.t ?? 'printer';
  return <div className="pos-page stack lg">
    <h1>Device</h1>
    <ConnectDevice />
    <TabLinks active={tab} tabs={[['printer', 'Printer & drawer', 'printer-and-drawer-connection'], ['display', 'Customer display', 'customer-display-pairing'], ['edc', 'EDC', 'edc-pairing'],
      ['scanner', 'Scanner & scale', 'barcode-scanner-and-scale-test'], ['settings', 'Register settings', 'register-settings'], ['sync', 'Sync & offline', 'sync-status-and-retry']]} />
    {tab === 'printer' ? <Printer /> : tab === 'display' ? <Display /> : tab === 'edc' ? <Edc /> : tab === 'scanner' ? <Scanner /> : tab === 'settings' ? <Settings /> : <Sync />}
  </div>;
}

function DevRow({ d, children }: { d: Device; children?: React.ReactNode }) {
  return <div className="row card tight wrap"><Icon name={d.kind === 'display' ? 'monitor' : 'tablet'} />
    <span className="grow stack" style={{ gap: 0, minWidth: 160 }}><b>{d.name}</b><span className="muted" style={{ fontSize: 13 }}>Last seen {ago(d.lastSeen)}</span></span><Status s={d.status} />{children}</div>;
}
const devs = (db: ReturnType<typeof usePos>['db'], outletId: string, kind: Device['kind']) => db.devices.filter(d => d.outletId === outletId && d.kind === kind);

const PRINT_KINDS: Integration['kind'][] = ['printer', 'drawer'];
function Printer() {
  const { db, outletId, me, go } = usePos();
  const can = usePerm();
  const dev = thisDevice(db);
  const route = db.categories.map(c => [c.name, c.station, stationPrinter(db, outletId, c.station)?.name] as const);
  const rcpt = receiptPrinter(db, outletId, dev);
  return <div className="grid" style={{ ['--min' as string]: '340px', alignItems: 'start' }}>
    <div className="stack">
      <PrintQueue deviceId={dev} />
      <HardwareList db={db} deviceId={dev} kinds={PRINT_KINDS} by={me.id} />
      <IntegrationsPanel kinds={PRINT_KINDS} outletId={outletId} deviceId={dev} />
    </div>
    <div className="stack">
      <div className="card stack"><h3>Where tickets print</h3>
        <Row l="Receipts" v={rcpt ? rcpt.name + (rcpt.config.autoPrint ? ' · auto' : '') : 'No printer · WhatsApp or e-mail only'} />
        {route.map(([n, st, p]) => <Row key={n} l={`${n} · ${st}`} v={p ?? 'KDS only'} />)}
        <span className="faint" style={{ fontSize: 13 }}>New items print once on their station printer the moment they are sent. Stations per category are set in Owner › Printer & KDS routing.</span></div>
      <div className="card stack"><h3>Cash drawer</h3><p className="muted" style={{ fontSize: 14 }}>The drawer opens on cash payments through the receipt printer’s kick port. Opening it without a sale needs a PIN override. Every open is logged.</p>
        <button className="btn btn-pos" style={{ alignSelf: 'flex-start', ...warnStyle(can('Open drawer without sale')) }} onClick={() => go(P('manager-pin-override'))}><Icon name="archive" />Open drawer without sale</button></div>
    </div>
  </div>;
}

function Display() {
  const { db, outletId, me, cur, go } = usePos();
  const now = useNow(1000);
  const list = devs(db, outletId, 'display');
  const [code, setCode] = useState(''), [err, setErr] = useState('');
  return <div className="grid" style={{ ['--min' as string]: '320px', alignItems: 'start' }}>
    <div className="stack">{list.length === 0 ? <Empty icon="monitor" title="No customer display" /> : list.map(d => { const exp = pairExpiry(db, d.id), left = Math.max(0, Math.ceil((exp - now) / 1000));
      return <div key={d.id} className="card stack"><DevRow d={d} />
        {d.pairCode && left > 0 ? <div className="sunken stack sm" style={{ alignItems: 'center' }}><span className="muted">Type this code on the display</span><b className="mono" style={{ fontSize: 36, letterSpacing: '.2em' }}>{d.pairCode}</b><span className="faint" style={{ fontSize: 13 }}>Valid {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}</span></div>
          : <button className="btn btn-primary btn-pos" onClick={() => issuePairCode(d.id, me.id)}>Show a 6-digit pairing code</button>}
        <form className="row" onSubmit={e => { e.preventDefault(); const r = pairDevice(d.id, code.trim()); if (r) setErr(r); else { setErr(''); setCode(''); toast(`${d.name} paired`); } }}>
          <input className="input mono grow" inputMode="numeric" maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} placeholder="Or enter the code from the display" aria-label="Pairing code" />
          <button className="btn" style={{ height: 48 }} disabled={code.length !== 6}>Pair</button></form>
        {err && <span style={{ color: 'var(--danger-fg)', fontSize: 14 }} role="alert">{err}</span>}
      </div>; })}
      <button className="btn" onClick={() => go('/display/pairing-with-register')}><Icon name="external-link" size={18} />Open the customer display</button>
      <HardwareList db={db} deviceId={thisDevice(db)} kinds={['display']} by={me.id} />
      <IntegrationsPanel kinds={['display']} outletId={outletId} deviceId={thisDevice(db)} />
    </div>
    <div className="card stack"><h3>What the guest sees now</h3>{cur?.lines.length ? <>{cur.lines.map(l => <Row key={l.id} l={`${l.qty}× ${l.name}`} v={idr((l.flashPrice ?? l.unitPrice) * l.qty)} />)}<Row l="Total" v={idr(cur.total)} strong /></> : <p className="muted">Idle · promo slideshow. The live cart mirrors the current order.</p>}</div>
  </div>;
}

function Edc() {
  const { db, outletId, me } = usePos();
  const dev = thisDevice(db);
  const edc = db.integrations.find(i => i.kind === 'edc' && i.enabled && ownerOf(db, i) === dev);
  return <div className="grid" style={{ ['--min' as string]: '340px', alignItems: 'start' }}>
    <div className="stack">
      <div className={'banner ' + (edc ? 'b-info' : 'b-warning')}><Icon name="credit-card" /><span>{edc ? <>Card payments on this register use <b>{edc.name}</b>{edcDriver(edc).mode === 'pending' ? '. Its ECR driver is pending, so the cashier types the approval code from the slip.' : edcDriver(edc).mode === 'manual' ? ': key the amount on the EDC, then type the approval code from the slip.' : '.'}</> : 'No EDC set up. Card payments ask for the approval code from any standalone EDC slip.'}</span></div>
      <HardwareList db={db} deviceId={dev} kinds={['edc']} by={me.id} />
    </div>
    <IntegrationsPanel kinds={['edc']} outletId={outletId} deviceId={dev} />
  </div>;
}

function Scanner() {
  const { db, outletId, me } = usePos();
  const dev = thisDevice(db);
  const wedge = db.integrations.find(i => i.connector === 'scanner-wedge' && i.enabled && ownerOf(db, i) === dev);
  const [hits, setHits] = useState<string[]>([]), [w, setW] = useState(0), [tare, setTare] = useState(0);
  const hit = (code: string) => { const p = findByCode(db, code); setHits(h => [`${code} → ${p ? p.name + (db.outletProducts.find(x => x.productId === p.id && x.outletId === outletId)?.is86 ? ' (sold out)' : '') : 'no product with this SKU'}`, ...h].slice(0, 8)); };
  useWedgeScanner(hit, { minLength: Number(wedge?.config.minLength) || undefined, maxGap: Number(wedge?.config.maxGap) || undefined });
  const [typed, setTyped] = useState('');
  return <div className="grid" style={{ ['--min' as string]: '340px', alignItems: 'start' }}>
    <div className="stack">
      <form className="card stack" onSubmit={e => { e.preventDefault(); if (typed.trim()) hit(typed.trim()); setTyped(''); }}>
        <h3>Barcode scanner</h3><p className="muted" style={{ fontSize: 14 }}>Scan any product label anywhere on this page. Fast keystrokes ending in Enter are read as a scan and matched by SKU.</p>
        <input className="input mono" value={typed} onChange={e => setTyped(e.target.value)} placeholder="Or type a SKU and press Enter (try KB-003)" aria-label="Scan test" />
        {hits.length === 0 ? <Badge>No scans yet</Badge> : hits.map((h, i) => <span key={i} className="mono" style={{ fontSize: 13 }}>{h}</span>)}
      </form>
      <div className="card stack"><h3>Scale</h3>
        <div className="sunken row between"><span className="muted">Net</span><b className="num" style={{ fontSize: 32 }}>{Math.max(0, w - tare).toFixed(3)} kg</b></div>
        <div className="row wrap"><ReadScale db={db} deviceId={dev} onWeight={setW} /><button className="btn" onClick={() => setTare(w)}>Tare</button><button className="btn" onClick={() => { setW(0); setTare(0); }}>Zero</button></div>
        <span className="faint" style={{ fontSize: 13 }}>{tare ? `Tare ${tare.toFixed(3)} kg · ` : ''}Only a stable reading is taken.</span></div>
      <HardwareList db={db} deviceId={dev} kinds={['scanner', 'scale']} by={me.id} />
    </div>
    <IntegrationsPanel kinds={['scanner', 'scale']} outletId={outletId} deviceId={dev} />
  </div>;
}

function Settings() {
  const { db, me, setting, outletId } = usePos();
  const set = (id: string, v: string | number | boolean) => setSetting(SETTINGS_PATH + ':' + id, v, me.id);
  const reg = db.devices.find(d => d.outletId === outletId && d.kind === 'pos');
  return <div className="card stack" style={{ maxWidth: 680 }}>
    <Row l="This register" v={`${reg?.name ?? 'Register'} · ${db.outlets.find(o => o.id === outletId)?.name}`} />
    <Field label="Default order type"><Seg label="Default order type" value={setting('defaultType', 'dine')} options={[['dine', 'Dine-in'], ['take', 'Takeaway'], ['delivery', 'Delivery']] as const} onChange={v => set('defaultType', v)} /></Field>
    <Field label="Default receipt"><Seg label="Default receipt" value={setting('receipt', 'print')} options={[['print', 'Print'], ['wa', 'WhatsApp'], ['email', 'Email'], ['none', 'None']] as const} onChange={v => set('receipt', v)} /></Field>
    <Row l="Cash rounding" v={roundStep(db) ? `IDR ${roundStep(db).toLocaleString('en-US')} · set by the owner in Payment methods` : 'Off · set by the owner in Payment methods'} />
    <Field label="Float left for the next shift"><input className="input num" inputMode="numeric" defaultValue={setting('float', 500000)} onBlur={e => set('float', Number(e.target.value.replace(/\D/g, '')) || 0)} /></Field>
    <Field label="Kasbon limit per customer"><input className="input num" inputMode="numeric" defaultValue={setting('kasbonLimit', 500000)} onBlur={e => set('kasbonLimit', Number(e.target.value.replace(/\D/g, '')) || 0)} /></Field>
    <label className="row between"><span>Lock after 2 minutes idle</span><Toggle on={setting('autoLock', true)} onChange={v => set('autoLock', v)} label="Auto lock" /></label>
    <label className="row between"><span>Sound on new online order</span><Toggle on={setting('sound', true)} onChange={v => set('sound', v)} label="Sound" /></label>
    <span className="faint" style={{ fontSize: 13 }}>Saved on this register for every cashier. Prices, taxes and service charge are set by the owner.</span>
  </div>;
}

function Sync() {
  const { db, me } = usePos();
  const q = db.device.queue;
  const lastSync = db.audit.find(a => a.action === 'sync.flushed' || a.action === 'device.online');
  return <div className="grid" style={{ ['--min' as string]: '320px', alignItems: 'start' }}>
    <div className="card stack">
      <div className="row between"><h3>Connection</h3><Status s={db.device.online ? 'online' : 'offline'} /></div>
      <label className="row between"><span>Online</span><Toggle on={db.device.online} onChange={v => { setDeviceOnline(v); toast(v ? 'Back online · syncing' : 'Offline mode · sales keep working'); }} label="Online" /></label>
      <p className="muted" style={{ fontSize: 14 }}>Offline, cash and card keep working and queue here with an idempotency key per order. QRIS, VA and e-wallet are paused until the connection is back.</p>
      <Row l="Last sync" v={lastSync ? hhmm(lastSync.at) + ' · ' + ago(lastSync.at) : '—'} />
      <button className="btn btn-primary btn-pos" disabled={!db.device.online || !q.length} onClick={() => toast(`Synced ${flushQueue(me.id)} actions`)}>Retry now</button>
    </div>
    <div className="card stack"><h3>Queue · {q.length}</h3>{q.length === 0 ? <p className="muted">Everything is synced.</p> : q.slice(-30).reverse().map(x => <Row key={x.id} l={x.action} v={hhmm(x.at)} />)}</div>
  </div>;
}
