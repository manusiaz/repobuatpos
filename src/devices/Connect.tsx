'use client';
// "Connect a device": pick what, pick how it is plugged, one tap. Saves the integration with sensible defaults, opens the
// browser's pairing prompt when the cable needs it, and runs the test right away. Hardware is reached from the device it is
// plugged into, so this card works on the register / PC at the outlet. Allowed by the matrix ('Connect devices & printers').
import { useState } from 'react';
import { useApp } from '../app/context.tsx';
import { perm } from '../system/perms.ts';
import { snapshot } from '../data/store.ts';
import { saveIntegration, reportIntegration } from '../data/actions/integrations.ts';
import { setIntegrationConfig } from '../data/actions/devices.ts';
import { testIntegration } from '../integrations/testers.ts';
import { copy, Field, Icon, Seg, toast } from '../ui/kit.tsx';
import { QR } from '../ui/qr.tsx';
import { linkTo } from '../system/hosts.ts';
import { REMOTE } from '../data/remote.ts';
import { pairBluetooth, pairSerial, pairUsb, support } from './transports.ts';
import { STATIONS, thisDevice } from './routing.ts';
import { BANKS } from './edc.ts';
import { AT_REGISTER, type Brand, drawerReady, GEAR, machineUsers, SCREEN, setupFor, VIA_LABEL, VIAS, type Gear, type Via } from './connect.ts';
import './testers.ts';

const PAIR = { usb: pairUsb, bluetooth: pairBluetooth, serial: pairSerial };
const KITCHEN = STATIONS.filter(([s]) => s !== 'receipt' && s !== 'all');

