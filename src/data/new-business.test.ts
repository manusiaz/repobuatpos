// A new business starts from BorNiz's defaults, never from the demo's words: no Kopi Biru WiFi password on its
// receipts, no "20% off" promo it never ran on its customer display, no @kopibiru.id on its menu.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seed } from './seed.ts';
import { menuDesign } from './actions/studio.ts';
import { receiptDoc } from '../devices/receipt.ts';
import { toText } from '../devices/layout.ts';
import type { DB } from './schema.ts';

const DEMO = /kopi ?biru|0812-3456-7890|20% off|Gayo|Asia Afrika/i;
test('a new business shows none of the demo business on its menu, display or receipts', () => {
  const db = seed() as DB, { p, acc, ink, paper, font, banner, img } = db.theme;
  db.theme = { name: 'Warung Sari', p, acc, ink, paper, font, banner, img }; // what starterData gives a new business
  db.tenant.name = 'Warung Sari';
  const d = menuDesign(db);
  assert.doesNotMatch(JSON.stringify(d), DEMO);
  assert.deepEqual(d.sections.filter(s => s.on).map(s => s.k), ['promo', 'best', 'menu', 'hours'], 'no empty announcement, story or Instagram');
  const paid = db.orders.find(o => o.paidAt)!;
  assert.doesNotMatch(toText(receiptDoc(db, paid, '80')).join('\n'), /WiFi|0812-3456-7890/);
});
test('the demo keeps its own words', () => {
  const d = menuDesign(seed() as DB);
  assert.equal(d.copy.insta.en, '@kopibiru.id');
  assert.equal(d.rc.wifiOn, true);
});

test('a dark theme never puts its light text on white cards', async () => {
  const { themeVars, contrast } = await import('../screens/studio/theme.ts');
  const db = seed() as DB;
  db.theme = { ...db.theme, paper: '#14161C', ink: '#F5F2EE' };
  const d = menuDesign(db), surface = (themeVars(d) as Record<string, string>)['--bn-surface'];
  assert.notEqual(surface.toUpperCase(), '#FFFFFF');
  assert.ok(contrast(d.ink, surface) >= 4.5, `${d.ink} on ${surface}`);
  assert.equal((themeVars(menuDesign(seed() as DB)) as Record<string, string>)['--bn-surface'], '#FFFFFF', 'light themes keep white cards');
});

test('a business without its own records gets no alert from the demo samples (batches, transfers, budgets, assets)', async () => {
  const { planAlerts } = await import('./alerts/index.ts');
  const SAMPLE = ['Batch expiring', 'Batch expired', 'Transfer incoming', 'Stock transfer not received', 'Expense over budget', 'Equipment service due', 'Repair cost high', 'Gas / water / power bill spike', 'Laundry ready for pickup'];
  const fired = (db: DB) => planAlerts(db, Date.now()).map(p => p.alert).filter(a => SAMPLE.includes(a));
  const demo = seed() as DB, fresh = seed() as DB;
  fresh.records = {};
  assert.deepEqual(fired(fresh), []);
  assert.ok(fired(demo).length > 0, 'the demo still shows them: ' + fired(demo).join(', '));
});
