'use client';
// Account & device services used by sign-up, onboarding, plans and register pairing (Auth surface).
import { RESERVED, isTenantSlug } from '../../system/hosts.ts';
import { commit, snapshot, uid } from '../store.ts';
import type { DB, Role } from '../schema.ts';
import { REMOTE } from '../remote.ts';
import { seed } from '../seed.ts';
import { verifyPin } from '../actions.ts';
import { remoteInfo, remoteReady, remoteRestart } from '../remoteStore.ts';
import { allOps, emptyDB, humanError, pinChanges, wire } from '../remoteDocs.ts';

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

// ── Accounts, PINs and starter data (REMOTE) ──────────────────────────────────────
export type Check = string | null | Promise<string | null>;
/** Approval PIN: With the database the server checks it (and opens a 2-minute window for this approver's decisions); locally verifyPin. */
export function checkApprovalPin(employeeId: string, pin: string): Check { return REMOTE ? serverPin('bn_check_approval_pin', employeeId, pin) : verifyPin(employeeId, pin); }
/** Staff login PIN on a register. With the database it opens a server session for that person; their writes carry its token. */
export function checkLoginPin(employeeId: string, pin: string): Check {
  if (REMOTE) return staffSignIn(employeeId, pin);
  return snapshot().employees.find(e => e.id === employeeId)?.pin === pin ? null : 'Wrong PIN.';
}
async function staffSignIn(employeeId: string, pin: string) {
  const t = remoteInfo().tenant;
  if (!t) return 'This device is not signed in to a business. Log in first.';
  const { staffLogin } = await import('../backend.ts');
  const r = await staffLogin(t.id, employeeId, pin);
  if (r.token) { (await import('../staff.ts')).setStaffToken(employeeId, r.token); return null; }
  return r.error ? humanError(r.error).text : 'Sign-in failed. Try again.';
}
async function serverPin(fn: string, employeeId: string, pin: string) {
  const t = remoteInfo().tenant;
  if (!t) return 'This device is not signed in to a business. Log in first.';
  const { sb } = await import('../backend.ts');
  const { data, error } = await sb().rpc(fn, { p_tenant: t.id, p_employee: employeeId, p_pin: pin });
  return error ? humanError(error.message).text : (data as string | null);
}
/** Run `then` with a PIN check result, synchronously when the check is local. */
export const whenChecked = (r: Check, then: (err: string | null) => void) => { if (r instanceof Promise) r.then(then, () => then('No connection. Try again.')); else then(r); };

const site = () => (typeof location !== 'undefined' ? location.origin : '');
const msg = (e: { message?: string } | null) => e?.message ? humanError(e.message).text : null;
/** Email + password, plus the authenticator code once two-factor sign-in is on (mfa: ask for it and call again). */
export async function accountSignIn(email: string, password: string, code?: string): Promise<{ error: string | null; unconfirmed?: boolean; mfa?: boolean }> {
  const { sb } = await import('../backend.ts');
  const { data, error } = await sb().auth.signInWithPassword({ email: email.trim(), password, ...(code ? { code } : {}) });
  if (error?.code === 'mfa_required') return { error: code ? error.message : null, mfa: true };
  if (error) return { error: /invalid/i.test(error.message) ? 'Wrong email or password. No account yet? Tap Create an account.' : humanError(error.message).text };
  await remoteReady(data.user?.id ?? null);
  return { error: null };
}
export async function accountSignUp(p: { email: string; password: string; name: string; phone: string }): Promise<{ error: string | null; confirm: boolean }> {
  const { sb } = await import('../backend.ts');
  const { data, error } = await sb().auth.signUp({ email: p.email.trim(), password: p.password, options: { data: { name: p.name, phone: p.phone } } });
  if (error) return { error: error.message, confirm: false };
  if (data.session) await remoteReady(data.user?.id ?? null);
  return { error: null, confirm: !data.session };
}
export async function resendConfirmation(email: string) { const { sb } = await import('../backend.ts'); return msg((await sb().auth.resend({ type: 'signup', email: email.trim() })).error); }
export async function sendPasswordReset(email: string) { const { sb } = await import('../backend.ts'); return msg((await sb().auth.resetPasswordForEmail(email.trim(), { redirectTo: site() + '/account/reset-password' })).error); }
export async function newPassword(password: string) { const { sb } = await import('../backend.ts'); return msg((await sb().auth.updateUser({ password })).error); }
export async function accountUser() { const { sb } = await import('../backend.ts'); return (await sb().auth.getUser()).data.user; }
export async function accountSignOut() {
  const { sb } = await import('../backend.ts');
  try { sessionStorage.removeItem('borniz-session'); localStorage.removeItem('borniz-shared-device'); } catch { /* blocked */ }
  await sb().auth.signOut();
  await remoteReady(null);
}

