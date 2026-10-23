// Plans (spec/bn-pm.js business model; Landing pricing; Auth choose plan; Super admin sets them). Per outlet, prices exclude PPN.
import type { DB } from '../../data/schema.ts';

export type PlanId = DB['tenant']['plan'];
export interface Plan { id: PlanId; name: string; monthly: number | null; blurb: string; features: string[]; outlets: number; registers: number; cta: string; popular?: boolean }

export const PLANS: Plan[] = [
  { id: 'free', name: 'Free', monthly: 0, blurb: '1 outlet, 1 register, basic reports', features: ['1 outlet, 1 register', 'QRIS, cash, card', 'Basic reports', 'Digital receipts'], outlets: 1, registers: 1, cta: 'Start free' },
  { id: 'basic', name: 'Basic', monthly: 149_000, blurb: '1 outlet, 3 registers, loyalty', features: ['3 registers', 'Loyalty & vouchers', 'Inventory', 'Customer display'], outlets: 1, registers: 3, cta: 'Start trial' },
  { id: 'pro', name: 'Pro', monthly: 349_000, blurb: '3 outlets, KDS, self-order, studios', features: ['Kitchen display', 'Self-order & kiosk', 'All customization studios', 'Shifts, payroll, WABA'], outlets: 3, registers: 10, cta: 'Start 14-day trial', popular: true },
  { id: 'enterprise', name: 'Enterprise', monthly: null, blurb: 'Unlimited, franchise lock, API', features: ['Unlimited outlets', 'Franchise brand lock', 'API, webhooks, SSO', 'Dedicated success manager'], outlets: Infinity, registers: Infinity, cta: 'Contact sales' },
];
export const planOf = (id: PlanId) => PLANS.find(p => p.id === id)!;
/** The console's price for a plan (Super admin › Plans & pricing; bn_public_prices on the server). */
export const priceKey = (plan: string) => `/admin/plans-and-pricing:price-${plan}`;
/** The plans at the prices BorNiz set; PLANS holds the defaults. */
export const priced = (over: Record<string, unknown>): Plan[] => PLANS.map(p => p.monthly && Number(over[p.id]) > 0 ? { ...p, monthly: Number(over[p.id]) } : p);
export const TRIAL_DAYS = 14;
export const PPN_BPS = 1100;

/** Yearly = 2 months free, shown as a monthly equivalent. */
export const perMonth = (p: Plan, yearly: boolean) => p.monthly == null ? null : Math.round(yearly ? (p.monthly * 10) / 12 : p.monthly);
export const billed = (p: Plan, yearly: boolean) => p.monthly == null ? null : yearly ? p.monthly * 10 : p.monthly;

/** Which plan unlocks a feature (upgrade wall, pricing comparison). */
export const FEATURE_PLAN: [string, PlanId][] = [
  ['QRIS, cash, card & e-wallet', 'free'], ['Digital receipts by WhatsApp', 'free'], ['Basic sales reports', 'free'], ['Offline mode', 'free'],
  ['Loyalty, beans & vouchers', 'basic'], ['Inventory & recipes', 'basic'], ['Customer display', 'basic'], ['Up to 3 registers', 'basic'],
  ['Kitchen display', 'pro'], ['QR self-order & kiosk', 'pro'], ['Menu, Brand & page studios', 'pro'], ['Shifts & payroll', 'pro'], ['WhatsApp Business automations', 'pro'], ['Up to 3 outlets', 'pro'],
  ['Franchise brand lock & royalties', 'enterprise'], ['API, webhooks & SSO', 'enterprise'], ['Unlimited outlets', 'enterprise'], ['Dedicated success manager', 'enterprise'],
];
const RANK: Record<PlanId, number> = { free: 0, basic: 1, pro: 2, enterprise: 3 };
export const includes = (have: PlanId, need: PlanId) => RANK[have] >= RANK[need];

/** Pricing-table lines that lock real behaviour (spec lg-gate): their pages show the upgrade wall over the page, read-only,
 *  and what they do elsewhere stops below the plan (beans and stock at payment, ordering from the QR menu: BN087 on the
 *  server). Approvals are on every plan: voids, refunds and discounts need them. */
export const FEATURE = { loyalty: 'Loyalty, beans & vouchers', inventory: 'Inventory & recipes', selforder: 'QR self-order & kiosk', shifts: 'Shifts & payroll' } as const;
export type Feature = keyof typeof FEATURE;
export const has = (have: PlanId, f: Feature) => includes(have, FEATURE_PLAN.find(([l]) => l === FEATURE[f])![1]);
const PAGES: [RegExp, Feature][] = [
  [/^\/(owner|manager)\/inventory\/|^\/owner\/catalog\/recipes-and-cogs$|^\/owner\/reports\/inventory-movement-report$|^\/manager\/(same-as-owner\/inventory-pos-and-suppliers|create\/stock-adjustment-and-waste-entry|operations\/stock-opname-and-stock-requests)$|^\/pic\/floor\/(stock-request-to-manager|stock-opname)$/, 'inventory'],
  [/^\/owner\/customers\/(loyalty-program|points-adjustment|rewards-catalog|membership-and-gift-cards)$|loyalty-rules-and-rewards-catalog$|^\/manager\/same-as-owner\/customers-and-loyalty-rules$/, 'loyalty'],
  [/^\/owner\/team\/(shifts-and-schedules|payroll-and-commission|commission-rules)$|^\/manager\/shifts\/(shift-templates|weekly-roster-builder-and-coverage|assign-pic-per-shift|publish-roster-to-whatsapp|swap-and-no-show-requests)$|^\/manager\/(waiting-for-owner\/payroll-approval|same-as-owner\/team-roster-and-pic|team\/schedules-and-attendance)$/, 'shifts'],
  [/^\/kiosk(\/|$)/, 'selforder'],
];
/** The locked feature a page belongs to on this plan, else null. */
export const pageLock = (have: PlanId, path: string): Feature | null => { const f = PAGES.find(([r]) => r.test(path))?.[1]; return f && !has(have, f) ? f : null; };

/** Room left on the plan for one more outlet or device: null, or why not (the server refuses the same with BN076,
 *  db/migrations/20261021000000_borniz_plan_rules.sql). What a business already has keeps working after a downgrade. */
export function planBlock(db: Pick<DB, 'tenant' | 'outlets' | 'devices'>, what: 'outlets' | DB['devices'][0]['kind'], outletId?: string): string | null {
  const p = planOf(db.tenant.plan), need: Partial<Record<string, PlanId>> = { display: 'basic', kds: 'pro', kiosk: 'pro' }, s = (n: number) => n > 1 ? 's' : '';
  const pos = db.devices.filter(d => d.kind === 'pos');
  if (need[what] && !includes(p.id, need[what]!)) return `${p.name}: no ${what === 'kds' ? 'kitchen display' : what === 'kiosk' ? 'kiosk' : 'customer display'}. Upgrade to add more.`;
  if (what === 'outlets' && db.outlets.length >= p.outlets) return `${p.name}: up to ${p.outlets} outlet${s(p.outlets)}. Upgrade to add more.`;
  if (what === 'pos' && (pos.filter(d => d.outletId === outletId).length >= p.registers || pos.length >= p.registers * p.outlets)) return `${p.name}: up to ${p.registers} register${s(p.registers)} per outlet. Upgrade to add more.`;
  return null;
}
