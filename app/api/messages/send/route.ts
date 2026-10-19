// POST { messageId, channel, to, template, lang?, params?, subject?, text? } → sends one queued db.messages row of the
// caller's business (messaging/send.ts). messageId is the idempotency key: a second device gets the first result.
import { member } from '../../../../src/integrations/server/auth.ts';
import { HttpError, body, handle, json } from '../../../../src/integrations/server/http.ts';
import { DEMO, as } from '../../../../src/integrations/server/db.ts';
import { KIND_OF, type Channel } from '../../../../src/integrations/server/messaging/index.ts';
import { sendMessage } from '../../../../src/integrations/server/messaging/send.ts';
import { publishedTool } from '../../../../src/integrations/server/store.ts';
import { str } from '../../../../src/integrations/server/types.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = handle(async (req: Request) => {
  const b = await body<{ messageId?: string; channel?: Channel; to?: string; template?: string; lang?: string; params?: unknown[]; subject?: string; text?: string; from?: string; tenantId?: string }>(req);
  const channel = b.channel as Channel;
  if (!b.messageId || !KIND_OF[channel] || !b.to?.trim() || !b.template) throw new HttpError(400, 'messageId, channel (wa | email | sms), to and template are required');
  if (DEMO) return json({ ok: true, demo: true, status: 'sent', providerId: 'sim-' + b.messageId, simulated: true });
  const m = await member(req, null, b.tenantId);
  // only a message the business queued (db.messages, written through its own rules), to the address on that row:
  // a shared register sends receipts, never whatever a request asks
  const row = (await as(m.userId, m.cell, c => c.query("select data from public.docs where tenant_id = $1 and coll = 'messages' and id = $2", [m.tenantId, b.messageId]))).rows[0]?.data as
    { channel?: string; to?: string; template?: string } | undefined;
  if (!row || row.channel !== channel || row.to !== b.to || row.template !== b.template) throw new HttpError(403, 'Not a queued message of this business');
  if (b.from && !b.from.endsWith(`<${str((await publishedTool(m, 'emaild')).addr).trim()}>`)) throw new HttpError(403, 'The sender is the address set in Studios › Email domain');
  return json(await sendMessage(m.tenantId, { ...b, messageId: b.messageId, channel, to: b.to, template: b.template }));
});
