// <Icon name> draws a plain circle for a name Lucide doesn't have (renamed in Lucide 1.x: help, history, filter,
// trash-2 …), so a wrong name ships silently. Every literal icon name in the code must exist.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
const { icons } = createRequire(import.meta.url)('lucide-react') as { icons: Record<string, unknown> };
const pascal = (s: string) => s.replace(/(^|-)([a-z0-9])/g, (_, __, c: string) => c.toUpperCase());
const walk = (d: string): string[] => readdirSync(d).flatMap(f => { const p = d + '/' + f; return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(f) ? [p] : []; });

test('every icon name in the code is a Lucide icon', () => {
  const bad: string[] = [];
  for (const f of walk(new URL('..', import.meta.url).pathname)) {
    const s = readFileSync(f, 'utf8');
    for (const m of s.matchAll(/<Icon name=\{?["']([a-z0-9-]+)["']|\bicon(?:Name)?[=:]\s*["']([a-z0-9-]+)["']/g)) {
      const n = m[1] ?? m[2];
      if (!icons[pascal(n)]) bad.push(`${n} (${f.split('/src/')[1]})`);
    }
  }
  assert.deepEqual(bad, []);
});
