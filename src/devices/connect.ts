// One-step hardware setup: what the person picks (what + how it is plugged) → the connector and its default settings.
// Pure: the Connect card and the tests share it. Every choice maps to an existing connector (src/integrations/connectors/devices.ts).
export type Gear = 'receipt' | 'kitchen' | 'label' | 'drawer' | 'edc' | 'scanner' | 'scale' | 'pole' | 'attendance' | 'kds' | 'display' | 'kiosk' | 'waiter';
export type Via = 'usb' | 'bluetooth' | 'serial' | 'lan' | 'browser' | 'none';
export interface Setup { connector: string; name: string; config: Record<string, string | number | boolean>; pair: 'usb' | 'bluetooth' | 'serial' | null }

export const GEAR: [Gear, string, string, string][] = [
  ['receipt', 'Receipt printer', 'Prints the customer receipt at the counter', 'receipt'],
  ['kitchen', 'Kitchen or bar printer', 'Prints order tickets for a station', 'chef-hat'],
  ['drawer', 'Cash drawer', 'Plugs into the receipt printer', 'archive'],
  ['edc', 'Card terminal (EDC)', 'Bank card machine', 'credit-card'],
  ['scanner', 'Barcode scanner', 'Scans product labels', 'scan-barcode'],
  ['scale', 'Scale', 'Weighed items', 'scale'],
  ['label', 'Label / sticker printer', 'Cup stickers and price labels', 'tag'],
  ['pole', 'Pole display', 'Shows the amount to the guest', 'monitor'],
  ['attendance', 'Attendance machine', 'Fingerprint or face clock-in', 'fingerprint-pattern'],
  ['kds', 'Kitchen screen (KDS)', 'Tablet or TV in the kitchen', 'chef-hat'],
  ['display', 'Customer display', 'Second screen facing the guest', 'monitor-smartphone'],
  ['kiosk', 'Self-order kiosk', 'Guests order and pay themselves', 'tablet-smartphone'],
  ['waiter', 'Waiter phone', 'Take orders at the table', 'smartphone'],
];
/** Hardware wired to the register (paired from this tablet / PC); the rest connect on their own. */
export const AT_REGISTER: Gear[] = ['receipt', 'kitchen', 'label', 'drawer', 'edc', 'scanner', 'scale', 'pole'];
/** Screens are BorNiz itself on another device: open the page there (link or QR), sign in once. */
export const SCREEN: Partial<Record<Gear, string>> = { kds: '/kds/order-tickets', display: '/display/pairing-with-register', kiosk: '/kiosk', waiter: '/waiter' };
export const VIA_LABEL: Record<Via, [string, string]> = {
  usb: ['USB cable', 'usb'], bluetooth: ['Bluetooth', 'bluetooth'], serial: ['Serial / USB-serial cable', 'cable'],
  lan: ['Network (LAN, IP address)', 'network'], browser: ['Any printer (print dialog)', 'printer'], none: ['Nothing to plug', 'check'],
};
/** How each kind of hardware can be connected, most common first. */
export const VIAS: Record<Gear, Via[]> = {
  receipt: ['usb', 'lan', 'bluetooth', 'serial', 'browser'], kitchen: ['lan', 'usb', 'bluetooth', 'serial', 'browser'], label: ['usb', 'bluetooth', 'lan', 'serial'],
  drawer: ['none'], edc: ['none'], scanner: ['none'], scale: ['serial'], pole: ['serial'],
  attendance: ['none'], kds: ['none'], display: ['none'], kiosk: ['none'], waiter: ['none'],
};
const PRINTER: Record<Exclude<Via, 'none'>, string> = { usb: 'printer-usb', bluetooth: 'printer-bluetooth', serial: 'printer-serial', lan: 'printer-lan', browser: 'printer-browser' };

