'use client';
// Super admin services. The platform tables (tenants, invoices, tickets, flags, releases, domains) live in the generic
// records table until they get their own; Kopi Biru is the one real tenant in this store, so its plan and outlet count
// are read from db.tenant / db.outlets and plan changes write through to db.tenant.
import { commit, snapshot, uid } from '../store.ts';
import type { DB, Rec } from '../schema.ts';
import { requestApproval } from '../actions.ts';
import { REMOTE } from '../remote.ts';
import { PLANS } from '../../screens/public/plans.ts';
import { toast } from '../../ui/kit.tsx';

const DAY = 864e5, ADMIN = 'admin';
const month = (t: number, back: number) => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth() - back, 1).getTime(); };
const ym = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };

/** Tenant row: a name · b plan · c outlets · d status · e JSON meta · at signed up. */
export interface TenantMeta { owner: string; email: string; city: string; custom?: number; wl?: boolean; appName?: string; theme?: string; churnedAt?: number; trialEnds?: number; source?: string; slug?: string; domain?: string }
export const PLAN_PRICE: Record<string, number> = Object.fromEntries(PLANS.map(p => [p.id, p.monthly ?? 0]));
export const PPN_BPS = 1100;

/** First open of the console: seed the demo platform around the real tenant in one commit. */
export function ensurePlatform() {
  const d0 = snapshot();
  if (d0.records.tenant) return;
  if (REMOTE) return void loadPlatform();
  const now = Date.now(), owner = d0.employees.find(e => e.role === 'owner');
  const T = (id: string, a: string, b: string, c: number, dd: string, monthsAgo: number, m: TenantMeta): Rec => ({ id, a, b, c: String(c), d: dd, e: JSON.stringify(m), at: month(now, monthsAgo) + 9 * DAY });
  const tenants: Rec[] = [
    T(d0.tenant.id, d0.tenant.name, d0.tenant.plan, d0.outlets.length, 'active', 19, { owner: owner?.name ?? 'Owner', email: 'budi@kopibiru.id', city: d0.outlets[0]?.city ?? '', theme: d0.theme.name, source: 'Instagram ad' }),
    T('baragrill', 'Bara Grill', 'pro', 2, 'active', 14, { owner: 'Rudi Hartono', email: 'rudi@baragrill.co.id', city: 'Bandung', theme: 'Bara Grill', wl: true, appName: 'Bara Grill Club', source: 'Referral' }),
    T('sakura', 'Sakura Bakery', 'basic', 1, 'past_due', 11, { owner: 'Lina Wijaya', email: 'lina@sakurabakery.id', city: 'Surabaya', theme: 'Sakura Bakery', source: 'Google search' }),
    T('pasarrasa', 'Pasar Rasa Group', 'enterprise', 18, 'active', 13, { owner: 'Agus Salim', email: 'it@pasarrasa.com', city: 'Jakarta Pusat', custom: 9_800_000, wl: true, appName: 'Pasar Rasa', source: 'Sales' }),
    T('warunghijau', 'Warung Hijau', 'free', 1, 'trial', 0, { owner: 'Siti Rahma', email: 'siti@warunghijau.id', city: 'Depok', theme: 'Warung Hijau', trialEnds: now + 9 * DAY, source: 'TikTok' }),
    T('bersihkilat', 'Bersih Kilat', 'basic', 2, 'churn_risk', 8, { owner: 'Dodi Pratama', email: 'dodi@bersihkilat.id', city: 'Bekasi', source: 'Partner' }),
    T('dapurnenek', 'Dapur Nenek', 'pro', 1, 'active', 3, { owner: 'Ratna Sari', email: 'ratna@dapurnenek.id', city: 'Jakarta Barat', source: 'Instagram ad' }),
    T('rotihangat', 'Roti Hangat', 'basic', 3, 'active', 8, { owner: 'Fajar Nugroho', email: 'fajar@rotihangat.id', city: 'Bogor', source: 'Google search' }),
    T('tehmanis', 'Teh Manis Corner', 'basic', 1, 'churned', 10, { owner: 'Wawan Setiadi', email: 'wawan@tehmanis.id', city: 'Tangerang', churnedAt: month(now, 0) + 2 * DAY, source: 'TikTok' }),
    T('satepakamat', 'Sate Pak Amat', 'free', 1, 'active', 5, { owner: 'Amat Sobari', email: 'amat@satepakamat.id', city: 'Jakarta Timur', source: 'WhatsApp' }),
  ];
  const methods = ['QRIS', 'VA BCA', 'Bank transfer', 'Card', 'QRIS'];
  const invoices: Rec[] = [];
  tenants.forEach((t, i) => {
    const m = JSON.parse(t.e) as TenantMeta, base = t.b === 'enterprise' ? m.custom ?? 0 : PLAN_PRICE[t.b] * Number(t.c);
    if (!base) return;
    for (let back = 2; back >= 0; back--) {
      const at = month(now, back) + DAY; if (at < t.at || (m.churnedAt && at > m.churnedAt)) continue;
      const status = back > 0 ? 'paid' : t.d === 'past_due' ? 'past_due' : t.d === 'churn_risk' ? 'failed' : 'paid';
      invoices.push({ id: uid('inv'), a: t.id, b: ym(at), c: String(base + Math.round(base * PPN_BPS / 10000)), d: status, e: methods[i % methods.length], at });
    }
  });
  const ticket = (no: number, subject: string, tenant: string, prio: string, status: string, minsAgo: number, who = ''): Rec => ({ id: 'TK-' + no, a: subject, b: tenant, c: prio, d: status, e: who, at: now - minsAgo * 60e3 });
  const tickets = [ticket(5521, 'Printer not printing kitchen tickets', 'baragrill', 'urgent', 'open', 18), ticket(5518, 'QRIS settlement missing for 9 Oct', d0.tenant.id, 'high', 'open', 95),
    ticket(5502, 'How to add a second outlet', 'warunghijau', 'low', 'waiting', 300, 'cs@bornis.id'), ticket(5497, 'GoFood menu not syncing', 'sakura', 'high', 'open', 160), ticket(5480, 'Request data export', 'bersihkilat', 'normal', 'solved', 2900, 'ops@bornis.id')];
  const flag = (key: string, pct: number, team: string, on: boolean, desc: string): Rec => ({ id: key, a: key, b: String(pct), c: team, d: on ? 'on' : 'off', e: desc, at: now - 6 * DAY });
  const flags = [flag('kds_v2_layout', 40, 'Kitchen team', true, 'New kitchen ticket layout with delivery lane'), flag('waba_automations', 100, 'Growth', true, 'WhatsApp thank-you and win-back automations (Pro and up)'),
    flag('page_builder_freeform', 15, 'Studios', true, 'Free-form blocks in the page builder'), flag('offline_mode_v3', 5, 'POS core', true, 'Offline queue v3, beta list only'), flag('split_bill_phone', 0, 'Self-order', false, 'Guests split the bill on their phones')];
  const rel = (v: string, status: string, notes: string, pct: number, daysAgo: number): Rec => ({ id: 'rel-' + v, a: v, b: status, c: notes, d: String(pct), e: '', at: now - daysAgo * DAY });
  const releases = [rel('4.12.0', 'rolling', 'Kitchen lanes for delivery orders, busy mode', 40, 1), rel('4.11.2', 'shipped', 'QRIS expiry fix, receipt logo sizing', 100, 6), rel('4.11.0', 'shipped', 'Opname with photos, two-person sign-off', 100, 15), rel('4.13.0', 'scheduled', 'Split bill on the guest’s phone', 0, -7)];
  const dom = (host: string, tenant: string, status: string, checkedHoursAgo: number): Rec => ({ id: uid('dm'), a: host, b: tenant, c: status, d: 'borniz-verify=' + uid().slice(0, 10), e: String(now - checkedHoursAgo * 3600e3), at: now - 20 * DAY });
  const domains = [dom('order.kopibiru.id', d0.tenant.id, 'verified', 30), dom('menu.baragrill.co.id', 'baragrill', 'pending', 2), dom('pasarrasa.com', 'pasarrasa', 'failed', 5)];
  commit('platform.seeded', 'system', d => { Object.assign(d.records, { tenant: tenants, invoice: invoices, ticket: tickets, flag: flags, release: releases, domain: domains }); });
}

