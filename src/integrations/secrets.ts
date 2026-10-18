// API keys, tokens and passwords never enter the shared data every device (and every cashier) can read.
// Production: sent once to /api/integrations/secrets → the database's private schema; only server routes read them back.
// Local demo: kept in this browser only.
import { REMOTE, authHeaders } from '../data/remote.ts';

const KEY = 'borniz-secrets-demo';
const local = (): Record<string, Record<string, string>> => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } };

export async function putSecrets(integrationId: string, values: Record<string, string>): Promise<void> {
  const set = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== ''));
  if (!Object.keys(set).length) return;
  if (REMOTE) {
    const r = await fetch('/api/integrations/secrets', { method: 'POST', headers: { 'content-type': 'application/json', ...(await authHeaders()) }, body: JSON.stringify({ integrationId, values: set }) });
    if (!r.ok) throw new Error((await r.text()) || 'Could not save the secret');
    return;
  }
  const all = local(); all[integrationId] = { ...all[integrationId], ...set };
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* storage blocked */ }
}
/** Demo mode only: browser-side drivers read their secrets here. In production secrets stay on the server. */
export const demoSecrets = (integrationId: string): Record<string, string> => (REMOTE ? {} : local()[integrationId] ?? {});
