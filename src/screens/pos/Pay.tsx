'use client';
import { QR } from '../../ui/qr.tsx';
// Payment: one sheet, no stacked modals. Left = amount due, tip and methods (F1–F6); right = the method's panel.
// QRIS / VA / e-wallet only settle through gatewayWebhook; the "simulate" buttons stand in for the bank.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cancelPayment, gatewayWebhook, holdOrder, patchOrder, startPayment } from '../../data/actions.ts';
import { enqueue, logDevice, payCash, sendReceipt } from '../../data/actions/pos.ts';
import { lineTotal, methodAvailable, type Method } from '../../domain/order.ts';
import { roundCash, idr } from '../../domain/money.ts';
import { Badge, Empty, Field, Icon, Numpad, Seg, Status, ago, toast, useNow } from '../../ui/kit.tsx';
import type { Order, Payment } from '../../data/schema.ts';
import { P, REG, Stepper, AmountPad, itemsOf, paidOf, uiGet, uiSet, usePos, useApproval } from './shared.tsx';

const METHODS: [string, string, string, string, string][] = [
  ['cash', 'Cash', 'Numpad & change', 'banknote', 'F1'], ['qris', 'QRIS', 'All banks & e-wallets', 'qr-code', 'F2'], ['card-edc', 'Card', 'Debit / credit via EDC', 'credit-card', 'F3'],
  ['e-wallet', 'E-wallet', 'GoPay · OVO · DANA · ShopeePay', 'wallet', 'F4'], ['virtual-account', 'Virtual account', 'BCA · BNI · Mandiri · BRI', 'landmark', 'F5'], ['split-bill', 'Split bill', 'Evenly · by item · custom', 'split', 'F6'],
];
const MORE: [string, string, string][] = [['pay-with-deposit-gift-card', 'Deposit / gift card', 'deposit'], ['customer-credit', 'Kasbon', 'kasbon'], ['partial-payment-down-payment', 'Down payment', 'partial'],
  ['multiple-payments-in-one-bill', 'Multiple payments', 'multi'], ['manual-payment-confirmation', 'Manual confirm', 'manual'], ['payment-pending', 'Pending', 'pending'], ['tips', 'Tips', 'tips'], ['cash-rounding', 'Cash rounding', 'rounding']];
const SLUG_OF: Record<string, string> = { cash: 'cash', qris: 'qris', card: 'card-edc', ewallet: 'e-wallet', va: 'virtual-account', split: 'split-bill' };
const NAME: Record<Method, string> = { cash: 'Cash', qris: 'QRIS', card: 'Card', ewallet: 'E-wallet', va: 'Virtual account', deposit: 'Deposit', kasbon: 'Kasbon' };
const GATEWAY: Method[] = ['qris', 'ewallet', 'va'];

export function PaySheet() {
  const pos = usePos();
  const { db, cur, route, go } = pos;
  const mode = route.t ?? '';
  const [oid] = useState(() => cur?.id);
  const o = db.orders.find(x => x.id === oid);
  const close = () => go(REG);

  useEffect(() => { // paid (instantly, or later by the gateway webhook) → success
    if (o?.status === 'paid' && mode !== 'success') {
      if (uiGet<{ id?: string }>('lastPaid', {}).id !== o.id) uiSet('lastPaid', { id: o.id, change: 0 });
      pos.setCur(null); go(P('receipt-and-success'));
    }
  }, [o?.status, mode]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const f = /^F([1-6])$/.exec(e.key);
      if (f && mode !== 'success') { e.preventDefault(); go(P(METHODS[+f[1] - 1][0])); }
      if (e.key === 'Escape') close();
    };
    addEventListener('keydown', k); return () => removeEventListener('keydown', k);
  });

  let body: ReactNode;
  if (mode === 'success') body = <Success />;
  else if (!o || !o.lines.length) body = <div style={{ padding: 24 }}><Empty icon="shopping-basket" title="Nothing to charge" action={<button className="btn btn-primary btn-pos" onClick={close}>Back to the register</button>}>The cart is empty. Add items on the register, then press Charge (or Enter).</Empty></div>;
  else body = <PayBody o={o} mode={mode} />;
  return <>
    <div className="scrim" onClick={close} />
    <div className="sheet center" role="dialog" aria-modal="true" aria-label="Payment" style={{ width: 'min(940px, calc(100vw - 24px))', maxHeight: 'calc(100dvh - 24px)', overflow: 'auto' }}>{body}</div>
  </>;
}

