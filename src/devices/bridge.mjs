#!/usr/bin/env node
// BorNiz Bridge: a tiny local helper so the browser can reach LAN printers (raw TCP 9100), which web pages cannot open.
// Run on the register (or any PC at the outlet): `node src/devices/bridge.mjs` → listens on 127.0.0.1:9109.
// POST /print {host, port, data: base64 ESC/POS} → bytes written to host:port. GET /health → {ok:true}.
// Only BorNiz origins may print (BORNIZ_BRIDGE_ORIGINS, comma list, replaces that list), only as JSON (so a browser always
// asks first), and only to printer ports (9100-9109, or BORNIZ_BRIDGE_PORTS): another page open on the register can't
// open the drawer or reach other services on the network. Browsers allow https pages to call http://127.0.0.1 (Private
// Network Access preflight is answered below).
import http from 'node:http';
import net from 'node:net';
import { pathToFileURL } from 'node:url';

export function sendRaw(host, port, bytes, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const s = net.connect({ host, port }, () => s.end(bytes));
    s.setTimeout(timeout, () => { s.destroy(); reject(new Error(`No answer from ${host}:${port}`)); });
    s.on('error', e => reject(new Error(`${host}:${port} ${e.code || e.message}`)));
    s.on('close', err => { if (!err) resolve(); });
  });
}

const PRINTER_PORTS = Array.from({ length: 10 }, (_, i) => 9100 + i);
export function startBridge({ port = 9109, host = '127.0.0.1', allow = /^(https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?|https:\/\/([a-z0-9-]+\.)*bornis\.id)$/, ports = PRINTER_PORTS } = {}) {
  const srv = http.createServer((req, res) => {
    const origin = req.headers.origin || '';
    if (origin && allow.test(origin)) res.setHeader('access-control-allow-origin', origin);
    res.setHeader('access-control-allow-headers', 'content-type');
    res.setHeader('access-control-allow-private-network', 'true');
    if (req.method === 'OPTIONS') return res.end();
    if (req.method === 'GET' && req.url === '/health') { res.setHeader('content-type', 'application/json'); return res.end('{"ok":true}'); }
    if (req.method !== 'POST' || req.url !== '/print') { res.statusCode = 404; return res.end('Not found'); }
    if ((origin && !allow.test(origin)) || !/^application\/json\b/.test(req.headers['content-type'] || '')) { res.statusCode = 403; return res.end('Only BorNiz pages may print here'); }
    let body = '';
    req.on('data', c => { body += c; if (body.length > 4e6) req.destroy(); });
    req.on('end', async () => {
      try {
        const { host: h, port: p = 9100, data } = JSON.parse(body);
        if (!h || !data) throw new Error('host and data are required');
        if (!ports.includes(Number(p))) { res.statusCode = 403; return res.end(`Port ${p} is not a printer port (${ports[0]}-${ports.at(-1)}; BORNIZ_BRIDGE_PORTS)`); }
        await sendRaw(h, Number(p), Buffer.from(data, 'base64'));
        res.end('ok');
      } catch (e) { res.statusCode = 502; res.end(e.message); }
    });
  });
  return new Promise(r => srv.listen(port, host, () => r(srv)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) { // also on Windows and in folders with spaces
  const port = Number(process.env.BORNIZ_BRIDGE_PORT || 9109), extra = process.env.BORNIZ_BRIDGE_ORIGINS; // e.g. https://pos.mycafe.id,https://x.vercel.app
  const ports = process.env.BORNIZ_BRIDGE_PORTS?.split(',').map(Number).filter(Boolean);
  startBridge({ port, ...(ports?.length ? { ports } : {}), ...(extra ? { allow: new RegExp('^(' + extra.split(',').map(o => o.trim().replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')).join('|') + ')$') } : {}) }).then(() => console.log(`BorNiz Bridge on http://127.0.0.1:${port}`));
}
