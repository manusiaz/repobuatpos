// Back-office data binding: authority object (spec/bn-authority.js) → live rows from the one store.
// A page's template (list/detail/form/report…) renders whatever view its object resolves to, so 200+ pages share ~60 views.
import type { DB, Rec, Role } from '../data/schema.ts';
import type { Page } from '../system/registry.ts';
import { level as stockLevel } from '../domain/stock.ts';
import { balance, tierOf } from '../domain/loyalty.ts';
import { priceAt } from '../data/actions.ts';

export type ColKind = 'text' | 'money' | 'status' | 'time' | 'date' | 'mono' | 'num' | 'pct' | 'scope';
export interface Col { k: string; l: string; f?: ColKind }
export type Row = { id: string; [k: string]: unknown };
export interface FieldDef { k: string; l: string; type?: 'text' | 'number' | 'money' | 'select' | 'textarea' | 'date'; options?: [string, string][]; req?: boolean; hint?: string }
export interface Ctx { db: DB; outletId: string; role: Role; page: Page; all: boolean }
export interface View {
  cols: Col[]; rows: (c: Ctx) => Row[];
  /** Status chip filter key */ status?: string;
  /** Present only for 'manual' data: create/edit form */ form?: FieldDef[];
  /** generic record storage key when there is no dedicated table */ rec?: string;
  title?: (r: Row) => string;
}

const outletName = (db: DB, id: string | null | undefined) => db.outlets.find(o => o.id === id)?.name ?? 'All outlets';
const empName = (db: DB, id: string | null | undefined) => db.employees.find(e => e.id === id)?.name ?? (id ?? '—');
const custName = (db: DB, id: string | null | undefined) => db.customers.find(c => c.id === id)?.name ?? '—';
const inScope = (c: Ctx, outletId: string | null | undefined) => c.all || !outletId || outletId === c.outletId;
const DAY = 864e5;

const ORDER_COLS: Col[] = [{ k: 'no', l: 'Order', f: 'mono' }, { k: 'outlet', l: 'Outlet' }, { k: 'channel', l: 'Channel' }, { k: 'status', l: 'Status', f: 'status' }, { k: 'at', l: 'Time', f: 'time' }, { k: 'total', l: 'Total', f: 'money' }];
const orderRows = (c: Ctx, f: (o: DB['orders'][0]) => boolean = () => true) => c.db.orders.filter(o => inScope(c, o.outletId) && f(o)).slice(-400).reverse()
  .map(o => ({ id: o.id, no: o.no, outlet: outletName(c.db, o.outletId), channel: o.source, status: o.status, at: o.createdAt, total: o.total, cashier: empName(c.db, o.cashierId), customer: custName(c.db, o.customerId), discount: o.discount, items: o.lines.reduce((a, l) => a + l.qty, 0) }));