function PayBody({ o, mode }: { o: Order; mode: string }) {
  const { db, go } = usePos();
  const paid = paidOf(db, o.id), remaining = o.total - paid;
  const pays = db.payments.filter(p => p.orderId === o.id && p.ref !== 'ROUNDING');
  const pending = pays.filter(p => p.status === 'pending');
  const [tip, setTipS] = useState<number>(() => uiGet('tip:' + o.id, 0));
  const setTip = (n: number) => { setTipS(n); uiSet('tip:' + o.id, n); };
  const online = db.device.online;
  const active = SLUG_OF[mode] ?? mode;
  const Panel = PANELS[mode] ?? NonePanel;
  return <div className="pos-pay">
    <div className="stack" style={{ padding: 20, background: 'var(--bg-sunken)', gap: 10 }}>
      <span className="cap">Order {o.no} · {itemsOf(o)} items · {o.type === 'dine' ? o.table ?? 'Dine-in' : o.type === 'take' ? 'Takeaway' : 'Delivery'}</span>
      <b className="num" style={{ fontSize: 38, lineHeight: 1 }}>{idr(remaining)}</b>
      <span className="muted" style={{ fontSize: 13 }}>{paid ? `${idr(o.total)} total · ${idr(paid)} paid` : 'Includes PB1 and service'}{tip ? ` · tip ${idr(tip)}` : ''}</span>
      <div className="row wrap" style={{ gap: 6 }} aria-label="Tip">{[0, 5000, 10000, 20000].map(t => <button key={t} className="chip" aria-pressed={tip === t} onClick={() => setTip(t)}>{t ? '+' + t / 1000 + 'k tip' : 'No tip'}</button>)}</div>
      {!online && <div className="banner b-danger" style={{ padding: '8px 12px' }}><Icon name="wifi-off" size={18} /><span>Offline: QRIS, VA and e-wallet need internet. Use cash or card.</span></div>}
      <div className="stack sm">{METHODS.map(([slug, l, s, ic, key]) => {
        const m = slug === 'card-edc' ? 'card' : slug === 'e-wallet' ? 'ewallet' : slug === 'virtual-account' ? 'va' : slug.replace('-bill', '');
        const off = !methodAvailable(m as Method, online) && m !== 'split';
        return <button key={slug} className="row card tight" disabled={off} onClick={() => go(P(slug))} aria-pressed={active === slug}
          style={{ cursor: off ? 'not-allowed' : 'pointer', textAlign: 'left', minHeight: 56, padding: '8px 12px', opacity: off ? .45 : 1, borderColor: active === slug ? 'var(--accent)' : undefined, background: active === slug ? 'var(--accent-soft)' : undefined }}>
          <Icon name={ic} size={22} /><span className="grow stack" style={{ gap: 0 }}><b style={{ fontSize: 15 }}>{l}</b><span className="muted" style={{ fontSize: 13 }}>{off ? 'Needs internet' : s}</span></span><span className="mono faint">{key}</span></button>;
      })}</div>
      <div className="row wrap" style={{ gap: 6 }}>{MORE.map(([slug, l, k]) => <button key={slug} className="chip" aria-pressed={mode === k} onClick={() => go(P(slug))}>{l}{k === 'pending' && pending.length ? ` · ${pending.length}` : ''}</button>)}</div>
      {pays.length > 0 && <div className="stack sm"><span className="cap">Payments on this bill</span>{pays.map(p => <div key={p.id} className="row between" style={{ fontSize: 14 }}><span>{NAME[p.method]} · <span className="mono">{p.ref}</span></span><span className="row" style={{ gap: 6 }}><b className="num">{idr(p.amount)}</b><Status s={p.status} /></span></div>)}</div>}
    </div>
    <div className="stack" style={{ padding: 20, minWidth: 0 }}>
      <div className="row between"><span /><button className="btn btn-ghost icon-btn" onClick={() => go(REG)} aria-label="Close payment"><Icon name="x" /></button></div>
      <Panel o={o} remaining={remaining} tip={tip} setTip={setTip} />
    </div>
  </div>;
}
type PanelProps = { o: Order; remaining: number; tip: number; setTip: (n: number) => void };

function NonePanel() {
  return <div className="empty" style={{ flex: 1, justifyContent: 'center' }}><Icon name="hand-coins" size={40} /><h3 style={{ color: 'var(--fg-1)' }}>Pick a payment method</h3><span>Shortcut keys F1–F6 · Esc to go back</span></div>;
}

