import type { IDR } from './money.ts';
import { levelRequired, type Level } from './approval.ts';

// st-shift: business_day → shift → drawer session → orders. Blind count at close.
/** cashTips: tips paid in cash stay in the drawer until they are paid out (a cash out). */
export interface Session { openingFloat: IDR; cashSales: IDR; cashIn: IDR; cashOut: IDR; cashRefunds: IDR; cashTips?: IDR }
export const expectedCash = (s: Session) => s.openingFloat + s.cashSales + (s.cashTips ?? 0) + s.cashIn - s.cashOut - s.cashRefunds;
export const variance = (s: Session, counted: IDR) => counted - expectedCash(s);
/** Within PIC limit closes on its own sign; over goes up. A shift can't close with an unsigned variance. */
export function closeCheck(s: Session, counted: IDR, note?: string): { variance: IDR; level: Level | null; needsNote: boolean } {
  const v = variance(s, counted);
  if (v === 0) return { variance: 0, level: null, needsNote: false };
  return { variance: v, level: levelRequired('variance', Math.abs(v)), needsNote: !note };
}
export const SHIFTS = { pagi: ['Morning', '06:00', '14:00'], siang: ['Afternoon', '14:00', '22:00'], malam: ['Close', '18:00', '23:00'] } as const;

/** Selfie at clock in / out against buddy punching ("titip absen"). With the photo rule on, no photo means no clock
 *  event; with it off the event is kept and marked "no photo" so it shows in review. Breaks need no photo. */
export type ClockShot = { photo?: string; noPhoto?: string };
export function clockShot(required: boolean, kind: 'in' | 'out' | 'break', photo?: string | null, reason = 'No photo'): ClockShot | null {
  if (kind === 'break') return {};
  if (photo) return { photo };
  return required ? null : { noPhoto: reason };
}
/** A clock in / out without a photo goes to review. */
export const missingPhoto = (c: { kind: string; photo?: string }) => c.kind !== 'break' && !c.photo;
