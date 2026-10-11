// "Test connection" for server connectors: the provider's own check, run with the secrets the browser never sees.
import { connector } from '../registry.ts';
import { gateway } from './payments/index.ts';
import { sender } from './messaging/index.ts';
import { deliver, publicEndpoint } from './webhooks/deliver.ts';
import { str, type Ctx, type TestResult } from './types.ts';

export async function testConnection(connectorId: string, tenantId: string, ctx: Ctx): Promise<TestResult> {
  const c = connector(connectorId);
  if (!c) return { ok: false, message: 'Unknown connector' };
  const missing = c.fields.find(f => f.required && (f.type === 'secret' ? !ctx.secrets[f.key] : ctx.config[f.key] === undefined || ctx.config[f.key] === ''));
  if (missing) return { ok: false, message: `${missing.label} is missing.` };
  try {
    const g = gateway(c.id) ?? sender(c.id);
    if (g) return await g.test(ctx);
    if (c.id === 'webhook-out') {
      const url = str(ctx.config.url);
      if (!publicEndpoint(url)) return { ok: false, message: 'The endpoint must be a public https URL.' };
      const r = await deliver(url, ctx.secrets.secret, tenantId, { id: 'ping-' + Date.now().toString(36), event: 'ping', at: Date.now(), data: {} }, ctx.fetch);
      return r.ok ? { ok: true, message: `Endpoint answered ${r.status}.` } : { ok: false, message: r.status ? `Endpoint answered ${r.status}.` : 'Endpoint did not answer within 10 s.' };
    }
    return c.ready ? { ok: true, message: 'Saved' } : { ok: false, message: `${c.name}: settings saved; the API driver is not written yet.` };
  } catch (e) { return { ok: false, message: (e as Error).message }; }
}
