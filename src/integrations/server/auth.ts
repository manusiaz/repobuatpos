// Who is calling: a Supabase access token (Authorization: Bearer …) of a member of the tenant.
// Tenant = X-BorNiz-Tenant header, else the body's tenantId, else the caller's only membership.
import type { SupabaseClient } from '@supabase/supabase-js';
import { HttpError, UUID } from './http.ts';
import { supa } from './supabase.ts';

export type MemberRole = 'owner' | 'manager' | 'device' | 'admin';
export interface Member { tenantId: string; userId: string; role: MemberRole; db: SupabaseClient }

export const bearer = (req: Request) => /^Bearer\s+(.+)$/i.exec(req.headers.get('authorization') ?? '')?.[1] ?? null;

export async function member(req: Request, roles: MemberRole[] | null = null, tenantHint?: unknown): Promise<Member> {
  const token = bearer(req);
  if (!token) throw new HttpError(401, 'Sign in first');
  const db = supa(token);
  const { data: u, error } = await db.auth.getUser(token);
  if (error || !u.user) throw new HttpError(401, 'Session expired: sign in again');
  let tenantId = req.headers.get('x-borniz-tenant') ?? (typeof tenantHint === 'string' ? tenantHint : '');
  if (!tenantId) {
    const { data } = await db.from('members').select('tenant_id').eq('user_id', u.user.id);
    if (data?.length !== 1) throw new HttpError(400, 'Which business? Send X-BorNiz-Tenant');
    tenantId = data[0].tenant_id as string;
  }
  if (!UUID.test(tenantId)) throw new HttpError(400, 'Bad tenant id');
  const { data: role } = await db.rpc('bn_member_role', { p_tenant: tenantId });
  if (!role) throw new HttpError(403, 'Not a member of this business');
  if (roles && !roles.includes(role as MemberRole)) throw new HttpError(403, 'Only the owner or a manager can do this');
  return { tenantId, userId: u.user.id, role: role as MemberRole, db };
}
