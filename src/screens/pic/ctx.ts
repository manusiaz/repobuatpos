'use client';
// The PIC tablet always works on "this outlet, this shift": derived once here from the roster and the clock.
import { useApp } from '../../app/context.tsx';
import { pagesOf } from '../../system/registry.ts';
import { useNow } from '../../ui/kit.tsx';
import { dayIdx, managerOf, rosterDay, slotNow, slotStart, dateKey, type Slot } from '../ops/shift.ts';

export function usePic() {
  const app = useApp();
  const { db, outletId, user, me } = app;
  const now = useNow(30e3);
  const slot: Slot = slotNow(now), day = dayIdx(now), sd = rosterDay(db, outletId, day);
  return {
    ...app, now, slot, day, sd, start: slotStart(slot, now), date: dateKey(now),
    picId: sd?.slots[slot].pic ?? '', meId: me?.id ?? user.id, mgr: managerOf(db, outletId),
    outlet: db.outlets.find(o => o.id === outletId),
  };
}
export type PicCtx = ReturnType<typeof usePic>;
export const picPath = (slug: string) => pagesOf('pic').find(p => p.slug === slug)?.path ?? '/pic';
