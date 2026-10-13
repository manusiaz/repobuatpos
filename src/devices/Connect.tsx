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
import { Field, Icon, Seg, toast } from '../ui/kit.tsx';
import { pairBluetooth, pairSerial, pairUsb, support } from './transports.ts';
import { STATIONS, thisDevice } from './routing.ts';
import { BANKS } from './edc.ts';
import { drawerReady, GEAR, setupFor, VIA_LABEL, VIAS, type Gear, type Via } from './connect.ts';
import './testers.ts';

const PAIR = { usb: pairUsb, bluetooth: pairBluetooth, serial: pairSerial };
const KITCHEN = STATIONS.filter(([s]) => s !== 'receipt' && s !== 'all');

export function ConnectDevice() {
  const { db, user, me, outletId } = useApp();
  const [gear, setGear] = useState<Gear | null>(null), [via, setVia] = useState<Via | null>(null);
  const [paper, setPaper] = useState<'80' | '58'>('80'), [station, setStation] = useState('kitchen'), [host, setHost] = useState(''), [bank, setBank] = useState('BCA');
  const [busy, setBusy] = useState(false), [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const code = perm(db, user.role, 'Connect devices & printers', outletId);
  if (code === 'n') return null;
  const dev = thisDevice(db), by = me?.id ?? user.id, can = support();
  const mine = db.integrations.filter(i => i.deviceId === dev).map(i => i.connector);
  const usable = (v: Via) => v === 'usb' ? can.usb : v === 'bluetooth' ? can.bluetooth : v === 'serial' ? can.serial : true;
  const pick = (g: Gear) => { setGear(g); setResult(null); const vs = VIAS[g]; setVia(vs.length === 1 ? vs[0] : vs.find(usable) ?? null); };
  const blocked = gear === 'drawer' && !drawerReady(mine) ? 'Connect the receipt printer first: the drawer cable plugs into it.' : !dev ? 'Pair this tablet or PC to a register first (Choose register).' : '';

  const connect = async () => {
    if (!gear || !via || !dev) return;
    setBusy(true); setResult(null);
    try {
      const s = setupFor(gear, via, { paper, station, host, bank });
      const id = saveIntegration({ connector: s.connector, outletId, deviceId: dev, name: s.name, enabled: true, config: s.config }, [], by);
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
    <div className="grid" style={{ ['--min' as string]: '170px', gap: 8 }}>{GEAR.map(([g, l, sub, ic]) =>
      <button key={g} type="button" className="card tight row" aria-pressed={gear === g} onClick={() => pick(g)} style={{ cursor: 'pointer', textAlign: 'left', minHeight: 64, borderColor: gear === g ? 'var(--accent)' : undefined, background: gear === g ? 'var(--role-soft)' : undefined }}>
        <Icon name={ic} /><span className="stack" style={{ gap: 0 }}><b style={{ fontSize: 14 }}>{l}</b><span className="muted" style={{ fontSize: 12 }}>{sub}</span></span></button>)}</div>

    {gear && VIAS[gear][0] !== 'none' && <>
      <span className="cap">2 · How is it plugged in?</span>
      <div className="grid" style={{ ['--min' as string]: '170px', gap: 8 }}>{VIAS[gear].map(v => { const ok = usable(v);
        return <button key={v} type="button" className="card tight row" disabled={!ok} aria-pressed={via === v} onClick={() => { setVia(v); setResult(null); }} title={ok ? undefined : 'This browser cannot reach it. Use Chrome or Edge on a PC or Android tablet.'}
          style={{ cursor: ok ? 'pointer' : 'not-allowed', opacity: ok ? 1 : .5, minHeight: 52, borderColor: via === v ? 'var(--accent)' : undefined, background: via === v ? 'var(--role-soft)' : undefined }}>
          <Icon name={VIA_LABEL[v][1]} size={18} /><b style={{ fontSize: 14 }}>{VIA_LABEL[v][0]}</b></button>; })}</div>
    </>}

    {gear && via && <>
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
        : <button className="btn btn-primary btn-lg" disabled={busy || (via === 'lan' && !host.trim())} onClick={connect}><Icon name="plug" />{busy ? 'Connecting…' : gear === 'receipt' || gear === 'kitchen' ? 'Connect and print a test' : 'Connect and test'}</button>}
    </>}
    {result && <div role="status" className={'banner ' + (result.ok ? 'b-success' : 'b-danger')}><Icon name={result.ok ? 'circle-check' : 'circle-alert'} /><span>{result.msg}</span></div>}
  </section>;
}
