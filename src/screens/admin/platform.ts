// Platform numbers for the super admin console, derived from the tenant / invoice records (never stored).
import type { Approval, DB, Rec } from '../../data/schema.ts';
import { PLAN_PRICE, PPN_BPS, type TenantMeta } from '../../data/actions/admin.ts';
import { toolValue, whiteLabel } from '../../system/tools.ts';
import { priceKey } from '../public/plans.ts';
export { priceKey };

export type Plan = DB['tenant']['plan'];
/** Plans from spec/bn-pm.js: SaaS per outlet. Price overrides are platform settings. */
export const PLANS: { id: Plan; name: string; limits: string }[] = [
  { id: 'free', name: 'Free', limits: '1 outlet · 1 register' }, { id: 'basic', name: 'Basic', limits: '3 registers per outlet' },
  { id: 'pro', name: 'Pro', limits: 'Multi-outlet · KDS · studios' }, { id: 'enterprise', name: 'Enterprise', limits: 'Unlimited · API · SSO · white-label' },
];
export const planPrice = (db: DB, plan: string) => { const v = Number(db.settings[priceKey(plan)]); return v > 0 || db.settings[priceKey(plan)] === 0 ? v : PLAN_PRICE[plan] ?? 0; };
export const planName = (plan: string) => PLANS.find(p => p.id === plan)?.name ?? plan;

export type TenantStatus = 'active' | 'trial' | 'past_due' | 'churn_risk' | 'suspended' | 'churned';
export interface Tenant { id: string; name: string; plan: Plan; outlets: number; status: TenantStatus; meta: TenantMeta; signedUp: number; real: boolean; mrr: number }
const parse = (s: string): TenantMeta => { try { return JSON.parse(s) as TenantMeta; } catch { return { owner: '', email: '', city: '' }; } };
const PAYING: TenantStatus[] = ['active', 'past_due', 'churn_risk'];

export function tenants(db: DB): Tenant[] {
  return (db.records.tenant ?? []).map((r: Rec) => {
    const real = r.id === db.tenant.id, meta = parse(r.e);
    const plan = (real ? db.tenant.plan : r.b) as Plan, outlets = real ? db.outlets.length : Number(r.c) || 0, status = r.d as TenantStatus;
    const base = plan === 'enterprise' ? meta.custom ?? 0 : planPrice(db, plan) * outlets;
    const wl = real ? whiteLabel(db) : null; // the tenant's published white-label app (Studios, Enterprise)
    return { id: r.id, name: real ? db.tenant.name : r.a, plan, outlets, status, meta: real ? { ...meta, slug: db.tenant.id, domain: String(toolValue(db, 'domain', 'enterprise').menu ?? ''), theme: db.theme.name, ...(wl ? { wl: true, appName: wl.name } : {}) } : meta, signedUp: r.at, real, mrr: PAYING.includes(status) ? base : 0 };
  });
}
export const withTax = (n: number) => n + Math.round((n * PPN_BPS) / 10000);
export const STATUS_TONE: Record<string, 'success' | 'warning' | 'danger' | 'violet' | 'neutral' | 'info'> = {
  active: 'success', trial: 'violet', past_due: 'warning', churn_risk: 'danger', suspended: 'danger', churned: 'neutral',
  paid: 'success', failed: 'danger', retry_scheduled: 'info', void: 'neutral', open: 'warning', waiting: 'info', solved: 'success',
  verified: 'success', pending: 'warning', urgent: 'danger', high: 'warning', normal: 'neutral', low: 'neutral', shipped: 'success', rolling: 'info', scheduled: 'violet', on: 'success', off: 'neutral',
};

const monthStart = (t: number, back = 0) => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth() - back, 1).getTime(); };
/** MRR at the end of each of the last n months, from sign-up and churn dates with today's plans. The current month is live. */
export function mrrHistory(db: DB, n = 12, now = Date.now()) {
  const ts = tenants(db);
  return Array.from({ length: n }, (_, i) => {
    const back = n - 1 - i, from = monthStart(now, back), end = back === 0 ? now : monthStart(now, back - 1);
    const value = back === 0 ? ts.reduce((a, t) => a + t.mrr, 0)
      : ts.filter(t => t.signedUp < end && (!t.meta.churnedAt || t.meta.churnedAt >= end) && t.status !== 'trial')
        .reduce((a, t) => a + (t.plan === 'enterprise' ? t.meta.custom ?? 0 : planPrice(db, t.plan) * t.outlets), 0);
    return { label: new Date(from).toLocaleDateString('en-GB', { month: 'short' }), value };
  });
}
/** Logo churn this month: tenants lost this month ÷ paying tenants at the start of the month. */
export function churn(db: DB, now = Date.now()) {
  const ts = tenants(db), m0 = monthStart(now);
  const lost = ts.filter(t => t.meta.churnedAt && t.meta.churnedAt >= m0).length;
  const base = ts.filter(t => t.signedUp < m0 && t.plan !== 'free' && (!t.meta.churnedAt || t.meta.churnedAt >= m0)).length;
  return { lost, base, rate: base ? lost / base : 0 };
}

/** Support access state for a tenant: the owner's decision on the real tenant, records for the others. */
export function accessOf(db: DB, tenantId: string, now = Date.now()): { state: 'none' | 'requested' | 'active' | 'expired' | 'denied' | 'ended'; until?: number; id?: string; hours?: number; at?: number } {
  const ended = new Set((db.records.access ?? []).filter(r => r.d === 'ended').map(r => r.id));
  const ap = db.approvals.filter((a: Approval) => a.type === 'perm' && (a.payload as { kind?: string; tenantId?: string } | undefined)?.kind === 'support_access' && (a.payload as { tenantId?: string }).tenantId === tenantId).sort((a, b) => b.at - a.at)[0];
  const rec = (db.records.access ?? []).filter(r => r.a === tenantId).sort((a, b) => b.at - a.at)[0];
  if (ap && (!rec || ap.at >= rec.at)) {
    const hours = Number((ap.payload as { hours?: number }).hours) || 2;
    if (ended.has(ap.id)) return { state: 'ended', id: ap.id, hours, at: ap.at };
    if (ap.status === 'waiting') return { state: 'requested', id: ap.id, hours, at: ap.at };
    if (ap.status !== 'approved') return { state: 'denied', id: ap.id, hours, at: ap.at };
    const until = (ap.decidedAt ?? ap.at) + hours * 3600e3;
    return { state: until > now ? 'active' : 'expired', until, id: ap.id, hours, at: ap.at };
  }
  if (rec) { // live: the state the business's database reports (support_access.checked)
    const st = (['requested', 'active', 'denied', 'expired', 'ended'] as const).find(x => x === rec.d) ?? 'requested', until = Number(rec.e) || undefined;
    return { state: st === 'active' && until && until <= now ? 'expired' : st, id: rec.id, hours: Number(rec.b), at: rec.at, until };
  }
  return { state: 'none' };
}

