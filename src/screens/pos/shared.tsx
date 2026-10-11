'use client';
// Register plumbing shared by every POS view: page slug → view/sheet, current order, per-tab UI memory,
// the permission + approval flow (in place, approver's PIN on this device) and small counter widgets.
import { createContext, useContext, useState, type ReactNode } from 'react';
import { pagesOf } from '../../system/registry.ts';
import { perm, type PermCode } from '../../system/perms.ts';
import { decide, requestApproval, verifyPin } from '../../data/actions.ts';
import { applyPosApproval } from '../../data/actions/pos.ts';
import { snapshot } from '../../data/store.ts';
import type { DB, Employee, Order, Session } from '../../data/schema.ts';
import type { SessionUser } from '../../session.ts';
import { levelRequired, PIN_LEN, type Level, type RequestType } from '../../domain/approval.ts';
import { SHIFTS } from '../../domain/shift.ts';
import { idr } from '../../domain/money.ts';
import { Avatar, Badge, Icon, Numpad, toast } from '../../ui/kit.tsx';

// ── Routes: every pos page slug → view (+ sheet / tab) ─────────────────────────────────────
export type View = 'lock' | 'open' | 'register' | 'bills' | 'history' | 'shift' | 'change' | 'tools' | 'device';
export interface Route { v: View; s?: string; t?: string }
const R = (v: View, s?: string, t?: string): Route => ({ v, s, t });
// "pos" is the surface root: the default flow (PIN sign-in → open shift → register).
const PAY = (t: string) => R('register', 'pay', t);
export const ROUTES: Record<string, Route> = {
  'register-order': R('register'), 'product-options-sheet': R('register', 'options'), 'table-picker': R('register', 'table'),
  'open-bills-saved-orders': R('bills'), 'customer-lookup-and-points': R('register', 'customer'), 'apply-promo-voucher': R('register', 'voucher'),
  'barcode-scan-and-quick-add': R('register', 'scan'), 'weighed-items': R('register', 'weighed'), 'open-item-custom-price': R('register', 'openitem'),
  'item-note-and-kitchen-note': R('register', 'notes'), 'item-discount': R('register', 'itemdisc'), 'order-discount': R('register', 'orderdisc'),
  'change-price': R('register', 'price'), 'order-type-and-channel': R('register', 'type'), 'merge-tables': R('register', 'merge'), 'move-table': R('register', 'move'),
  'split-order-to-new-bill': R('register', 'split'), 'guest-count-and-service-charge': R('register', 'guests'), 'course-firing-send-to-kitchen': R('register', 'fire'),
  'hold-order': R('register', 'hold'), 'reprint-kitchen-ticket': R('register', 'ticket'), 'reservations-and-walk-in-queue': R('tools', undefined, 'reservations'),
  'add-new-customer': R('register', 'customer', 'new'), 'member-card-scan': R('register', 'customer', 'scan'), 'redeem-points': R('register', 'redeem'),
  'gift-card-deposit-balance': R('register', 'balance'), tips: PAY('tips'),
  'payment-method-picker': PAY(''), cash: PAY('cash'), qris: PAY('qris'), 'card-edc': PAY('card'), 'e-wallet': PAY('ewallet'), 'virtual-account': PAY('va'),
  'split-bill': PAY('split'), 'payment-failed': PAY('failed'), 'receipt-and-success': PAY('success'), 'multiple-payments-in-one-bill': PAY('multi'),
  'partial-payment-down-payment': PAY('partial'), 'customer-credit': PAY('kasbon'), 'pay-with-deposit-gift-card': PAY('deposit'), 'cash-rounding': PAY('rounding'),
  'payment-pending': PAY('pending'), 'manual-payment-confirmation': PAY('manual'),
  'shift-transaction-history': R('history'), 'request-void-refund': R('history', 'voidrefund'), 'offline-mode-and-sync-queue': R('device', undefined, 'sync'),
  'reprint-receipt': R('history', 'receipt'), 'send-e-receipt': R('history', 'ereceipt'), 'order-detail-and-edit-after-payment': R('history', 'detail'),
  refund: R('history', 'refund'), exchange: R('history', 'exchange'), 'price-check': R('tools', undefined, 'price'), 'stock-check': R('tools', undefined, 'stock'),
  'product-sold-out-toggle': R('tools', undefined, 'soldout'), 'manager-pin-override': R('tools', undefined, 'override'),
  'open-shift': R('open'), 'close-shift': R('shift', undefined, 'close'), 'clock-in-out': R('shift', undefined, 'clock'), 'personal-shift-report': R('shift', undefined, 'mine'),
  'shift-summary-before-close': R('shift', undefined, 'x'), 'end-of-day-print': R('shift', undefined, 'z'), 'cash-in-cash-out': R('shift', undefined, 'cash'),
  'cash-drop-to-safe': R('shift', undefined, 'drop'), 'handover-to-next-cashier': R('shift', undefined, 'handover'),
  'shift-ending-reminder': R('change', undefined, '0'), 'blind-drawer-count': R('change', undefined, '1'), handover: R('change', undefined, '2'),
  'clock-out-and-x-report': R('change', undefined, '3'), 'next-cashier-clock-in-and-float-confirm': R('change', undefined, '4'),
  'printer-and-drawer-connection': R('device', undefined, 'printer'), 'customer-display-pairing': R('device', undefined, 'display'), 'edc-pairing': R('device', undefined, 'edc'),
  'barcode-scanner-and-scale-test': R('device', undefined, 'scanner'), 'register-settings': R('device', undefined, 'settings'), 'sync-status-and-retry': R('device', undefined, 'sync'),
  'lock-screen': R('lock'), pos: R('lock'),
};
const PATHS = Object.fromEntries(pagesOf('pos').map(p => [p.slug, p.path]));
/** Registry path of a pos page by slug (falls back to the register). */
export const P = (slug: string, q?: Record<string, string>) => (PATHS[slug] ?? PATHS['register-order']) + (q ? '?' + new URLSearchParams(q) : '');
export const ONLINE_INBOX = '/pos/selling/online-and-qr-orders-inbox', RIDE_INBOX = '/pos/selling/ride-hailing-orders-inbox';
export const REG = P('register-order');

