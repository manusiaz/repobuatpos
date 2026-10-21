// BorNiz's own backend API on PostgreSQL (replaces the Supabase client): the browser calls
//   POST rpc/<bn_fn>      a public bn_* database function, as the signed-in user (or anon)  → { data } | { error }
//   POST read/<what>      members (my businesses), docs (a business's documents, paged), audit (latest rows)
//   POST auth/<what>      signup, signin, anonymous, signout, user, update, reset, recover, mfa/list|enroll|verify|unenroll
//   GET  live?tenant=     server-sent events: changed documents and audit rows of a business I belong to
import { HttpError, UUID } from '../../../../src/integrations/server/http.ts';
import { DEMO, as, call, cellFor, dbError, rpc } from '../../../../src/integrations/server/db.ts';
import * as auth from '../../../../src/integrations/server/session.ts';
import { subscribe } from '../../../../src/integrations/server/live.ts';
import { config, hostOf, ownsHost, resolve } from '../../../../src/system/hosts.ts';

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
 *  deployment does not serve (a forged header, the server's IP) gets the link on the deployment's own address. */
function ownUrl(req: Request, wanted: unknown, fallback: string) {
  const u = new URL(req.url), host = req.headers.get('host') ?? u.host, cfg = config();
  if (!ownsHost(host)) return `${cfg.protocol}://${cfg.routing === 'path' ? cfg.root : hostOf('app', cfg)}${fallback}`; // sign-in lives on app.
  try { const w = new URL(String(wanted)); if (/^https?:$/.test(w.protocol) && ownsHost(w.host)) return w.origin + w.pathname; } catch { /* not a URL */ }
  return `${req.headers.get('x-forwarded-proto') ?? u.protocol.replace(':', '')}://${host}${fallback}`;
}

export async function POST(req: Request, { params }: { params: Promise<{ op: string[] }> }) {
  if (DEMO) return fail(new HttpError(404, 'No database: this deployment runs the demo in the browser'));
  const [kind, ...rest] = (await params).op, name = rest.join('/');
  // only this deployment's own pages, as JSON (a browser always asks before sending that cross-origin): a form posted
  // from another page, or another business's host, never acts with the session cookie of .bornis.id
  const origin = req.headers.get('origin'), host = req.headers.get('host') ?? new URL(req.url).host;
  if (!/^application\/json\b/.test(req.headers.get('content-type') ?? '') || (origin && origin !== 'null' && new URL(origin).host !== host))
    return fail(new HttpError(403, 'This page may not call BorNiz'));
  let b: Record<string, any> = {};
  try { b = await req.json(); } catch { /* empty body */ }
  try {
    if (kind === 'rpc') {
      const host = (resolve(req.headers.get('host') ?? '', '/', config()) as { query?: { tenant?: string } }).query?.tenant ?? null;
      const me = await auth.userOf(req), uid = me?.id ?? null;
      // the super admin console needs a sign-in with the authenticator code, checked here for every console call
      if (/^bn_admin_/.test(name) && !me?.mfa) throw new HttpError(403, 'BN077 BorNiz staff sign in with an authenticator code. Turn on two-step sign-in, then sign in again.');
      // support access runs in the business's own database: BorNiz staff are checked here, on the platform, first
      const SUPPORT: Record<string, [string, string]> = { bn_admin_support_state: ['bn_server_support_state', ''], bn_admin_support_docs: ['bn_server_support_docs', 'support.read'], bn_admin_support_end: ['bn_server_support_end', 'support.ended'] };
      if (SUPPORT[name]) {
        if (!(await call('bn_is_platform_admin', {}, uid))) throw new HttpError(403, 'BN070 BorNiz staff only');
        if (!UUID.test(String(b.p_tenant))) throw new HttpError(400, 'Bad tenant id');
        const [fn, logged] = SUPPORT[name], res = await rpc(fn, { p_tenant: b.p_tenant, ...(b.p_id ? { p_id: String(b.p_id) } : {}) });
        if (logged) await call('bn_admin_note', { p_action: logged, p_subject: String(b.p_tenant) }, uid);
        return out(res);
      }
      const r = await call(name, b, uid, req.headers.get('x-borniz-tenant') || host);
      if (name === 'bn_admin_request_access' && typeof r === 'string' && await cellFor(String(b.p_tenant))) // a moved business: the request goes to its database
        await rpc('bn_server_support_request', { p_tenant: b.p_tenant, p_id: r, p_hours: b.p_hours, p_reason: b.p_reason, p_ticket: b.p_ticket ?? null });
      // a moved business keeps its own copy of plan, status and trial: the registry changed here, the business's database next
      if (/^bn_(admin_set_(plan|status|trial)|start_trial)$/.test(name) && typeof b.p_tenant === 'string') {
        const row = await rpc<{ cell: string | null } & Record<string, unknown>>('bn_server_tenant_row', { p_tenant: b.p_tenant });
        if (row?.cell) await rpc('bn_server_tenant_sync', { p_tenant: b.p_tenant, p_row: row }, row.cell);
      }
      return out(r);
    }
    if (kind === 'read') {
      const u = await auth.requireUser(req);
      if (name === 'members') return out((await as(u.id, null, c => c.query(`select m.tenant_id, m.employee_id, m.role, t.slug, t.name, public.bn_plan_now(t.plan, t.trial_until) plan, t.status,
          (extract(epoch from t.trial_until) * 1000)::bigint trial_until
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
          const { mfa, ...u } = await auth.signIn(String(b.email ?? ''), String(b.password ?? ''), b.code ? String(b.code) : undefined);
          auth.cleared(key);
          return withSession(req, { user: u }, await auth.newSession(u.id, mfa));
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
        case 'mfa/verify': await auth.mfaVerify(req, (await auth.requireUser(req)).id, String(b.factorId ?? ''), String(b.code ?? '')); return out({});
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
