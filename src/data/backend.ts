'use client';
// The one backend client: BorNiz's own API (app/api/bn) on this deployment's PostgreSQL. The session is an HttpOnly
// cookie for the root domain, so bornis.id, app. and every <slug>.bornis.id share one sign-in and JS never sees the token.
// Same shape as the calls the app always made (rpc, auth.*), so screens and actions did not change.
export interface BnError { message: string; code?: string; status?: number }
type R<T = any> = { data: T; error: BnError | null };
export interface User { id: string; email: string | null; is_anonymous: boolean; user_metadata: Record<string, unknown>; /** this sign-in passed the authenticator code */ mfa?: boolean }

let recovering: Promise<unknown> | null = null;
/** tenant: which business the call is for when its arguments don't name it (the API finds that business's database). */
async function api<T = any>(path: string, body?: unknown, tenant?: string): Promise<R<T>> {
  if (recovering && !path.startsWith('auth/recover')) await recovering;
  try {
    const res = await fetch('/api/bn/' + path, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json', ...(tenant ? { 'x-borniz-tenant': tenant } : {}) }, body: JSON.stringify(body ?? {}) });
    const j = await res.json().catch(() => ({ data: null, error: { message: 'Server error' } }));
    return { data: j.data as T, error: j.error ? { ...j.error, status: res.status } : null };
  } catch { return { data: null as T, error: { message: 'No connection. Check the internet and try again.', status: 0 } }; }
}
/** No answer at all (offline), as opposed to a refusal: the device keeps working on what it has. */
export const isAuthRetryableFetchError = (e: unknown) => (e as BnError | null)?.status === 0;

// Auth events: this tab's listeners, and every other tab of this browser through a BroadcastChannel.
type Listener = (event: string, session: { user: User } | null) => void;
const listeners = new Set<Listener>();
const tabs = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('bn-auth') : null;
const emit = (event: string, user: User | null, local = true) => {
  listeners.forEach(f => f(event, user ? { user } : null));
  if (local) tabs?.postMessage(event);
};
tabs?.addEventListener('message', async e => { const u = (await api<{ user: User | null }>('auth/user')).data?.user ?? null; emit(String(e.data), u, false); });
const session = (r: R<{ user: User } | null>) => ({ data: { user: r.data?.user ?? null, session: r.data?.user ? { user: r.data.user } : null }, error: r.error });
async function signedIn(path: string, body: unknown) { const r = await api<{ user: User }>(path, body); if (!r.error) emit('SIGNED_IN', r.data.user); return session(r); }

const auth = {
  async getUser() { const r = await api<{ user: User | null }>('auth/user'); return { data: { user: r.data?.user ?? null }, error: r.error }; },
  async getSession() { const { data, error } = await auth.getUser(); return { data: { session: data.user ? { user: data.user } : null }, error }; },
  signInWithPassword: (p: { email: string; password: string; code?: string }) => signedIn('auth/signin', p),
  signUp: (p: { email: string; password: string; options?: { data?: Record<string, unknown> } }) => signedIn('auth/signup', { email: p.email, password: p.password, data: p.options?.data ?? {} }),
  signInAnonymously: () => signedIn('auth/anonymous', {}),
  async signOut() { const r = await api('auth/signout'); emit('SIGNED_OUT', null); return { error: r.error }; },
  onAuthStateChange(f: Listener) { listeners.add(f); return { data: { subscription: { unsubscribe: () => { listeners.delete(f); } } } }; },
  async updateUser(p: { password?: string }) { const r = await api<{ user: User }>('auth/update', p); return { data: { user: r.data?.user ?? null }, error: r.error }; },
  async resetPasswordForEmail(email: string, o: { redirectTo?: string } = {}) { const r = await api('auth/reset', { email, redirectTo: o.redirectTo }); return { data: {}, error: r.error }; },
  /** Accounts work at once (no confirmation mail), so there is nothing to resend. */
  async resend(_p?: unknown) { return { data: {}, error: null }; },
  mfa: {
    listFactors: () => api<{ totp: { id: string; status: string }[] }>('auth/mfa/list'),
    enroll: (_p?: { factorType: 'totp' }) => api<{ id: string; totp: { secret: string; uri: string } }>('auth/mfa/enroll'),
    challengeAndVerify: (p: { factorId: string; code: string }) => api('auth/mfa/verify', p),
    unenroll: (p: { factorId: string; code?: string }) => api('auth/mfa/unenroll', p),
  },
};
const client = { rpc: <T = any>(fn: string, args: Record<string, unknown> = {}, tenant?: string) => api<T>('rpc/' + fn, args, tenant), read: <T = any>(what: string, args: Record<string, unknown> = {}) => api<T>('read/' + what, args), auth };
export const sb = () => client;

// A password-reset link (…/reset-password#bn_reset=<token>) signs this browser in once, then the page sets the new password.
if (typeof location !== 'undefined' && location.hash.startsWith('#bn_reset=')) {
  const token = location.hash.slice('#bn_reset='.length);
  history.replaceState(null, '', location.pathname + location.search);
  recovering = api('auth/recover', { token }).then(r => { recovering = null; if (!r.error) emit('PASSWORD_RECOVERY', null); return r; });
}

export interface Membership { tenantId: string; slug: string; name: string; plan?: 'free' | 'basic' | 'pro' | 'enterprise'; status?: 'active' | 'suspended'; trialUntil?: number | null; employeeId: string; role: 'owner' | 'manager' | 'device' | 'admin' }
const PICK = 'borniz-tenant';
/** The signed-in account's business (the last one picked on this browser when it belongs to several). */
export async function membership(): Promise<Membership | null> {
  const { data: u, error: ue } = await sb().auth.getUser();
  if (!u.user) { if (isAuthRetryableFetchError(ue)) throw ue; return null; } // no internet is not "signed out"
  const { data, error } = await sb().read<{ tenant_id: string; employee_id: string; role: Membership['role']; slug: string; name: string; plan: Membership['plan']; status?: Membership['status']; trial_until?: number | null }[]>('members');
  if (error) throw error;
  const rows = (data ?? []).map(r => ({ tenantId: r.tenant_id, slug: r.slug, name: r.name, plan: r.plan ?? 'free', status: r.status ?? 'active', trialUntil: r.trial_until ?? null, employeeId: r.employee_id, role: r.role }));
  const { hostTenant, resolve, config } = await import('../system/hosts.ts');
  // the super admin console (admin. host or /admin) is no business: BorNiz staff who also belong to one still get it
  const r = resolve(location.host, location.pathname, config());
  if (/^\/admin(\/|$)/.test(r.type === 'rewrite' ? r.path : location.pathname)) return null;
  const here = hostTenant(); // on <slug>.bornis.id only that business opens: a member of another one is not signed in here
  if (here) return rows.find(r => r.slug === here) ?? null;
  let pick = ''; try { pick = localStorage.getItem(PICK) ?? ''; } catch { /* blocked */ }
  return rows.find(r => r.tenantId === pick) ?? rows[0] ?? null;
}
/** BorNiz staff (private.platform_admins): the super admin console. Platform database only. */
export async function isPlatformAdmin() { const { data } = await sb().rpc('bn_is_platform_admin'); return data === true; }
export interface PlatformTenant { id: string; slug: string; name: string; plan: string; planNow?: string; status?: 'active' | 'suspended'; trialUntil?: number | null; cell: string | null; createdAt: number; owner: string | null; city: string | null; outlets: number; orders30: number; lastActive: number | null; domain: string | null }
export async function adminTenants(): Promise<PlatformTenant[]> { const { data, error } = await sb().rpc('bn_admin_tenants'); if (error) throw error; return (data ?? []) as PlatformTenant[]; }
export async function adminSetPlan(tenant: string, plan: string) { const { error } = await sb().rpc('bn_admin_set_plan', { p_tenant: tenant, p_plan: plan }); if (error) throw error; }
/** The console's own records (invoices, tickets, flags, releases, platform settings, notes on a business) and its audit. */
const ok = async <T = unknown>(fn: string, args: Record<string, unknown> = {}) => { const { data, error } = await sb().rpc<T>(fn, args); if (error) throw error; return data; };
export const adminRecords = () => ok<{ kind: string; id: string; data: Record<string, unknown> }[]>('bn_admin_records');
export const adminPut = (kind: string, id: string, data: unknown, action: string, subject?: string) => ok('bn_admin_put', { p_kind: kind, p_id: id, p_data: data, p_action: action, p_subject: subject ?? null });
export const adminNote = (action: string, subject: string) => ok('bn_admin_note', { p_action: action, p_subject: subject });
export const adminAudit = () => ok<{ id: number; at: number; actor: string; action: string; subject: string; tenantId: string | null }[]>('bn_admin_audit');
export const adminSetStatus = (tenant: string, status: 'active' | 'suspended', reason: string) => ok('bn_admin_set_status', { p_tenant: tenant, p_status: status, p_reason: reason });
export const adminSetTrial = (tenant: string, until: number) => ok('bn_admin_set_trial', { p_tenant: tenant, p_until: until });
/** Support access: asked here, granted by the business's owner with their approval PIN, read-only while it lasts. */
export interface SupportState { state: 'none' | 'requested' | 'active' | 'denied' | 'expired' | 'ended'; id?: string; hours?: number; until?: number | null; at?: number }
export const adminRequestAccess = (tenant: string, hours: number, reason: string, ticket?: string) => ok<string>('bn_admin_request_access', { p_tenant: tenant, p_hours: hours, p_reason: reason, p_ticket: ticket ?? null });
export const adminSupportState = (tenant: string) => ok<SupportState>('bn_admin_support_state', { p_tenant: tenant });
export const adminSupportDocs = (tenant: string) => ok<{ coll: string; id: string; data: Record<string, unknown> }[]>('bn_admin_support_docs', { p_tenant: tenant });
export const adminSupportEnd = (tenant: string, id: string) => ok('bn_admin_support_end', { p_tenant: tenant, p_id: id });
/** Support tickets a business opens (owner / manager) and reads back; they land in the console's Support tickets. */
export const openTicket = (tenant: string, subject: string, body: string, priority: string) => ok<string>('bn_open_ticket', { p_tenant: tenant, p_subject: subject, p_body: body, p_priority: priority });
export const myTickets = (tenant: string) => ok<{ id: string; a: string; b: string; c: string; d: string; e: string; at: number; m?: string }[]>('bn_my_tickets', { p_tenant: tenant });
/** The owner starts the trial of a paid plan, once (sign-up). */
export const startTrial = (tenant: string, plan: string) => ok<{ plan: string; trialUntil: number }>('bn_start_trial', { p_tenant: tenant, p_plan: plan });
/** Shared register: owner / manager get a one-time code, the tablet re-signs in anonymously and joins with it (no owner rights). */
export async function makeSharedRegister(tenant: string): Promise<string | null> {
  const c = await sb().rpc('bn_device_code', { p_tenant: tenant });
  if (c.error) return c.error.message;
  await sb().auth.signOut();
  const a = await sb().auth.signInAnonymously();
  if (a.error) return a.error.message;
  const j = await sb().rpc('bn_device_join', { p_code: c.data }, tenant); // the code lives in that business's database
  return j.error ? j.error.message : null;
}
export async function staffLogin(tenant: string, employee: string, pin: string): Promise<{ error?: string; token?: string }> {
  const { data, error } = await sb().rpc('bn_staff_login', { p_tenant: tenant, p_employee: employee, p_pin: pin });
  return error ? { error: error.message } : (data as { error?: string; token?: string });
}
export function pickTenant(id: string) { try { localStorage.setItem(PICK, id); } catch { /* blocked */ } }
