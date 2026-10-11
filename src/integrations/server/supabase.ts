// The one Supabase client factory for API routes. Without NEXT_PUBLIC_SUPABASE_URL the routes run in demo mode.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { HttpError } from './http.ts';

export const DEMO = !process.env.NEXT_PUBLIC_SUPABASE_URL;

/** As the signed-in user (RLS applies) when a token is given; anonymous otherwise (server-secret RPCs only).
 *  `at` = a merchant's own database (hybrid tenancy); default = the platform / shared database. */
export function supa(token?: string, at?: Cell | null): SupabaseClient {
  const url = at?.url ?? process.env.NEXT_PUBLIC_SUPABASE_URL, key = at?.key ?? (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  if (!url || !key) throw new HttpError(503, 'Supabase is not configured');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: token ? { headers: { Authorization: `Bearer ${token}` } } : undefined });
}
export interface Cell { cell: string; url: string; key: string }
const cells = new Map<string, { at: number; c: Cell | null }>();
/** Where a merchant's data lives (registry on the platform), cached for a minute. null = the shared database. */
export async function cellFor(tenant: string): Promise<Cell | null> {
  const hit = cells.get(tenant);
  if (hit && Date.now() - hit.at < 60e3) return hit.c;
  const { data, error } = await supa().rpc('bn_tenant_cell', { p_slug: null, p_tenant: tenant });
  if (error) throw new HttpError(503, error.message);
  const r = data as { cell: string | null; url: string | null; key: string | null } | null;
  const c = r?.cell && r.url && r.key ? { cell: r.cell, url: r.url, key: r.key } : null;
  cells.set(tenant, { at: Date.now(), c });
  return c;
}
/** Shared secret for server-only RPCs: private.secrets 'server' of the database being called.
 *  Merchants on their own database: BORNIZ_CELLS = {"<cell>": "<that database's server secret>"}. */
export function serverSecret(cell?: string | null): string {
  const s = cell ? (JSON.parse(process.env.BORNIZ_CELLS || '{}') as Record<string, string>)[cell] : process.env.BORNIZ_SERVER_SECRET;
  if (!s) throw new HttpError(503, cell ? `BORNIZ_CELLS has no secret for ${cell}` : 'BORNIZ_SERVER_SECRET is not set');
  return s;
}
/** Server-secret RPC, sent to the database of `p_tenant`. Database errors come back as their BNxxx message, never with arguments. */
export async function rpc<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T> {
  const at = typeof args.p_tenant === 'string' ? await cellFor(args.p_tenant) : null;
  const { data, error } = await supa(undefined, at).rpc(fn, { p_secret: serverSecret(at?.cell), ...args });
  if (error) throw new HttpError(/BN018|not found/i.test(error.message) ? 404 : /BN016/.test(error.message) ? 503 : 400, error.message);
  return data as T;
}
