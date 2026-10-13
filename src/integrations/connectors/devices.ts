// Hardware on the register: printers, cash drawer, card terminal, scanner, scale, pole display. Drivers live in src/devices.
// ready = works end to end from the browser today (or through the BorNiz Bridge helper); bank ECR waits for the bank protocol.
import type { Connector, Field } from '../types.ts';
import { STATIONS } from '../../devices/routing.ts';
import { BANKS } from '../../devices/edc.ts';

const BAUD: [string, string][] = [['2400', '2400'], ['4800', '4800'], ['9600', '9600 (most)'], ['19200', '19200'], ['38400', '38400'], ['115200', '115200']];
const PRINT: Field[] = [
  { key: 'station', label: 'Prints', type: 'select', options: STATIONS, required: true, help: 'Kitchen tickets follow each menu category’s station (Owner › Printer & KDS routing). A station with no printer shows on the KDS only.' },
  { key: 'paper', label: 'Paper width', type: 'select', options: [['80', '80 mm · 48 columns'], ['58', '58 mm · 32 columns']], required: true },
  { key: 'autoPrint', label: 'Print the receipt automatically when a sale is paid', type: 'toggle' },
  { key: 'copies', label: 'Receipt copies', type: 'number', placeholder: '1' },
];
const ECR: Field[] = [
  { key: 'transport', label: 'Connection', type: 'select', options: [['serial', 'USB / RS-232 cable (Web Serial)'], ['lan', 'LAN (via BorNiz Bridge)']], required: true },
  { key: 'terminalId', label: 'Terminal ID (TID)', required: true, placeholder: '8 digits on the EDC' },
  { key: 'merchantId', label: 'Merchant ID (MID)', required: true, placeholder: '15 digits from the bank' },
  { key: 'baud', label: 'Baud rate (cable)', type: 'select', options: BAUD },
  { key: 'ip', label: 'EDC IP address (LAN)', placeholder: '192.168.1.50' },
  { key: 'port', label: 'EDC port (LAN)', type: 'number', placeholder: '9999' },
  { key: 'ecrKey', label: 'ECR key from the bank', type: 'secret' },
];
const ecr = (id: string, bank: string): Connector => ({ id, kind: 'edc', name: `${bank} EDC · ECR link`, scope: 'device', runtime: 'browser', ready: false, fields: ECR,
  blurb: `Sends the amount to the ${bank} terminal and reads the approval back, no typing. Until the ${bank} ECR driver is written the register uses manual entry from the slip.` });

