// Alert sweep: runs every catalog rule on the store, drops what already fired (deterministic ids, so several devices
// sweeping at once write the same rows), honours the per-alert setting, and commits all new notices in one commit.
import alertsCatalog from '../../system/alerts.json' with { type: 'json' };
import { commit, snapshot } from '../store.ts';
import type { DB, Message, Notice, Role } from '../schema.ts';
import { RULES, SERVICE, index, type Fire, type Level, type Rule } from './rules.ts';

export { RULES, SERVICE };
type Row = [string, string, Record<string, number>, string, string, ...string[]];
/** Catalog by name (a name listed twice, "Sync conflict", keeps its last row, like notify). */
export const CATALOG = new Map((alertsCatalog.groups as [string, string, Row[]][]).flatMap(([group, , list]) => list.map(a => [a[0], {
  group, level: a[4] as Level, to: Object.keys(a[2]).filter(r => r !== 'guest') as Role[], guest: 'guest' in a[2],
}] as const)));
export const SETTINGS_PAGE = '/owner/settings/settings-notifications';
export const settingKey = (alert: string) => `${SETTINGS_PAGE}:al-${alert}`;
export const alertOn = (db: Pick<DB, 'settings'>, alert: string) => db.settings[settingKey(alert)] !== false;

/** cyrb53: short, stable, collision-safe enough for per-tenant dedupe keys. */
function hash(s: string) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
export const noticeId = (alert: string, key: string) => 'al_' + hash(alert + '|' + key);

const LOG = 'alert_log', LOG_MAX = 3000, LOG_DAYS = 60;
export interface Planned { id: string; alert: string; key: string; notice: Notice | null; message: Message | null }

/** Pure: what a sweep at `at` would add to `db`. */
export function planAlerts(db: DB, at = Date.now(), rules: Rule[] = RULES): Planned[] {
  const ix = index(db, at), seen = new Set<string>([...db.notices.map(n => n.id), ...db.messages.map(m => m.id), ...(db.records[LOG] ?? []).map(r => r.id)]), out: Planned[] = [];
  for (const r of rules) {
    const meta = CATALOG.get(r.alert);
    if (!meta || !alertOn(db, r.alert)) continue;
    let fires: Fire[];
    try { fires = r.check(db, at, ix); } catch { continue; } // one broken rule never stops the others
    for (const f of fires) {
      const id = noticeId(r.alert, f.key);
      if (seen.has(id)) continue;
      seen.add(id);
      const notice: Notice | null = meta.to.length ? { id, alert: r.alert, level: f.level ?? meta.level, to: meta.to, outletId: f.outletId, text: f.text, href: f.href ?? r.href, at, read: false } : null;
      const message: Message | null = f.msg ? { id, channel: 'wa', template: f.msg.template, to: f.msg.to, status: 'queued', at, customerId: f.msg.customerId, orderId: f.msg.orderId } : null;
      if (notice || message) out.push({ id, alert: r.alert, key: f.key, notice, message });
    }
  }
  return out;
}
/** Applies a plan inside a commit; ids already present (another device swept first) are skipped. */
export function applyAlerts(d: DB, plan: Planned[], at = Date.now()) {
  const log = d.records[LOG] ?? (d.records[LOG] = []), have = new Set([...d.notices.map(n => n.id), ...d.messages.map(m => m.id), ...log.map(r => r.id)]);
  const fresh = plan.filter(p => !have.has(p.id));
  d.notices.unshift(...fresh.flatMap(p => p.notice ? [p.notice] : []));
  if (d.notices.length > 200) d.notices.length = 200;
  d.messages.unshift(...fresh.flatMap(p => p.message ? [p.message] : []));
  log.unshift(...fresh.map(p => ({ id: p.id, a: p.alert, b: p.key, c: p.notice?.outletId ?? '', d: '', e: '', at })));
  d.records[LOG] = log.filter(r => at - r.at < LOG_DAYS * 864e5).slice(0, LOG_MAX);
  return fresh.length;
}
/** Every 60 s on every open device (App.tsx). Commits only when something new fires. */
export function sweepAlerts(at = Date.now()) {
  const plan = planAlerts(snapshot(), at);
  if (!plan.length) return 0;
  let n = 0;
  commit('alerts.swept', 'system', d => { n = applyAlerts(d, plan, at); }, `${plan.length} alerts`);
  return n;
}
