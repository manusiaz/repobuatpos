// Fingerspot.io → us: the webhook URL set for the device in the Fingerspot portal (…/api/attendance/fingerspot?key=<key>).
// Body: {"type":"attlog","cloud_id":"…","data":{"pin":"622","scan":"2025-03-11 16:15:42","verify":4,"status_scan":1}}.
import { HttpError, body, handle, json } from '../../../../src/integrations/server/http.ts';
import { DEMO, rpc } from '../../../../src/integrations/server/db.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = handle(async (req: Request) => {
  if (DEMO) throw new HttpError(404, 'Attendance machines need the database (DATABASE_URL)');
  const e = await body<{ type?: string; cloud_id?: string; data?: { pin?: string | number; scan?: string; status_scan?: string | number } }>(req);
  if (e.type !== 'attlog') return json({ ok: true }); // user, device and command events: not needed
  const sn = String(e.cloud_id ?? ''), d = e.data ?? {};
  if (!/^[A-Za-z0-9-]{4,40}$/.test(sn) || d.pin == null || !/^\d{4}-\d\d-\d\d \d\d:\d\d(:\d\d)?$/.test(d.scan ?? '')) throw new HttpError(400, 'cloud_id, data.pin and data.scan are required');
  const r = await rpc('bn_machine_clock', { p_sn: sn, p_key: new URL(req.url).searchParams.get('key'), p_rows: [{ pin: String(d.pin), time: d.scan, status: String(d.status_scan ?? 0) }] });
  return json({ ok: true, ...(r as object) });
});
