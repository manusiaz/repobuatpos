// Demo tenant "Kopi Biru" (names and numbers match the prototypes in spec/). Deterministic so every surface agrees.
import type { DB, Order, OrderLine, Payment, Product } from './schema.ts';
import { orderTotals } from '../domain/order.ts';
import type { Method, Source } from '../domain/order.ts';

export const DB_VERSION = 6;
export const DAY = 864e5;

export function rng(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const P = (id: string, name: string, price: number, cat: string, hue: number, mods: string[] = [], cost = 0.32): Product =>
  ({ id, name, categoryId: cat, basePrice: price, scope: 'global', ownerOutletId: null, status: 'live', hue, sku: 'KB-' + id.slice(1).padStart(3, '0'), desc: '', modifierGroupIds: mods, cost: Math.round(price * cost) });

/** The demo's records for objects without their own table (columns in templates/views.ts GENERIC); a new business has none. */
const DEMO_ROWS: Record<string, string[][]> = {
  expense: [['Rent October', 'Senayan', 'Booked', '01 Oct', '45000000'], ['Electricity', 'Kemang', 'Booked', '05 Oct', '6200000'], ['Ice supply', 'Senayan', 'Pending', '09 Oct', '850000'], ['Pest control', 'BSD', 'Draft', '10 Oct', '1200000']],
  budget: [['Sales target', 'Senayan', 'Approved', 'Oct 2026', '420000000'], ['Sales target', 'Kemang', 'Approved', 'Oct 2026', '310000000'], ['Marketing budget', 'All outlets', 'Pending', 'Q4 2026', '25000000']],
  asset: [['La Marzocco Linea PB', 'Senayan', 'Active', 'Jan 2025', '185000000'], ['Mahlkönig E80 grinder', 'Kemang', 'Active', 'Mar 2025', '62000000'], ['Chiller repair', 'BSD', 'Pending', '08 Oct', '3400000'], ['6 tables + 24 chairs terrace', 'Senayan', 'Pending', '10 Oct', '18600000']],
  reward: [['Free Americano', 'All outlets', 'Active', 'Sep', '250'], ['Croissant Almond', 'All outlets', 'Active', 'Sep', '320'], ['Tumbler Kopi Biru', 'All outlets', 'Active', 'Aug', '1200'], ['Birthday cake slice', 'All outlets', 'Draft', 'Oct', '0']],
  broadcast: [['Payday promo 25 Oct', 'All outlets', 'Scheduled', '25 Oct 10:00', '1840'], ['New menu: Pandan Latte', 'All outlets', 'Sent', '02 Oct', '2210'], ['Kemang reopening', 'Kemang', 'Draft', '—', '640']],
  transfer: [['Oat milk 1L × 12 · Senayan → Kemang', 'Kemang', 'Sent', '10 Oct', '360000'], ['Croissant × 40 · BSD → Senayan', 'Senayan', 'Received', '08 Oct', '360000']],
  batch: [['Fresh milk · LOT 2410-A', 'Senayan', 'OK', '14 Oct', '48'], ['Fresh milk · LOT 2409-C', 'Kemang', 'Expiring', '11 Oct', '6'], ['Croissant frozen · LOT 88', 'BSD', 'OK', '30 Nov', '120']],
  leave: [['Rina · annual leave', 'Senayan', 'Waiting', '20–22 Oct', '3'], ['Tono · swap with Wulan', 'Senayan', 'Waiting', '15 Oct', '1'], ['Dimas · overtime', 'Senayan', 'Approved', '09 Oct', '0.5']],
  service: [['Queue A', 'Senayan', 'Open', 'now', 'A-042'], ['Courier · Joko', 'Senayan', 'On delivery', '12 min', 'D-08'], ['Laundry #L-221', 'Kemang', 'Ready', '1 h', 'L-221']],
  busy: [['GoFood busy mode · lunch rush', 'Senayan', 'Ended', 'Today 12:10', '20'], ['GrabFood paused · gas leak check', 'Kemang', 'Ended', 'Yesterday', '45']],
  incident: [['Broken glass · bar', 'Senayan', 'Logged', 'Today 13:20', '45000'], ['Complaint · cold croissant · comp', 'Senayan', 'Comped', 'Today 11:05', '32000']],
};
const demoRecords = (now: number): DB['records'] => Object.fromEntries(Object.entries(DEMO_ROWS).map(([k, rs]) =>
  [k, rs.map((r, i) => ({ id: k + i, a: r[0], b: r[1], c: r[2], d: r[3], e: r[4], at: now - i * 864e5 }))]));

/** The demo's own Menu Studio words (a new business starts from defaultDesign, which has none of them). */
const KOPI_BIRU_DESIGN = {
  tagline: 'Coffee & slow mornings',
  sections: [['announce', true], ['promo', true], ['best', true], ['menu', true], ['about', true], ['hours', true], ['social', true], ['reviews', false]].map(([k, on]) => ({ k, on })),
  copy: {
    announce: { en: 'Payday week: 20% off all coffee until Sunday', id: 'Minggu gajian: diskon 20% semua kopi sampai Minggu' },
    about: { en: 'We roast beans from Gayo and Kintamani every Tuesday and brew them slow. Stay as long as you like.', id: 'Kami sangrai biji Gayo dan Kintamani tiap Selasa dan seduh pelan-pelan. Santai saja di sini.' },
    insta: { en: '@kopibiru.id', id: '@kopibiru.id' },
  },
  rc: { h1: 'Jl. Asia Afrika 8, Senayan, Jakarta', f2: 'Kritik & saran: 0812-3456-7890', wifi: 'KOPIBIRU-GUEST · senayan8', wifiOn: true },
  dc: { idleHead: 'Payday week: 20% off all coffee' },
  mc: { prog: 'Biru Rewards' },
};
export function seed(now = Date.now()): DB {
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const t0 = today.getTime();
  const products: Product[] = [
    P('p1', 'Es Kopi Susu Aren', 25000, 'coffee', 60, ['size', 'sugar', 'ice', 'milk', 'shot']), P('p2', 'Americano', 22000, 'coffee', 50, ['size', 'ice', 'shot']),
    P('p3', 'Cappuccino', 28000, 'coffee', 45, ['size', 'milk', 'shot']), P('p4', 'Matcha Latte', 30000, 'noncoffee', 140, ['size', 'sugar', 'ice', 'milk']),
    P('p5', 'Teh Tarik', 18000, 'noncoffee', 70, ['sugar', 'ice']), P('p6', 'Chocolate', 26000, 'noncoffee', 40, ['size', 'sugar', 'ice', 'milk']),
    P('p7', 'Croissant Almond', 32000, 'pastry', 80, [], .38), P('p8', 'Banana Bread', 28000, 'pastry', 90, [], .3), P('p9', 'Pain au Chocolat', 30000, 'pastry', 55, [], .36),
    P('p10', 'Nasi Goreng Spesial', 38000, 'rice', 30, ['spicy'], .35), P('p11', 'Ayam Bakar Madu', 42000, 'rice', 20, ['spicy'], .4), P('p12', 'Air Mineral', 8000, 'other', 220, [], .25),
    P('p13', 'Pandan Latte', 29000, 'coffee', 120, ['size', 'sugar', 'ice', 'milk']), P('p14', 'Cheesecake', 35000, 'pastry', 30, [], .4),
  ];
  products.push({ ...P('p15', 'Kopi Tubruk Senayan', 20000, 'coffee', 35), scope: 'local', ownerOutletId: 'sen', status: 'pending_owner', promoteRequested: true });
  const outlets = [
    { id: 'sen', name: 'Senayan', city: 'Jakarta Selatan', serviceBps: 500, taxBps: 1000, taxInclusive: false, opens: '07:00', closes: '22:00', tables: 16, online: true },
    { id: 'kem', name: 'Kemang', city: 'Jakarta Selatan', serviceBps: 500, taxBps: 1000, taxInclusive: false, opens: '08:00', closes: '23:00', tables: 12, online: true },
    { id: 'bsd', name: 'BSD', city: 'Tangerang Selatan', serviceBps: 0, taxBps: 1000, taxInclusive: true, opens: '09:00', closes: '21:00', tables: 10, online: true },
  ];
  const E = (id: string, name: string, role: DB['employees'][0]['role'], outs: string[], color: string, wage = 5_200_000) =>
    ({ id, name, role, outlets: outs, pin: '1234', approvalPin: '246810', phone: '0812 ' + (1000 + id.length * 97) + ' ' + (4000 + name.length * 131), color, active: true, wage });
  const employees = [
    E('budi', 'Budi', 'owner', ['sen', 'kem', 'bsd'], '#F26B1D', 0), E('andi', 'Andi', 'manager', ['sen', 'kem'], '#2F6FEB', 9_500_000),
    E('maya', 'Maya', 'pic', ['sen'], '#5B8CFF', 6_200_000), E('sari', 'Sari', 'pic', ['sen', 'kem'], '#1F9D55', 6_200_000), E('lia', 'Lia', 'pic', ['bsd'], '#0E8A7E', 6_000_000),
    E('rina', 'Rina', 'cashier', ['sen'], '#F26B1D'), E('tono', 'Tono', 'cashier', ['sen'], '#7C3AED'), E('wulan', 'Wulan', 'cashier', ['kem'], '#E0A93B'),
    E('dimas', 'Dimas', 'kitchen', ['sen'], '#1F9D55'), E('hadi', 'Hadi', 'kitchen', ['kem'], '#1F9D55'), E('joko', 'Joko', 'waiter', ['sen'], '#0E8A7E'), E('putri', 'Putri', 'waiter', ['kem'], '#0E8A7E'),
  ];
  const stockItems = [
    ['beans', 'Arabica beans', 'kg', 260000, 3], ['milk', 'Fresh milk', 'L', 22000, 12], ['oat', 'Oat milk', 'L', 30000, 6], ['aren', 'Palm sugar syrup', 'L', 45000, 2],
    ['matcha', 'Matcha powder', 'kg', 480000, 0.5], ['cups', 'Cups 16oz', 'pcs', 900, 300], ['croissant', 'Croissant (frozen)', 'pcs', 9000, 20], ['butter', 'Butter', 'kg', 140000, 1],
    ['rice', 'Rice', 'kg', 15000, 10], ['chicken', 'Chicken', 'kg', 48000, 5], ['egg', 'Eggs', 'pcs', 2200, 30], ['water', 'Mineral water 600ml', 'pcs', 3000, 48],
    ['tea', 'Black tea', 'kg', 120000, 0.5], ['choco', 'Chocolate powder', 'kg', 160000, 1], ['pandan', 'Pandan syrup', 'L', 52000, 1],
  ].map(([id, name, unit, unitCost, par]) => ({ id: id as string, name: name as string, unit: unit as string, unitCost: unitCost as number, par: par as number }));
  const R = (productId: string, list: [string, number][]) => list.map(([stockItemId, qty]) => ({ productId, stockItemId, qty }));
  const recipes = [
    ...R('p1', [['beans', .018], ['milk', .15], ['aren', .03], ['cups', 1]]), ...R('p2', [['beans', .018], ['cups', 1]]), ...R('p3', [['beans', .018], ['milk', .18], ['cups', 1]]),
    ...R('p4', [['matcha', .006], ['milk', .2], ['cups', 1]]), ...R('p5', [['tea', .008], ['milk', .1], ['cups', 1]]), ...R('p6', [['choco', .025], ['milk', .2], ['cups', 1]]),
    ...R('p7', [['croissant', 1], ['butter', .01]]), ...R('p9', [['croissant', 1], ['choco', .01]]), ...R('p10', [['rice', .2], ['egg', 1], ['chicken', .05]]),
    ...R('p11', [['rice', .2], ['chicken', .25]]), ...R('p12', [['water', 1]]), ...R('p13', [['beans', .018], ['milk', .15], ['pandan', .03], ['cups', 1]]),
  ];
  const movements = outlets.flatMap(o => stockItems.map(s => ({ outletId: o.id, stockItemId: s.id, qty: Math.round(s.par * (o.id === 'kem' && s.id === 'oat' ? .6 : 2.4) * 100) / 100, type: 'receipt' as const, sourceId: 'opening', by: 'budi', at: t0 - 7 * DAY })));
  const customers = [
    ['c1', 'Dewi Anggraini', '0812 3456 7890', 1240], ['c2', 'Budi Santoso', '0813 2222 1010', 320], ['c3', 'Rina Pratiwi', '0857 8888 4321', 4480],
    ['c4', 'Arif Wibowo', '0811 9090 1212', 860], ['c5', 'Maya Lestari', '0819 2323 4545', 1720], ['c6', 'Sinta Lestari', '0812 7777 3131', 140],
    ['c7', 'Hendra Wijaya', '0813 5656 7878', 2210], ['c8', 'Putri Ayu', '0857 1212 3434', 95],
  ].map(([id, name, phone], i) => ({ id: id as string, name: name as string, phone: phone as string, email: (name as string).split(' ')[0].toLowerCase() + '@mail.id', joinedAt: t0 - (200 - i * 20) * DAY, optIn: i !== 5, credit: i === 6 ? 150000 : 0, deposit: i === 2 ? 250000 : 0 }));
  const ledger = customers.map((c, i) => ({ customerId: c.id, points: [1240, 320, 4480, 860, 1720, 140, 2210, 95][i], reason: 'Opening balance', at: t0 - 30 * DAY }));

  // 14 days of paid history, generated (ids start with "h", never persisted)
  const { orders, payments } = history(products, outlets, t0, now);
  const roster = outlets.flatMap(o => Array.from({ length: 7 }, (_, day) => ({ outletId: o.id, day,
    slots: o.id === 'sen' ? { pagi: { pic: 'sari', crew: ['rina', 'dimas', 'joko'] }, siang: { pic: 'maya', crew: ['tono', 'dimas', 'joko'] }, malam: { pic: 'maya', crew: ['tono'] } }
      : o.id === 'kem' ? { pagi: { pic: 'sari', crew: ['wulan', 'hadi', 'putri'] }, siang: { pic: 'sari', crew: ['wulan', 'hadi'] }, malam: { pic: 'andi', crew: ['putri'] } }
      : { pagi: { pic: 'lia', crew: [] }, siang: { pic: 'lia', crew: [] }, malam: { pic: 'lia', crew: [] } } })));

  return {
    v: DB_VERSION,
    tenant: { id: 'kopibiru', name: 'Kopi Biru', plan: 'pro', locks: { menuPrices: false, outletOnlyItems: true, brand: true } },
    outlets, employees,
    categories: [{ id: 'coffee', name: 'Coffee', station: 'bar' }, { id: 'noncoffee', name: 'Non-coffee', station: 'bar' }, { id: 'pastry', name: 'Pastry', station: 'pastry' }, { id: 'rice', name: 'Rice', station: 'kitchen' }, { id: 'other', name: 'Others', station: 'bar' }],
    modifierGroups: [
      { id: 'size', name: 'Size', required: true, max: 1, options: [{ id: 'reg', name: 'Regular', price: 0 }, { id: 'lg', name: 'Large', price: 5000 }] },
      { id: 'sugar', name: 'Sugar', required: true, max: 1, options: [{ id: 'normal', name: 'Normal sugar', price: 0 }, { id: 'less', name: 'Less sugar', price: 0 }, { id: 'none', name: 'No sugar', price: 0 }] },
      { id: 'ice', name: 'Ice', required: false, max: 1, options: [{ id: 'normal', name: 'Normal ice', price: 0 }, { id: 'less', name: 'Less ice', price: 0 }, { id: 'hot', name: 'Hot', price: 0 }] },
      { id: 'milk', name: 'Milk', required: false, max: 1, options: [{ id: 'fresh', name: 'Fresh milk', price: 0 }, { id: 'oat', name: 'Oat milk', price: 6000 }] },
      { id: 'shot', name: 'Extra', required: false, max: 2, options: [{ id: 'shot', name: 'Extra shot', price: 5000 }, { id: 'cream', name: 'Whipped cream', price: 4000 }] },
      { id: 'spicy', name: 'Spice level', required: true, max: 1, options: [{ id: 'mild', name: 'Mild', price: 0 }, { id: 'med', name: 'Medium', price: 0 }, { id: 'hot', name: 'Hot', price: 0 }] },
    ],
    products,
    outletProducts: outlets.flatMap(o => products.filter(p => p.scope === 'global' || p.ownerOutletId === o.id).map(p => ({ productId: p.id, outletId: o.id, localPrice: o.id === 'bsd' && p.id === 'p1' ? 26000 : null, is86: o.id === 'sen' && p.id === 'p9', hidden: false }))),
    stockItems, recipes, movements, customers, ledger,
    orders, payments, refunds: [],
    approvals: [
      { id: 'ap1', type: 'refund', title: 'Refund #2033 · cold croissant', subjectId: null, amount: 620000, pct: 0, level: 'owner', status: 'waiting', requestedBy: 'rina', outletId: 'sen', note: 'Catering order, guest returned 18 croissants', at: now - 22 * 60e3 },
      { id: 'ap2', type: 'local_item', title: 'New local item · Kopi Tubruk Senayan · IDR 20,000', subjectId: 'p15', amount: 20000, pct: 0, level: 'owner', status: 'waiting', requestedBy: 'andi', outletId: 'sen', note: 'Propose for all outlets', at: now - 3 * 3600e3 },
      { id: 'ap3', type: 'discount', title: 'Discount 25% · Table 4 · birthday', subjectId: null, amount: 31000, pct: 25, level: 'manager', status: 'waiting', requestedBy: 'tono', outletId: 'sen', note: 'Regular guest birthday', at: now - 9 * 60e3 },
      { id: 'ap4', type: 'void', title: 'Void Matcha Latte · wrong order', subjectId: null, amount: 30000, pct: 0, level: 'pic', status: 'waiting', requestedBy: 'rina', outletId: 'sen', note: 'Guest asked hot, made iced', at: now - 2 * 60e3 },
      { id: 'ap5', type: 'po', title: 'PO-0149 · Kopi Nusantara Roastery', subjectId: null, amount: 1_820_000, pct: 0, level: 'owner', status: 'waiting', requestedBy: 'andi', outletId: 'kem', note: 'Beans running low', at: now - 5 * 3600e3 },
    ],
    sessions: [{ id: 'S-1042', outletId: 'sen', cashierId: 'tono', openedAt: t0 + 14 * 3600e3, openingFloat: 500000, closedAt: null, counted: null, variance: null, status: 'open', note: '' }],
    cashMoves: [{ id: 'cm1', sessionId: 'S-1042', outletId: 'sen', kind: 'out', amount: 45000, reason: 'Ice cubes', by: 'tono', at: now - 40 * 60e3, status: 'done' }],
    roster, clock: [],
    commissionRules: [
      { id: 'cr-cashier', name: 'Cashiers · 1% of net sales', employeeId: null, role: 'cashier', salesBps: 100, perItem: 0, productIds: [], categoryIds: [] },
      { id: 'cr-pastry', name: 'Pastry upsell · IDR 2,000 per pastry', employeeId: null, role: 'cashier', salesBps: 0, perItem: 2000, productIds: [], categoryIds: ['pastry'] },
      { id: 'cr-pic', name: 'Shift leads · 0.5% of net sales', employeeId: null, role: 'pic', salesBps: 50, perItem: 0, productIds: [], categoryIds: [] },
    ],
    suppliers: [
      { id: 'sup1', name: 'PT Susu Segar Lembang', phone: '0812 1111 2222', terms: '14 days', category: 'Dairy' }, { id: 'sup2', name: 'Kopi Nusantara Roastery', phone: '0813 3333 4444', terms: '30 days', category: 'Coffee' },
      { id: 'sup3', name: 'Bakery Supply ID', phone: '0857 5555 6666', terms: 'COD', category: 'Bakery' }, { id: 'sup4', name: 'Gula Aren Banten Co-op', phone: '0819 7777 8888', terms: '7 days', category: 'Syrup' },
      { id: 'sup5', name: 'Cup & Pack Jakarta', phone: '0811 9999 0000', terms: '30 days', category: 'Packaging' },
    ],
    pos: [
      { id: 'po148', no: 'PO-0148', supplierId: 'sup1', outletId: 'sen', lines: [{ stockItemId: 'milk', qty: 120, price: 22000, received: 0 }, { stockItemId: 'oat', qty: 40, price: 30000, received: 0 }], status: 'sent', due: t0 + 2 * DAY, createdBy: 'andi', at: t0 - DAY },
      { id: 'po147', no: 'PO-0147', supplierId: 'sup2', outletId: 'sen', lines: [{ stockItemId: 'beans', qty: 40, price: 260000, received: 40 }], status: 'received', due: t0 - 2 * DAY, createdBy: 'budi', at: t0 - 5 * DAY },
      { id: 'po146', no: 'PO-0146', supplierId: 'sup3', outletId: 'kem', lines: [{ stockItemId: 'croissant', qty: 200, price: 9000, received: 120 }], status: 'partial', due: t0 - DAY, createdBy: 'andi', at: t0 - 4 * DAY },
    ],
    opnames: [],
    promos: [
      { id: 'payday', name: 'Payday 20%', kind: 'pct', value: 20, minSpend: 100000, code: 'GAJIAN', quota: 500, used: 212 },
      { id: 'member15', name: 'New member IDR 15k', kind: 'amount', value: 15000, minSpend: 50000, code: 'HALO15', quota: 1000, used: 340 },
      { id: 'flash-aren', name: 'Flash sale · Es Kopi Susu Aren', kind: 'flash', value: 19000, productIds: ['p1'], endsAt: t0 + 17 * 3600e3 },
    ],
    reservations: [
      { id: 'rs1', outletId: 'sen', name: 'Pak Hendra', phone: '0813 5656 7878', at: t0 + 19 * 3600e3, guests: 6, table: 'T-05', status: 'booked', deposit: 200000 },
      { id: 'rs2', outletId: 'sen', name: 'Sinta', phone: '0812 7777 3131', at: t0 + 12 * 3600e3, guests: 2, table: 'T-12', status: 'seated', deposit: 0 },
    ],
    reviews: [
      { id: 'rv1', outletId: 'sen', customerId: 'c1', name: 'Dewi', stars: 5, text: 'Best aren latte in Senayan', at: now - 3 * 3600e3, reply: null, orderId: null },
      { id: 'rv2', outletId: 'kem', customerId: 'c2', name: 'Budi', stars: 4, text: 'Queue a bit long at lunch', at: now - 26 * 3600e3, reply: 'Thanks Budi, we added a second cashier at noon.', orderId: null },
      { id: 'rv3', outletId: 'sen', customerId: 'c6', name: 'Sinta', stars: 2, text: 'Croissant was cold', at: now - 5 * 3600e3, reply: null, orderId: null },
    ],
    messages: [
      { id: 'ms1', channel: 'wa', template: 'thanks_visit', to: '0812 3456 7890', status: 'read', at: now - 2 * 3600e3, customerId: 'c1' },
      { id: 'ms2', channel: 'wa', template: 'winback_30d', to: '0813 2222 1010', status: 'delivered', at: now - 26 * 3600e3, customerId: 'c2' },
      { id: 'ms3', channel: 'email', template: 'e_receipt', to: 'rina@mail.id', status: 'failed', at: now - 50 * 60e3, customerId: 'c3' },
    ],
    devices: [
      { id: 'd1', outletId: 'sen', kind: 'pos', name: 'Register 1', lastSeen: now, pairCode: null, status: 'online' }, { id: 'd2', outletId: 'sen', kind: 'kds', name: 'Kitchen & Bar', lastSeen: now, pairCode: null, status: 'online' },
      { id: 'd3', outletId: 'sen', kind: 'display', name: 'Customer display 1', lastSeen: now, pairCode: null, status: 'online' }, { id: 'd4', outletId: 'sen', kind: 'printer', name: 'Epson TM-m30 · 80mm', lastSeen: now - 9 * 60e3, pairCode: null, status: 'offline' },
      { id: 'd5', outletId: 'kem', kind: 'pos', name: 'Register 1', lastSeen: now, pairCode: null, status: 'online' }, { id: 'd6', outletId: 'sen', kind: 'kiosk', name: 'Kiosk 1', lastSeen: now, pairCode: null, status: 'online' },
      { id: 'd7', outletId: 'sen', kind: 'edc', name: 'BCA EDC · Terminal 01', lastSeen: now, pairCode: null, status: 'online' },
    ],
    integrations: [],
    audit: [], notices: [
      { id: 'n1', alert: 'Low stock', level: 'warn', to: ['pic', 'manager'], outletId: 'kem', text: 'Oat milk below par at Kemang', href: '/owner/inventory/low-stock-alerts-and-reorder-rules', at: now - 34 * 60e3, read: false },
      { id: 'n2', alert: 'Printer offline', level: 'warn', to: ['pic', 'cashier'], outletId: 'sen', text: 'Epson TM-m30 at Senayan offline for 9 min', href: '/owner/account/devices', at: now - 9 * 60e3, read: false },
    ],
    theme: { name: 'Kopi Biru', p: '#1F4FD8', acc: '#F2B544', ink: '#14213D', paper: '#F7F4EE', font: 'space', banner: 'g1', img: '', ...KOPI_BIRU_DESIGN },
    staffBrand: { accent: '#FF6A00', logo: '', workspace: 'Kopi Biru', density: 'comfy' },
    versions: [], perms: {}, records: demoRecords(now), settings: {}, counters: { order: 2049, po: 149 },
    device: { outletId: 'sen', online: true, queue: [], paired: {} },
  };
}

function history(products: Product[], outlets: DB['outlets'], t0: number, now: number) {
  const r = rng(42), orders: Order[] = [], payments: Payment[] = [];
  const weights = [9, 6, 5, 6, 4, 3, 4, 4, 3, 4, 3, 5, 3, 2];
  const pick = () => { let x = r() * weights.reduce((a, b) => a + b, 0); for (let i = 0; i < weights.length; i++) { x -= weights[i]; if (x < 0) return products[i]; } return products[0]; };
  const hourW = [0, 0, 0, 0, 0, 0, 0, 3, 6, 7, 5, 6, 9, 8, 5, 5, 6, 7, 6, 5, 4, 3, 1, 0];
  const sources: Source[] = ['pos', 'pos', 'pos', 'pos', 'pos', 'qr', 'qr', 'kiosk', 'gofood', 'grabfood', 'shopeefood', 'web'];
  const methods: Method[] = ['qris', 'qris', 'qris', 'cash', 'cash', 'card', 'ewallet'];
  const cashiers: Record<string, string[]> = { sen: ['rina', 'tono'], kem: ['wulan'], bsd: ['lia'] };
  let n = 1000;
  for (let d = 13; d >= 0; d--) {
    for (const o of outlets) {
      const base = (o.id === 'sen' ? 95 : o.id === 'kem' ? 72 : 48) * (1 + (d % 7 === 1 || d % 7 === 2 ? .25 : 0)) * (0.85 + r() * .3);
      for (let k = 0; k < base; k++) {
        let x = r() * hourW.reduce((a, b) => a + b, 0), h = 0; for (; h < 24; h++) { x -= hourW[h]; if (x < 0) break; }
        const at = t0 - d * DAY + h * 3600e3 + Math.floor(r() * 3600e3);
        if (at > now - 5 * 60e3) continue;
        const lines: OrderLine[] = Array.from({ length: 1 + Math.floor(r() * 3) }, (_, i) => { const p = pick(); return { id: 'l' + i, productId: p.id, name: p.name, qty: r() < .2 ? 2 : 1, unitPrice: p.basePrice, flashPrice: null, mods: [], note: '', discountPct: 0, station: p.categoryId === 'rice' ? 'kitchen' : p.categoryId === 'pastry' ? 'pastry' : 'bar', kds: 'done', fired: true }; });
        const source = sources[Math.floor(r() * sources.length)];
        const discountPct = r() < .08 ? 10 : 0;
        const t = orderTotals(lines, o, { pct: discountPct });
        const id = 'h' + (++n);
        const method = source === 'gofood' || source === 'grabfood' || source === 'shopeefood' ? 'ewallet' : methods[Math.floor(r() * methods.length)];
        orders.push({ id, no: '#' + n, outletId: o.id, sessionId: null, source, type: source === 'pos' ? (r() < .6 ? 'dine' : 'take') : source.endsWith('food') ? 'delivery' : 'dine', status: 'paid',
          table: null, customerId: r() < .3 ? 'c' + (1 + Math.floor(r() * 8)) : null, lines, discountPct, promoIds: [], guests: 1 + Math.floor(r() * 3),
          subtotal: t.subtotal, discount: t.orderDiscount, service: t.service, tax: t.tax, total: t.total, createdAt: at, paidAt: at + 6 * 60e3, cashierId: cashiers[o.id][Math.floor(r() * cashiers[o.id].length)], idemKey: id });
        payments.push({ id: 'hp' + n, orderId: id, outletId: o.id, method, amount: t.total, tip: r() < .1 ? 5000 : 0, status: 'settled', ref: 'GW' + n, at: at + 6 * 60e3, expiresAt: null, sessionId: null });
      }
    }
  }
  return { orders, payments };
}
