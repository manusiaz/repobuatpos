// POST { integrationId, values } from src/integrations/secrets.ts (owner / manager). Only the connector's secret fields
// are accepted; they go to bn_set_secret (private schema). Answers which keys are stored, never the values.
import { member } from '../../../../src/integrations/server/auth.ts';
import { HttpError, body, handle, json } from '../../../../src/integrations/server/http.ts';
import { DEMO } from '../../../../src/integrations/server/supabase.ts';
import { integrationAsMember } from '../../../../src/integrations/server/store.ts';
import { connector } from '../../../../src/integrations/registry.ts';
import type { Integration } from '../../../../src/data/schema.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = handle(async (req: Request) => {
  const b = await body<{ integrationId?: string; values?: Record<string, unknown>; tenantId?: string }>(req);
  if (!b.integrationId || !b.values || typeof b.values !== 'object') throw new HttpError(400, 'integrationId and values are required');
  if (DEMO) throw new HttpError(400, 'Demo mode keeps secrets in this browser');
  const m = await member(req, ['owner', 'manager'], b.tenantId);
  let i: Integration | null = null;
  for (let n = 0; !i; n++) { // the row was just committed by the same tap; the adapter may still be writing it
    try { i = await integrationAsMember(m.db, m.tenantId, b.integrationId); } catch (e) { if (n >= 4) throw e; await new Promise(r => setTimeout(r, 300)); }
  }
  const keys = new Set(connector(i.connector)?.fields.filter(f => f.type === 'secret').map(f => f.key) ?? []);
  const values = Object.fromEntries(Object.entries(b.values).filter(([k, v]) => keys.has(k) && typeof v === 'string' && v && v.length <= 4096));
  if (!Object.keys(values).length) throw new HttpError(400, 'No secret fields in the request');
  const { error } = await m.db.rpc('bn_set_secret', { p_tenant: m.tenantId, p_integration: i.id, p_values: values });
  if (error) throw new HttpError(400, error.message);
  return json({ ok: true, keys: Object.keys(values) });
});
