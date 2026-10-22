'use client';
// PIC approvals: queue within limits, escalation, history of this shift. Every decision = approval PIN + decide().
import { useState } from 'react';
import type { Approval } from '../../data/schema.ts';
import { escalate } from '../../data/actions.ts';
import { ESCALATE_MS } from '../../domain/approval.ts';
import { Badge, Empty, Seg, ago, toast } from '../../ui/kit.tsx';
import { ApprovalCard, OpnameProof, useDecide, whyBlocked } from '../ops/approvals.tsx';
import type { PicCtx } from './ctx.ts';

/** Why the signed-in person can't decide this row (null = they can). */
export const blocker = (c: PicCtx, a: Approval) => whyBlocked(c.db, c.user.role, c.me, c.meId, a);

export function ApprovalQueue({ c }: { c: PicCtx }) {
  const { db, outletId, meId } = c;
  const dz = useDecide();
  const waiting = db.approvals.filter(a => a.outletId === outletId && a.status === 'waiting');
  const mine = waiting.filter(a => a.level === 'pic'), over = waiting.filter(a => a.level === 'manager' || a.level === 'owner');
  return <div className="stack">
    {dz.sheet}
    {mine.length === 0 ? <div className="card"><Empty icon="badge-check" title="Nothing waiting for you">Voids, discounts up to 20%, refunds and cash outs up to IDR 100k, and variances up to IDR 50k from this outlet land here.</Empty></div>
      : mine.map(a => { const b = blocker(c, a); return <ApprovalCard key={a.id} a={a} foot={a.type === 'opname' ? <OpnameProof a={a} /> : undefined}>
        {b ? <Badge tone="warning">{b}</Badge> : <>
          <button className="btn btn-success btn-pos" onClick={() => dz.run(a, 'approved')}>{a.type === 'opname' || a.type === 'variance' ? 'Sign' : 'Approve'}</button>
          {a.type === 'opname' && <button className="btn btn-pos" onClick={() => dz.run(a, 'recount')}>Ask recount</button>}
          <button className="btn btn-danger btn-pos" onClick={() => dz.run(a, 'rejected')}>Reject</button></>}
        {a.requestedBy !== meId && <button className="btn btn-ghost" onClick={() => { escalate(a.id, meId); toast(`Escalated to ${c.mgr?.name ?? 'manager'}`); }}>Escalate to manager</button>}
      </ApprovalCard>; })}
    {over.length > 0 && <>
      <h3 style={{ marginTop: 8 }}>Over your limit · for your information</h3>
      {over.map(a => <ApprovalCard key={a.id} a={a} dim><Badge tone="violet">With {a.level === 'manager' ? c.mgr?.name ?? 'the manager' : 'the owner'} · sent {ago(a.at)}</Badge></ApprovalCard>)}
    </>}
    <p className="faint" style={{ fontSize: 13 }}>Every approval asks for your approval PIN and is logged with the requester’s and your name.</p>
  </div>;
}

export function Escalate({ c }: { c: PicCtx }) {
  const { db, outletId, now, meId } = c;
  const waiting = db.approvals.filter(a => a.outletId === outletId && a.status === 'waiting');
  const pic = waiting.filter(a => a.level === 'pic'), up = waiting.filter(a => a.level !== 'pic' && a.level !== 'cashier');
  return <div className="stack">
    <div className="banner b-info">Requests over your limit go to {c.mgr?.name ?? 'the manager'} on their own. Anything left with the PIC for 5 minutes goes up too; escalate sooner when you’re unsure or busy on the floor. Manager has 30 minutes, then it goes to the owner.</div>
    <h3>Waiting at PIC level</h3>
    {pic.length === 0 ? <p className="muted">Nothing waiting at your level.</p> : pic.map(a => { const late = now - a.at > (ESCALATE_MS.pic ?? 0); return <ApprovalCard key={a.id} a={a}>
      {late && <Badge tone="danger">Waiting {ago(a.at, now).replace(' ago', '')} · over 5 min</Badge>}
      <button className={'btn btn-pos' + (late ? ' btn-primary' : '')} onClick={() => { escalate(a.id, meId); toast(`Escalated to ${c.mgr?.name ?? 'manager'} · they were notified`); }}>Escalate to manager</button>
    </ApprovalCard>; })}
    <h3 style={{ marginTop: 8 }}>With the manager or owner</h3>
    {up.length === 0 ? <p className="muted">Nothing over your limit right now.</p> : up.map(a => <ApprovalCard key={a.id} a={a} dim>
      <Badge tone={a.level === 'owner' ? 'accent' : 'violet'}>{a.level === 'owner' ? 'With the owner' : `With ${c.mgr?.name ?? 'the manager'}`} · {ago(a.at, now)}</Badge>
      {a.level === 'manager' && now - a.at > (ESCALATE_MS.manager ?? 0) && <Badge tone="danger">Over 30 min · goes to owner</Badge>}
    </ApprovalCard>)}
  </div>;
}

export function ApprovalHistory({ c }: { c: PicCtx }) {
  const { db, outletId, start, meId } = c;
  const [f, setF] = useState<'all' | 'mine'>('all');
  const done = db.approvals.filter(a => a.outletId === outletId && a.status !== 'waiting' && (a.decidedAt ?? a.at) >= start && (f === 'all' || a.decidedBy === meId))
    .sort((a, b) => (b.decidedAt ?? 0) - (a.decidedAt ?? 0));
  return <div className="stack">
    <div className="row between wrap"><span className="muted">{done.length} decided this shift · nothing is deleted</span><Seg value={f} onChange={setF} options={[['all', 'Everyone'], ['mine', 'By me']] as const} label="Filter" /></div>
    {done.length === 0 ? <div className="card"><Empty icon="rotate-ccw-clock" title="No decisions yet this shift" /></div> : done.map(a => <ApprovalCard key={a.id} a={a} />)}
  </div>;
}
