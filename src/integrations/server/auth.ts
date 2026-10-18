// Who is calling: the signed-in account (session cookie or Authorization: Bearer <session token>) as a member of the tenant.
// Tenant = X-BorNiz-Tenant header, else the body's tenantId, else the caller's only membership.
import { HttpError, UUID } from './http.ts';
import { as, call, cellFor } from './db.ts';
import { userOf } from './session.ts';

export type MemberRole = 'owner' | 'manager' | 'device' | 'admin';
export interface Member { tenantId: string; userId: string; role: MemberRole; cell: string | null }

export async function member(req: Request, roles: MemberRole[] | null = null, tenantHint?: unknown): Promise<Member> {
  const u = await userOf(req);
  if (!u) throw new HttpError(401, 'Sign in first');
  let tenantId = req.headers.get('x-borniz-tenant') ?? (typeof tenantHint === 'string' ? tenantHint : '');
  if (!tenantId) {
    const r = await as(u.id, null, c => c.query('select tenant_id from public.members where user_id = $1', [u.id]));
    if (r.rowCount !== 1) throw new HttpError(400, 'Which business? Send X-BorNiz-Tenant');
    tenantId = r.rows[0].tenant_id as string;
  }
  if (!UUID.test(tenantId)) throw new HttpError(400, 'Bad tenant id');
  const role = await call('bn_member_role', { p_tenant: tenantId }, u.id) as MemberRole | null;
  if (!role) throw new HttpError(403, 'Not a member of this business');
  if (roles && !roles.includes(role)) throw new HttpError(403, 'Only the owner or a manager can do this');
  return { tenantId, userId: u.id, role, cell: await cellFor(tenantId) };
}
