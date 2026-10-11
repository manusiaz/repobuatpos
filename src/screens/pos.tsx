'use client';
// Cashier register (spec/BorNiz POS Register.dc.html, patterns from POS Patterns and Shifts). Every /pos page opens
// the register in its state: page slug → view (+ sheet / tab), see ROUTES in ./pos/shared.tsx.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { DeviceChrome } from '../app/chrome.tsx';
import { useApp } from '../app/context.tsx';
import { newOrder, setSetting } from '../data/actions.ts';
import { applyPosApproval, flushQueue, type PosPayload } from '../data/actions/pos.ts';
import { Empty, Icon, toast } from '../ui/kit.tsx';
import { ONLINE_INBOX, OPEN_STATUSES, P, PosCtx, ROUTES, SETTINGS_PATH, uiGet, uiSet, type Pos } from './pos/shared.tsx';
import { Register } from './pos/Register.tsx';
import { OrderSheet } from './pos/OrderSheets.tsx';
import { PaySheet } from './pos/Pay.tsx';
import { OpenShift, PinGate } from './pos/Gate.tsx';
import { ShiftChange, ShiftView } from './pos/Shift.tsx';
import { Bills, History, Tools } from './pos/After.tsx';
import { DeviceView } from './pos/Device.tsx';

const CSS = `
.pos{display:grid;grid-template-columns:88px minmax(0,1fr);height:100dvh;background:var(--bg-canvas);overflow:hidden}
.pos-rail{background:var(--bg-surface);color:var(--fg-1);border-right:1px solid var(--border);display:flex;flex-direction:column;gap:4px;padding:12px 8px;overflow-y:auto}
.pos-rail .logo{width:44px;height:44px;border-radius:12px;background:var(--accent);color:#fff;display:grid;place-items:center;font:700 20px var(--font-display);margin:0 auto 8px}
.pos-rail button{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;min-height:60px;border:0;border-radius:14px;background:transparent;color:var(--fg-2);font:600 13px/1.1 var(--font-body);cursor:pointer;text-align:center;padding:6px 2px;transition:transform var(--dur-instant)}
.pos-rail button:active{transform:scale(var(--press-scale))}
.pos-rail button:hover{background:var(--bg-sunken)}.pos-rail button[aria-current=page]{background:var(--accent-soft);color:var(--accent-fg)}
.pos-tabs{display:flex;flex-direction:column;gap:4px;flex:1;min-height:0;overflow-y:auto}.pos-tabs .pos-lock{margin-top:auto}
.pos-rail .dev-chrome{flex-direction:column;padding-top:8px;border-top:1px solid var(--border)}.pos-rail .dev-chrome .btn{color:var(--fg-2)}
.pos-rail .n{position:absolute;top:4px;right:8px;min-width:20px;height:20px;padding:0 6px;border-radius:99px;background:var(--accent);color:var(--ink-0);font:700 12px/20px var(--font-display)}
.pos-main{min-width:0;height:100dvh;overflow:auto;display:flex;flex-direction:column}
.pos-reg{display:grid;grid-template-columns:minmax(0,1fr) clamp(340px,30vw,380px);flex:1;min-height:0}
.pos-menu{display:flex;flex-direction:column;gap:12px;padding:16px;overflow-y:auto;min-height:0}
.pos-cart{border-left:1px solid var(--border);background:var(--bg-surface);min-height:0;overflow:hidden}
.pos-grid{display:grid;gap:10px;grid-template-columns:repeat(auto-fill,minmax(150px,1fr))}
.pos-tile{position:relative;display:flex;flex-direction:column;border:0;padding:0;border-radius:var(--radius-md);background:var(--bg-surface);box-shadow:0 0 0 1px var(--border);overflow:hidden;color:var(--fg-1);transition:transform var(--dur-instant) var(--ease-out)}
.pos-tile:active{transform:scale(var(--press-scale))}
.pos-ph{position:relative;display:block;aspect-ratio:16/10}
.pos-count{position:absolute;top:8px;right:8px;min-width:28px;height:28px;border-radius:99px;background:var(--accent);color:var(--ink-0);display:grid;place-items:center;font-size:14px}
.pos-bar{display:none}
.pos-page{padding:24px var(--margin) 96px;max-width:1280px;width:100%}
.pos-gate{min-height:100dvh;display:flex;flex-wrap:wrap;gap:40px;align-items:center;justify-content:space-around;padding:32px var(--margin);background:var(--bg-canvas);color:var(--fg-1)}
.pos-pay{display:grid;grid-template-columns:minmax(260px,320px) minmax(0,1fr);min-height:min(640px,calc(100dvh - 24px))}
.pos-off{display:flex;align-items:center;gap:8px;padding:8px 16px;background:var(--danger-soft);color:var(--danger-fg);font-size:14px;font-weight:600}
@media (max-width:1023px){.pos{grid-template-columns:72px minmax(0,1fr)}.pos-reg{grid-template-columns:minmax(0,1fr)}.pos-cart{display:none}
 .pos-bar{display:flex;gap:8px;position:fixed;left:72px;right:0;bottom:0;z-index:5;padding:12px 16px calc(12px + env(safe-area-inset-bottom));background:var(--bg-canvas);border-top:1px solid var(--border)}
 .pos-menu{padding-bottom:calc(112px + env(safe-area-inset-bottom))}
 .pos-bar .pos-view{flex:1 1 0;min-width:0}.pos-bar .pos-view>span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.pos-bar .btn-pay{flex:1.4 1 0;min-width:0}}
@media (max-width:767px){.pos{grid-template-columns:minmax(0,1fr);grid-template-rows:auto minmax(0,1fr)}.pos-rail{flex-direction:row;overflow-x:auto;padding:6px 8px;border-right:0;border-bottom:1px solid var(--border)}
 .pos-rail .logo{display:none}.pos-rail{align-items:center}.pos-tabs{flex-direction:row;overflow-x:auto;overflow-y:hidden}.pos-tabs .pos-lock{margin-top:0}
 .pos-rail .dev-chrome{flex-direction:row;padding:0 0 0 6px;border-top:0;border-left:1px solid var(--border)}
 .pos-rail button{min-width:72px;min-height:56px;flex:none}.pos-rail .dev-chrome .btn{min-width:44px}.pos-main{height:auto;min-height:0}
 .pos-pay{grid-template-columns:minmax(0,1fr)}.pos-bar{left:0}.pos-bar .btn-pay{min-width:0!important}}
`;

