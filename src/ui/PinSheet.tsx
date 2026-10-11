'use client';
// Approval PIN (spec/bn-pin.js): every approve / reject / sign asks the approver's own 6-digit approval PIN —
// not the login password, no remember-me, 5 wrong tries lock it 15 min and alert manager + owner. Built once; never build another confirm.
import { useEffect, useState } from 'react';
import { Sheet, Numpad, Avatar } from './kit.tsx';
import { verifyPin } from '../data/actions.ts';
import { PIN_LEN } from '../domain/approval.ts';
import { useApp } from '../app/context.tsx';

export interface PinRequest { title: string; detail?: string; verb?: string; onOk: (approverId: string) => void }

export function PinSheet({ req, onClose }: { req: PinRequest | null; onClose: () => void }) {
  const { me, user } = useApp();
  const [pin, setPin] = useState(''), [err, setErr] = useState(''), [shake, setShake] = useState(false);
  useEffect(() => { setPin(''); setErr(''); }, [req]);
  if (!req) return null;
  const who = me?.id ?? user.id;
  const key = (k: string) => {
    if (k === 'del') return setPin(p => p.slice(0, -1));
    if (!/^\d$/.test(k)) return;
    const p = (pin + k).slice(0, PIN_LEN); setPin(p); setErr('');
    if (p.length === PIN_LEN) {
      const e = verifyPin(who, p);
      if (e) { setErr(e); setShake(true); setTimeout(() => { setShake(false); setPin(''); }, 320); }
      else { onClose(); req.onOk(who); }
    }
  };
  return <Sheet open onClose={onClose} side="center" title={req.verb ?? 'Confirm with your approval PIN'} sub={req.title}>
    <div className="stack lg" style={{ alignItems: 'center' }} onKeyDown={e => key(e.key === 'Backspace' ? 'del' : e.key)} tabIndex={0}>
      <div className="row"><Avatar name={me?.name ?? 'Admin'} color={me?.color} /><span><b>{me?.name ?? 'BorNiz admin'}</b> · {user.role}</span></div>
      {req.detail && <p className="muted" style={{ textAlign: 'center' }}>{req.detail}</p>}
      <div className={'pin-dots' + (shake ? ' shake' : '')} aria-label={`${pin.length} of ${PIN_LEN} digits`}>{Array.from({ length: PIN_LEN }, (_, i) => <i key={i} className={i < pin.length ? 'on' : ''} />)}</div>
      {err && <p className="err" role="alert" style={{ color: 'var(--danger-fg)' }}>{err}</p>}
      <div style={{ width: 'min(320px,100%)' }}><Numpad onKey={key} extra="" /></div>
      <p className="faint" style={{ fontSize: 12 }}>Approval PIN, not your password. Demo PIN 246810.</p>
    </div>
  </Sheet>;
}
/** const pin = usePin(); pin.ask({ title, onOk }) ; render {pin.sheet} */
export function usePin() {
  const [req, setReq] = useState<PinRequest | null>(null);
  return { ask: setReq, sheet: <PinSheet req={req} onClose={() => setReq(null)} /> };
}
