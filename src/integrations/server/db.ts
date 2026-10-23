// The one database client for API routes: PostgreSQL pools (platform = DATABASE_URL; a merchant moved to its own
// database = BORNIZ_DB_CELLS {"<cell>":"postgres://…"}). Every query runs as its caller — anon, or authenticated with
// request.jwt.claim.sub = the signed-in user — so the migrations' grants and RLS decide what it may see and do.
// Without DATABASE_URL the routes run in demo mode (the browser keeps the data).
import pg from 'pg';
import { HttpError, UUID } from './http.ts';

pg.types.setTypeParser(20, v => Number(v)); // bigint (sequences, ms timestamps) as a number, like the JSON API it replaces

export const DEMO = !process.env.DATABASE_URL;
const g = globalThis as { bnPools?: Map<string, pg.Pool> };
const pools = (g.bnPools ??= new Map());

/** Connections of one database: 10 for requests; live updates read on their own 3 (live.ts), so a burst of changes
 *  on many open screens never makes a sign-in or a sale wait for a connection. */
export function pool(cell: string | null = null, live = false): pg.Pool {
  const url = cell ? (JSON.parse(process.env.BORNIZ_DB_CELLS || '{}') as Record<string, string>)[cell] : process.env.DATABASE_URL;
  if (!url) throw new HttpError(503, cell ? `BORNIZ_DB_CELLS has no database for ${cell}` : 'DATABASE_URL is not set');
  const key = (live ? 'live|' : '') + url;
  let p = pools.get(key);
  if (!p) { p = new pg.Pool({ connectionString: url, max: live ? 3 : 10 }); p.on('error', () => {}); pools.set(key, p); }
  return p;
}

/** One transaction as the caller: anon (uid null) or the signed-in user. */
export async function as<T>(uid: string | null, cell: string | null, fn: (c: pg.PoolClient) => Promise<T>, live = false): Promise<T> {
  const c = await pool(cell, live).connect();
  try {
    await c.query('begin');
    await c.query(uid ? 'set local role authenticated' : 'set local role anon');
    await c.query("select set_config('request.jwt.claim.sub', $1, true)", [uid ?? '']);
    const r = await fn(c);
    await c.query('commit');
    return r;
  } catch (e) { await c.query('rollback').catch(() => {}); throw e; }
  finally { c.release(); }
}

/** Where a merchant's data lives (registry on the platform), by id or by its address, cached for a minute. null = the platform database. */
const cells = new Map<string, { at: number; cell: string | null }>();
async function cellBy(key: string, slug: string | null, id: string | null): Promise<string | null> {
  const hit = cells.get(key);
  if (hit && Date.now() - hit.at < 60e3) return hit.cell;
  const r = await as(null, null, c => c.query('select public.bn_tenant_cell($1::text, $2::uuid) r', [slug, id]));
  const cell = (r.rows[0]?.r as { cell?: string | null } | null)?.cell ?? null;
  cells.set(key, { at: Date.now(), cell });
  return cell;
}
export const cellFor = (tenant: string) => (UUID.test(tenant) ? cellBy(tenant, null, tenant) : Promise.resolve(null));
const cellForSlug = (slug: string) => cellBy('slug:' + slug, slug, null);

/** Platform-only functions (accounts, registry, super admin) never go to a merchant's own database. */
const PLATFORM = /^bn_(admin_|tenant_cell$|bootstrap$|server_tenants$|is_platform_admin$|start_trial$|server_tenant_row$|public_prices$|server_invoice$|my_invoices$|open_ticket$|my_tickets$)/; // the registry lives on the platform
/** The database a call belongs to: the business in p_tenant, or at p_slug, or the hint (an id, or the slug of the host asked). */
async function cellOf(fn: string, args: Record<string, unknown>, hint?: string | null): Promise<string | null> {
  if (PLATFORM.test(fn)) return null;
  if (typeof args.p_tenant === 'string') return cellFor(args.p_tenant);
  if (typeof args.p_slug === 'string') return cellForSlug(args.p_slug);
  return hint ? (UUID.test(hint) ? cellFor(hint) : cellForSlug(hint)) : null;
}
/** A merchant's database holds its members, so the signed-in account must exist there too (sign-in stays on the
 *  platform): a device that joins a moved business, or a new manager, gets its row copied before the call. */
const synced = new Set<string>();
async function ensureUser(cell: string, uid: string) {
  if (synced.has(cell + uid)) return;
  const u = (await pool(null).query('select id, email, is_anonymous, meta from auth.users where id = $1', [uid])).rows[0];
  if (u) await pool(cell).query('insert into auth.users (id, email, is_anonymous, meta) values ($1, $2, $3, $4) on conflict do nothing', [u.id, u.email, u.is_anonymous, u.meta]);
  synced.add(cell + uid);
}
/** "BN050 This business moved to its own database (<cell>)": the frozen copy answered; the call belongs there. */
const movedTo = (e: unknown) => /^BN050 .*\(([a-z0-9][a-z0-9-]*)\)/.exec(String((e as { message?: string }).message ?? ''))?.[1] ?? null;

