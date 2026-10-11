'use client';
// Device-side services behind the system states: offline queue, sync, device health.
import { commit, uid } from '../store.ts';
import type { Device } from '../schema.ts';

/** Offline: the action is kept on this device with an idempotency key and replayed on reconnect. */
export function queueOffline(action: string) {
  commit('device.queued', 'device', d => { d.device.online = false; d.device.queue.push({ id: uid('q'), action, at: Date.now() }); }, action);
}
export function syncQueue() {
  commit('device.synced', 'device', d => { d.device.online = true; d.device.queue = []; });
}
export function setDeviceStatus(id: string, status: Device['status'], by: string) {
  commit('device.' + status, by, d => {
    const x = d.devices.find(y => y.id === id); if (!x) return;
    x.status = status; if (status === 'online') x.lastSeen = Date.now();
    if (status === 'online') d.notices.forEach(n => { if (n.alert === 'Printer offline' && n.outletId === x.outletId) n.read = true; });
  }, id);
}