const RAIL: [string, string, string, string][] = [['register', 'Register', 'shopping-bag', 'register-order'], ['bills', 'Open bills', 'clipboard-list', 'open-bills-saved-orders'],
  ['history', 'History', 'receipt', 'shift-transaction-history'], ['online', 'Online', 'bell', ''], ['shift', 'Shift', 'clock', 'shift-summary-before-close'],
  ['tools', 'Tools', 'search-check', 'price-check'], ['device', 'Device', 'monitor-smartphone', 'printer-and-drawer-connection']];

export default function Screen() {
  const { page, db, user, me, outletId, go } = useApp();
  const q = useSearchParams();
  const route = ROUTES[page.slug] ?? { v: 'register' };
  const [curId, setCurId] = useState<string | null>(() => uiGet('cur:' + outletId, null));
  const session = me && db.sessions.find(s => s.outletId === outletId && s.cashierId === me.id && s.status === 'open');
  const cur = db.orders.find(o => o.id === curId && o.outletId === outletId && OPEN_STATUSES.includes(o.status));

  const setCur = useCallback((id: string | null) => {
    setCurId(id); uiSet('cur:' + outletId, id ?? undefined);
    // the customer display mirrors this order
    if (me) setSetting('pos:current:' + outletId, id ?? '', me.id);
  }, [outletId, me]);
  const setting = useCallback(((id: string, fallback: string | number | boolean) => db.settings[SETTINGS_PATH + ':' + id] ?? fallback) as Pos['setting'], [db.settings]);
  const ensureOrder = useCallback(() => {
    if (cur) return cur.id;
    const id = newOrder(outletId, me!.id, 'pos', { type: setting('defaultType', 'dine') as 'dine', sessionId: session?.id ?? null });
    setCur(id); return id;
  }, [cur, outletId, me, setting, session, setCur]);

  // Approved line-level requests are applied by the register that asked for them, even when the PIC approves on their own device.
  useEffect(() => {
    if (!me) return;
    db.approvals.filter(a => a.requestedBy === me.id && a.status === 'approved' && (a.payload as PosPayload | undefined)?.pos && !(a.payload as PosPayload).applied).forEach(a => applyPosApproval(a, me.id));
  }, [db.approvals, me]);
  // Back online: drain the offline queue.
  useEffect(() => {
    if (!db.device.online || !db.device.queue.length || !me) return;
    const t = setTimeout(() => { const n = flushQueue(me.id); if (n) toast(`Back online · synced ${n} actions`); }, 1200);
    return () => clearTimeout(t);
  }, [db.device.online, db.device.queue.length, me]);

  const ctx = useMemo<Pos | null>(() => me ? { db, me, user, outletId, go, route, slug: page.slug, q, session, cur, setCur, ensureOrder, setting } : null,
    [db, me, user, outletId, go, route, page.slug, q, session, cur, setCur, ensureOrder, setting]);
  if (!ctx) return <Empty icon="lock" title="Sign in with a staff PIN">The register needs a cashier, PIC or manager. Use Switch user.</Empty>;

  const body = (() => {
    if (route.v === 'lock') return <PinGate />;
    if (route.v === 'change' && route.t === '4') return session ? <PinGate next /> : <OpenShift />;
    if (route.v === 'open') return <OpenShift />;
    if ((route.v === 'register' || route.v === 'bills') && !session) return <OpenShift closedNotice />;
    return null;
  })();
  const incoming = db.orders.filter(o => o.outletId === outletId && o.source !== 'pos' && o.status === 'open' && !o.cashierId).length;
  const held = db.orders.filter(o => o.outletId === outletId && o.status === 'held').length;
  const view = route.v === 'register' ? <Register /> : route.v === 'bills' ? <Bills /> : route.v === 'history' ? <History /> : route.v === 'shift' ? <ShiftView />
    : route.v === 'change' ? <ShiftChange /> : route.v === 'tools' ? <Tools /> : <DeviceView />;

  return <PosCtx.Provider value={ctx}>
    <style>{CSS}</style>
    {body ?? <div className="pos">
      <nav className="pos-rail" aria-label="Register">
        <span className="logo" aria-hidden>B</span>
        <div className="pos-tabs no-sb">
          {RAIL.map(([k, l, ic, slug]) => <button key={k} aria-current={route.v === k || (k === 'shift' && route.v === 'change') ? 'page' : undefined} onClick={() => go(slug ? P(slug) : ONLINE_INBOX)}>
            <Icon name={ic} size={24} />{l}{(k === 'bills' ? held : k === 'online' ? incoming : 0) > 0 && <span className="n">{k === 'bills' ? held : incoming}</span>}</button>)}
          <button className="pos-lock" onClick={() => go(P('lock-screen'))}><Icon name="lock" size={24} />Lock</button>
        </div>
        <DeviceChrome dark />
      </nav>
      <main className="pos-main">
        {!db.device.online && <button className="pos-off" style={{ border: 0, cursor: 'pointer' }} onClick={() => go(P('sync-status-and-retry'))}><Icon name="wifi-off" size={18} />Offline · {db.device.queue.length} queued · QRIS, VA and e-wallet paused. Cash and card keep working.</button>}
        {view}
      </main>
      {route.v === 'register' && route.s === 'pay' && <PaySheet />}
      {route.v === 'register' && route.s && route.s !== 'pay' && <OrderSheet kind={route.s} />}
    </div>}
  </PosCtx.Provider>;
}
