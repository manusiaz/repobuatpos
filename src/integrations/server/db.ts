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

export function pool(cell: string | null = null): pg.Pool {
  const url = cell ? (JSON.parse(process.env.BORNIZ_DB_CELLS || '{}') as Record<string, string>)[cell] : process.env.DATABASE_URL;
  if (!url) throw new HttpError(503, cell ? `BORNIZ_DB_CELLS has no database for ${cell}` : 'DATABASE_URL is not set');
  let p = pools.get(url);
  if (!p) { p = new pg.Pool({ connectionString: url, max: 10 }); p.on('error', () => {}); pools.set(url, p); }
  return p;
}

/** One transaction as the caller: anon (uid null) or the signed-in user. */
export async function as<T>(uid: string | null, cell: string | null, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool(cell).connect();
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

/** Where a merchant's data lives (registry on the platform), cached for a minute. null = the platform database. */
const cells = new Map<string, { at: number; cell: string | null }>();
export async function cellFor(tenant: string): Promise<string | null> {
  if (!UUID.test(tenant)) return null;
  const hit = cells.get(tenant);
  if (hit && Date.now() - hit.at < 60e3) return hit.cell;
  const r = await as(null, null, c => c.query('select public.bn_tenant_cell(null, $1::uuid) r', [tenant]));
  const cell = (r.rows[0]?.r as { cell?: string | null } | null)?.cell ?? null;
  cells.set(tenant, { at: Date.now(), cell });
  return cell;
}

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

/** Call public.<fn>(named args) as the caller, in the database of p_tenant. */
export async function call(fn: string, args: Record<string, unknown>, uid: string | null = null): Promise<unknown> {
  if (!/^bn_[a-z0-9_]+$/.test(fn)) throw new HttpError(404, 'Unknown function ' + fn);
  const tenant = typeof args.p_tenant === 'string' ? args.p_tenant : '';
  const cell = tenant ? await cellFor(tenant) : null;
  return as(uid, cell, async c => {
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
}

/** Shared secret for server-only functions: private.secrets 'server' of the database being called.
 *  Merchants on their own database: BORNIZ_CELLS = {"<cell>": "<that database's server secret>"}. */
export function serverSecret(cell?: string | null): string {
  const s = cell ? (JSON.parse(process.env.BORNIZ_CELLS || '{}') as Record<string, string>)[cell] : process.env.BORNIZ_SERVER_SECRET;
  if (!s) throw new HttpError(503, cell ? `BORNIZ_CELLS has no secret for ${cell}` : 'BORNIZ_SERVER_SECRET is not set');
  return s;
}
/** Server-secret function call, in the database of p_tenant. Database errors come back as their BNxxx message, never with arguments. */
export async function rpc<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T> {
  const cell = typeof args.p_tenant === 'string' ? await cellFor(args.p_tenant) : null;
  try { return await call(fn, { p_secret: serverSecret(cell), ...args }) as T; }
  catch (e) {
    if (e instanceof HttpError) throw e;
    const m = dbError(e).message;
    throw new HttpError(/BN018|not found/i.test(m) ? 404 : /BN016/.test(m) ? 503 : 400, m);
  }
}