// ── Per-tab UI memory (survives page changes; the data itself lives in the store) ───────────────
const UI_KEY = 'borniz-pos-ui';
export function uiGet<T>(k: string, fallback: T): T { try { const v = JSON.parse(sessionStorage.getItem(UI_KEY) || '{}')[k]; return v === undefined ? fallback : v; } catch { return fallback; } }
export function uiSet(k: string, v: unknown) { try { const o = JSON.parse(sessionStorage.getItem(UI_KEY) || '{}'); if (v === undefined) delete o[k]; else o[k] = v; sessionStorage.setItem(UI_KEY, JSON.stringify(o)); } catch { /* private mode: in-memory only */ } }

// ── Context ──────────────────────────────────────────────────────────────────────────────
export interface Pos {
  db: DB; me: Employee; user: SessionUser; outletId: string; go: (p: string) => void; route: Route; slug: string; q: URLSearchParams;
  session: Session | undefined; cur: Order | undefined; setCur: (id: string | null) => void; ensureOrder: () => string;
  setting: { (id: string, fallback: string): string; (id: string, fallback: number): number; (id: string, fallback: boolean): boolean };
}
export const PosCtx = createContext<Pos | null>(null);
export const usePos = () => useContext(PosCtx)!;
export const SETTINGS_PATH = '/pos/device/register-settings';

export const OPEN_STATUSES: Order['status'][] = ['open', 'sent', 'preparing', 'ready', 'served', 'paying'];
export const isOpenBill = (o: Order) => OPEN_STATUSES.includes(o.status) || o.status === 'held';
export const paidOf = (db: DB, orderId: string) => db.payments.filter(p => p.orderId === orderId && p.status === 'settled').reduce((a, p) => a + p.amount, 0);
export const label = (o: Order) => o.type === 'dine' ? (o.table ?? 'Dine-in') : o.type === 'take' ? 'Takeaway' : 'Delivery';
export const itemsOf = (o: Order) => o.lines.reduce((a, l) => a + l.qty, 0);
export const startOfDay = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };

/** Today's roster slot for an employee at the outlet (Mon = day 0). */
export function rosterSlot(db: DB, outletId: string, empId: string) {
  const day = (new Date().getDay() + 6) % 7, r = db.roster.find(x => x.outletId === outletId && x.day === day);
  if (!r) return null;
  const h = new Date().getHours();
  const mine = (Object.keys(r.slots) as (keyof typeof SHIFTS)[]).filter(k => r.slots[k].pic === empId || r.slots[k].crew.includes(empId));
  const k = mine.find(k => h >= +SHIFTS[k][1].slice(0, 2) && h < +SHIFTS[k][2].slice(0, 2)) ?? mine[0];
  return k ? { key: k, name: SHIFTS[k][0], from: SHIFTS[k][1], to: SHIFTS[k][2], pic: r.slots[k].pic } : null;
}
/** PIC of the shift running now at the outlet. */
export function picNow(db: DB, outletId: string) {
  const day = (new Date().getDay() + 6) % 7, r = db.roster.find(x => x.outletId === outletId && x.day === day), h = new Date().getHours();
  if (!r) return undefined;
  const k = (Object.keys(r.slots) as (keyof typeof SHIFTS)[]).find(k => h >= +SHIFTS[k][1].slice(0, 2) && h < +SHIFTS[k][2].slice(0, 2)) ?? 'siang';
  return db.employees.find(e => e.id === r.slots[k].pic);
}

// ── Permissions + approvals ───────────────────────────────────────────────────────────────
const RANK: Record<Level, number> = { cashier: 0, pic: 1, manager: 2, owner: 3 };
export const levelOf = (role: string): Level => role === 'owner' ? 'owner' : role === 'manager' ? 'manager' : role === 'pic' ? 'pic' : 'cashier';
export type PermAction = 'Take orders & charge' | 'Apply discount' | 'Void item' | 'Refund' | 'Open drawer without sale' | 'Mark item sold out' | 'Close cash for the day' | 'Accept online order';
export const usePerm = () => { const { db, user, outletId } = usePos(); return (a: PermAction): PermCode => perm(db, user.role, a, outletId); };
/** Outline for actions that need someone else's PIN ('a' in the matrix). */
export const warnStyle = (c: PermCode) => c === 'a' ? { borderColor: 'var(--warning)', boxShadow: 'inset 0 0 0 1px var(--warning)' } : undefined;

interface Ask { action: PermAction; type: RequestType; title: string; amount?: number; pct?: number; subjectId?: string | null; note?: string; payload?: Record<string, unknown>; direct?: () => void; done?: () => void }
interface PadReq { approvalId?: string; level: Level; title: string; detail?: string; onOk: (approverId: string) => void }

/** One flow for every guarded action: allowed + within your level → do it; otherwise request approval and
 *  ask the approver's PIN right here (or leave it in the queue for the PIC / manager's own device). */
export function useApproval() {
  const pos = usePos();
  const [pad, setPad] = useState<PadReq | null>(null);
  const run = (a: Ask) => {
    const code = perm(pos.db, pos.user.role, a.action, pos.outletId);
    if (code === 'n') { toast(`${a.action} is turned off for your role`); return; }
    const lvl = levelRequired(a.type, a.amount ?? 0, a.pct ?? 0);
    if (a.direct && code !== 'a' && RANK[levelOf(pos.user.role)] >= RANK[lvl]) { a.direct(); a.done?.(); return; }
    const r = requestApproval({ type: a.type, title: a.title, amount: a.amount, pct: a.pct, requestedBy: pos.me.id, outletId: pos.outletId, subjectId: a.subjectId, note: a.note, payload: a.payload });
    if (r.level === 'cashier') { const row = snapshot().approvals.find(x => x.id === r.id); if (row) applyPosApproval(row, pos.me.id); a.done?.(); return; }
    setPad({ approvalId: r.id, level: r.level, title: a.title, detail: a.note, onOk: () => a.done?.() });
  };
  /** PIN-only override (no approval row), e.g. sold-out toggle or no-sale drawer for roles marked 'a'. */
  const verify = (action: PermAction, title: string, onOk: (by: string) => void, level: Level = 'pic') => {
    const code = perm(pos.db, pos.user.role, action, pos.outletId);
    if (code === 'n') { toast(`${action} is turned off for your role`); return; }
    if (code !== 'a' && RANK[levelOf(pos.user.role)] >= RANK[level]) { onOk(pos.me.id); return; }
    setPad({ level, title, onOk });
  };
  const resume = (approvalId: string, title: string, level: Level, onOk: () => void = () => {}) => setPad({ approvalId, level, title, onOk });
  const node = pad && <ApproverPad {...pad} onClose={() => setPad(null)} />;
  return { run, verify, resume, node, open: !!pad, close: () => setPad(null) };
}

