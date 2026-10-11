// Courier trip updates (Lalamove, GoSend, GrabExpress, Paxel). The connections exist; the drivers are not written yet.
import { HttpError, handle } from '../../../../../src/integrations/server/http.ts';
import { NotConnected } from '../../../../../src/integrations/server/types.ts';
import { connector } from '../../../../../src/integrations/registry.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = handle(async (_req: Request, { params }: { params: Promise<{ provider: string }> }) => {
  const c = connector((await params).provider);
  if (c?.kind !== 'courier') throw new HttpError(404, 'Unknown courier');
  throw new NotConnected(c.name);
});