/** Records who paid what, then the effect in PaySheet moves to the success screen once the order is paid. */
function useCharge(o: Order) {
  const { me } = usePos();
  return (m: Method, amount: number, tip = 0, change = 0) => {
    try {
      uiSet('lastPaid', { id: o.id, change, method: NAME[m] });
      const id = startPayment(o.id, m, amount, me.id, tip); enqueue('payment.' + m); return id;
    } catch (e) { toast((e as Error).message); return null; }
  };
}

function CashPanel({ o, remaining, tip }: PanelProps) {
  const { me, setting, route, go } = usePos();
  const step = setting('rounding', 100), due = step ? roundCash(remaining, step) : remaining, toPay = due + tip;
  const [tender, setTender] = useState(0);
  const change = tender - toPay;
  const quick = [...new Set([toPay, Math.ceil(toPay / 10000) * 10000, Math.ceil(toPay / 50000) * 50000, Math.ceil(toPay / 100000) * 100000, Math.ceil(toPay / 100000) * 100000 + 50000])].slice(0, 5);
  const done = () => { if (change < 0 || !tender) return; uiSet('lastPaid', { id: o.id, change, method: 'Cash' }); payCash(o.id, due, remaining, me.id, tip); enqueue('payment.cash'); };
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); done(); } }; addEventListener('keydown', k); return () => removeEventListener('keydown', k); });
  return <div className="stack">
    <h3>Cash</h3>
    {route.t === 'rounding' && <div className="banner b-info"><Icon name="info" /><span>Cash is rounded to the nearest IDR {step || 1} as its own line, applied last. Card, QRIS and e-wallet pay the exact total. Change the step in <button className="btn btn-ghost btn-sm" onClick={() => go(P('register-settings'))}>Register settings</button></span></div>}
    <div className="row wrap" style={{ gap: 6 }}>{quick.map((v, i) => <button key={v} className="chip" style={{ height: 48 }} onClick={() => setTender(v)}>{i === 0 ? 'Exact' : idr(v).replace('IDR ', '')}</button>)}</div>
    <div className="sunken row between"><span className="muted">Received</span><b className="num" style={{ fontSize: 30 }}>{idr(tender)}</b></div>
    <Numpad onKey={k => setTender(t => k === 'del' ? Math.floor(t / 10) : Math.min(99_999_999, Number(String(t || '') + k)))} extra="000" />
    <div className="stack" style={{ gap: 2 }}>
      {due !== remaining && <div className="row between muted" style={{ fontSize: 14 }}><span>Cash rounding</span><span className="num">{due > remaining ? '+' : '−'} {idr(Math.abs(due - remaining))}</span></div>}
      {tip > 0 && <div className="row between muted" style={{ fontSize: 14 }}><span>Tip</span><span className="num">{idr(tip)}</span></div>}
      <div className="row between"><span className="muted">To pay</span><b className="num">{idr(toPay)}</b></div>
      <div className="row between" style={{ fontSize: 20 }}><b>Change</b><b className="num" style={{ color: tender && change < 0 ? 'var(--danger-fg)' : 'var(--success-fg)' }}>{!tender ? '—' : change < 0 ? 'Short ' + idr(-change) : idr(change)}</b></div>
    </div>
    <button className="btn btn-primary btn-pay" disabled={!tender || change < 0} onClick={done}>Complete · open drawer</button>
  </div>;
}

/** QRIS on the register: the one QR encoder; encodes the gateway reference (production: the gateway's QRIS payload). */
const QrArt = ({ seed, size = 220 }: { seed: string; size?: number }) => <div style={{ background: 'var(--ink-0)', color: 'var(--ink-950)', borderRadius: 12, boxShadow: 'var(--shadow-e1)', padding: 4 }}><QR value={seed} size={size} label="QRIS code" /></div>;

