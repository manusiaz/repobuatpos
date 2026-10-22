'use client';
import { linkTo } from '../system/hosts.ts';
// TEMPLATE template: editable message or print layout with a live preview from real data ({{name}} {{outlet}} {{total}}).
// DEVICE template: full-screen customer/kitchen-facing screen on a fixed 16:9 canvas that never scrolls.
import { useState } from 'react';
import { useApp } from '../app/context.tsx';
import { Badge, Field, Icon, Seg, toast, hhmm } from '../ui/kit.tsx';
import { setSetting } from '../data/actions.ts';
import { idr } from '../domain/money.ts';
import { PageHead } from './common.tsx';

const DEFAULTS: [RegExp, string][] = [
  [/thank you|thank-you/i, 'Hi {{name}}, terima kasih sudah mampir ke {{brand}} {{outlet}}! Kamu dapat {{beans}} beans hari ini. Sampai ketemu lagi.'],
  [/rate/i, 'Hi {{name}}, gimana kunjunganmu di {{outlet}}? Kasih rating 1–5 di sini: {{rating_link}}'],
  [/e-receipt|email/i, 'Struk {{order}} · {{outlet}}\nTotal {{total}}\nDibayar dengan {{method}}\nLihat detail: {{receipt_link}}'],
  [/reservation/i, 'Hi {{name}}, reminder reservasi kamu di {{outlet}} hari ini jam {{time}} untuk {{guests}} orang. Balas BATAL untuk membatalkan.'],
  [/ready|pickup/i, 'Pesanan {{order}} sudah siap diambil di {{outlet}}. Selamat menikmati!'],
];

export function MessageTemplate() {
  const { page, db, user } = useApp();
  const print = /(receipt|ticket|print)/i.test(page.name);
  const k = page.path + ':body';
  const def = DEFAULTS.find(([re]) => re.test(page.name))?.[1] ?? DEFAULTS[0][1];
  const [body, setBody] = useState(String(db.settings[k] ?? def));
  const o = [...db.orders].reverse().find(x => x.status === 'paid' && x.customerId) ?? db.orders[db.orders.length - 1];
  const c = db.customers.find(x => x.id === o?.customerId), out = db.outlets.find(x => x.id === o?.outletId);
  const pay = db.payments.find(p => p.orderId === o?.id);
  const vars: Record<string, string> = { name: c?.name.split(' ')[0] ?? 'Dewi', brand: db.tenant.name, outlet: out?.name ?? 'Senayan', total: idr(o?.total ?? 0), order: o?.no ?? '#2049', method: (pay?.method ?? 'qris').toUpperCase(), beans: String(Math.floor((o?.subtotal ?? 0) / 1000)), rating_link: linkTo('/order/customer-links/feedback-and-rating?o=' + (o?.id ?? '')), receipt_link: linkTo('/order/customer-links/digital-receipt?o=' + (o?.id ?? '')), time: '19:00', guests: '6' };
  const filled = body.replace(/\{\{(\w+)\}\}/g, (_, v: string) => vars[v] ?? '{{' + v + '}}');
  const width = /58mm/i.test(page.name) ? 220 : 300;
  return <>
    <PageHead actions={<><button className="btn" onClick={() => toast(print ? 'Test print sent to Epson TM-m30' : 'Test sent to your WhatsApp')}><Icon name={print ? 'printer' : 'send'} size={18} />{print ? 'Print test' : 'Send test'}</button>
      <button className="btn btn-primary" onClick={() => { setSetting(k, body, user.id); toast(print ? 'Saved · used on every register' : user.role === 'owner' ? 'Submitted to Meta for review' : 'Draft sent to owner'); }}>{print ? 'Save' : 'Submit for approval'}</button></>} />
    <div className="row" style={{ alignItems: 'flex-start', gap: 20, flexWrap: 'wrap' }}>
      <section className="stack" style={{ flex: '1 1 320px' }}>
        <span className="cap">Preview · real order {o?.no}</span>
        {print ? <div style={{ width, margin: '0 auto', background: '#fff', color: '#141210', padding: 16, fontFamily: 'var(--font-mono)', fontSize: 12, boxShadow: 'var(--shadow-e2)', whiteSpace: 'pre-wrap' }}>
          <div style={{ textAlign: 'center', fontWeight: 700 }}>{db.tenant.name.toUpperCase()}<br />{out?.name} · {out?.city}</div>{'\n'}{o?.lines.map(l => `${l.qty} ${l.name}`.padEnd(width > 250 ? 28 : 20).slice(0, width > 250 ? 28 : 20) + ' ' + idr(l.unitPrice * l.qty).replace('IDR ', '')).join('\n')}
          {'\n'}{'—'.repeat(width > 250 ? 20 : 14)}{'\n'}TOTAL {idr(o?.total ?? 0)}{'\n\n'}{filled}</div>
          : <div style={{ maxWidth: 360, background: 'var(--success-soft)', borderRadius: 16, padding: 14, whiteSpace: 'pre-wrap' }}>{filled}<div className="faint" style={{ fontSize: 11, textAlign: 'right' }}>{hhmm(Date.now())} ✓✓</div></div>}
      </section>
      <section className="card stack" style={{ flex: '1 1 320px' }}>
        <div className="row"><Badge tone={print ? 'neutral' : 'warning'}>{print ? 'Print layout' : 'Meta review: draft'}</Badge></div>
        <Field label="Message"><textarea className="input" style={{ minHeight: 180 }} value={body} onChange={e => setBody(e.target.value)} /></Field>
        <div className="row wrap">{Object.keys(vars).map(v => <button key={v} className="chip" onClick={() => setBody(body + ' {{' + v + '}}')}>{'{{' + v + '}}'}</button>)}</div>
        {!print && <p className="faint" style={{ fontSize: 12 }}>Marketing messages only go to guests who opted in, never 21:00–08:00. Receipts and order-ready ignore quiet hours.</p>}
      </section>
    </div>
  </>;
}

