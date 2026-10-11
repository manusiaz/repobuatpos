'use client';
// Roles & permissions matrix (spec/BorNiz Roles, bn-perms.js). Defaults from catalog.perms, saved overrides in db.perms
// ("<outlet>|<action>" or "all|<action>", full 7-char row). Owner signs every change with the approval PIN; managers propose.
import { useMemo, useState } from 'react';
import Link from 'next/link';
import catalog from '../system/catalog.json' with { type: 'json' };
import { useApp } from '../app/context.tsx';
import { PERM_ACTIONS, PERM_COLS, LOCKED_COLS, permRow } from '../system/perms.ts';
import { decide, requestApproval, setPerm } from '../data/actions.ts';
import { usePin } from '../ui/PinSheet.tsx';
import { Badge, Icon, Seg, Empty, ago, toast } from '../ui/kit.tsx';

type Code = 'y' | 'o' | 'a' | 'n';
const CYCLE: Code[] = ['y', 'o', 'a', 'n'];
const LEGEND: Record<Code, { label: string; icon: string; bg: string; fg: string }> = {
  y: { label: 'Allowed', icon: 'check', bg: 'var(--success-soft)', fg: 'var(--success-fg)' },
  o: { label: 'Own outlet / shift only', icon: 'store', bg: 'var(--info-soft)', fg: 'var(--info-fg)' },
  a: { label: 'Needs approval', icon: 'shield-alert', bg: 'var(--warning-soft)', fg: 'var(--warning-fg)' },
  n: { label: 'Hidden', icon: 'minus', bg: 'var(--bg-sunken)', fg: 'var(--fg-3)' },
};
const COL_LABEL: Record<string, string> = { owner: 'Owner', manager: 'Manager', pic: 'PIC', cashier: 'Cashier', kitchen: 'Kitchen', waiter: 'Waiter', admin: 'Admin' };
const DEF = catalog.perms as Record<string, string>;
// Grouping as in the Roles prototype. Owner-only actions are shown locked: they never move off the owner.
const GROUPS: [string, string[]][] = [
  ['Selling', ['Take orders & charge', 'Apply discount', 'Void item', 'Refund', 'Open drawer without sale']],
  ['Kitchen', ['See & bump tickets', 'Mark item sold out']],
  ['Online & delivery', ['Accept online order', 'Reject online order (reason)', 'Busy mode / pause channel', 'Fire scheduled order early', 'Hand bag over without pickup code']],
  ['Stock & cash', ['Count stock (opname)', 'Approve opname variance', 'Close cash for the day']],
];
const OWNER_ONLY: [string, string][] = [['Edit products & prices', 'yannnnn'], ['Channel price list', 'ynnnnnn'], ['See profit & costs', 'yannnnn'], ['Payroll', 'yannnnn'], ['Publish Brand & Menu Studio', 'yannnnn'], ['Billing & plan', 'ynnnnny'], ['Edit a submitted count', 'nnnnnnn']];

