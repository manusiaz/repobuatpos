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
export const TRIAL_DAYS = 14;
export const PPN_BPS = 1100;

/** Yearly = 2 months free, shown as a monthly equivalent. */
export const perMonth = (p: Plan, yearly: boolean) => p.monthly == null ? null : Math.round(yearly ? (p.monthly * 10) / 12 : p.monthly);
export const billed = (p: Plan, yearly: boolean) => p.monthly == null ? null : yearly ? p.monthly * 10 : p.monthly;

/** Which plan unlocks a feature (upgrade wall, pricing comparison). */
export const FEATURE_PLAN: [string, PlanId][] = [
  ['QRIS, cash, card & e-wallet', 'free'], ['Digital receipts by WhatsApp', 'free'], ['Basic sales reports', 'free'], ['Offline mode', 'free'],
  ['Loyalty, beans & vouchers', 'basic'], ['Inventory & recipes', 'basic'], ['Customer display', 'basic'], ['Up to 3 registers', 'basic'],
  ['Kitchen display', 'pro'], ['QR self-order & kiosk', 'pro'], ['Menu, Brand & page studios', 'pro'], ['Shifts, payroll & approvals', 'pro'], ['WhatsApp Business automations', 'pro'], ['Up to 3 outlets', 'pro'],
  ['Franchise brand lock & royalties', 'enterprise'], ['API, webhooks & SSO', 'enterprise'], ['Unlimited outlets', 'enterprise'], ['Dedicated success manager', 'enterprise'],
];
const RANK: Record<PlanId, number> = { free: 0, basic: 1, pro: 2, enterprise: 3 };
export const includes = (have: PlanId, need: PlanId) => RANK[have] >= RANK[need];