/** Generic rows for objects that don't have a table yet. Columns follow the Back Office prototype vocabulary. */
export const GENERIC: Record<string, { heads: [string, string, string, string, string]; rows: string[][] }> = {
  expense: { heads: ['Expense', 'Outlet', 'Status', 'Date', 'Amount'], rows: [['Rent October', 'Senayan', 'Booked', '01 Oct', '45000000'], ['Electricity', 'Kemang', 'Booked', '05 Oct', '6200000'], ['Ice supply', 'Senayan', 'Pending', '09 Oct', '850000'], ['Pest control', 'BSD', 'Draft', '10 Oct', '1200000']] },
  budget: { heads: ['Line', 'Outlet', 'Status', 'Period', 'Amount'], rows: [['Sales target', 'Senayan', 'Approved', 'Oct 2026', '420000000'], ['Sales target', 'Kemang', 'Approved', 'Oct 2026', '310000000'], ['Marketing budget', 'All outlets', 'Pending', 'Q4 2026', '25000000']] },
  asset: { heads: ['Asset / request', 'Outlet', 'Status', 'Date', 'Value'], rows: [['La Marzocco Linea PB', 'Senayan', 'Active', 'Jan 2025', '185000000'], ['Mahlkönig E80 grinder', 'Kemang', 'Active', 'Mar 2025', '62000000'], ['Chiller repair', 'BSD', 'Pending', '08 Oct', '3400000'], ['6 tables + 24 chairs terrace', 'Senayan', 'Pending', '10 Oct', '18600000']] },
  reward: { heads: ['Reward', 'Outlet', 'Status', 'Updated', 'Beans'], rows: [['Free Americano', 'All outlets', 'Active', 'Sep', '250'], ['Croissant Almond', 'All outlets', 'Active', 'Sep', '320'], ['Tumbler Kopi Biru', 'All outlets', 'Active', 'Aug', '1200'], ['Birthday cake slice', 'All outlets', 'Draft', 'Oct', '0']] },
  broadcast: { heads: ['Broadcast', 'Outlet', 'Status', 'Scheduled', 'Audience'], rows: [['Payday promo 25 Oct', 'All outlets', 'Scheduled', '25 Oct 10:00', '1840'], ['New menu: Pandan Latte', 'All outlets', 'Sent', '02 Oct', '2210'], ['Kemang reopening', 'Kemang', 'Draft', '—', '640']] },
  transfer: { heads: ['Transfer', 'Outlet', 'Status', 'Date', 'Value'], rows: [['Oat milk 1L × 12 · Senayan → Kemang', 'Kemang', 'Sent', '10 Oct', '360000'], ['Croissant × 40 · BSD → Senayan', 'Senayan', 'Received', '08 Oct', '360000']] },
  batch: { heads: ['Batch', 'Outlet', 'Status', 'Expires', 'Qty'], rows: [['Fresh milk · LOT 2410-A', 'Senayan', 'OK', '14 Oct', '48'], ['Fresh milk · LOT 2409-C', 'Kemang', 'Expiring', '11 Oct', '6'], ['Croissant frozen · LOT 88', 'BSD', 'OK', '30 Nov', '120']] },
  leave: { heads: ['Request', 'Outlet', 'Status', 'Dates', 'Days'], rows: [['Rina · annual leave', 'Senayan', 'Waiting', '20–22 Oct', '3'], ['Tono · swap with Wulan', 'Senayan', 'Waiting', '15 Oct', '1'], ['Dimas · overtime', 'Senayan', 'Approved', '09 Oct', '0.5']] },
  service: { heads: ['Item', 'Outlet', 'Status', 'Updated', 'Number'], rows: [['Queue A', 'Senayan', 'Open', 'now', 'A-042'], ['Courier · Joko', 'Senayan', 'On delivery', '12 min', 'D-08'], ['Laundry #L-221', 'Kemang', 'Ready', '1 h', 'L-221']] },
  billing: { heads: ['Invoice', 'Outlet', 'Status', 'Date', 'Amount'], rows: [['BorNiz Pro · Oct 2026 · 3 outlets', 'All outlets', 'Paid', '01 Oct', '1047000'], ['WhatsApp credits top-up', 'All outlets', 'Paid', '03 Oct', '500000'], ['BorNiz Pro · Sep 2026', 'All outlets', 'Paid', '01 Sep', '1047000']] },
  busy: { heads: ['Pause / busy', 'Outlet', 'Status', 'When', 'Minutes'], rows: [['GoFood busy mode · lunch rush', 'Senayan', 'Ended', 'Today 12:10', '20'], ['GrabFood paused · gas leak check', 'Kemang', 'Ended', 'Yesterday', '45']] },
  catops: { heads: ['Item', 'Outlet', 'Status', 'Updated', 'Code'], rows: [] },
  incident: { heads: ['Incident', 'Outlet', 'Status', 'When', 'Value'], rows: [['Broken glass · bar', 'Senayan', 'Logged', 'Today 13:20', '45000'], ['Complaint · cold croissant · comp', 'Senayan', 'Comped', 'Today 11:05', '32000']] },
};
export const genericRows = (key: string): Rec[] => (GENERIC[key]?.rows ?? []).map((r, i) => ({ id: key + i, a: r[0], b: r[1], c: r[2], d: r[3], e: r[4], at: Date.now() - i * DAY }));
const generic = (key: string, kinds: [ColKind?, ColKind?, ColKind?, ColKind?, ColKind?] = []): View => {
  const h = GENERIC[key].heads;
  return { rec: key, status: 'c', cols: h.map((l, i) => ({ k: 'abcde'[i], l, f: kinds[i] ?? (i === 2 ? 'status' : i === 4 && /amount|value/i.test(l) ? 'money' : 'text') })),
    rows: c => (c.db.records[key] ?? genericRows(key)).filter(r => c.all || r.b === 'All outlets' || r.b === outletName(c.db, c.outletId)).map(r => ({ ...r, e: /amount|value/i.test(h[4]) ? Number(r.e) : r.e })),
    form: h.map((l, i) => ({ k: 'abcde'[i], l, type: i === 4 && /amount|value/i.test(l) ? 'money' as const : 'text' as const, req: i === 0 })) };
};

