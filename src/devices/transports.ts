// Browser transports to hardware. WebUSB, Web Serial, Web Bluetooth and WebHID need Chrome/Edge (desktop or Android)
// over https, and pairing needs a tap (user gesture). Later sessions reconnect without asking via getDevices()/getPorts().
// Bridge = the BorNiz Bridge helper (src/devices/bridge.mjs) for LAN printers on port 9100, which browsers cannot open.
// A paired device is remembered as a descriptor string in the integration config ("paired").

// ── Minimal Web API typings (no @types packages) ───────────────────────────────────────────
interface USBEndpoint { endpointNumber: number; direction: 'in' | 'out'; type: 'bulk' | 'interrupt' | 'isochronous' }
interface USBInterface { interfaceNumber: number; alternate: { interfaceClass: number; endpoints: USBEndpoint[] } }
interface USBDevice {
  vendorId: number; productId: number; serialNumber?: string; productName?: string; manufacturerName?: string; opened: boolean;
  configuration: { interfaces: USBInterface[] } | null;
  open(): Promise<void>; close(): Promise<void>; selectConfiguration(n: number): Promise<void>;
  claimInterface(n: number): Promise<void>; releaseInterface(n: number): Promise<void>;
  transferOut(ep: number, data: Uint8Array): Promise<{ status: string; bytesWritten: number }>;
}
interface SerialPort {
  getInfo(): { usbVendorId?: number; usbProductId?: number };
  open(o: { baudRate: number; dataBits?: number; parity?: 'none' | 'even' | 'odd'; stopBits?: number }): Promise<void>; close(): Promise<void>;
  readable: ReadableStream<Uint8Array> | null; writable: WritableStream<Uint8Array> | null;
}
interface BleChar { properties: { write: boolean; writeWithoutResponse: boolean }; writeValue(b: Uint8Array): Promise<void>; writeValueWithoutResponse?(b: Uint8Array): Promise<void> }
interface BleServer { connected: boolean; getPrimaryService(uuid: string): Promise<{ getCharacteristics(): Promise<BleChar[]> }> }
interface BleDevice { id: string; name?: string; gatt?: { connected: boolean; connect(): Promise<BleServer>; disconnect(): void } }
export interface HIDDevice { opened: boolean; productName: string; vendorId: number; productId: number; open(): Promise<void>; close(): Promise<void>;
  addEventListener(t: 'inputreport', f: (e: { data: DataView; reportId: number }) => void): void; removeEventListener(t: 'inputreport', f: (e: { data: DataView; reportId: number }) => void): void }
interface Nav {
  usb?: { requestDevice(o: { filters: object[] }): Promise<USBDevice>; getDevices(): Promise<USBDevice[]> };
  serial?: { requestPort(o?: { filters?: object[] }): Promise<SerialPort>; getPorts(): Promise<SerialPort[]> };
  bluetooth?: { requestDevice(o: object): Promise<BleDevice>; getDevices?(): Promise<BleDevice[]> };
  hid?: { requestDevice(o: { filters: object[] }): Promise<HIDDevice[]>; getDevices(): Promise<HIDDevice[]> };
}
const nav = (): Nav => (typeof navigator === 'undefined' ? {} : navigator as unknown as Nav);
export const support = () => { const n = nav(); return { usb: !!n.usb, serial: !!n.serial, bluetooth: !!n.bluetooth, hid: !!n.hid }; };
const need = <T>(x: T | undefined, what: string): T => { if (!x) throw new Error(`${what} is not available in this browser. Use Chrome or Edge over https, or pick Browser print.`); return x; };
const hex = (n?: number) => (n ?? 0).toString(16).padStart(4, '0');

// ── WebUSB (printer class 7, plus vendors whose printers report a vendor class) ───────────────────
const USB_VENDORS = [0x04b8, 0x0416, 0x0483, 0x0fe6, 0x1fc9, 0x28e9, 0x6868, 0x1504, 0x0dd4, 0x154f, 0x20d1, 0x0525];
export async function pairUsb(): Promise<string> {
  const d = await need(nav().usb, 'WebUSB').requestDevice({ filters: [{ classCode: 7 }, ...USB_VENDORS.map(vendorId => ({ vendorId }))] });
  return `usb:${hex(d.vendorId)}:${hex(d.productId)}:${d.serialNumber ?? ''}:${d.productName ?? d.manufacturerName ?? 'USB printer'}`;
}
async function usbDevice(desc: string) {
  const [, v, p, sn] = desc.split(':');
  const list = await need(nav().usb, 'WebUSB').getDevices();
  const d = list.find(x => hex(x.vendorId) === v && hex(x.productId) === p && (!sn || x.serialNumber === sn));
  if (!d) throw new Error('USB printer not found on this device. Plug it in, then tap Pair USB again.');
  return d;
}
export async function usbSend(desc: string, bytes: Uint8Array) {
  const d = await usbDevice(desc);
  if (!d.opened) await d.open();
  if (!d.configuration) await d.selectConfiguration(1);
  const itf = d.configuration!.interfaces.find(i => i.alternate.interfaceClass === 7 && i.alternate.endpoints.some(e => e.direction === 'out' && e.type === 'bulk'))
    ?? d.configuration!.interfaces.find(i => i.alternate.endpoints.some(e => e.direction === 'out' && e.type === 'bulk'));
  const ep = itf?.alternate.endpoints.find(e => e.direction === 'out' && e.type === 'bulk');
  if (!itf || !ep) throw new Error('This USB device has no printer output. Is it the printer?');
  try {
    await d.claimInterface(itf.interfaceNumber);
  } catch { throw new Error('The printer is in use by the computer’s own driver. On Windows install the WinUSB driver (Zadig), or use Browser print.'); }
  try { for (let i = 0; i < bytes.length; i += 16384) { const r = await d.transferOut(ep.endpointNumber, bytes.slice(i, i + 16384)); if (r.status !== 'ok') throw new Error('USB transfer ' + r.status); } }
  finally { await d.releaseInterface(itf.interfaceNumber).catch(() => {}); await d.close().catch(() => {}); }
}

