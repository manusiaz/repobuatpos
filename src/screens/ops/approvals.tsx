'use client';
// One approval row + decide flow for PIC, Manager and Shifts. Every decision goes through the approval PIN (src/ui/PinSheet.tsx)
// and decide(); a reject or recount asks for a reason first ("approvals one tap with reason").
import { useState, type ReactNode } from 'react';
import type { Approval, DB, Employee, Role } from '../../data/schema.ts';
import { canDecide } from '../../domain/approval.ts';
import { lineVariance, missingPhotos } from '../../domain/stock.ts';
import { allowed } from './perm.ts';
import { decide } from '../../data/actions.ts';
import { usePin } from '../../ui/PinSheet.tsx';
import { Badge, Sheet, Status, ago, hhmm, human, toast, type Tone } from '../../ui/kit.tsx';
import { idr } from '../../domain/money.ts';
import { useApp } from '../../app/context.tsx';
import { levelOf, nameOf } from './shift.ts';

type Decision = 'approved' | 'rejected' | 'recount';
const VERB: Record<Decision, string> = { approved: 'Approve', rejected: 'Reject', recount: 'Ask for a recount' };
const REASONS: Record<'rejected' | 'recount', string[]> = {
  rejected: ['Not allowed by policy', 'Need more detail', 'Wrong amount', 'Ask the guest first'],
  recount: ['Numbers look wrong', 'Photo missing or unclear', 'Count the opened packs too'],
};

export const amountOf = (a: Approval) => a.type === 'discount' ? `${a.pct}%` : a.amount ? idr(a.amount) : '';
export const LEVEL_TONE: Record<Approval['level'], Tone> = { cashier: 'neutral', pic: 'info', manager: 'violet', owner: 'accent' };

/** decide() behind the approval PIN. `after` runs only when the decision went through. */
export function useDecide() {
  const pin = usePin();
  const [why, setWhy] = useState<{ a: Approval; d: 'rejected' | 'recount'; after?: () => void } | null>(null);
  const [note, setNote] = useState('');
  const { db } = useApp();
  const confirm = (a: Approval, d: Decision, n = '', after?: () => void) => pin.ask({
    title: a.title, verb: VERB[d] + ' with your PIN',
    detail: `${nameOf(db, a.requestedBy)} asked ${ago(a.at)}${a.note ? ' · ' + a.note : ''}${n ? ' · Reason: ' + n : ''}. You can’t decide your own request; your name goes on the audit log.`,
    onOk: by => { const e = decide(a.id, by, d, n); if (e) toast(e); else { toast(d === 'approved' ? 'Approved · ' + nameOf(db, a.requestedBy) + ' notified' : d === 'recount' ? 'Recount requested' : 'Rejected · reason sent'); after?.(); } },
  });
  const run = (a: Approval, d: Decision, after?: () => void) => {
    if (d === 'approved') return confirm(a, d, '', after);
    setNote(''); setWhy({ a, d, after });
  };
  const sheet = <>
    {pin.sheet}
    <Sheet open={!!why} onClose={() => setWhy(null)} side="center" title={why ? VERB[why.d] : ''} sub={why?.a.title}
      footer={<><button className="btn" onClick={() => setWhy(null)}>Cancel</button>
        <button className="btn btn-primary" disabled={!note.trim()} onClick={() => { const w = why!; setWhy(null); confirm(w.a, w.d, note.trim(), w.after); }}>Continue</button></>}>
      {why && <div className="stack">
        <span className="muted" style={{ fontSize: 14 }}>Tell {nameOf(db, why.a.requestedBy)} why. It is sent with the decision.</span>
        <div className="row wrap">{REASONS[why.d].map(r => <button key={r} className="chip" aria-pressed={note === r} onClick={() => setNote(r)}>{r}</button>)}</div>
        <textarea className="input" placeholder="Reason" value={note} onChange={e => setNote(e.target.value)} />
      </div>}
    </Sheet>
  </>;
  return { run, sheet, ask: pin.ask };
}

