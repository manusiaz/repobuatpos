// The automation worker, its own process next to the app (deploy/borniz-worker.service): once a minute, for every business in
// this database, the rules a staff device runs while it is open, so they happen with every device closed:
//   gateway settlement (remoteFinalize) · approval escalation · late-kitchen check · alert sweep · the outbox (messages, webhooks)
// It is the same code as the devices (store commit on the server, src/data/store.ts onServerDB), with the same dedupe ids and
// outbox keys, so it is safe next to open devices. Every document it changes carries its old content as a precondition: a
// device that changed it in the meantime wins and the worker tries again next minute. One worker per database (advisory lock).
import { call, pool, rpc } from './db.ts';
import { invoiceFor } from '../../data/billing.ts';
import { HttpError } from './http.ts';
import { secretsOf } from './store.ts';
import { sendMessage } from './messaging/send.ts';
import { deliverOnce } from './webhooks/deliver.ts';
import { str } from './types.ts';
import type { Channel } from './messaging/index.ts';
import type { DB } from '../../data/schema.ts';
import { onServerDB, snapshot } from '../../data/store.ts';
import { diff, memberDB, WINDOW_MS, wire, type Doc, type Hint, type Op } from '../../data/remoteDocs.ts';
import { finalize, finalizeNeed } from '../../data/remoteFinalize.ts';
import { escalateDue, watchKitchen } from '../../data/actions.ts';
import { sweepAlerts } from '../../data/alerts/index.ts';
import { render, tick, type Result, type Transport } from '../../data/actions/dispatch.ts';

type Tenant = { id: string; slug: string; name: string; plan: string; cell?: string | null; trial?: boolean; unpaidSince?: number | null; hold?: boolean; cycle?: string; cycleFrom?: string | null };
const LOCK = 'borniz-worker', EVERY = 60e3, GATEWAY = ['qris', 'va', 'ewallet'];

/** A refused request is not retried by the outbox (same split as the browser transport). */
const result = (p: Promise<{ ok: boolean; status?: unknown; simulated?: boolean; duplicate?: boolean }>): Promise<Result> => p.then(
  r => ({ ok: r.ok, status: typeof r.status === 'string' ? r.status : undefined, simulated: r.simulated }),
  e => ({ ok: false, message: (e as Error).message, permanent: e instanceof HttpError && [400, 401, 403, 404, 422, 501].includes(e.status) }));

/** sent: the messages the server already marked (bn_outbox_done forwards sent / failed onto the document). */
function transport(t: Tenant, sent: Set<string>): Transport {
  return {
    message: x => result(sendMessage(t.id, { ...x, channel: x.channel as Channel }).then(r => { sent.add(x.messageId); return r; })),
    webhook: async (integrationId, e) => {
      const i = snapshot().integrations.find(x => x.id === integrationId);
      const secret = i ? (await secretsOf(t.id, i.id)).secret : '';
      return secret ? result(deliverOnce(t.id, `wh:${e.id}:${integrationId}`, str(i!.config.url), secret, e)) : { ok: false, message: 'Signing secret is not set', permanent: true };
    },
    hook: (h, e) => result(deliverOnce(t.id, `wh:${e.id}:studio`, h.url, h.secret, e)),
  };
}

async function load(t: Tenant): Promise<{ db: DB; stored: Map<string, unknown> }> {
  const since = Date.now() - WINDOW_MS, docs: Doc[] = [];
  for (let from = 0; ; from += 1000) {
    const page = await rpc<Doc[]>('bn_server_docs', { p_tenant: t.id, p_since: since, p_from: from });
    docs.push(...page);
    if (page.length < 1000) break;
  }
  const opening = await rpc<{ stock?: Record<string, unknown>[]; beans?: Record<string, unknown>[] }>('bn_server_opening', { p_tenant: t.id, p_before: since });
  const hint: Hint = {};
  return { db: memberDB(docs, opening, since, hint, t), stored: new Map(docs.map(d => [d.coll + '/' + d.id, d.data])) };
}

/** Writes what changed; each document that already existed must still hold what the worker read (a message's status
 *  excepted: the server moves it as the provider answers). Afterwards stored holds what was written. */
