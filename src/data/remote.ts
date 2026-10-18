// Production adapter switch: a deployment built with DATABASE_URL (own PostgreSQL, next.config.ts → NEXT_PUBLIC_BORNIZ_BACKEND)
// runs on the server API (app/api/bn); without it the app runs on the local adapter (one browser, demo data).
const DEMO_KEY = 'borniz-demo';
/** "Try the demo" on a deployment with a database: this browser runs the local adapter with the Kopi Biru demo business instead. */
export const DEMO_HERE = typeof window !== 'undefined' && (() => { try { return localStorage.getItem(DEMO_KEY) === '1'; } catch { return false; } })();
export const REMOTE = process.env.NEXT_PUBLIC_BORNIZ_BACKEND === '1' && !DEMO_HERE;
/** This deployment has a real backend (the demo is a choice of this browser). */
export const LIVE = process.env.NEXT_PUBLIC_BORNIZ_BACKEND === '1';
export function setDemo(on: boolean) {
  try { if (on) localStorage.setItem(DEMO_KEY, '1'); else localStorage.removeItem(DEMO_KEY); } catch { /* blocked: stays as is */ }
  location.assign('/account/login');
}

/** Our own API routes: the session cookie travels by itself; the header says which business (the server finds its database). */
export async function authHeaders(): Promise<Record<string, string>> {
  if (!REMOTE || typeof window === 'undefined') return {};
  const tenant = (await import('./remoteStore.ts')).remoteInfo().tenant?.id;
  return tenant ? { 'X-BorNiz-Tenant': tenant } : {};
}
