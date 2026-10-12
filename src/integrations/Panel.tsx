'use client';
// The one settings panel for every third-party connection: same list, form, secrets, test and status everywhere
// (payment methods, devices, accounting, delivery apps, WhatsApp, email, webhooks, the register's device page).
import { useState } from 'react';
import type { Integration } from '../data/schema.ts';
import { useApp } from '../app/context.tsx';
import { Badge, copy, Empty, Field, Icon, Sheet, Toggle, toast } from '../ui/kit.tsx';
import { removeIntegration, reportIntegration, saveIntegration } from '../data/actions/integrations.ts';
import { connectorsOf } from './registry.ts';
import { putSecrets } from './secrets.ts';
import { testIntegration } from './testers.ts';
import { KIND_LABEL, type Connector, type Kind } from './types.ts';

const RUNTIME: Record<Connector['runtime'], string> = { server: 'Cloud API', browser: 'Plugs into this device', bridge: 'Via BorNiz Bridge app', manual: 'Staff enters the result' };
const EDIT: Record<Connector['scope'], string[]> = { tenant: ['owner'], outlet: ['owner', 'manager'], device: ['owner', 'manager', 'pic', 'cashier'] };

export function IntegrationsPanel({ kinds, outletId, deviceId, title }: { kinds: Kind[]; outletId?: string | null; deviceId?: string | null; title?: string }) {
  const { db, user, outletId: here } = useApp();
  const [open, setOpen] = useState<{ c: Connector; i: Integration | null } | null>(null);
  const list = connectorsOf(...kinds);
  const scopeOut = (c: Connector) => (c.scope === 'tenant' ? null : outletId === undefined ? here : outletId);
  const scopeDev = (c: Connector) => (c.scope === 'device' ? deviceId ?? null : null);
  const mine = (c: Connector) => db.integrations.filter(i => i.connector === c.id && i.outletId === scopeOut(c) && (c.scope !== 'device' || deviceId == null || i.deviceId === deviceId));
  if (!list.length) return <Empty icon="plug" title={`No ${kinds.map(k => KIND_LABEL[k].toLowerCase()).join(' / ')} connectors yet`} />;
  return <div className="stack">
    {title && <h3>{title}</h3>}
    {list.map(c => {
      const rows = mine(c), can = EDIT[c.scope].includes(user.role);
      return <div key={c.id} className="card flat" style={{ padding: 14 }}>
        <div className="row between" style={{ alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
          <span className="stack grow" style={{ gap: 4, minWidth: 200 }}>
            <span className="row" style={{ gap: 8, flexWrap: 'wrap' }}><b>{c.name}</b><Badge tone="neutral">{KIND_LABEL[c.kind]}</Badge>
              {c.ready ? <Badge tone="info">{RUNTIME[c.runtime]}</Badge> : <Badge tone="warning">Ready to connect · driver pending</Badge>}</span>
            <span className="muted" style={{ fontSize: 13 }}>{c.blurb}</span>
          </span>
          {can && <button className="btn btn-sm" onClick={() => setOpen({ c, i: null })}><Icon name="plus" size={16} />{rows.length ? 'Add another' : 'Connect'}</button>}
        </div>
        {rows.map(i => <div key={i.id} className="row between" style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)', gap: 10, flexWrap: 'wrap' }}>
          <span className="row" style={{ gap: 8 }}><Icon name={i.status === 'ok' ? 'circle-check' : i.status === 'error' ? 'circle-alert' : 'circle-dashed'} size={18} style={{ color: i.status === 'ok' ? 'var(--success)' : i.status === 'error' ? 'var(--danger)' : 'var(--fg-3)' }} />
            <span className="stack" style={{ gap: 2 }}><b style={{ fontSize: 14 }}>{i.name}{!i.enabled && ' · off'}</b>
              <span className="muted" style={{ fontSize: 12 }}>{i.status === 'error' ? i.lastError : i.status === 'ok' ? 'Working' : 'Saved · not tested yet'}{i.outletId ? ' · ' + (db.outlets.find(o => o.id === i.outletId)?.name ?? '') : ''}</span></span></span>
          <span className="row" style={{ gap: 6 }}>
            <button className="btn btn-sm" onClick={async () => { const r = await testIntegration(i); reportIntegration(i.id, r.ok, r.ok ? '' : r.message); toast(r.message); }}>Test</button>
            {can && <button className="btn btn-sm" onClick={() => setOpen({ c, i })}>Edit</button>}
          </span>
        </div>)}
      </div>;
    })}
    {open && <ConnectSheet c={open.c} i={open.i} outletId={scopeOut(open.c)} deviceId={scopeDev(open.c)} onClose={() => setOpen(null)} />}
  </div>;
}

function ConnectSheet({ c, i, outletId, deviceId, onClose }: { c: Connector; i: Integration | null; outletId: string | null; deviceId: string | null; onClose: () => void }) {
  const { db, user } = useApp();
  const [name, setName] = useState(i?.name ?? c.name);
  const [enabled, setEnabled] = useState(i?.enabled ?? true);
  const [cfg, setCfg] = useState<Record<string, string | number | boolean>>(i?.config ?? {});
  const [sec, setSec] = useState<Record<string, string>>({});
  const [err, setErr] = useState(''), [busy, setBusy] = useState(false);
  const hook = c.webhook && typeof location !== 'undefined' ? `${location.origin}${c.webhook}?tenant=${db.tenant.id}` : '';
  const save = async () => {
    const miss = c.fields.find(f => f.required && (f.type === 'secret' ? !sec[f.key] && !i?.secrets.includes(f.key) : cfg[f.key] === undefined || cfg[f.key] === ''));
    if (miss) return setErr(`${miss.label} is required.`);
    setBusy(true);
    try {
      const id = saveIntegration({ id: i?.id, connector: c.id, outletId, deviceId, name: name.trim() || c.name, enabled, config: cfg }, Object.keys(sec).filter(k => sec[k]), user.id);
      await putSecrets(id, sec);
      toast('Saved'); onClose();
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  };
  return <Sheet open onClose={onClose} title={i ? `Edit ${c.name}` : `Connect ${c.name}`} sub={c.blurb}
    footer={<div className="row between" style={{ width: '100%' }}>
      {i ? <button className="btn btn-ghost" onClick={() => { removeIntegration(i.id, user.id); toast('Disconnected'); onClose(); }}>Disconnect</button> : <span />}
      <button className="btn btn-primary" disabled={busy} onClick={save}>Save</button></div>}>
    <div className="stack">
      {!c.ready && <div className="banner b-warning"><Icon name="plug-zap" /><span>The connection is set up here and the settings are kept. The {c.name} driver itself is not written yet, so nothing is sent to {c.name} until it is.</span></div>}
      <Field label="Name"><input className="input" value={name} onChange={e => setName(e.target.value)} /></Field>
      {c.fields.map(f => <Field key={f.key} label={f.label} hint={f.help} optional={!f.required}>
        {f.type === 'toggle' ? <Toggle on={Boolean(cfg[f.key])} onChange={v => setCfg({ ...cfg, [f.key]: v })} label={f.label} />
          : f.type === 'select' ? <select className="input" value={String(cfg[f.key] ?? '')} onChange={e => setCfg({ ...cfg, [f.key]: e.target.value })}><option value="">Choose…</option>{f.options?.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          : f.type === 'secret' ? <input className="input" type="password" autoComplete="off" value={sec[f.key] ?? ''} placeholder={i?.secrets.includes(f.key) ? 'Saved · type to replace' : f.placeholder} onChange={e => setSec({ ...sec, [f.key]: e.target.value })} />
          : <input className="input" type={f.type === 'number' ? 'number' : f.type === 'url' ? 'url' : 'text'} value={String(cfg[f.key] ?? '')} placeholder={f.placeholder} onChange={e => setCfg({ ...cfg, [f.key]: f.type === 'number' ? Number(e.target.value) : e.target.value })} />}
      </Field>)}
      {hook && <Field label="Webhook URL" hint={`Paste this in the ${c.name} dashboard so it can tell us when a payment or order changes.`}>
        <div className="row"><input className="input grow mono" readOnly value={hook} /><button className="btn" onClick={() => copy(hook)}><Icon name="copy" size={16} /></button></div></Field>}
      <div className="row between"><span>Active</span><Toggle on={enabled} onChange={setEnabled} label="Active" /></div>
      {c.docs && <a className="muted" href={c.docs} target="_blank" rel="noreferrer" style={{ fontSize: 13 }}>{c.name} developer docs</a>}
      {err && <div role="alert" className="banner b-danger"><Icon name="circle-alert" />{err}</div>}
    </div>
  </Sheet>;
}
