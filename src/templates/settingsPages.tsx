'use client';
// Settings pages with their own data: business identity, your profile & security, receipt, labels, referral, outlets, staff.
// Each edits the real record the rest of the system reads (receipt printer, sign-in, QR menu, every outlet screen).
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from '../ui/Link.tsx';
import { useApp } from '../app/context.tsx';
import { Avatar, Badge, Empty, Field, Icon, Sheet, Toggle, toast } from '../ui/kit.tsx';
import { usePin } from '../ui/PinSheet.tsx';
import { idr } from '../domain/money.ts';
import { patchOutlet, saveEmployee, setSetting } from '../data/actions.ts';
import { addOutlet, saveBusiness } from '../data/actions/business.ts';
import type { Employee, Outlet, Role } from '../data/schema.ts';
import { REFERRAL_PAGE, referral } from '../system/settings.ts';
import { linkTo } from '../system/hosts.ts';
import { QR } from '../ui/qr.tsx';
import { REMOTE } from '../data/remote.ts';
import { receiptDoc } from '../devices/receipt.ts';
import { toText, type Doc, type Op } from '../devices/layout.ts';
import { paperOf, receiptPrinter, thisDevice } from '../devices/routing.ts';
import { printDoc } from '../devices/printer.ts';
import { browserPrint } from '../devices/html.ts';

const row = { padding: '12px 0', borderTop: '1px solid var(--border)' } as const;

// ── Business profile & multi-brand ─────────────────────────────────────────────────────
export function BusinessProfile() {
  const { db, user } = useApp();
  const p = db.tenant.profile ?? { legalName: '', npwp: '', address: '', phone: '', email: '', brands: [] };
  const [name, setName] = useState(db.tenant.name), [f, setF] = useState(p), [brands, setBrands] = useState(p.brands.join(', '));
  const can = user.role === 'owner';
  const save = () => { saveBusiness(name, { ...f, brands: brands.split(',').map(b => b.trim()).filter(Boolean) }, user.id); toast('Saved · printed on the next receipt'); };
  const input = (k: keyof typeof f, label: string, hint?: string) => <Field label={label} hint={hint}><input className="input" disabled={!can} value={String(f[k] ?? '')} onChange={e => setF({ ...f, [k]: e.target.value })} /></Field>;
  return <div className="stack">
    <Field label="Brand name" hint="Shown on every screen, receipt and the QR menu"><input className="input" disabled={!can} value={name} onChange={e => setName(e.target.value)} /></Field>
    {input('legalName', 'Legal name (PT / CV)', 'Printed under the brand on receipts and invoices')}
    {input('npwp', 'NPWP', 'Printed when an outlet has no NPWPD of its own')}
    {input('address', 'Head office address')}
    <div className="row wrap">{input('phone', 'Phone')}{input('email', 'Email')}</div>
    <Field label="Brands in this business" hint="Comma separated, e.g. Kopi Biru, Biru Bakery"><input className="input" disabled={!can} value={brands} onChange={e => setBrands(e.target.value)} /></Field>
    {can ? <button className="btn btn-primary" style={{ alignSelf: 'flex-start' }} onClick={save}>Save</button> : <span className="muted">Only the owner changes the business profile.</span>}
  </div>;
}