/** "Approval needed" panel: the approver picks themselves, types their own 6-digit approval PIN on this register. */
export function ApproverPad({ approvalId, level, title, detail, onOk, onClose }: PadReq & { onClose: () => void }) {
  const { db, me, outletId } = usePos();
  const row = approvalId ? db.approvals.find(a => a.id === approvalId) : undefined;
  const pic = picNow(db, outletId);
  const people = db.employees.filter(e => e.active && e.id !== me.id && e.outlets.includes(outletId) && RANK[levelOf(e.role)] >= RANK[row?.level ?? level])
    .sort((a, b) => (b.id === pic?.id ? 1 : 0) - (a.id === pic?.id ? 1 : 0) || RANK[levelOf(a.role)] - RANK[levelOf(b.role)]);
  const [who, setWho] = useState<string | null>(people[0]?.id ?? null);
  const [pin, setPin] = useState(''), [err, setErr] = useState(''), [shake, setShake] = useState(false), [decision, setDecision] = useState<'approved' | 'rejected'>('approved');
  const key = (k: string) => {
    if (!who) return;
    if (k === 'del') return setPin(p => p.slice(0, -1));
    if (!/^\d$/.test(k)) return;
    const p = (pin + k).slice(0, PIN_LEN); setPin(p); setErr('');
    if (p.length < PIN_LEN) return;
    const bad = verifyPin(who, p) ?? (approvalId ? decide(approvalId, who, decision) : null);
    if (bad) { setErr(bad); setShake(true); setTimeout(() => { setShake(false); setPin(''); }, 320); return; }
    const name = db.employees.find(e => e.id === who)?.name;
    toast(decision === 'approved' ? `Approved by ${name}` : `Rejected by ${name}`);
    onClose(); if (decision === 'approved') onOk(who);
  };
  if (row && row.status !== 'waiting') {
    const by = db.employees.find(e => e.id === row.decidedBy)?.name ?? 'approver';
    return <div className="stack" style={{ alignItems: 'center', textAlign: 'center', padding: '24px 0' }}>
      <Icon name={row.status === 'approved' ? 'circle-check' : 'circle-x'} size={40} style={{ color: row.status === 'approved' ? 'var(--success)' : 'var(--danger)' }} />
      <h3>{row.status === 'approved' ? 'Approved' : 'Rejected'} by {by}</h3><p className="muted">{row.title}</p>
      <button className="btn btn-primary btn-pos" onClick={() => { onClose(); if (row.status === 'approved') onOk(row.decidedBy ?? ''); }}>Continue</button>
    </div>;
  }
  return <div className="stack" role="group" aria-label="Approval needed" onKeyDown={e => key(e.key === 'Backspace' ? 'del' : e.key)} tabIndex={-1}>
    <div className="banner b-warning"><Icon name="shield-alert" /><div className="stack sm" style={{ gap: 2 }}><b>Approval needed · {(row?.level ?? level).toUpperCase()} decides</b><span>{title}{detail ? ' · ' + detail : ''}</span></div></div>
    {people.length === 0 ? <p className="muted">Nobody with {level} rights works at this outlet. The request waits in the queue.</p> : <>
      <span className="cap">Who is approving?</span>
      <div className="row wrap">{people.map(e => <button key={e.id} className="chip row" aria-pressed={who === e.id} onClick={() => { setWho(e.id); setPin(''); setErr(''); }} style={{ height: 44 }}>
        <Avatar name={e.name} color={e.color} size={26} />{e.name}<span className="faint" style={{ fontWeight: 500 }}>{e.role}{e.id === pic?.id ? ' · on shift' : ''}</span></button>)}</div>
      {approvalId && <div className="seg" role="group" aria-label="Decision">{(['approved', 'rejected'] as const).map(d => <button key={d} aria-pressed={decision === d} onClick={() => setDecision(d)}>{d === 'approved' ? 'Approve' : 'Reject'}</button>)}</div>}
      <div className={'pin-dots' + (shake ? ' shake' : '')} aria-label={`${pin.length} of ${PIN_LEN} digits`} style={{ margin: '8px 0' }}>{Array.from({ length: PIN_LEN }, (_, i) => <i key={i} className={i < pin.length ? 'on' : ''} />)}</div>
      {err && <p role="alert" style={{ color: 'var(--danger-fg)', textAlign: 'center', fontSize: 14 }}>{err}</p>}
      <div style={{ width: 'min(320px,100%)', alignSelf: 'center' }}><Numpad onKey={key} extra="" /></div>
      <p className="faint" style={{ fontSize: 13, textAlign: 'center' }}>{db.employees.find(e => e.id === who)?.name ?? 'Approver'} types their own approval PIN. Demo 246810.</p>
    </>}
    <button className="btn btn-ghost" onClick={onClose}>{approvalId ? 'Leave it in the queue' : 'Cancel'}</button>
  </div>;
}

