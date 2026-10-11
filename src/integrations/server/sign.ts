import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const hmac = (secret: string, data: string, algo: 'sha256' | 'sha512' = 'sha256') => createHmac(algo, secret).update(data).digest('hex');
export const sha = (data: string, algo: 'sha256' | 'sha512' = 'sha256') => createHash(algo).update(data).digest('hex');
export function safeEqual(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** X-BorNiz-Signature for outgoing webhooks: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>">. */
export const signOutgoing = (secret: string, body: string, t = Math.floor(Date.now() / 1000)) => `t=${t},v1=${hmac(secret, `${t}.${body}`)}`;
/** What a receiver runs. Rejects signatures older than `tolerance` seconds (replays). */
export function verifyOutgoing(secret: string, body: string, header: string, now = Math.floor(Date.now() / 1000), tolerance = 300) {
  const parts = Object.fromEntries(header.split(',').map(p => p.split('=') as [string, string]));
  const t = Number(parts.t);
  if (!t || !parts.v1 || Math.abs(now - t) > tolerance) return false;
  return safeEqual(parts.v1, hmac(secret, `${t}.${body}`));
}
