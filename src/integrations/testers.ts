// "Test connection" for each connector. Browser drivers (printer, EDC, scale) register a tester on this device;
// server connectors are tested by /api/integrations/test with the secrets the browser never sees.
import type { Integration } from '../data/schema.ts';
import { connector } from './registry.ts';
import { REMOTE, authHeaders } from '../data/remote.ts';

export type Result = { ok: boolean; message: string };
const TESTERS = new Map<string, (i: Integration) => Promise<Result>>();
export const registerTester = (connectorId: string, fn: (i: Integration) => Promise<Result>) => { TESTERS.set(connectorId, fn); };

export async function testIntegration(i: Integration): Promise<Result> {
  const c = connector(i.connector);
  if (!c) return { ok: false, message: 'Unknown connector' };
  const t = TESTERS.get(c.id);
  if (t) return t(i);
  if (c.runtime === 'server') {
    if (!REMOTE) return c.ready ? { ok: true, message: 'Demo mode: settings saved. The live test runs on the server once the database is connected.' } : { ok: false, message: `${c.name}: settings saved; the API driver is not written yet.` };
    const r = await fetch('/api/integrations/test', { method: 'POST', headers: { 'content-type': 'application/json', ...(await authHeaders()) }, body: JSON.stringify({ integrationId: i.id }) });
    return r.ok ? (await r.json()) as Result : { ok: false, message: (await r.text()) || 'Test failed' };
  }
  return c.ready ? { ok: true, message: 'Saved' } : { ok: false, message: `${c.name}: settings saved; the driver is not written yet.` };
}
