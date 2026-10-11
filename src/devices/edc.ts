// Card terminal (EDC) contract. Most Indonesian outlets run a standalone bank EDC: the cashier keys the amount on it and
// types the approval code from the slip into BorNiz ("manual", ready). Bank ECR links (BCA, Mandiri, BRI, BNI) send the
// amount to the terminal and read the result back; their containers are here and the drivers throw EdcPending until written.
import type { Integration } from '../data/schema.ts';
import type { IDR } from '../domain/money.ts';

export interface ChargeReq { amount: IDR; ref: string; entry?: { approvalCode: string; last4?: string; trace?: string }; outcome?: 'approved' | 'declined' | 'cancelled' }
export interface ChargeRes { status: 'approved' | 'declined' | 'cancelled'; approvalCode: string; trace: string; cardMasked?: string; rrn?: string; message?: string }
export interface EdcDriver {
  id: string; bank: string;
  /** manual = the cashier types the slip · auto = the terminal answers · pending = ECR driver not written yet. */
  mode: 'manual' | 'auto' | 'pending';
  charge(r: ChargeReq): Promise<ChargeRes>;
  void(trace: string): Promise<{ ok: boolean; message: string }>;
  settle(): Promise<{ ok: boolean; message: string }>;
}
export class EdcPending extends Error {}

export const BANKS: [string, string][] = [['BCA', 'BCA'], ['Mandiri', 'Mandiri'], ['BRI', 'BRI'], ['BNI', 'BNI'], ['Other', 'Other bank']];
const pad6 = (s: string) => s.replace(/\D/g, '').slice(-6).padStart(6, '0');

/** Checks what the cashier typed from the EDC slip. Returns the error to show, or null. */
export function checkEntry(e: ChargeReq['entry'], needLast4 = true): string | null {
  if (!e || !/^[A-Z0-9]{6}$/i.test(e.approvalCode.trim())) return 'Approval code is the 6 letters or digits after "APPR CODE" on the EDC slip.';
  if (needLast4 && !/^\d{4}$/.test((e.last4 ?? '').trim())) return 'Type the last 4 digits of the card from the slip.';
  if (e.trace && !/^\d{1,6}$/.test(e.trace.trim())) return 'Trace number is up to 6 digits.';
  return null;
}

export function manualDriver(bank = 'EDC', needLast4 = true): EdcDriver {
  return {
    id: 'edc-manual', bank, mode: 'manual',
    async charge(r) {
      const bad = checkEntry(r.entry, needLast4);
      if (bad) throw new Error(bad);
      const e = r.entry!;
      return { status: 'approved', approvalCode: e.approvalCode.trim().toUpperCase(), trace: e.trace ? pad6(e.trace) : '', cardMasked: e.last4 ? '****' + e.last4.trim() : undefined };
    },
    async void() { return { ok: true, message: 'Void it on the EDC (Menu › Void, trace number), then keep the void slip with the drawer.' }; },
    async settle() { return { ok: true, message: 'Run Settlement on the EDC at close. BorNiz matches the card total from this shift.' }; },
  };
}

/** Demo terminal: answers like a bank EDC, deterministic from the reference. */
export function simulatorDriver(): EdcDriver {
  const num = (s: string) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  return {
    id: 'edc-simulator', bank: 'Simulator', mode: 'auto',
    async charge(r) {
      const n = num(r.ref + ':' + r.amount), status = r.outcome ?? 'approved';
      if (status !== 'approved') return { status, approvalCode: '', trace: pad6(String(n % 999999)), message: status === 'declined' ? 'Declined by issuer (51)' : 'Cancelled on the terminal' };
      return { status, approvalCode: (n % 1e6).toString(36).toUpperCase().padStart(6, '0').slice(-6), trace: pad6(String(n % 999999)), cardMasked: '****' + String(1000 + (n % 9000)), rrn: String(n).padStart(12, '0').slice(-12) };
    },
    async void(trace) { return { ok: true, message: `Simulator: trace ${trace} voided` }; },
    async settle() { return { ok: true, message: 'Simulator: batch settled' }; },
  };
}

/** Bank ECR container: settings and contract in place, protocol pending. Callers fall back to manual entry. */
export function ecrDriver(bank: string): EdcDriver {
  const pending = async (): Promise<never> => { throw new EdcPending(`${bank} ECR link is set up, but its driver is not written yet. Charge on the EDC and type the approval code from the slip.`); };
  return { id: 'edc-' + bank.toLowerCase(), bank, mode: 'pending', charge: pending, void: pending, settle: pending };
}

export const ECR: Record<string, string> = { 'edc-bca': 'BCA', 'edc-mandiri': 'Mandiri', 'edc-bri': 'BRI', 'edc-bni': 'BNI' };
export function edcDriver(i: Integration | undefined): EdcDriver {
  if (!i || i.connector === 'edc-manual') return manualDriver(String(i?.config.bank || 'EDC'), i?.config.requireLast4 !== false);
  if (i.connector === 'edc-simulator') return simulatorDriver();
  return ecrDriver(ECR[i.connector] ?? i.name);
}

/** What lands on Payment.ref (and on the receipt): bank, approval code, trace, masked card. */
export const edcRef = (bank: string, r: ChargeRes) => ['EDC ' + bank, 'Appr ' + r.approvalCode, r.trace && 'Trace ' + r.trace, r.cardMasked].filter(Boolean).join(' · ');
