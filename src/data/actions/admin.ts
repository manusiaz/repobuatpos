'use client';
// Super admin services. The platform tables (tenants, invoices, tickets, flags, releases, domains) live in the generic
// records table until they get their own; Kopi Biru is the one real tenant in this store, so its plan and outlet count
// are read from db.tenant / db.outlets and plan changes write through to db.tenant.
import { commit, snapshot, uid } from '../store.ts';
import type { DB, Rec } from '../schema.ts';
import { requestApproval } from '../actions.ts';
import { REMOTE } from '../remote.ts';
import { toast } from '../../ui/kit.tsx';

const DAY = 864e5, ADMIN = 'admin';
const month = (t: number, back: number) => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth() - back, 1).getTime(); };
const ym = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };

/** Tenant row: a name · b plan · c outlets · d status · e JSON meta · at signed up. */
export interface TenantMeta { owner: string; email: string; city: string; custom?: number; wl?: boolean; appName?: string; theme?: string; churnedAt?: number; trialEnds?: number; source?: string; slug?: string; domain?: string }
export const PLAN_PRICE: Record<string, number> = { free: 0, basic: 149_000, pro: 349_000, enterprise: 0 };
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

/** Live: the real businesses from the platform registry (BorNiz staff only). Billing, tickets, flags, releases and
 *  domains have no server tables yet, so they start empty instead of showing demo rows. Kept on this browser only. */
let loading = false;
async function loadPlatform() {
  if (loading) return; loading = true;
  try {
    const { adminTenants } = await import('../backend.ts');
    const rows = (await adminTenants()).map((t): Rec => ({ id: t.id, a: t.name, b: t.plan, c: String(t.outlets), d: 'active',
      e: JSON.stringify({ owner: t.owner ?? '', email: t.owner ?? '', city: t.city ?? '', slug: t.slug, domain: t.domain ?? '' } satisfies TenantMeta), at: t.createdAt }));
    commit('platform.loaded', ADMIN, d => { Object.assign(d.records, { tenant: rows, invoice: [], ticket: [], flag: [], release: [], domain: [] }); });
  } catch (e) { toast((e as Error).message); }
  finally { loading = false; }
}

/** Plan change. For the real tenant it changes the tenant's plan everywhere in the product. */
export function setTenantPlan(tenantId: string, plan: DB['tenant']['plan'], by = ADMIN) {
  if (REMOTE) return void import('../backend.ts').then(s => s.adminSetPlan(tenantId, plan)).then(() => setLocalPlan(tenantId, plan, by)).catch(e => toast('Plan not saved: ' + (e as Error).message));
  setLocalPlan(tenantId, plan, by);
}
function setLocalPlan(tenantId: string, plan: DB['tenant']['plan'], by: string) {
  commit('tenant.plan_changed', by, d => {
    const t = d.records.tenant?.find(x => x.id === tenantId); if (t) t.b = plan;
    if (d.tenant.id === tenantId) d.tenant.plan = plan;
  }, `${tenantId} → ${plan}`);
}
export function patchRecord(object: string, id: string, patch: Partial<Rec>, action: string, by = ADMIN) {
  commit(action, by, d => { const r = d.records[object]?.find(x => x.id === id); if (r) Object.assign(r, patch); }, id);
}
/** Actions that change nothing in this store but must be in the audit log (reminders sent, exports). */
export const logAdmin = (action: string, subject: string, by = ADMIN) => commit(action, by, () => {}, subject);

/** Time-boxed support access. The tenant's owner approves it with their approval PIN; for tenants outside this store
 *  the request waits on their side. */
export function requestSupportAccess(tenantId: string, hours: number, reason: string, ticketId?: string) {
  const d0 = snapshot();
  if (tenantId === d0.tenant.id) {
    return requestApproval({ type: 'perm', title: `BorNiz support access · ${hours} h · ${reason}`, requestedBy: ADMIN, outletId: d0.outlets[0].id, note: ticketId ? `Ticket ${ticketId}` : reason, payload: { kind: 'support_access', tenantId, hours, ticketId } }).id;
  }
  const id = uid('acc');
  commit('support_access.requested', ADMIN, d => { (d.records.access ??= []).unshift({ id, a: tenantId, b: String(hours), c: reason, d: 'requested', e: ticketId ?? '', at: Date.now() }); }, tenantId);
  return id;
}
export function endSupportAccess(approvalOrRecordId: string) {
  commit('support_access.ended', ADMIN, d => {
    const l = d.records.access ??= [];
    const r = l.find(x => x.id === approvalOrRecordId);
    if (r) r.d = 'ended'; else l.unshift({ id: approvalOrRecordId, a: '', b: '', c: '', d: 'ended', e: '', at: Date.now() });
  }, approvalOrRecordId);
}
