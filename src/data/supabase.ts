'use client';
// The one Supabase client (auth session in localStorage, shared by every tab of this browser).
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
let client: SupabaseClient | null = null;
export function sb(): SupabaseClient {
  return client ??= createClient(URL, KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'borniz-auth' } });
}
export async function accessToken() { return (await sb().auth.getSession()).data.session?.access_token ?? null; }

export interface Membership { tenantId: string; slug: string; name: string; employeeId: string; role: 'owner' | 'manager' | 'device' | 'admin' }
const PICK = 'borniz-tenant';
/** The signed-in account's business (the last one picked on this browser when it belongs to several). */
export async function membership(): Promise<Membership | null> {
  const { data: u } = await sb().auth.getUser();
  if (!u.user) return null;
  const { data, error } = await sb().from('members').select('tenant_id, employee_id, role, tenants(slug, name)').eq('user_id', u.user.id);
  if (error) throw error;
  const rows = (data ?? []).map(r => { const t = (Array.isArray(r.tenants) ? r.tenants[0] : r.tenants) as { slug: string; name: string } | null;
    return { tenantId: r.tenant_id as string, slug: t?.slug ?? '', name: t?.name ?? '', employeeId: r.employee_id as string, role: r.role as Membership['role'] }; });
  let pick = ''; try { pick = localStorage.getItem(PICK) ?? ''; } catch { /* blocked */ }
  return rows.find(r => r.tenantId === pick) ?? rows[0] ?? null;
}
export function pickTenant(id: string) { try { localStorage.setItem(PICK, id); } catch { /* blocked */ } }
