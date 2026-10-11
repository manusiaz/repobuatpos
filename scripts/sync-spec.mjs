// Reads the BorNiz design system (spec/) and writes src/system/spec.json.
// spec/ is the single source of truth: update it from the design tool, then run `npm run spec`.
import fs from 'node:fs';
import vm from 'node:vm';

const dir = new URL('../spec/', import.meta.url);
const read = f => fs.readFileSync(new URL(f, dir), 'utf8');

function sandbox() {
  const store = {};
  const el = () => ({ style: {}, appendChild() {}, setAttribute() {}, addEventListener() {}, classList: { add() {}, remove() {} } });
  const w = {
    localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
    document: { currentScript: { src: '' }, createElement: el, head: el(), body: el(), addEventListener() {}, querySelectorAll: () => [], querySelector: () => null, readyState: 'complete' },
    location: { search: '', href: '', pathname: '/' }, addEventListener() {}, setTimeout() {}, setInterval() {}, clearTimeout() {}, console,
  };
  w.window = w; w.self = w; w.top = w;
  return vm.createContext(w);
}
const ctx = sandbox();
for (const f of ['bn-sitemap.js', 'bn-authority.js', 'bn-alerts.js', 'bn-diagrams.js', 'bn-pm.js']) vm.runInContext(read(f), ctx, { filename: f });
const W = ctx.window;
const diagrams = W.BN_DIAGRAMS;
vm.runInContext(read('bn-diagrams-logic.js'), ctx);
const logic = W.BN_DIAGRAMS;

const block = (src, start, end = '];') => { const i = src.indexOf(start); const j = src.indexOf(end, i); return src.slice(i, j + end.length); };
const evalExpr = (code, name) => vm.runInNewContext(code + `;${name}`, { window: {} });

const launcher = read('bn-launcher.js');
const apps = evalExpr(block(launcher, 'var APPS = ['), 'APPS').map(([group, name, job, icon, color, file, device, roles]) =>
  ({ group, name, job, icon, color, screen: file.replace(/^BorNiz |\.dc\.html$/g, ''), device, roles: roles.split(' ') }));
const perms = evalExpr(block(read('bn-perms.js'), 'var DEF = {', '};'), 'DEF');
const brandSrc = read('bn-brand.js');
const brandThemes = evalExpr(block(brandSrc, 'var THEMES = {', '};'), 'THEMES');

const conn = read('BorNiz Connections.dc.html');
const links = evalExpr(block(conn, 'const LINKS = window.BN_LINKS = {', '\n};').replace('const LINKS = window.BN_LINKS =', 'var LINKS ='), 'LINKS');
const rec = evalExpr(block(conn, 'const REC = {', '\n};').replace('const REC', 'var REC'), 'REC');
const live = evalExpr(block(conn, 'const LIVE = [').replace('const LIVE', 'var LIVE'), 'LIVE');

const notes = read('BorNiz Design Notes.dc.html');
const notesCode = notes.slice(notes.indexOf('const C = {'), notes.indexOf('class Component'));
const surfaces = vm.runInNewContext(notesCode.replace(/\bconst\b/g, 'var') + ';({PAGES,ORDER})', {});

// Page → mode / dedicated screen / studio / data object. Same precedence as the Back Office prototype.
const auth = W.BN_AUTH;
const pages = [];
for (const [role, host, title, groups] of W.BN_SITEMAP) {
  for (const [group, list] of Object.entries(groups)) {
    for (const name of list) {
      const screen = W.BN_SCREEN(name, group), studio = W.BN_STUDIO(name, group);
      let mode = W.BN_MODE(name, group);
      const au = auth.forPage(name);
      // Fix vs prototype: an Approve page never drops to read-only, and a Report never turns into Settings.
      if (au && !screen && !studio && mode !== 'approve' && !(mode === 'read' && au.src === 'config')) {
        if (au.src === 'auto') mode = mode === 'record' ? 'record' : 'read';
        else if (au.src === 'incoming') mode = 'incoming';
        else if (au.src === 'adj') mode = mode === 'approve' ? 'approve' : 'record';
        else if (au.src === 'config') mode = 'settings';
      }
      pages.push({ role, host, area: title, group, name, mode, object: au ? au.id : null,
        screen: (screen || studio || [null])[0] });
    }
  }
}

// Split so each surface only bundles what it reads (the POS must stay small for offline use).
const files = {
  'pages.json': { pages, modes: W.BN_MODEUI },
  'authority.json': { objects: auth.objects, src: auth.SRC, ladder: auth.LADDER, loopholes: auth.LOOP },
  'alerts.json': { groups: W.BN_ALERTS, roles: W.BN_ALERT_ROLES, guest: W.BN_GUEST, destinations: W.BN_DEST },
  'catalog.json': { perms, apps, brandThemes, links, records: rec, live, surfaces: surfaces.PAGES, surfaceOrder: surfaces.ORDER },
  'docs.json': { diagrams, logic, product: W.BN_PM },
};
for (const [f, data] of Object.entries(files)) fs.writeFileSync(new URL('../src/system/' + f, import.meta.url), JSON.stringify(data));
const byMode = pages.reduce((a, p) => (a[p.mode] = (a[p.mode] || 0) + 1, a), {});
console.log(`spec.json: ${pages.length} pages`, byMode, `${auth.objects.length} objects, ${apps.length} apps`);