function GatewayPanel({ o, remaining, tip, m }: PanelProps & { m: 'qris' | 'ewallet' | 'va' }) {
  const { db, me, go } = usePos();
  const charge = useCharge(o);
  const now = useNow(1000);
  const p = db.payments.filter(x => x.orderId === o.id && x.method === m && x.status === 'pending').at(-1);
  const left = p?.expiresAt ? Math.max(0, Math.ceil((p.expiresAt - now) / 1000)) : null;
  const expired = useRef(false);
  useEffect(() => { if (p && left === 0 && !expired.current) { expired.current = true; gatewayWebhook(p.id, 'expired'); go(P('payment-failed', { m })); } }, [left, p, go, m]);
  if (!db.device.online) return <Blocked />;
  const title = m === 'qris' ? 'QRIS' : m === 'ewallet' ? 'E-wallet' : 'Virtual account';
  if (!p) return <div className="stack">
    <h3>{title}</h3>
    <div className="sunken stack sm"><span className="muted">{m === 'qris' ? 'The QR shows here and on the customer display.' : m === 'ewallet' ? 'A payment request is pushed to the guest’s GoPay, OVO, DANA or ShopeePay.' : 'A one-off VA number is created for this bill. Valid 60 minutes.'}</span>
      <b className="num" style={{ fontSize: 24 }}>{idr(remaining + tip)}</b></div>
    <button className="btn btn-primary btn-pay" onClick={() => charge(m, remaining, tip)}>{m === 'qris' ? 'Show QR' : m === 'ewallet' ? 'Send request' : 'Create VA number'} · {idr(remaining + tip)}</button>
  </div>;
  const failMethod = () => { gatewayWebhook(p.id, 'failed'); go(P('payment-failed', { m })); };
  return <div className="stack" style={{ alignItems: 'center', textAlign: 'center' }}>
    <div className="row between" style={{ alignSelf: 'stretch' }}><h3>{title}</h3>{left != null ? <Badge tone={left < 60 ? 'danger' : 'warning'} dot>Waiting · {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}</Badge> : <Badge tone="warning" dot>Waiting for the bank</Badge>}</div>
    {m === 'qris' ? <QrArt seed={p.ref} /> : <div className="sunken stack sm" style={{ alignSelf: 'stretch' }}><Icon name={m === 'va' ? 'landmark' : 'wallet'} size={32} style={{ alignSelf: 'center' }} />
      <b className="mono" style={{ fontSize: 20 }}>{m === 'va' ? '8808 ' + p.ref.replace(/\D/g, '').padEnd(10, '0').slice(0, 10).replace(/(\d{4})(?=\d)/g, '$1 ') : 'Push sent · ' + p.ref}</b>
      <span className="muted">{m === 'va' ? 'BCA virtual account · the order stays open until the bank confirms.' : 'The guest confirms in their app.'}</span></div>}
    <b className="num" style={{ fontSize: 24 }}>{idr(p.amount + p.tip)}</b>
    <span className="muted" style={{ fontSize: 14, maxWidth: 420 }}>{m === 'qris' ? 'Also showing on the customer display. Ask the guest to scan with any bank or e-wallet.' : ''} It settles only when the bank confirms.</span>
    <div className="banner b-info" style={{ alignSelf: 'stretch', textAlign: 'left' }}><Icon name="flask-conical" /><span className="grow">Demo: stand in for the bank app.</span>
      <button className="btn btn-sm btn-success" onClick={() => gatewayWebhook(p.id, 'settled')}>Simulate bank app paid</button>
      <button className="btn btn-sm" onClick={failMethod}>{m === 'qris' ? 'Expire now' : 'Simulate failed'}</button></div>
    <div className="row"><button className="btn" onClick={() => { cancelPayment(p.id, me.id); toast('Request cancelled'); }}>Cancel request</button><button className="btn" onClick={() => go(P('manual-payment-confirmation'))}>Guest shows proof</button></div>
  </div>;
}
const Blocked = () => <div className="empty"><Icon name="wifi-off" size={36} /><h3 style={{ color: 'var(--fg-1)' }}>Offline</h3><p>QRIS, VA and e-wallet need internet. Use cash or card; they queue and sync when the connection is back.</p></div>;