// ── Profile & security ─────────────────────────────────────────────────────────────────
export function ProfileSecurity() {
  const { db, me, user } = useApp();
  const pin = usePin();
  const [name, setName] = useState(me?.name ?? ''), [phone, setPhone] = useState(me?.phone ?? '');
  const [login, setLogin] = useState(''), [appr, setAppr] = useState('');
  if (!me) return <Empty icon="user" title="BorNiz staff account">Platform staff manage their profile in the admin console.</Empty>;
  const savePins = () => {
    if (login && !/^\d{4,6}$/.test(login)) return toast('Login PIN is 4 to 6 digits');
    if (appr && !/^\d{6}$/.test(appr)) return toast('Approval PIN is 6 digits');
    if (appr && appr === login) return toast('Use a different approval PIN from your login PIN');
    pin.ask({ title: 'Confirm with your current approval PIN', onOk: () => { saveEmployee({ ...me, ...(login ? { pin: login } : {}), ...(appr ? { approvalPin: appr } : {}) }, user.id); setLogin(''); setAppr(''); toast('PINs changed on every device'); } });
  };
  return <div className="stack lg">
    <section className="stack"><h3>Profile</h3>
      <div className="row"><Avatar name={me.name} color={me.color} size={44} /><span className="stack" style={{ gap: 0 }}><b>{me.name}</b><span className="muted">{me.role} · {me.outlets.map(o => db.outlets.find(x => x.id === o)?.name).join(', ')}</span></span></div>
      <div className="row wrap"><Field label="Name"><input className="input" value={name} onChange={e => setName(e.target.value)} /></Field><Field label="WhatsApp number"><input className="input" inputMode="tel" value={phone} onChange={e => setPhone(e.target.value)} /></Field></div>
      <button className="btn" style={{ alignSelf: 'flex-start' }} onClick={() => { saveEmployee({ ...me, name: name.trim() || me.name, phone }, user.id); toast('Saved'); }}>Save profile</button></section>
    <section className="stack"><h3>PINs</h3>
      <p className="muted" style={{ fontSize: 14 }}>The login PIN opens shared devices (POS, KDS). The approval PIN signs approvals and is never the same as the login PIN. 5 wrong tries lock it for 15 minutes.</p>
      <div className="row wrap"><Field label="New login PIN" optional><input className="input mono" inputMode="numeric" type="password" maxLength={6} value={login} onChange={e => setLogin(e.target.value.replace(/\D/g, ''))} /></Field>
        <Field label="New approval PIN" optional><input className="input mono" inputMode="numeric" type="password" maxLength={6} value={appr} onChange={e => setAppr(e.target.value.replace(/\D/g, ''))} /></Field></div>
      <button className="btn btn-primary" style={{ alignSelf: 'flex-start' }} disabled={!login && !appr} onClick={savePins}>Change PINs</button></section>
    <section className="stack"><h3>Two-factor sign-in</h3>{REMOTE ? <TwoFactor /> : <p className="muted" style={{ fontSize: 14 }}>Authenticator-app codes protect the owner and manager accounts once the business runs on BorNiz cloud. This demo runs in one browser without accounts.</p>}</section>
    {pin.sheet}
  </div>;
}
function TwoFactor() {
  const [factors, setFactors] = useState<{ id: string; status: string }[] | null>(null), [enroll, setEnroll] = useState<{ id: string; qr: string; secret: string } | null>(null), [code, setCode] = useState('');
  const sb = async () => (await import('../data/backend.ts')).sb();
  const load = async () => { const { data } = await (await sb()).auth.mfa.listFactors(); setFactors((data?.totp ?? []).map(f => ({ id: f.id, status: f.status }))); };
  useEffect(() => { load().catch(() => setFactors([])); }, []);
  const start = async () => { const { data, error } = await (await sb()).auth.mfa.enroll({ factorType: 'totp' }); if (error) return toast(error.message); setEnroll({ id: data.id, qr: data.totp.uri, secret: data.totp.secret }); };
  const verify = async () => { const { error } = await (await sb()).auth.mfa.challengeAndVerify({ factorId: enroll!.id, code }); if (error) return toast(error.message); setEnroll(null); setCode(''); toast('Two-factor sign-in is on'); load(); };
  const on = factors?.some(f => f.status === 'verified');
  if (factors === null) return <span className="muted">Checking…</span>;
  return <div className="stack">
    <span><Badge tone={on ? 'success' : 'warning'} dot>{on ? 'On' : 'Off'}</Badge></span>
    {!on && !enroll && <button className="btn" style={{ alignSelf: 'flex-start' }} onClick={() => start().catch(e => toast(e.message))}>Turn on with an authenticator app</button>}
    {enroll && <div className="stack"><span style={{ background: 'var(--ink-0)', padding: 8, borderRadius: 'var(--radius-md)', alignSelf: 'flex-start' }}><QR value={enroll.qr} size={180} fg="var(--ink-950)" bg="var(--ink-0)" label="Scan with Google Authenticator, Authy or 1Password" /></span><span className="mono faint">{enroll.secret}</span>
      <div className="row"><input className="input mono" inputMode="numeric" maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} aria-label="6-digit code" /><button className="btn btn-primary" disabled={code.length !== 6} onClick={() => verify().catch(e => toast(e.message))}>Verify</button></div></div>}
    {on && <div className="row"><input className="input mono" inputMode="numeric" maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} aria-label="Current 6-digit code" placeholder="Current code" />
      <button className="btn btn-ghost" disabled={code.length !== 6} onClick={async () => {
        for (const f of factors ?? []) { const { error } = await (await sb()).auth.mfa.unenroll({ factorId: f.id, code }); if (error) return toast(error.message); }
        setCode(''); toast('Two-factor sign-in is off'); load(); }}>Turn off</button></div>}
  </div>;
}

