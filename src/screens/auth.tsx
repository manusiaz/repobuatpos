'use client';
// Auth & onboarding (spec/BorNiz Auth, layout A: split panel, single column on phone). Sign up to first sale in 5 minutes:
// WhatsApp OTP first, every onboarding step skippable, no card for Free or a trial.
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { useApp } from '../app/context.tsx';
import { setSession } from '../session.ts';
import { setDeviceOutlet, setSetting } from '../data/actions.ts';
import { inviteEmployee, setPlan } from '../data/actions/auth.ts';
import type { Employee, Role } from '../data/schema.ts';
import { bps, idr } from '../domain/money.ts';
import { Avatar, Badge, Field, Icon, Numpad, Seg, Status, dateShort, toast, useNow } from '../ui/kit.tsx';
import { PLANS, PPN_BPS, TRIAL_DAYS, billed, perMonth, planOf, type PlanId } from './public/plans.ts';
import { PairDevice, ProductImporter } from './public/states-kit.tsx';

const A = '/account/';
const POS_HOME = '/pos/selling/register-order';
const OB = ['onboarding-business-profile', 'onboarding-outlet-and-tax', 'onboarding-import-products', 'onboarding-invite-team', 'choose-plan'];
const OB_LABEL = ['Business', 'Outlet & tax', 'Products', 'Team', 'Plan'];
const STEPS: [string, string][] = [['login', 'Log in'], ['register', 'Register'], ['verify-email-otp', 'Verify'], ...OB.map((s, i) => [s, OB_LABEL[i]] as [string, string]), ['plan-activated', 'Ready'], ['choose-outlet', 'Outlet'], ['choose-register', 'Register'], ['cashier-pin-login', 'PIN']];

// The sign-up in progress lives in this tab until the account exists (sessionStorage, like the session itself).
interface Flow { name?: string; phone?: string; email?: string; purpose?: 'register' | 'login' | 'reset'; channel?: 'wa' | 'email'; otp?: string; otpAt?: number; pending?: { id: string; role: Role; outletId: string }; plan?: PlanId; yearly?: boolean; trial?: boolean }
const FKEY = 'borniz-signup';
const readFlow = (): Flow => { try { return JSON.parse(sessionStorage.getItem(FKEY) || '{}'); } catch { return {}; } };
function useFlow(): [Flow, (p: Partial<Flow>) => void] {
  const [f, setF] = useState<Flow>({});
  useEffect(() => setF(readFlow()), []);
  return [f, p => { const n = { ...readFlow(), ...p }; try { sessionStorage.setItem(FKEY, JSON.stringify(n)); } catch { /* private mode: keep in memory */ } setF(n); }];
}
const mask = (p = '') => p.replace(/\D/g, '').replace(/^(\d{4})\d+(\d{4})$/, '$1 •••• $2');
const digits = (s: string) => s.replace(/\D/g, '').replace(/^62/, '0');
const code6 = () => String(Math.floor(100000 + Math.random() * 900000));
/** Demo authenticator: rotates every 30 s. Production uses TOTP from the owner's authenticator app. */
const totp = (t = Date.now()) => String((Math.floor(t / 30e3) * 7919) % 1e6).padStart(6, '0');
const emailOf = (e: Employee) => `${e.id}@kopibiru.id`;