// ── Web Serial (RS-232 / USB-serial printers, scales, pole displays) ─────────────────────────────
export async function pairSerial(): Promise<string> {
  const p = await need(nav().serial, 'Web Serial').requestPort();
  const i = p.getInfo();
  return i.usbVendorId ? `serial:${hex(i.usbVendorId)}:${hex(i.usbProductId)}` : 'serial:any';
}
export async function serialPort(desc: string) {
  const [, v, p] = desc.split(':');
  const list = await need(nav().serial, 'Web Serial').getPorts();
  const port = v && v !== 'any' ? list.find(x => hex(x.getInfo().usbVendorId) === v && hex(x.getInfo().usbProductId) === p) : list[0];
  if (!port) throw new Error('Serial device not found on this device. Plug it in, then tap Pair serial again.');
  return port;
}
export async function serialSend(desc: string, baud: number, bytes: Uint8Array) {
  const port = await serialPort(desc);
  await port.open({ baudRate: baud || 9600 }).catch(e => { if (!/already open/i.test(String(e))) throw e; });
  const w = port.writable!.getWriter();
  try { await w.write(bytes); } finally { w.releaseLock(); await port.close().catch(() => {}); }
}

// ── Web Bluetooth (BLE thermal printers) ────────────────────────────────────────────────────
export const BLE_SERVICES = ['000018f0-0000-1000-8000-00805f9b34fb', 'e7810a71-73ae-499d-8c15-faa9aef0c3f2', '49535343-fe7d-4ae5-8fa9-9fafd205e455', '0000ff00-0000-1000-8000-00805f9b34fb', '0000ffe0-0000-1000-8000-00805f9b34fb'];
const bleSeen = new Map<string, BleDevice>();
export async function pairBluetooth(): Promise<string> {
  const d = await need(nav().bluetooth, 'Web Bluetooth').requestDevice({ acceptAllDevices: true, optionalServices: BLE_SERVICES });
  bleSeen.set(d.id, d);
  return `ble:${d.id}:${d.name ?? 'Bluetooth printer'}`;
}
export async function bleSend(desc: string, bytes: Uint8Array, chunk = 20) {
  const id = desc.split(':')[1];
  let d = bleSeen.get(id);
  if (!d) { const list = await nav().bluetooth?.getDevices?.(); d = list?.find(x => x.id === id); if (d) bleSeen.set(id, d); }
  if (!d?.gatt) throw new Error('Bluetooth printer not reachable from this tab. Tap Pair Bluetooth again (Chrome asks once per session).');
  const server = await d.gatt.connect();
  let ch: BleChar | undefined;
  for (const s of BLE_SERVICES) {
    try { ch = (await (await server.getPrimaryService(s)).getCharacteristics()).find(c => c.properties.writeWithoutResponse || c.properties.write); } catch { /* not this service */ }
    if (ch) break;
  }
  if (!ch) throw new Error('No printer service on this Bluetooth device.');
  for (let i = 0; i < bytes.length; i += chunk) {
    const part = bytes.slice(i, i + chunk);
    if (ch.properties.writeWithoutResponse && ch.writeValueWithoutResponse) await ch.writeValueWithoutResponse(part); else await ch.writeValue(part);
  }
}

// ── Bridge (LAN printers on 9100, bank ECR over LAN) ──────────────────────────────────────────
export const BRIDGE_URL = 'http://127.0.0.1:9109';
export async function bridgeSend(url: string, host: string, port: number, bytes: Uint8Array) {
  let s = ''; bytes.forEach(b => { s += String.fromCharCode(b); });
  const r = await fetch((url || BRIDGE_URL).replace(/\/$/, '') + '/print', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ host, port: port || 9100, data: btoa(s) }) })
    .catch(() => { throw new Error('BorNiz Bridge is not running on this device (' + (url || BRIDGE_URL) + ').'); });
  if (!r.ok) throw new Error((await r.text()) || 'Bridge error ' + r.status);
}

// ── WebHID (HID POS barcode scanners, usage page 0x8C) ───────────────────────────────────────
export async function pairHid(): Promise<string> {
  const [d] = await need(nav().hid, 'WebHID').requestDevice({ filters: [{ usagePage: 0x8c }] });
  if (!d) throw new Error('No scanner chosen');
  return `hid:${hex(d.vendorId)}:${hex(d.productId)}:${d.productName}`;
}
export async function hidDevice(desc: string) {
  const [, v, p] = desc.split(':');
  const d = (await need(nav().hid, 'WebHID').getDevices()).find(x => hex(x.vendorId) === v && hex(x.productId) === p);
  if (!d) throw new Error('Scanner not found. Plug it in, then tap Pair HID again.');
  if (!d.opened) await d.open();
  return d;
}

/** Friendly name of a paired descriptor. */
export const pairedName = (desc: unknown) => {
  const s = String(desc || ''); if (!s) return '';
  const [k, a, b, , name] = s.split(':');
  return k === 'usb' ? `${name || 'USB'} (${a}:${b})` : k === 'ble' ? s.split(':').slice(2).join(':') : k === 'hid' ? s.split(':').slice(3).join(':') : k === 'serial' ? (a === 'any' ? 'Serial port' : `Serial ${a}:${b}`) : s;
};
