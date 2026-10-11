import { signOutgoing } from '../sign.ts';
import type { OutEvent } from './events.ts';

/** Only public https endpoints (no localhost, private ranges or metadata IPs). */
export function publicEndpoint(url: string) {
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (u.protocol !== 'https:' || u.username || u.password) return false;
  return !(h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal') || h.endsWith('.local') || h === '::1' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80')
    || /^(0|10|127)\./.test(h) || /^169\.254\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(h));
}

/** One signed POST. Retries with backoff are the dispatcher's job; the delivery id lets the receiver drop duplicates. */
export async function deliver(url: string, secret: string, tenantId: string, e: OutEvent, f: typeof fetch = fetch): Promise<{ ok: boolean; status: number }> {
  if (!publicEndpoint(url)) return { ok: false, status: 400 };
  const body = JSON.stringify({ id: e.id, event: e.event, tenantId, at: e.at, data: e.data });
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 10_000);
  try {
    const r = await f(url, { method: 'POST', redirect: 'manual', signal: ctl.signal, body,
      headers: { 'content-type': 'application/json', 'user-agent': 'BorNiz-Webhooks/1', 'x-borniz-event': e.event, 'x-borniz-delivery': e.id, 'x-borniz-signature': signOutgoing(secret, body) } });
    return { ok: r.status >= 200 && r.status < 300, status: r.status };
  } catch { return { ok: false, status: 0 }; } finally { clearTimeout(timer); }
}
