'use client';
// Knowledge graph explorer (spec/BorNiz Connections): every page, surface, data object, role, service event and design doc,
// and every real dependency between them. ?node=<id> preselects a node.
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { buildGraph, neighbours, type GEdge, type GNode, type NodeKind } from '../system/graph.ts';
import { surfaceHome, type Surface } from '../system/registry.ts';
import { Badge, Icon, Empty, type Tone } from '../ui/kit.tsx';

const KINDS: NodeKind[] = ['page', 'feature', 'surface', 'object', 'role', 'event', 'doc'];
const COLOR: Record<NodeKind, string> = { page: 'var(--accent)', feature: 'var(--ember-300)', surface: 'var(--info)', object: 'var(--success)', role: 'var(--violet)', event: 'var(--warning)', doc: 'var(--fg-3)' };
const TONE: Record<NodeKind, Tone> = { page: 'accent', feature: 'neutral', surface: 'info', object: 'success', role: 'violet', event: 'warning', doc: 'neutral' };
const EDGE_LABEL: Record<string, [string, string]> = {
  'renders-in': ['Renders in', 'Pages rendered here'], reads: ['Reads', 'Read by'], writes: ['Writes', 'Written by'], opens: ['Opens', 'Opened by'],
  links: ['Links to', 'Linked from'], live: ['Live with', 'Live with'], emits: ['Emits', 'Emitted by'], updates: ['Updates', 'Updated by'],
};

const hrefOf = (n: GNode) => n.kind === 'feature' ? n.id : n.kind === 'page' ? String(n.meta?.path) : n.kind === 'surface' ? surfaceHome(n.id.slice(2) as Surface) : null;
const setUrl = (id: string | null) => { const u = new URL(location.href); if (id) u.searchParams.set('node', id); else u.searchParams.delete('node'); history.replaceState(null, '', u); };

