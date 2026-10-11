'use client';
// Connections to third-party systems. Config is shared data; secrets go to src/integrations/secrets.ts.
// Health reports from drivers and servers land here, so a broken printer or gateway raises the catalog alert once.
import { commit, uid } from '../store.ts';
import type { Integration } from '../schema.ts';
import { notify } from '../actions.ts';
import { connector } from '../../integrations/registry.ts';
import { KIND_LABEL } from '../../integrations/types.ts';

const now = () => Date.now();
type Draft = Pick<Integration, 'connector' | 'outletId' | 'deviceId' | 'name' | 'enabled' | 'config'> & { id?: string };

export function saveIntegration(x: Draft, secretKeys: string[], by: string): string {
  const id = x.id ?? uid('int');
  const c = connector(x.connector);
  commit('integration.saved', by, d => {
    const cur = d.integrations.find(i => i.id === id);
    const secrets = [...new Set([...(cur?.secrets ?? []), ...secretKeys])];
    const row: Integration = { status: 'off', lastOk: null, lastError: null, ...cur, ...x, id, kind: c!.kind, secrets, updatedBy: by, updatedAt: now() };
    if (cur) Object.assign(cur, row); else d.integrations.push(row);
  }, id, x.outletId ?? undefined);
  return id;
}
export function removeIntegration(id: string, by: string) {
  commit('integration.removed', by, d => { d.integrations = d.integrations.filter(i => i.id !== id); }, id);
}

/** Which catalog alert a failing connection raises. */
const ALERT_OF: Partial<Record<Integration['kind'], string>> = { printer: 'Printer problem', payment: 'QRIS gateway down', accounting: 'Accounting sync failed', delivery: 'Menu sync failed', display: 'Customer display disconnected' };

/** Drivers and servers report health. ok → error raises the alert once; error → ok clears quietly. */
export function reportIntegration(id: string, ok: boolean, error = '') {
  commit(ok ? 'integration.ok' : 'integration.error', 'system', d => {
    const i = d.integrations.find(x => x.id === id); if (!i) return;
    const was = i.status;
    if (ok) { i.status = 'ok'; i.lastOk = now(); i.lastError = null; return; }
    i.status = 'error'; i.lastError = error || 'No response';
    if (was !== 'error') notify(d, ALERT_OF[i.kind] ?? 'Integration disconnected', 'high', ['manager', 'owner'], i.outletId, `${i.name} (${KIND_LABEL[i.kind]}): ${i.lastError}`, '/owner/account/devices');
  }, id);
}