/** Approvals this order is waiting for (shown as a live banner in the cart / sheets). */
export const waitingFor = (db: DB, orderId: string) => db.approvals.filter(a => a.status === 'waiting' && (a.subjectId === orderId || (a.payload as { orderId?: string } | undefined)?.orderId === orderId));

// ── Small widgets ─────────────────────────────────────────────────────────────────────────
export function Stepper({ value, onChange, min = 0, max = 999, label: l }: { value: number; onChange: (n: number) => void; min?: number; max?: number; label?: string }) {
  return <div className="row" role="group" aria-label={l} style={{ gap: 4 }}>
    <button className="btn icon-btn" aria-label={'Less ' + (l ?? '')} onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min}><Icon name="minus" /></button>
    <b className="num" style={{ minWidth: 32, textAlign: 'center', fontSize: 18 }}>{value}</b>
    <button className="btn icon-btn" aria-label={'More ' + (l ?? '')} onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max}><Icon name="plus" /></button>
  </div>;
}
/** Amount entry: big display + numpad (cash tender, open price, cash moves). Value is integer rupiah. */
export function AmountPad({ value, onChange, title = 'Amount', hint }: { value: number; onChange: (n: number) => void; title?: string; hint?: ReactNode }) {
  const key = (k: string) => onChange(k === 'del' ? Math.floor(value / 10) : Math.min(99_999_999, Number(String(value || '') + k)));
  return <div className="stack sm">
    <div className="sunken row between"><span className="muted">{title}</span><b className="num" style={{ fontSize: 28 }}>{idr(value)}</b></div>
    {hint}
    <Numpad onKey={key} extra="000" />
  </div>;
}
export const DENOMS = [100000, 50000, 20000, 10000, 5000, 2000, 1000, 500, 200, 100];
export const denomLabel = (d: number) => d >= 1000 ? d / 1000 + 'k' : String(d);
/** Count by denomination (blind: the expected amount is never shown here). */
export function DenomCount({ counts, onChange }: { counts: Record<number, number>; onChange: (c: Record<number, number>) => void }) {
  return <div className="grid" style={{ ['--min' as string]: '220px', gap: 8 }}>
    {DENOMS.map(d => <div key={d} className="row between card tight" style={{ padding: '6px 10px' }}>
      <span className="stack" style={{ gap: 0 }}><b className="num">{denomLabel(d)}</b><span className="faint" style={{ fontSize: 13 }}>{counts[d] ? idr(d * counts[d]) : d < 1000 ? 'coins' : 'notes'}</span></span>
      <span className="row" style={{ gap: 4 }}>
        <button className="btn icon-btn" aria-label={`One less ${denomLabel(d)}`} onClick={() => onChange({ ...counts, [d]: Math.max(0, (counts[d] ?? 0) - 1) })}><Icon name="minus" /></button>
        <input className="input num" inputMode="numeric" aria-label={`Count of ${denomLabel(d)}`} value={counts[d] ?? 0} onChange={e => onChange({ ...counts, [d]: Math.max(0, Number(e.target.value.replace(/\D/g, '')) || 0) })} style={{ width: 56, height: 44, textAlign: 'center', padding: 0 }} />
        <button className="btn icon-btn" aria-label={`One more ${denomLabel(d)}`} onClick={() => onChange({ ...counts, [d]: (counts[d] ?? 0) + 1 })}><Icon name="plus" /></button>
      </span>
    </div>)}
  </div>;
}
export const sumDenoms = (c: Record<number, number>) => DENOMS.reduce((a, d) => a + d * (c[d] ?? 0), 0);

