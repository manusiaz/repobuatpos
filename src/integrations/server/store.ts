// Server reads of integrations and their secrets (server-secret RPCs; secret values never leave the server).
import type { Integration, Order, Payment } from '../../data/schema.ts';
import type { Kind } from '../types.ts';
import type { Ctx } from './types.ts';
import { HttpError } from './http.ts';
import { rpc } from './supabase.ts';

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
export async function integrationAsMember(db: import('@supabase/supabase-js').SupabaseClient, tenant: string, id: string): Promise<Integration> {
  const { data } = await db.from('docs').select('data').eq('tenant_id', tenant).eq('coll', 'integrations').eq('id', id).maybeSingle();
  if (!data) throw new HttpError(404, 'Connection not found');
  return data.data as Integration;
}
export const paymentOrder = (tenant: string, paymentId: string) => rpc<{ payment: (Payment & { provider?: string }) | null; order: Order | null }>('bn_payment_order', { p_tenant: tenant, p_payment_id: paymentId });
