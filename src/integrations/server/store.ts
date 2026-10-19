// Server reads of integrations and their secrets (server-secret RPCs; secret values never leave the server).
import type { Integration, Order, Payment } from '../../data/schema.ts';
import type { Kind } from '../types.ts';
import type { Ctx } from './types.ts';
import { HttpError } from './http.ts';
import { as, rpc } from './db.ts';
import type { Member } from './auth.ts';

export const integrations = async (tenant: string, kind: Kind) => ((await rpc<Integration[] | null>('bn_integrations', { p_tenant: tenant, p_kind: kind })) ?? []).filter(i => i.enabled);
export const secretsOf = async (tenant: string, integrationId: string) => (await rpc<Record<string, string> | null>('bn_get_secrets', { p_tenant: tenant, p_integration: integrationId })) ?? {};
export const ctxOf = async (tenant: string, i: Integration): Promise<Ctx> => ({ config: i.config, secrets: await secretsOf(tenant, i.id) });

/** The active connection of a kind: this outlet's first, then the business-wide one; real drivers before simulators. */
export async function active(tenant: string, kind: Kind, outletId: string | null = null, only?: string): Promise<Integration> {
  const list = (await integrations(tenant, kind)).filter(i => !only || i.connector === only);
  const rank = (i: Integration) => (i.outletId === outletId && outletId ? 0 : i.outletId == null ? 2 : 9) + (/simulator/.test(i.connector) ? 1 : 0);
  const best = list.filter(i => rank(i) < 9).sort((a, b) => rank(a) - rank(b))[0];
  if (!best) throw new HttpError(409, `No ${kind} connection is set up. Owner: Settings → Integrations.`);
  return best;
}
/** One integration row, read as the signed-in member (RLS proves it belongs to their business). */
export async function integrationAsMember(m: Member, id: string): Promise<Integration> {
  const r = await as(m.userId, m.cell, c => c.query("select data from public.docs where tenant_id = $1 and coll = 'integrations' and id = $2", [m.tenantId, id]));
  if (!r.rowCount) throw new HttpError(404, 'Connection not found');
  return r.rows[0].data as Integration;
}
export const paymentOrder = (tenant: string, paymentId: string) => rpc<{ payment: (Payment & { provider?: string }) | null; order: Order | null }>('bn_payment_order', { p_tenant: tenant, p_payment_id: paymentId });
/** Values of a tool the owner published in Studios (the newest published version), read as the member: server routes
 *  take endpoints and senders from here, never from a request body. */
export async function publishedTool(m: Member, tool: string): Promise<Record<string, unknown>> {
  const r = await as(m.userId, m.cell, c => c.query(`select data->'data'->'values' v from public.docs where tenant_id = $1 and coll = 'versions'
    and data->>'kind' = 'page' and data->>'status' = 'published' and data->'data'->>'tool' = $2 order by (data->>'at')::bigint desc limit 1`, [m.tenantId, tool]));
  return (r.rows[0]?.v ?? {}) as Record<string, unknown>;
}
