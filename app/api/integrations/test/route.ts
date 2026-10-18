// POST { integrationId } from src/integrations/testers.ts → { ok, message } from the provider's own check.
import { member } from '../../../../src/integrations/server/auth.ts';
import { HttpError, body, handle, json } from '../../../../src/integrations/server/http.ts';
import { DEMO } from '../../../../src/integrations/server/db.ts';
import { ctxOf, integrationAsMember } from '../../../../src/integrations/server/store.ts';
import { testConnection } from '../../../../src/integrations/server/test.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = handle(async (req: Request) => {
  const b = await body<{ integrationId?: string; tenantId?: string }>(req);
  if (!b.integrationId) throw new HttpError(400, 'integrationId is required');
  if (DEMO) return json({ ok: true, message: 'Demo mode: settings saved. The live test runs once the database is connected.' });
  const m = await member(req, null, b.tenantId);
  const i = await integrationAsMember(m, b.integrationId);
  return json(await testConnection(i.connector, m.tenantId, await ctxOf(m.tenantId, i)));
});
