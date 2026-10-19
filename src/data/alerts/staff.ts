// WhatsApp to staff: the alerts whose catalog destinations (spec alert catalog, src/system/alerts.json) name WhatsApp for staff
// go to the phone of each active employee in those roles at the alert's outlet, once per alert and person. Off until the
// owner turns "WhatsApp to staff" on (Settings › Notifications): every message costs the business. Guest WhatsApp
// (order ready, deposit, kasbon) is the rules' own message; digests are summaries, not per alert.
import alertsCatalog from '../../system/alerts.json' with { type: 'json' };
import type { DB, Message, Role } from '../schema.ts';

type Row = [string, string, Record<string, number>, string, ...string[]];
const STAFF: Role[] = ['owner', 'manager', 'pic', 'cashier', 'kitchen', 'waiter'];
/** Alert → the staff roles that get it on WhatsApp ("push (owner: WA)" = owner only, "WA (manager)" = manager only). */
export const STAFF_WA = new Map<string, Role[]>((alertsCatalog.groups as [string, string, Row[]][]).flatMap(([, , list]) => list.flatMap(a => {
  const roles = Object.keys(a[2]).filter(r => STAFF.includes(r as Role)) as Role[];
  const wa = a[3].split(' · ').filter(t => /WhatsApp|\bWA\b/.test(t) && !/digest|guest/i.test(t));
  if (!wa.length || !roles.length) return [];
  const only = wa.map(t => /\((?:(owner|manager|pic)\b[^)]*)\)/.exec(t)?.[1]).filter(Boolean) as Role[];
  if (!only.length && 'guest' in a[2]) return []; // a plain "WA" next to the guest is the guest's message
  return [[a[0], only.length ? only : roles.filter(r => a[2][r] === 1)] as [string, Role[]]];
})));
export const STAFF_WA_KEY = '/owner/settings/settings-notifications:staff-wa';
const WINDOW_MS = 30 * 60e3; // an alert older than this is history: turning the switch on never floods phones

/** Messages to queue now: notices of the last half hour not sent to that person yet. Pure; ids are stable across devices. */
export function staffWhatsApp(db: DB, at: number, id: (notice: string, employee: string) => string): Message[] {
  if (db.settings[STAFF_WA_KEY] !== true || !db.integrations.some(i => i.kind === 'whatsapp' && i.enabled)) return [];
  const have = new Set(db.messages.map(m => m.id)), out: Message[] = [];
  for (const n of db.notices) {
    const roles = STAFF_WA.get(n.alert);
    if (!roles || at - n.at > WINDOW_MS || n.at > at || db.settings[`/owner/settings/settings-notifications:al-${n.alert}`] === false) continue;
    const outlet = db.outlets.find(o => o.id === n.outletId)?.name ?? db.tenant.name;
    for (const e of db.employees) {
      if (!e.active || !e.phone || !roles.includes(e.role) || !n.to.includes(e.role) || (n.outletId && e.role !== 'owner' && !e.outlets.includes(n.outletId))) continue;
      const mid = id(n.id, e.id);
      if (have.has(mid)) continue;
      have.add(mid);
      out.push({ id: mid, channel: 'wa', template: 'staff_alert', to: e.phone, status: 'queued', at, customerId: null, vars: { alert: n.alert, outlet, text: n.text } });
    }
  }
  return out;
}
