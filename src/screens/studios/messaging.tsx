'use client';
// Messaging & automation: WABA number, Meta-approved templates, automations, flow builder, consent, log, cost, sender domain, results.
// Messages are rows in db.messages; templates are seeds + edits in records.msg_template; flows in records.automation_flow.
import { useMemo, useRef, useState } from 'react';
import { saveRecord, deleteRecord } from '../../data/actions.ts';
import { queueMessages, retryMessage, setOptIn } from '../../data/actions/studios.ts';
import type { DB, Message, Rec } from '../../data/schema.ts';
import { idr, idrShort } from '../../domain/money.ts';
import { Badge, Empty, Icon, Kpi, Seg, Status, Toggle, ago, dateShort, hhmm, toast, useNow } from '../../ui/kit.tsx';
import { LineChart } from '../../ui/Chart.tsx';
import { IntegrationsPanel } from '../../integrations/Panel.tsx';
import { toolValue, TOOL_DEFAULTS } from '../../system/tools.ts';
import { lastVisit } from '../../data/alerts/automations.ts';
import { BASE, fromRec, templates, VARS, type Cat, type Tpl } from '../../domain/messages.ts';
export { templates, VARS, type Tpl } from '../../domain/messages.ts';
import { Caption, CopyRow, F, fillVars, orderVars, outletName, pct, Phone, Stage, type Ctx, type PP, type Tool, type V } from './core.tsx';

// ── Templates ──────────────────────────────────────────────────────────────────────────
const toRec = (t: Tpl): Rec => ({ id: t.id, a: t.name, b: t.body, c: t.button, d: t.cat, e: t.status, at: t.at });
const tplName = (db: DB, id: string) => templates(db).find(t => t.id === id)?.name ?? id.replace(/_/g, ' ');
const META_REVIEW_MS = 30e3;

// ── Cost (Meta rate card, Indonesia, per 24h conversation) ───────────────────────────────
export const RATE: Record<string, number> = { MARKETING: 586, UTILITY: 356, email: 15, sms: 450, push: 0 };
const costOf = (db: DB, m: Message) => (m.status === 'failed' ? 0 : m.channel === 'wa' ? RATE[templates(db).find(t => t.id === m.template)?.cat ?? 'UTILITY'] : RATE[m.channel] ?? 0);

// ── Previews ─────────────────────────────────────────────────────────────────────────────
export function WaBubble({ x, body, button, img, vars }: { x: Ctx; body: string; button?: string; img?: boolean; vars?: Record<string, unknown> }) {
  const t = x.db.theme, filled = fillVars(body, vars ?? orderVars(x.db, x.outletId));
  return <Phone theme={t} bg="var(--ink-100)">
    <div style={{ padding: '14px 16px', background: 'var(--success-fg)', color: 'var(--ink-0)', display: 'flex', alignItems: 'center', gap: 10 }}>
      <span style={{ width: 34, height: 34, borderRadius: 99, background: t.p, display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 13 }}>{t.name.split(' ').map(w => w[0]).join('').slice(0, 2)}</span>
      <div className="stack" style={{ gap: 0 }}><b style={{ fontSize: 14 }}>{t.name} <Icon name="badge-check" size={14} /></b><span style={{ fontSize: 11, opacity: .85 }}>Business account</span></div></div>
    <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ alignSelf: 'flex-start', maxWidth: '88%', background: 'var(--ink-0)', borderRadius: '4px 14px 14px 14px', overflow: 'hidden', boxShadow: '0 1px 1px rgba(20,18,16,.1)', fontFamily: 'var(--font-body)' }}>
        {img && <div style={{ height: 110, background: `linear-gradient(135deg,${t.p},${t.ink})` }} />}
        <p style={{ padding: '8px 10px', fontSize: 14, whiteSpace: 'pre-wrap', color: 'var(--ink-950)' }}>{filled}</p>
        <span style={{ display: 'block', textAlign: 'right', fontSize: 10, color: 'var(--ink-500)', padding: '0 8px 6px' }}>{hhmm(Date.now())}</span>
        {button && <div style={{ borderTop: '1px solid var(--ink-200)', padding: 10, textAlign: 'center', color: 'var(--info-fg)', fontWeight: 600, fontSize: 14 }}><Icon name="external-link" size={14} /> {button}</div>}
      </div>
    </div>
  </Phone>;
}
function EmailPreview({ x, subject, body, button, from }: { x: Ctx; subject: string; body: string; button?: string; from?: string }) {
  const t = x.db.theme, vars = orderVars(x.db, x.outletId);
  return <div style={{ width: 'min(480px,100%)', background: 'var(--bg-surface)', borderRadius: 16, boxShadow: 'var(--shadow-e2)', overflow: 'hidden' }}>
    <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', fontSize: 13 }}><b>{subject}</b><br /><span className="muted">{from ?? `${t.name} <no-reply@bornis.id>`} → {vars._customer?.email}</span></div>
    <div data-guest style={{ padding: 20, background: t.paper, color: t.ink, display: 'flex', flexDirection: 'column', gap: 12, fontSize: 14 }}>
      <b style={{ fontSize: 20, color: t.p }}>{t.name}</b><p style={{ whiteSpace: 'pre-wrap' }}>{fillVars(body, vars)}</p>
      {button && <span style={{ alignSelf: 'flex-start', padding: '10px 16px', borderRadius: 10, background: t.p, color: 'var(--ink-0)', fontWeight: 700 }}>{button}</span>}
      <span style={{ fontSize: 11, opacity: .7 }}>You get this because you visited {t.name}. Unsubscribe from promos.</span>
    </div></div>;
}

