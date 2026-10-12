'use client';
// The guest's order-status page while waiting and at the ready moment, as published in Studios › Customer screens
// (Waiting screen, Order ready & enjoy) and Marketing › Push notifications.
import { useEffect, useRef, useState } from 'react';
import type { Order } from '../../data/schema.ts';
import { menuDesign } from '../../data/actions/studio.ts';
import { balance } from '../../domain/loyalty.ts';
import { usable } from '../../domain/promo.ts';
import { studioValue } from '../../system/studio.ts';
import { animLevel, fillTool, toolValue } from '../../system/tools.ts';
import { Icon, toast } from '../../ui/kit.tsx';
import { playSfx } from '../../ui/sound.ts';
import { firstName, MUTED, SURFACE, TINT } from '../guest/kit.tsx';
import { so, type G } from './shared.tsx';

const card = { padding: 14, borderRadius: 18, background: SURFACE, display: 'flex', gap: 10, alignItems: 'center', fontSize: 14 } as const;
const PCT = [20, 60, 88];
const etaMin = (o: Order) => Math.max(1, o.lines.filter(l => l.fired && l.kds !== 'done').reduce((a, l) => a + l.qty * (l.station === 'kitchen' ? 4 : 2), 0));
const nameOf = (g: G, o: Order) => firstName(g.db.customers.find(c => c.id === o.customerId)?.name) || 'kamu';

/** Greeting, progress style, estimate and the placements the owner chose, while the kitchen works. */
export function WaitPanel({ g, o, step }: { g: G; o: Order; step: number }) {
  const { db } = g, v = toolValue(db, 'wait'), c = db.customers.find(x => x.id === o.customerId);
  const pct = PCT[Math.min(2, step)];
  const upsell = v.p_upsell ? db.products.find(p => p.categoryId === 'pastry' && p.status === 'live' && !o.lines.some(l => l.productId === p.id) && db.outletProducts.some(op => op.productId === p.id && op.outletId === o.outletId && !op.is86 && !op.hidden)) : undefined;
  const promo = v.p_promo ? db.promos.find(p => p.code && usable(p)) : undefined;
  const wifi = menuDesign(db).rc.wifi, ig = studioValue(db, 'multi-page-online-store-link-in-bio').handle;
  const cards: [string, string, (() => void)?][] = [
    ...(upsell ? [['croissant', `Add ${upsell.name}? Ready with your order.`, () => g.go(so('item-detail-and-options', { p: upsell.id }))] as [string, string, () => void]] : []),
    ...(v.p_loyal && c ? [['award', `${balance(db.ledger, c.id).toLocaleString('en-US')} beans · +${Math.floor((o.subtotal - o.discount) / 1000)} with this order`] as [string, string]] : []),
    ...(v.p_wifi && wifi ? [['wifi', `Wi-Fi ${wifi}`] as [string, string]] : []),
    ...(v.p_music ? [['music', 'Now playing in store'] as [string, string]] : []),
    ...(v.p_story ? [['book-open', 'Behind the bar: where our palm sugar comes from'] as [string, string]] : []),
    ...(promo ? [['ticket-percent', `${promo.name} next visit · code ${promo.code}`, () => g.go(so('claim-voucher'))] as [string, string, () => void]] : []),
    ...(v.p_game ? [['gamepad-2', 'Mini game: catch the beans'] as [string, string]] : []),
    ...(v.p_ig && ig ? [['camera', `Follow us on Instagram ${ig}`] as [string, string]] : []),
    ...(v.p_ad && v.adby ? [['megaphone', `Sponsored · ${v.adby}`] as [string, string]] : []),
  ];
  return <div className="stack" style={{ gap: 10 }}>
    <b style={{ fontFamily: 'var(--bn-font)', fontSize: 20 }}>{fillTool(v.greet, { name: firstName(c?.name) || 'kamu' })}</b>
    {v.prog === 'bar' && <div role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} style={{ height: 10, borderRadius: 5, background: 'color-mix(in srgb,var(--bn-ink) 12%,transparent)' }}><div style={{ width: pct + '%', height: '100%', borderRadius: 5, background: 'var(--bn-p)', transition: 'width var(--dur-slow)' }} /></div>}
    {v.prog === 'ring' && <div role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} style={{ alignSelf: 'center', width: 110, height: 110, borderRadius: 99, background: `conic-gradient(var(--bn-p) 0 ${pct}%,color-mix(in srgb,var(--bn-ink) 12%,transparent) 0)`, display: 'grid', placeItems: 'center' }}><span style={{ width: 84, height: 84, borderRadius: 99, background: 'var(--bn-paper)', display: 'grid', placeItems: 'center', fontWeight: 800 }}>{pct}%</span></div>}
    {v.eta && <span style={{ fontSize: 14, color: MUTED }}>About {step >= 2 ? 1 : etaMin(o)} min · {o.lines.filter(l => l.fired).reduce((a, l) => a + l.qty, 0)} items</span>}
    {cards.map(([ic, text, go]) => go
      ? <button key={ic} onClick={go} style={{ ...card, border: 0, color: 'var(--bn-ink)', cursor: 'pointer', textAlign: 'left' }}><Icon name={ic} className="bn-ico" style={{ color: 'var(--bn-icon)' }} /><span style={{ flex: 1 }}>{text}</span><Icon name="chevron-right" size={18} /></button>
      : <div key={ic} style={card}><Icon name={ic} className="bn-ico" style={{ color: 'var(--bn-icon)' }} /><span>{text}</span></div>)}
  </div>;
}