// ── Receipt designer: exactly what the printer prints ──────────────────────────────────
export function ReceiptDesigner() {
  const { db, outletId } = useApp();
  const sample = db.orders.filter(o => o.outletId === outletId && o.paidAt).sort((a, b) => (b.paidAt ?? 0) - (a.paidAt ?? 0))[0];
  const printer = receiptPrinter(db, outletId, thisDevice(db));
  const [paper, setPaper] = useState<'58' | '80'>(printer ? paperOf(printer) : '80');
  if (!sample) return <Empty icon="receipt" title="No paid order yet">The preview uses the latest paid order at this outlet.</Empty>;
  const doc = receiptDoc(db, sample, paper);
  return <div className="row wrap" style={{ alignItems: 'flex-start', gap: 24 }}>
    <pre className="mono" style={{ margin: 0, padding: 16, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12, fontSize: 12, lineHeight: 1.45, maxWidth: '100%', overflowX: 'auto' }}>{toText(doc).join('\n')}</pre>
    <div className="stack" style={{ maxWidth: 360 }}>
      <div className="row" role="group" aria-label="Paper">{(['58', '80'] as const).map(p => <button key={p} className="chip" aria-pressed={paper === p} onClick={() => setPaper(p)}>{p} mm</button>)}</div>
      <p className="muted" style={{ fontSize: 14 }}>This is the receipt the printer prints, built from the same layout. Header: the business profile and the outlet (address, phone, NPWPD). Footer lines, Wi-Fi and the QR (digital receipt, rating or member card) come from the receipt design in Menu Studio and change when it is published.</p>
      <div className="row wrap"><button className="btn" onClick={() => browserPrint(doc).catch(e => toast(e.message))}><Icon name="printer" size={18} />Print a test</button>
        {printer && <button className="btn" onClick={() => printDoc(printer, doc).then(() => toast('Sent to ' + printer.name)).catch(e => toast(e.message))}>Print on {printer.name}</button>}</div>
    </div>
  </div>;
}

