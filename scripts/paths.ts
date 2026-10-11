import { PAGES } from '../src/system/registry.ts';
const s = process.argv[2];
for (const p of PAGES.filter(p => !s || s.split(',').includes(p.surface))) console.log(p.surface.padEnd(10), p.path, '|', p.name);
