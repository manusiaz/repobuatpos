// BorNiz's own backend API on PostgreSQL (replaces the Supabase client): the browser calls
//   POST rpc/<bn_fn>      a public bn_* database function, as the signed-in user (or anon)  → { data } | { error }
//   POST read/<what>      members (my businesses), docs (a business's documents, paged), audit (latest rows)
//   POST auth/<what>      signup, signin, anonymous, signout, user, update, reset, recover, mfa/list|enroll|verify|unenroll
//   GET  live?tenant=     server-sent events: changed documents and audit rows of a business I belong to
import { HttpError, UUID } from '../../../../src/integrations/server/http.ts';
import { DEMO, as, call, cellFor, dbError } from '../../../../src/integrations/server/db.ts';
import * as auth from '../../../../src/integrations/server/session.ts';
import { subscribe } from '../../../../src/integrations/server/live.ts';
import { ownsHost } from '../../../../src/system/hosts.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const out = (data: unknown, headers: Record<string, string> = {}) => Response.json({ data, error: null }, { headers: { 'cache-control': 'no-store', ...headers } });
const fail = (e: unknown) => {
  const status = (e as { status?: number }).status ?? 400;
  if (status >= 500 && !(e instanceof HttpError)) console.error('[bn]', (e as Error).message);
  return Response.json({ data: null, error: status >= 500 && !(e instanceof HttpError) ? { message: 'Server error' } : dbError(e) }, { status, headers: { 'cache-control': 'no-store' } });
};
const withSession = (req: Request, data: unknown, token: string | null) => out(data, { 'set-cookie': auth.cookie(req, token) });
const ip = (req: Request) => req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'local';
/** Reset links only ever point back at this deployment (no open redirect in a mail): a Host or redirectTo this
 *  deployment does not serve is refused, whatever a client or a misrouted proxy sends. */
function ownUrl(req: Request, wanted: unknown, fallback: string) {
  const u = new URL(req.url), host = req.headers.get('host') ?? u.host;
  if (!ownsHost(host)) throw new HttpError(400, 'Unknown host');
  try { const w = new URL(String(wanted)); if (/^https?:$/.test(w.protocol) && ownsHost(w.host)) return w.origin + w.pathname; } catch { /* not a URL */ }
  return `${req.headers.get('x-forwarded-proto') ?? u.protocol.replace(':', '')}://${host}${fallback}`;
}

export async function POST(req: Request, { params }: { params: Promise<{ op: string[] }> }) {
  if (DEMO) return fail(new HttpError(404, 'No database: this deployment runs the demo in the browser'));
  const [kind, ...rest] = (await params).op, name = rest.join('/');
  let b: Record<string, any> = {};
  try { b = await req.json(); } catch { /* empty body */ }
  try {
    if (kind === 'rpc') return out(await call(name, b, (await auth.userOf(req))?.id ?? null));
    if (kind === 'read') {
      const u = await auth.requireUser(req);
      if (name === 'members') return out((await as(u.id, null, c => c.query(`select m.tenant_id, m.employee_id, m.role, t.slug, t.name, t.plan
        from public.members m join public.tenants t on t.id = m.tenant_id where m.user_id = $1 order by t.created_at`, [u.id]))).rows);
      if (!UUID.test(String(b.tenant))) throw new HttpError(400, 'Bad tenant id');
      const cell = await cellFor(b.tenant);
      if (name === 'docs') return out((await as(u.id, cell, c => c.query(`select coll, id, data from public.docs where tenant_id = $1 and (t is null or t >= $2 or open)
        order by coll, id limit 1000 offset $3`, [b.tenant, Number(b.since) || 0, Number(b.from) || 0]))).rows);
      if (name === 'audit') return out((await as(u.id, cell, c => c.query(`select id, actor, action, subject, outlet_id, at from public.audit_log
        where tenant_id = $1 order by at desc limit 500`, [b.tenant]))).rows);
      throw new HttpError(404, 'Unknown read ' + name);
    }
    if (kind === 'auth') {
      switch (name) {
        case 'signup': { const u = await auth.signUp(String(b.email ?? ''), String(b.password ?? ''), b.data ?? {}); return withSession(req, { user: u }, await auth.newSession(u.id)); }
        case 'signin': {
          const key = ip(req) + '|' + String(b.email ?? '').toLowerCase();
          auth.guard(key);
          const u = await auth.signIn(String(b.email ?? ''), String(b.password ?? ''), b.code ? String(b.code) : undefined);
          auth.cleared(key);
          return withSession(req, { user: u }, await auth.newSession(u.id));
        }
        case 'anonymous': { auth.guard(ip(req) + '|anonymous'); const u = await auth.anonymousUser(); await auth.endSession(req); return withSession(req, { user: u }, await auth.newSession(u.id)); }
        case 'signout': await auth.endSession(req); return withSession(req, null, null);
        case 'user': return out({ user: await auth.userOf(req) });
        case 'update': { const u = await auth.requireUser(req); if (b.password) await auth.setPassword(req, u.id, String(b.password)); return out({ user: u }); }
        case 'reset': {
          auth.guard(ip(req) + '|reset');
          const to = ownUrl(req, b.redirectTo, '/account/reset-password');
          await auth.sendReset(String(b.email ?? ''), t => `${to}#bn_reset=${t}`);
          return out({});
        }
        case 'recover': { const uid = await auth.useReset(String(b.token ?? '')); return withSession(req, {}, await auth.newSession(uid)); }
        case 'mfa/list': return out({ totp: await auth.mfaList((await auth.requireUser(req)).id) });
        case 'mfa/enroll': return out(await auth.mfaEnroll(await auth.requireUser(req)));
        case 'mfa/verify': await auth.mfaVerify((await auth.requireUser(req)).id, String(b.factorId ?? ''), String(b.code ?? '')); return out({});
        case 'mfa/unenroll': await auth.mfaRemove((await auth.requireUser(req)).id, String(b.factorId ?? ''), String(b.code ?? '')); return out({});
      }
      throw new HttpError(404, 'Unknown auth action ' + name);
    }
    throw new HttpError(404, 'Unknown API ' + kind);
  } catch (e) { return fail(e); }
}

/** GET live?tenant=<id>: server-sent events for one business the signed-in user belongs to. */
export async function GET(req: Request, { params }: { params: Promise<{ op: string[] }> }) {
  if (DEMO || (await params).op.join('/') !== 'live') return fail(new HttpError(404, 'Not found'));
  try {
    const u = await auth.requireUser(req), tenant = new URL(req.url).searchParams.get('tenant') ?? '';
    if (!UUID.test(tenant) || !(await call('bn_is_member', { p_tenant: tenant }, u.id))) throw new HttpError(403, 'Not a member of this business');
    const cell = await cellFor(tenant), enc = new TextEncoder();
    let stop = () => {};
    const stream = new ReadableStream({
      start(ctl) {
        const send = (event: string, data: unknown) => { try { ctl.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)); } catch { stop(); } };
        const off = subscribe({ tenant, uid: u.id, cell, send });
        // proxies close quiet connections; a signed-out or expired session stops receiving here too
        const beat = setInterval(() => auth.userOf(req).then(x => (x?.id === u.id ? send('ping', {}) : end()), () => send('ping', {})), 25e3);
        const end = () => { stop(); try { ctl.close(); } catch { /* closed */ } };
        stop = () => { clearInterval(beat); off(); };
        send('ready', {});
        req.signal.addEventListener('abort', end);
      },
      cancel() { stop(); },
    });
    return new Response(stream, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store', 'x-accel-buffering': 'no', connection: 'keep-alive' } });
  } catch (e) { return fail(e); }
}
