// One-system check: every feature lives on exactly one real page, every page is connected by the design rules,
// and no release depends on data that only a later release creates. `npm run check:system`
import { REAL, ASSIGNMENT_PROBLEMS, featuresOf, FEATURES, RELEASES } from '../src/system/pagemap.ts';
import { linksOf, releaseGaps } from '../src/system/connections.ts';
import { pageAt, PAGES } from '../src/system/registry.ts';
const fail: string[] = [...ASSIGNMENT_PROBLEMS];
for (const r of REAL) {
  if (!pageAt(r.path)) fail.push(`${r.id}: canonical path ${r.path} is not a route`);
  if (!r.hidden && linksOf(r).length === 0) fail.push(`${r.id}: not connected to any page`);
}
const unassigned = PAGES.filter(p => !p.extra && !FEATURES.has(p.path));
unassigned.forEach(p => fail.push(`feature without a page: ${p.name}`));
fail.push(...releaseGaps());
const per = RELEASES.map(rel => `${rel}: ${REAL.filter(r => r.release === rel && !r.hidden).length} pages`).join(' · ');
console.log(`${FEATURES.size} features → ${REAL.filter(r => !r.hidden).length} pages (${per})`);
console.log(`connections: ${REAL.reduce((a, r) => a + linksOf(r).length, 0)}`);
if (fail.length) { console.log(fail.join('\n')); process.exit(1); }
console.log('one system: every feature has a page, every page is connected, no release gap');

// Rule (spec/CLAUDE.md): any href a page uses must exist in LINKS. Cross-app links in code must follow a design or data connection.
import fs from 'node:fs';
import path from 'node:path';
import { homeOf } from '../src/system/pagemap.ts';
import catalog from '../src/system/catalog.json' with { type: 'json' };
const SURFACE_PAGE: Record<string, string> = {};
for (const r of REAL) { const s = pageAt(r.path)?.surface; if (s && !(s in SURFACE_PAGE)) SURFACE_PAGE[s] = r.id; }
const files: string[] = [];
const walk = (d: string) => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else if (/\.tsx?$/.test(f)) files.push(p); } };
walk(new URL('../src/screens', import.meta.url).pathname);
const undeclared = new Set<string>();
for (const f of files) {
  const surface = path.relative(new URL('../src/screens', import.meta.url).pathname, f).split(/[/.]/)[0];
  const fromPages = REAL.filter(r => pageAt(r.path)?.surface === surface || featuresOf(r.id).some(x => pageAt(x.path)?.surface === surface));
  if (!fromPages.length) continue;
  for (const m of fs.readFileSync(f, 'utf8').matchAll(/['"`](\/[a-z0-9\-/]+)['"`?]/g)) {
    const to = homeOf(m[1]); if (!to || fromPages.includes(to)) continue;
    const L = catalog.links as unknown as Record<string, [string, string][]>;
    const declared = (a: string, b: string) => a === b || (L[a] ?? []).some(x => x[0] === b) || (L[b] ?? []).some(x => x[0] === a);
    // system states are shared components; their only links are "back to your home"
    const ok = fromPages.some(fp => fp.hidden || declared(fp.proto, to.proto) || linksOf(fp).some(l => l.to === to && l.kind !== 'design'));
    if (!ok) undeclared.add(`${surface} → ${to.title} (${m[1]})`);
  }
}
if (undeclared.size) { console.log(`\n${undeclared.size} cross-page links in code that no LINKS / data rule declares:`); console.log([...undeclared].sort().join('\n')); process.exitCode = 1; }
else console.log('every cross-page link in code is declared by LINKS or shared data');