export function DeviceScreen() {
  const { db, outletId, page } = useApp();
  const [orient, setOrient] = useState<'16:9' | '9:16'>('16:9');
  const live = db.orders.filter(o => o.outletId === outletId && Date.now() - o.createdAt < 3 * 3600e3);
  const ready = live.filter(o => o.status === 'ready'), prep = live.filter(o => ['sent', 'preparing'].includes(o.status));
  return <>
    <PageHead actions={<><Seg value={orient} onChange={setOrient} options={['16:9', '9:16'] as const} /><button className="btn btn-primary" onClick={() => toast('Open this URL on the TV: ' + linkTo(page.path))}><Icon name="tv" size={18} />Open on TV</button></>} />
    <div data-theme="dark" style={{ containerType: 'inline-size', aspectRatio: orient === '16:9' ? '16/9' : '9/16', maxHeight: '70vh', margin: '0 auto', width: orient === '16:9' ? '100%' : 'auto', background: db.theme.ink, color: 'var(--ink-0)', borderRadius: 20, overflow: 'hidden', display: 'grid', gridTemplateColumns: orient === '16:9' ? '1fr 1fr' : '1fr', padding: '3cqw', gap: '3cqw' }}>
      {[['Preparing', prep, 'rgba(255,255,255,.7)'], ['Ready · please pick up', ready, db.theme.acc]].map(([t, l, col]) => <div key={t as string} style={{ display: 'flex', flexDirection: 'column', gap: '2cqw' }}>
        <div style={{ font: `700 4cqw/1 ${'var(--bn-font)'}`, color: col as string }}>{t as string}</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.5cqw' }}>{(l as typeof live).slice(0, 12).map(o => <span key={o.id} style={{ font: '700 6cqw/1 var(--font-display)', padding: '1cqw 2cqw', borderRadius: '1.5cqw', background: 'rgba(255,255,255,.08)' }}>{o.no.replace('#', '')}</span>)}{(l as typeof live).length === 0 && <span style={{ fontSize: '2.4cqw', opacity: .6 }}>—</span>}</div>
      </div>)}
    </div>
    <p className="faint" style={{ textAlign: 'center' }}>Live from the kitchen display: numbers move to Ready when the kitchen bumps them.</p>
  </>;
}