// ── Template editor ──────────────────────────────────────────────────────────────────────
function useTpl(x: Ctx, v: V) {
  const all = templates(x.db), cur = all.find(t => t.id === v.tpl) ?? all[0];
  const body = (v['body:' + cur.id] as string | undefined) ?? cur.body, button = (v['btn:' + cur.id] as string | undefined) ?? cur.button;
  return { all, cur, body, button, dirty: body !== cur.body || button !== cur.button };
}
function EditorPanel({ v, set, x }: PP) {
  const { all, cur, body, button, dirty } = useTpl(x, v);
  const ta = useRef<HTMLTextAreaElement>(null);
  const vars = orderVars(x.db, x.outletId);
  const [to, setTo] = useState(vars._customer?.phone ?? '');
  const insert = (k: string) => { const el = ta.current, s = el?.selectionStart ?? body.length, e = el?.selectionEnd ?? body.length; set('body:' + cur.id, body.slice(0, s) + `{{${k}}}` + body.slice(e)); };
  const submit = () => { saveRecord('msg_template', toRec({ ...cur, body, button, status: v.ch === 'wa' ? 'pending' : 'approved', at: Date.now() }), x.by); toast(v.ch === 'wa' ? 'Submitted to Meta for review' : 'Template saved'); };
  const test = () => { if (!/\d{8,}|@/.test(to.replace(/\s/g, ''))) return toast('Enter a phone number or email'); queueMessages([{ channel: v.ch === 'email' ? 'email' : v.ch === 'sms' ? 'sms' : 'wa', template: cur.id, to, customerId: x.db.customers.find(c => c.phone === to)?.id ?? null }], x.by); toast('Test sent. Watch it in the message log.'); };
  const unknown = [...body.matchAll(/\{\{(\w+)\}\}/g)].map(m => m[1]).filter(k => !VARS.includes(k));
  return <div className="stack">
    <div className="field"><label>Channel</label><Seg value={v.ch ?? 'wa'} options={[['wa', 'WhatsApp'], ['email', 'Email'], ['sms', 'SMS']] as const} onChange={c => set('ch', c)} /></div>
    <div className="field"><label>Template</label><select className="input" value={cur.id} onChange={e => set('tpl', e.target.value)}>{all.map(t => <option key={t.id} value={t.id}>{t.name} · {t.cat.toLowerCase()}</option>)}</select></div>
    <div className="row wrap"><TplStatus t={cur} /><Badge>{cur.cat}</Badge>{dirty && <Badge tone="warning">Unsaved edit</Badge>}</div>
    <label className="row between" style={{ minHeight: 44 }}><span>Header image</span><Toggle on={!!v.img} onChange={b => set('img', b)} label="Header image" /></label>
    <div className="field"><label>Message</label><textarea ref={ta} className="input" rows={7} value={body} onChange={e => set('body:' + cur.id, e.target.value)} /></div>
    <div className="stack sm"><span className="cap">Insert variable</span><div className="row wrap" style={{ gap: 6 }}>{VARS.map(k => <button key={k} className="chip" onClick={() => insert(k)}>{`{{${k}}}`}</button>)}</div></div>
    {unknown.length > 0 && <span className="err" style={{ fontSize: 13, color: 'var(--danger-fg)' }}>Unknown variable: {unknown.join(', ')}</span>}
    <div className="field"><label>Button</label><input className="input" value={button} onChange={e => set('btn:' + cur.id, e.target.value)} /></div>
    {cur.cat === 'MARKETING' && <div className="banner" style={{ background: 'var(--warning-soft)', color: 'var(--warning-fg)', fontSize: 13 }}>Marketing: sent only to opted-in guests, never during quiet hours 21:00–08:00.</div>}
    <button className="btn btn-primary" onClick={submit} disabled={!!unknown.length}><Icon name="send" size={18} />{v.ch === 'wa' || !v.ch ? 'Submit to Meta' : 'Save template'}</button>
    <div className="field"><label>Send test to</label><div className="row"><input className="input" value={to} onChange={e => setTo(e.target.value)} inputMode="tel" /><button className="btn none" onClick={test}>Send test</button></div></div>
  </div>;
}
function TplStatus({ t }: { t: Tpl }) {
  const now = useNow(5000);
  const st = t.status === 'pending' && now - t.at > META_REVIEW_MS ? 'approved' : t.status;
  return st === 'approved' ? <Badge tone="success" dot>Approved by Meta</Badge> : st === 'pending' ? <Badge tone="warning" dot>In review</Badge> : st === 'rejected' ? <Badge tone="danger" dot>Rejected</Badge> : <Badge dot>Draft</Badge>;
}
function EditorPreview({ v, x }: PP) {
  const { cur, body, button } = useTpl(x, v);
  const vars = orderVars(x.db, x.outletId);
  const filled = fillVars(body, vars).replace(/\n+/g, ' ');
  return <Stage>
    {(v.ch ?? 'wa') === 'wa' && <WaBubble x={x} body={body} button={button} img={!!v.img} vars={vars} />}
    {v.ch === 'email' && <EmailPreview x={x} subject={`${cur.name} · ${x.db.theme.name}`} body={body} button={button} />}
    {v.ch === 'sms' && <div className="card" style={{ width: 'min(340px,100%)' }}><span className="cap">SMS · {Math.min(filled.length, 160)}/160</span><p style={{ marginTop: 8 }}>{filled.slice(0, 155)}{filled.length > 155 ? '…' : ''}</p></div>}
    <Caption>Filled from a real order: {vars._order ? `${vars._order.no} by ${vars._customer?.name} at ${vars.outlet}, ${vars.total}` : 'no paid member orders yet'}.</Caption>
  </Stage>;
}

function TemplatesPanel({ v, set, x }: PP) {
  const add = () => { const id = 'tpl_' + Date.now().toString(36); saveRecord('msg_template', toRec({ id, name: 'New template', body: 'Hi {{name}}, ', button: '', cat: 'UTILITY', status: 'draft', at: Date.now() }), x.by); x.go(EDITOR_PATH(id, x)); };
  return <div className="stack">
    <div className="field"><label>Category</label><Seg value={v.cat ?? 'all'} options={[['all', 'All'], ['UTILITY', 'Utility'], ['MARKETING', 'Marketing']] as const} onChange={c => set('cat', c)} /></div>
    <button className="btn btn-primary" onClick={add}><Icon name="plus" size={18} />New template</button>
    <p className="faint" style={{ fontSize: 13 }}>WhatsApp templates need Meta approval before they send. Utility messages (receipts, order ready) cost less than marketing.</p>
  </div>;
}
let EDITOR_PATH = (id: string, x: Ctx) => { void id; void x; return '/owner/more-studios-marketing/wa-email-and-sms-template-editor'; };
export const setEditorPath = (f: (id: string, x: Ctx) => string) => { EDITOR_PATH = f; };
function TemplatesList({ v, x }: PP) {
  const all = templates(x.db).filter(t => (v.cat ?? 'all') === 'all' || t.cat === v.cat);
  const sent = (id: string) => x.db.messages.filter(m => m.template === id).length;
  return <div className="card flat" style={{ width: '100%' }}><div className="scroll-x"><table className="table">
    <thead><tr><th>Template</th><th>Category</th><th>Meta status</th><th className="r">Sent</th><th /></tr></thead>
    <tbody>{all.map(t => <tr key={t.id} className="click" onClick={() => x.go(EDITOR_PATH(t.id, x))}>
      <td><b>{t.name}</b><br /><span className="faint mono">{t.id}</span></td><td><Badge tone={t.cat === 'MARKETING' ? 'accent' : 'info'}>{t.cat}</Badge></td><td><TplStatus t={t} /></td><td className="r">{sent(t.id)}</td>
      <td className="r">{t.id.startsWith('tpl_') && <button className="btn btn-ghost btn-sm" onClick={e => { e.stopPropagation(); deleteRecord('msg_template', t.id, x.by); }} aria-label="Delete template"><Icon name="trash" size={16} /></button>}</td></tr>)}</tbody></table></div></div>;
}

