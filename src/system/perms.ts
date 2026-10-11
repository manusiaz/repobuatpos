// Permission matrix (spec/bn-perms.js, Roles). Every app reads the saved matrix; never hard-code a role check for an action.
// Code per role column: y allowed · o own outlet only · a needs approval · n hidden. Saved overrides live in db.perms
// under "<outletId>|<action>" or "all|<action>"; the owner and admin columns are fixed.
import catalog from './catalog.json' with { type: 'json' };
import type { DB, Role } from '../data/schema.ts';

export type PermCode = 'y' | 'o' | 'a' | 'n';
export const PERM_ACTIONS = Object.keys(catalog.perms) as (keyof typeof catalog.perms)[];
export const PERM_COLS = ['owner', 'manager', 'pic', 'cashier', 'kitchen', 'waiter', 'admin'] as const;
export const LOCKED_COLS: Role[] = ['owner', 'admin'];

export function permRow(db: Pick<DB, 'perms'>, action: string, outletId: string): string {
  return db.perms[`${outletId}|${action}`] ?? db.perms[`all|${action}`] ?? (catalog.perms as Record<string, string>)[action] ?? 'yyyyyyn';
}
export function perm(db: Pick<DB, 'perms'>, role: Role, action: string, outletId: string): PermCode {
  const col = PERM_COLS.indexOf(role as (typeof PERM_COLS)[number]);
  if (col < 0) return 'n';
  const row = permRow(db, action, outletId), def = (catalog.perms as Record<string, string>)[action] ?? row;
  return (LOCKED_COLS.includes(role) ? def[col] : row[col]) as PermCode;
}
/** Visible at all? 'a' stays visible and routes through requestApproval. */
export const canSee = (c: PermCode) => c !== 'n';
