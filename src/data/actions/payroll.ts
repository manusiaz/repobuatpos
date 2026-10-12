'use client';
// Commission rules (Payroll & commission): payroll is owner-only. The owner saves with the approval PIN;
// a manager's change becomes a payroll approval and applies when the owner approves it.
import { commit } from '../store.ts';
import { requestApproval } from '../actions.ts';
import type { CommissionRule } from '../../domain/commission.ts';

export function saveCommissionRules(rules: CommissionRule[], by: string) {
  commit('payroll.commission_rules', by, d => { d.commissionRules = rules; }, `${rules.length} commission rules`);
}
export function requestCommissionRules(rules: CommissionRule[], by: string, outletId: string, what: string) {
  return requestApproval({ type: 'payroll', title: `Commission rules · ${what}`, requestedBy: by, outletId, payload: { commissionRules: rules } });
}