// ── WABA connection ──────────────────────────────────────────────────────────────────────
function quality(db: DB) { const wa = db.messages.filter(m => m.channel === 'wa' && Date.now() - m.at < 7 * 864e5); const f = pct(wa.filter(m => m.status === 'failed').length, wa.length); return f < 5 ? ['High', 'success'] as const : f < 15 ? ['Medium', 'warning'] as const : ['Low', 'danger'] as const; }
// The number, token and provider live in the one integrations panel (secrets server-side, status from real sends).
const WabaPanel = () => <IntegrationsPanel kinds={['whatsapp', 'sms']} />;

function WabaPreview({ x }: PP) {
  const wa = x.db.integrations.find(i => i.kind === 'whatsapp' && i.enabled);
  const status = !wa ? 'none' : wa.status === 'ok' ? 'verified' : 'otp', [q, tone] = quality(x.db);
  const day = x.db.messages.filter(m => m.channel === 'wa' && Date.now() - m.at < 864e5);
  return <Stage>
    <div className="grid" style={{ ['--min' as string]: '150px', width: '100%', maxWidth: 640 }}>
      <Kpi label="Status" value={status === 'verified' ? 'Connected' : status === 'otp' ? (wa?.status === 'error' ? 'Error' : 'Saved · not tested') : 'Not connected'} delta={wa?.lastError ?? undefined} />
      <Kpi label="Quality rating" value={<Badge tone={tone}>{q}</Badge>} />
      <Kpi label="Sent last 24 h" value={day.length} delta="Limit 1,000 / day" />
    </div>
    {status === 'verified' ? <WaBubble x={x} body={templates(x.db)[0].body} button={templates(x.db)[0].button} /> : <Empty icon="message-circle-off" title="No WhatsApp number connected">Receipts and order-ready messages fall back to email until a number is verified.</Empty>}
  </Stage>;
}

// ── Automations ──────────────────────────────────────────────────────────────────────────
const DAY = 864e5;
function inQuiet(t: number, from: string, to: string) { const d = new Date(t), m = d.getHours() * 60 + d.getMinutes(); const f = +from.slice(0, 2) * 60 + +from.slice(3), e = +to.slice(0, 2) * 60 + +to.slice(3); return f > e ? m >= f || m < e : m >= f && m < e; }
function nextOpen(to: string) { const d = new Date(); d.setHours(+to.slice(0, 2), +to.slice(3), 0, 0); if (d.getTime() < Date.now()) d.setDate(d.getDate() + 1); return d.getTime(); }
/** Live consent rules = the published Opt-in & consent version (drafts don't change sending). */
export const quietOf = (db: DB) => { const s = toolValue(db, 'optin'); return { on: s.quiet, from: s.from, to: s.to }; };

