// Drawer close and cash moves: one count per close, the variance signed by someone who neither ran nor counted the
// drawer, always with a note, a rejected cash out kept as asked, one alert per count.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { snapshot } from './store.ts';
import { cashMove, closeSession, decide, openSession, sessionCash } from './actions.ts';
import { picCountDrawer } from './actions/pic.ts';
import { expectedCash } from '../domain/shift.ts';

const expected = (sid: string) => expectedCash(sessionCash(snapshot(), sid));
const session = (sid: string) => snapshot().sessions.find(s => s.id === sid)!;
const variances = (sid: string) => snapshot().approvals.filter(a => a.type === 'variance' && a.subjectId === sid);

test('a replayed or second close does not overwrite the first count', () => {
  const sid = openSession('kem', 'wulan', 300000);
  closeSession(sid, expected(sid) - 30000, 'short 30k', 'wulan');
  closeSession(sid, expected(sid) - 200000, 'replay', 'wulan');
  assert.equal(session(sid).variance, -30000);
  assert.equal(variances(sid).length, 1);
});

test('a variance always needs a note', () => {
  const sid = openSession('kem', 'wulan', 300000);
  const chk = closeSession(sid, expected(sid) - 10000, '', 'wulan');
  assert.equal(chk.needsNote, true);
  assert.equal(session(sid).status, 'open', 'not closed without a reason');
  assert.equal(variances(sid).length, 0);
});

test('the PIC who ran a drawer cannot sign its shortage when another PIC counts it', () => {
  const sid = openSession('sen', 'maya', 300000);
  picCountDrawer(sid, expected(sid) - 40000, 'short', 'sari');
  const v = variances(sid)[0];
  assert.equal(v.level, 'pic');
  assert.match(decide(v.id, 'maya', 'approved') ?? '', /own/);
  assert.match(decide(v.id, 'sari', 'approved') ?? '', /own/);
  assert.equal(decide(v.id, 'andi', 'approved'), null, 'the manager signs');
});

test('a PIC count raises the Cash variance alert once', () => {
  const sid = openSession('sen', 'rina', 300000), before = snapshot().notices.length;
  picCountDrawer(sid, expected(sid) - 20000, 'short', 'maya');
  assert.equal(snapshot().notices.slice(0, snapshot().notices.length - before).filter(n => n.alert === 'Cash variance' && n.to.includes('pic')).length, 1);
});

test('a rejected cash out keeps what was asked and moves no cash', () => {
  const sid = openSession('bsd', 'lia', 500000);
  const out = cashMove(sid, 'out', 150000, 'Supplier COD', 'lia');
  const ap = snapshot().approvals.find(a => a.subjectId === out)!;
  assert.equal(decide(ap.id, 'budi', 'rejected'), null);
  const m = snapshot().cashMoves.find(c => c.id === out)!;
  assert.equal(m.amount, 150000);
  assert.equal(m.status, 'rejected');
  assert.equal(expected(sid), 500000);
});
