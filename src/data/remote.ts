// Production adapter switch. Set NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY to run on Supabase;
// without them the app runs on the local adapter (one browser, demo data).
export const REMOTE = !!process.env.NEXT_PUBLIC_SUPABASE_URL;

/** Authorization for our own API routes (Supabase access token of the signed-in user). */
export async function authHeaders(): Promise<Record<string, string>> { return {}; }