/** Argument names and types of a public bn_* function, read from the database itself (so new migrations just work). */
const sigs = new Map<string, Map<string, string>>();
async function signature(c: pg.PoolClient, key: string, fn: string): Promise<Map<string, string>> {
  const k = key + '|' + fn;
  let s = sigs.get(k);
  if (!s) {
    const r = await c.query(`select n, format_type(t, null) ty from pg_proc p join pg_namespace s on s.oid = p.pronamespace,
      unnest(p.proargnames[1:p.pronargs], p.proargtypes::oid[]) u(n, t) where s.nspname = 'public' and p.proname = $1`, [fn]);
    if (!r.rowCount) {
      const any = await c.query(`select 1 from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname = $1`, [fn]);
      if (!any.rowCount) throw new HttpError(404, 'Unknown function ' + fn);
    }
    s = new Map(r.rows.map(x => [x.n as string, x.ty as string]));
    sigs.set(k, s);
  }
  return s;
}

export interface DbError { message: string; code?: string }
/** A database error as the client sees it: the BNxxx sentence and the SQLSTATE (23505 = taken), never the SQL. */
export const dbError = (e: unknown): DbError => {
  const x = e as { message?: string; code?: string; status?: number };
  return { message: x.status ? String(x.message) : String(x.message ?? 'Database error').split('\n')[0], code: x.code };
};

/** Call public.<fn>(named args) as the caller, in the business's database (cellOf); a call the frozen shared copy
 *  answers with BN050 runs again in the database it names. `hint` = the business of the request (X-BorNiz-Tenant, or the <slug>. host). */
export async function call(fn: string, args: Record<string, unknown>, uid: string | null = null, hint: string | null = null, to?: string | null): Promise<unknown> {
  if (!/^bn_[a-z0-9_]+$/.test(fn)) throw new HttpError(404, 'Unknown function ' + fn);
  const cell = to !== undefined ? to : await cellOf(fn, args, hint);
  if (cell && uid) await ensureUser(cell, uid);
  try {
    return await as(uid, cell, async c => {
      const types = await signature(c, cell ?? '', fn), names = Object.keys(args).filter(n => args[n] !== undefined), values: unknown[] = [];
      const list = names.map((n, i) => {
        const ty = types.get(n);
        if (!ty || !/^[a-z_][a-z0-9_]*$/.test(n)) throw new HttpError(400, `${fn} has no argument ${n}`);
        const v = args[n];
        values.push(v === null ? null : ty === 'jsonb' || ty === 'json' ? JSON.stringify(v) : v);
        return `${n} => $${i + 1}::${ty}`;
      });
      const r = await c.query(`select public.${fn}(${list.join(', ')}) as r`, values);
      return r.rows[0]?.r ?? null;
    });
  } catch (e) {
    const moved = cell === null && !PLATFORM.test(fn) ? movedTo(e) : null;
    if (!moved) throw e;
    return call(fn, 'p_secret' in args ? { ...args, p_secret: serverSecret(moved) } : args, uid, hint, moved);
  }
}

/** Shared secret for server-only functions: private.secrets 'server' of the database being called.
 *  Merchants on their own database: BORNIZ_CELLS = {"<cell>": "<that database's server secret>"}. */
export function serverSecret(cell?: string | null): string {
  const s = cell ? (JSON.parse(process.env.BORNIZ_CELLS || '{}') as Record<string, string>)[cell] : process.env.BORNIZ_SERVER_SECRET;
  if (!s) throw new HttpError(503, cell ? `BORNIZ_CELLS has no secret for ${cell}` : 'BORNIZ_SERVER_SECRET is not set');
  return s;
}
/** Server-secret function call, in the database of p_tenant. Database errors come back as their BNxxx message, never with arguments. */
/** to: run in this database (a cell id; null = the platform) instead of the one the arguments name. */
export async function rpc<T = unknown>(fn: string, args: Record<string, unknown>, to?: string | null): Promise<T> {
  const cell = to !== undefined ? to : await cellOf(fn, args);
  try { return await call(fn, { p_secret: serverSecret(cell), ...args }, null, null, cell) as T; }
  catch (e) {
    if (e instanceof HttpError) throw e;
    const m = dbError(e).message;
    throw new HttpError(/BN018|not found/i.test(m) ? 404 : /BN016/.test(m) ? 503 : 400, m);
  }
}
