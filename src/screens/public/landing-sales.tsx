'use client';
// Pricing (Free · Basic · Pro · Enterprise, yearly toggle) and contact sales (form → sent state).
import { useState, type FormEvent } from 'react';
import Link from '../../ui/Link.tsx';
import { useApp } from '../../app/context.tsx';
import { saveRecord } from '../../data/actions.ts';
import { uid } from '../../data/store.ts';
import { idr } from '../../domain/money.ts';
import { Field, Icon, Seg } from '../../ui/kit.tsx';
import { FEATURE_PLAN, PLANS, includes, perMonth } from './plans.ts';
import { Cards, PageHead, Wrap, usePlans } from './landing-ui.tsx';

export function Pricing() {
  const [yearly, setYearly] = useState(false), { plans } = usePlans();
  return <Wrap><div className="stack lg">
    <PageHead center kicker="Pricing" title="Simple pricing" sub="Per outlet, billed monthly or yearly (2 months free). Prices exclude PPN.">
      <Seg value={yearly ? 'y' : 'm'} onChange={v => setYearly(v === 'y')} label="Billing" options={[['m', 'Monthly'], ['y', 'Yearly · save 17%']]} />
    </PageHead>
    <div className="grid" style={{ ['--min' as string]: '240px', gap: 12 }}>{plans.map(p => {
      const pop = !!p.popular, price = perMonth(p, yearly);
      return <div key={p.id} className="card stack" data-theme={pop ? 'dark' : undefined} style={{ borderRadius: 24, background: pop ? 'var(--ink-950)' : 'var(--bg-surface)', borderColor: pop ? 'var(--ink-950)' : undefined, color: 'var(--fg-1)' }}>
        <div className="row between"><b style={{ fontSize: 20 }}>{p.name}</b>{pop && <span className="badge" style={{ background: 'var(--ember-500)', color: 'var(--ink-0)' }}>Most popular</span>}</div>
        <b className="num" style={{ fontSize: 34, letterSpacing: '-.03em' }}>{price == null ? 'Custom' : idr(price)}</b>
        <span className="muted" style={{ fontSize: 13 }}>{price == null ? 'For franchises and groups' : price === 0 ? 'Forever' : 'per outlet / month' + (yearly ? ', billed yearly' : '')}</span>
        {p.features.map(f => <span key={f} className="row" style={{ fontSize: 14, alignItems: 'flex-start' }}><Icon name="check" size={18} style={{ color: 'var(--success)', flex: 'none' }} />{f}</span>)}
        <Link href={p.id === 'enterprise' ? '/contact-sales-book-a-demo' : '/account/register'} className="btn btn-lg" style={{ marginTop: 'auto', background: pop ? 'var(--ember-500)' : 'var(--ink-950)', borderColor: 'transparent', color: 'var(--ink-0)' }}>{p.cta}</Link>
      </div>;
    })}</div>
    <div className="stack"><h2>Compare plans</h2>
      <div className="card flat scroll-x"><table className="table" style={{ minWidth: 560 }}><thead><tr><th>Feature</th>{PLANS.map(p => <th key={p.id} style={{ textAlign: 'center' }}>{p.name}</th>)}</tr></thead>
        <tbody>{FEATURE_PLAN.map(([f, need]) => <tr key={f}><td>{f}</td>{PLANS.map(p => <td key={p.id} style={{ textAlign: 'center' }}>{includes(p.id, need) ? <Icon name="check" size={18} style={{ color: 'var(--success)' }} aria-label="Included" /> : <span className="faint" aria-label="Not included">–</span>}</td>)}</tr>)}</tbody></table></div>
    </div>
    <Cards min={280} items={[{ t: 'Trial without a card', d: 'Basic and Pro start with 14 days free. We remind you 3 days before it ends.' }, { t: 'Pay your way', d: 'QRIS, virtual account or card. Invoices carry your NPWP.' }, { t: 'Change any time', d: 'Upgrade instantly; downgrades apply next period. Your data stays.' }]} />
    <p className="muted" style={{ textAlign: 'center' }}>More questions? Read the <Link href="/faq">FAQ</Link> or the <Link href="/refund-policy">refund policy</Link>.</p>
  </div></Wrap>;
}

