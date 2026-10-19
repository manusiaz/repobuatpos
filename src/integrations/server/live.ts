// Live updates: one LISTEN bn_live connection per database; every browser stream (/api/bn/live) gets the changed rows of
// its business, read as that user (RLS). After a reconnect each stream is told to reload (events may have been missed).
// Changes arriving together (one commit of 100 documents) are read once per account, not once per change and screen,
// on the live connections of db.ts, so many open screens never hold up requests.
import pg from 'pg';
import { as } from './db.ts';

export interface Sub { tenant: string; uid: string; cell: string | null; send: (event: string, data: unknown) => void }
interface Hub { subs: Set<Sub>; client: pg.Client | null; pending: Note[]; timer: ReturnType<typeof setTimeout> | null }
const g = globalThis as { bnLive?: Map<string, Hub> };
const hubs = (g.bnLive ??= new Map());
type Note = { t: string; k: 'doc' | 'audit'; c?: string; i: string | number; d?: boolean };
const BATCH_MS = 25;

/** One account's view of a batch of changes of one business: the documents and audit rows it may see, in one read. */
async function deliver(tenant: string, uid: string, cell: string | null, notes: Note[], to: Sub[]) {
  const gone = notes.filter(n => n.k === 'doc' && n.d), docs = new Map<string, Note>(), audit = new Set<number>();
  for (const n of notes) if (n.k === 'doc' && !n.d) docs.set(n.c + '\u0000' + n.i, n); else if (n.k === 'audit') audit.add(Number(n.i));
  try {
    const [d, a] = await as(uid, cell, async c => [
      docs.size ? (await c.query('select tenant_id, coll, id, data from public.docs where tenant_id = $1 and (coll, id) in (select * from unnest($2::text[], $3::text[]))',
        [tenant, [...docs.values()].map(n => n.c), [...docs.values()].map(n => String(n.i))])).rows : [],
      audit.size ? (await c.query('select id, actor, action, subject, outlet_id, at from public.audit_log where tenant_id = $1 and id = any($2::bigint[]) order by id', [tenant, [...audit]])).rows : [],
    ], true);
    for (const s of to) {
      for (const n of gone) s.send('doc', { tenant_id: tenant, coll: n.c, id: n.i, data: null });
      for (const r of d) s.send('doc', r);
      for (const r of a) s.send('audit', r);
    }
  } catch { /* the stream reloads on its next reset */ }
}
function flush(hub: Hub) {
  hub.timer = null;
  const notes = hub.pending; hub.pending = [];
  const by = new Map<string, { tenant: string; uid: string; cell: string | null; subs: Sub[] }>();
  for (const s of hub.subs) { const k = s.tenant + '|' + s.uid; (by.get(k) ?? by.set(k, { tenant: s.tenant, uid: s.uid, cell: s.cell, subs: [] }).get(k)!).subs.push(s); }
  for (const x of by.values()) { const mine = notes.filter(n => n.t === x.tenant); if (mine.length) void deliver(x.tenant, x.uid, x.cell, mine, x.subs); }
}
function connect(key: string, hub: Hub) {
  const url = key ? (JSON.parse(process.env.BORNIZ_DB_CELLS || '{}') as Record<string, string>)[key] : process.env.DATABASE_URL;
  if (!url) return;
  const c = new pg.Client({ connectionString: url });
  hub.client = c;
  const retry = () => { if (hub.client !== c) return; hub.client = null; c.end().catch(() => {}); setTimeout(() => { if (hub.subs.size) { connect(key, hub); hub.subs.forEach(s => s.send('reset', {})); } }, 2000); };
  c.on('error', retry); c.on('end', retry);
  c.on('notification', m => {
    try { hub.pending.push(JSON.parse(m.payload ?? '') as Note); } catch { return; /* not ours */ }
    hub.timer ??= setTimeout(() => flush(hub), BATCH_MS);
  });
  c.connect().then(() => c.query('listen bn_live')).catch(retry);
}
/** Start listening for one business; returns the unsubscribe. */
export function subscribe(s: Sub): () => void {
  const key = s.cell ?? '';
  let hub = hubs.get(key);
  if (!hub) { hub = { subs: new Set(), client: null, pending: [], timer: null }; hubs.set(key, hub); }
  hub.subs.add(s);
  if (!hub.client) connect(key, hub);
  return () => { hub!.subs.delete(s); };
}
