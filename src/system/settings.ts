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
