// The one Supabase client factory for API routes. Without NEXT_PUBLIC_SUPABASE_URL the routes run in demo mode.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { HttpError } from './http.ts';

export const DEMO = !process.env.NEXT_PUBLIC_SUPABASE_URL;

/** As the signed-in user (RLS applies) when a token is given; anonymous otherwise (server-secret RPCs only). */
export function supa(token?: string): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new HttpError(503, 'Supabase is not configured');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: token ? { headers: { Authorization: `Bearer ${token}` } } : undefined });
}
/** Shared secret for server-only RPCs (must equal private.secrets 'payment_webhook' in the database). */
export function serverSecret(): string {
  const s = process.env.BORNIZ_SERVER_SECRET;
  if (!s) throw new HttpError(503, 'BORNIZ_SERVER_SECRET is not set');
  return s;
}
/** Server-secret RPC. Database errors come back as their BNxxx message, never with arguments. */
export async function rpc<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supa().rpc(fn, { p_secret: serverSecret(), ...args });
  if (error) throw new HttpError(/BN018|not found/i.test(error.message) ? 404 : /BN016/.test(error.message) ? 503 : 400, error.message);
  return data as T;
}