interface Auto { id: string; name: string; icon: string; tpl: string; trigger: string; desc: string; audience: (db: DB, v: V) => DB['customers'] }
export const AUTOS: Auto[] = [
  { id: 'a_thanks', name: 'Post-visit thank-you', icon: 'heart-handshake', tpl: 'thanks_visit', trigger: 'Payment completed', desc: 'Thanks the guest on WhatsApp (or email) a set time after they pay.', audience: (db, v) => db.customers.filter(c => { const t = lastVisit(db, c.id); return t && Date.now() - t < (Number(v.delay) + 24) * 3600e3; }) },
  { id: 'a_feedback', name: 'Feedback request & review link', icon: 'star', tpl: 'feedback_request', trigger: 'Rating received', desc: 'Thanks guests who rated you well and asks them for a review. Low ratings already alert the manager (Bad review).', audience: (db, v) => db.customers.filter(c => db.reviews.some(r => r.customerId === c.id && r.stars >= Number(v.min))) },
  { id: 'a_winback', name: 'Win-back', icon: 'rotate-ccw', tpl: 'winback_30d', trigger: 'No visit in N days', desc: 'Invites regulars back when they haven’t visited for a while, with a voucher.', audience: (db, v) => db.customers.filter(c => { const t = lastVisit(db, c.id); return t > 0 && Date.now() - t > Number(v.days) * DAY; }) },
  { id: 'a_bday', name: 'Birthday & points expiry', icon: 'cake', tpl: 'birthday', trigger: 'Birthday window', desc: 'Birthday treat before the birthday. The beans-expiry nudge goes out 14 days before expiry (Points expiring alert).', audience: (db, v) => db.customers.filter(c => { if (!c.birthday) return false; const b = new Date(c.birthday), n = new Date(); b.setFullYear(n.getFullYear()); const d = (b.getTime() - n.getTime()) / DAY; return d >= 0 && d <= Number(v.days); }) },
];
const AUTO_DEF = TOOL_DEFAULTS as unknown as Record<string, V>;
function autoStats(db: DB, tpl: string, windowDays = 7) {
  const ms = db.messages.filter(m => m.template === tpl && Date.now() - m.at < 30 * DAY && m.at <= Date.now());
  const back = ms.map(m => db.orders.filter(o => o.customerId && o.customerId === m.customerId && o.status === 'paid' && (o.paidAt ?? o.createdAt) > m.at && (o.paidAt ?? o.createdAt) - m.at < windowDays * DAY));
  return { sent: ms.length, read: ms.filter(m => m.status === 'read').length, failed: ms.filter(m => m.status === 'failed').length, back: back.filter(b => b.length).length, revenue: back.flat().reduce((a, o) => a + o.total, 0) };
}
function FlowNodes({ nodes }: { nodes: [string, string, string, string][] }) {
  return <div className="stack" style={{ gap: 0, width: 'min(360px,100%)' }}>{nodes.map(([ic, k, d, tone], i) => <div key={i} className="stack" style={{ gap: 0, alignItems: 'center' }}>
    {i > 0 && <span style={{ width: 2, height: 18, background: 'var(--border)' }} />}
    <div className="card tight row" style={{ width: '100%' }}><span style={{ width: 36, height: 36, borderRadius: 10, display: 'grid', placeItems: 'center', background: `var(--${tone}-soft)`, color: `var(--${tone}-fg)`, flex: 'none' }}><Icon name={ic} size={18} /></span>
      <div className="stack" style={{ gap: 0, minWidth: 0 }}><span className="cap">{k}</span><span style={{ fontSize: 14 }}>{d}</span></div></div></div>)}</div>;
}
const COND: Record<string, string> = { all: 'Everyone with a phone or email', member: 'Members only', first: 'First visit only', phone: 'Has a WhatsApp number' };
const CH: Record<string, string> = { wa: 'WhatsApp', email: 'Email', both: 'WhatsApp + email' };
function AutoPreview({ v, x, a }: PP & { a: Auto }) {
  const t = templates(x.db).find(t => t.id === v.tpl) ?? templates(x.db)[0];
  const s = autoStats(x.db, v.tpl), q = quietOf(x.db);
  const aud = a.audience(x.db, v);
  const wait = a.id === 'a_thanks' || a.id === 'a_feedback' ? (v.delay ? `${v.delay} h after ${a.id === 'a_thanks' ? 'payment' : 'the rating'}` : 'Send immediately') : a.id === 'a_winback' ? `${v.days} days since last paid order` : `${v.days} days before the birthday`;
  const nodes: [string, string, string, string][] = [['zap', 'Trigger', a.trigger, 'accent'], ['clock', 'Wait', wait + (t.cat === 'MARKETING' && q.on ? ` · quiet hours ${q.from}–${q.to}` : ''), 'warning'], ['filter', 'Condition', COND[v.cond] + (t.cat === 'MARKETING' ? ' · opted in' : ''), 'info'], ['send', 'Send', `${CH[v.ch]} · “${t.name}”`, 'success']];
  return <Stage>
    <div className="row wrap" style={{ gap: 24, justifyContent: 'center', alignItems: 'flex-start', width: '100%' }}>
      <div className="stack" style={{ alignItems: 'center' }}><Badge tone={v.on ? 'success' : 'neutral'} dot>{v.on ? 'On' : 'Off'}</Badge><FlowNodes nodes={nodes} /></div>
      <WaBubble x={x} body={t.body} button={t.button} />
    </div>
    <div className="grid" style={{ ['--min' as string]: '140px', width: '100%' }}>
      <Kpi label="Sent (30 d)" value={s.sent} /><Kpi label="Read" value={pct(s.read, s.sent) + '%'} /><Kpi label="Came back (7 d)" value={s.back} delta={pct(s.back, s.sent) + '% of sent'} /><Kpi label="Revenue attributed" value={idrShort(s.revenue)} /><Kpi label="Matches today" value={aud.length} delta={aud.filter(c => c.optIn).length + ' opted in'} />
    </div>
  </Stage>;
}
function runNow(a: Auto, v: V, x: Ctx) {
  const t = templates(x.db).find(t => t.id === v.tpl)!; const q = quietOf(x.db);
  const aud = a.audience(x.db, v).filter(c => t.cat === 'UTILITY' || c.optIn);
  if (!aud.length) return toast('No guests match right now');
  const hold = t.cat === 'MARKETING' && q.on && inQuiet(Date.now(), q.from, q.to);
  queueMessages(aud.map(c => ({ channel: v.ch === 'email' ? 'email' as const : 'wa' as const, template: t.id, to: v.ch === 'email' ? c.email : c.phone, customerId: c.id, at: hold ? nextOpen(q.to) : undefined })), x.by, !hold);
  toast(hold ? `${aud.length} queued for ${q.to} (quiet hours)` : `${aud.length} message${aud.length > 1 ? 's' : ''} sent`);
}
function autoTool(a: Auto): Tool {
  const tplOpts = (x: Ctx) => templates(x.db).map(t => [t.id, t.name] as [string, string]);
  return { id: a.id, group: 'MESSAGING & AUTOMATION', name: 'Automation: ' + a.name.toLowerCase().replace(/^./, c => c.toUpperCase()), icon: a.icon, desc: a.desc, def: AUTO_DEF[a.id],
    Preview: p => <AutoPreview {...p} a={a} />,
    fields: (v, x) => [F.toggle('Automation on', 'on'),
      ...(a.id === 'a_thanks' ? [F.range('Wait after payment', 'delay', 0, 48, 1, ' h')] : a.id === 'a_feedback' ? [F.range('Wait after visit', 'delay', 0, 24, 1, ' h'), F.seg('Send review link from', 'min', [[4, '4★'], [5, '5★ only']])] : a.id === 'a_winback' ? [F.range('Not visited for', 'days', 14, 30, 1, ' days')] : [F.range('Birthday message', 'days', 0, 14, 1, ' days before')]),
      F.seg('Only if', 'cond', [['all', 'Everyone'], ['member', 'Members'], ['first', 'First visit'], ['phone', 'Has phone']]), F.seg('Send via', 'ch', [['wa', 'WhatsApp'], ['email', 'Email'], ['both', 'Both']]), F.select('Template', 'tpl', tplOpts(x)), F.toggle('Max 1 message per guest per day', 'cap'),
      F.node(<button className="btn btn-block" onClick={() => runNow(a, v, x)}><Icon name="play" size={18} />Run now for matching guests</button>),
      F.note('WABA charges per conversation. Utility messages within 24 h of a visit cost less than marketing.', 'warn')] };
}