// ── Barcode & label printing ───────────────────────────────────────────────────────────
export function LabelPrinting() {
  const { db, outletId } = useApp();
  const [qty, setQty] = useState<Record<string, number>>({}), [q, setQ] = useState('');
  const printer = receiptPrinter(db, outletId, thisDevice(db));
  const list = db.products.filter(p => p.status === 'live' && (p.name + ' ' + p.sku).toLowerCase().includes(q.toLowerCase()));
  const price = (id: string) => db.outletProducts.find(x => x.productId === id && x.outletId === outletId)?.localPrice ?? db.products.find(p => p.id === id)!.basePrice;
  const total = Object.values(qty).reduce((a, n) => a + n, 0);
  const doc = (): Doc => ({ paper: printer ? paperOf(printer) : '58', ops: Object.entries(qty).flatMap(([id, n]) => { const p = db.products.find(x => x.id === id)!;
    return Array.from({ length: n }, (): Op[] => [{ t: 'text', s: p.name, align: 'center', bold: true }, { t: 'text', s: idr(price(id)), align: 'center', size: 'tall' }, { t: 'barcode', data: p.sku }, { t: 'feed', n: 1 }, { t: 'cut' }]).flat(); }) });
  return <div className="stack">
    <div className="row wrap"><input className="search grow" placeholder="Search product or SKU" value={q} onChange={e => setQ(e.target.value)} />
      <button className="btn btn-primary" disabled={!total} onClick={() => (printer ? printDoc(printer, doc()) : browserPrint(doc())).then(() => toast(`${total} labels sent`)).catch(e => toast(e.message))}><Icon name="printer" size={18} />Print {total || ''} labels</button></div>
    <span className="muted" style={{ fontSize: 13 }}>{printer ? `Prints on ${printer.name} (${paperOf(printer)} mm) with a CODE128 barcode of the SKU, which the register's scanner reads.` : 'No receipt printer here: labels open in the browser print dialog.'}</span>
    <div className="scroll-x"><table className="table"><thead><tr><th>Product</th><th>SKU</th><th className="r">Price here</th><th className="r">Labels</th></tr></thead>
      <tbody>{list.map(p => <tr key={p.id}><td>{p.name}</td><td className="mono">{p.sku}</td><td className="r num">{idr(price(p.id))}</td>
        <td className="r"><input className="input num" style={{ width: 80 }} inputMode="numeric" value={qty[p.id] ?? ''} placeholder="0" onChange={e => setQty({ ...qty, [p.id]: Math.min(99, Number(e.target.value.replace(/\D/g, '')) || 0) })} aria-label={`Labels for ${p.name}`} /></td></tr>)}</tbody></table></div>
  </div>;
}