/** Live: the real businesses from the platform registry, the console's own records (invoices, tickets, flags, releases,
 *  platform settings, notes on a business) and its audit, all from the server (BorNiz staff only). */
let loading = false;
async function loadPlatform() {
  if (loading) return; loading = true;
  try {
    const s = await import('../backend.ts');
    const [ts, recs, audit] = await Promise.all([s.adminTenants(), s.adminRecords(), s.adminAudit()]);
    const notes = new Map(recs.filter(r => r.kind === 'tenant').map(r => [r.id, r.data as Partial<TenantMeta>]));
    const rows = ts.map((t): Rec => ({ id: t.id, a: t.name, b: t.plan, c: String(t.outlets),
      d: t.status === 'suspended' ? 'suspended' : t.trialUntil && t.trialUntil > Date.now() ? 'trial' : 'active',
      e: JSON.stringify({ ...notes.get(t.id), owner: t.owner ?? '', email: t.owner ?? '', city: t.city ?? '', slug: t.slug, domain: t.domain ?? '', ...(t.trialUntil ? { trialEnds: t.trialUntil } : {}) } satisfies TenantMeta), at: t.createdAt }));
    const of = (k: string) => recs.filter(r => r.kind === k).map(r => r.data as unknown as Rec);
    commit('platform.loaded', ADMIN, d => {
      Object.assign(d.records, { tenant: rows, invoice: of('invoice'), ticket: of('ticket'), flag: of('flag'), release: of('release'), domain: [] });
      for (const r of recs) if (r.kind === 'setting') d.settings[r.id] = (r.data as { value: string | number | boolean }).value;
      d.audit = audit.map(a => ({ id: 'pa' + a.id, actor: a.actor, action: a.action, subject: a.subject ?? '', at: a.at }));
    });
  } catch (e) { toast((e as Error).message); }
  finally { loading = false; }
}
/** Live: the change goes to the server too; a refusal there is shown and the console reloads what the server holds. */
function remote(job: (s: typeof import('../backend.ts')) => Promise<unknown>) {
  if (!REMOTE) return;
  void import('../backend.ts').then(job).catch(e => { toast('Not saved: ' + (e as Error).message); void loadPlatform(); });
}
const PLATFORM_KINDS = ['invoice', 'ticket', 'flag', 'release'];