function CardPanel({ o, remaining, tip }: PanelProps) {
  const { db, outletId, go } = usePos();
  const charge = useCharge(o);
  const edc = db.devices.find(d => d.outletId === outletId && d.kind === 'edc');
  return <div className="stack" style={{ alignItems: 'center', textAlign: 'center' }}>
    <h3 style={{ alignSelf: 'flex-start' }}>Card · EDC</h3>
    <Icon name="credit-card" size={48} style={{ color: 'var(--accent)' }} />
    <b style={{ fontSize: 20 }}>Tap, insert or swipe on the EDC</b>
    <span className="muted">{edc ? `${idr(remaining + tip)} sent to ${edc.name}` : 'No EDC paired at this outlet.'}{edc && edc.status !== 'online' && ' · EDC offline'}</span>
    {!edc && <button className="btn" onClick={() => go(P('edc-pairing'))}>Pair an EDC</button>}
    <div className="banner b-info" style={{ alignSelf: 'stretch', textAlign: 'left' }}><Icon name="flask-conical" /><span className="grow">Demo: the EDC answers.</span>
      <button className="btn btn-sm btn-success" disabled={!edc} onClick={() => charge('card', remaining, tip)}>Approved on EDC</button>
      <button className="btn btn-sm" onClick={() => go(P('payment-failed', { m: 'card' }))}>Declined</button></div>
  </div>;
}

/** Pay a part with a chosen method (split, multiple payments, DP). */
function PayWith({ o, amount, after }: { o: Order; amount: number; after?: () => void }) {
  const { db, go } = usePos();
  const charge = useCharge(o);
  const pay = (m: Method) => { const id = charge(m, amount); if (!id) return; if (GATEWAY.includes(m)) go(P(SLUG_OF[m])); else { toast(`${NAME[m]} ${idr(amount)} received`); after?.(); } };
  return <div className="row wrap" style={{ gap: 6 }}>{(['cash', 'card', 'qris', 'ewallet'] as Method[]).map(m =>
    <button key={m} className="btn btn-pos grow" disabled={!amount || (!methodAvailable(m, db.device.online))} onClick={() => pay(m)}>{NAME[m]}</button>)}</div>;
}

function SplitPanel({ o, remaining }: PanelProps) {
  const { db, route, go } = usePos();
  const kind = route.t === 'multi' ? 'custom' : uiGet<string>('splitKind:' + o.id, 'even');
  const setKind = (k: string) => { uiSet('splitKind:' + o.id, k); if (k === 'custom') go(P('multiple-payments-in-one-bill')); else if (route.t === 'multi') go(P('split-bill')); else setV(v => v + 1); };
  const [, setV] = useState(0);
  const [n, setNs] = useState<number>(() => uiGet('splitN:' + o.id, 2));
  const setN = (x: number) => { setNs(x); uiSet('splitN:' + o.id, x); };
  const per = Math.ceil(o.total / n), paid = paidOf(db, o.id), done = Math.min(n, Math.floor(paid / per + 1e-9));
  const [sel, setSel] = useState<string[]>([]), [amt, setAmt] = useState(remaining);
  const selAmount = Math.min(remaining, Math.round(o.lines.filter(l => sel.includes(l.id)).reduce((a, l) => a + lineTotal({ unitPrice: l.unitPrice, flashPrice: l.flashPrice, modifiers: l.mods.map(m => m.price), qty: l.qty, discountPct: l.discountPct }), 0) / (o.subtotal || 1) * o.total));
  return <div className="stack">
    <h3>{route.t === 'multi' ? 'Multiple payments' : 'Split bill'}</h3>
    <Seg label="Split" value={kind} options={[['even', 'Evenly'], ['item', 'By item'], ['custom', 'Custom']] as const} onChange={setKind} />
    {kind === 'even' && <>
      <div className="row between"><span>Split between</span><Stepper value={n} onChange={setN} min={2} max={12} label="parts" /></div>
      {Array.from({ length: n }, (_, i) => { const a = i === n - 1 ? o.total - per * (n - 1) : per;
        return <div key={i} className="row card tight" style={{ background: i < done ? 'var(--success-soft)' : i === done ? 'var(--accent-soft)' : undefined }}><b className="grow">Part {i + 1}</b><span className="muted">{i < done ? 'Paid' : i === done ? 'Next' : 'Waiting'}</span><b className="num">{idr(a)}</b></div>; })}
      {remaining > 0 && <><span className="cap">Pay part {done + 1} · {idr(Math.min(per, remaining))}</span><PayWith o={o} amount={Math.min(per, remaining)} /></>}
    </>}
    {kind === 'item' && <>
      {o.lines.map(l => <label key={l.id} className="row card tight" style={{ cursor: 'pointer' }}><input type="checkbox" style={{ width: 22, height: 22 }} checked={sel.includes(l.id)} onChange={e => setSel(s => e.target.checked ? [...s, l.id] : s.filter(x => x !== l.id))} /><span className="grow">{l.qty}× {l.name}</span></label>)}
      <div className="sunken row between"><span>Selected incl. tax & service</span><b className="num">{idr(selAmount)}</b></div>
      <PayWith o={o} amount={selAmount} after={() => setSel([])} />
    </>}
    {kind === 'custom' && <><AmountPad value={amt} onChange={setAmt} title={`This payment (of ${idr(remaining)} left)`} /><PayWith o={o} amount={Math.min(amt, remaining)} after={() => setAmt(0)} /></>}
  </div>;
}

