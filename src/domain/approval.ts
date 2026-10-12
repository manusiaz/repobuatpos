import type { IDR } from './money.ts';

// lg-approval / Roles: one engine for every request type. Level is computed when the request is created.
export type Level = 'cashier' | 'pic' | 'manager' | 'owner';
export type RequestType = 'discount' | 'void' | 'refund' | 'variance' | 'cash_out' | 'waste' | 'adjust' | 'opname'
  | 'price' | 'publish' | 'payroll' | 'local_item' | 'po' | 'asset' | 'expense' | 'transfer' | 'points' | 'supplier'
  | 'staff_advance' | 'manual_payment' | 'gift_card' | 'budget' | 'broadcast' | 'promo' | 'recipe' | 'perm' | 'leave' | 'timesheet' | 'reject_online';

export const LIMITS = {
  cashierDiscountPct: 10,
  picDiscountPct: 20,
  pic: 100_000,          // void / refund / cash out
  picVariance: 50_000,   // drawer variance, waste, opname
  manager: 500_000,
} as const;

const OWNER_ONLY: RequestType[] = ['price', 'publish', 'payroll', 'points', 'supplier', 'perm', 'promo', 'recipe', 'broadcast', 'budget'];
const TO_OWNER_ALWAYS: RequestType[] = ['local_item'];
const SMALL_LIMIT: RequestType[] = ['variance', 'waste', 'adjust', 'opname'];

export function levelRequired(type: RequestType, amount: IDR = 0, pct = 0): Level {
  if (OWNER_ONLY.includes(type) || TO_OWNER_ALWAYS.includes(type)) return 'owner';
  if (type === 'discount') return pct <= LIMITS.cashierDiscountPct ? 'cashier' : pct <= LIMITS.picDiscountPct ? 'pic' : 'manager';
  if (type === 'leave' || type === 'timesheet' || type === 'reject_online') return type === 'reject_online' ? 'pic' : 'manager';
  if (type === 'po' || type === 'asset' || type === 'expense' || type === 'transfer' || type === 'staff_advance' || type === 'gift_card')
    return amount <= LIMITS.manager ? 'manager' : 'owner';
  const picCap = SMALL_LIMIT.includes(type) ? LIMITS.picVariance : LIMITS.pic;
  if (amount <= picCap) return 'pic';
  return amount <= LIMITS.manager ? 'manager' : 'owner';
}

const RANK: Record<Level, number> = { cashier: 0, pic: 1, manager: 2, owner: 3 };
/** Nobody approves their own request; the counter can't sign their own opname. */
export function canDecide(req: { level: Level; requestedBy: string; countedBy?: string }, by: { id: string; level: Level }) {
  if (by.id === req.requestedBy || by.id === req.countedBy) return false;
  return RANK[by.level] >= RANK[req.level];
}

/** Change approvals set to "Owner + one admin" (Studios › Governance): studio publishes, price changes and local items
 *  need two different people, one of them the owner. A manager may sign first; only the owner's signature (or a second
 *  signature after the owner's) completes it. The requester never signs. */
export const TWO_KEY: RequestType[] = ['publish', 'price', 'local_item'];
export type Signer = { id: string; level: Level };
export function twoKey(signers: Signer[], by: Signer, requestedBy: string): 'approve' | 'cosign' | string {
  if (by.id === requestedBy) return 'You can’t decide your own request.';
  if (signers.some(s => s.id === by.id)) return 'You already signed. It needs a second person.';
  if (RANK[by.level] < RANK.manager) return 'Needs owner. Escalate instead.';
  const all = [...signers, by];
  return all.length >= 2 && all.some(s => s.level === 'owner') ? 'approve' : 'cosign';
}

/** Escalation: PIC 5 min → manager 30 min → owner. */
export const ESCALATE_MS: Partial<Record<Level, number>> = { pic: 5 * 60e3, manager: 30 * 60e3 };
export const nextLevel = (l: Level): Level | null => (l === 'pic' ? 'manager' : l === 'manager' ? 'owner' : null);

// Approval PIN (bn-pin.js): 6 digits, 5 wrong tries lock 15 min.
export const PIN_LEN = 6, PIN_TRIES = 5, PIN_LOCK_MS = 15 * 60e3;
