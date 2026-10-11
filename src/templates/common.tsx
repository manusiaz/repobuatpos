'use client';
import { useState, type ReactNode } from 'react';
import pagesJson from '../system/pages.json' with { type: 'json' };
import authority from '../system/authority.json' with { type: 'json' };
import { useApp } from '../app/context.tsx';
import { isGated } from '../system/access.ts';
import { Badge, Icon, Status, hhmm, dateShort } from '../ui/kit.tsx';
import { idr } from '../domain/money.ts';
import type { Col, Row } from './views.ts';

type ModeUI = [string, string, string, string];
const MODE_TONE: Record<string, 'info' | 'violet' | 'success' | 'neutral' | 'warning'> = { screen: 'info', studio: 'violet', edit: 'success', settings: 'neutral', read: 'neutral', record: 'warning', incoming: 'info', approve: 'info' };

/** Title row + data-origin badge (Editable / Settings / Report / From the POS / Incoming / Approve) + actions. */
export function PageHead({ actions, sub }: { actions?: ReactNode; sub?: ReactNode }) {
  const { page, user } = useApp();
  const m = (pagesJson.modes as unknown as Record<string, ModeUI>)[page.mode];
  return <header className="stack sm">
    <div className="row between wrap" style={{ gap: 12 }}>
      <div className="stack sm grow" style={{ minWidth: 240 }}>
        <div className="row wrap"><Badge tone={MODE_TONE[page.mode]}>{m?.[0]}</Badge>{page.template && <Badge>{page.template}</Badge>}{isGated(user.role, page) && page.mode !== 'approve' && <Badge tone="info"><Icon name="send" size={12} />Changes go to the owner</Badge>}</div>
        <h1>{page.title}</h1>
        <p className="muted" style={{ maxWidth: 760 }}>{sub ?? m?.[3]}</p>
      </div>
      {actions && <div className="row wrap">{actions}</div>}
    </div>
  </header>;
}

/** Who creates / edits / approves this data (spec Authority). Back office never types automatic data. */
export function AuthorityPanel() {
  const { page, user } = useApp();
  const [open, setOpen] = useState(false);
  const o = authority.objects.find(x => x.id === page.object);
  if (!o) return null;
  const s = (authority.src as Record<string, string[]>)[o.src];
  const you = o.src === 'auto' || o.src === 'incoming' ? 'You: view only' : user.role === 'manager' && !/Manager/.test(o.create + o.edit) ? 'You (manager): request only' : `You (${user.role}): can act${isGated(user.role, page) ? ' · owner approves' : ''}`;
  return <section className="card tight stack sm">
    <button className="row between" onClick={() => setOpen(!open)} style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', textAlign: 'left' }} aria-expanded={open}>
      <span className="row wrap"><Icon name="shield-check" size={18} /><b style={{ fontSize: 14 }}>{o.name}</b><span className="badge" style={{ background: s[1], color: s[2] }}>{s[0]}</span><Badge tone="neutral">{you}</Badge></span>
      <Icon name={open ? 'chevron-up' : 'chevron-down'} size={18} />
    </button>
    {open && <div className="grid" style={{ ['--min' as string]: '220px', gap: 12 }}>
      {([['Comes from', o.from], ['Who creates', o.create], ['Who edits', o.edit], ['Delete', o.remove], ['Approval', o.approve], ['Escalation', o.escalate], ['Automatic effects', o.auto], ['Loophole closed', o.closed]] as const).filter(([, v]) => v && v !== '—').map(([k, v]) =>
        <div key={k} className="stack" style={{ gap: 2 }}><span className="cap">{k}</span><span style={{ fontSize: 14 }}>{v}</span></div>)}
    </div>}
  </section>;
}

export function cell(c: Col, v: unknown): ReactNode {
  if (v == null || v === '') return <span className="faint">—</span>;
  switch (c.f) {
    case 'money': return <span className="num" style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{idr(Number(v))}</span>;
    case 'status': return <Status s={String(v)} />;
    case 'time': { const t = Number(v); return <span className="muted">{Date.now() - t < 864e5 && new Date(t).getDate() === new Date().getDate() ? hhmm(t) : dateShort(t) + ' ' + hhmm(t)}</span>; }
    case 'date': return <span className="muted">{dateShort(Number(v))}</span>;
    case 'mono': return <span className="mono">{String(v)}</span>;
    case 'num': return <span className="num" style={{ fontWeight: 600 }}>{Number(v).toLocaleString('en-US')}</span>;
    case 'pct': return <span className="num" style={{ fontWeight: 600 }}>{Number(v)}%</span>;
    case 'scope': return <Badge tone={String(v) === 'All outlets' ? 'accent' : 'info'}>{String(v)}</Badge>;
    default: return String(v);
  }
}
export const isRight = (c: Col) => c.f === 'money' || c.f === 'num' || c.f === 'pct';

export function downloadCSV(name: string, cols: Col[], rows: Row[]) {
  const esc = (v: unknown) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const csv = [cols.map(c => esc(c.l)).join(','), ...rows.map(r => cols.map(c => esc(c.f === 'time' || c.f === 'date' ? new Date(Number(r[c.k])).toISOString() : r[c.k])).join(','))].join('\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = name.replace(/[^a-z0-9]+/gi, '-').toLowerCase() + '.csv'; a.click();
}