// ── Referral program ───────────────────────────────────────────────────────────────────
export function Referral() {
  const { db, user } = useApp();
  const r = referral(db);
  const set = (id: string, v: boolean | number) => { setSetting(REFERRAL_PAGE + ':' + id, v, user.id); toast('Saved · applies on the QR menu now'); };
  const joined = db.ledger.filter(l => l.reason === 'Referral welcome');
  const sample = db.customers[0];
  return <div className="stack">
    <div className="row between" style={row}><span className="stack" style={{ gap: 2 }}><b>Invite a friend</b><span className="muted" style={{ fontSize: 13 }}>Members share their link; the friend joins on the QR menu</span></span><Toggle on={r.on} onChange={v => set('ref-on', v)} label="Invite a friend" /></div>
    <div className="row wrap"><Field label="Beans for the member who invites"><input className="input num" inputMode="numeric" defaultValue={r.referrer} onBlur={e => set('ref-referrer', Number(e.target.value.replace(/\D/g, '')) || 0)} /></Field>
      <Field label="Welcome beans for the friend"><input className="input num" inputMode="numeric" defaultValue={r.friend} onBlur={e => set('ref-friend', Number(e.target.value.replace(/\D/g, '')) || 0)} /></Field></div>
    {sample && <span className="muted" style={{ fontSize: 13 }}>Each member's link is on their member card, e.g. <span className="mono">{linkTo('/order?ref=' + sample.id)}</span>. Beans are given once, only to a new member.</span>}
    <span><b className="num">{joined.length}</b> friends joined so far</span>
  </div>;
}

// ── Outlets ────────────────────────────────────────────────────────────────────────────
const BLANK: Omit<Outlet, 'id'> = { name: '', city: '', serviceBps: 500, taxBps: 1000, taxInclusive: false, opens: '08:00', closes: '22:00', tables: 10, online: true };
export function Outlets() {
  const { db, user } = useApp();
  const [edit, setEdit] = useState<Outlet | 'new' | null>(null);
  return <div className="stack">
    {user.role === 'owner' && <button className="btn btn-primary" style={{ alignSelf: 'flex-start' }} onClick={() => setEdit('new')}><Icon name="plus" size={18} />Add outlet</button>}
    <div className="scroll-x"><table className="table"><thead><tr><th>Outlet</th><th>Address</th><th>Hours</th><th className="r">Tables</th><th className="r">Service · PB1</th><th>Online</th></tr></thead>
      <tbody>{db.outlets.map(o => <tr key={o.id} className="click" onClick={() => setEdit(o)}><td><b>{o.name}</b></td><td>{o.address || o.city}</td><td>{o.opens}–{o.closes}</td><td className="r num">{o.tables}</td><td className="r num">{o.serviceBps / 100}% · {o.taxBps / 100}%{o.taxInclusive ? ' incl.' : ''}</td><td>{o.online ? <Badge tone="success">On</Badge> : <Badge>Off</Badge>}</td></tr>)}</tbody></table></div>
    {edit && <OutletSheet o={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
  </div>;
}
export function OutletDetail() {
  const { db, outletId } = useApp();
  const id = useSearchParams().get('id') ?? outletId;
  const o = db.outlets.find(x => x.id === id);
  if (!o) return <Empty icon="store" title="Outlet not found" />;
  return <OutletForm o={o} />;
}
function OutletSheet({ o, onClose }: { o: Outlet | null; onClose: () => void }) {
  return <Sheet open onClose={onClose} title={o ? o.name : 'New outlet'}><OutletForm o={o} done={onClose} /></Sheet>;
}
function OutletForm({ o, done }: { o: Outlet | null; done?: () => void }) {
  const { user } = useApp();
  const [f, setF] = useState<Omit<Outlet, 'id'>>(o ?? BLANK);
  const can = user.role === 'owner' || user.role === 'manager';
  const T = (k: keyof Omit<Outlet, 'id'>, label: string, extra: Record<string, unknown> = {}) => <Field label={label}><input className="input" disabled={!can} value={String(f[k] ?? '')} {...extra} onChange={e => setF({ ...f, [k]: e.target.value })} /></Field>;
  const N = (k: 'serviceBps' | 'taxBps' | 'tables', label: string, div = 1) => <Field label={label}><input className="input num" disabled={!can} inputMode="decimal" value={f[k] / div} onChange={e => setF({ ...f, [k]: Math.round((Number(e.target.value.replace(',', '.')) || 0) * div) })} /></Field>;
  const save = () => {
    if (!f.name.trim()) return toast('Name the outlet');
    if (o) { patchOutlet(o.id, f, user.id); toast('Saved · every screen at this outlet updates'); } else { addOutlet(f, user.id); toast('Outlet added with the whole menu'); }
    done?.();
  };
  return <div className="stack">
    <div className="row wrap">{T('name', 'Name')}{T('city', 'City')}</div>
    {T('address', 'Address', { placeholder: 'Printed on receipts' })}
    <div className="row wrap">{T('phone', 'Phone', { inputMode: 'tel' })}{T('npwpd', 'NPWPD', { placeholder: 'Regional tax id for PB1' })}</div>
    <div className="row wrap">{T('opens', 'Opens', { type: 'time' })}{T('closes', 'Closes', { type: 'time' })}{f.floor?.length ? <Field label="Tables" hint="From the floor plan"><Link className="btn" href="/owner/outlets/tables-and-floor-plan">{f.floor.length} tables · edit plan</Link></Field> : N('tables', 'Tables')}</div>
    <div className="row wrap">{N('serviceBps', 'Service charge %', 100)}{N('taxBps', 'PB1 %', 100)}</div>
    <label className="row between"><span>Prices include PB1</span><Toggle on={f.taxInclusive} onChange={v => setF({ ...f, taxInclusive: v })} label="Prices include PB1" /></label>
    <label className="row between"><span>Open for online and QR orders</span><Toggle on={f.online} onChange={v => setF({ ...f, online: v })} label="Online orders" /></label>
    {can && <button className="btn btn-primary" style={{ alignSelf: 'flex-start' }} onClick={save}>{o ? 'Save outlet' : 'Add outlet'}</button>}
  </div>;
}

// ── Users & invites ────────────────────────────────────────────────────────────────────
const ROLES: Role[] = ['manager', 'pic', 'cashier', 'kitchen', 'waiter'];
export function Users() {
  const { db, user } = useApp();
  const [edit, setEdit] = useState<Employee | 'new' | null>(null);
  const mine = useMemo(() => db.employees.filter(e => user.role === 'owner' || e.outlets.some(o => db.employees.find(x => x.id === user.id)?.outlets.includes(o))), [db.employees, user]);
  return <div className="stack">
    <button className="btn btn-primary" style={{ alignSelf: 'flex-start' }} onClick={() => setEdit('new')}><Icon name="user-plus" size={18} />Add staff</button>
    <div className="scroll-x"><table className="table"><thead><tr><th>Name</th><th>Role</th><th>Outlets</th><th>WhatsApp</th><th>Status</th></tr></thead>
      <tbody>{mine.map(e => <tr key={e.id} className="click" onClick={() => setEdit(e)}><td><span className="row"><Avatar name={e.name} color={e.color} size={28} />{e.name}</span></td><td>{e.role}</td><td>{e.outlets.map(o => db.outlets.find(x => x.id === o)?.name).join(', ')}</td><td>{e.phone}</td><td>{e.active ? <Badge tone="success">Active</Badge> : <Badge>Off</Badge>}</td></tr>)}</tbody></table></div>
    <span className="muted" style={{ fontSize: 13 }}>{REMOTE ? 'Staff sign in on the outlet devices with their PIN. Owner and manager accounts sign up with their email and are linked here by the owner.' : 'Staff sign in on the outlet devices with their PIN.'} Making someone a manager needs the owner.</span>
    {edit && <UserSheet e={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
  </div>;
}
function UserSheet({ e, onClose }: { e: Employee | null; onClose: () => void }) {
  const { db, user } = useApp();
  const [f, setF] = useState<Employee>(e ?? { id: 'e' + Date.now().toString(36), name: '', role: 'cashier', outlets: [db.outlets[0].id], pin: '', approvalPin: '', phone: '', color: '#2F6FEB', active: true, wage: 0 });
  const [pin, setPin] = useState('');
  const save = () => {
    if (!f.name.trim()) return toast('Add a name');
    if (!e && !/^\d{4,6}$/.test(pin)) return toast('Set a 4 to 6 digit login PIN');
    if (pin && !/^\d{4,6}$/.test(pin)) return toast('Login PIN is 4 to 6 digits');
    const r = saveEmployee({ ...f, name: f.name.trim(), ...(pin ? { pin } : {}) }, user.id);
    toast(r ? 'Sent to the owner to approve' : 'Saved'); onClose();
  };
  return <Sheet open onClose={onClose} title={e ? e.name : 'Add staff'} footer={<button className="btn btn-primary" onClick={save}>Save</button>}>
    <div className="stack">
      <Field label="Name"><input className="input" value={f.name} onChange={x => setF({ ...f, name: x.target.value })} /></Field>
      <Field label="WhatsApp number"><input className="input" inputMode="tel" value={f.phone} onChange={x => setF({ ...f, phone: x.target.value })} /></Field>
      <Field label="Role"><select className="input" value={f.role} onChange={x => setF({ ...f, role: x.target.value as Role })}>{ROLES.map(r => <option key={r} value={r}>{r}</option>)}</select></Field>
      <Field label="Outlets"><div className="row wrap">{db.outlets.map(o => <button key={o.id} className="chip" aria-pressed={f.outlets.includes(o.id)} onClick={() => setF({ ...f, outlets: f.outlets.includes(o.id) ? f.outlets.filter(x => x !== o.id) : [...f.outlets, o.id] })}>{o.name}</button>)}</div></Field>
      <Field label={e ? 'Reset login PIN' : 'Login PIN'} optional={!!e}><input className="input mono" inputMode="numeric" type="password" maxLength={6} value={pin} onChange={x => setPin(x.target.value.replace(/\D/g, ''))} /></Field>
      <label className="row between"><span>Active</span><Toggle on={f.active} onChange={v => setF({ ...f, active: v })} label="Active" /></label>
    </div>
  </Sheet>;
}