export interface NewBusiness { name: string; owner: string; phone: string; outlet: string; pin: string; approvalPin: string; demo: boolean; /** its <slug>.bornis.id, chosen at sign-up */ slug?: string }
export const slugify = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30).replace(/-$/, '') || 'toko';
/** The data a new business starts with: the Kopi Biru demo (owner = you; demo staff keep PIN 1234 / 246810) or one empty outlet. */
export function starterData(p: NewBusiness, slug: string): DB {
  const s = seed();
  if (p.demo) {
    Object.assign(s.employees.find(e => e.id === 'budi')!, { name: p.owner, phone: p.phone || '', pin: p.pin, approvalPin: p.approvalPin });
    return { ...s, tenant: { ...s.tenant, id: slug, name: p.name }, staffBrand: { ...s.staffBrand, workspace: p.name } };
  }
  const e = emptyDB(s), outlet = { ...s.outlets[0], id: 'main', name: p.outlet || 'Main outlet', city: '', tables: 10 };
  const slot = () => ({ pic: '', crew: [] as string[] });
  return { ...e, tenant: { ...s.tenant, id: slug, name: p.name, plan: 'free' }, theme: { ...s.theme, name: p.name }, staffBrand: { ...s.staffBrand, workspace: p.name },
    outlets: [outlet], categories: s.categories, modifierGroups: s.modifierGroups, device: { ...s.device, outletId: 'main' },
    employees: [{ id: 'owner', name: p.owner, role: 'owner', outlets: ['main'], pin: p.pin, approvalPin: p.approvalPin, phone: p.phone, color: '#FF6A00', active: true, wage: 0 }],
    roster: Array.from({ length: 7 }, (_, day) => ({ outletId: 'main', day, slots: { pagi: slot(), siang: slot(), malam: slot() } })) };
}
/** Owner sign-up, step 2: bn_bootstrap creates the business and the owner's membership, then the starter data goes up (bn_import). */
export async function createBusiness(p: NewBusiness, onProgress: (pct: number) => void = () => {}): Promise<string | null> {
  if (!/^\d{4}$/.test(p.pin)) return 'Your staff PIN is 4 digits.';
  if (!/^\d{6}$/.test(p.approvalPin)) return 'Your approval PIN is 6 digits.';
  const { sb, membership, pickTenant } = await import('../backend.ts');
  let m = await membership().catch(() => null), tid = m?.tenantId ?? '', slug = m?.slug ?? '';
  const want = p.slug?.trim().toLowerCase();
  if (!tid && want) { // the address the owner picked: exactly that one, or say it is taken
    if (!isTenantSlug(want)) return `${want} can't be a business address: 2–41 letters, numbers or dashes, and not a BorNiz name.`;
    const { data, error } = await sb().rpc('bn_bootstrap', { p_name: p.name.trim(), p_slug: want, p_employee_id: p.demo ? 'budi' : 'owner' });
    if (error) return error.code === '23505' ? `${want} is taken. Pick another address.` : humanError(error.message).text;
    tid = data as string; slug = want;
  }
  for (let i = 0; !tid && i < 4; i++) {
    slug = slugify(p.name) + (i || RESERVED.has(slugify(p.name)) || slugify(p.name).length < 2 ? '-' + Math.random().toString(36).slice(2, 6) : ''); // <slug>.bornis.id
    const { data, error } = await sb().rpc('bn_bootstrap', { p_name: p.name.trim(), p_slug: slug, p_employee_id: p.demo ? 'budi' : 'owner' });
    if (!error) tid = data as string;
    else if (error.code !== '23505') return humanError(error.message).text;
  }
  if (!tid) return 'That business name is taken. Try another.';
  pickTenant(tid);
  const d = starterData(p, slug), ops = wire(allOps(d)), size = 300;
  for (let i = 0; i < ops.length; i += size) {
    const { error } = await sb().rpc('bn_import', { p_tenant: tid, p_ops: ops.slice(i, i + size) });
    if (error) return humanError(error.message).text;
    onProgress(Math.min(90, Math.round(((i + size) / ops.length) * 90)));
  }
  for (const x of pinChanges(emptyDB(d), d)) {
    const { error } = await sb().rpc('bn_set_pins', { p_tenant: tid, p_employee: x.id, p_pin: x.pin, p_approval_pin: x.approvalPin });
    if (error) return humanError(error.message).text;
  }
  onProgress(100);
  await remoteRestart();
  m = (await remoteReady((await accountUser())?.id ?? null)).member;
  return m ? null : 'The business was created but could not be opened. Log in again.';
}