export function ConnectDevice() {
  const { db, user, me, outletId } = useApp();
  const [gear, setGear] = useState<Gear | null>(null), [via, setVia] = useState<Via | null>(null);
  const [paper, setPaper] = useState<'80' | '58'>('80'), [station, setStation] = useState('kitchen'), [host, setHost] = useState(''), [bank, setBank] = useState('BCA');
  const [brand, setBrand] = useState<Brand>('zkteco'), [key] = useState(() => Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('') /* randomUUID is https-only */);
  const [serial, setSerial] = useState(''), [tz, setTz] = useState('+07:00'), [users, setUsers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false), [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const code = perm(db, user.role, 'Connect devices & printers', outletId);
  if (code === 'n') return null;
  const dev = thisDevice(db), by = me?.id ?? user.id, can = support();
  const mine = db.integrations.filter(i => i.deviceId === dev).map(i => i.connector);
  const usable = (v: Via) => v === 'usb' ? can.usb : v === 'bluetooth' ? can.bluetooth : v === 'serial' ? can.serial : true;
  const machineOf = (b: Brand) => db.integrations.find(i => i.connector === 'attendance-' + b && i.outletId === outletId);
  const machine = machineOf(brand), hookKey = String(machine?.config.key ?? key);
  const hook = typeof location !== 'undefined' ? `${location.origin}/api/attendance/fingerspot?key=${hookKey}` : '';
  const loadMachine = (b: Brand) => { const c = machineOf(b)?.config ?? {}; setBrand(b); setSerial(String(c.serial ?? '')); setTz(String(c.tz ?? '+07:00')); setUsers(machineUsers(c)); };
  const staff = db.employees.filter(e => e.active && e.outlets.includes(outletId));
  const pick = (g: Gear) => {
    setGear(g); setResult(null); const vs = VIAS[g]; setVia(vs.length === 1 ? vs[0] : vs.find(usable) ?? null);
    if (g === 'attendance') loadMachine(machineOf('fingerspot') && !machineOf('zkteco') ? 'fingerspot' : 'zkteco');
  };
  const blocked = gear === 'drawer' && !drawerReady(mine) ? 'Connect the receipt printer first: the drawer cable plugs into it.' : !dev && gear && AT_REGISTER.includes(gear) ? 'Pair this tablet or PC to a register first (Choose register).' : '';
  const screen = gear && SCREEN[gear] ? linkTo(SCREEN[gear]!) : '';

  const connect = async () => {
    if (!gear || !via || (!dev && gear !== 'attendance')) return;
    setBusy(true); setResult(null);
    try {
      const s = setupFor(gear, via, { paper, station, host, bank, serial, tz, users, brand, key: hookKey });
      const id = gear === 'attendance'
        ? saveIntegration({ id: machine?.id, connector: s.connector, outletId, deviceId: null, name: machine?.name ?? s.name, enabled: true, config: s.config }, [], by)
        : saveIntegration({ connector: s.connector, outletId, deviceId: dev, name: s.name, enabled: true, config: s.config }, [], by);
      if (s.pair) setIntegrationConfig(id, { paired: await PAIR[s.pair]() }, by); // the browser asks which device; needs this tap
      const row = snapshot().integrations.find(i => i.id === id)!;
      const r = await testIntegration(row);
      reportIntegration(id, r.ok, r.ok ? '' : r.message);
      setResult({ ok: r.ok, msg: r.message });
      if (r.ok) toast(`${s.name} connected`);
    } catch (e) {
      const err = e as Error;
      setResult({ ok: false, msg: err.name === 'NotFoundError' ? 'No device was picked. Plug it in, switch it on and try again.' : err.message });
    }
    setBusy(false);
  };

  return <section className="card stack" aria-label="Connect a device">
    <div className="row between wrap"><h3>Connect a device</h3><span className="faint" style={{ fontSize: 13 }}>On this register · {db.devices.find(d => d.id === dev)?.name ?? 'not paired'}</span></div>
    <span className="cap">1 · What are you connecting?</span>
    {([['Plugged into this register', true], ['Elsewhere in the outlet', false]] as const).map(([h, reg]) => <div key={h} className="stack sm"><span className="faint" style={{ fontSize: 13 }}>{h}</span>
    <div className="grid" style={{ ['--min' as string]: '170px', gap: 8 }}>{GEAR.filter(([g]) => AT_REGISTER.includes(g) === reg).map(([g, l, sub, ic]) =>
      <button key={g} type="button" className="card tight row" aria-pressed={gear === g} onClick={() => pick(g)} style={{ cursor: 'pointer', textAlign: 'left', minHeight: 64, borderColor: gear === g ? 'var(--accent)' : undefined, background: gear === g ? 'var(--role-soft)' : undefined }}>
        <Icon name={ic} /><span className="stack" style={{ gap: 0 }}><b style={{ fontSize: 14 }}>{l}</b><span className="muted" style={{ fontSize: 12 }}>{sub}</span></span></button>)}</div></div>)}

    {gear && VIAS[gear][0] !== 'none' && <>
      <span className="cap">2 · How is it plugged in?</span>
      <div className="grid" style={{ ['--min' as string]: '170px', gap: 8 }}>{VIAS[gear].map(v => { const ok = usable(v);
        return <button key={v} type="button" className="card tight row" disabled={!ok} aria-pressed={via === v} onClick={() => { setVia(v); setResult(null); }} title={ok ? undefined : 'This browser cannot reach it. Use Chrome or Edge on a PC or Android tablet.'}
          style={{ cursor: ok ? 'pointer' : 'not-allowed', opacity: ok ? 1 : .5, minHeight: 52, borderColor: via === v ? 'var(--accent)' : undefined, background: via === v ? 'var(--role-soft)' : undefined }}>
          <Icon name={VIA_LABEL[v][1]} size={18} /><b style={{ fontSize: 14 }}>{VIA_LABEL[v][0]}</b></button>; })}</div>
    </>}

    {screen && <>
      <span className="cap">2 · Open BorNiz on that screen</span>
      <div className="row wrap" style={{ gap: 16, alignItems: 'center' }}>
        <div style={{ width: 132, height: 132, padding: 6, background: 'var(--ink-0)', color: 'var(--ink-950)', borderRadius: 'var(--radius-md)', flex: 'none' }}><QR value={screen} size="100%" label={screen} /></div>
        <div className="stack sm grow" style={{ minWidth: 200 }}>
          <span style={{ fontSize: 14 }}>Scan this with the {GEAR.find(x => x[0] === gear)![1].toLowerCase()}’s camera, or type the link in its browser (Chrome).</span>
          <span className="mono" style={{ fontSize: 13, wordBreak: 'break-all' }}>{screen}</span>
          <span className="faint" style={{ fontSize: 13 }}>{gear === 'display' ? 'The display then shows a 6-digit code: type it on this register under Device › Customer display.' : 'Sign in once with the business account; it stays signed in. Use “Add to home screen” for full screen.'}</span>
          <button type="button" className="btn" style={{ alignSelf: 'flex-start' }} onClick={() => copy(screen, 'Link copied')}><Icon name="copy" size={18} />Copy link</button>
        </div></div>
    </>}

    {gear === 'attendance' && <>
      <span className="cap">2 · The machine</span>
      <Seg label="Machine" value={brand} onChange={loadMachine} options={[['zkteco', 'ZKTeco / ADMS cloud'], ['fingerspot', 'Fingerspot.io']]} />
      <div className="grid" style={{ ['--min' as string]: '200px', gap: 8 }}>
        <Field label={brand === 'fingerspot' ? 'Cloud ID' : 'Serial number (SN)'} hint={brand === 'fingerspot' ? 'Fingerspot.io portal › your device' : 'Sticker under the machine, or Menu › System info'}><input className="input mono" aria-label={brand === 'fingerspot' ? 'Cloud ID' : 'Serial number (SN)'} value={serial} onChange={e => setSerial(e.target.value.toUpperCase())} placeholder={brand === 'fingerspot' ? 'C2611851572E0C2D' : 'CKJF203960123'} autoCapitalize="characters" /></Field>
        <Field label="Machine time zone"><select className="input" value={tz} onChange={e => setTz(e.target.value)}><option value="+07:00">WIB (UTC+7)</option><option value="+08:00">WITA (UTC+8)</option><option value="+09:00">WIT (UTC+9)</option></select></Field>
      </div>
      <span className="cap">3 · Who is who on the machine</span>
      <span className="faint" style={{ fontSize: 13 }}>Type the user ID each person was enrolled with on the machine (Menu › User Mgt). Leave empty for staff not on it.</span>
      <div className="stack sm">{staff.map(e => <label key={e.id} className="row" style={{ gap: 8 }}><span className="grow" style={{ fontSize: 14 }}>{e.name} <span className="faint">· {e.role}</span></span>
        <input className="input mono" style={{ width: 110 }} inputMode="numeric" aria-label={`Machine user ID for ${e.name}`} value={users[e.id] ?? ''} onChange={ev => setUsers({ ...users, [e.id]: ev.target.value.replace(/\D/g, '') })} placeholder="ID" /></label>)}</div>
      <span className="cap">4 · {brand === 'fingerspot' ? 'In the Fingerspot.io portal' : 'On the machine'}</span>
      <div className="sunken stack sm" style={{ fontSize: 14 }}>
        {brand === 'fingerspot' ? <>
          <span>Device › Webhook URL: paste this link and save.</span>
          <span className="mono" style={{ fontSize: 13, wordBreak: 'break-all' }}>{hook}</span>
          <button type="button" className="btn" style={{ alignSelf: 'flex-start' }} onClick={() => copy(hook, 'Webhook link copied')}><Icon name="copy" size={18} />Copy link</button>
          <span className="faint" style={{ fontSize: 13 }}>The link holds this machine’s private key: share it only with the Fingerspot portal. Your Fingerspot.io plan must include the developer webhook.</span>
        </> : <>
          <span>Menu › COMM. › Cloud Server Setting (ADMS):</span>
          <span>Server address <b className="mono">{typeof location !== 'undefined' ? location.hostname : ''}</b> · Port <b className="mono">443</b> · Domain name ON · HTTPS ON</span>
          <span className="faint" style={{ fontSize: 13 }}>Needs a machine whose Cloud Server menu has HTTPS (most ZKTeco models since 2019).</span>
        </>}
        <span className="faint" style={{ fontSize: 13 }}>Each scan then clocks the person in or out at this outlet, marked “Verified on {machine?.name ?? (brand === 'fingerspot' ? 'Fingerspot machine' : 'Attendance machine')}”.</span>
        {!REMOTE && <span className="faint" style={{ fontSize: 13 }}>Demo mode: settings are saved, but a machine can only reach BorNiz once the app runs with its database.</span>}
      </div>
      <button className="btn btn-primary btn-lg" disabled={busy || !serial.trim()} onClick={connect}><Icon name="plug" />{busy ? 'Saving…' : machine ? 'Save and check the machine' : 'Connect and check the machine'}</button>
    </>}

    {gear && via && !SCREEN[gear] && gear !== 'attendance' && <>
      <span className="cap">{VIAS[gear][0] === 'none' ? '2' : '3'} · Check and connect</span>
      {(gear === 'receipt' || gear === 'kitchen') && <Seg label="Paper" value={paper} onChange={setPaper} options={[['80', '80 mm (most)'], ['58', '58 mm (small)']]} />}
      {gear === 'kitchen' && <Field label="Prints tickets for"><select className="input" value={station} onChange={e => setStation(e.target.value)}>{KITCHEN.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>}
      {via === 'lan' && <Field label="Printer IP address" hint="On the printer’s self-test page (hold FEED while switching it on)"><input className="input mono" inputMode="decimal" placeholder="192.168.1.87" value={host} onChange={e => setHost(e.target.value)} /></Field>}
      {via === 'lan' && <span className="faint" style={{ fontSize: 13 }}>Network printers need the BorNiz Bridge running on this PC.</span>}
      {gear === 'edc' && <><Field label="Bank of the card machine"><select className="input" value={bank} onChange={e => setBank(e.target.value)}>{BANKS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <span className="faint" style={{ fontSize: 13 }}>The cashier keys the amount on the EDC, then types the approval code from the slip. Direct links to the bank terminal come per bank.</span></>}
      {gear === 'scanner' && <span className="faint" style={{ fontSize: 13 }}>Plug the scanner in (USB or Bluetooth). It types like a keyboard, so nothing else to set.</span>}
      {gear === 'drawer' && <span className="faint" style={{ fontSize: 13 }}>Plug the drawer cable (RJ11) into the back of the receipt printer. It opens on cash payments.</span>}
      {blocked ? <div className="banner b-warning"><Icon name="circle-alert" /><span>{blocked}</span></div>
        : <button className="btn btn-primary btn-lg" disabled={busy || (via === 'lan' && !host.trim())} onClick={connect}><Icon name="plug" />{busy ? 'Connecting…' : gear === 'receipt' || gear === 'kitchen' || gear === 'label' ? 'Connect and print a test' : 'Connect and test'}</button>}
    </>}
    {result && <div role="status" className={'banner ' + (result.ok ? 'b-success' : gear === 'attendance' ? 'b-warning' : 'b-danger')}><Icon name={result.ok ? 'circle-check' : 'circle-alert'} /><span>{result.msg}</span></div>}
  </section>;
}
