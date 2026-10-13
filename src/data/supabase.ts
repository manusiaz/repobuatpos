'use client';
// The one Supabase client (auth session in localStorage, shared by every tab of this browser).
import { createClient, isAuthRetryableFetchError, type SupabaseClient } from '@supabase/supabase-js';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
// Hybrid tenancy: env = the platform project (sign-up, sign-in, merchant registry, shared database). A merchant moved to its
// own database ("cell") is reached there; the registry (bn_tenant_cell) says where. Staff keep the cell on this browser,
// a guest page only for the visit.
export interface Home { cell: string; url: string; key: string }
const HOME = 'borniz-cell';
let client: SupabaseClient | null = null, platformClient: SupabaseClient | null = null, visit: Home | null | undefined; // undefined = no guest visit
const stored = (): Home | null => { try { return JSON.parse(localStorage.getItem(HOME) ?? 'null'); } catch { return null; } };
export const home = (): Home | null => (visit !== undefined ? visit : stored());
export function sb(): SupabaseClient {
  const h = home();
  return client ??= createClient(h?.url ?? URL, h?.key ?? KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: h ? 'borniz-auth-' + h.cell : 'borniz-auth' } });
}
const platform = () => (home() ? platformClient ??= createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } }) : sb());
/** Where a merchant's data lives: null = the shared database. */
export async function cellOf(by: { slug?: string; tenant?: string }): Promise<Home | null> {
  const { data, error } = await platform().rpc('bn_tenant_cell', { p_slug: by.slug ?? null, p_tenant: by.tenant ?? null });
  if (error) throw error;
  const r = data as { cell: string | null; url: string | null; key: string | null } | null;
  return r?.cell && r.url && r.key ? { cell: r.cell, url: r.url, key: r.key } : null;
}
/** Point this browser (staff) or this visit (guest) at a merchant's database. */
export function goHome(h: Home | null | undefined, forVisit = false) {
  if (forVisit) visit = h;
  else try { visit = undefined; if (h) localStorage.setItem(HOME, JSON.stringify(h)); else localStorage.removeItem(HOME); } catch { /* blocked */ }
  client = null;
}
export async function accessToken() { return (await sb().auth.getSession()).data.session?.access_token ?? null; }

export interface Membership { tenantId: string; slug: string; name: string; plan?: 'free' | 'basic' | 'pro' | 'enterprise'; employeeId: string; role: 'owner' | 'manager' | 'device' | 'admin' }
const PICK = 'borniz-tenant';
/** The signed-in account's business (the last one picked on this browser when it belongs to several). */
export async function membership(): Promise<Membership | null> {
  const { data: u, error: ue } = await sb().auth.getUser();
  if (!u.user) { if (isAuthRetryableFetchError(ue)) throw ue; return null; } // no internet is not "signed out"
  const { data, error } = await sb().from('members').select('tenant_id, employee_id, role, tenants(slug, name, plan)').eq('user_id', u.user.id);
  if (error) throw error;
  const rows = (data ?? []).map(r => { const t = (Array.isArray(r.tenants) ? r.tenants[0] : r.tenants) as { slug: string; name: string; plan: Membership['plan'] } | null;
    return { tenantId: r.tenant_id as string, slug: t?.slug ?? '', name: t?.name ?? '', plan: t?.plan ?? 'free', employeeId: r.employee_id as string, role: r.role as Membership['role'] }; });
  let pick = ''; try { pick = localStorage.getItem(PICK) ?? ''; } catch { /* blocked */ }
  return rows.find(r => r.tenantId === pick) ?? rows[0] ?? null;
}
/** BorNiz staff (private.platform_admins): the super admin console. Platform database only. */
export async function isPlatformAdmin() { const { data } = await sb().rpc('bn_is_platform_admin'); return data === true; }
export interface PlatformTenant { id: string; slug: string; name: string; plan: string; cell: string | null; createdAt: number; owner: string | null; city: string | null; outlets: number; orders30: number; lastActive: number | null }
export async function adminTenants(): Promise<PlatformTenant[]> { const { data, error } = await sb().rpc('bn_admin_tenants'); if (error) throw error; return (data ?? []) as PlatformTenant[]; }
export async function adminSetPlan(tenant: string, plan: string) { const { error } = await sb().rpc('bn_admin_set_plan', { p_tenant: tenant, p_plan: plan }); if (error) throw error; }
/** Shared register: owner / manager get a one-time code, the tablet re-signs in anonymously and joins with it (no owner rights). */
export async function makeSharedRegister(tenant: string): Promise<string | null> {
  const c = await sb().rpc('bn_device_code', { p_tenant: tenant });
  if (c.error) return c.error.message;
  await sb().auth.signOut();
  const a = await sb().auth.signInAnonymously();
  if (a.error) return /anonymous/i.test(a.error.message) ? 'Turn on anonymous sign-ins in Supabase › Authentication › Sign In / Providers, then try again. Sign in again as the owner first.' : a.error.message;
  const j = await sb().rpc('bn_device_join', { p_code: c.data });
  return j.error ? j.error.message : null;
}
export async function staffLogin(tenant: string, employee: string, pin: string): Promise<{ error?: string; token?: string }> {
  const { data, error } = await sb().rpc('bn_staff_login', { p_tenant: tenant, p_employee: employee, p_pin: pin });
  return error ? { error: error.message } : (data as { error?: string; token?: string });
}
export function pickTenant(id: string) { try { localStorage.setItem(PICK, id); } catch { /* blocked */ } }