export default function Screen() {
  const { page } = useApp();
  const slug = page.slug, ob = OB.indexOf(slug);
  return <div className="au">
    <style>{`.au{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.1fr);min-height:100dvh}.au-bar{display:none}
      @media (max-width:767px){.au{grid-template-columns:minmax(0,1fr)}.au-side{display:none!important}.au-bar{display:flex}}`}</style>
    <Side slug={slug} ob={ob} />
    <main className="stack" style={{ padding: '24px var(--margin) 48px', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-surface)' }}>
      <div className="au-bar row between" style={{ width: 'min(460px,100%)' }}><Link href="/" style={{ font: '700 22px var(--font-display)', color: 'var(--fg-1)', letterSpacing: '-.03em' }}>BorNiz</Link>{ob >= 0 && <span className="cap">Step {ob + 1} of 5</span>}</div>
      <div className="stack" style={{ width: 'min(460px,100%)', gap: 16 }}>
        {ob >= 0 && <Progress i={ob} />}
        <View slug={slug} />
      </div>
    </main>
  </div>;
}

function Side({ slug, ob }: { slug: string; ob: number }) {
  const done = slug === 'plan-activated';
  const at = STEPS.findIndex(s => s[0] === slug);
  return <aside className="au-side stack" style={{ background: 'var(--ink-950)', color: 'var(--ink-0)', padding: 40, justifyContent: 'space-between', gap: 24, position: 'sticky', top: 0, height: '100dvh', overflowY: 'auto' }}>
    <Link href="/" style={{ font: '700 24px var(--font-display)', letterSpacing: '-.03em', color: 'var(--ink-0)' }}>BorNiz</Link>
    <div className="stack">
      <b style={{ fontSize: 44, lineHeight: 1, letterSpacing: '-.04em' }}>{ob >= 0 ? 'Set up in 5 steps.' : done ? 'You’re ready to sell.' : 'Sell fast. See everything.'}</b>
      <span style={{ fontSize: 16, lineHeight: 1.55, color: 'var(--ink-300)', maxWidth: 420 }}>{ob >= 0 ? 'Everything here can be changed later in Settings. Skip anything you’re not sure about.' : 'Cloud POS for cafés, restaurants, shops and services. QRIS, cash, card and e-wallet in one register.'}</span>
    </div>
    <nav className="stack" style={{ gap: 4 }} aria-label="Steps">{STEPS.map(([s, l], i) => <Link key={s} href={A + s} className="row" style={{ height: 34, padding: '0 10px', borderRadius: 9, background: s === slug ? 'var(--ink-800)' : 'transparent', color: s === slug ? 'var(--ink-0)' : 'var(--ink-400)', fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>
      <span style={{ width: 20, height: 20, borderRadius: 99, background: at > i ? 'var(--success)' : s === slug ? 'var(--accent)' : 'var(--ink-700)', color: 'var(--ink-0)', display: 'grid', placeItems: 'center', fontSize: 10, fontWeight: 800 }}>{at > i ? <Icon name="check" size={12} /> : i + 1}</span>{l}</Link>)}</nav>
  </aside>;
}

function Progress({ i }: { i: number }) {
  return <div className="stack sm"><span className="cap" style={{ color: 'var(--accent-fg)' }}>Step {i + 1} of 5 · {OB_LABEL[i]}</span>
    <div style={{ height: 6, borderRadius: 9, background: 'var(--bg-sunken)', overflow: 'hidden' }}><span style={{ display: 'block', height: '100%', width: ((i + 1) / 5) * 100 + '%', background: 'var(--accent)', transition: 'width var(--dur-slow) var(--ease-out)' }} /></div></div>;
}

function Head({ h, sub }: { h: string; sub?: ReactNode }) {
  return <div className="stack sm"><h1 style={{ fontSize: 30 }}>{h}</h1>{sub && <p className="muted" style={{ fontSize: 15 }}>{sub}</p>}</div>;
}
const Note = ({ tone = 'neutral', children }: { tone?: 'neutral' | 'success' | 'danger' | 'info'; children: ReactNode }) =>
  <div className={'banner' + (tone === 'neutral' ? '' : ' b-' + tone)} style={tone === 'neutral' ? { background: 'var(--bg-sunken)', color: 'var(--fg-2)' } : undefined} role={tone === 'danger' ? 'alert' : undefined}>{children}</div>;
const Links = ({ children }: { children: ReactNode }) => <div className="row between wrap" style={{ fontSize: 14, fontWeight: 600 }}>{children}</div>;

function View({ slug }: { slug: string }) {
  switch (slug) {
    case 'login': case 'account': return <Login />;
    case 'register': return <Register />;
    case 'forgot-password': return <Forgot />;
    case 'reset-password': return <Reset />;
    case 'verify-email-otp': return <Otp />;
    case '2fa-challenge': return <TwoFA />;
    case 'onboarding-business-profile': return <Business />;
    case 'onboarding-outlet-and-tax': return <OutletTax />;
    case 'onboarding-import-products': return <Products />;
    case 'onboarding-invite-team': return <Team />;
    case 'choose-plan': return <ChoosePlan />;
    case 'checkout-and-payment': return <Checkout />;
    case 'plan-activated': return <Activated />;
    case 'choose-outlet': return <ChooseOutlet />;
    case 'choose-register': return <ChooseRegister />;
    case 'cashier-pin-login': return <PinLogin />;
  }
  return <Head h="This step doesn’t exist" sub={<Link href={A + 'login'}>Go to log in</Link>} />;
}

// ── Sign in ─────────────────────────────────────────────────────────────────────────────
/** Owner and manager sign in with an account; owners confirm with 2FA. Shared devices use a PIN instead. */
function finishLogin(e: { id: string; role: Role; outletId: string }, go: (p: string) => void) {
  setSession(e); try { sessionStorage.removeItem(FKEY); } catch { /* ignore */ }
  go(e.role === 'owner' ? '/owner' : '/manager');
}

function Login() {
  const { db, go } = useApp();
  const [, setFlow] = useFlow();
  const [id, setId] = useState(''), [pw, setPw] = useState(''), [err, setErr] = useState<ReactNode>(null), [show, setShow] = useState(false);
  const find = () => { const v = id.trim().toLowerCase(), d = digits(v); return db.employees.find(e => emailOf(e) === v || (d.length >= 9 && digits(e.phone) === d)); };
  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    const e = find();
    if (!e) return setErr(<>No account with that email or phone. <Link href={A + 'register'}>Create one</Link>?</>);
    if (!['owner', 'manager'].includes(e.role)) return setErr(<>{e.name} is {e.role === 'pic' ? 'a PIC' : 'a ' + e.role}. Staff sign in with their PIN on the register. <Link href={A + 'cashier-pin-login'}>PIN login</Link></>);
    if (pw.length < 8) return setErr('Wrong password. Passwords have at least 8 characters.');
    const s = { id: e.id, role: e.role, outletId: e.outlets[0] };
    if (e.role === 'owner') { setFlow({ pending: s, phone: e.phone, purpose: 'login' }); return go(A + '2fa-challenge'); }
    finishLogin(s, go);
  };
  const viaWa = () => { const e = find(); if (!e) return setErr('Enter your email or WhatsApp number first.'); setFlow({ pending: { id: e.id, role: e.role, outletId: e.outlets[0] }, phone: e.phone, purpose: 'login', channel: 'wa', otp: undefined, otpAt: undefined }); go(A + 'verify-email-otp'); };
  return <form className="stack" onSubmit={submit} noValidate>
    <Head h="Welcome back" sub="Log in to manage your outlets." />
    <Field label="Email or phone"><input className={'input' + (err ? ' bad' : '')} autoComplete="username" value={id} onChange={e => { setId(e.target.value); setErr(null); }} placeholder="budi@kopibiru.id" autoFocus /></Field>
    <Field label="Password">
      <div className="row"><input className="input grow" type={show ? 'text' : 'password'} autoComplete="current-password" value={pw} onChange={e => { setPw(e.target.value); setErr(null); }} />
        <button type="button" className="btn btn-ghost icon-btn" onClick={() => setShow(s => !s)} aria-label={show ? 'Hide password' : 'Show password'}><Icon name={show ? 'eye-off' : 'eye'} /></button></div>
    </Field>
    {err && <Note tone="danger"><Icon name="circle-alert" /><span>{err}</span></Note>}
    <button className="btn btn-primary btn-lg">Log in</button>
    <button type="button" className="btn btn-lg" onClick={viaWa}><Icon name="message-circle" />Log in with a WhatsApp code</button>
    <Note><Icon name="info" /><span>Demo accounts: <button type="button" className="btn btn-ghost btn-sm" onClick={() => setId('budi@kopibiru.id')}>budi@kopibiru.id</button> owner · <button type="button" className="btn btn-ghost btn-sm" onClick={() => setId('andi@kopibiru.id')}>andi@kopibiru.id</button> manager · any password of 8+ characters.</span></Note>
    <Links><Link href={A + 'forgot-password'}>Forgot password?</Link><Link href={A + 'register'}>Create an account</Link><Link href={A + 'cashier-pin-login'}>Staff PIN login</Link></Links>
  </form>;
}

function TwoFA() {
  const { go } = useApp();
  const [flow, setFlow] = useFlow();
  const now = useNow(1000);
  const [code, setCode] = useState(''), [err, setErr] = useState('');
  const left = 30 - Math.floor(now / 1000) % 30;
  const check = (c: string) => {
    if (c.length < 6) return;
    if (!flow.pending) return setErr('Your sign-in timed out. Log in again.');
    if (c !== totp(now) && c !== totp(now - 30e3)) { setErr('That code didn’t work. Use the newest code in your authenticator app.'); setCode(''); return; }
    finishLogin(flow.pending, go);
  };
  return <div className="stack">
    <Head h="Two-step verification" sub="Owners confirm every new sign-in. Enter the 6-digit code from your authenticator app." />
    <CodeBoxes value={code} onChange={c => { setCode(c); setErr(''); check(c); }} bad={!!err} />
    {err && <Note tone="danger"><Icon name="circle-alert" />{err}</Note>}
    <Note><Icon name="smartphone" /><span className="grow">Demo authenticator: <b className="mono">{totp(now)}</b></span><span className="faint">{left}s</span></Note>
    <button className="btn btn-primary btn-lg" onClick={() => check(code)} disabled={code.length < 6}>Verify</button>
    <Links><button className="btn btn-ghost btn-sm" onClick={() => { setFlow({ purpose: 'login', channel: 'wa', otp: undefined, otpAt: undefined }); go(A + 'verify-email-otp'); }}>Send a WhatsApp code instead</button><Link href={A + 'login'}>Back to log in</Link></Links>
  </div>;
}

/** Six boxes over one numeric input (autofills from SMS/WhatsApp on phones). */
function CodeBoxes({ value, onChange, bad, n = 6 }: { value: string; onChange: (v: string) => void; bad?: boolean; n?: number }) {
  return <label className={bad ? 'shake' : ''} style={{ position: 'relative', display: 'grid', gridTemplateColumns: `repeat(${n},1fr)`, gap: 8 }}>
    {Array.from({ length: n }, (_, i) => <span key={i} className="num" style={{ height: 60, borderRadius: 14, border: '1.5px solid ' + (bad ? 'var(--danger)' : i === value.length ? 'var(--accent)' : 'var(--border)'), background: 'var(--bg-surface)', display: 'grid', placeItems: 'center', fontSize: 24 }}>{value[i] ?? ''}</span>)}
    <input aria-label="Verification code" inputMode="numeric" autoComplete="one-time-code" autoFocus maxLength={n} value={value} onChange={e => onChange(e.target.value.replace(/\D/g, '').slice(0, n))}
      style={{ position: 'absolute', inset: 0, opacity: 0, fontSize: 16 }} />
  </label>;
}

function Otp() {
  const { db, go } = useApp();
  const [flow, setFlow] = useFlow();
  const now = useNow(1000);
  const [code, setCode] = useState(''), [err, setErr] = useState('');
  const ch = flow.channel ?? 'wa', purpose = flow.purpose ?? 'register';
  const to = ch === 'wa' ? 'WhatsApp ' + (mask(flow.phone) || 'your number') : flow.email || 'your email';
  const send = (c = ch) => { const otp = code6(); setFlow({ otp, otpAt: Date.now(), channel: c }); setCode(''); setErr(''); toast(`${c === 'wa' ? 'WhatsApp' : 'Email'} sent · code ${otp}`); };
  useEffect(() => { if (flow.otpAt === undefined && readFlow().otpAt === undefined) send(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const wait = flow.otpAt ? Math.max(0, 60 - Math.floor((now - flow.otpAt) / 1000)) : 0;
  const expired = flow.otpAt ? now - flow.otpAt > 5 * 60e3 : false;
  const check = (c: string) => {
    if (c.length < 6) return;
    if (expired) return setErr('This code expired. Send a new one.');
    if (c !== flow.otp) { setErr('That code doesn’t match. Check the latest message.'); setCode(''); return; }
    setFlow({ otp: undefined, otpAt: undefined });
    if (purpose === 'login' && flow.pending) return finishLogin(flow.pending, go);
    if (purpose === 'reset') return go(A + 'reset-password');
    toast('Number verified'); go(A + OB[0]);
  };
  return <div className="stack">
    <Head h="Enter the code" sub={<>We sent a 6-digit code to <b>{to}</b>.</>} />
    <CodeBoxes value={code} onChange={c => { setCode(c); setErr(''); check(c); }} bad={!!err} />
    {err && <Note tone="danger"><Icon name="circle-alert" />{err}</Note>}
    {flow.otp && <Note><Icon name="info" /><span>Demo: WhatsApp isn’t connected here, so the code is <b className="mono">{flow.otp}</b>.</span></Note>}
    <button className="btn btn-primary btn-lg" onClick={() => check(code)} disabled={code.length < 6}>Verify</button>
    <Links>
      <button className="btn btn-ghost btn-sm" disabled={wait > 0} onClick={() => send()}>{wait > 0 ? `Resend in 0:${String(wait).padStart(2, '0')}` : 'Resend code'}</button>
      <button className="btn btn-ghost btn-sm" onClick={() => send(ch === 'wa' ? 'email' : 'wa')}>{ch === 'wa' ? 'Use email instead' : 'Use WhatsApp instead'}</button>
    </Links>
    {purpose === 'register' && !flow.phone && <span className="faint" style={{ fontSize: 13 }}>No number yet? <Link href={A + 'register'}>Start from register</Link>. {db.tenant.name} demo works either way.</span>}
  </div>;
}

function Register() {
  const { go } = useApp();
  const [flow, setFlow] = useFlow();
  const [f, setF] = useState({ name: '', phone: '', email: '', pw: '' }), [agree, setAgree] = useState(true), [tried, setTried] = useState(false);
  useEffect(() => setF(x => ({ ...x, name: flow.name ?? '', phone: flow.phone ?? '', email: flow.email ?? '' })), [flow.name, flow.phone, flow.email]);
  const errs = { name: !f.name.trim() ? 'Enter your name' : '', phone: digits(f.phone).length < 10 ? 'Enter a WhatsApp number, e.g. 0812 3456 7890' : '', email: f.email && !/^\S+@\S+\.\S+$/.test(f.email) ? 'That email looks incomplete' : '', pw: f.pw.length < 8 ? 'At least 8 characters' : '' };
  const ok = !Object.values(errs).some(Boolean) && agree;
  const submit = (e: FormEvent) => { e.preventDefault(); setTried(true); if (!ok) return; setFlow({ name: f.name.trim(), phone: f.phone, email: f.email, purpose: 'register', channel: 'wa', otp: undefined, otpAt: undefined }); go(A + 'verify-email-otp'); };
  const field = (k: keyof typeof f, label: string, type: string, ph: string, ac: string, optional?: boolean) =>
    <Field label={label} error={tried ? errs[k] : undefined} optional={optional}><input className={'input' + (tried && errs[k] ? ' bad' : '')} type={type} inputMode={type === 'tel' ? 'tel' : undefined} autoComplete={ac} placeholder={ph} value={f[k]} onChange={e => setF({ ...f, [k]: e.target.value })} /></Field>;
  return <form className="stack" onSubmit={submit} noValidate>
    <Head h="Start free, no card needed" sub="Set up your first outlet in about 5 minutes." />
    {field('name', 'Your name', 'text', 'Budi Hartono', 'name')}
    {field('phone', 'WhatsApp number', 'tel', '0812 3456 7890', 'tel')}
    {field('email', 'Email', 'email', 'budi@kopibiru.id', 'email', true)}
    {field('pw', 'Password', 'password', '8+ characters', 'new-password')}
    <label className="row" style={{ fontSize: 14, minHeight: 44 }}><input type="checkbox" checked={agree} onChange={e => setAgree(e.target.checked)} style={{ width: 20, height: 20 }} />I agree to the <Link href="/terms-of-service">terms</Link> and <Link href="/privacy-policy">privacy policy</Link></label>
    <button className="btn btn-primary btn-lg" disabled={tried && !ok}>Create account</button>
    <span className="faint" style={{ fontSize: 13 }}>We’ll send a code to WhatsApp to confirm it’s you.</span>
    <Links><Link href={A + 'login'}>I already have an account</Link></Links>
  </form>;
}

function Forgot() {
  const { db, go } = useApp();
  const [, setFlow] = useFlow();
  const [id, setId] = useState(''), [sent, setSent] = useState<Employee | null | undefined>(undefined), [err, setErr] = useState('');
  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    const v = id.trim().toLowerCase(), d = digits(v);
    const e = db.employees.find(x => emailOf(x) === v || (d.length >= 9 && digits(x.phone) === d));
    if (!v) return setErr('Enter your email or WhatsApp number.');
    if (e && !['owner', 'manager'].includes(e.role)) return setErr('Staff PINs are reset by your manager, not by email.');
    // Same answer whether or not the account exists, so the form can't be used to find accounts.
    setSent(e ?? null); setFlow({ phone: e?.phone, email: e ? emailOf(e) : v, purpose: 'reset', channel: 'wa', otp: undefined, otpAt: undefined }); setErr('');
  };
  if (sent !== undefined) return <div className="stack">
    <Head h="Check your WhatsApp" sub={<>If an account matches <b>{id}</b>, we sent a reset link to {sent ? 'WhatsApp ' + mask(sent.phone) : 'its WhatsApp and email'}.</>} />
    <Note><Icon name="clock" />The link works for 30 minutes. Staff who forgot their PIN should ask their manager.</Note>
    <button className="btn btn-primary btn-lg" onClick={() => go(A + 'verify-email-otp')}>Enter the code instead</button>
    <Links><button className="btn btn-ghost btn-sm" onClick={() => go(A + 'reset-password')}>Open the reset link (demo)</button><Link href={A + 'login'}>Back to log in</Link></Links>
  </div>;
  return <form className="stack" onSubmit={submit} noValidate>
    <Head h="Reset your password" sub="We’ll send a reset link to your email or WhatsApp." />
    <Field label="Email or phone" error={err || undefined}><input className={'input' + (err ? ' bad' : '')} value={id} onChange={e => { setId(e.target.value); setErr(''); }} autoFocus autoComplete="username" /></Field>
    <button className="btn btn-primary btn-lg">Send reset link</button>
    <Links><Link href={A + 'login'}>Back to log in</Link></Links>
  </form>;
}

function Reset() {
  const [pw, setPw] = useState(''), [pw2, setPw2] = useState(''), [tried, setTried] = useState(false), [done, setDone] = useState(false);
  const score = [pw.length >= 8, /\d/.test(pw), /[A-Z]/.test(pw) || /[^\w]/.test(pw), pw.length >= 12].filter(Boolean).length;
  const err = pw.length < 8 ? 'At least 8 characters' : pw !== pw2 ? 'Passwords don’t match' : '';
  if (done) return <div className="stack"><Head h="Password changed" sub="You’re signed out on other devices. Log in with your new password." /><Link className="btn btn-primary btn-lg" href={A + 'login'}>Log in</Link></div>;
  return <form className="stack" onSubmit={e => { e.preventDefault(); setTried(true); if (!err) setDone(true); }} noValidate>
    <Head h="Choose a new password" sub="Use something you don’t use anywhere else." />
    <Field label="New password"><input className="input" type="password" autoComplete="new-password" value={pw} onChange={e => setPw(e.target.value)} autoFocus /></Field>
    <div className="row" style={{ gap: 4 }} aria-label={`Strength ${score} of 4`}>{[0, 1, 2, 3].map(i => <span key={i} style={{ flex: 1, height: 6, borderRadius: 9, background: i < score ? (score < 2 ? 'var(--danger)' : score < 3 ? 'var(--warning)' : 'var(--success)') : 'var(--bg-sunken)' }} />)}</div>
    <Field label="Repeat password" error={tried ? err || undefined : undefined}><input className={'input' + (tried && err ? ' bad' : '')} type="password" autoComplete="new-password" value={pw2} onChange={e => setPw2(e.target.value)} /></Field>
    <button className="btn btn-primary btn-lg">Save password</button>
  </form>;
}

// ── Onboarding (each answer is a setting on the tenant; every step can be skipped) ──────────
function useSetting(path: string, id: string, fallback: string): [string, (v: string) => void] {
  const { db } = useApp();
  const [v, setV] = useState(String(db.settings[A + path + ':' + id] ?? fallback));
  return [v, setV];
}
function Nav({ i, onNext, label = 'Continue', disabled }: { i: number; onNext?: () => void; label?: string; disabled?: boolean }) {
  const { go } = useApp();
  return <div className="stack sm">
    <button className="btn btn-primary btn-lg" disabled={disabled} onClick={() => { onNext?.(); go(A + OB[i + 1]); }}>{label}</button>
    <div className="row between">{i > 0 ? <Link href={A + OB[i - 1]} className="btn btn-ghost btn-sm"><Icon name="arrow-left" size={16} />Back</Link> : <span />}<Link href={A + OB[i + 1]} className="btn btn-ghost btn-sm">Skip for now</Link></div>
  </div>;
}
function Choices<T extends string>({ value, onChange, items, cols = 2 }: { value: T; onChange: (v: T) => void; items: [T, string, string, string?][]; cols?: number }) {
  return <div className="grid" style={{ ['--min' as string]: cols === 1 ? '100%' : '180px', gap: 8 }} role="radiogroup">{items.map(([k, t, d, p]) =>
    <button key={k} type="button" role="radio" aria-checked={value === k} onClick={() => onChange(k)} className="stack" style={{ gap: 4, minHeight: 72, padding: '12px 14px', borderRadius: 16, textAlign: 'left', cursor: 'pointer', border: '2px solid ' + (value === k ? 'var(--accent)' : 'var(--border)'), background: value === k ? 'var(--accent-soft)' : 'var(--bg-surface)' }}>
      <b style={{ fontSize: 15 }}>{t}</b><span className="muted" style={{ fontSize: 12, lineHeight: 1.4 }}>{d}</span>{p && <b style={{ fontSize: 14 }}>{p}</b>}</button>)}</div>;
}

function Business() {
  const { db, me } = useApp();
  const owner = me?.id ?? db.employees.find(e => e.role === 'owner')!.id;
  const [name, setName] = useSetting(OB[0], 'name', db.tenant.name), [type, setType] = useSetting(OB[0], 'type', 'fnb');
  return <div className="stack">
    <Head h="Tell us about your business" sub="This sets your menu template, receipt and reports." />
    <Field label="Business name"><input className="input" value={name} onChange={e => setName(e.target.value)} autoFocus /></Field>
    <Choices value={type} onChange={setType} items={[['fnb', 'F&B', 'Café, resto, bar, bakery'], ['retail', 'Retail', 'Shop, minimarket, fashion'], ['services', 'Services', 'Salon, spa, laundry'], ['franchise', 'Franchise', 'Many outlets, one brand']]} />
    <Nav i={0} disabled={!name.trim()} onNext={() => { setSetting(A + OB[0] + ':name', name.trim(), owner); setSetting(A + OB[0] + ':type', type, owner); }} />
  </div>;
}

function OutletTax() {
  const { db, me, outletId } = useApp();
  const o = db.outlets.find(x => x.id === outletId) ?? db.outlets[0];
  const owner = me?.id ?? db.employees.find(e => e.role === 'owner')!.id;
  const [name, setName] = useSetting(OB[1], 'outlet', o.name), [addr, setAddr] = useSetting(OB[1], 'address', o.city);
  const [tax, setTax] = useSetting(OB[1], 'tax', o.taxBps === 1000 ? 'pb1' : 'none'), [svc, setSvc] = useState(String(db.settings[A + OB[1] + ':service'] ?? (o.serviceBps > 0)) === 'true');
  const [incl, setIncl] = useState(String(db.settings[A + OB[1] + ':inclusive'] ?? o.taxInclusive) === 'true');
  const sample = 25000, t = tax === 'pb1' ? 1000 : tax === 'ppn' ? 1100 : 0, s = svc ? bps(sample, 500) : 0;
  const total = incl ? sample + s : sample + s + bps(sample + s, t);
  return <div className="stack">
    <Head h="Your first outlet" sub="You can add more outlets anytime." />
    <Field label="Outlet name"><input className="input" value={name} onChange={e => setName(e.target.value)} /></Field>
    <Field label="Address"><input className="input" value={addr} onChange={e => setAddr(e.target.value)} autoComplete="street-address" /></Field>
    <Choices value={tax} onChange={setTax} items={[['pb1', 'PB1 10%', 'Restaurant tax'], ['ppn', 'PPN 11%', 'VAT, for PKP'], ['none', 'No tax', 'Set up later']]} />
    <label className="row between" style={{ minHeight: 44 }}><span>Service charge 5% on dine-in</span><input type="checkbox" checked={svc} onChange={e => setSvc(e.target.checked)} style={{ width: 22, height: 22 }} /></label>
    <label className="row between" style={{ minHeight: 44 }}><span>Menu prices already include tax</span><input type="checkbox" checked={incl} onChange={e => setIncl(e.target.checked)} style={{ width: 22, height: 22 }} /></label>
    <Note><Icon name="receipt" /><span>A {idr(sample)} item rings up as <b>{idr(total)}</b>{s ? ` (service ${idr(s)})` : ''}.</span></Note>
    <Nav i={1} disabled={!name.trim()} onNext={() => { for (const [k, v] of [['outlet', name.trim()], ['address', addr], ['tax', tax], ['service', String(svc)], ['inclusive', String(incl)]]) setSetting(A + OB[1] + ':' + k, v, owner); }} />
  </div>;
}

function Products() {
  const { db, outletId } = useApp();
  const [mode, setMode] = useState<'template' | 'import' | 'manual'>('template');
  const live = db.outletProducts.filter(x => x.outletId === outletId && !x.hidden).length;
  return <div className="stack">
    <Head h="Add your products" sub="Start from a template, import a file or add later." />
    <Choices cols={1} value={mode} onChange={setMode} items={[['template', 'Use the F&B template', `${live} items on your menu now · edit any time`], ['import', 'Import Excel / CSV', 'Download our template first'], ['manual', 'Add manually', 'One by one with photos, in Owner › Catalog']]} />
    {mode === 'import' && <div className="card"><ProductImporter compact /></div>}
    {mode === 'manual' && <Link className="btn" href="/owner/catalog/import-products">Open the catalog<Icon name="arrow-right" size={16} /></Link>}
    <Nav i={2} />
  </div>;
}

function Team() {
  const { db, me, outletId } = useApp();
  const owner = me?.id ?? db.employees.find(e => e.role === 'owner')!.id;
  const [rows, setRows] = useState<{ name: string; phone: string; role: Role }[]>([{ name: '', phone: '', role: 'manager' }, { name: '', phone: '', role: 'cashier' }]);
  const invited = db.employees.filter(e => !e.active && e.outlets.includes(outletId));
  const valid = rows.filter(r => digits(r.phone).length >= 10);
  const send = () => { valid.forEach(r => inviteEmployee({ name: r.name.trim() || 'New ' + r.role, phone: r.phone, role: r.role, outletId }, owner)); if (valid.length) toast(`${valid.length} WhatsApp ${valid.length === 1 ? 'invite' : 'invites'} sent`); setRows([{ name: '', phone: '', role: 'cashier' }]); };
  return <div className="stack">
    <Head h="Invite your team" sub="They get a WhatsApp link and set their own PIN." />
    {rows.map((r, i) => <div key={i} className="stack sm sunken">
      <div className="row"><input className="input grow" placeholder="Name" value={r.name} onChange={e => setRows(rs => rs.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} aria-label="Name" />
        <select className="input" style={{ width: 130 }} value={r.role} onChange={e => setRows(rs => rs.map((x, j) => j === i ? { ...x, role: e.target.value as Role } : x))} aria-label="Role">{(['manager', 'pic', 'cashier', 'kitchen', 'waiter'] as Role[]).map(x => <option key={x} value={x}>{x === 'pic' ? 'PIC' : x[0].toUpperCase() + x.slice(1)}</option>)}</select></div>
      <input className="input" type="tel" inputMode="tel" placeholder="WhatsApp number" value={r.phone} onChange={e => setRows(rs => rs.map((x, j) => j === i ? { ...x, phone: e.target.value } : x))} aria-label="WhatsApp number" />
    </div>)}
    <div className="row wrap"><button className="btn" onClick={() => setRows(rs => [...rs, { name: '', phone: '', role: 'cashier' }])}><Icon name="plus" size={18} />Add another</button>
      <button className="btn btn-primary" disabled={!valid.length} onClick={send}><Icon name="send" size={18} />Send {valid.length || ''} {valid.length === 1 ? 'invite' : 'invites'}</button></div>
    {invited.length > 0 && <div className="card stack sm"><b style={{ fontSize: 14 }}>Invited · waiting to set a PIN</b>{invited.map(e => <div key={e.id} className="row"><Avatar name={e.name} color={e.color} size={28} /><span className="grow">{e.name} <span className="faint">· {mask(e.phone)}</span></span><Badge>{e.role}</Badge></div>)}</div>}
    <Nav i={3} />
  </div>;
}

function ChoosePlan() {
  const { db, go } = useApp();
  const [flow, setFlow] = useFlow();
  const [sel, setSel] = useState<PlanId>(flow.plan ?? 'pro'), [yearly, setYearly] = useState(!!flow.yearly);
  const p = planOf(sel), end = Date.now() + TRIAL_DAYS * 864e5;
  const owner = db.employees.find(e => e.role === 'owner')!.id;
  const start = (trial: boolean) => {
    setFlow({ plan: sel, yearly, trial });
    if (sel === 'enterprise') return go('/contact-sales-book-a-demo');
    if (sel === 'free' || trial) { setPlan(sel, owner, trial ? `${TRIAL_DAYS}-day trial` : ''); return go(A + 'plan-activated'); }
    go(A + 'checkout-and-payment');
  };
  return <div className="stack">
    <Head h="Choose a plan" sub="All plans include QRIS, cash and card. Change or cancel anytime." />
    <Seg value={yearly ? 'y' : 'm'} onChange={v => setYearly(v === 'y')} label="Billing" options={[['m', 'Monthly'], ['y', 'Yearly · save 17%']]} />
    <Choices value={sel} onChange={setSel} items={PLANS.map(x => [x.id, x.name + (x.popular ? ' · popular' : ''), x.blurb, x.monthly == null ? 'Contact sales' : x.monthly === 0 ? 'IDR 0' : idr(perMonth(x, yearly)!) + '/mo'] as [PlanId, string, string, string])} />
    {sel !== 'free' && sel !== 'enterprise' && <Note><Icon name="calendar" /><span>Trial ends {dateShort(end)}. We’ll remind you 3 days before. Pay by QRIS, VA or card, no card needed now.</span></Note>}
    <button className="btn btn-primary btn-lg" onClick={() => start(sel !== 'free')}>{sel === 'free' ? 'Start free' : sel === 'enterprise' ? 'Contact sales' : `Start ${TRIAL_DAYS}-day ${p.name} trial`}</button>
    {sel !== 'free' && sel !== 'enterprise' && <button className="btn btn-lg" onClick={() => start(false)}>Pay now instead</button>}
    <div className="row between"><Link href={A + OB[3]} className="btn btn-ghost btn-sm"><Icon name="arrow-left" size={16} />Back</Link><span className="faint" style={{ fontSize: 13 }}>Current plan: {planOf(db.tenant.plan).name}</span></div>
  </div>;
}

function Checkout() {
  const { db, go } = useApp();
  const [flow] = useFlow();
  const [method, setMethod] = useState<'qris' | 'va' | 'card'>('qris'), [state, setState] = useState<'idle' | 'pending' | 'failed'>('idle');
  const now = useNow(1000), [startAt, setStartAt] = useState(0);
  const p = planOf(flow.plan ?? 'pro'), yearly = !!flow.yearly;
  const owner = db.employees.find(e => e.role === 'owner')!.id;
  const qty = Math.max(1, Math.min(db.outlets.length, p.outlets));
  const free = p.monthly === 0 || flow.trial;
  const sub = (billed(p, yearly) ?? 0) * qty, tax = bps(sub, PPN_BPS), total = sub + tax;
  useEffect(() => {
    if (state !== 'pending') return;
    // The gateway webhook confirms the payment; the page never marks itself paid.
    const t = setTimeout(() => { setPlan(p.id, owner, `paid ${yearly ? 'yearly' : 'monthly'} · ${idr(total)}`); go(A + 'plan-activated'); }, 3500);
    return () => clearTimeout(t);
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps
  const left = Math.max(0, 300 - Math.floor((now - startAt) / 1000));
  if (free) return <div className="stack">
    <Head h="No payment needed" sub={p.monthly === 0 ? 'The Free plan stays free. No card, no trial end.' : `Your ${TRIAL_DAYS}-day ${p.name} trial needs no card.`} />
    <button className="btn btn-primary btn-lg" onClick={() => { setPlan(p.id, owner, p.monthly === 0 ? '' : `${TRIAL_DAYS}-day trial`); go(A + 'plan-activated'); }}>Continue without paying</button>
    <Link href={A + 'choose-plan'} className="btn btn-ghost">Change plan</Link>
  </div>;
  return <div className="stack">
    <Head h="Checkout" sub={`${p.name} · ${yearly ? 'billed yearly (2 months free)' : 'billed monthly'}`} />
    <div className="card stack sm" style={{ fontSize: 14 }}>
      <div className="row between"><span>{p.name} × {qty} {qty === 1 ? 'outlet' : 'outlets'} · {yearly ? '12 months' : '1 month'}</span><span className="num">{idr(sub)}</span></div>
      <div className="row between muted"><span>PPN 11%</span><span className="num">{idr(tax)}</span></div>
      <div className="row between" style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}><b>Total</b><b className="num" style={{ fontSize: 20 }}>{idr(total)}</b></div>
    </div>
    {state === 'pending' ? <div className="card stack" style={{ alignItems: 'center', textAlign: 'center' }} aria-live="polite">
      <Icon name={method === 'qris' ? 'qr-code' : method === 'va' ? 'landmark' : 'credit-card'} size={40} />
      <b>{method === 'qris' ? 'Scan with any bank or e-wallet app' : method === 'va' ? 'Pay to BCA virtual account' : 'Finish on the secure card page'}</b>
      {method === 'va' && <span className="mono" style={{ fontSize: 20 }}>8808 0812 {String(total).slice(-4)} 2026</span>}
      <Status s="pending" /><span className="muted" style={{ fontSize: 13 }}>Waiting for the bank to confirm… {method === 'qris' && `Code expires in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}.`}</span>
      <button className="btn btn-ghost btn-sm" onClick={() => setState('idle')}>Use another method</button>
    </div> : <>
      <Choices cols={1} value={method} onChange={setMethod} items={[['qris', 'QRIS', 'Any bank or e-wallet app'], ['va', 'Virtual account', 'BCA, Mandiri, BNI, BRI'], ['card', 'Credit or debit card', 'Visa, Mastercard, JCB · on the gateway’s secure page']]} />
      <button className="btn btn-pay btn-primary" onClick={() => { setStartAt(Date.now()); setState('pending'); }}>Pay {idr(total)}</button>
    </>}
    <span className="faint" style={{ fontSize: 13 }}>Invoices with your NPWP are in Owner › Account › Subscription billing. Cancel any time; see the <Link href="/refund-policy">refund policy</Link>.</span>
  </div>;
}

function Activated() {
  const { db, go } = useApp();
  const [flow] = useFlow();
  const p = planOf(db.tenant.plan), owner = db.employees.find(e => e.role === 'owner')!;
  const name = String(db.settings[A + OB[0] + ':name'] ?? db.tenant.name), outlet = String(db.settings[A + OB[1] + ':outlet'] ?? db.outlets[0].name);
  return <div className="stack">
    <span style={{ width: 64, height: 64, borderRadius: 20, background: 'var(--success-soft)', color: 'var(--success-fg)', display: 'grid', placeItems: 'center' }}><Icon name="party-popper" size={30} /></span>
    <Head h="You’re ready to sell" sub={`${name} ${outlet} is set up on ${p.name}${flow.trial ? ` · trial until ${dateShort(Date.now() + TRIAL_DAYS * 864e5)}` : ''}.`} />
    <Note tone="success"><Icon name="check" /><span>Next: pair a printer and customer display in Settings › Devices.</span></Note>
    <button className="btn btn-primary btn-lg" onClick={() => finishLogin({ id: owner.id, role: 'owner', outletId: owner.outlets[0] }, go)}>Go to dashboard</button>
    <Links><Link href={A + 'choose-outlet'}>Open the register</Link><Link href="/owner/account/devices">Pair devices</Link></Links>
  </div>;
}

// ── Shared devices: outlet → register → PIN ─────────────────────────────────────────────
function ChooseOutlet() {
  const { db, user, me, go, setOutlet } = useApp();
  const list = me && user.role !== 'owner' ? db.outlets.filter(o => me.outlets.includes(o.id)) : db.outlets;
  const hhmm = new Date().toTimeString().slice(0, 5);
  return <div className="stack">
    <Head h="Choose outlet" sub="This tablet will sell for the outlet you pick." />
    {list.map(o => { const open = hhmm >= o.opens && hhmm < o.closes, regs = db.devices.filter(d => d.outletId === o.id && d.kind === 'pos').length;
      return <button key={o.id} className="card row" style={{ cursor: 'pointer', textAlign: 'left', minHeight: 72, borderColor: db.device.outletId === o.id ? 'var(--accent)' : undefined }} onClick={() => { setDeviceOutlet(o.id); setOutlet(o.id); go(A + 'choose-register'); }}>
        <Icon name="store" /><span className="grow"><b>{o.name}</b><br /><span className="faint" style={{ fontSize: 13 }}>{o.city} · {o.opens}–{o.closes} · {regs} {regs === 1 ? 'register' : 'registers'}</span></span><Badge tone={open ? 'success' : 'neutral'} dot>{open ? 'Open' : 'Closed'}</Badge><Icon name="chevron-right" /></button>; })}
  </div>;
}

function ChooseRegister() {
  const { db, go } = useApp();
  const o = db.outlets.find(x => x.id === db.device.outletId) ?? db.outlets[0];
  const paired = db.devices.find(d => d.id === db.device.paired.pos && d.outletId === o.id);
  return <div className="stack">
    <Head h="Choose register" sub={<>Pair this tablet to a register at <b>{o.name}</b>. <Link href={A + 'choose-outlet'}>Change outlet</Link></>} />
    {paired && <button className="btn btn-primary btn-lg" onClick={() => go(A + 'cashier-pin-login')}>Continue on {paired.name}</button>}
    <PairDevice outletId={o.id} onPaired={() => go(A + 'cashier-pin-login')} />
  </div>;
}

function PinLogin() {
  const { db, go } = useApp();
  const o = db.outlets.find(x => x.id === db.device.outletId) ?? db.outlets[0];
  const reg = db.devices.find(d => d.id === db.device.paired.pos);
  const staff = db.employees.filter(e => e.active && e.pin && (e.outlets.includes(o.id)) && ['cashier', 'pic', 'manager', 'owner'].includes(e.role));
  const [who, setWho] = useState<Employee | null>(null), [pin, setPin] = useState(''), [err, setErr] = useState(''), [tries, setTries] = useState(0);
  const key = (k: string) => {
    if (!who) return;
    if (k === 'del') return setPin(p => p.slice(0, -1));
    if (!/^\d$/.test(k)) return;
    const p = (pin + k).slice(0, 4); setPin(p); setErr('');
    if (p.length < 4) return;
    if (p !== who.pin) { setTries(t => t + 1); setErr(tries + 1 >= 5 ? 'Too many tries. Ask your manager to reset your PIN.' : `Wrong PIN. ${4 - tries} tries left.`); setTimeout(() => setPin(''), 300); return; }
    setSession({ id: who.id, role: who.role, outletId: o.id }); toast(`Welcome, ${who.name}`); go(POS_HOME);
  };
  return <div className="stack" onKeyDown={e => key(e.key === 'Backspace' ? 'del' : e.key)} tabIndex={-1}>
    <Head h={who ? `Hi ${who.name}, enter your PIN` : 'Who’s selling?'} sub={<>{o.name} · {reg?.name ?? <Link href={A + 'choose-register'}>pair a register</Link>}</>} />
    {!who ? <div className="grid" style={{ ['--min' as string]: '120px', gap: 10 }}>{staff.map(e => <button key={e.id} className="card stack" style={{ alignItems: 'center', cursor: 'pointer', padding: 16, minHeight: 120 }} onClick={() => { setWho(e); setPin(''); setErr(''); setTries(0); }}>
      <Avatar name={e.name} color={e.color} size={48} /><b>{e.name}</b><span className="faint" style={{ fontSize: 12 }}>{e.role === 'pic' ? 'PIC' : e.role}</span></button>)}</div>
      : <>
        <div className={'pin-dots' + (err ? ' shake' : '')} aria-label={`${pin.length} of 4 digits`}>{[0, 1, 2, 3].map(i => <i key={i} className={i < pin.length ? 'on' : ''} />)}</div>
        {err && <p role="alert" style={{ color: 'var(--danger-fg)', textAlign: 'center' }}>{err}</p>}
        <div style={{ opacity: tries >= 5 ? .4 : 1, pointerEvents: tries >= 5 ? 'none' : undefined }}><Numpad onKey={key} extra="" /></div>
        <div className="row between"><button className="btn btn-ghost" onClick={() => setWho(null)}><Icon name="arrow-left" size={18} />Not {who.name}?</button><span className="faint" style={{ fontSize: 13 }}>Demo PIN 1234</span></div>
      </>}
  </div>;
}
