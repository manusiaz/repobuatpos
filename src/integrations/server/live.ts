// Live updates: one LISTEN bn_live connection per database; every browser stream (/api/bn/live) gets the changed rows of
// its business, read as that user (RLS). After a reconnect each stream is told to reload (events may have been missed).
import pg from 'pg';
import { as } from './db.ts';

export interface Sub { tenant: string; uid: string; cell: string | null; send: (event: string, data: unknown) => void }
interface Hub { subs: Set<Sub>; client: pg.Client | null }
const g = globalThis as { bnLive?: Map<string, Hub> };
const hubs = (g.bnLive ??= new Map());
type Note = { t: string; k: 'doc' | 'audit'; c?: string; i: string | number; d?: boolean };

async function deliver(s: Sub, n: Note) {
  try {
    if (n.k === 'doc') {
      if (n.d) return s.send('doc', { tenant_id: n.t, coll: n.c, id: n.i, data: null });
      const r = await as(s.uid, s.cell, c => c.query('select tenant_id, coll, id, data from public.docs where tenant_id = $1 and coll = $2 and id = $3', [n.t, n.c, n.i]));
      if (r.rows[0]) s.send('doc', r.rows[0]);
    } else {
      const r = await as(s.uid, s.cell, c => c.query('select id, actor, action, subject, outlet_id, at from public.audit_log where tenant_id = $1 and id = $2', [n.t, n.i]));
      if (r.rows[0]) s.send('audit', r.rows[0]);
    }
  } catch { /* the stream reloads on its next reset */ }
}
function connect(key: string, hub: Hub) {
  const url = key ? (JSON.parse(process.env.BORNIZ_DB_CELLS || '{}') as Record<string, string>)[key] : process.env.DATABASE_URL;
  if (!url) return;
  const c = new pg.Client({ connectionString: url });
  hub.client = c;
  const retry = () => { if (hub.client !== c) return; hub.client = null; c.end().catch(() => {}); setTimeout(() => { if (hub.subs.size) { connect(key, hub); hub.subs.forEach(s => s.send('reset', {})); } }, 2000); };
  c.on('error', retry); c.on('end', retry);
  c.on('notification', m => { try { const n = JSON.parse(m.payload ?? '') as Note; hub.subs.forEach(s => { if (s.tenant === n.t) void deliver(s, n); }); } catch { /* not ours */ } });
  c.connect().then(() => c.query('listen bn_live')).catch(retry);
}
/** Start listening for one business; returns the unsubscribe. */
export function subscribe(s: Sub): () => void {
  const key = s.cell ?? '';
  let hub = hubs.get(key);
  if (!hub) { hub = { subs: new Set(), client: null }; hubs.set(key, hub); }
  hub.subs.add(s);
  if (!hub.client) connect(key, hub);
  return () => { hub!.subs.delete(s); };
}