/** Plan change. For the real tenant it changes the tenant's plan everywhere in the product. */
/** Resolves true once the plan is saved (live: on the server first). */
export async function setTenantPlan(tenantId: string, plan: DB['tenant']['plan'], by = ADMIN): Promise<boolean> {
  if (REMOTE) {
    try { await (await import('../backend.ts')).adminSetPlan(tenantId, plan); } catch (e) { toast('Plan not saved: ' + (e as Error).message); return false; }
  }
  setLocalPlan(tenantId, plan, by);
  return true;
}
function setLocalPlan(tenantId: string, plan: DB['tenant']['plan'], by: string) {
  commit('tenant.plan_changed', by, d => {
    const t = d.records.tenant?.find(x => x.id === tenantId); if (t) t.b = plan;
    if (d.tenant.id === tenantId) d.tenant.plan = plan;
  }, `${tenantId} → ${plan}`);
}
export function patchRecord(object: string, id: string, patch: Partial<Rec>, action: string, by = ADMIN) {
  const before = snapshot().records[object]?.find(x => x.id === id);
  commit(action, by, d => { const r = d.records[object]?.find(x => x.id === id); if (r) Object.assign(r, patch); }, id);
  const after = snapshot().records[object]?.find(x => x.id === id);
  if (!after) return;
  if (object === 'tenant') { // a business: status and trial in the registry, the rest as notes on it
    if (patch.d && patch.d !== before?.d) remote(s => s.adminSetStatus(id, patch.d === 'suspended' ? 'suspended' : 'active', action));
    if (patch.e) {
      const was = JSON.parse(before?.e || '{}') as TenantMeta, now = JSON.parse(after.e || '{}') as TenantMeta;
      if (now.trialEnds && now.trialEnds !== was.trialEnds) remote(s => s.adminSetTrial(id, now.trialEnds!));
      const { custom, wl, appName, theme, churnedAt, source } = now;
      remote(s => s.adminPut('tenant', id, { custom, wl, appName, theme, churnedAt, source }, action, after.a));
    }
  } else if (PLATFORM_KINDS.includes(object)) remote(s => s.adminPut(object, id, after, action, after.a));
}
/** A whole platform record (a flag, a release) saved from the console. */
export function saveAdminRecord(object: string, row: Rec, by: string) {
  commit(object + '.saved', by, d => { const l = d.records[object] ?? (d.records[object] = []); const i = l.findIndex(x => x.id === row.id); if (i >= 0) l[i] = row; else l.unshift(row); }, row.a);
  if (PLATFORM_KINDS.includes(object)) remote(s => s.adminPut(object, row.id, row, object + '.saved', row.a));
}
/** A platform setting (plan prices, the default theme for new businesses). */
export function setPlatformSetting(key: string, value: string | number | boolean, by: string) {
  commit('setting.changed', by, d => { d.settings[key] = value; }, key);
  remote(s => s.adminPut('setting', key, { value }, 'setting.changed', `${key} = ${value}`));
}
/** Actions that change nothing in this store but must be in the audit log (reminders sent, exports). */
export function logAdmin(action: string, subject: string, by = ADMIN) {
  commit(action, by, () => {}, subject);
  remote(s => s.adminNote(action, subject));
}

