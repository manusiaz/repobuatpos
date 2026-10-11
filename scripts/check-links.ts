// Every in-app link must be a registry page (spec rule: any href a page uses must exist).
import fs from 'node:fs';
import path from 'node:path';
import { PAGES } from '../src/system/registry.ts';
const paths = new Set(PAGES.map(p => p.path));
const files: string[] = [];
const walk = (d: string) => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else if (/\.(tsx?|mjs)$/.test(f)) files.push(p); } };
walk(new URL('../src', import.meta.url).pathname);
let bad = 0;
const ROOTS = /^\/(owner|manager|pic|pos|kds|display|order|kiosk|admin|system|account|online|waiter|studios|graph)(\/|$)/;
for (const f of files.filter(f => !f.endsWith('registry.ts'))) {
  const src = fs.readFileSync(f, 'utf8');
  for (const m of src.matchAll(/['"`](\/[a-z0-9\-\/]+)(?:[?#][^'"`]*)?['"`]/g)) {
    const p = m[1].replace(/\/$/, '') || '/';
    if (!ROOTS.test(p) || paths.has(p)) continue;
    if (src.slice(Math.max(0, m.index! - 40), m.index).match(/(startsWith|replace|split|test|RegExp|ROLE_PREFIX)/)) continue;
    bad++; console.log(`${path.relative(process.cwd(), f)}: ${p}`);
  }
}
console.log(bad ? `${bad} broken links` : 'all links resolve');
process.exit(bad ? 1 : 0);
