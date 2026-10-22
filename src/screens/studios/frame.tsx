'use client';
// Layout A: tools list · settings · live preview. Below 1024px: preview first, settings in a floating panel (bottom sheet).
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from '../../ui/Link.tsx';
import { publish, setSetting } from '../../data/actions.ts';
import { snapshot } from '../../data/store.ts';
import type { Version } from '../../data/schema.ts';
import { publishVerb } from '../../domain/menu.ts';
import { Badge, Icon, Sheet, ago, dateShort, hhmm, toast } from '../../ui/kit.tsx';
import { contrast, Fields, planLocked, PLAN_LABEL, type Ctx, type Tool, type V } from './core.tsx';
import { toolPlan } from '../../system/tools.ts';

const CSS = `
.sx-grid{display:grid;grid-template-columns:232px 320px minmax(0,1fr);gap:16px;align-items:start}
.sx-tools{position:sticky;top:72px;max-height:calc(100dvh - 96px);overflow:auto;padding:8px}
.sx-set{padding:16px}
.sx-stage{min-height:620px;padding:28px 20px;border-radius:var(--radius-lg);background:var(--bg-sunken);background-image:radial-gradient(var(--border) 1px,transparent 1px);background-size:18px 18px;display:flex;justify-content:center;align-items:flex-start;overflow:hidden}
.sx-pick,.sx-fab{display:none}
.sx-tool{display:flex;align-items:center;gap:10px;min-height:38px;padding:6px 10px;border-radius:10px;color:var(--fg-1);font-size:13px;font-weight:600;text-decoration:none!important}
.sx-tool:hover{background:var(--bg-sunken)}.sx-tool[aria-current=page]{background:var(--role-soft);color:var(--role-fg)}
.sx-tool span.n{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
@media (max-width:1279px){.sx-grid{grid-template-columns:300px minmax(0,1fr)}.sx-tools{display:none}.sx-pick{display:block}}
@media (max-width:1023px){.sx-grid{grid-template-columns:minmax(0,1fr)}.sx-grid>.sx-set{display:none}.sx-fab{display:inline-flex;position:fixed;right:16px;bottom:16px;z-index:40;box-shadow:var(--shadow-e2)}.sx-stage{padding:16px 8px;min-height:0}}
`;

export type DraftState = 'draft' | 'saving' | 'published' | 'waiting' | 'locked' | 'contrast';
const STATE: Record<DraftState, [string, 'neutral' | 'success' | 'warning' | 'danger' | 'info']> = {
  draft: ['Draft', 'neutral'], saving: ['Saving…', 'neutral'], published: ['Published', 'success'], waiting: ['Waiting for owner', 'warning'], locked: ['Locked by plan', 'info'], contrast: ['Contrast fail', 'danger'],
};

const parse = (s: unknown): V => { try { return typeof s === 'string' ? JSON.parse(s) : {}; } catch { return {}; } };
const same = (a: V, b: V, keys: string[]) => keys.every(k => JSON.stringify(a[k]) === JSON.stringify(b[k]));

/** Draft lives in settings (`studio:<tool>`), debounced; every publish is a version (rollback any version). */
export function useDraft(tool: Tool, x: Ctx, preset?: V) {
  const key = 'studio:' + tool.id;
  const saved = useMemo(() => parse(x.db.settings[key]), [x.db.settings, key]);
  const [local, setLocal] = useState<V>({});
  const [over, setOver] = useState<V>(preset ?? {});
  const pend = useRef<{ key: string; vals: V }>({ key, vals: {} }), timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const by = x.by;
  const flush = useRef(() => {});
  flush.current = () => {
    clearTimeout(timer.current); const { key: k, vals } = pend.current; if (!Object.keys(vals).length) return;
    pend.current = { key: k, vals: {} }; setSetting(k, JSON.stringify({ ...parse(snapshot().settings[k]), ...vals }), by); setLocal({});
  };
  const presetKey = JSON.stringify(preset ?? {});
  useEffect(() => { setOver(JSON.parse(presetKey)); setLocal({}); return () => flush.current(); }, [tool.id, presetKey]);
  const v: V = { ...tool.def, ...saved, ...over, ...local };
  const set = (k: string, val: unknown) => {
    setOver(o => { if (!(k in o)) return o; const n = { ...o }; delete n[k]; return n; });
    pend.current = { key, vals: { ...pend.current.vals, [k]: val } }; setLocal(l => ({ ...l, [k]: val }));
    clearTimeout(timer.current); timer.current = setTimeout(() => flush.current(), 600);
  };
  const versions = x.db.versions.filter(ver => ver.kind === 'page' && (ver.data as V)?.tool === tool.id);
  const approvalOf = (ver: Version) => x.db.approvals.find(a => a.type === 'publish' && a.subjectId === ver.id);
  const live = versions.find(ver => ver.status === 'published');
  const waiting = versions.find(ver => ver.status === 'pending_owner' && approvalOf(ver)?.status === 'waiting');
  const keys = Object.keys(tool.def ?? {});
  const stored = { ...tool.def, ...saved };
  return { v, set, versions, live, waiting, approvalOf, saving: Object.keys(local).length > 0, isLive: !!live && same(stored, (live.data as V).values, keys), stored, setAll: (vals: V) => { setSetting(key, JSON.stringify(vals), x.by); setLocal({}); setOver({}); } };
}