export default function Screen() {
  const g = useMemo(() => buildGraph(), []);
  const byId = useMemo(() => new Map(g.nodes.map(n => [n.id, n])), [g]);
  const degree = useMemo(() => { const d = new Map<string, number>(); g.edges.forEach(e => { d.set(e.from, (d.get(e.from) ?? 0) + 1); d.set(e.to, (d.get(e.to) ?? 0) + 1); }); return d; }, [g]);
  const [q, setQ] = useState(''), [kinds, setKinds] = useState<Set<NodeKind>>(new Set(KINDS)), [sel, setSel] = useState<string | null>(null), [hops, setHops] = useState<1 | 2>(1);
  useEffect(() => { const n = new URLSearchParams(location.search).get('node'); setSel(n && byId.has(n) ? n : 's:pos'); }, [byId]);
  const pick = (id: string) => { setSel(id); setUrl(id); };

  const ql = q.trim().toLowerCase();
  const results = useMemo(() => g.nodes.filter(n => kinds.has(n.kind) && (!ql || (n.label + ' ' + n.id).toLowerCase().includes(ql)))
    .sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0)), [g, kinds, ql, degree]);
  const node = sel ? byId.get(sel) : undefined;
  const nb = node ? neighbours(g, node.id) : null;
  const count = (k: NodeKind) => g.nodes.filter(n => n.kind === k).length;

  return <div className="stack" style={{ maxWidth: 1440, margin: '0 auto', padding: '16px var(--margin) 64px', gap: 20 }}>
    <header className="row between wrap" style={{ alignItems: 'flex-end' }}>
      <div className="stack sm"><Link href="/owner" className="row" style={{ fontSize: 13 }}><Icon name="arrow-left" size={14} />Back to dashboard</Link><h1>Everything is connected</h1>
        <p className="muted" style={{ maxWidth: 620 }}>Every page is a node; every line is a real data or design dependency. Pick a node to see what it reads, writes and links to.</p></div>
      <div className="row wrap"><Badge>{g.nodes.length} nodes</Badge><Badge>{g.edges.length} edges</Badge></div>
    </header>

    <div className="row wrap" role="group" aria-label="Filter by kind">
      {KINDS.map(k => <button key={k} className="chip row" aria-pressed={kinds.has(k)} onClick={() => setKinds(s => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n.size ? n : new Set(KINDS); })}>
        <span className="dot" style={{ background: COLOR[k] }} />{k} · {count(k)}</button>)}
    </div>

    <div className="row wrap" style={{ alignItems: 'flex-start', gap: 'var(--gutter)' }}>
      <aside className="card stack sm" style={{ flex: '1 1 280px', maxWidth: '100%', maxHeight: 640, overflow: 'hidden' }}>
        <input className="search" placeholder="Search pages, objects, events…" value={q} onChange={e => setQ(e.target.value)} aria-label="Search nodes" />
        <span className="faint" style={{ fontSize: 12 }}>{results.length} matches · most connected first</span>
        <div className="stack" style={{ gap: 2, overflow: 'auto' }}>
          {results.slice(0, 120).map(n => <button key={n.id} onClick={() => pick(n.id)} className="nav-i" style={{ border: 0, background: n.id === sel ? 'var(--accent-soft)' : 'none', cursor: 'pointer', textAlign: 'left' }}>
            <span className="dot" style={{ background: COLOR[n.kind] }} /><span className="grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{n.label}</span><span className="faint num" style={{ fontSize: 12 }}>{degree.get(n.id) ?? 0}</span></button>)}
          {!results.length && <Empty icon="search-x" title="No node matches">Try a page name, an object like “order”, or an event like “payment.settled”.</Empty>}
        </div>
      </aside>

      <section className="stack" style={{ flex: '3 1 560px', minWidth: 0, maxWidth: '100%' }}>
        {node && nb ? <>
          <div className="card stack sm">
            <div className="row between wrap"><Badge tone={TONE[node.kind]} dot>{node.kind}</Badge><span className="mono faint">{node.id}</span></div>
            <h2>{node.label}</h2>
            <Meta n={node} />
            <div className="row wrap">{hrefOf(node) && <Link className="btn btn-primary btn-sm" href={hrefOf(node)!}>Open {node.kind === 'surface' ? 'app' : 'page'}<Icon name="arrow-right" size={16} /></Link>}
              <span className="faint" style={{ fontSize: 13 }}>{nb.out.length} outgoing · {nb.in.length} incoming</span></div>
          </div>
          <div className="card stack sm" style={{ background: 'var(--ink-950)', borderColor: 'var(--ink-950)', padding: 12 }} data-theme="dark">
            <div className="row between"><span className="cap" style={{ color: 'var(--fg-2)' }}>Neighbourhood</span><div className="seg" role="group" aria-label="Hops">{([1, 2] as const).map(h => <button key={h} aria-pressed={hops === h} onClick={() => setHops(h)}>{h} hop{h > 1 ? 's' : ''}</button>)}</div></div>
            <Force g={g} center={node.id} hops={hops} kinds={kinds} byId={byId} onPick={pick} />
          </div>
          <div className="grid" style={{ ['--min' as string]: '260px' }}>
            <Edges title="Outgoing" edges={nb.out} side="to" byId={byId} onPick={pick} />
            <Edges title="Incoming" edges={nb.in} side="from" byId={byId} onPick={pick} />
          </div>
        </> : <Empty icon="waypoints" title="Pick a node">Search on the left or tap a node.</Empty>}
      </section>
    </div>
  </div>;
}

function Meta({ n }: { n: GNode }) {
  const m = (n.meta ?? {}) as Record<string, unknown>;
  const rows = Object.entries(m).filter(([, v]) => v != null && v !== '' && v !== '—');
  if (!rows.length) return null;
  return <dl className="grid" style={{ ['--min' as string]: '200px', margin: 0, gap: 8 }}>{rows.map(([k, v]) => <div key={k} style={{ fontSize: 13 }}><dt className="cap">{k}</dt><dd style={{ margin: 0 }}>{String(v)}</dd></div>)}</dl>;
}

function Edges({ title, edges, side, byId, onPick }: { title: string; edges: GEdge[]; side: 'from' | 'to'; byId: Map<string, GNode>; onPick: (id: string) => void }) {
  const groups = edges.reduce<Record<string, GEdge[]>>((a, e) => ((a[e.kind] ??= []).push(e), a), {});
  return <section className="card stack sm"><h3>{title} · {edges.length}</h3>
    {!edges.length && <span className="muted" style={{ fontSize: 14 }}>None.</span>}
    {Object.entries(groups).map(([k, es]) => <details key={k} open={es.length <= 12}>
      <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: 14, padding: '6px 0' }}>{EDGE_LABEL[k]?.[side === 'to' ? 0 : 1] ?? k} · {es.length}</summary>
      <div className="stack" style={{ gap: 2 }}>{es.map((e, i) => { const n = byId.get(e[side]); if (!n) return null; const h = hrefOf(n); return <div key={i} className="row" style={{ minHeight: 36 }}>
        <span className="dot" style={{ background: COLOR[n.kind] }} />
        <button className="grow" style={{ border: 0, background: 'none', padding: '6px 0', textAlign: 'left', cursor: 'pointer', fontSize: 14 }} onClick={() => onPick(n.id)}>{n.label}{e.label && <span className="faint"> · {e.label}</span>}</button>
        {h && <Link href={h} aria-label={'Open ' + n.label} className="btn btn-ghost btn-sm"><Icon name="external-link" size={14} /></Link>}
      </div>; })}</div>
    </details>)}
  </section>;
}