/** Tabs that are pages: each tab is its own registry URL. */
export function TabLinks({ tabs, active }: { tabs: [string, string, string?][]; active: string }) {
  const { go } = usePos();
  return <div className="seg" role="tablist" style={{ alignSelf: 'flex-start' }}>
    {tabs.map(([k, l, slug]) => <button key={k} role="tab" aria-pressed={active === k} aria-selected={active === k} onClick={() => go(P(slug ?? k))}>{l}</button>)}
  </div>;
}
export const Row = ({ l, v, strong, tone }: { l: ReactNode; v: ReactNode; strong?: boolean; tone?: string }) =>
  <div className="row between" style={{ fontSize: strong ? 17 : 14, fontWeight: strong ? 700 : 400, color: tone }}><span>{l}</span><span className="num" style={{ fontWeight: strong ? 700 : 600 }}>{v}</span></div>;
export const Pill = ({ ok, children }: { ok: boolean; children: ReactNode }) => <Badge tone={ok ? 'success' : 'danger'} dot>{children}</Badge>;

/** Thermal receipt / ticket preview, 48 columns (80mm). */
export function Paper({ lines }: { lines: string[] }) {
  return <pre className="mono" style={{ margin: 0, padding: 16, background: 'var(--bg-sunken)', borderRadius: 'var(--radius-md)', fontSize: 12, lineHeight: 1.5, overflowX: 'auto', whiteSpace: 'pre' }}>{lines.join('\n')}</pre>;
}
const COL = 42;
const lr = (l: string, r: string) => { const s = l.slice(0, COL - r.length - 1); return s + ' '.repeat(Math.max(1, COL - s.length - r.length)) + r; };
const n0 = (n: number) => Math.round(n).toLocaleString('en-US');
export function receiptLines(db: DB, o: Order, copy = false) {
  const out = db.outlets.find(x => x.id === o.outletId)!, cashier = db.employees.find(e => e.id === o.cashierId)?.name ?? '-';
  const cust = db.customers.find(c => c.id === o.customerId);
  const pays = db.payments.filter(p => p.orderId === o.id && p.status === 'settled' && p.ref !== 'ROUNDING');
  const rounding = db.payments.filter(p => p.orderId === o.id && p.ref === 'ROUNDING').reduce((a, p) => a + p.amount, 0);
  const at = new Date(o.paidAt ?? o.createdAt);
  return [
    db.tenant.name.toUpperCase() + ' · ' + out.name.toUpperCase(), out.city, '-'.repeat(COL),
    lr('No ' + o.no, at.toLocaleDateString('en-GB') + ' ' + at.toTimeString().slice(0, 5)), lr('Cashier ' + cashier, label(o) + (o.type === 'dine' ? ` · ${o.guests} pax` : '')),
    ...(cust ? [lr('Member ' + cust.name, '')] : []), '-'.repeat(COL),
    ...o.lines.flatMap(l => [lr(`${l.qty} ${l.name}`, n0(((l.flashPrice ?? l.unitPrice) + l.mods.reduce((a, m) => a + m.price, 0)) * l.qty * (1 - l.discountPct / 100))), ...l.mods.map(m => '  - ' + m.name), ...(l.note ? ['  * ' + l.note] : [])]),
    '-'.repeat(COL), lr('Subtotal', n0(o.subtotal)), ...(o.discount ? [lr('Discount', '-' + n0(o.discount))] : []),
    ...(o.service ? [lr(`Service ${out.serviceBps / 100}%`, n0(o.service))] : []), lr(`PB1 ${out.taxBps / 100}%${out.taxInclusive ? ' (incl.)' : ''}`, n0(o.tax)),
    ...(rounding ? [lr('Cash rounding', '-' + n0(rounding))] : []), lr('TOTAL IDR', n0(o.total - rounding)),
    ...pays.map(p => lr(p.method.toUpperCase() + (p.tip ? ` (tip ${n0(p.tip)})` : ''), n0(p.amount + p.tip))), '-'.repeat(COL),
    copy ? '*** COPY ***' : 'Terima kasih!', 'Powered by BorNiz',
  ];
}