/** Time-boxed support access. The tenant's owner approves it with their approval PIN; for tenants outside this store
 *  the request waits on their side. */
export function requestSupportAccess(tenantId: string, hours: number, reason: string, ticketId?: string) {
  const d0 = snapshot();
  if (REMOTE) { // the request lands in the business; the owner grants it there with their approval PIN
    void import('../backend.ts').then(s => s.adminRequestAccess(tenantId, hours, reason, ticketId)).then(() => loadSupport(tenantId)).catch(e => toast('Not sent: ' + (e as Error).message));
    return '';
  }
  if (tenantId === d0.tenant.id) {
    return requestApproval({ type: 'perm', title: `BorNiz support access · ${hours} h · ${reason}`, requestedBy: ADMIN, outletId: d0.outlets[0].id, note: ticketId ? `Ticket ${ticketId}` : reason, payload: { kind: 'support_access', tenantId, hours, ticketId } }).id;
  }
  const id = uid('acc');
  commit('support_access.requested', ADMIN, d => { (d.records.access ??= []).unshift({ id, a: tenantId, b: String(hours), c: reason, d: 'requested', e: ticketId ?? '', at: Date.now() }); }, tenantId);
  return id;
}
/** Live: where the latest request to this business stands (read from the business's own database). */
export async function loadSupport(tenantId: string) {
  const a = await (await import('../backend.ts')).adminSupportState(tenantId);
  commit('support_access.checked', ADMIN, d => {
    const l = (d.records.access ?? []).filter(r => r.a !== tenantId);
    if (a.id) l.unshift({ id: a.id, a: tenantId, b: String(a.hours ?? ''), c: '', d: a.state, e: String(a.until ?? ''), at: a.at ?? Date.now() });
    d.records.access = l;
  }, tenantId);
}
export function endSupportAccess(approvalOrRecordId: string, tenantId?: string) {
  if (REMOTE && tenantId) void import('../backend.ts').then(s => s.adminSupportEnd(tenantId, approvalOrRecordId)).then(() => loadSupport(tenantId)).catch(e => toast((e as Error).message));
  commit('support_access.ended', ADMIN, d => {
    const l = d.records.access ??= [];
    const r = l.find(x => x.id === approvalOrRecordId);
    if (r) r.d = 'ended'; else l.unshift({ id: approvalOrRecordId, a: '', b: '', c: '', d: 'ended', e: '', at: Date.now() });
  }, approvalOrRecordId);
}