/** Approval row: type, what, who/why/when, amount, state; actions passed in by the screen. */
export function ApprovalCard({ a, children, foot, dim }: { a: Approval; children?: ReactNode; foot?: ReactNode; dim?: boolean }) {
  const { db } = useApp();
  return <div className="card tight stack sm" style={{ opacity: dim ? .7 : 1 }}>
    <div className="row wrap" style={{ alignItems: 'flex-start', gap: 12 }}>
      <div className="grow stack sm" style={{ gap: 4, minWidth: 200 }}>
        <div className="row wrap"><Badge tone="info">{human(a.type)}</Badge><Badge tone={LEVEL_TONE[a.level]}>{a.level === 'pic' ? 'PIC' : human(a.level)} decides</Badge>
          {a.status !== 'waiting' && <Status s={a.status} />}</div>
        <b style={{ fontSize: 15 }}>{a.title}</b>
        <span className="muted" style={{ fontSize: 13 }}>{nameOf(db, a.requestedBy)}{a.countedBy && a.countedBy !== a.requestedBy ? ` · counted by ${nameOf(db, a.countedBy)}` : ''}{a.note ? ' · ' + a.note : ''} · {hhmm(a.at)} ({ago(a.at)})</span>
        {a.decidedBy && <span className="faint" style={{ fontSize: 13 }}>{human(a.status)} by {nameOf(db, a.decidedBy)}{a.decidedAt ? ' · ' + hhmm(a.decidedAt) : ''}{a.decisionNote ? ' · ' + a.decisionNote : ''}</span>}
      </div>
      {amountOf(a) && <b className="num" style={{ fontSize: 18 }}>{amountOf(a)}</b>}
    </div>
    {children && <div className="row wrap">{children}</div>}
    {foot}
  </div>;
}

const PERM_OF: Partial<Record<Approval['type'], string>> = { discount: 'Apply discount', void: 'Void item', refund: 'Refund', opname: 'Approve opname variance', variance: 'Close cash for the day', reject_online: 'Reject online order (reason)' };
/** Why this person can't decide this row (null = they can): own request, ladder, permission matrix, missing opname photos. */
export function whyBlocked(db: DB, role: Role, me: Employee | undefined, meId: string, a: Approval): string | null {
  if (a.requestedBy === meId || a.countedBy === meId) return a.type === 'opname' ? 'Your count · someone else signs' : 'Your request · someone else decides';
  if (!canDecide(a, { id: meId, level: levelOf(role) })) return `Needs ${a.level}`;
  const p = PERM_OF[a.type];
  if (p && !allowed(db, role, me, p, a.outletId)) return 'Not allowed for your role here';
  if (a.type === 'opname') {
    const op = db.opnames.find(o => o.id === a.subjectId);
    const miss = op ? missingPhotos(op.lines, op.requirePhotoAll).length : 0;
    if (miss) return `${miss} photo${miss > 1 ? 's' : ''} missing · ask the counter to add them`;
  }
  return null;
}

/** Opname rows show what was counted and the photo proof, so the signer checks before signing. */
export function OpnameProof({ a }: { a: Approval }) {
  const { db } = useApp();
  const op = db.opnames.find(o => o.id === a.subjectId);
  if (!op) return null;
  const diff = op.lines.filter(l => l.counted !== l.systemQty);
  return <div className="stack sm sunken" style={{ padding: 12 }}>
    <span style={{ fontSize: 13 }}><b>{op.area}</b> · {op.lines.length} counted · {diff.length} differ · counted by {nameOf(db, op.countedBy)}</span>
    {diff.slice(0, 8).map(l => { const it = db.stockItems.find(s => s.id === l.stockItemId); const v = lineVariance(l); return <div key={l.stockItemId} className="row" style={{ fontSize: 13 }}>
      {l.photo ? <img src={l.photo} alt={`Photo of ${it?.name}`} width={40} height={40} style={{ borderRadius: 8, objectFit: 'cover' }} /> : <Badge tone="danger">No photo</Badge>}
      <span className="grow">{it?.name}: {l.systemQty} → {l.counted} {it?.unit}{l.recountOf ? ` (recount, first ${l.recountOf})` : ''}</span><b className={v < 0 ? 'down' : 'up'}>{idr(v)}</b></div>; })}
  </div>;
}
