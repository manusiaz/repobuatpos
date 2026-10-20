// The app's own stock and drawer actions against the server's rules (migrations stock_rules, cash_rules): what the PIC,
// cashier and manager screens send (src/data/actions.ts, actions/pic.ts) goes through bn_write with their PIN sessions
// on a shared register, exactly as a device writes it. Opname, waste and a purchase order each move stock once; cash
// outs, a drawer short beyond the PIC's limit and a PIC count with a recount close the way the screens promise.
import assert from 'node:assert/strict';
import pg from 'pg';

const URL = process.env.BN_TEST_URL || 'postgres://postgres@localhost:5433';
const { seed } = await import('../../src/data/seed.ts');
const { allOps, diff, wire } = await import('../../src/data/remoteDocs.ts');
const { onServerDB } = await import('../../src/data/store.ts');
const A = await import('../../src/data/actions.ts');
const P = await import('../../src/data/actions/pic.ts');
const { expectedCash } = await import('../../src/domain/shift.ts');
const POS = await import('../../src/data/actions/pos.ts');
const { balance } = await import('../../src/domain/loyalty.ts');
const { roundCash } = await import('../../src/domain/money.ts');
const db = new pg.Client({ connectionString: URL + '/bn_test' });
await db.connect();
const as = async (uid, sql, args = []) => {
  await db.query('begin');
  try {
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [uid]); await db.query('set local role authenticated');
    const r = (await db.query(sql, args)).rows[0]?.r; await db.query('commit'); return r;
  } catch (e) { await db.query('rollback'); throw e; }
};
const [owner, tablet] = (await db.query("insert into auth.users (email) values ('aksi@kopi.id'), (null) returning id")).rows.map(r => r.id);
const T = await as(owner, "select public.bn_bootstrap('Kopi Aksi', 'kopi-aksi', 'budi') r");
let d = seed();
await as(owner, 'select public.bn_import($1, $2) r', [T, JSON.stringify(wire(allOps(d)))]);
for (const e of ['budi', 'andi', 'maya', 'sari', 'rina']) await as(owner, "select public.bn_set_pins($1, $2, '1234', '246810') r", [T, e]);
await as(tablet, 'select public.bn_device_join($1) r', [await as(owner, 'select public.bn_device_code($1) r', [T])]);
const token = {};
for (const e of ['andi', 'maya', 'sari', 'rina']) token[e] = (await as(tablet, "select public.bn_staff_login($1, $2, '1234') r", [T, e])).token;

/** One action: the ops its commit makes, written under the staff member's PIN session on the register (the owner from
 *  their own account). */
let n = 0;
async function act(who, fn) {
  let out;
  const next = await onServerDB(structuredClone(d), () => { out = fn(); });
  const ops = wire(diff(d, next));
  if (ops.length) await as(who === 'budi' ? owner : tablet, 'select public.bn_write($1, $2, $3, $4, null, null, $5, $6) r', [T, JSON.stringify(ops), 'test', who, 'op-' + n++, token[who] ?? null]);
  d = next;
  return out;
}
const pin = who => as(who === 'budi' ? owner : tablet, "select public.bn_check_approval_pin($1, $2, '246810') r", [T, who]);
const stock = async item => Number((await db.query("select coalesce(sum((data->>'qty')::numeric), 0) s from public.docs where tenant_id = $1 and coll = 'movements' and data->>'outletId' = 'sen' and data->>'stockItemId' = $2", [T, item])).rows[0].s);

// opname: Maya counts the bar blind, one difference with its photo, submits; Sari (another PIC) signs with her PIN
const milk0 = await stock('milk');
const op = await act('maya', () => A.startOpname('sen', 'Bar', 'maya'));
const line = d.opnames.find(o => o.id === op).lines.find(l => l.stockItemId === 'milk');
await act('maya', () => A.updateOpnameLine(op, 'milk', { counted: line.systemQty - 1 }, 'maya'));
await act('maya', () => P.opnamePhoto(op, 'milk', 'data:image/jpeg;base64,AA', 'maya'));
const ap = await act('maya', () => P.submitCount(op, 'maya'));
assert.equal(ap.level, 'pic', 'one litre of milk: a PIC signs');
await pin('sari');
assert.equal(await act('sari', () => A.decide(ap.id, 'sari', 'approved')), null);
assert.equal(await stock('milk'), Math.round((milk0 - 1) * 1000) / 1000, 'stock is the counted quantity');

// waste: Rina drops beans, Maya signs; once
const beans0 = await stock('beans');
const w = await act('rina', () => A.stockEntry('waste', 'sen', 'beans', 0.1, 'jatuh', 'rina'));
await pin('maya');
assert.equal(await act('maya', () => A.decide(w.id, 'maya', 'approved')), null);
assert.equal(await stock('beans'), Math.round((beans0 - 0.1) * 1000) / 1000);

