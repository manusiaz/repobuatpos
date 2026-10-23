// Sign-in accounts on our own PostgreSQL (db/platform.sql auth schema): scrypt passwords, opaque session tokens
// (only their sha256 is stored) in an HttpOnly cookie shared by every host of the root domain, TOTP second factor,
// one-time links for password reset. Platform database only: one account works for every business it belongs to.
import { createHash, createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { HttpError } from './http.ts';
import { pool } from './db.ts';

export const COOKIE = 'bn_session';
const DAYS = 30;
const scrypt = (pw: string, salt: Buffer) => new Promise<Buffer>((ok, no) => scryptCb(pw, salt, 32, (e, k) => (e ? no(e) : ok(k))));
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

export async function hashPassword(pw: string) { const salt = randomBytes(16); return `scrypt$${salt.toString('hex')}$${(await scrypt(pw, salt)).toString('hex')}`; }
export async function passwordOk(pw: string, stored: string | null) {
  const [kind, salt, key] = (stored ?? '').split('$');
  if (kind !== 'scrypt' || !salt || !key) return false;
  const got = await scrypt(pw, Buffer.from(salt, 'hex')), want = Buffer.from(key, 'hex');
  return got.length === want.length && timingSafeEqual(got, want);
}

export interface User { id: string; email: string | null; is_anonymous: boolean; user_metadata: Record<string, unknown>; /** this session passed the authenticator code */ mfa?: boolean }
const userRow = (r: Record<string, unknown>): User => ({ id: r.id as string, email: (r.email as string) ?? null, is_anonymous: !!r.is_anonymous, user_metadata: (r.meta as Record<string, unknown>) ?? {}, ...(r.mfa ? { mfa: true } : {}) });
export const db = () => pool(null);

/** The session token of this request: the cookie (browsers) or a bearer token (devices, scripts). */
export function tokenOf(req: Request): string | null {
  const b = /^Bearer\s+(.+)$/i.exec(req.headers.get('authorization') ?? '')?.[1];
  if (b) return b;
  const m = /(?:^|;\s*)bn_session=([A-Za-z0-9_-]+)/.exec(req.headers.get('cookie') ?? '');
  return m?.[1] ?? null;
}
export async function userOf(req: Request): Promise<User | null> {
  const t = tokenOf(req);
  if (!t) return null;
  const r = await db().query(`select u.id, u.email, u.is_anonymous, u.meta, s.mfa from auth.sessions s join auth.users u on u.id = s.user_id
    where s.token_hash = $1 and s.expires_at > now()`, [sha(t)]);
  return r.rows[0] ? userRow(r.rows[0]) : null;
}
export async function requireUser(req: Request) { const u = await userOf(req); if (!u) throw new HttpError(401, 'Sign in first'); return u; }

/** Cookie for this request's host: shared by bornis.id and every <slug>.bornis.id, Secure on https. */
export function cookie(req: Request, token: string | null): string {
  const url = new URL(req.url), host = (req.headers.get('host') ?? url.host).split(':')[0];
  const https = (req.headers.get('x-forwarded-proto') ?? url.protocol.replace(':', '')).includes('https');
  const root = process.env.NEXT_PUBLIC_BORNIZ_ROOT_DOMAIN || '';
  const domain = root && (host === root || host.endsWith('.' + root)) ? `; Domain=.${root}` : '';
  return `${COOKIE}=${token ?? ''}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${token ? DAYS * 86400 : 0}${domain}${https ? '; Secure' : ''}`;
}
export async function newSession(userId: string, mfa = false): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await db().query(`insert into auth.sessions (token_hash, user_id, expires_at, mfa) values ($1, $2, now() + make_interval(days => ${DAYS}), $3)`, [sha(token), userId, mfa]);
  await db().query('delete from auth.sessions where user_id = $1 and expires_at < now()', [userId]);
  return token;
}
export async function endSession(req: Request) { const t = tokenOf(req); if (t) await db().query('delete from auth.sessions where token_hash = $1', [sha(t)]); }