/** The ready moment on the phone: headline, where to collect, the main action and (motion allowing) confetti. */
export function ReadyCard({ g, o }: { g: G; o: Order }) {
  const { db } = g, v = toolValue(db, 'ready');
  const [reduced, setReduced] = useState(false);
  useEffect(() => { setReduced(matchMedia('(prefers-reduced-motion: reduce)').matches); }, []);
  if (!v.c_page) return null;
  const fill = (s: string) => fillTool(s, { name: nameOf(g, o), order: o.no });
  const where = v.where === 'table' ? `On its way to ${o.table ?? 'your table'}` : v.where === 'delivery' ? 'Delivered to your door' : 'Show this at the counter';
  const share = async () => { const url = location.origin + so('menu-home'); try { if (navigator.share) await navigator.share({ title: db.tenant.name, url }); else { await navigator.clipboard.writeText(url); toast('Link copied'); } } catch { /* cancelled */ } };
  const cta = v.cta === 'reorder' ? ['rotate-ccw', 'Order again', () => g.go(so('menu-home'))] as const : v.cta === 'share' ? ['share-2', 'Share with a friend', share] as const : ['star', 'Rate your visit', () => g.go(so('feedback-and-rating', { o: o.id }))] as const;
  const confetti = v.confetti && animLevel(db, reduced) !== 'none';
  return <div style={{ ...card, flexDirection: 'column', textAlign: 'center', position: 'relative', overflow: 'hidden' }}>
    {confetti && <span aria-hidden className="bn-confetti">{Array.from({ length: 14 }, (_, i) => <i key={i} style={{ left: `${(i * 7.3) % 100}%`, background: i % 2 ? 'var(--bn-p)' : 'var(--bn-acc)', animationDelay: `${(i % 5) * 60}ms` }} />)}</span>}
    <span style={{ width: 64, height: 64, borderRadius: 99, background: 'var(--bn-p)', color: 'var(--ink-0)', display: 'grid', placeItems: 'center' }}><Icon name="party-popper" size={30} /></span>
    <b style={{ fontFamily: 'var(--bn-font)', fontSize: 20 }}>{fill(v.head)}</b>
    <span style={{ color: MUTED }}>{fill(v.sub)}</span>
    <span style={{ padding: '6px 12px', borderRadius: 99, background: TINT, fontSize: 13, fontWeight: 600 }}>{where}</span>
    <button className="btn" onClick={cta[2]}><Icon name={cta[0]} />{cta[1]}</button>
    <style>{'.bn-confetti{position:absolute;inset:0;pointer-events:none}.bn-confetti i{position:absolute;top:-10px;width:7px;height:12px;border-radius:2px;animation:bnFall 1.4s var(--ease-out) forwards}@keyframes bnFall{to{transform:translateY(260px) rotate(320deg);opacity:0}}'}</style>
  </div>;
}

/** Ready alerts on the guest's own phone: sound + vibration and a browser notification with the published push copy. */
export function ReadyWatch({ g, o, ready }: { g: G; o: Order; ready: boolean }) {
  const { db } = g, v = toolValue(db, 'ready');
  const was = useRef(ready);
  const [perm, setPerm] = useState<NotificationPermission | 'none'>('none');
  useEffect(() => { setPerm(typeof Notification === 'undefined' ? 'none' : Notification.permission); }, []);
  useEffect(() => {
    if (ready && !was.current) {
      if (v.c_vibe) { playSfx(db, 'sfx-order-in'); try { navigator.vibrate?.([200, 100, 200]); } catch { /* not supported */ } }
      if (v.c_push && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        const p = toolValue(db, 'push'), fill = (s: string) => fillTool(s, { name: nameOf(g, o), order: o.no });
        const path = so(({ promo: 'claim-voucher', menu: 'menu-home', points: 'member-card-and-points' } as Record<string, string>)[p.link] ?? 'order-status');
        try { const n = new Notification(fill(p.title), { body: fill(p.body), tag: 'ready-' + o.id, icon: document.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]')?.href }); n.onclick = () => { window.focus(); g.go(path); n.close(); }; } catch { /* needs a service worker on this browser */ }
      }
    }
    was.current = ready;
  }, [ready]); // eslint-disable-line react-hooks/exhaustive-deps
  if (ready || !v.c_push || perm !== 'default') return null;
  return <button className="btn btn-block" style={{ height: 52, borderRadius: 16 }} onClick={() => Notification.requestPermission().then(setPerm)}><Icon name="bell-ring" />Notify me when it’s ready</button>;
}
