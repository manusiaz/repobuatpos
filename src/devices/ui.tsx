'use client';
// Hardware widgets for the register: pair the physical device, test it, see the print queue, read the scale.
import { useState } from 'react';
import type { DB, Integration } from '../data/schema.ts';
import { setIntegrationConfig } from '../data/actions/devices.ts';
import { reportIntegration } from '../data/actions/integrations.ts';
import { testIntegration } from '../integrations/testers.ts';
import { Icon, toast } from '../ui/kit.tsx';
import { pairBluetooth, pairHid, pairSerial, pairUsb, pairedName, support } from './transports.ts';
import { ownerOf, stationOf, STATIONS } from './routing.ts';
import { clearFailed, retryFailed, usePrintQueue } from './agent.ts';
import { weigh } from './hardware.ts';
import './testers.ts';

const PAIR: Record<string, [string, string, () => Promise<string>, keyof ReturnType<typeof support>]> = {
  'printer-usb': ['Pair USB', 'usb', pairUsb, 'usb'], 'printer-bluetooth': ['Pair Bluetooth', 'bluetooth', pairBluetooth, 'bluetooth'], 'printer-serial': ['Pair serial', 'cable', pairSerial, 'serial'],
  'scale-serial': ['Pair scale', 'cable', pairSerial, 'serial'], 'display-pole': ['Pair display', 'cable', pairSerial, 'serial'], 'scanner-hid': ['Pair HID', 'usb', pairHid, 'hid'],
};

/** Every hardware integration this register drives, with the real pairing button (needs a tap) and Test. */
export function HardwareList({ db, deviceId, kinds, by, extra }: { db: DB; deviceId: string | null; kinds: Integration['kind'][]; by: string; extra?: (i: Integration) => React.ReactNode }) {
  const list = db.integrations.filter(i => kinds.includes(i.kind) && ownerOf(db, i) === deviceId);
  const can = support();
  if (!list.length) return null;
  return <div className="card stack"><h3>On this register</h3>
    {list.map(i => { const p = PAIR[i.connector];
      return <div key={i.id} className="row wrap" style={{ gap: 8, paddingBottom: 8, borderBottom: '1px solid var(--border)' }}>
        <Icon name={i.status === 'ok' ? 'circle-check' : i.status === 'error' ? 'circle-alert' : 'circle-dashed'} size={18} style={{ color: i.status === 'ok' ? 'var(--success)' : i.status === 'error' ? 'var(--danger)' : 'var(--fg-3)' }} />
        <span className="grow stack" style={{ gap: 0, minWidth: 180 }}><b style={{ fontSize: 14 }}>{i.name}{!i.enabled && ' · off'}</b>
          <span className="muted" style={{ fontSize: 13 }}>{[i.kind === 'printer' && STATIONS.find(s => s[0] === stationOf(i))?.[1], i.config.paired ? pairedName(i.config.paired) : p ? 'Not paired yet' : '', i.status === 'error' ? i.lastError : ''].filter(Boolean).join(' · ')}</span></span>
        {p && <button className="btn btn-sm" disabled={!can[p[3]]} title={can[p[3]] ? undefined : 'Needs Chrome or Edge over https'} onClick={async () => {
          try { const d = await p[2](); setIntegrationConfig(i.id, { paired: d }, by); toast(`Paired · ${pairedName(d)}`); } catch (e) { if ((e as Error).name !== 'NotFoundError') toast((e as Error).message); }
        }}><Icon name={p[1]} size={16} />{p[0]}</button>}
        <button className="btn btn-sm" onClick={async () => { const r = await testIntegration(i); reportIntegration(i.id, r.ok, r.ok ? '' : r.message); toast(r.message); }}>{i.kind === 'printer' ? 'Test print' : i.kind === 'drawer' ? 'Open drawer' : 'Test'}</button>
        {extra?.(i)}
      </div>; })}
    {!can.usb && !can.serial && !can.bluetooth && <span className="faint" style={{ fontSize: 13 }}>This browser cannot reach USB, serial or Bluetooth devices. Use Chrome or Edge, or Browser print and the LAN bridge.</span>}
  </div>;
}

/** Failed prints on this device, waiting for a retry. */
export function PrintQueue({ deviceId }: { deviceId: string | null }) {
  const q = usePrintQueue(deviceId);
  const [busy, setBusy] = useState(false);
  if (!deviceId || !q.length) return null;
  return <div className="banner b-warning" style={{ alignItems: 'flex-start' }}><Icon name="printer" /><div className="stack sm grow">
    <b>{q.length} print{q.length > 1 ? 's' : ''} waiting</b>
    {q.slice(0, 5).map((f, k) => <span key={k} style={{ fontSize: 13 }}>{f.job.kind === 'receipt' ? 'Receipt' : `${f.job.station} ticket`} {f.no} · {f.error}</span>)}
    <span className="row wrap"><button className="btn btn-sm" disabled={busy} onClick={async () => { setBusy(true); const left = await retryFailed(deviceId); setBusy(false); toast(left ? `${left} still failing` : 'All printed'); }}>Retry all</button>
      <button className="btn btn-sm btn-ghost" onClick={() => clearFailed(deviceId)}>Dismiss</button></span>
  </div></div>;
}

/** "Read scale" for weighed items: the stable weight from the paired scale, or a clear message to type it. */
export function ReadScale({ db, deviceId, onWeight }: { db: DB; deviceId: string | null; onWeight: (kg: number) => void }) {
  const [busy, setBusy] = useState(false);
  return <button className="btn btn-primary" disabled={busy} onClick={async () => {
    setBusy(true); const r = await weigh(db, deviceId); setBusy(false);
    if ('kg' in r) onWeight(r.kg); else toast(r.message);
  }}><Icon name="scale" />{busy ? 'Reading…' : 'Read scale'}</button>;
}

