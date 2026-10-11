'use client';
// Platform-side behaviour while any kitchen or online screen is open: scheduled orders fire at slot − prep,
// unaccepted orders are cancelled when the accept window closes, approved exceptions (permission 'a') apply once.
import { useEffect } from 'react';
import type { DB } from '../../data/schema.ts';
import { ACCEPT_WINDOW_MS, applyApproved, fireAt, fireScheduled, missOnline } from '../../data/actions/online.ts';
import { isPlatform } from '../../domain/order.ts';

export function useOnlineAutomation(db: DB, outletId: string, now: number) {
  useEffect(() => {
    for (const o of db.orders) {
      if (o.outletId !== outletId || !isPlatform(o.source) && o.source !== 'web') continue;
      if (o.status === 'open' && now - o.createdAt > ACCEPT_WINDOW_MS) missOnline(o.id);
      else if (o.status === 'held' && o.cashierId && o.readyBy && fireAt(o) <= now) fireScheduled(o.id, 'system');
    }
    for (const a of db.approvals) {
      const pl = a.payload as { online?: unknown; applied?: boolean } | undefined;
      if (a.outletId === outletId && a.status === 'approved' && pl?.online && !pl.applied) applyApproved(a.id);
    }
  }, [db, outletId, now]);
}