async function save(t: Tenant, before: DB, after: DB, stored: Map<string, unknown>, action: string, sent = new Set<string>()) {
  const ops: Op[] = diff(before, after).filter(o => !(o.coll === 'messages' && sent.has(o.id) && stored.has('messages/' + o.id)));
  if (!ops.length) return 0;
  for (const o of ops) {
    const old = stored.get(o.coll + '/' + o.id) as Record<string, unknown> | undefined;
    if (old) { const { status: _s, ...rest } = old; o.expect = o.coll === 'messages' ? rest : old; }
  }
  await rpc('bn_server_write', { p_tenant: t.id, p_ops: wire(ops), p_action: action });
  for (const o of ops) if (o.op === 'del') stored.delete(o.coll + '/' + o.id); else stored.set(o.coll + '/' + o.id, JSON.parse(JSON.stringify(o.data)));
  return ops.length;
}

const issued = new Set<string>(); // invoices this process already handed to the platform
export async function runTenant(t: Tenant, now = Date.now(), prices: Record<string, unknown> = {}) {
  let { db, stored } = await load(t);
  // BorNiz billing: this month's invoice, once (the platform keeps one per id); a billing error never stops the run
  const inv = invoiceFor(t, db.outlets.length, prices, now);
  if (inv && !issued.has(inv.id)) await rpc('bn_server_invoice', { p_tenant: t.id, p_id: inv.id, p_data: inv }).then(() => issued.add(inv.id), e => console.error('[worker] billing', t.slug, (e as Error).message));
  // gateway settlement first, one order per write: a device finishing the same order first is not an error
  const open = new Set(db.orders.filter(o => finalizeNeed(db, o.id)).map(o => o.id));
  for (const p of db.payments) {
    if (!open.has(p.orderId) || !GATEWAY.includes(p.method)) continue;
    open.delete(p.orderId);
    const need = finalizeNeed(db, p.orderId)!;
    const next = await onServerDB(structuredClone(db), () => finalize(snapshot(), p.orderId, need));
    try { await save(t, db, next, stored, need === 'settle' ? 'payment.settled' : 'payment.failed'); db = next; }
    catch { ({ db, stored } = await load(t)); }
  }
  const sent = new Set<string>();
  const next = await onServerDB(structuredClone(db), async () => {
    escalateDue(now); watchKitchen(now); sweepAlerts(now);
    await tick({ now, transport: transport(t, sent), render: render() });
  });
  return save(t, db, next, stored, 'automation', sent);
}

/** A moved business's own database follows the platform's hold (BN088 is checked there). */
async function holdIn(t: Tenant) {
  const here = await rpc<{ billing_hold?: boolean } | null>('bn_server_tenant_row', { p_tenant: t.id }, t.cell);
  if (here && !!here.billing_hold !== !!t.hold) await rpc('bn_server_tenant_sync', { p_tenant: t.id, p_row: await rpc('bn_server_tenant_row', { p_tenant: t.id }) }, t.cell);
}

let busy = false;
async function pass() {
  if (busy) return;
  busy = true;
  const c = await pool().connect().catch(() => null);
  try {
    if (!c || !(await c.query('select pg_try_advisory_lock(hashtext($1)) ok', [LOCK])).rows[0].ok) return; // another process runs it
    try {
      const prices = (await call('bn_public_prices', {}).catch(() => ({}))) as Record<string, unknown>;
      // an invoice unpaid 14 days holds the set-up (BN088)
      await rpc('bn_server_billing_holds', {}).catch(e => console.error('[worker] holds', (e as Error).message));
      for (const t of await rpc<Tenant[]>('bn_server_tenants', {})) {
        if (t.cell) await holdIn(t).catch(e => console.error('[worker] hold sync', t.slug, (e as Error).message)); // retried every pass until it matches
        const n = await runTenant(t, Date.now(), prices).catch(e => { console.error('[worker]', t.slug, (e as Error).message); return 0; });
        if (n) console.log('[worker]', t.slug, n, 'change(s)');
      }
    } finally { await c.query('select pg_advisory_unlock(hashtext($1))', [LOCK]); }
  } catch (e) { console.error('[worker]', (e as Error).message); }
  finally { c?.release(); busy = false; }
}

// node --env-file=.env.production --experimental-strip-types src/integrations/server/worker.ts [--once]  (npm run worker)
if (import.meta.url === `file://${process.argv[1]}`) {
  if (!process.env.DATABASE_URL || !process.env.BORNIZ_SERVER_SECRET) { console.error('[worker] needs DATABASE_URL and BORNIZ_SERVER_SECRET'); process.exit(1); }
  if (process.argv.includes('--once')) await pass().then(() => process.exit(0)); // one pass, then exit (checks, cron)
  console.log('[worker] running every minute');
  void pass(); setInterval(pass, EVERY);
}
