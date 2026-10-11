'use client';
// Account & device services used by sign-up, onboarding, plans and register pairing (Auth surface).
import { commit, snapshot, uid } from '../store.ts';
import type { DB, Role } from '../schema.ts';

export const PAIR_TTL_MS = 10 * 60e3;
const pairKey = (deviceId: string) => 'pair:' + deviceId;

export function setPlan(plan: DB['tenant']['plan'], by: string, note = '') {
  commit('plan.changed', by, d => {
    d.tenant.plan = plan;
    d.notices.unshift({ id: uid('n'), alert: 'Plan changed', level: 'info', to: ['owner'], outletId: null, text: `Plan is now ${plan[0].toUpperCase() + plan.slice(1)}${note ? ' · ' + note : ''}`, href: '/owner/account/subscription-billing', at: Date.now(), read: false });
  }, plan);
}

/** Invited staff are inactive until they open the WhatsApp link and set their own PIN. */
export function inviteEmployee(p: { name: string; phone: string; role: Role; outletId: string }, by: string) {
  const id = uid('e');
  commit('employee.invited', by, d => {
    d.employees.push({ id, name: p.name, role: p.role, outlets: [p.outletId], pin: '', approvalPin: '', phone: p.phone, color: '#857E76', active: false, wage: 0 });
    d.messages.unshift({ id: uid('ms'), channel: 'wa', template: 'staff_invite', to: p.phone, status: 'queued', at: Date.now(), customerId: null });
  }, p.name, p.outletId);
  return id;
}

export function addRegister(outletId: string, by: string) {
  const id = uid('d');
  commit('device.added', by, d => {
    const n = d.devices.filter(x => x.outletId === outletId && x.kind === 'pos').length + 1;
    d.devices.push({ id, outletId, kind: 'pos', name: 'Register ' + n, lastSeen: 0, pairCode: null, status: 'offline' });
  }, 'Register', outletId);
  return id;
}

/** Back office issues a 6-digit code; the tablet types it within 10 minutes. */
export function issuePairCode(deviceId: string, by: string) {
  const code = String(Math.floor(100000 + Math.random() * 900000));
  commit('device.pair_code', by, d => {
    const x = d.devices.find(y => y.id === deviceId); if (!x) return;
    x.pairCode = code; d.settings[pairKey(deviceId)] = Date.now() + PAIR_TTL_MS;
  }, deviceId);
  return code;
}
export const pairExpiry = (d: DB, deviceId: string) => Number(d.settings[pairKey(deviceId)] ?? 0);

export function pairDevice(deviceId: string, code: string): string | null {
  const d0 = snapshot(), x = d0.devices.find(y => y.id === deviceId);
  if (!x) return 'This register no longer exists.';
  if (!x.pairCode) return 'No code issued for this register. Get a new code in Owner › Devices.';
  if (pairExpiry(d0, deviceId) < Date.now()) return 'This code expired. Get a new one, it works for 10 minutes.';
  if (x.pairCode !== code) return 'That code doesn’t match. Check the 6 digits in Owner › Devices.';
  commit('device.paired', 'device', d => {
    const y = d.devices.find(z => z.id === deviceId)!;
    Object.assign(y, { pairCode: null, status: 'online', lastSeen: Date.now() });
    delete d.settings[pairKey(deviceId)];
    d.device.paired[y.kind] = y.id; d.device.outletId = y.outletId;
  }, x.name, x.outletId);
  return null;
}