function PartialPanel({ o, remaining }: PanelProps) {
  const { db, me, setCur, go } = usePos();
  const [amt, setAmt] = useState(Math.round(remaining / 2 / 1000) * 1000);
  const paid = paidOf(db, o.id);
  return <div className="stack">
    <h3>Down payment</h3>
    <p className="muted" style={{ fontSize: 14 }}>Take part now; the bill stays open in Open bills with the DP on it.</p>
    <AmountPad value={amt} onChange={setAmt} title="Down payment" />
    <PayWith o={o} amount={Math.min(amt, remaining)} />
    {paid > 0 && remaining > 0 && <button className="btn btn-pos" onClick={() => { patchOrder(o.id, { note: [o.note, `DP ${idr(paid)}`].filter(Boolean).join(' · ') }, me.id); holdOrder(o.id, me.id); setCur(null); toast(`DP ${idr(paid)} taken · bill kept open`); go(REG); }}>Keep bill open · {idr(remaining)} left</button>}
  </div>;
}

function CustomerNeeded({ what }: { what: string }) {
  const { go } = usePos();
  return <Empty icon="user-plus" title="Attach the customer first" action={<button className="btn btn-primary" onClick={() => go(P('customer-lookup-and-points'))}>Find customer</button>}>{what} belongs to a member account.</Empty>;
}
function DepositPanel({ o, remaining }: PanelProps) {
  const { db } = usePos();
  const charge = useCharge(o);
  const c = db.customers.find(x => x.id === o.customerId);
  if (!c) return <CustomerNeeded what="A deposit or gift card balance" />;
  const amt = Math.min(c.deposit, remaining);
  return <div className="stack"><h3>Deposit / gift card</h3>
    <div className="sunken row between"><span>{c.name}</span><b className="num">{idr(c.deposit)}</b></div>
    {c.deposit < remaining && c.deposit > 0 && <p className="muted">Balance covers {idr(c.deposit)}. Pay the remaining {idr(remaining - c.deposit)} with another method.</p>}
    <button className="btn btn-primary btn-pay" disabled={!amt} onClick={() => charge('deposit', amt)}>{amt ? `Pay ${idr(amt)} from deposit` : 'No balance'}</button></div>;
}
function KasbonPanel({ o, remaining }: PanelProps) {
  const { db, setting } = usePos();
  const charge = useCharge(o);
  const c = db.customers.find(x => x.id === o.customerId);
  if (!c) return <CustomerNeeded what="Kasbon (customer credit)" />;
  const limit = setting('kasbonLimit', 500000), over = c.credit + remaining > limit;
  return <div className="stack"><h3>Kasbon</h3>
    <div className="sunken stack sm"><div className="row between"><span>{c.name} owes</span><b className="num">{idr(c.credit)}</b></div><div className="row between"><span>Limit</span><b className="num">{idr(limit)}</b></div></div>
    {over && <div className="banner b-danger"><Icon name="ban" />Over the kasbon limit. Ask the manager to raise it in Register settings, or take another method.</div>}
    <button className="btn btn-primary btn-pay" disabled={over} onClick={() => charge('kasbon', remaining)}>Put {idr(remaining)} on kasbon</button></div>;
}
function ManualPanel({ o, remaining }: PanelProps) {
  const { db, me } = usePos();
  const flow = useApproval(); const charge = useCharge(o);
  const [ref, setRef] = useState('');
  const pend = db.payments.filter(p => p.orderId === o.id && p.status === 'pending');
  if (flow.node) return flow.node;
  return <div className="stack"><h3>Manual payment confirmation</h3>
    <p className="muted" style={{ fontSize: 14 }}>When the guest shows a transfer proof but the bank hasn’t confirmed. Needs the PIC’s PIN; it’s matched against the bank statement later.</p>
    {pend.length === 0 ? <><p>No payment is waiting on this bill.</p><button className="btn btn-pos" disabled={!db.device.online} onClick={() => charge('va', remaining)}>Create a bank transfer (VA) for {idr(remaining)}</button></> : <>
      <Field label="Proof reference (bank, time, last 4 digits)"><input className="input" value={ref} onChange={e => setRef(e.target.value)} placeholder="BCA 14:32 · ****7890" /></Field>
      {pend.map(p => <div key={p.id} className="row card tight"><span className="grow">{NAME[p.method]} · <span className="mono">{p.ref}</span></span><b className="num">{idr(p.amount)}</b>
        <button className="btn btn-primary" disabled={!ref.trim()} onClick={() => flow.run({ action: 'Take orders & charge', type: 'manual_payment', amount: p.amount, subjectId: null, note: ref, payload: { pos: 'manual_payment', paymentId: p.id }, title: `Manual confirm ${NAME[p.method]} ${idr(p.amount)} · ${o.no}`, direct: () => gatewayWebhook(p.id, 'settled') })}>Confirm</button></div>)}
    </>}
    {pend.length > 0 && <span className="faint" style={{ fontSize: 13 }}>Requested by {me.name}. Nobody confirms their own request.</span>}
  </div>;
}
function PendingPanel({ o }: PanelProps) {
  const { db, outletId, me, go, setCur } = usePos();
  const now = useNow(1000);
  const all = db.payments.filter(p => p.outletId === outletId && p.status === 'pending');
  const row = (p: Payment) => { const ord = db.orders.find(x => x.id === p.orderId);
    return <div key={p.id} className="row card tight wrap"><span className="grow stack" style={{ gap: 0 }}><b>{NAME[p.method]} · {ord?.no}</b><span className="muted" style={{ fontSize: 13 }}>{p.expiresAt ? `expires in ${Math.max(0, Math.ceil((p.expiresAt - now) / 1000))}s` : 'started ' + ago(p.at, now)}</span></span>
      <b className="num">{idr(p.amount)}</b>
      {p.orderId === o.id ? <button className="btn btn-sm" onClick={() => go(P(SLUG_OF[p.method]))}>Open</button> : <button className="btn btn-sm" onClick={() => { if (ord) setCur(ord.id); go(P(SLUG_OF[p.method])); }}>Switch to bill</button>}
      <button className="btn btn-sm" onClick={() => cancelPayment(p.id, me.id)}>Cancel</button></div>; };
  return <div className="stack"><h3>Payment pending</h3>
    {all.length === 0 ? <Empty icon="hourglass" title="Nothing waiting">QRIS, VA and e-wallet payments waiting for the bank show here.</Empty> : all.map(row)}
    <p className="faint" style={{ fontSize: 13 }}>Pending payments settle only when the bank calls back. If the guest shows proof, use Manual confirm.</p></div>;
}
function FailedPanel({ o }: PanelProps) {
  const { db, q, go } = usePos();
  const last = db.payments.filter(p => p.orderId === o.id && (p.status === 'failed' || p.status === 'expired')).at(-1);
  const m = (q.get('m') ?? last?.method ?? 'card') as Method;
  const expired = last?.status === 'expired' || (m === 'qris' && !q.get('m'));
  const [t, s] = m === 'qris' ? (expired ? ['QRIS expired', 'The code expired before it was paid. Show a new one or pick another method.'] : ['QRIS cancelled', 'The QR was cancelled before payment.'])
    : m === 'card' ? ['Payment declined', 'The issuer declined the card (code 51). Ask for another card or method.'] : [`${NAME[m]} failed`, 'The bank reported a failure. Nothing was charged. Try again or pick another method.'];
  return <div className="stack" style={{ alignItems: 'center', textAlign: 'center', padding: '24px 0' }}>
    <span style={{ width: 72, height: 72, borderRadius: 99, background: 'var(--danger-soft)', color: 'var(--danger-fg)', display: 'grid', placeItems: 'center' }}><Icon name="x" size={36} /></span>
    <h2>{t}</h2><p className="muted" style={{ maxWidth: 420 }}>{s}</p>
    <div className="row"><button className="btn btn-pos" onClick={() => go(P(SLUG_OF[m] ?? 'payment-method-picker'))}>Try again</button><button className="btn btn-primary btn-pos" onClick={() => go(P('payment-method-picker'))}>Try another method</button></div>
  </div>;
}
function TipsPanel({ tip, setTip }: PanelProps) {
  const { go } = usePos();
  return <div className="stack"><h3>Tips</h3><p className="muted" style={{ fontSize: 14 }}>Tips are kept apart from sales and paid out with the shift. The guest can also choose on the customer display.</p>
    <AmountPad value={tip} onChange={setTip} title="Tip" /><button className="btn btn-primary btn-pos" onClick={() => go(P('payment-method-picker'))}>Continue to payment</button></div>;
}

