import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { signOutgoing } from '../sign.ts';
import { rpc } from '../db.ts';
import type { OutEvent } from './events.ts';

// Private, loopback, link-local (cloud metadata), CGNAT, multicast and reserved ranges, plus every IPv4-mapped IPv6 address.
// Two lists: Node matches IPv4 addresses against IPv4-mapped IPv6 rules too, so one list would block every IPv4 address.
const V4 = new BlockList(), V6 = new BlockList();
for (const [a, p] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 3]] as const) V4.addSubnet(a, p, 'ipv4');
for (const [a, p] of [['::', 127], ['::ffff:0:0', 96], ['64:ff9b::', 96], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]] as const) V6.addSubnet(a, p, 'ipv6');
const blockedIp = (ip: string) => isIP(ip) === 6 ? V6.check(ip, 'ipv6') : V4.check(ip, 'ipv4');

/** Only public https endpoints (no localhost, private ranges or metadata IPs). */
export function publicEndpoint(url: string) {
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (u.protocol !== 'https:' || u.username || u.password) return false;
  if (isIP(h)) return !blockedIp(h);
  return !(h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal') || h.endsWith('.local') || h === '::1' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80')
    || /^(0|10|127)\./.test(h) || /^169\.254\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(h));
}

/** Where the name points right now: every address must be public (a public name can resolve to 127.0.0.1). */
export async function resolvesPublic(url: string, resolve = (h: string) => lookup(h, { all: true, verbatim: true })) {
  if (!publicEndpoint(url)) return false;
  const h = new URL(url).hostname.replace(/^\[|\]$/g, '');
  if (isIP(h)) return true;
  try { const all = await resolve(h); return all.length > 0 && all.every(a => !blockedIp(a.address)); } catch { return false; }
}

/** One signed POST. Retries with backoff are the dispatcher's job; the delivery id lets the receiver drop duplicates. */
export async function deliver(url: string, secret: string, tenantId: string, e: OutEvent, f: typeof fetch = fetch): Promise<{ ok: boolean; status: number }> {
  if (f === fetch ? !(await resolvesPublic(url)) : !publicEndpoint(url)) return { ok: false, status: 400 }; // an injected fetch (tests) has no real network
  const body = JSON.stringify({ id: e.id, event: e.event, tenantId, at: e.at, data: e.data });
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 10_000);
  try {
    const r = await f(url, { method: 'POST', redirect: 'manual', signal: ctl.signal, body,
      headers: { 'content-type': 'application/json', 'user-agent': 'BorNiz-Webhooks/1', 'x-borniz-event': e.event, 'x-borniz-delivery': e.id, 'x-borniz-signature': signOutgoing(secret, body) } });
    return { ok: r.status >= 200 && r.status < 300, status: r.status };
  } catch { return { ok: false, status: 0 }; } finally { clearTimeout(timer); }
}

/** Delivers one event to one endpoint once (outbox key per event and connection): /api/webhooks/deliver and the
 *  automation worker. `duplicate` = another device already took it. */
export async function deliverOnce(tenant: string, key: string, url: string, secret: string, e: OutEvent): Promise<{ ok: boolean; status?: number | string; duplicate?: boolean }> {
  const c = await rpc<{ claimed: boolean; status?: string }>('bn_outbox_claim', { p_tenant: tenant, p_key: key, p_provider: 'webhook-out' });
  if (!c.claimed) return { ok: c.status === 'sent', duplicate: true, status: c.status };
  const r = await deliver(url, secret, tenant, { id: e.id, event: e.event, at: Number(e.at) || Date.now(), data: e.data });
  await rpc('bn_outbox_done', { p_tenant: tenant, p_key: key, p_provider_id: null, p_status: r.ok ? 'sent' : 'failed', p_error: r.ok ? null : `HTTP ${r.status}` });
  return { ok: r.ok, status: r.status };
}