// ── sign-in guard: 10 tries per email + address in 15 minutes ──
const tries = new Map<string, { n: number; at: number }>();
export function guard(key: string) {
  const now = Date.now(), t = tries.get(key);
  if (t && now - t.at < 15 * 60e3 && t.n >= 10) throw new HttpError(429, 'Too many tries. Wait 15 minutes and try again.');
  tries.set(key, t && now - t.at < 15 * 60e3 ? { n: t.n + 1, at: t.at } : { n: 1, at: now });
  if (tries.size > 10000) tries.clear();
}
export const cleared = (key: string) => tries.delete(key);

export async function signUp(email: string, password: string, meta: Record<string, unknown>): Promise<User> {
  const e = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new HttpError(400, 'Enter a valid email.');
  if (password.length < 8) throw new HttpError(400, 'Passwords have at least 8 characters.');
  try {
    const r = await db().query('insert into auth.users (email, encrypted_password, meta) values ($1, $2, $3) returning id, email, is_anonymous, meta',
      [e, await hashPassword(password), JSON.stringify({ name: meta.name ?? '', phone: meta.phone ?? '' })]);
    return userRow(r.rows[0]);
  } catch (x) { if ((x as { code?: string }).code === '23505') throw new HttpError(409, 'User already registered'); throw x; }
}
/** Email + password (+ the TOTP code once a second factor is on). */
export async function signIn(email: string, password: string, code?: string): Promise<User> {
  const r = await db().query('select id, email, is_anonymous, meta, encrypted_password from auth.users where email = $1', [email.trim().toLowerCase()]);
  const u = r.rows[0];
  if (!u || !(await passwordOk(password, u.encrypted_password))) throw new HttpError(400, 'Invalid login credentials');
  const f = await db().query('select secret from auth.mfa_factors where user_id = $1 and verified', [u.id]);
  if (f.rowCount) {
    if (!code) throw Object.assign(new HttpError(401, 'Enter the 6-digit code from your authenticator app.'), { code: 'mfa_required' });
    if (!f.rows.some(x => totpOk(x.secret, code))) throw Object.assign(new HttpError(401, 'That code is not right. Try the newest one.'), { code: 'mfa_required' });
  }
  return userRow({ ...u, mfa: !!f.rowCount });
}
export async function anonymousUser(): Promise<User> {
  const r = await db().query("insert into auth.users (is_anonymous) values (true) returning id, email, is_anonymous, meta");
  return userRow(r.rows[0]);
}
/** A new password: only from a session opened in the last 15 minutes (a sign-in or the reset link), not any old
 *  cookie; every other session of the account ends with it. */
export async function setPassword(req: Request, userId: string, password: string) {
  if (password.length < 8) throw new HttpError(400, 'Passwords have at least 8 characters.');
  const t = sha(tokenOf(req) ?? '');
  const r = await db().query("select 1 from auth.sessions where token_hash = $1 and user_id = $2 and created_at > now() - interval '15 minutes'", [t, userId]);
  if (!r.rowCount) throw new HttpError(401, 'Log in again to change your password.');
  await db().query('update auth.users set encrypted_password = $2, updated_at = now() where id = $1', [userId, await hashPassword(password)]);
  await db().query('delete from auth.sessions where user_id = $1 and token_hash <> $2', [userId, t]);
}

// ── password reset: a one-time link, mailed through Resend when RESEND_API_KEY is set (else written to the server log) ──
export async function sendReset(email: string, link: (token: string) => string) {
  const r = await db().query('select id from auth.users where email = $1 and not is_anonymous', [email.trim().toLowerCase()]);
  if (!r.rowCount) return; // same answer either way: the form can't be used to find accounts
  const token = randomBytes(24).toString('base64url');
  await db().query("insert into auth.one_time (token_hash, user_id, purpose, expires_at) values ($1, $2, 'reset', now() + interval '1 hour')", [sha(token), r.rows[0].id]);
  const url = link(token), key = process.env.RESEND_API_KEY, from = process.env.BORNIZ_MAIL_FROM;
  if (!key || !from) { console.log(`[auth] password reset for ${email}: ${url}`); return; }
  const res = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [email.trim()], subject: 'Reset your BorNiz password', html: `<p>Open this link within an hour to choose a new password:</p><p><a href="${url}">${url}</a></p><p>If you didn't ask for it, ignore this email.</p>` }) });
  if (!res.ok) console.error('[auth] reset mail failed', res.status);
}
export async function useReset(token: string): Promise<string> {
  const r = await db().query("delete from auth.one_time where token_hash = $1 and purpose = 'reset' and expires_at > now() returning user_id", [sha(token)]);
  if (!r.rowCount) throw new HttpError(400, 'This reset link has expired. Ask for a new one.');
  await db().query('delete from auth.sessions where user_id = $1', [r.rows[0].user_id]); // whoever else was signed in is out
  return r.rows[0].user_id as string;
}