const PANELS: Record<string, (p: PanelProps) => ReactNode> = {
  cash: CashPanel, rounding: CashPanel, qris: p => <GatewayPanel {...p} m="qris" />, ewallet: p => <GatewayPanel {...p} m="ewallet" />, va: p => <GatewayPanel {...p} m="va" />,
  card: CardPanel, split: SplitPanel, multi: SplitPanel, partial: PartialPanel, deposit: DepositPanel, kasbon: KasbonPanel, manual: ManualPanel, pending: PendingPanel, failed: FailedPanel, tips: TipsPanel,
};

function Success() {
  const { db, me, outletId, go, setting } = usePos();
  const last = uiGet<{ id?: string; change?: number; method?: string }>('lastPaid', {});
  const o = db.orders.find(x => x.id === last.id) ?? db.orders.filter(x => x.outletId === outletId && x.cashierId === me.id && x.status === 'paid').sort((a, b) => (b.paidAt ?? 0) - (a.paidAt ?? 0))[0];
  const c = db.customers.find(x => x.id === o?.customerId);
  const [r, setR] = useState<string>(setting('receipt', 'print'));
  const [to, setTo] = useState(r === 'email' ? c?.email ?? '' : c?.phone ?? '');
  const finish = () => {
    if (o && r === 'print') logDevice('print.receipt', o.no, me.id, o.outletId);
    if (o && (r === 'wa' || r === 'email') && to.trim()) sendReceipt(o.id, r, to.trim(), me.id);
    go(REG);
  };
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Enter' && (e.target as HTMLElement).tagName !== 'INPUT') finish(); }; addEventListener('keydown', k); return () => removeEventListener('keydown', k); });
  if (!o) return <div style={{ padding: 24 }}><Empty icon="receipt" title="No sale yet this shift" action={<button className="btn btn-primary" onClick={() => go(REG)}>Back to the register</button>} /></div>;
  const methods = [...new Set(db.payments.filter(p => p.orderId === o.id && p.status === 'settled' && p.ref !== 'ROUNDING').map(p => NAME[p.method]))].join(' + ');
  const pts = db.ledger.filter(l => l.orderId === o.id && l.points > 0).reduce((a, l) => a + l.points, 0);
  return <div className="stack lg" style={{ padding: 28, alignItems: 'center', textAlign: 'center', maxWidth: 560, margin: '0 auto' }}>
    <span style={{ width: 84, height: 84, borderRadius: 99, background: 'var(--success)', color: 'var(--ink-0)', display: 'grid', placeItems: 'center', animation: 'pop var(--dur-celebrate) var(--ease-spring)' }}><Icon name="check" size={44} /></span>
    <div className="stack sm"><h1>Payment received</h1><span className="muted">{idr(o.total)} · {methods || last.method} · Order {o.no}</span></div>
    {!!last.change && last.id === o.id && <div className="sunken" style={{ alignSelf: 'stretch' }}><span className="muted">Change</span><br /><b className="num" style={{ fontSize: 40, color: 'var(--success-fg)' }}>{idr(last.change)}</b></div>}
    {c && <Badge tone="accent">{c.name} earned {pts} beans</Badge>}
    <div className="stack sm" style={{ alignSelf: 'stretch' }}>
      <span className="cap">Receipt</span>
      <div className="seg" style={{ alignSelf: 'center' }}>{([['print', 'Print'], ['wa', 'WhatsApp'], ['email', 'Email'], ['none', 'No receipt']] as const).map(([k, l]) =>
        <button key={k} aria-pressed={r === k} onClick={() => { setR(k); setTo(k === 'email' ? c?.email ?? '' : c?.phone ?? ''); }} style={{ height: 44 }}>{l}</button>)}</div>
      {(r === 'wa' || r === 'email') && <input className="input" value={to} onChange={e => setTo(e.target.value)} placeholder={r === 'wa' ? 'WhatsApp number' : 'Email'} aria-label="Send receipt to" />}
    </div>
    <button className="btn btn-primary btn-pay btn-block" onClick={finish}>New sale</button>
  </div>;
}
