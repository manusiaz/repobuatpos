// Permission matrix check for ops screens: 'y' and 'a' show the action ('a' routes through an approval),
// 'o' only at the person's own outlets, 'n' hides it.
import { perm, type PermCode } from '../../system/perms.ts';
import type { DB, Employee, Role } from '../../data/schema.ts';

export function allowed(db: DB, role: Role, me: Employee | undefined, action: string, outletId: string): boolean {
  const c: PermCode = perm(db, role, action, outletId);
  return c === 'y' || c === 'a' || (c === 'o' && (role === 'owner' || !!me?.outlets.includes(outletId)));
}
