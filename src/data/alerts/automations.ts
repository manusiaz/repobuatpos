// Automations (Studios › Messaging & automation): what each one's published settings send, from the same sweep on
// every open device and the worker. Below Pro the defaults run and the studio's changes wait (TOOL_PLAN). Quiet
// hours and marketing consent are the outbox's (dispatch.ts); each send has a fixed id, so a second device adds nothing.
import type { Customer, DB, Message } from '../schema.ts';
import { TOOL_DEFAULTS, toolValue } from '../../system/tools.ts';

const HOUR = 36e5, DAY = 864e5;
export const AUTOMATIONS = ['a_thanks', 'a_feedback', 'a_winback', 'a_bday'] as const;
/** Win-back wait the studio offers (14–30 days: devices and the worker load 35 days of orders, so a longer wait would
 *  never see the last visit). The sender, the studio audience and its text all use this value. */
export const WINBACK_MAX_DAYS = 30;
/** A published number setting inside the studio's range; blank, missing or not a number is the default (one meaning for "unset"). */
const setting = (v: Record<string, unknown>, k: string, def: number, min: number, max: number) => {
  const x = v[k] === '' || v[k] == null ? NaN : Number(v[k]);
  return Number.isFinite(x) ? Math.max(min, Math.min(x, max)) : def;
};
export const winbackDays = (v: Record<string, unknown>) => setting(v, 'days', TOOL_DEFAULTS.a_winback.days, 14, WINBACK_MAX_DAYS);
/** Days before the birthday the treat goes out (studio range 0–14). */
export const birthdayDays = (v: Record<string, unknown>) => setting(v, 'days', TOOL_DEFAULTS.a_bday.days, 0, 14);
/** The next birthday on or after the day before, this year's or next year's (3 January is due in late December). */
export function nextBirthday(birthday: string, now: number): number | null {
  const y = new Date(now).getFullYear();
  return [y, y + 1].map(yr => { const b = new Date(birthday); b.setFullYear(yr); return b.getTime(); }).find(t => t >= now - DAY) ?? null; // null: not a date
}
export const lastVisit = (db: DB, customerId: string) => db.orders.filter(o => o.customerId === customerId && o.status === 'paid').reduce((a, o) => Math.max(a, o.paidAt ?? o.createdAt), 0);

/** Each send is due once: after its moment plus the wait, inside a window the sweep (every minute) can't miss. */
const due = (now: number, at: number, wait: number, window: number) => now >= at + wait && now < at + wait + window;
function moments(db: DB, now: number, id: (typeof AUTOMATIONS)[number], v: Record<string, unknown>): { key: string; customerId: string | null; orderId?: string }[] {
  const n = (k: string) => Number(v[k]) || 0;
  if (id === 'a_thanks') return db.orders.filter(o => o.customerId && o.paidAt && due(now, o.paidAt, n('delay') * HOUR, 15 * 60e3)).map(o => ({ key: o.id, customerId: o.customerId, orderId: o.id }));
  if (id === 'a_feedback') return db.reviews.filter(r => r.stars >= n('min') && due(now, r.at, n('delay') * HOUR, 15 * 60e3)).map(r => ({ key: r.id, customerId: r.customerId, orderId: r.orderId ?? undefined }));
  if (id === 'a_winback') return db.customers.flatMap(c => { const t = lastVisit(db, c.id); return t && due(now, t, winbackDays(v) * DAY, DAY) ? [{ key: c.id + '|' + t, customerId: c.id }] : []; });
  return db.customers.flatMap(c => {
    if (!c.birthday) return [];
    const b = nextBirthday(c.birthday, now);
    return b !== null && due(now, b, -birthdayDays(v) * DAY, DAY) ? [{ key: c.id + '|' + new Date(b).getFullYear(), customerId: c.id }] : [];
  });
}
// only guests who opted in (catalog: "opted-in"); the studio narrows it further
const fits = (db: DB, c: Customer, cond: unknown) => !c.optIn ? false : cond === 'member' ? db.ledger.some(r => r.customerId === c.id) : cond === 'phone' ? !!c.phone
  : cond === 'first' ? db.orders.filter(o => o.customerId === c.id && o.status === 'paid').length === 1 : true;

/** ids: the automations to run (the catalog's "Thank you after visit" switch in Notifications also stops a_thanks). */
export function automationMessages(db: DB, now: number, idOf: (key: string) => string, ids: readonly (typeof AUTOMATIONS)[number][] = AUTOMATIONS): Message[] {
  const cust = new Map(db.customers.map(c => [c.id, c])), out: Message[] = [];
  const tpls = new Set(AUTOMATIONS.map(a => String(toolValue(db, a).tpl)));
  // "max 1 per guest per day" counts automation messages only, never the receipt or order-ready message
  const today = (c: string) => [...db.messages, ...out].some(m => m.customerId === c && now - m.at < DAY && tpls.has(m.template));
  for (const id of ids) {
    const v = toolValue(db, id);
    if (!v.on) continue;
    for (const m of moments(db, now, id, v)) {
      const c = m.customerId ? cust.get(m.customerId) : undefined;
      if (!c || !fits(db, c, v.cond) || (v.cap && today(c.id))) continue;
      for (const channel of v.ch === 'both' ? ['wa', 'email'] as const : [v.ch === 'email' ? 'email' as const : 'wa' as const]) {
        const to = channel === 'email' ? c.email : c.phone;
        if (to) out.push({ id: idOf(`${id}|${m.key}|${channel}`), channel, template: String(v.tpl), to, status: 'queued', at: now, customerId: c.id, orderId: m.orderId });
      }
    }
  }
  return out;
}