// purchase order: Andi orders, the owner approves with his PIN, Andi receives the goods
const poId = await act('andi', () => A.createPO('sup1', 'sen', [{ stockItemId: 'beans', qty: 2, price: 260000 }], 'andi'));
const req = d.approvals.find(a => a.type === 'po' && a.subjectId === poId);
await pin('budi');
assert.equal(await act('budi', () => A.decide(req.id, 'budi', 'approved')), null);
await act('andi', () => A.receivePO(poId, { beans: 2 }, 'andi'));
assert.equal(d.pos.find(p => p.id === poId).status, 'received');
assert.equal(await stock('beans'), Math.round((beans0 - 0.1 + 2) * 1000) / 1000);

// cash: Rina's 40k cash out is signed by Maya, a 90k one rejected and kept as asked
const doc = async (coll, id) => (await db.query('select data from public.docs where tenant_id = $1 and coll = $2 and id = $3', [T, coll, id])).rows[0]?.data;
const sid = await act('rina', () => A.openSession('sen', 'rina', 300000));
const out = async (amount, decision) => {
  const cm = await act('rina', () => A.cashMove(sid, 'out', amount, 'es batu', 'rina'));
  await pin('maya');
  assert.equal(await act('maya', () => A.decide(d.approvals.find(a => a.subjectId === cm).id, 'maya', decision)), null);
  return doc('cashMoves', cm);
};
assert.deepEqual(await out(40000, 'approved').then(m => [m.status, m.amount]), ['done', 40000]);
assert.deepEqual(await out(90000, 'rejected').then(m => [m.status, m.amount]), ['rejected', 90000]);
// Rina is 200k short, over the PIC's limit: the manager signs, then the drawer is closed
const due = () => expectedCash(A.sessionCash(d, sid));
assert.equal(due(), 260000);
await act('rina', () => A.closeSession(sid, due() - 200000, 'uang hilang', 'rina'));
assert.equal((await doc('sessions', sid)).status, 'needs_approval');
await pin('andi');
assert.equal(await act('andi', () => A.decide(d.approvals.find(a => a.type === 'variance' && a.subjectId === sid).id, 'andi', 'approved')), null);
assert.equal((await doc('sessions', sid)).status, 'closed');
// Maya counts Tono's drawer 20k short, Sari asks for a recount, Maya recounts it right
const tono = d.sessions.find(s => s.cashierId === 'tono' && s.status === 'open').id, tdue = expectedCash(A.sessionCash(d, tono));
await act('maya', () => P.picCountDrawer(tono, tdue - 20000, 'kurang', 'maya'));
await pin('sari');
assert.equal(await act('sari', () => A.decide(d.approvals.find(a => a.type === 'variance' && a.subjectId === tono).id, 'sari', 'rejected')), null);
assert.equal((await doc('sessions', tono)).status, 'counting');
await act('maya', () => P.picCountDrawer(tono, tdue, '', 'maya'));
assert.deepEqual(await doc('sessions', tono).then(s => [s.status, s.variance]), ['closed', 0]);

// beans: Rina sells to a member, the member spends every bean, the bill is refunded in full (the manager signs)
await act('rina', () => A.openSession('sen', 'rina', 100000)); // her drawer takes the cash
const member = d.customers[0].id, beans = async () => Number((await db.query("select coalesce(sum((data->>'points')::numeric), 0) s from public.docs where tenant_id = $1 and coll = 'ledger' and data->>'customerId' = $2", [T, member])).rows[0].s);
const oid = await act('rina', () => A.newOrder('sen', 'rina', 'pos', { customerId: member }));
await act('rina', () => A.addLine(oid, 'p2', [], 3, '', 'rina'));
const bill = d.orders.find(o => o.id === oid);
await act('rina', () => POS.payCash(oid, roundCash(bill.total), bill.total, 'rina'));
assert.ok(await beans() > 0 && await beans() === balance(d.ledger, member), 'earned on the paid bill');
assert.equal(await act('rina', () => A.redeem(member, balance(d.ledger, member), 'Free latte', 'rina')), null);
const rf = await act('rina', () => A.requestApproval({ type: 'refund', title: 'Refund ' + bill.no, amount: bill.total, requestedBy: 'rina', outletId: 'sen', subjectId: oid, note: 'dingin', payload: { toStock: false } }));
await pin('andi');
assert.equal(await act('andi', () => A.decide(rf.id, 'andi', 'approved')), null);
assert.equal((await doc('orders', oid)).status, 'refunded');
assert.equal(await beans(), 0, 'the refund went through and the balance stays at zero');

console.log('staff actions hold');
await db.end();
