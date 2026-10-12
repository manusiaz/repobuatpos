// Printed extras designed in the Customization Studio (Print): the bounce-back coupon under the receipt and the cup
// sticker per drink. Pure: the receipt, the print agent and the tests share them.
import type { DB, Order, OrderLine } from '../data/schema.ts';
import { fillTool, toolPublished, toolValue } from '../system/tools.ts';
import type { Doc, Op } from './layout.ts';

const p2 = (n: number) => String(n).padStart(2, '0');
const day = (t: number) => { const d = new Date(t); return `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()}`; };

/** Coupon printed under the receipt once the owner published one and its rule matches this sale. */
export function couponOps(db: DB, o: Order): Op[] {
  if (!toolPublished(db, 'coupon')) return [];
  const v = toolValue(db, 'coupon');
  const prints = v.rule === 'every' || (v.rule === 'member' && !!o.customerId) || (v.rule === 'over' && o.total > 100000);
  if (!prints) return [];
  const code = `${v.code}-${o.no.replace(/\D/g, '').slice(-4)}`, from = o.paidAt ?? o.createdAt;
  return [
    { t: 'rule', ch: '=' },
    { t: 'text', s: v.head, align: 'center', bold: true },
    { t: 'text', s: v.offer, align: 'center', bold: true, size: 'tall' },
    { t: 'text', s: 'Code ' + code, align: 'center', bold: true },
    { t: 'text', s: 'Valid until ' + day(from + Number(v.exp) * 864e5), align: 'center' },
    ...(v.min ? [{ t: 'text', s: v.min, align: 'center' } as Op] : []),
    ...(v.bar ? [{ t: 'barcode', data: code } as Op] : []),
    { t: 'rule', ch: '=' },
  ];
}

/** Drinks that get a cup sticker: their recipe uses a cup. */
export const cupped = (db: DB) => new Set(db.recipes.filter(r => r.stockItemId === 'cups').map(r => r.productId));

/** One sticker per cup (qty 2 = two stickers), laid out as the owner published it. Empty when nothing needs a cup. */
export function cupDoc(db: DB, o: Order, lines: OrderLine[]): Doc | null {
  const need = cupped(db), cups = lines.filter(l => need.has(l.productId)).flatMap(l => Array.from({ length: l.qty }, () => l));
  if (!cups.length) return null;
  const v = toolValue(db, 'cup'), w = v.size === '40x30' ? 24 : v.size === '50x30' ? 30 : 32, cut = v.size !== '58';
  const c = db.customers.find(x => x.id === o.customerId);
  const who = (c?.name ?? (o.table ? 'Table ' + o.table : 'Guest')).split(' ')[0];
  const fit = (s: string) => s.slice(0, w);
  const brand = db.tenant.name.split(' ').map(x => x[0]).join('').slice(0, 2).toUpperCase();
  const ops: Op[] = cups.flatMap((l, i) => [
    { t: 'lr', l: fit((v.logo ? brand + ' ' : '') + l.name), r: v.queue ? o.no : '', bold: true },
    ...(v.mods ? [{ t: 'text', s: fit([l.mods.map(m => m.name).join(', '), l.note].filter(Boolean).join(' · ') || 'No modifiers') } as Op] : []),
    ...(v.name ? [{ t: 'text', s: fit(who), bold: true, size: 'tall' } as Op] : []),
    { t: 'text', s: fit(`${fillTool(v.foot, { name: who, table: o.table ?? '-', queue: o.no })} ${i + 1}/${cups.length}`) },
    ...(cut ? [{ t: 'feed', n: 1 } as Op, { t: 'cut' } as Op] : [{ t: 'rule' } as Op]),
  ]);
  if (!cut) ops.push({ t: 'feed', n: 3 }, { t: 'cut' });
  return { paper: '58', ops };
}
