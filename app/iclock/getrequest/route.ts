// The machine polls for commands every few seconds; BorNiz sends none. The poll marks the machine seen (the server writes
// it at most once a minute), so Test in Connect a device shows an idle machine as connected. Always OK: an unknown serial
// here would only make the machine retry.
import { DEMO, rpc } from '../../../src/integrations/server/db.ts';
import { callerIp } from '../../../src/devices/zk.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(req: Request) {
  const sn = new URL(req.url).searchParams.get('SN') ?? '';
  if (!DEMO && /^[A-Za-z0-9-]{4,40}$/.test(sn)) await rpc('bn_machine_clock', { p_sn: sn, p_rows: [], p_ip: callerIp(req) }).catch(() => undefined);
  return new Response('OK', { headers: { 'content-type': 'text/plain' } });
}
