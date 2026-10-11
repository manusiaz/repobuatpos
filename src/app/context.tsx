'use client';
// The one context every screen and template reads: current page (registry node), signed-in user, outlet, live data.
import { createContext, useContext } from 'react';
import type { Page } from '../system/registry.ts';
import type { DB, Employee } from '../data/schema.ts';
import type { SessionUser } from '../session.ts';

export interface AppCtx {
  page: Page; db: DB; user: SessionUser; me: Employee | undefined;
  outletId: string; setOutlet: (id: string) => void;
  /** Navigate to another registry page (every view is a URL). */
  go: (path: string) => void;
}
export const Ctx = createContext<AppCtx | null>(null);
export function useApp(): AppCtx { const c = useContext(Ctx); if (!c) throw new Error('useApp outside <App>'); return c; }