// ── TOTP (RFC 6238: HMAC-SHA1, 30 s, 6 digits) ──
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const b32 = (b: Buffer) => { let bits = '', out = ''; for (const x of b) bits += x.toString(2).padStart(8, '0'); for (let i = 0; i < bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)]; return out; };
const unb32 = (s: string) => { let bits = ''; for (const ch of s.replace(/=+$/, '')) bits += B32.indexOf(ch).toString(2).padStart(5, '0'); return Buffer.from(bits.match(/.{8}/g)!.map(x => parseInt(x, 2))); };
export function totp(secret: string, at = Date.now()): string {
  const c = Buffer.alloc(8); c.writeBigUInt64BE(BigInt(Math.floor(at / 30e3)));
  const h = createHmac('sha1', unb32(secret)).update(c).digest(), o = h[19] & 15;
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1e6)).padStart(6, '0');
}
export const totpOk = (secret: string, code: string) => [-1, 0, 1].some(w => totp(secret, Date.now() + w * 30e3) === code.replace(/\s/g, ''));
export async function mfaEnroll(user: User) {
  // a session that never passed the account's working code (a reset link, an old cookie) can't add its own authenticator
  if (!user.mfa && (await db().query('select 1 from auth.mfa_factors where user_id = $1 and verified', [user.id])).rowCount)
    throw new HttpError(401, 'Sign in with your current authenticator code before adding another.');
  const secret = b32(randomBytes(20));
  const r = await db().query('insert into auth.mfa_factors (user_id, secret) values ($1, $2) returning id', [user.id, secret]);
  const uri = `otpauth://totp/BorNiz:${encodeURIComponent(user.email ?? user.id)}?secret=${secret}&issuer=BorNiz`;
  return { id: r.rows[0].id as string, totp: { secret, uri } };
}
export async function mfaVerify(req: Request, userId: string, factorId: string, code: string) {
  const r = await db().query('select secret from auth.mfa_factors where id = $1 and user_id = $2', [factorId, userId]);
  if (!r.rowCount || !totpOk(r.rows[0].secret, code)) throw new HttpError(400, 'That code is not right. Try the newest one.');
  await db().query('update auth.mfa_factors set verified = true where id = $1', [factorId]);
  await db().query('update auth.sessions set mfa = true where token_hash = $1 and user_id = $2', [sha(tokenOf(req) ?? ''), userId]); // this session just proved the code
}
export const mfaList = async (userId: string) => (await db().query('select id, verified from auth.mfa_factors where user_id = $1 order by created_at', [userId])).rows
  .map(r => ({ id: r.id as string, status: r.verified ? 'verified' : 'unverified' }));
/** Turning a working second factor off takes a code from it: a stolen cookie alone cannot. */
export async function mfaRemove(userId: string, factorId: string, code: string) {
  const r = await db().query('select secret, verified from auth.mfa_factors where id = $1 and user_id = $2', [factorId, userId]);
  if (r.rows[0]?.verified && !totpOk(r.rows[0].secret, code)) throw new HttpError(400, 'Enter the current 6-digit code to turn it off.');
  await db().query('delete from auth.mfa_factors where id = $1 and user_id = $2', [factorId, userId]);
  await db().query('update auth.sessions set mfa = false where user_id = $1 and not exists (select 1 from auth.mfa_factors where user_id = $1 and verified)', [userId]);
}

