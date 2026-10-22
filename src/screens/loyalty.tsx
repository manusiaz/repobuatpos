'use client';
// Loyalty, owner tools (spec/BorNiz Loyalty.dc.html → Owner admin): program & members, rules, rewards catalog,
// points adjustment. Beans live in one append-only ledger; balance and tier are always derived (domain/loyalty.ts).
import { useMemo, useState } from 'react';
import Link from '../ui/Link.tsx';
import { useApp } from '../app/context.tsx';
import { Badge, Empty, Field, Icon, Kpi, Seg, Sheet, ago, dateShort, toast } from '../ui/kit.tsx';
import { usePin } from '../ui/PinSheet.tsx';
import { idr, idrShort } from '../domain/money.ts';
import { TIERS, balance, earn, tierOf, type LedgerRow, type Tier } from '../domain/loyalty.ts';
import { requestApproval, saveRecord, deleteRecord, setSetting } from '../data/actions.ts';
import { uid } from '../data/store.ts';
import { addRewards, adjustPoints, decidesPoints } from '../data/actions/loyalty.ts';
import type { Customer, DB, Rec } from '../data/schema.ts';
import { DAY } from './insight/metrics.ts';
import { myQueue, useDecide } from './insight/live.tsx';
import { useQuery } from './insight/query.ts';

const YEAR = 365 * DAY;
const BEANS_KEY = '/owner/customers/loyalty-program:beans-name';
const PROGRAM = '/owner/customers/loyalty-program', RULES = '/owner/more-studios-marketing/loyalty-rules-and-rewards-catalog', REWARDS = '/owner/customers/rewards-catalog', ADJUST = '/owner/customers/points-adjustment';
const CATS = [['drinks', 'Drinks'], ['food', 'Food'], ['voucher', 'Vouchers'], ['merch', 'Merch']] as const;
// Starter catalog from the prototype; added only when the owner asks for it.
const STARTER: [string, string, number, string, string][] = [['Free Americano', 'drinks', 150, 'silver', ''], ['Any drink, any size', 'drinks', 300, 'silver', ''], ['Croissant Almond', 'food', 200, 'silver', ''],
  ['Nasi Goreng Spesial', 'food', 420, 'silver', ''], ['IDR 50,000 voucher', 'voucher', 500, 'silver', ''], ['2-for-1 weekdays', 'voucher', 350, 'gold', '24'], ['Kopi Biru tumbler', 'merch', 900, 'gold', '24'], ['Home brew kit', 'merch', 1600, 'platinum', '10']];

export interface Reward { id: string; name: string; cat: string; cost: number; minTier: string; stock: number | null; at: number }
const toReward = (r: Rec): Reward => ({ id: r.id, name: r.a, cat: r.b, cost: Number(r.c) || 0, minTier: r.d || 'silver', stock: r.e === '' ? null : Number(r.e), at: r.at });
const tierById = (id: string) => TIERS.find(t => t.id === id) ?? TIERS[0];
const tierTone = (t: Tier) => (t.id === 'platinum' ? 'violet' : t.id === 'gold' ? 'warning' : 'neutral');
const lifetime = (rows: LedgerRow[], id: string, now = Date.now()) => rows.filter(r => r.customerId === id && r.points > 0 && now - r.at < YEAR).reduce((a, r) => a + r.points, 0);