export interface Opts { paper?: '58' | '80'; station?: string; host?: string; bank?: string; serial?: string; tz?: string; users?: Record<string, string>; brand?: Brand; key?: string }
export type Brand = 'zkteco' | 'fingerspot';
export function setupFor(gear: Gear, via: Via, o: Opts = {}): Setup {
  const pairOf = (v: Via) => (v === 'usb' || v === 'bluetooth' || v === 'serial' ? v : null);
  if (gear === 'receipt' || gear === 'kitchen' || gear === 'label') {
    if (via === 'none') throw new Error('Pick how the printer is connected');
    const station = gear === 'kitchen' ? o.station || 'kitchen' : gear;
    const config: Setup['config'] = { station, paper: o.paper ?? '80', autoPrint: gear === 'receipt', copies: 1 };
    if (via === 'serial') config.baud = '9600'; // most thermal printers; change it under Printers if the test prints garbage
    if (via === 'lan') { if (!o.host?.trim()) throw new Error('Type the printer’s IP address (printed on its self-test page)'); Object.assign(config, { host: o.host.trim(), port: 9100, bridge: 'http://127.0.0.1:9109' }); }
    return { connector: PRINTER[via], name: `${gear === 'receipt' ? 'Receipt' : station[0].toUpperCase() + station.slice(1)} printer · ${VIA_LABEL[via][0].split(' ')[0]}`, config, pair: pairOf(via) };
  }
  if (gear === 'attendance') {
    const serial = o.serial?.trim().toUpperCase() ?? '';
    const fs = o.brand === 'fingerspot';
    if (!/^[A-Z0-9-]{4,40}$/.test(serial)) throw new Error(fs ? 'Type the machine’s Cloud ID from the Fingerspot.io portal' : 'Type the machine’s serial number (SN): on the sticker or in Menu › System info');
    if (fs && !o.key) throw new Error('The webhook key is missing');
    return { connector: fs ? 'attendance-fingerspot' : 'attendance-zkteco', name: fs ? 'Fingerspot machine' : 'Attendance machine', config: { serial, tz: o.tz || '+07:00', ...(fs ? { key: o.key! } : {}), ...userConfig(o.users ?? {}) }, pair: null };
  }
  if (SCREEN[gear]) throw new Error('Screens open BorNiz on their own device');
  if (gear === 'drawer') return { connector: 'drawer-kick', name: 'Cash drawer', config: { openOn: 'cash', pin: '0' }, pair: null };
  if (gear === 'edc') return { connector: 'edc-manual', name: `${o.bank || 'Bank'} EDC`, config: { bank: o.bank || 'BCA', requireLast4: true }, pair: null };
  if (gear === 'scanner') return { connector: 'scanner-wedge', name: 'Barcode scanner', config: {}, pair: null };
  if (gear === 'scale') return { connector: 'scale-serial', name: 'Scale', config: { baud: '9600', unit: 'kg' }, pair: 'serial' };
  return { connector: 'display-pole', name: 'Pole display', config: { baud: '9600', greeting: 'Selamat datang' }, pair: 'serial' };
}
/** A cash drawer opens through the receipt printer, so it needs one first (browser print cannot kick a drawer). */
export const drawerReady = (connectors: string[]) => connectors.some(c => c.startsWith('printer-') && c !== 'printer-browser');

/** Staff ↔ machine user ID, stored on the connection as "user.<machine id>": employeeId (the server reads it that way). */
export function userConfig(users: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [emp, raw] of Object.entries(users)) {
    const id = raw.trim(); if (!id) continue;
    if (!/^\d{1,9}$/.test(id)) throw new Error(`Machine user ID “${id}” must be a number`);
    if (out['user.' + id]) throw new Error(`Machine user ID ${id} is used twice`);
    out['user.' + id] = emp;
  }
  return out;
}
export const machineUsers = (config: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(config).filter(([k]) => k.startsWith('user.')).map(([k, v]) => [String(v), k.slice(5)]));