export function Contact() {
  const { db } = useApp();
  const [f, setF] = useState({ name: '', business: '', phone: '', email: '', outlets: '1', type: 'F&B', time: 'Morning (09–12)', msg: '' });
  const [tried, setTried] = useState(false), [sent, setSent] = useState<string | null>(null);
  const errs = { name: !f.name.trim() ? 'Enter your name' : '', business: !f.business.trim() ? 'Enter your business name' : '', phone: f.phone.replace(/\D/g, '').length < 10 ? 'Enter a WhatsApp number' : '', email: f.email && !/^\S+@\S+\.\S+$/.test(f.email) ? 'That email looks incomplete' : '' };
  const ok = !Object.values(errs).some(Boolean);
  const submit = (e: FormEvent) => {
    e.preventDefault(); setTried(true); if (!ok) return;
    const id = uid('lead');
    // Leads are records the BorNiz sales team picks up in Super admin.
    saveRecord('lead', { id, a: f.name.trim(), b: f.phone, c: f.business.trim(), d: `${f.type} · ${f.outlets} outlets · ${f.time}`, e: [f.email, f.msg].filter(Boolean).join(' · '), at: Date.now() }, 'public');
    setSent(id);
  };
  const leads = (db.records.lead ?? []).length;
  const input = (k: keyof typeof f, label: string, type = 'text', ph = '', optional = false) =>
    <Field label={label} optional={optional} error={tried ? (errs as Record<string, string>)[k] || undefined : undefined}><input className={'input' + (tried && (errs as Record<string, string>)[k] ? ' bad' : '')} type={type} placeholder={ph} value={f[k]} onChange={e => setF({ ...f, [k]: e.target.value })} /></Field>;
  return <Wrap><div className="grid" style={{ ['--min' as string]: '320px', gap: 40, alignItems: 'start' }}>
    <div className="stack lg">
      <PageHead kicker="Contact sales" title="Talk to us" sub="A product specialist replies on WhatsApp within an hour during business hours." />
      <Cards min={220} items={[{ t: 'WhatsApp', d: '+62 811 0000 2026 · Mon–Sat 08:00–20:00', icon: 'message-circle' }, { t: 'Book a demo', d: '30 minutes on Google Meet, tailored to your business', icon: 'video' }, { t: 'Email', d: 'hello@bornis.id', icon: 'mail' }, { t: 'Office', d: 'Jl. Senopati 12, Jakarta Selatan', icon: 'map-pin' }]} />
    </div>
    {sent ? <div className="card stack" aria-live="polite">
      <span style={{ width: 56, height: 56, borderRadius: 18, background: 'var(--success-soft)', color: 'var(--success-fg)', display: 'grid', placeItems: 'center' }}><Icon name="check" size={28} /></span>
      <h2>Thanks, {f.name.split(' ')[0]}. We’ll WhatsApp you soon.</h2>
      <p className="muted">A specialist will message {f.phone} within an hour (Mon–Sat 08:00–20:00) to book your demo in the {f.time.toLowerCase()}.</p>
      <span className="faint" style={{ fontSize: 13 }}>Reference <span className="mono">{sent.slice(0, 12)}</span> · {leads} {leads === 1 ? 'request' : 'requests'} received</span>
      <div className="row wrap"><Link href="/account/register" className="btn btn-primary">Try BorNiz free meanwhile</Link><button className="btn btn-ghost" onClick={() => { setSent(null); setTried(false); setF({ ...f, msg: '' }); }}>Send another</button></div>
    </div> : <form className="card stack" onSubmit={submit} noValidate>
      <h2>Book a demo</h2>
      {input('name', 'Your name', 'text', 'Budi Hartono')}
      {input('business', 'Business name', 'text', 'Kopi Biru')}
      {input('phone', 'WhatsApp number', 'tel', '0812 3456 7890')}
      {input('email', 'Email', 'email', 'you@business.id', true)}
      <div className="grid" style={{ ['--min' as string]: '140px', gap: 12 }}>
        <Field label="Outlets"><select className="input" value={f.outlets} onChange={e => setF({ ...f, outlets: e.target.value })}>{['1', '2–3', '4–10', '11–50', '50+'].map(x => <option key={x}>{x}</option>)}</select></Field>
        <Field label="Business type"><select className="input" value={f.type} onChange={e => setF({ ...f, type: e.target.value })}>{['F&B', 'Retail', 'Services', 'Franchise'].map(x => <option key={x}>{x}</option>)}</select></Field>
      </div>
      <Field label="Best time for a call"><select className="input" value={f.time} onChange={e => setF({ ...f, time: e.target.value })}>{['Morning (09–12)', 'Afternoon (13–16)', 'Evening (16–20)'].map(x => <option key={x}>{x}</option>)}</select></Field>
      <Field label="What should we show you?" optional><textarea className="input" value={f.msg} onChange={e => setF({ ...f, msg: e.target.value })} placeholder="e.g. QR ordering for 3 outlets, delivery apps, franchise brand lock" /></Field>
      <button className="btn btn-primary btn-lg">Book my demo</button>
      <span className="faint" style={{ fontSize: 12 }}>We only use your number to arrange the demo. See our <Link href="/privacy-policy">privacy policy</Link>.</span>
    </form>}
  </div></Wrap>;
}