export default function Screen() {
  const { page, db, user } = useApp();
  const view = page.slug === 'loyalty-program' ? 'program' : page.slug === 'rewards-catalog' ? 'rewards' : page.slug === 'points-adjustment' ? 'adjust' : 'rules';
  const rulesPath = view === 'rules' ? page.path : RULES;
  const beans = String(db.settings[BEANS_KEY] || 'Beans');
  const waiting = db.approvals.filter(a => a.type === 'points' && a.status === 'waiting').length;
  const tabs = [[PROGRAM, 'Program & members', 'program'], [rulesPath, 'Earning rules', 'rules'], [REWARDS, 'Rewards catalog', 'rewards'], [ADJUST, `Points adjustment${waiting ? ` · ${waiting}` : ''}`, 'adjust']] as const;
  return <div className="stack lg">
    <header className="stack sm">
      <div className="row wrap"><h1>Loyalty</h1><Badge tone={view === 'program' ? 'info' : 'success'}>{view === 'program' ? 'Members join at the POS, QR menu or app' : view === 'adjust' ? 'Owner approves' : 'Editable'}</Badge></div>
      <span className="muted" style={{ fontSize: 14 }}>Turn first visits into regulars. Every bean is a ledger row; balances and tiers are derived from it.</span>
      <nav className="seg" aria-label="Loyalty views" style={{ alignSelf: 'flex-start' }}>{tabs.map(([href, l, k]) => <Link key={k} href={href} aria-current={view === k ? 'page' : undefined}
        style={{ display: 'grid', placeItems: 'center', height: 34, padding: '0 12px', borderRadius: 9, fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap', textDecoration: 'none', color: view === k ? 'var(--fg-1)' : 'var(--fg-2)', background: view === k ? 'var(--bg-surface)' : 'transparent', boxShadow: view === k ? '0 1px 3px rgba(20,18,16,.15)' : 'none' }}>{l}</Link>)}</nav>
    </header>
    {view === 'program' && <Program db={db} beans={beans} />}
    {view === 'rules' && <Rules db={db} beans={beans} canEdit={user.role === 'owner'} by={user.id} />}
    {view === 'rewards' && <Rewards db={db} beans={beans} by={user.id} />}
    {view === 'adjust' && <Adjust db={db} beans={beans} />}
  </div>;
}

// ── Program & members ─────────────────────────────────────────────────────────────────────
function useMembers(db: DB) {
  return useMemo(() => {
    const now = Date.now(), visits = new Map<string, { n: number; last: number; spend: number }>();
    for (const o of db.orders) if (o.customerId && (o.status === 'paid' || o.status === 'part_refunded')) {
      const v = visits.get(o.customerId) ?? { n: 0, last: 0, spend: 0 }; v.n++; v.last = Math.max(v.last, o.paidAt ?? o.createdAt); v.spend += o.total; visits.set(o.customerId, v);
    }
    return db.customers.map(c => ({ c, bal: balance(db.ledger, c.id), tier: tierOf(db.ledger, c.id, now), life: lifetime(db.ledger, c.id, now), ...(visits.get(c.id) ?? { n: 0, last: 0, spend: 0 }) }));
  }, [db.orders, db.customers, db.ledger]);
}

function Program({ db, beans }: { db: DB; beans: string }) {
  const [q, setQ] = useQuery({ m: '' });
  const [search, setSearch] = useState('');
  const members = useMembers(db), now = Date.now();
  const active = members.filter(m => now - m.last < 30 * DAY).length, repeat = members.filter(m => m.n >= 2).length, buyers = members.filter(m => m.n >= 1).length;
  const outstanding = members.reduce((a, m) => a + Math.max(0, m.bal), 0);
  const redeemed30 = -db.ledger.filter(r => r.points < 0 && r.reason.startsWith('Redeem') && now - r.at < 30 * DAY).reduce((a, r) => a + r.points, 0);
  const newMonth = members.filter(m => now - m.c.joinedAt < 30 * DAY).length;
  const list = members.filter(m => !search || (m.c.name + ' ' + m.c.phone).toLowerCase().includes(search.toLowerCase())).sort((a, b) => b.bal - a.bal);
  const sel = members.find(m => m.c.id === q.m);
  return <>
    <section className="grid" style={{ ['--min' as string]: '180px' }}>
      <Kpi label="Members" value={members.length.toLocaleString('en-US')} delta={`+${newMonth} in 30 days`} tone={newMonth ? 'up' : undefined} />
      <Kpi label="Active (30 days)" value={active} delta={`${members.length ? Math.round((active / members.length) * 100) : 0}% of members`} />
      <Kpi label="Repeat rate" value={buyers ? Math.round((repeat / buyers) * 100) + '%' : '—'} delta="2+ visits, of members who bought" />
      <Kpi label={`${beans} outstanding`} value={outstanding.toLocaleString('en-US')} delta={`${redeemed30.toLocaleString('en-US')} redeemed in 30 days`} />
    </section>
    <section className="card stack" aria-label="Tiers">
      <div className="row between"><h3>Members by tier</h3><Link href={RULES} style={{ fontSize: 13 }}>Tier rules</Link></div>
      {TIERS.map(t => { const n = members.filter(m => m.tier.id === t.id).length; return <div key={t.id} className="row" style={{ fontSize: 14 }}>
        <span style={{ width: 90 }}><Badge tone={tierTone(t)}>{t.name}</Badge></span>
        <span className="grow" style={{ height: 8, borderRadius: 99, background: 'var(--bg-sunken)' }}><span style={{ display: 'block', height: '100%', borderRadius: 99, width: (members.length ? (n / members.length) * 100 : 0) + '%', background: 'var(--role)' }} /></span>
        <span className="num" style={{ width: 40, textAlign: 'right' }}>{n}</span></div>; })}
    </section>
    <section className="card flat" aria-label="Members">
      <div className="row wrap between" style={{ padding: '16px 20px', gap: 12 }}><h3>Members</h3><input className="search" style={{ maxWidth: 280 }} placeholder="Search name or phone" value={search} onChange={e => setSearch(e.target.value)} aria-label="Search members" /></div>
      {list.length === 0 ? <Empty icon="users" title="No members found">Members join at the POS, QR menu or loyalty app.</Empty> : <div className="scroll-x"><table className="table">
        <thead><tr><th>Member</th><th>Tier</th><th className="r">Balance</th><th className="r">Last 12 months</th><th className="r">Visits</th><th>Last visit</th></tr></thead>
        <tbody>{list.map(m => <tr key={m.c.id} className="click" tabIndex={0} onClick={() => setQ({ m: m.c.id })} onKeyDown={e => e.key === 'Enter' && setQ({ m: m.c.id })}>
          <td><b>{m.c.name}</b><br /><span className="faint mono" style={{ fontSize: 12 }}>{m.c.phone}</span></td>
          <td><Badge tone={tierTone(m.tier)}>{m.tier.name}</Badge></td>
          <td className="r num">{m.bal.toLocaleString('en-US')}</td><td className="r num">{m.life.toLocaleString('en-US')}</td><td className="r num">{m.n}</td>
          <td>{m.last ? ago(m.last) : <span className="faint">No visit yet</span>}</td>
        </tr>)}</tbody></table></div>}
    </section>
    <Sheet open={!!sel} onClose={() => setQ({ m: null })} title={sel?.c.name ?? ''} sub={sel ? `Member since ${dateShort(sel.c.joinedAt)} · ${sel.c.optIn ? 'WhatsApp opt-in' : 'No marketing messages'}` : ''}
      footer={sel && <Link className="btn btn-primary" href={`${ADJUST}?m=${sel.c.id}`}>Adjust {beans.toLowerCase()}</Link>}>
      {sel && <Member db={db} c={sel.c} beans={beans} visits={sel.n} spend={sel.spend} />}
    </Sheet>
  </>;
}

function Member({ db, c, beans, visits, spend }: { db: DB; c: Customer; beans: string; visits: number; spend: number }) {
  const rows = db.ledger.filter(r => r.customerId === c.id).sort((a, b) => b.at - a.at);
  const bal = balance(db.ledger, c.id), tier = tierOf(db.ledger, c.id), life = lifetime(db.ledger, c.id);
  const next = TIERS[TIERS.indexOf(tier) + 1];
  const now = Date.now(), expiring = rows.filter(r => r.points > 0 && now - r.at > YEAR - 14 * DAY && now - r.at < YEAR).reduce((a, r) => a + r.points, 0);
  const rewards = (db.records.reward ?? []).map(toReward).sort((a, b) => a.cost - b.cost).slice(0, 4);
  return <div className="stack lg">
    <MemberCard db={db} name={c.name} bal={bal} tier={tier} life={life} beans={beans} />
    {expiring > 0 && <div className="banner b-warning"><Icon name="hourglass" size={18} />{expiring.toLocaleString('en-US')} {beans.toLowerCase()} expire within 14 days. The member gets a WhatsApp reminder.</div>}
    {next ? <span className="muted" style={{ fontSize: 14 }}>{(next.min - life).toLocaleString('en-US')} {beans.toLowerCase()} to {next.name} · earns {tier.multiplier}× now</span> : <span className="muted" style={{ fontSize: 14 }}>Top tier · earns {tier.multiplier}×</span>}
    <div className="grid" style={{ ['--min' as string]: '120px', gap: 10 }}>{[['Balance', bal.toLocaleString('en-US')], ['Last 12 months', life.toLocaleString('en-US')], ['Visits', visits], ['Spend', idrShort(spend)]].map(([l, v]) => <div key={l as string} className="sunken" style={{ padding: 12 }}><span className="muted" style={{ fontSize: 12 }}>{l}</span><br /><b className="num">{v}</b></div>)}</div>
    {rewards.length > 0 && <div className="stack sm"><span className="cap">Rewards for this member</span>{rewards.map(r => { const locked = TIERS.indexOf(tier) < TIERS.indexOf(tierById(r.minTier)), ok = !locked && bal >= r.cost;
      return <div key={r.id} className="row between" style={{ fontSize: 14 }}><span className="grow">{r.name}</span><span className="num faint">{r.cost}</span>{locked ? <Badge>{tierById(r.minTier).name} only</Badge> : ok ? <Badge tone="success">Ready</Badge> : <Badge>Need {r.cost - bal}</Badge>}</div>; })}</div>}
    <div className="stack sm"><span className="cap">Ledger · newest first</span>
      {rows.length === 0 && <p className="muted">No ledger rows yet.</p>}
      {rows.map((r, i) => <div key={i} className="row between" style={{ fontSize: 14, borderTop: i ? '1px solid var(--border)' : 0, paddingTop: i ? 8 : 0 }}>
        <span className="grow">{r.reason}<br /><span className="faint" style={{ fontSize: 12 }}>{dateShort(r.at)} · {ago(r.at)}</span></span>
        <b className="num" style={{ color: r.points > 0 ? 'var(--success-fg)' : r.points < 0 ? 'var(--danger-fg)' : 'var(--fg-2)' }}>{r.points > 0 ? '+' : ''}{r.points.toLocaleString('en-US')}</b></div>)}
    </div>
  </div>;
}

/** Member card in the merchant's theme (Menu Studio → db.theme), as guests see it in the loyalty app. */
export function MemberCard({ db, name, bal, tier, life, beans }: { db: DB; name: string; bal: number; tier: Tier; life: number; beans: string }) {
  const t = db.theme, next = TIERS[TIERS.indexOf(tier) + 1];
  const prog = next ? Math.min(100, ((life - tier.min) / (next.min - tier.min)) * 100) : 100;
  return <div data-guest style={{ ['--bn-p' as string]: t.p, ['--bn-acc' as string]: t.acc, ['--bn-ink' as string]: t.ink, ['--bn-paper' as string]: t.paper, background: 'var(--bn-p)', color: 'var(--bn-paper)', borderRadius: 'var(--radius-lg)', padding: 20, aspectRatio: '1.6', maxWidth: 380, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', boxShadow: 'var(--shadow-e2)', fontFamily: 'var(--bn-font)' }} aria-label="Member card preview">
    <div className="row between"><b style={{ fontSize: 18 }}>{db.tenant.name}</b><span style={{ background: 'var(--bn-acc)', color: 'var(--bn-ink)', borderRadius: 99, padding: '3px 10px', fontSize: 12, fontWeight: 700 }}>{tier.name}</span></div>
    <div><span style={{ fontSize: 12, opacity: .8 }}>{beans}</span><br /><b style={{ fontSize: 34, letterSpacing: '-.02em' }}>{bal.toLocaleString('en-US')}</b></div>
    <div className="stack sm" style={{ gap: 6 }}>
      <span style={{ height: 6, borderRadius: 99, background: 'color-mix(in srgb,var(--bn-paper) 25%,transparent)' }}><span style={{ display: 'block', height: '100%', width: prog + '%', borderRadius: 99, background: 'var(--bn-acc)' }} /></span>
      <div className="row between" style={{ fontSize: 13 }}><span>{name}</span><span style={{ opacity: .8 }}>{next ? `${(next.min - life).toLocaleString('en-US')} to ${next.name}` : 'Top tier'}</span></div>
    </div>
  </div>;
}

// ── Rules ─────────────────────────────────────────────────────────────────────────────────
function Rules({ db, beans, canEdit, by }: { db: DB; beans: string; canEdit: boolean; by: string }) {
  const [name, setName] = useState(beans);
  const members = useMembers(db), rewards = (db.records.reward ?? []).map(toReward);
  const ex = 85_000;
  return <>
    <section className="grid" style={{ ['--min' as string]: '300px', alignItems: 'start' }}>
      <div className="card stack">
        <h3>Base earning</h3>
        <p className="muted" style={{ fontSize: 14 }}>1 {beans.toLowerCase().replace(/s$/, '')} for every IDR 1,000 paid, after discounts and before tax and service, multiplied by tier. Credited when the order is paid; a refund reverses it.</p>
        <div className="sunken stack sm" style={{ fontSize: 14 }}><span className="cap">Example · order {idr(ex)}</span>{TIERS.map(t => <div key={t.id} className="row between"><span>{t.name} · {t.multiplier}×</span><b className="num">+{earn(ex, t)}</b></div>)}</div>
        <span className="faint" style={{ fontSize: 12 }}>Calculated on the server at payment, the same for POS, QR menu, kiosk and delivery.</span>
      </div>
      <div className="card stack">
        <h3>Expiry & reminders</h3>
        <p className="muted" style={{ fontSize: 14 }}>{beans} expire 12 months after they’re earned. Members get a WhatsApp reminder 14 days before, if they opted in. Balances never go below zero; a redeem that would is blocked.</p>
        <Field label="Name of your points" hint="Shown on the member card, receipts and QR menu">
          <input className="input" value={name} disabled={!canEdit} onChange={e => setName(e.target.value)} maxLength={20} />
        </Field>
        {canEdit ? <button className="btn btn-primary" style={{ alignSelf: 'flex-start' }} disabled={!name.trim() || name.trim() === beans} onClick={() => { setSetting(BEANS_KEY, name.trim(), by); toast('Saved · ' + name.trim()); }}>Save name</button>
          : <span className="faint" style={{ fontSize: 13 }}>The owner changes program rules.</span>}
      </div>
    </section>
    <section className="card flat" aria-label="Tiers">
      <div className="row between" style={{ padding: '16px 20px' }}><h3>Tiers</h3><span className="faint" style={{ fontSize: 13 }}>From {beans.toLowerCase()} earned in the last 12 months</span></div>
      <div className="scroll-x"><table className="table"><thead><tr><th>Tier</th><th className="r">From</th><th className="r">Earn rate</th><th className="r">Members</th></tr></thead>
        <tbody>{TIERS.map(t => <tr key={t.id}><td><Badge tone={tierTone(t)}>{t.name}</Badge></td><td className="r num">{t.min ? t.min.toLocaleString('en-US') : 'First visit'}</td><td className="r num">{t.multiplier}×</td><td className="r num">{members.filter(m => m.tier.id === t.id).length}</td></tr>)}</tbody></table></div>
    </section>
    <section className="card stack" aria-label="Rewards">
      <div className="row between"><h3>Rewards catalog</h3><Link href={REWARDS} className="btn btn-sm">Edit catalog</Link></div>
      {rewards.length === 0 ? <p className="muted">No rewards yet. Members collect {beans.toLowerCase()} but have nothing to spend them on.</p>
        : <div className="row wrap">{rewards.sort((a, b) => a.cost - b.cost).map(r => <span key={r.id} className="chip row" style={{ cursor: 'default' }}>{r.name}<span className="faint num">{r.cost}</span></span>)}</div>}
    </section>
    <section className="card stack">
      <h3>Member card preview</h3>
      <span className="muted" style={{ fontSize: 14 }}>In your brand colors from Menu Studio. Change them there.</span>
      {members[0] ? <MemberCard db={db} name={members[0].c.name} bal={members[0].bal} tier={members[0].tier} life={members[0].life} beans={beans} /> : <p className="muted">Shows once the first member joins.</p>}
    </section>
  </>;
}

// ── Rewards catalog ───────────────────────────────────────────────────────────────────────
function Rewards({ db, beans, by }: { db: DB; beans: string; by: string }) {
  const [cat, setCat] = useState<string>('all');
  const [edit, setEdit] = useState<Reward | null>(null);
  const all = (db.records.reward ?? []).map(toReward);
  const list = all.filter(r => cat === 'all' || r.cat === cat).sort((a, b) => a.cost - b.cost);
  const redeemed = (r: Reward) => db.ledger.filter(l => l.points < 0 && l.reason === 'Redeem · ' + r.name).length;
  const blank: Reward = { id: '', name: '', cat: 'drinks', cost: 200, minTier: 'silver', stock: null, at: 0 };
  return <>
    <div className="row wrap between">
      <Seg label="Category" value={cat} onChange={setCat} options={[['all', 'All'], ...CATS]} />
      <button className="btn btn-primary" onClick={() => setEdit(blank)}><Icon name="plus" size={18} />New reward</button>
    </div>
    {all.length === 0 ? <div className="card"><Empty icon="gift" title="No rewards yet" action={<div className="row wrap" style={{ justifyContent: 'center' }}>
      <button className="btn btn-primary" onClick={() => { addRewards(STARTER.map(([a, b, c, d, e], i) => ({ id: uid('rw'), a, b, c: String(c), d, e, at: Date.now() - i })), by); toast(`Added ${STARTER.length} starter rewards`); }}>Add starter rewards</button>
      <button className="btn" onClick={() => setEdit(blank)}>Start from scratch</button></div>}>Rewards give members a reason to come back. Start with a free drink at 150 {beans.toLowerCase()}.</Empty></div>
      : list.length === 0 ? <Empty icon="gift" title="Nothing in this category" />
      : <div className="grid" style={{ ['--min' as string]: '240px' }}>{list.map(r => { const t = tierById(r.minTier);
        return <section key={r.id} className="card stack sm">
          <div className="row between"><Badge>{CATS.find(c => c[0] === r.cat)?.[1] ?? r.cat}</Badge>{t.id !== 'silver' && <Badge tone={tierTone(t)}><Icon name="lock" size={12} />{t.name}+</Badge>}</div>
          <b style={{ fontSize: 16 }}>{r.name}</b>
          <span className="num" style={{ fontSize: 22 }}>{r.cost.toLocaleString('en-US')} <span className="muted" style={{ fontSize: 13, fontWeight: 500 }}>{beans.toLowerCase()}</span></span>
          <span className="muted" style={{ fontSize: 13 }}>{r.stock == null ? 'Unlimited' : r.stock > 0 ? `${r.stock} left` : 'Out of stock'} · {redeemed(r)} redeemed</span>
          <div className="row"><button className="btn btn-sm" onClick={() => setEdit(r)}>Edit</button></div>
        </section>; })}</div>}
    {edit && <RewardSheet r={edit} by={by} beans={beans} onClose={() => setEdit(null)} />}
  </>;
}

function RewardSheet({ r, by, beans, onClose }: { r: Reward; by: string; beans: string; onClose: () => void }) {
  const [f, setF] = useState({ name: r.name, cat: r.cat, cost: String(r.cost), minTier: r.minTier, stock: r.stock == null ? '' : String(r.stock) });
  const cost = Number(f.cost), err = !f.name.trim() ? 'Give it a name' : !(cost > 0 && Number.isInteger(cost)) ? 'Cost must be a whole number above 0' : f.stock !== '' && !(Number(f.stock) >= 0) ? 'Stock must be 0 or more, or empty' : '';
  const save = () => { saveRecord('reward', { id: r.id || uid('rw'), a: f.name.trim(), b: f.cat, c: String(cost), d: f.minTier, e: f.stock.trim(), at: r.at || Date.now() }, by); toast(r.id ? 'Reward updated' : 'Reward added'); onClose(); };
  return <Sheet open onClose={onClose} title={r.id ? 'Edit reward' : 'New reward'} sub="Members see it in the loyalty app and the cashier can redeem it at the POS."
    footer={<>{r.id && <button className="btn btn-danger" onClick={() => { deleteRecord('reward', r.id, by); toast('Reward removed'); onClose(); }}>Remove</button>}<span className="grow" /><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={!!err} onClick={save}>{r.id ? 'Save' : 'Add reward'}</button></>}>
    <div className="stack">
      <Field label="Name"><input className="input" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} maxLength={40} autoFocus /></Field>
      <Field label="Category"><Seg label="Category" value={f.cat} onChange={v => setF({ ...f, cat: v })} options={CATS} /></Field>
      <Field label={`Cost in ${beans.toLowerCase()}`} error={err && f.name.trim() ? err : undefined}><input className="input" inputMode="numeric" value={f.cost} onChange={e => setF({ ...f, cost: e.target.value.replace(/\D/g, '') })} /></Field>
      <Field label="Lowest tier" hint="Higher tiers stay visible to others, with a lock"><Seg label="Lowest tier" value={f.minTier} onChange={v => setF({ ...f, minTier: v })} options={TIERS.map(t => [t.id, t.name] as const)} /></Field>
      <Field label="Stock" optional hint="Empty = unlimited"><input className="input" inputMode="numeric" value={f.stock} onChange={e => setF({ ...f, stock: e.target.value.replace(/\D/g, '') })} /></Field>
    </div>
  </Sheet>;
}

// ── Points adjustment ─────────────────────────────────────────────────────────────────────
function Adjust({ db, beans }: { db: DB; beans: string }) {
  const { user, me, outletId } = useApp();
  const [q, setQ] = useQuery({ m: '' });
  const [dir, setDir] = useState<'add' | 'remove'>('add'), [n, setN] = useState(''), [reason, setReason] = useState('');
  const pin = usePin(), dec = useDecide();
  const direct = decidesPoints(user.role);
  const c = db.customers.find(x => x.id === q.m), bal = c ? balance(db.ledger, c.id) : 0;
  const pts = (dir === 'add' ? 1 : -1) * (Number(n) || 0);
  const err = !c ? '' : !pts ? '' : bal + pts < 0 ? `Balance is ${bal.toLocaleString('en-US')}; it can’t go below zero.` : '';
  const ready = !!c && pts !== 0 && !err && reason.trim().length >= 3;
  const waiting = db.approvals.filter(a => a.type === 'points' && a.status === 'waiting');
  const decidable = new Set(myQueue(db, user).map(a => a.id));
  const history = db.ledger.filter(r => r.reason.startsWith('Adjustment')).sort((a, b) => b.at - a.at).slice(0, 30);
  const reset = () => { setN(''); setReason(''); };
  const submit = () => {
    if (!c) return;
    const title = `${pts > 0 ? '+' : ''}${pts.toLocaleString('en-US')} ${beans.toLowerCase()} · ${c.name}`;
    if (direct) pin.ask({ title, verb: 'Apply adjustment', onOk: approver => { const e = adjustPoints(c.id, pts, reason.trim(), approver); toast(e ?? 'Applied · ' + title); if (!e) reset(); } });
    else { requestApproval({ type: 'points', title, requestedBy: user.id, outletId: me?.outlets.includes(outletId) ? outletId : me?.outlets[0] ?? outletId, subjectId: c.id, note: reason.trim(), payload: { customerId: c.id, points: pts } }); toast('Sent to owner · ' + title); reset(); }
  };
  return <>
    <section className="grid" style={{ ['--min' as string]: '320px', alignItems: 'start' }}>
      <div className="card stack">
        <h3>{direct ? 'Adjust a balance' : 'Request an adjustment'}</h3>
        <span className="muted" style={{ fontSize: 14 }}>{direct ? 'Applies right away after your approval PIN. Logged in the ledger and audit log.' : 'Goes to the owner to approve. The member’s balance changes only after that.'}</span>
        <Field label="Member"><select className="input" value={q.m} onChange={e => setQ({ m: e.target.value || null })}>
          <option value="">Choose a member</option>{db.customers.map(x => <option key={x.id} value={x.id}>{x.name} · {x.phone}</option>)}</select></Field>
        {c && <span className="muted" style={{ fontSize: 14 }}>Balance now <b className="num" style={{ color: 'var(--fg-1)' }}>{bal.toLocaleString('en-US')}</b> · {tierOf(db.ledger, c.id).name}</span>}
        <Seg label="Direction" value={dir} onChange={setDir} options={[['add', `Add ${beans.toLowerCase()}`], ['remove', `Remove ${beans.toLowerCase()}`]]} />
        <Field label="Amount" error={err || undefined}><input className={'input' + (err ? ' bad' : '')} inputMode="numeric" value={n} placeholder="0" onChange={e => setN(e.target.value.replace(/\D/g, '').slice(0, 6))} /></Field>
        <Field label="Reason" hint="The member sees it in their history"><input className="input" value={reason} onChange={e => setReason(e.target.value)} placeholder="Missed scan on order #2041" maxLength={80} /></Field>
        <button className="btn btn-primary btn-lg" disabled={!ready} onClick={submit}>{direct ? 'Apply adjustment' : 'Send to owner'}</button>
      </div>
      <div className="card stack">
        <div className="row between"><h3>Waiting for approval</h3><Badge tone={waiting.length ? 'warning' : 'success'}>{waiting.length}</Badge></div>
        {waiting.length === 0 && <p className="muted">No requests waiting.</p>}
        {waiting.map(a => { const can = decidable.has(a.id); return <div key={a.id} className="sunken stack sm">
          <b>{a.title}</b><span className="muted" style={{ fontSize: 13 }}>{db.employees.find(e => e.id === a.requestedBy)?.name} · {ago(a.at)} · {a.note}</span>
          {can ? <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn btn-sm btn-danger" onClick={() => dec.ask(a, false)}>Reject</button><button className="btn btn-sm btn-primary" onClick={() => dec.ask(a, true)}>Apply {beans.toLowerCase()}</button></div>
            : <span className="faint" style={{ fontSize: 12 }}>{a.requestedBy === user.id ? 'Your request · the owner decides' : 'The owner decides'}</span>}
        </div>; })}
      </div>
    </section>
    <section className="card flat" aria-label="Adjustment history">
      <div className="row between" style={{ padding: '16px 20px' }}><h3>Adjustment history</h3><span className="faint" style={{ fontSize: 13 }}>Ledger rows · never edited</span></div>
      {history.length === 0 ? <Empty icon="rotate-ccw-clock" title="No adjustments yet" /> : <div className="scroll-x"><table className="table">
        <thead><tr><th>When</th><th>Member</th><th>Reason</th><th className="r">{beans}</th></tr></thead>
        <tbody>{history.map((r, i) => <tr key={i}><td>{dateShort(r.at)} · {ago(r.at)}</td><td>{db.customers.find(x => x.id === r.customerId)?.name}</td><td>{r.reason.replace(/^Adjustment · /, '')}</td><td className="r num" style={{ color: r.points > 0 ? 'var(--success-fg)' : 'var(--danger-fg)' }}>{r.points > 0 ? '+' : ''}{r.points.toLocaleString('en-US')}</td></tr>)}</tbody></table></div>}
    </section>
    {pin.sheet}{dec.sheet}
  </>;
}
