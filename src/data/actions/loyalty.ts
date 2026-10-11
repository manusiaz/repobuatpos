'use client';
// Loyalty service additions. Owner adjusts beans directly (points are owner-level on the ladder, so an owner's own
// request could never be approved by anyone); everyone else goes through requestApproval('points').
import { commit, snapshot } from '../store.ts';
import { balance } from '../../domain/loyalty.ts';
import { levelRequired } from '../../domain/approval.ts';
import type { Rec } from '../schema.ts';

/** True when this person sits at the level the ladder needs for points, so their change applies without a request. */
export const decidesPoints = (role: string) => levelRequired('points') === role;

export function adjustPoints(customerId: string, points: number, reason: string, by: string): string | null {
  const d0 = snapshot();
  if (!decidesPoints(d0.employees.find(e => e.id === by)?.role ?? '')) return 'Beans changes need owner approval. Send a request instead.';
  if (!Number.isInteger(points) || points === 0) return 'Enter a whole number of beans.';
  if (balance(d0.ledger, customerId) + points < 0) return 'That would make the balance negative.';
  commit('points.adjusted', by, d => { d.ledger.push({ customerId, points, reason: 'Adjustment · ' + reason, at: Date.now() }); }, customerId);
  return null;
}

/** Add several catalog rewards in one commit (e.g. the starter set). Rows use the generic records table: a name, b category, c cost, d lowest tier, e stock. */
export function addRewards(rows: Rec[], by: string) {
  commit('reward.added', by, d => { d.records.reward = [...rows, ...(d.records.reward ?? [])]; }, `${rows.length} rewards`);
}