export const CONNECTORS: Connector[] = [
  { id: 'printer-usb', kind: 'printer', name: 'Thermal printer · USB', scope: 'device', runtime: 'browser', ready: true,
    blurb: 'ESC/POS printers on a USB cable (Epson TM, Xprinter, RONGTA, EPPOS). Chrome or Edge; on Windows the printer needs the WinUSB driver.', fields: PRINT },
  { id: 'printer-bluetooth', kind: 'printer', name: 'Thermal printer · Bluetooth', scope: 'device', runtime: 'browser', ready: true,
    blurb: 'Bluetooth LE mini printers (58/80 mm) from an Android tablet or a laptop. Chrome asks to pick the printer once per session.',
    fields: [...PRINT, { key: 'chunk', label: 'Bytes per packet', type: 'number', placeholder: '20', help: 'Raise to 100–180 if printing is slow and the printer keeps up.' }] },
  { id: 'printer-serial', kind: 'printer', name: 'Thermal printer · Serial', scope: 'device', runtime: 'browser', ready: true,
    blurb: 'RS-232 or USB-serial printers through Web Serial.', fields: [...PRINT, { key: 'baud', label: 'Baud rate', type: 'select', options: BAUD, required: true }] },
  { id: 'printer-lan', kind: 'printer', name: 'Network printer · LAN', scope: 'device', runtime: 'bridge', ready: true,
    blurb: 'Kitchen and bar printers on the network (port 9100). Browsers cannot open raw sockets, so the BorNiz Bridge helper on this register forwards the print.',
    fields: [...PRINT, { key: 'host', label: 'Printer IP address', required: true, placeholder: '192.168.1.87' }, { key: 'port', label: 'Port', type: 'number', placeholder: '9100' },
      { key: 'bridge', label: 'Bridge address', type: 'url', placeholder: 'http://127.0.0.1:9109', help: 'Run `node src/devices/bridge.mjs` on this register (keep it on 127.0.0.1).' }] },
  { id: 'printer-browser', kind: 'printer', name: 'Any printer · browser print', scope: 'device', runtime: 'browser', ready: true,
    blurb: 'Works on every device today: AirPrint, Android print service or any printer the computer knows. Opens the print dialog unless Chrome runs with --kiosk-printing. Cannot open a cash drawer.', fields: PRINT },

  { id: 'drawer-kick', kind: 'drawer', name: 'Cash drawer · printer kick port', scope: 'device', runtime: 'browser', ready: true,
    blurb: 'The drawer cable (RJ11) plugs into the receipt printer; BorNiz sends the kick pulse through that printer. Every open is logged.',
    fields: [{ key: 'openOn', label: 'Open automatically', type: 'select', options: [['cash', 'On cash payments'], ['never', 'Never (only Open drawer)']], required: true },
      { key: 'pin', label: 'Kick pin', type: 'select', options: [['0', 'Pin 2 · drawer 1 (most)'], ['1', 'Pin 5 · drawer 2']] }] },

  { id: 'edc-manual', kind: 'edc', name: 'Standalone EDC · approval code', scope: 'device', runtime: 'manual', ready: true,
    blurb: 'Any bank terminal. Key the amount on the EDC, then type the approval code and the card’s last 4 digits from the slip. Stored on the payment for reconciliation.',
    fields: [{ key: 'bank', label: 'Bank', type: 'select', options: BANKS, required: true }, { key: 'terminalId', label: 'Terminal ID (TID)' }, { key: 'merchantId', label: 'Merchant ID (MID)' },
      { key: 'requireLast4', label: 'Ask for the last 4 card digits', type: 'toggle' }] },
  { id: 'edc-simulator', kind: 'edc', name: 'EDC simulator', scope: 'device', runtime: 'browser', ready: true,
    blurb: 'Demo and training: answers like a bank terminal (approve or decline) with an approval code and trace number.', fields: [] },
  ecr('edc-bca', 'BCA'), ecr('edc-mandiri', 'Mandiri'), ecr('edc-bri', 'BRI'), ecr('edc-bni', 'BNI'),

  { id: 'scanner-wedge', kind: 'scanner', name: 'Barcode scanner · keyboard mode', scope: 'device', runtime: 'browser', ready: true,
    blurb: 'USB or Bluetooth scanners in their default keyboard mode. Scans add the product by SKU on the register; no driver needed.',
    fields: [{ key: 'minLength', label: 'Shortest code', type: 'number', placeholder: '4' }, { key: 'maxGap', label: 'Max ms between keys', type: 'number', placeholder: '35', help: 'Scanners type faster than people. Raise to 50 for slow Bluetooth scanners.' }] },
  { id: 'scanner-hid', kind: 'scanner', name: 'Barcode scanner · HID POS mode', scope: 'device', runtime: 'browser', ready: false,
    blurb: 'Scanners switched to HID POS (usage page 0x8C) through WebHID, so scans never type into a field. Report parsing still needs testing per model; keyboard mode works today.', fields: [] },

  { id: 'attendance-zkteco', kind: 'attendance', name: 'Attendance machine · fingerprint / face', scope: 'outlet', runtime: 'server', ready: true,
    blurb: 'ZKTeco and other machines with ADMS cloud push (Solution, Magic, Revo …). Each scan becomes a clock-in or clock-out for the staff member linked to that machine user ID.',
    fields: [{ key: 'serial', label: 'Serial number (SN)', required: true, placeholder: 'CKJF203960123', help: 'On the sticker under the machine, or Menu › System info › Device info.' },
      { key: 'tz', label: 'Machine time zone', type: 'select', options: [['+07:00', 'WIB (UTC+7)'], ['+08:00', 'WITA (UTC+8)'], ['+09:00', 'WIT (UTC+9)']] }] },

  { id: 'scale-serial', kind: 'scale', name: 'Scale · serial', scope: 'device', runtime: 'browser', ready: true,
    blurb: 'CAS, Digi, Ohaus and other scales with RS-232 or USB-serial output. Weighed items read the stable weight with one tap.',
    fields: [{ key: 'baud', label: 'Baud rate', type: 'select', options: BAUD, required: true }, { key: 'unit', label: 'Scale sends', type: 'select', options: [['kg', 'Kilograms'], ['g', 'Grams']] },
      { key: 'request', label: 'Request command', placeholder: 'Blank = continuous output', help: 'Some scales answer only when asked, e.g. W or P.' }] },

  { id: 'display-pole', kind: 'display', name: 'Pole display · VFD 2×20', scope: 'device', runtime: 'browser', ready: true,
    blurb: 'Two-line customer pole display (Epson DM-D compatible) on a serial or USB-serial cable. Shows the amount due and the change.',
    fields: [{ key: 'baud', label: 'Baud rate', type: 'select', options: BAUD, required: true }, { key: 'greeting', label: 'Idle text', placeholder: 'Selamat datang' }] },
];