function FlowsOverview({ x }: PP) {
  const flows = x.db.records.automation_flow ?? [];
  const live = (id: string) => { const ver = x.db.versions.find(v => v.kind === 'page' && (v.data as V)?.tool === id && v.status === 'published'); return ver ? !!(ver.data as V).values.on : false; };
  return <div className="stack" style={{ width: '100%' }}>
    <div className="grid" style={{ ['--min' as string]: '260px' }}>{AUTOS.map(a => { const s = autoStats(x.db, AUTO_DEF[a.id].tpl); return <button key={a.id} className="card stack sm" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => x.go(AUTO_PATH(a.id))}>
      <div className="row between"><Icon name={a.icon} /><Badge tone={live(a.id) ? 'success' : 'neutral'} dot>{live(a.id) ? 'Live' : 'Not published'}</Badge></div><b>{a.name}</b><span className="muted" style={{ fontSize: 13 }}>{a.desc}</span>
      <span className="faint" style={{ fontSize: 12 }}>{s.sent} sent · {s.back} came back · {idrShort(s.revenue)}</span></button>; })}
      {flows.map(f => <button key={f.id} className="card stack sm" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => x.go(AUTO_PATH('builder'))}>
        <div className="row between"><Icon name="workflow" /><Badge tone={f.c === 'on' ? 'success' : 'neutral'} dot>{f.c === 'on' ? 'On' : 'Off'}</Badge></div><b>{f.a}</b><span className="muted" style={{ fontSize: 13 }}>{(JSON.parse(f.b) as Step[]).length} steps · custom flow</span></button>)}
    </div>
  </div>;
}
let AUTO_PATH = (id: string) => id;
export const setAutoPath = (f: (id: string) => string) => { AUTO_PATH = f; };

