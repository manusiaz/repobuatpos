// Production adapter switch. Set NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or _ANON_KEY) to run on Supabase;
// without them the app runs on the local adapter (one browser, demo data).
const DEMO_KEY = 'borniz-demo';
/** "Try the demo" on a Supabase deployment: this browser runs the local adapter with the Kopi Biru demo business instead. */
export const DEMO_HERE = typeof window !== 'undefined' && (() => { try { return localStorage.getItem(DEMO_KEY) === '1'; } catch { return false; } })();
export const REMOTE = !!process.env.NEXT_PUBLIC_SUPABASE_URL && !DEMO_HERE;
/** This deployment has a real backend (the demo is a choice of this browser). */
export const LIVE = !!process.env.NEXT_PUBLIC_SUPABASE_URL;
export function setDemo(on: boolean) {
  try { if (on) localStorage.setItem(DEMO_KEY, '1'); else localStorage.removeItem(DEMO_KEY); } catch { /* blocked: stays as is */ }
  location.assign('/account/login');
}

/** Authorization for our own API routes (Supabase access token of the signed-in user). */
export async function authHeaders(): Promise<Record<string, string>> {
  if (!REMOTE || typeof window === 'undefined') return {};
  const [{ accessToken }, { remoteInfo }] = await Promise.all([import('./supabase.ts'), import('./supabaseStore.ts')]);
  const t = await accessToken(), tenant = remoteInfo().tenant?.id; // the server finds this business's database from it
  return t ? { Authorization: 'Bearer ' + t, ...(tenant ? { 'X-BorNiz-Tenant': tenant } : {}) } : {};
}
