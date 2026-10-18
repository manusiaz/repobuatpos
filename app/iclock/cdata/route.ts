// Attendance machine → us (src/devices/zk.ts). Any answer but 200 makes the machine keep the scans and retry, so nothing is lost.
import { HttpError, handle } from '../../../src/integrations/server/http.ts';
import { DEMO, rpc } from '../../../src/integrations/server/db.ts';
import { options, parseAttlog } from '../../../src/devices/zk.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const text = (s: string) => new Response(s, { headers: { 'content-type': 'text/plain' } });
const serial = (req: Request) => {
  if (DEMO) throw new HttpError(404, 'Attendance machines need the database (DATABASE_URL)');
  const sn = new URL(req.url).searchParams.get('SN') ?? '';
  if (!/^[A-Za-z0-9-]{4,40}$/.test(sn)) throw new HttpError(400, 'SN is required');
  return sn;
};

export const GET = handle(async (req: Request) => {
  const sn = serial(req);
  await rpc('bn_machine_clock', { p_sn: sn, p_rows: [] });
  return text(options(sn));
});
export const POST = handle(async (req: Request) => {
  const sn = serial(req), body = await req.text();
  if (new URL(req.url).searchParams.get('table') !== 'ATTLOG') return text('OK'); // user list, photos, operation log: not needed
  const rows = parseAttlog(body);
  await rpc('bn_machine_clock', { p_sn: sn, p_rows: rows });
  return text(`OK: ${rows.length}`);
});