type G = ReturnType<typeof buildGraph>;
const W = 640, H = 400, MAX = 46;

/** Small force-directed layout of the selected node's 1–2 hop neighbourhood (no dependencies; runs once per selection). */
function Force({ g, center, hops, kinds, byId, onPick }: { g: G; center: string; hops: 1 | 2; kinds: Set<NodeKind>; byId: Map<string, GNode>; onPick: (id: string) => void }) {
  const { nodes, edges, hidden } = useMemo(() => {
    const keep = new Set([center]); let frontier = [center], total = 0;
    for (let h = 0; h < hops; h++) {
      const next: string[] = [];
      for (const id of frontier) for (const e of g.edges) {
        const o = e.from === id ? e.to : e.to === id ? e.from : null;
        if (!o || keep.has(o) || !kinds.has(byId.get(o)?.kind ?? 'doc')) continue;
        total++; if (keep.size < MAX) { keep.add(o); next.push(o); }
      }
      frontier = next;
    }
    const ids = [...keep], es = g.edges.filter(e => keep.has(e.from) && keep.has(e.to));
    // Deterministic start on a circle, then ~220 steps of repulsion + springs + gravity.
    const p = ids.map((id, i) => id === center ? { id, x: W / 2, y: H / 2, vx: 0, vy: 0 } : { id, x: W / 2 + Math.cos(i * 2.4) * 140, y: H / 2 + Math.sin(i * 2.4) * 120, vx: 0, vy: 0 });
    const ix = new Map(ids.map((id, i) => [id, i]));
    for (let t = 0; t < 220; t++) {
      for (let i = 0; i < p.length; i++) for (let j = i + 1; j < p.length; j++) {
        const dx = p[i].x - p[j].x, dy = p[i].y - p[j].y, d2 = dx * dx + dy * dy + .01, f = 1800 / d2, d = Math.sqrt(d2);
        p[i].vx += dx / d * f; p[i].vy += dy / d * f; p[j].vx -= dx / d * f; p[j].vy -= dy / d * f;
      }
      for (const e of es) { const a = p[ix.get(e.from)!], b = p[ix.get(e.to)!], dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1, f = (d - 90) * .02; a.vx += dx / d * f; a.vy += dy / d * f; b.vx -= dx / d * f; b.vy -= dy / d * f; }
      for (const n of p) { if (n.id === center) { n.x = W / 2; n.y = H / 2; continue; } n.vx += (W / 2 - n.x) * .004; n.vy += (H / 2 - n.y) * .004; n.x = Math.max(20, Math.min(W - 20, n.x + n.vx * .5)); n.y = Math.max(20, Math.min(H - 24, n.y + n.vy * .5)); n.vx *= .6; n.vy *= .6; }
    }
    return { nodes: p, edges: es, hidden: Math.max(0, total - (ids.length - 1)) };
  }, [g, center, hops, kinds, byId]);
  const pos = new Map(nodes.map(n => [n.id, n]));
  return <div className="stack sm">
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img" aria-label="Neighbourhood graph">
      {edges.map((e, i) => { const a = pos.get(e.from)!, b = pos.get(e.to)!; const hot = e.from === center || e.to === center; return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={hot ? 'var(--fg-2)' : 'var(--border)'} strokeWidth={hot ? 1.4 : .8} strokeDasharray={e.kind === 'links' ? '4 3' : undefined} />; })}
      {nodes.map(n => { const gn = byId.get(n.id)!, c = n.id === center, r = c ? 12 : 7; return <g key={n.id} transform={`translate(${n.x},${n.y})`} style={{ cursor: 'pointer' }} onClick={() => onPick(n.id)} tabIndex={0} role="button" aria-label={gn.label} onKeyDown={e => e.key === 'Enter' && onPick(n.id)}>
        <circle r={r + 8} fill="transparent" />
        <circle r={r} fill={COLOR[gn.kind]} stroke={c ? 'var(--fg-1)' : 'none'} strokeWidth={2} />
        {(c || nodes.length <= 24) && <text y={r + 13} textAnchor="middle" fontSize={c ? 12 : 10} fill="var(--fg-1)" style={{ fontFamily: 'var(--font-body)', pointerEvents: 'none' }}>{gn.label.length > 26 ? gn.label.slice(0, 25) + '…' : gn.label}</text>}
        <title>{gn.label} · {gn.kind}</title>
      </g>; })}
    </svg>
    <span className="faint" style={{ fontSize: 12 }}>{nodes.length - 1} neighbours shown{hidden ? ` · ${hidden} more in the lists below` : ''} · dashed = design link</span>
  </div>;
}