// ── Flow builder ─────────────────────────────────────────────────────────────────────────
type Step = { k: 'trigger'; on: string } | { k: 'wait'; h: number } | { k: 'cond'; c: string } | { k: 'send'; ch: string; tpl: string };
const TRIG: Record<string, string> = { paid: 'Payment completed', visit: 'Order completed', idle: 'No visit in 30 days', bday: 'Birthday', rated: 'Rating received', joined: 'Joined membership' };
const NEW_FLOW: Step[] = [{ k: 'trigger', on: 'paid' }, { k: 'wait', h: 2 }, { k: 'cond', c: 'member' }, { k: 'send', ch: 'wa', tpl: 'thanks_visit' }];
function BuilderPanel({ v, set, x }: PP) {
  const flows = x.db.records.automation_flow ?? [];
  const steps: Step[] = v.steps ?? NEW_FLOW;
  const put = (i: number, s: Step) => set('steps', steps.map((y, j) => (j === i ? s : y)));
  const save = () => { const id = v.id ?? 'fl' + Date.now().toString(36); saveRecord('automation_flow', { id, a: v.name || 'Untitled flow', b: JSON.stringify(steps), c: v.on ? 'on' : 'off', d: '', e: '', at: Date.now() }, x.by); set('id', id); toast('Flow saved'); };
  const open = (f: Rec) => { set('id', f.id); set('name', f.a); set('steps', JSON.parse(f.b)); set('on', f.c === 'on'); };
  return <div className="stack">
    {flows.length > 0 && <div className="field"><label>Saved flows</label><div className="row wrap">{flows.map(f => <button key={f.id} className="chip" aria-pressed={v.id === f.id} onClick={() => open(f)}>{f.a}</button>)}<button className="chip" onClick={() => { set('id', undefined); set('name', ''); set('steps', NEW_FLOW); set('on', false); }}>+ New</button></div></div>}
    <div className="field"><label>Flow name</label><input className="input" value={v.name ?? ''} placeholder="e.g. First-visit welcome" onChange={e => set('name', e.target.value)} /></div>
    <label className="row between" style={{ minHeight: 44 }}><span>Flow on</span><Toggle on={!!v.on} onChange={b => set('on', b)} label="Flow on" /></label>
    {steps.map((s, i) => <div key={i} className="sunken stack sm">
      <div className="row between"><span className="cap">{i + 1} · {s.k === 'cond' ? 'Condition' : s.k[0].toUpperCase() + s.k.slice(1)}</span>
        {i > 0 && <div className="row" style={{ gap: 2 }}>
          <button className="btn btn-ghost btn-sm" disabled={i < 2} onClick={() => { const n = [...steps];[n[i - 1], n[i]] = [n[i], n[i - 1]]; set('steps', n); }} aria-label="Move up"><Icon name="arrow-up" size={16} /></button>
          <button className="btn btn-ghost btn-sm" onClick={() => set('steps', steps.filter((_, j) => j !== i))} aria-label="Remove step"><Icon name="x" size={16} /></button></div>}</div>
      {s.k === 'trigger' && <select className="input" value={s.on} onChange={e => put(i, { k: 'trigger', on: e.target.value })}>{Object.entries(TRIG).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>}
      {s.k === 'wait' && <div className="row"><input className="input" type="number" min={0} max={720} value={s.h} onChange={e => put(i, { k: 'wait', h: Number(e.target.value) })} aria-label="Hours" /><span className="none">hours</span></div>}
      {s.k === 'cond' && <select className="input" value={s.c} onChange={e => put(i, { k: 'cond', c: e.target.value })}>{Object.entries(COND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>}
      {s.k === 'send' && <><Seg value={s.ch} options={[['wa', 'WhatsApp'], ['email', 'Email'], ['sms', 'SMS']] as const} onChange={c => put(i, { ...s, ch: c })} />
        <select className="input" value={s.tpl} onChange={e => put(i, { ...s, tpl: e.target.value })}>{templates(x.db).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></>}
    </div>)}
    <div className="row wrap">{([['wait', 'Wait', { k: 'wait', h: 1 }], ['cond', 'Condition', { k: 'cond', c: 'all' }], ['send', 'Send', { k: 'send', ch: 'wa', tpl: 'thanks_visit' }]] as [string, string, Step][]).map(([k, l, s]) => <button key={k} className="btn btn-sm" onClick={() => set('steps', [...steps, s])}><Icon name="plus" size={16} />{l}</button>)}</div>
    <button className="btn btn-primary" onClick={save} disabled={!steps.some(s => s.k === 'send')}>Save flow</button>
    {v.id && <button className="btn btn-ghost btn-sm" onClick={() => { deleteRecord('automation_flow', v.id, x.by); set('id', undefined); set('steps', NEW_FLOW); set('name', ''); }}>Delete flow</button>}
  </div>;
}
function BuilderPreview({ v, x }: PP) {
  const steps: Step[] = v.steps ?? NEW_FLOW;
  const nodes: [string, string, string, string][] = steps.map(s => s.k === 'trigger' ? ['zap', 'Trigger', TRIG[s.on], 'accent'] : s.k === 'wait' ? ['clock', 'Wait', s.h ? `${s.h} hour${s.h > 1 ? 's' : ''}` : 'Immediately', 'warning'] : s.k === 'cond' ? ['filter', 'Condition', COND[s.c], 'info'] : ['send', 'Send', `${CH[s.ch] ?? 'SMS'} · “${tplName(x.db, s.tpl)}”`, 'success']);
  const send = steps.find((s): s is Extract<Step, { k: 'send' }> => s.k === 'send'); const t = send && templates(x.db).find(y => y.id === send.tpl);
  return <Stage><div className="row wrap" style={{ gap: 24, justifyContent: 'center', alignItems: 'flex-start', width: '100%' }}>
    <div className="stack" style={{ alignItems: 'center' }}><b>{v.name || 'Untitled flow'}</b><FlowNodes nodes={nodes} />{!send && <span className="err" style={{ color: 'var(--danger-fg)', fontSize: 13 }}>Add a Send step to save</span>}</div>
    {t && <WaBubble x={x} body={t.body} button={t.button} />}
  </div></Stage>;
}

// ── Consent ──────────────────────────────────────────────────────────────────────────────
function ConsentPreview({ v, x }: PP) {
  const [q, setQ] = useState('');
  const cs = x.db.customers.filter(c => !q || (c.name + c.phone).toLowerCase().includes(q.toLowerCase()));
  const optIn = x.db.customers.filter(c => c.optIn).length;
  const nowQuiet = v.quiet && inQuiet(Date.now(), v.from, v.to);
  return <div className="stack" style={{ width: '100%' }}>
    <div className="grid" style={{ ['--min' as string]: '150px' }}><Kpi label="Opted in to promos" value={`${optIn} / ${x.db.customers.length}`} delta={pct(optIn, x.db.customers.length) + '%'} /><Kpi label="Quiet hours" value={v.quiet ? `${v.from}–${v.to}` : 'Off'} delta={nowQuiet ? 'Active now: marketing waits' : 'Marketing sends now'} tone={nowQuiet ? 'warn' : undefined} /><Kpi label="Opt-out keyword" value={v.stop} /></div>
    <div className="card flat"><div style={{ padding: 12 }}><input className="search" placeholder="Search guests" value={q} onChange={e => setQ(e.target.value)} aria-label="Search guests" /></div><div className="scroll-x"><table className="table">
      <thead><tr><th>Guest</th><th>WhatsApp</th><th>Transactional</th><th>Promos</th></tr></thead>
      <tbody>{cs.map(c => <tr key={c.id}><td>{c.name}</td><td className="mono">{c.phone}</td><td><Badge tone="success">Always</Badge></td><td><Toggle on={c.optIn} onChange={b => setOptIn(c.id, b, x.by)} label={'Promos for ' + c.name} /></td></tr>)}</tbody></table></div></div>
    <p className="faint" style={{ fontSize: 13 }}>Receipts, order-ready and booking messages never need opt-in. Replying {v.stop} turns promos off but keeps receipts.</p>
  </div>;
}

// ── Log ──────────────────────────────────────────────────────────────────────────────────
function LogPreview({ v, x }: PP) {
  const ms = x.db.messages.filter(m => (v.ch ?? 'all') === 'all' || m.channel === v.ch).filter(m => (v.st ?? 'all') === 'all' || m.status === v.st).sort((a, b) => b.at - a.at);
  const all = x.db.messages, n = (s: string) => all.filter(m => m.status === s).length;
  const who = (m: Message) => x.db.customers.find(c => c.id === m.customerId)?.name ?? m.to;
  return <div className="stack" style={{ width: '100%' }}>
    <div className="grid" style={{ ['--min' as string]: '130px' }}>{(['queued', 'sent', 'delivered', 'read', 'failed'] as const).map(s => <Kpi key={s} label={s[0].toUpperCase() + s.slice(1)} value={n(s)} tone={s === 'failed' && n(s) ? 'down' : undefined} />)}</div>
    {ms.length === 0 ? <Empty icon="message-square" title="No messages match">Messages appear here as soon as an automation, a test or a receipt is sent.</Empty> :
      <div className="card flat"><div className="scroll-x"><table className="table">
        <thead><tr><th>Time</th><th>To</th><th>Template</th><th>Channel</th><th>Status</th><th /></tr></thead>
        <tbody>{ms.slice(0, 80).map(m => <tr key={m.id}><td style={{ whiteSpace: 'nowrap' }}>{m.at > Date.now() ? 'at ' + hhmm(m.at) : ago(m.at)}</td><td>{who(m)}</td><td>{tplName(x.db, m.template)}</td><td><Badge>{m.channel.toUpperCase()}</Badge></td><td><Status s={m.status} /></td>
          <td className="r">{m.status === 'failed' && <button className="btn btn-sm" onClick={() => { retryMessage(m.id, x.by); toast('Retrying'); }}>Retry</button>}</td></tr>)}</tbody></table></div></div>}
  </div>;
}

// ── Credits ──────────────────────────────────────────────────────────────────────────────
function creditState(db: DB) {
  const tops = db.records.credit_topup ?? [], month = new Date(); month.setDate(1); month.setHours(0, 0, 0, 0);
  const spent = db.messages.reduce((a, m) => a + costOf(db, m), 0), mth = db.messages.filter(m => m.at >= month.getTime());
  return { tops, balance: tops.reduce((a, t) => a + Number(t.b), 0) - spent, spent, month: mth.reduce((a, m) => a + costOf(db, m), 0), mth };
}
function CreditsPanel({ x }: PP) {
  const [amt, setAmt] = useState('250000');
  const s = creditState(x.db);
  const top = () => { saveRecord('credit_topup', { id: 'ct' + Date.now().toString(36), a: 'Top up', b: amt, c: x.by, d: 'card', e: '', at: Date.now() }, x.by); toast(`Topped up ${idr(+amt)}`); };
  return <div className="stack">
    <Kpi label="Balance" value={idr(s.balance)} tone={s.balance < 50000 ? 'down' : undefined} delta={s.balance < 50000 ? 'Low: messages pause at zero' : undefined} />
    <div className="field"><label>Top up</label><Seg value={amt} options={[['100000', '100k'], ['250000', '250k'], ['1000000', '1 jt']] as const} onChange={setAmt} /></div>
    {x.owner ? <button className="btn btn-primary" onClick={top}>Top up {idr(+amt)}</button> : <p className="faint" style={{ fontSize: 13 }}>Only the owner can add credit. Ask Budi to top up.</p>}
    {s.tops.slice(0, 5).map(t => <span key={t.id} className="row between" style={{ fontSize: 13 }}><span>{dateShort(t.at)} · {x.db.employees.find(e => e.id === t.c)?.name}</span><b>{idr(+t.b)}</b></span>)}
  </div>;
}
function CreditsPreview({ x }: PP) {
  const s = creditState(x.db);
  const rows = Object.values(s.mth.reduce<Record<string, { t: string; ch: string; n: number; c: number }>>((a, m) => { const k = m.template + m.channel; (a[k] ??= { t: tplName(x.db, m.template), ch: m.channel, n: 0, c: 0 }); a[k].n++; a[k].c += costOf(x.db, m); return a; }, {}));
  return <div className="stack" style={{ width: '100%' }}>
    <div className="grid" style={{ ['--min' as string]: '150px' }}><Kpi label="Spent this month" value={idr(s.month)} /><Kpi label="Conversations" value={s.mth.filter(m => m.status !== 'failed').length} /><Kpi label="Balance" value={idr(s.balance)} tone={s.balance < 0 ? 'down' : undefined} /></div>
    {rows.length ? <div className="card flat"><table className="table"><thead><tr><th>Template</th><th>Channel</th><th className="r">Sent</th><th className="r">Cost</th></tr></thead>
      <tbody>{rows.map(r => <tr key={r.t + r.ch}><td>{r.t}</td><td>{r.ch.toUpperCase()}</td><td className="r">{r.n}</td><td className="r">{idr(r.c)}</td></tr>)}</tbody></table></div> : <Empty icon="wallet" title="No messages this month" />}
    <div className="card tight stack sm"><span className="cap">Rate per conversation</span>{[['WhatsApp marketing', RATE.MARKETING], ['WhatsApp utility', RATE.UTILITY], ['SMS', RATE.sms], ['Email', RATE.email], ['Push', 0]].map(([l, r]) => <span key={l} className="row between" style={{ fontSize: 13 }}><span>{l}</span><b>{r ? idr(r as number) : 'Free'}</b></span>)}<span className="faint" style={{ fontSize: 12 }}>Failed messages are not charged. Replies within 24 h are free.</span></div>
  </div>;
}

// ── Email sender domain (DNS checked live over DNS-over-HTTPS) ──────────────────────────
type Dns = Record<string, 'ok' | 'missing' | 'checking' | 'error'>;
async function lookup(name: string, type: 'TXT' | 'CNAME') { const r = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(name)}&type=${type}`); const j = await r.json() as { Answer?: { data: string }[] }; return (j.Answer ?? []).map(a => a.data.replace(/"/g, '')); }
export function dnsRecords(domain: string) {
  return [['SPF', 'TXT', domain, 'v=spf1 include:mail.bornis.id ~all', (a: string[]) => a.some(s => s.includes('include:mail.bornis.id'))],
    ['DKIM', 'CNAME', 'bn1._domainkey.' + domain, 'dkim1.bornis.id', (a: string[]) => a.some(s => s.startsWith('dkim1.bornis.id'))],
    ['DMARC', 'TXT', '_dmarc.' + domain, 'v=DMARC1; p=none', (a: string[]) => a.some(s => s.startsWith('v=DMARC1'))]] as const;
}
function EmailDomainPanel({ v, set }: PP) {
  const domain = String(v.addr).split('@')[1] || '';
  const [st, setSt] = useState<Dns>({});
  const verify = async () => {
    for (const [k, type, name, , ok] of dnsRecords(domain)) {
      setSt(s => ({ ...s, [k]: 'checking' }));
      try { const a = await lookup(name, type); setSt(s => ({ ...s, [k]: ok(a) ? 'ok' : 'missing' })); } catch { setSt(s => ({ ...s, [k]: 'error' })); }
    }
  };
  return <div className="stack">
    <IntegrationsPanel kinds={['email']} />
    <div className="field"><label>From name</label><input className="input" value={v.from} onChange={e => set('from', e.target.value)} /></div>
    <div className="field"><label>From address</label><input className="input" value={v.addr} onChange={e => set('addr', e.target.value)} type="email" /></div>
    <span className="cap">DNS records to add at your domain provider</span>
    {domain ? dnsRecords(domain).map(([k, type, name, val]) => <div key={k} className="sunken stack sm">
      <div className="row between"><b>{k} · {type}</b>{st[k] && <Badge tone={st[k] === 'ok' ? 'success' : st[k] === 'checking' ? 'neutral' : 'danger'}>{st[k] === 'ok' ? 'Verified' : st[k] === 'checking' ? 'Checking…' : st[k] === 'error' ? 'Couldn’t check' : 'Not found'}</Badge>}</div>
      <CopyRow label="Name" value={name} /><CopyRow label="Value" value={val} /></div>) : <span className="err" style={{ color: 'var(--danger-fg)' }}>Enter an address on your own domain</span>}
    <button className="btn" onClick={verify} disabled={!domain}><Icon name="refresh-cw" size={16} />Verify DNS</button>
    <p className="faint" style={{ fontSize: 13 }}>Usually live within an hour. Until SPF and DKIM pass, mail goes from no-reply@bornis.id.</p>
  </div>;
}
function EmailDomainPreview({ v, x }: PP) {
  const t = templates(x.db).find(t => t.id === 'e_receipt')!;
  return <Stage><EmailPreview x={x} subject={`E-receipt · ${x.db.theme.name}`} body={t.body} button={t.button} from={`${v.from} <${v.addr}>`} /><Caption>Real e-receipt from the latest member order. Replies go to {v.addr}.</Caption></Stage>;
}

// ── Performance ──────────────────────────────────────────────────────────────────────────
function PerfPreview({ v, x }: PP) {
  const w = Number(v.win ?? 7);
  const rows = useMemo(() => templates(x.db).map(t => ({ t, ...autoStats(x.db, t.id, w) })).filter(r => r.sent), [x.db, w]);
  const tot = rows.reduce((a, r) => ({ sent: a.sent + r.sent, back: a.back + r.back, revenue: a.revenue + r.revenue, read: a.read + r.read }), { sent: 0, back: 0, revenue: 0, read: 0 });
  const days = Array.from({ length: 14 }, (_, i) => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime() - (13 - i) * DAY; });
  const series = useMemo(() => [{ label: 'Messages', data: days.map(d => x.db.messages.filter(m => m.at >= d && m.at < d + DAY).length) }], [x.db.messages]);
  return <div className="stack" style={{ width: '100%' }}>
    <div className="grid" style={{ ['--min' as string]: '150px' }}><Kpi label="Messages (30 d)" value={tot.sent} /><Kpi label="Read rate" value={pct(tot.read, tot.sent) + '%'} /><Kpi label={`Return visits (${w} d)`} value={tot.back} delta={pct(tot.back, tot.sent) + '% of messaged'} tone="up" /><Kpi label="Revenue attributed" value={idrShort(tot.revenue)} /></div>
    <div className="card"><span className="cap">Messages per day</span><LineChart labels={days.map(d => dateShort(d))} series={series} height={180} kind="bar" /></div>
    {rows.length ? <div className="card flat"><div className="scroll-x"><table className="table"><thead><tr><th>Template</th><th className="r">Sent</th><th className="r">Read</th><th className="r">Came back</th><th className="r">Revenue</th></tr></thead>
      <tbody>{rows.map(r => <tr key={r.t.id}><td>{r.t.name}</td><td className="r">{r.sent}</td><td className="r">{pct(r.read, r.sent)}%</td><td className="r">{r.back}</td><td className="r">{idr(r.revenue)}</td></tr>)}</tbody></table></div></div>
      : <Empty icon="chart-no-axes-column" title="No messages in the last 30 days">Turn on an automation to start measuring return visits.</Empty>}
    <p className="faint" style={{ fontSize: 13 }}>Attribution: a paid order by the same guest within {w} days after the message, at any outlet ({x.db.outlets.map(o => outletName(x.db, o.id)).join(', ')}).</p>
  </div>;
}

export const MESSAGING: Tool[] = [
  { id: 'waba', group: 'MESSAGING & AUTOMATION', name: 'WhatsApp Business connection', icon: 'message-circle', desc: 'Connect and verify the WhatsApp Business (WABA) number your receipts, order-ready messages and automations send from.', Panel: WabaPanel, Preview: WabaPreview },
  { id: 'templates', group: 'MESSAGING & AUTOMATION', name: 'Message templates', icon: 'files', desc: 'Every WhatsApp template with its Meta approval status. Templates must be approved before they can send.', Panel: TemplatesPanel, Preview: TemplatesList },
  { id: 'msg', group: 'MESSAGING & AUTOMATION', name: 'WA, email & SMS template editor', icon: 'message-square-text', desc: 'Write once, send on WhatsApp Business, email or SMS. WhatsApp templates are submitted to Meta for approval.', Panel: EditorPanel, Preview: EditorPreview },
  { id: 'flows', group: 'MESSAGING & AUTOMATION', name: 'Automations', icon: 'workflow', desc: 'Sends the right message after the right moment, like a thank-you on WhatsApp after a guest pays.', Preview: FlowsOverview },
  ...AUTOS.map(autoTool),
  { id: 'builder', group: 'MESSAGING & AUTOMATION', name: 'Automation flow builder', icon: 'git-branch-plus', desc: 'Build your own flow: trigger → wait → condition → send.', Panel: BuilderPanel, Preview: BuilderPreview },
  { id: 'optin', group: 'MESSAGING & AUTOMATION', name: 'Opt-in & consent', icon: 'shield-check', desc: 'Who may receive promos, quiet hours for marketing, and how guests unsubscribe.', def: { ...TOOL_DEFAULTS.optin }, Preview: ConsentPreview,
    fields: () => [F.toggle('Quiet hours for marketing', 'quiet'), F.text('From', 'from', '21:00'), F.text('Until', 'to', '08:00'), F.text('Opt-out keyword', 'stop'), F.toggle('Ask for opt-in at checkout (unticked by default)', 'checkout'), F.toggle('Unsubscribe link in every email', 'footer'), F.note('Transactional messages (receipt, order ready, booking) send any time and never need opt-in.')] },
  { id: 'log', group: 'MESSAGING & AUTOMATION', name: 'Message log & delivery status', icon: 'scroll-text', desc: 'Every message sent: queued, sent, delivered, read or failed. Retry failed ones.', Preview: LogPreview,
    Panel: ({ v, set }) => <div className="stack"><div className="field"><label>Channel</label><Seg value={v.ch ?? 'all'} options={[['all', 'All'], ['wa', 'WA'], ['email', 'Email'], ['sms', 'SMS']] as const} onChange={c => set('ch', c)} /></div>
      <div className="field"><label>Status</label><select className="input" value={v.st ?? 'all'} onChange={e => set('st', e.target.value)}>{['all', 'queued', 'sent', 'delivered', 'read', 'failed'].map(s => <option key={s} value={s}>{s === 'all' ? 'All statuses' : s}</option>)}</select></div></div> },
  { id: 'credits', group: 'MESSAGING & AUTOMATION', name: 'Messaging credits & cost', icon: 'wallet', desc: 'Prepaid credit for WhatsApp, SMS and email, and what each conversation costs.', Panel: CreditsPanel, Preview: CreditsPreview },
  { id: 'emaild', group: 'MESSAGING & AUTOMATION', name: 'Email sender domain', icon: 'at-sign', desc: 'Send receipts and campaigns from your own address instead of no-reply@bornis.id.', def: { ...TOOL_DEFAULTS.emaild }, Panel: EmailDomainPanel, Preview: EmailDomainPreview },
  { id: 'perf', group: 'MESSAGING & AUTOMATION', name: 'Automation performance', icon: 'trending-up', desc: 'Return visits and revenue from guests after they got a message.', Preview: PerfPreview,
    Panel: ({ v, set }) => <div className="field"><label>Attribution window</label><Seg value={String(v.win ?? 7)} options={[['3', '3 days'], ['7', '7 days'], ['14', '14 days']] as const} onChange={w => set('win', Number(w))} /></div> },
];