export default function Screen() {
  const { db, me, user } = useApp();
  const pin = usePin();
  const isOwner = user.role === 'owner', isMgr = user.role === 'manager';
  const outlets = isOwner ? db.outlets : db.outlets.filter(o => me?.outlets.includes(o.id));
  const [scope, setScope] = useState<string>(isOwner ? 'all' : outlets[0]?.id ?? 'all');
  const [draft, setDraft] = useState<Record<string, string>>({});
  const grouped = useMemo(() => { const known = new Set(GROUPS.flatMap(g => g[1])); const rest = PERM_ACTIONS.filter(a => !known.has(a)); return rest.length ? [...GROUPS, ['More', rest] as [string, string[]]] : GROUPS; }, []);

  const key = (a: string) => `${scope}|${a}`;
  const saved = (a: string) => permRow(db, a, scope);
  const row = (a: string) => draft[key(a)] ?? saved(a);
  const pending = Object.entries(draft).filter(([k, v]) => k.startsWith(scope + '|') && v !== permRow(db, k.split('|')[1], scope));
  const custom = PERM_ACTIONS.filter(a => row(a) !== DEF[a]).length;
  const proposals = db.approvals.filter(a => a.type === 'perm' && a.status === 'waiting');
  const history = db.audit.filter(a => a.action === 'perms.changed').slice(0, 6);
  const scopeName = (s: string) => s === 'all' ? 'All outlets' : db.outlets.find(o => o.id === s)?.name ?? s;

  const cycle = (a: string, ci: number) => {
    const r = row(a).split(''); r[ci] = CYCLE[(CYCLE.indexOf(r[ci] as Code) + 1) % CYCLE.length];
    setDraft(d => ({ ...d, [key(a)]: r.join('') }));
  };
  const resetRow = (a: string) => setDraft(d => ({ ...d, [key(a)]: DEF[a] }));
  const discard = () => setDraft(d => Object.fromEntries(Object.entries(d).filter(([k]) => !k.startsWith(scope + '|'))));
  const changes = Object.fromEntries(pending);
  const summary = pending.map(([k]) => k.split('|')[1]).join(', ');

  const save = () => {
    if (isOwner) return pin.ask({ title: `${pending.length} permission ${pending.length === 1 ? 'change' : 'changes'} · ${scopeName(scope)}`, detail: summary, verb: 'Sign permission changes', onOk: by => {
      pending.forEach(([k, v]) => setPerm(k, v, by)); discard(); toast('Permissions saved · every app updates now');
    } });
    requestApproval({ type: 'perm', title: `Permissions · ${pending.length} ${pending.length === 1 ? 'change' : 'changes'} · ${scopeName(scope)}`, requestedBy: me?.id ?? user.id, outletId: scope === 'all' ? user.outletId : scope, note: summary, payload: { changes } });
    discard(); toast('Sent to owner for approval');
  };
  const decideProposal = (id: string, ok: boolean) => {
    const ap = db.approvals.find(a => a.id === id)!;
    pin.ask({ title: ap.title, detail: ap.note, verb: ok ? 'Approve permission changes' : 'Reject permission changes', onOk: by => {
      const err = decide(id, by, ok ? 'approved' : 'rejected');
      if (err) return toast(err);
      // The approval engine has no 'perm' effect yet, so the signed changes are applied here, after decide().
      if (ok) Object.entries((ap.payload?.changes ?? {}) as Record<string, string>).forEach(([k, v]) => setPerm(k, v, by));
      toast(ok ? 'Approved · permissions updated' : 'Rejected');
    } });
  };

  if (!isOwner && !isMgr) return <Empty icon="shield-x" title="Only the owner and managers can see permissions" />;
  return <div className="stack lg">
    <header className="row between wrap" style={{ alignItems: 'flex-end' }}>
      <div className="stack sm"><span className="cap">Team</span><h1>Roles & permissions</h1>
        <p className="muted" style={{ maxWidth: 640 }}>{isOwner ? 'Tap a cell to change who can do what. Changes save per outlet; “All outlets” is the base. Saving asks for your approval PIN and writes to the audit log.' : 'You can propose changes for your outlets. The owner reviews and signs with their approval PIN before anything changes.'}</p></div>
      <Badge tone={custom ? 'accent' : 'neutral'}>{custom ? `${custom} custom · ${scopeName(scope)}` : 'Same as BorNiz default'}</Badge>
    </header>

    {proposals.length > 0 && <section className="card stack" aria-label="Proposals">
      <div className="row between"><h3>Waiting for the owner · {proposals.length}</h3>{!isOwner && <Badge tone="warning">Owner decides</Badge>}</div>
      {proposals.map(p => { const by = db.employees.find(e => e.id === p.requestedBy); const ch = Object.entries((p.payload?.changes ?? {}) as Record<string, string>); return <div key={p.id} className="sunken stack sm">
        <div className="row between wrap"><b style={{ fontSize: 14 }}>{p.title}</b><span className="faint" style={{ fontSize: 13 }}>{by?.name ?? p.requestedBy} · {ago(p.at)}</span></div>
        {ch.map(([k, v]) => { const [o, a] = k.split('|'); return <div key={k} className="row wrap" style={{ fontSize: 13 }}><span className="grow">{a} <span className="faint">· {scopeName(o)}</span></span>{PERM_COLS.map((c, i) => <Cell key={c} code={v[i] as Code} small changed={v[i] !== permRow(db, a, o)[i]} label={`${a} · ${COL_LABEL[c]}`} />)}</div>; })}
        {isOwner && <div className="row"><button className="btn btn-primary btn-sm" onClick={() => decideProposal(p.id, true)}>Approve & apply</button><button className="btn btn-danger btn-sm" onClick={() => decideProposal(p.id, false)}>Reject</button></div>}
      </div>; })}
    </section>}

    <div className="row wrap between">
      <Seg value={scope} onChange={s => setScope(s)} label="Outlet" options={[...(isOwner ? [['all', 'All outlets'] as const] : []), ...outlets.map(o => [o.id, o.name] as const)]} />
      <div className="row wrap">{(Object.keys(LEGEND) as Code[]).map(c => <span key={c} className="row" style={{ fontSize: 13 }}><Cell code={c} small label={LEGEND[c].label} />{LEGEND[c].label}</span>)}</div>
    </div>

    <div className="card flat scroll-x">
      <table className="table" style={{ minWidth: 760 }}>
        <thead><tr><th style={{ minWidth: 220 }}>Action</th>{PERM_COLS.map(c => <th key={c} style={{ textAlign: 'center' }}>{COL_LABEL[c]}{LOCKED_COLS.includes(c) && <Icon name="lock" size={12} style={{ marginLeft: 4, verticalAlign: -1 }} />}</th>)}<th /></tr></thead>
        <tbody>
          {grouped.map(([g, acts]) => [
            <tr key={g}><td colSpan={9} className="cap" style={{ background: 'var(--bg-canvas)', height: 36 }}>{g}</td></tr>,
            ...acts.map(a => { const r = row(a), s = saved(a), dirty = r !== s, isCustom = r !== DEF[a]; return <tr key={a} style={{ background: dirty ? 'var(--accent-soft)' : undefined }}>
              <td style={{ fontWeight: 500 }}>{a}{isCustom && <span className="faint" style={{ fontSize: 12 }}> · custom</span>}</td>
              {PERM_COLS.map((c, i) => { const locked = LOCKED_COLS.includes(c); return <td key={c} style={{ textAlign: 'center' }}>
                <Cell code={r[i] as Code} locked={locked} changed={r[i] !== s[i]} label={`${a} · ${COL_LABEL[c]}: ${LEGEND[r[i] as Code].label}${locked ? ' (locked)' : ''} · default ${LEGEND[DEF[a][i] as Code].label}`} onClick={locked ? undefined : () => cycle(a, i)} />
              </td>; })}
              <td>{isCustom && <button className="btn btn-ghost btn-sm" onClick={() => resetRow(a)} title="Back to BorNiz default">Reset</button>}</td>
            </tr>; }),
          ])}
          <tr><td colSpan={9} className="cap" style={{ background: 'var(--bg-canvas)', height: 36 }}>Owner-only · locked</td></tr>
          {OWNER_ONLY.map(([a, code]) => <tr key={a}><td className="muted">{a}</td>{PERM_COLS.map((c, i) => <td key={c} style={{ textAlign: 'center' }}><Cell code={code[i] as Code} locked label={`${a} · ${COL_LABEL[c]}: owner-only action, locked`} /></td>)}<td /></tr>)}
        </tbody>
      </table>
    </div>

    <div className="row wrap" style={{ position: 'sticky', bottom: 12, zIndex: 5, padding: 12, borderRadius: 'var(--radius-lg)', background: 'var(--bg-surface)', boxShadow: pending.length ? 'var(--shadow-e2)' : 'var(--shadow-e1)' }}>
      <span className="grow" style={{ fontSize: 14 }}>{pending.length ? <><b>{pending.length} unsaved {pending.length === 1 ? 'change' : 'changes'}</b> · {scopeName(scope)}</> : <span className="muted">No unsaved changes · {scopeName(scope)}</span>}</span>
      <button className="btn btn-ghost" disabled={!pending.length} onClick={discard}>Discard</button>
      <button className="btn btn-primary" disabled={!pending.length} onClick={save}><Icon name={isOwner ? 'key-round' : 'send'} size={18} />{isOwner ? 'Save & sign' : 'Send to owner'}</button>
    </div>

    <div className="grid" style={{ ['--min' as string]: '300px' }}>
      <section className="card stack sm"><h3>Who approves</h3><p className="muted" style={{ fontSize: 14 }}>Cashier → PIC of the shift (discount ≤ 20%, void/refund ≤ IDR 100k, variance ≤ IDR 50k) → manager → owner (refunds over IDR 500k, prices, publishing, payroll). Every step is logged with both names.</p>
        <Link href="/manager/shifts/pic-limits" className="row" style={{ fontSize: 14 }}>PIC limits<Icon name="arrow-right" size={14} /></Link></section>
      <section className="card stack sm"><h3>Recent changes</h3>
        {history.length ? history.map(h => <div key={h.id} className="row between" style={{ fontSize: 13 }}><span className="grow">{h.subject.split('|')[1] ?? h.subject} · {scopeName(h.subject.split('|')[0])}</span><span className="faint">{db.employees.find(e => e.id === h.actor)?.name ?? h.actor} · {ago(h.at)}</span></div>)
          : <span className="muted" style={{ fontSize: 14 }}>No changes yet. Every app uses the BorNiz defaults.</span>}</section>
    </div>
    {pin.sheet}
  </div>;
}

function Cell({ code, locked, changed, small, label, onClick }: { code: Code; locked?: boolean; changed?: boolean; small?: boolean; label: string; onClick?: () => void }) {
  const l = LEGEND[code] ?? LEGEND.n, s = small ? 24 : 44;
  return <button type="button" onClick={onClick} aria-label={label} title={label}
    style={{ width: s, height: s, borderRadius: small ? 7 : 10, border: 0, background: l.bg, color: l.fg, display: 'inline-grid', placeItems: 'center', cursor: onClick ? 'pointer' : 'default', flex: 'none',
      boxShadow: changed ? '0 0 0 2px var(--accent)' : undefined, opacity: locked && !small ? .8 : 1, position: 'relative', padding: 0 }}>
    <Icon name={locked && !small && code === 'n' ? 'lock' : l.icon} size={small ? 13 : 18} />
  </button>;
}