export const VIEWS: Record<string, View> = {
  order: { cols: ORDER_COLS, status: 'status', rows: c => orderRows(c, o => /open bills/i.test(c.page.name) ? ['open', 'held', 'sent', 'preparing', 'ready', 'served'].includes(o.status) : o.status !== 'open') },
  online: { cols: ORDER_COLS, status: 'status', rows: c => orderRows(c, o => ['gofood', 'grabfood', 'shopeefood', 'web', 'qr'].includes(o.source)) },
  readyby: { cols: [...ORDER_COLS.slice(0, 4), { k: 'readyBy', l: 'Ready by', f: 'time' }, { k: 'tier', l: 'Tier' }], rows: c => c.db.orders.filter(o => o.readyBy && inScope(c, o.outletId)).map(o => ({ id: o.id, no: o.no, outlet: outletName(c.db, o.outletId), channel: o.source, status: o.status, readyBy: o.readyBy, tier: o.tier })) },
  scheduled: { cols: ORDER_COLS, rows: c => orderRows(c, o => !!o.readyBy && o.status === 'open') },
  pickup: { cols: ORDER_COLS, rows: c => orderRows(c, o => o.type === 'delivery' && o.status === 'ready') },
  payment: { cols: [{ k: 'ref', l: 'Reference', f: 'mono' }, { k: 'outlet', l: 'Outlet' }, { k: 'method', l: 'Method' }, { k: 'status', l: 'Status', f: 'status' }, { k: 'at', l: 'Time', f: 'time' }, { k: 'amount', l: 'Amount', f: 'money' }], status: 'status',
    rows: c => c.db.payments.filter(p => inScope(c, p.outletId) && (!/pending|manual/i.test(c.page.name) || p.status === 'pending')).slice(-400).reverse().map(p => ({ id: p.id, ref: p.ref, outlet: outletName(c.db, p.outletId), method: p.method, status: p.status, at: p.at, amount: p.amount, tip: p.tip })) },
  tips: { cols: [{ k: 'ref', l: 'Payment', f: 'mono' }, { k: 'outlet', l: 'Outlet' }, { k: 'method', l: 'Method' }, { k: 'at', l: 'Time', f: 'time' }, { k: 'tip', l: 'Tip', f: 'money' }],
    rows: c => c.db.payments.filter(p => p.tip > 0 && inScope(c, p.outletId)).slice(-300).reverse().map(p => ({ id: p.id, ref: p.ref, outlet: outletName(c.db, p.outletId), method: p.method, at: p.at, tip: p.tip })) },
  void: { cols: [{ k: 'title', l: 'Void' }, { k: 'outlet', l: 'Outlet' }, { k: 'who', l: 'Requested by' }, { k: 'status', l: 'Status', f: 'status' }, { k: 'at', l: 'Time', f: 'time' }, { k: 'amount', l: 'Amount', f: 'money' }], status: 'status',
    rows: c => approvalRows(c, ['void']) },
  refund: { cols: [{ k: 'title', l: 'Refund' }, { k: 'outlet', l: 'Outlet' }, { k: 'who', l: 'Requested by' }, { k: 'status', l: 'Status', f: 'status' }, { k: 'at', l: 'Time', f: 'time' }, { k: 'amount', l: 'Amount', f: 'money' }], status: 'status',
    rows: c => [...approvalRows(c, ['refund']).filter(r => !/over idr 500k/i.test(c.page.name) || (r.amount as number) > 500000), ...c.db.refunds.filter(r => !c.db.approvals.some(a => a.id === r.approvalId)).map(r => ({ id: r.id, title: 'Refund · ' + (c.db.orders.find(o => o.id === r.orderId)?.no ?? ''), outlet: outletName(c.db, c.db.orders.find(o => o.id === r.orderId)?.outletId), who: '—', status: 'refunded', at: r.at, amount: r.amount }))] },
  discount: { cols: [{ k: 'no', l: 'Order', f: 'mono' }, { k: 'outlet', l: 'Outlet' }, { k: 'cashier', l: 'Cashier' }, { k: 'pct', l: 'Discount %', f: 'pct' }, { k: 'at', l: 'Time', f: 'time' }, { k: 'discount', l: 'Amount', f: 'money' }],
    rows: c => c.db.orders.filter(o => o.discount > 0 && inScope(c, o.outletId)).slice(-300).reverse().map(o => ({ id: o.id, no: o.no, outlet: outletName(c.db, o.outletId), cashier: empName(c.db, o.cashierId), pct: o.discountPct, at: o.createdAt, discount: o.discount })) },
  cashmove: { cols: [{ k: 'reason', l: 'Reason' }, { k: 'outlet', l: 'Outlet' }, { k: 'kind', l: 'Type' }, { k: 'by', l: 'By' }, { k: 'status', l: 'Status', f: 'status' }, { k: 'at', l: 'Time', f: 'time' }, { k: 'amount', l: 'Amount', f: 'money' }],
    rows: c => c.db.cashMoves.filter(m => inScope(c, m.outletId)).map(m => ({ id: m.id, reason: m.reason, outlet: outletName(c.db, m.outletId), kind: m.kind === 'in' ? 'Cash in' : m.kind === 'out' ? 'Cash out' : 'Drop to safe', by: empName(c.db, m.by), status: m.status, at: m.at, amount: m.amount })) },
  drawer: { cols: [{ k: 'sid', l: 'Session', f: 'mono' }, { k: 'outlet', l: 'Outlet' }, { k: 'cashier', l: 'Cashier' }, { k: 'status', l: 'Status', f: 'status' }, { k: 'opened', l: 'Opened', f: 'time' }, { k: 'float', l: 'Float', f: 'money' }, { k: 'variance', l: 'Variance', f: 'money' }],
    rows: c => c.db.sessions.filter(s => inScope(c, s.outletId)).map(s => ({ id: s.id, sid: s.id, outlet: outletName(c.db, s.outletId), cashier: empName(c.db, s.cashierId), status: s.status, opened: s.openedAt, float: s.openingFloat, variance: s.variance ?? 0 })) },
  payable: { cols: [{ k: 'no', l: 'PO', f: 'mono' }, { k: 'supplier', l: 'Supplier' }, { k: 'outlet', l: 'Outlet' }, { k: 'status', l: 'Status', f: 'status' }, { k: 'due', l: 'Due', f: 'date' }, { k: 'amount', l: 'Amount', f: 'money' }],
    rows: c => c.db.pos.filter(p => ['received', 'partial'].includes(p.status) && inScope(c, p.outletId)).map(p => ({ id: p.id, no: p.no, supplier: c.db.suppliers.find(s => s.id === p.supplierId)?.name, outlet: outletName(c.db, p.outletId), status: p.due < Date.now() ? 'overdue' : 'open', due: p.due, amount: p.lines.reduce((a, l) => a + l.received * l.price, 0) })) },
  kasbon: { cols: [{ k: 'name', l: 'Customer' }, { k: 'phone', l: 'Phone', f: 'mono' }, { k: 'credit', l: 'Owes', f: 'money' }], rows: c => c.db.customers.filter(x => x.credit > 0).map(x => ({ id: x.id, name: x.name, phone: x.phone, credit: x.credit })) },
  deposit: { cols: [{ k: 'name', l: 'Customer' }, { k: 'phone', l: 'Phone', f: 'mono' }, { k: 'deposit', l: 'Balance', f: 'money' }], rows: c => c.db.customers.filter(x => x.deposit > 0).map(x => ({ id: x.id, name: x.name, phone: x.phone, deposit: x.deposit })) },
  product: { cols: [{ k: 'name', l: 'Product' }, { k: 'sku', l: 'SKU', f: 'mono' }, { k: 'category', l: 'Category' }, { k: 'scope', l: 'Scope', f: 'scope' }, { k: 'status', l: 'Status', f: 'status' }, { k: 'price', l: 'Price', f: 'money' }], status: 'status',
    rows: c => c.db.products.filter(p => p.scope === 'global' || inScope(c, p.ownerOutletId)).map(p => ({ id: p.id, name: p.name, sku: p.sku, category: c.db.categories.find(x => x.id === p.categoryId)?.name, scope: p.scope === 'global' ? 'All outlets' : outletName(c.db, p.ownerOutletId) + ' only', status: p.status, price: c.all ? p.basePrice : priceAt(c.db, p, c.outletId), cost: p.cost })),
    form: [{ k: 'name', l: 'Product name', req: true }, { k: 'categoryId', l: 'Category', type: 'select', options: [['coffee', 'Coffee'], ['noncoffee', 'Non-coffee'], ['pastry', 'Pastry'], ['rice', 'Rice'], ['other', 'Others']] }, { k: 'basePrice', l: 'Price', type: 'money', req: true }, { k: 'cost', l: 'Cost (COGS)', type: 'money' }, { k: 'sku', l: 'SKU' }, { k: 'desc', l: 'Description', type: 'textarea' }] },
  local: { cols: [{ k: 'name', l: 'Item' }, { k: 'scope', l: 'Outlet', f: 'scope' }, { k: 'status', l: 'Status', f: 'status' }, { k: 'price', l: 'Price', f: 'money' }],
    rows: c => c.db.products.filter(p => p.scope === 'local' && inScope(c, p.ownerOutletId)).map(p => ({ id: p.id, name: p.name, scope: outletName(c.db, p.ownerOutletId) + ' only', status: p.status, price: p.basePrice })) },
  price: { cols: [{ k: 'name', l: 'Product' }, { k: 'outlet', l: 'Outlet' }, { k: 'base', l: 'Base price', f: 'money' }, { k: 'price', l: 'Outlet price', f: 'money' }, { k: 'delta', l: 'vs base', f: 'pct' }],
    rows: c => c.db.outletProducts.filter(x => inScope(c, x.outletId)).map(x => { const p = c.db.products.find(y => y.id === x.productId)!; const pr = x.localPrice ?? p.basePrice; return { id: x.productId + x.outletId, pid: p.id, name: p.name, outlet: outletName(c.db, x.outletId), base: p.basePrice, price: pr, delta: Math.round(((pr - p.basePrice) / p.basePrice) * 1000) / 10 }; }) },
  recipe: { cols: [{ k: 'name', l: 'Product' }, { k: 'lines', l: 'Ingredients' }, { k: 'cost', l: 'Recipe cost', f: 'money' }, { k: 'price', l: 'Price', f: 'money' }, { k: 'cogs', l: 'COGS %', f: 'pct' }],
    rows: c => c.db.products.map(p => { const ls = c.db.recipes.filter(r => r.productId === p.id); const cost = Math.round(ls.reduce((a, r) => a + r.qty * (c.db.stockItems.find(s => s.id === r.stockItemId)?.unitCost ?? 0), 0)); return { id: p.id, name: p.name, lines: ls.map(r => c.db.stockItems.find(s => s.id === r.stockItemId)?.name).join(', ') || 'No recipe yet', cost, price: p.basePrice, cogs: Math.round((cost / p.basePrice) * 1000) / 10 }; }) },
  sold86: { cols: [{ k: 'name', l: 'Product' }, { k: 'outlet', l: 'Outlet' }, { k: 'status', l: 'Status', f: 'status' }],
    rows: c => c.db.outletProducts.filter(x => inScope(c, x.outletId) && (x.is86 || !/list/i.test(c.page.name))).map(x => ({ id: x.productId + '|' + x.outletId, pid: x.productId, oid: x.outletId, name: c.db.products.find(p => p.id === x.productId)?.name, outlet: outletName(c.db, x.outletId), status: x.is86 ? 'Sold out' : 'Available' })) },
  promo: { cols: [{ k: 'name', l: 'Promo' }, { k: 'code', l: 'Code', f: 'mono' }, { k: 'kind', l: 'Type' }, { k: 'status', l: 'Status', f: 'status' }, { k: 'used', l: 'Used', f: 'num' }],
    rows: c => c.db.promos.map(p => ({ id: p.id, name: p.name, code: p.code ?? '—', kind: p.kind === 'pct' ? p.value + '%' : p.kind === 'amount' ? 'IDR ' + p.value.toLocaleString('en-US') + ' off' : 'Flash price', status: p.endsAt && p.endsAt < Date.now() ? 'ended' : 'live', used: p.used ?? 0 })) },
  stock: { cols: [{ k: 'name', l: 'Item' }, { k: 'outlet', l: 'Outlet' }, { k: 'status', l: 'Status', f: 'status' }, { k: 'qty', l: 'On hand', f: 'num' }, { k: 'par', l: 'Par', f: 'num' }, { k: 'value', l: 'Value', f: 'money' }], status: 'status',
    rows: c => c.db.outlets.filter(o => inScope(c, o.id)).flatMap(o => c.db.stockItems.map(s => { const q = Math.round(stockLevel(c.db.movements, o.id, s.id) * 100) / 100; return { id: o.id + s.id, name: s.name + ' (' + s.unit + ')', outlet: o.name, status: q < s.par ? 'low' : 'ok', qty: q, par: s.par, value: Math.round(q * s.unitCost) }; }))
      .filter(r => !/low-stock|reorder/i.test(c.page.name) || r.status === 'low') },
  movement: { cols: [{ k: 'item', l: 'Item' }, { k: 'outlet', l: 'Outlet' }, { k: 'type', l: 'Type' }, { k: 'by', l: 'By' }, { k: 'at', l: 'Time', f: 'time' }, { k: 'qty', l: 'Qty', f: 'num' }],
    rows: c => c.db.movements.filter(m => inScope(c, m.outletId) && (!/waste/i.test(c.page.name) || m.type === 'waste')).slice(-300).reverse().map((m, i) => ({ id: 'm' + i, item: c.db.stockItems.find(s => s.id === m.stockItemId)?.name, outlet: outletName(c.db, m.outletId), type: m.type.replace(/_/g, ' '), by: empName(c.db, m.by), at: m.at, qty: Math.round(m.qty * 1000) / 1000 })) },
  adjust: { cols: [{ k: 'title', l: 'Adjustment' }, { k: 'outlet', l: 'Outlet' }, { k: 'who', l: 'Requested by' }, { k: 'status', l: 'Status', f: 'status' }, { k: 'at', l: 'Time', f: 'time' }, { k: 'amount', l: 'Value', f: 'money' }], status: 'status', rows: c => approvalRows(c, ['waste', 'adjust']) },
  opname: { cols: [{ k: 'area', l: 'Area' }, { k: 'outlet', l: 'Outlet' }, { k: 'counter', l: 'Counted by' }, { k: 'status', l: 'Status', f: 'status' }, { k: 'at', l: 'Started', f: 'time' }, { k: 'lines', l: 'Lines', f: 'num' }],
    rows: c => c.db.opnames.filter(o => inScope(c, o.outletId)).map(o => ({ id: o.id, area: o.area, outlet: outletName(c.db, o.outletId), counter: empName(c.db, o.countedBy), status: o.status, at: o.at, lines: o.lines.length })) },
  po: { cols: [{ k: 'no', l: 'PO', f: 'mono' }, { k: 'supplier', l: 'Supplier' }, { k: 'outlet', l: 'Outlet' }, { k: 'status', l: 'Status', f: 'status' }, { k: 'due', l: 'Due', f: 'date' }, { k: 'amount', l: 'Amount', f: 'money' }], status: 'status',
    rows: c => c.db.pos.filter(p => inScope(c, p.outletId) && (!/receive|receipt/i.test(c.page.name) || ['sent', 'partial', 'received'].includes(p.status))).map(p => ({ id: p.id, no: p.no, supplier: c.db.suppliers.find(s => s.id === p.supplierId)?.name, outlet: outletName(c.db, p.outletId), status: p.status, due: p.due, amount: p.lines.reduce((a, l) => a + l.qty * l.price, 0) })) },
  supplier: { cols: [{ k: 'name', l: 'Supplier' }, { k: 'category', l: 'Category' }, { k: 'phone', l: 'Phone', f: 'mono' }, { k: 'terms', l: 'Terms' }, { k: 'open', l: 'Open POs', f: 'num' }],
    rows: c => c.db.suppliers.map(s => ({ ...s, open: c.db.pos.filter(p => p.supplierId === s.id && !['received', 'cancelled'].includes(p.status)).length })),
    form: [{ k: 'name', l: 'Supplier name', req: true }, { k: 'category', l: 'Category' }, { k: 'phone', l: 'WhatsApp number' }, { k: 'terms', l: 'Payment terms', type: 'select', options: [['COD', 'COD'], ['7 days', '7 days'], ['14 days', '14 days'], ['30 days', '30 days']] }] },
  customer: { cols: [{ k: 'name', l: 'Customer' }, { k: 'phone', l: 'Phone', f: 'mono' }, { k: 'tier', l: 'Tier', f: 'status' }, { k: 'beans', l: 'Beans', f: 'num' }, { k: 'visits', l: 'Visits', f: 'num' }, { k: 'spend', l: 'Spend', f: 'money' }], status: 'tier',
    rows: c => c.db.customers.map(x => { const os = c.db.orders.filter(o => o.customerId === x.id && o.status === 'paid'); return { id: x.id, name: x.name, phone: x.phone, tier: tierOf(c.db.ledger, x.id).name, beans: balance(c.db.ledger, x.id), visits: os.length, spend: os.reduce((a, o) => a + o.total, 0), optIn: x.optIn }; }),
    form: [{ k: 'name', l: 'Full name', req: true }, { k: 'phone', l: 'WhatsApp number', req: true }, { k: 'email', l: 'Email' }] },
  points: { cols: [{ k: 'customer', l: 'Customer' }, { k: 'reason', l: 'Reason' }, { k: 'at', l: 'Time', f: 'time' }, { k: 'points', l: 'Beans', f: 'num' }],
    rows: c => c.db.ledger.slice(-300).reverse().map((l, i) => ({ id: 'lg' + i, customer: custName(c.db, l.customerId), reason: l.reason, at: l.at, points: l.points })) },
  review: { cols: [{ k: 'name', l: 'Guest' }, { k: 'outlet', l: 'Outlet' }, { k: 'stars', l: 'Rating' }, { k: 'text', l: 'Review' }, { k: 'status', l: 'Status', f: 'status' }, { k: 'at', l: 'Time', f: 'time' }], status: 'status',
    rows: c => c.db.reviews.filter(r => inScope(c, r.outletId)).map(r => ({ id: r.id, name: r.name, outlet: outletName(c.db, r.outletId), stars: '★'.repeat(r.stars) + '☆'.repeat(5 - r.stars), text: r.text, status: r.reply ? 'replied' : 'new', at: r.at, reply: r.reply })) },
  messaging: { cols: [{ k: 'template', l: 'Message', f: 'mono' }, { k: 'channel', l: 'Channel' }, { k: 'to', l: 'To', f: 'mono' }, { k: 'status', l: 'Status', f: 'status' }, { k: 'at', l: 'Time', f: 'time' }], status: 'status',
    rows: c => c.db.messages.map(m => ({ id: m.id, template: m.template, channel: m.channel.toUpperCase(), to: m.to, status: m.status, at: m.at })) },
  reservation: { cols: [{ k: 'name', l: 'Guest' }, { k: 'outlet', l: 'Outlet' }, { k: 'table', l: 'Table', f: 'mono' }, { k: 'guests', l: 'Guests', f: 'num' }, { k: 'status', l: 'Status', f: 'status' }, { k: 'at', l: 'Time', f: 'time' }, { k: 'deposit', l: 'Deposit', f: 'money' }], status: 'status',
    rows: c => c.db.reservations.filter(r => inScope(c, r.outletId)).map(r => ({ ...r, outlet: outletName(c.db, r.outletId) })),
    form: [{ k: 'name', l: 'Guest name', req: true }, { k: 'phone', l: 'WhatsApp number' }, { k: 'guests', l: 'Guests', type: 'number' }, { k: 'table', l: 'Table' }, { k: 'deposit', l: 'Deposit', type: 'money' }] },
  employee: { cols: [{ k: 'name', l: 'Person' }, { k: 'role', l: 'Role' }, { k: 'outlets', l: 'Outlets' }, { k: 'phone', l: 'Phone', f: 'mono' }, { k: 'status', l: 'Status', f: 'status' }], status: 'role',
    rows: c => c.db.employees.filter(e => c.all || e.outlets.includes(c.outletId)).map(e => ({ id: e.id, name: e.name, role: e.role, outlets: e.outlets.map(o => outletName(c.db, o)).join(', '), phone: e.phone, status: e.active ? 'active' : 'archived' })),
    form: [{ k: 'name', l: 'Name', req: true }, { k: 'phone', l: 'WhatsApp number', req: true }, { k: 'role', l: 'Role', type: 'select', options: [['cashier', 'Cashier'], ['kitchen', 'Kitchen'], ['waiter', 'Waiter'], ['pic', 'Shift lead (PIC)'], ['manager', 'Manager (owner OK)']] }] },
  roster: { cols: [{ k: 'day', l: 'Day' }, { k: 'outlet', l: 'Outlet' }, { k: 'pagi', l: 'Morning PIC' }, { k: 'siang', l: 'Afternoon PIC' }, { k: 'malam', l: 'Close PIC' }],
    rows: c => c.db.roster.filter(r => inScope(c, r.outletId)).map(r => ({ id: r.outletId + r.day, day: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][r.day], outlet: outletName(c.db, r.outletId), pagi: empName(c.db, r.slots.pagi.pic), siang: empName(c.db, r.slots.siang.pic), malam: empName(c.db, r.slots.malam.pic) })) },
  attendance: { cols: [{ k: 'who', l: 'Person' }, { k: 'outlet', l: 'Outlet' }, { k: 'kind', l: 'Event' }, { k: 'at', l: 'Time', f: 'time' }],
    rows: c => c.db.clock.filter(k => inScope(c, k.outletId)).slice().reverse().map(k => ({ id: k.id, who: empName(c.db, k.employeeId), outlet: outletName(c.db, k.outletId), kind: k.kind === 'in' ? 'Clock in' : k.kind === 'out' ? 'Clock out' : 'Break', at: k.at })) },
  payroll: { cols: [{ k: 'name', l: 'Person' }, { k: 'role', l: 'Role' }, { k: 'base', l: 'Base', f: 'money' }, { k: 'commission', l: 'Commission 1%', f: 'money' }, { k: 'total', l: 'Total', f: 'money' }],
    rows: c => c.db.employees.filter(e => e.wage > 0).map(e => { const sales = c.db.orders.filter(o => o.cashierId === e.id && o.status === 'paid' && o.createdAt > Date.now() - 30 * DAY).reduce((a, o) => a + o.total, 0); const commission = Math.round(sales / 100); return { id: e.id, name: e.name, role: e.role, base: e.wage, commission, total: e.wage + commission }; }) },
  outlet: { cols: [{ k: 'name', l: 'Outlet' }, { k: 'city', l: 'City' }, { k: 'hours', l: 'Hours' }, { k: 'tax', l: 'Tax' }, { k: 'devices', l: 'Devices online' }, { k: 'status', l: 'Status', f: 'status' }],
    rows: c => c.db.outlets.map(o => ({ id: o.id, name: o.name, city: o.city, hours: o.opens + '–' + o.closes, tax: (o.taxBps / 100) + '%' + (o.serviceBps ? ' + ' + o.serviceBps / 100 + '% svc' : '') + (o.taxInclusive ? ' incl.' : ''), devices: c.db.devices.filter(d => d.outletId === o.id && d.status === 'online').length + '/' + c.db.devices.filter(d => d.outletId === o.id).length, status: o.online ? 'online' : 'offline' })) },
  device: { cols: [{ k: 'name', l: 'Device' }, { k: 'outlet', l: 'Outlet' }, { k: 'kind', l: 'Type' }, { k: 'status', l: 'Status', f: 'status' }, { k: 'seen', l: 'Last seen', f: 'time' }],
    rows: c => c.db.devices.filter(d => inScope(c, d.outletId)).map(d => ({ id: d.id, name: d.name, outlet: outletName(c.db, d.outletId), kind: d.kind.toUpperCase(), status: d.status, seen: d.lastSeen })) },
  audit: { cols: [{ k: 'action', l: 'Action', f: 'mono' }, { k: 'actor', l: 'Who' }, { k: 'subject', l: 'Subject' }, { k: 'at', l: 'Time', f: 'time' }], rows: c => c.db.audit.map(a => ({ id: a.id, action: a.action, actor: empName(c.db, a.actor), subject: a.subject, at: a.at })) },
  notif: { cols: [{ k: 'alert', l: 'Alert' }, { k: 'text', l: 'Detail' }, { k: 'level', l: 'Urgency', f: 'status' }, { k: 'at', l: 'Time', f: 'time' }], rows: c => c.db.notices.map(n => ({ id: n.id, alert: n.alert, text: n.text, level: n.level === 'high' ? 'failed' : n.level === 'warn' ? 'pending' : 'open', at: n.at })) },
  design: { cols: [{ k: 'kind', l: 'What' }, { k: 'by', l: 'By' }, { k: 'note', l: 'Note' }, { k: 'status', l: 'Status', f: 'status' }, { k: 'at', l: 'Time', f: 'time' }], rows: c => c.db.versions.map(v => ({ id: v.id, kind: v.kind, by: empName(c.db, v.by), note: v.note, status: v.status, at: v.at })) },
  approvals: { cols: [{ k: 'title', l: 'Request' }, { k: 'outlet', l: 'Outlet' }, { k: 'who', l: 'Requested by' }, { k: 'level', l: 'Decides' }, { k: 'status', l: 'Status', f: 'status' }, { k: 'at', l: 'Time', f: 'time' }, { k: 'amount', l: 'Amount', f: 'money' }], status: 'status', rows: c => approvalRows(c) },
  expense: generic('expense'), budget: generic('budget'), asset: generic('asset'), reward: generic('reward', ['text', 'text', 'status', 'text', 'num']), broadcast: generic('broadcast', ['text', 'text', 'status', 'text', 'num']),
  transfer: generic('transfer'), batch: generic('batch'), leave: generic('leave', ['text', 'text', 'status', 'text', 'num']), service: generic('service', ['text', 'text', 'status', 'text', 'mono']),
  billing: generic('billing'), busy: generic('busy', ['text', 'text', 'status', 'text', 'num']), incident: generic('incident'),
  catops: { cols: [{ k: 'name', l: 'Product' }, { k: 'sku', l: 'SKU / barcode', f: 'mono' }, { k: 'unit', l: 'Unit' }, { k: 'price', l: 'Price', f: 'money' }], rows: c => c.db.products.map(p => ({ id: p.id, name: p.name, sku: p.sku + ' · 899' + p.sku.replace(/\D/g, '').padStart(10, '0'), unit: 'pcs', price: p.basePrice })) },
};
/** The page decides which view: its authority object, refined by page name where one object spans several tables. */
export function viewFor(page: Page): { key: string; view: View } {
  const n = page.name.toLowerCase();
  const pick = (k: string) => ({ key: k, view: VIEWS[k] });
  if (page.mode === 'approve' && !/opname/.test(n)) return pick('approvals');
  if (/(stock movement|stock card|kartu stok|inventory movement|waste \/ damaged|ingredient usage)/.test(n)) return pick('movement');
  if (/(device|printer|edc|register)/.test(n) && !/designer|receipt/.test(n)) return pick('device');
  if (/(incident)/.test(n)) return pick('incident');
  if (/(sent-to-owner|waiting for owner|publish request|price change request|approval status)/.test(n)) return pick('approvals');
  if (/(employee|cashier performance|invite|pin & access)/.test(n)) return pick('employee');
  if (/(barcode|label|serial|imei|unit conversion)/.test(n)) return pick('catops');
  const k = page.object && VIEWS[page.object] ? page.object : n.includes('supplier') ? 'supplier' : n.includes('customer') ? 'customer' : n.includes('stock') ? 'stock' : 'order';
  return pick(k);
}

/** Approval queue rows. Types narrow by page wording; the ladder (level) is computed by the engine. */
export function approvalRows(c: Ctx, types?: string[]): Row[] {
  const n = c.page.name.toLowerCase();
  const t = types ?? (/(void, refund, discount)/.test(n) ? ['void', 'refund', 'discount'] : /timesheet/.test(n) ? ['timesheet'] : /(leave|swap|overtime)/.test(n) ? ['leave'] : /stock request/.test(n) ? ['transfer'] : /(theme|publish|studio)/.test(n) ? ['publish'] : /price change/.test(n) ? ['price'] : /payroll/.test(n) ? ['payroll'] : /refunds over/.test(n) ? ['refund'] : /purchase suggestion/.test(n) ? ['po'] : null);
  return c.db.approvals.filter(a => (!t || t.includes(a.type)) && inScope(c, a.outletId) && (!/refunds over/.test(n) || a.amount > 500000) && (!/sent-to-owner|waiting for owner/.test(n) || a.level === 'owner'))
    .map(a => ({ id: a.id, title: a.title, outlet: outletName(c.db, a.outletId), who: empName(c.db, a.requestedBy), level: a.level, status: a.status, at: a.at, amount: a.amount, requestedBy: a.requestedBy, note: a.note }));
}