export function StudioFrame({ tool, tools, x, preset, pathOf }: { tool: Tool; tools: Tool[]; x: Ctx; preset?: V; pathOf: (id: string) => string }) {
  const d = useDraft(tool, x, preset);
  const [sheet, setSheet] = useState(false), [hist, setHist] = useState(false);
  const studio = !!tool.def;
  const locked = planLocked(toolPlan(tool.id), x.db);
  const fails = (tool.pairs?.(d.v, x) ?? []).map(([fg, bg, where]) => ({ where, r: contrast(fg, bg) })).filter(p => p.r < 4.5);
  const state: DraftState = locked ? 'locked' : fails.length ? 'contrast' : d.saving ? 'saving' : d.waiting ? 'waiting' : d.isLive ? 'published' : 'draft';
  const groups = useMemo(() => tools.reduce<Record<string, Tool[]>>((a, t) => ((a[t.group] ??= []).push(t), a), {}), [tools]);
  const verb = publishVerb(x.user.role);

  const doPublish = () => {
    if (locked) return toast(`${tool.name} needs the ${PLAN_LABEL[toolPlan(tool.id)]} plan`);
    if (fails.length) return toast('Fix contrast before publishing');
    const done = publish('page', { tool: tool.id, values: d.v }, x.by, tool.name);
    if (JSON.stringify(d.v) !== JSON.stringify(d.stored)) d.setAll(d.v);
    toast(done ? `${tool.name} published` : 'Sent to owner for approval');
  };

  const settings = <div className="stack">
    {locked && <div className="card tight stack sm" style={{ background: 'var(--info-soft)', borderColor: 'transparent' }}>
      <div className="row"><Icon name="lock" size={18} /><b>{PLAN_LABEL[toolPlan(tool.id)]} plan feature</b></div>
      <p style={{ fontSize: 13 }}>You’re on {PLAN_LABEL[x.db.tenant.plan]}. Everything stays visible so you can try it; publishing unlocks after you upgrade.</p>
      <Link href="/owner/account/subscription-billing" className="btn btn-primary btn-sm">Upgrade to {PLAN_LABEL[toolPlan(tool.id)]}</Link>
    </div>}
    {fails.length > 0 && <div className="banner" style={{ background: 'var(--danger-soft)', color: 'var(--danger-fg)' }} role="alert"><Icon name="contrast" size={18} />
      <div className="stack sm" style={{ gap: 2 }}><b>Contrast below 4.5:1 · publish blocked</b>{fails.map(f => <span key={f.where} style={{ fontSize: 13 }}>{f.where}: {f.r.toFixed(1)}:1</span>)}</div></div>}
    {d.waiting && <div className="banner" style={{ background: 'var(--warning-soft)', color: 'var(--warning-fg)' }}><Icon name="hourglass" size={18} /><span>Sent to owner {ago(d.waiting.at)}. You can keep editing; the owner sees the version you sent.</span></div>}
    {tool.Panel ? <tool.Panel v={d.v} set={d.set} x={x} /> : tool.fields ? <Fields fields={tool.fields(d.v, x)} v={d.v} set={d.set} /> : null}
    {studio && <>
      <button className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setHist(h => !h)} aria-expanded={hist}><Icon name="rotate-ccw-clock" size={16} />Versions ({d.versions.length})</button>
      {hist && <div className="stack sm">{d.versions.length === 0 ? <p className="faint" style={{ fontSize: 13 }}>No versions yet. Each publish is kept here and can be restored.</p> :
        d.versions.map((ver, i) => { const ap = d.approvalOf(ver); const st = ver.status === 'published' ? 'published' : ap?.status === 'rejected' ? 'rejected' : 'pending_owner';
          return <div key={ver.id} className="row" style={{ fontSize: 13, padding: '6px 0', borderTop: '1px solid var(--border)' }}>
            <span className="grow">v{d.versions.length - i} · {dateShort(ver.at)} {hhmm(ver.at)} · {x.db.employees.find(e => e.id === ver.by)?.name ?? ver.by}</span>
            <Badge tone={st === 'published' ? 'success' : st === 'rejected' ? 'danger' : 'warning'}>{st === 'pending_owner' ? 'Waiting' : st === 'published' ? 'Published' : 'Rejected'}</Badge>
            <button className="btn btn-ghost btn-sm" onClick={() => { d.setAll((ver.data as V).values); toast('Restored as draft. Publish to make it live.'); }}>Restore</button>
          </div>; })}</div>}
    </>}
  </div>;

  return <div className="stack" style={{ gap: 16 }}>
    <style>{CSS}</style>
    <header className="row wrap between" style={{ gap: 12, alignItems: 'flex-end' }}>
      <div className="stack sm" style={{ gap: 4, minWidth: 0, flex: '1 1 320px' }}>
        <span className="cap" style={{ color: 'var(--accent-fg)' }}>{tool.group} STUDIO{toolPlan(tool.id) !== 'free' && ` · ${PLAN_LABEL[toolPlan(tool.id)]}`}</span>
        <h1 style={{ fontSize: 'clamp(22px,1.2vw + 16px,28px)' }}>{tool.name}</h1>
        <p className="muted" style={{ maxWidth: 680, fontSize: 14 }}>{tool.desc}</p>
      </div>
      {studio && <div className="row" style={{ flex: 'none' }}>
        <Badge tone={STATE[state][1]} dot>{STATE[state][0]}</Badge>
        {state === 'draft' && d.live && <span className="faint hide-sm" style={{ fontSize: 12 }}>Live since {dateShort(d.live.at)}</span>}
        <button className="btn btn-primary" onClick={doPublish} disabled={locked || fails.length > 0 || state === 'published' || state === 'saving'}>
          <Icon name={x.owner ? 'upload' : 'send'} size={18} />{state === 'published' ? 'Published' : verb}</button>
      </div>}
    </header>
    <div className="sx-pick">
      <select className="input" aria-label="Studio tool" value={tool.id} onChange={e => x.go(pathOf(e.target.value))}>
        {Object.entries(groups).map(([g, ts]) => <optgroup key={g} label={g}>{ts.map(t => <option key={t.id} value={t.id}>{t.name}{planLocked(toolPlan(t.id), x.db) ? ` · ${PLAN_LABEL[toolPlan(t.id)]}` : ''}</option>)}</optgroup>)}
      </select>
    </div>
    <div className="sx-grid">
      <nav className="card sx-tools" aria-label="Studio tools">
        {Object.entries(groups).map(([g, ts]) => <div key={g} className="stack" style={{ gap: 2, marginBottom: 10 }}>
          <span className="cap row between" style={{ padding: '6px 10px', color: 'var(--fg-3)' }}><span>{g}</span><span>{ts.length}</span></span>
          {ts.map(t => <Link key={t.id} href={pathOf(t.id)} className="sx-tool" aria-current={t.id === tool.id ? 'page' : undefined}>
            <Icon name={t.icon} size={16} /><span className="n">{t.name}</span>
            {toolPlan(t.id) !== 'free' && <Badge tone={planLocked(toolPlan(t.id), x.db) ? 'info' : 'accent'}>{toolPlan(t.id) === 'enterprise' ? 'ENT' : toolPlan(t.id).toUpperCase()}</Badge>}
          </Link>)}
        </div>)}
      </nav>
      <section className="card sx-set" aria-label="Settings"><span className="cap" style={{ display: 'block', marginBottom: 12 }}>{tool.Panel && !studio ? 'Actions' : 'Settings'}</span>{settings}</section>
      <section className="sx-stage" aria-label="Live preview"><tool.Preview v={d.v} set={d.set} x={x} /></section>
    </div>
    <button className="btn btn-dark sx-fab" onClick={() => setSheet(true)}><Icon name="sliders-horizontal" size={18} />{tool.Panel && !studio ? 'Actions' : 'Settings'}</button>
    <Sheet open={sheet} onClose={() => setSheet(false)} side="bottom" title={tool.name} sub={studio ? STATE[state][0] : undefined}
      footer={studio ? <button className="btn btn-primary btn-block" onClick={() => { doPublish(); setSheet(false); }} disabled={locked || fails.length > 0}>{verb}</button> : undefined}>{settings}</Sheet>
  </div>;
}
