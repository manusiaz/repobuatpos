// The one reader for owner settings saved by the settings pages (templates/Settings.tsx stores `<page path>:<id>`).
// Defaults here are the defaults the settings page shows, so an untouched switch means the same thing everywhere.
import type { DB } from '../data/schema.ts';

export const PAYMENT_PAGE = '/owner/settings/settings-payment-methods';
const PAY_DEFAULT = { qris: true, ewallet: true, va: false, card: true, cash: true, rounding: true, split: true, kasbon: false, deposit: true } as const;
export type PayId = keyof typeof PAY_DEFAULT;

export const setting = <T extends boolean | string | number>(db: DB, page: string, id: string, def: T): T => (db.settings[page + ':' + id] as T | undefined) ?? def;
/** Payment method switched on by the owner (cash can't be switched off). */
export const payOn = (db: DB, id: PayId) => id === 'cash' || Boolean(setting(db, PAYMENT_PAGE, id, PAY_DEFAULT[id]));
/** Cash rounding step in rupiah, 0 when the owner has rounding off. */
export const roundStep = (db: DB) => (payOn(db, 'rounding') ? Number(setting(db, PAYMENT_PAGE, 'roundStep', 100)) : 0);

export const APPROVAL_PAGE = '/owner/team/approval-flows';
export const ROUTING_PAGE = '/manager/devices/printer-and-kds-routing';
export const LANG_PAGE = '/owner/settings/settings-language-and-currency';
/** Several pages show the same switch; it is saved once, under the page that owns it. */
export const CANON: Record<string, string> = { timeouts: APPROVAL_PAGE, 'pin-every': APPROVAL_PAGE, expo: ROUTING_PAGE, 'print-ticket': ROUTING_PAGE };
/** Shown locked on for transparency; enforced in code, never switchable: 'pin-every' (PinSheet asks on every decision), 'cash'. */
export const LOCKED_ON = ['pin-every', 'cash'] as const;

/** Unanswered approvals climb the ladder (PIC 5 min → manager → owner). */
export const escalationOn = (db: DB) => Boolean(setting(db, APPROVAL_PAGE, 'timeouts', true));
/** The expo / pass screen on the KDS. */
export const expoOn = (db: DB) => Boolean(setting(db, ROUTING_PAGE, 'expo', true));
/** Kitchen tickets print on paper when the outlet has no KDS online, and also as a backup when 'print-ticket' is on. */
export const ticketsOnPaper = (db: DB, outletId: string) =>
  !db.devices.some(d => d.outletId === outletId && d.kind === 'kds' && d.status === 'online') || Boolean(setting(db, ROUTING_PAGE, 'print-ticket', false));
/** Money format on every screen and receipt: 'idr' = IDR 25,000 · 'rp' = Rp25.000. */
export const moneyStyle = (db: DB) => (setting<string>(db, LANG_PAGE, 'fmt', 'idr') === 'rp' ? 'rp' : 'idr') as 'idr' | 'rp';
/** Language a guest sees first on the QR menu and kiosk (they can still switch). */
export const guestLang = (db: DB) => (setting<string>(db, LANG_PAGE, 'lang', 'en') === 'id' ? 'id' : 'en') as 'en' | 'id';

export const REFERRAL_PAGE = '/owner/customers/referral-program';
/** Invite-a-friend: both get beans when the friend joins from the member's link. */
export const referral = (db: DB) => ({ on: Boolean(setting(db, REFERRAL_PAGE, 'ref-on', true)), referrer: Number(setting(db, REFERRAL_PAGE, 'ref-referrer', 100)), friend: Number(setting(db, REFERRAL_PAGE, 'ref-friend', 50)) });
