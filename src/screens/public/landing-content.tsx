'use client';
// Content pages: blog, FAQ, help center, about, careers and the legal pages.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import Link from '../../ui/Link.tsx';
import { PAGES } from '../../system/registry.ts';
import { Badge, Icon, Empty } from '../../ui/kit.tsx';
import { Cards, Cta, H2, PageHead, Prose, Toc, Wrap } from './landing-ui.tsx';

// ── Blog ────────────────────────────────────────────────────────────────────────────────
interface Post { slug: string; title: string; tag: string; date: string; mins: number; lead: string; body: [string, string][] }
export const POSTS: Post[] = [
  { slug: 'close-the-day-in-5-minutes', title: 'Close the day in 5 minutes with a blind cash count', tag: 'Operations', date: '2 Oct 2026', mins: 5, lead: 'Why cashiers shouldn’t see the expected amount, and how the PIC signs small differences on the spot.',
    body: [['The problem with “expected” amounts', 'When the register shows how much cash should be in the drawer, people count toward that number. Shortfalls get hidden and surprises show up days later in the owner’s spreadsheet.'], ['Count first, compare after', 'In BorNiz the cashier counts notes and coins without seeing the expected total. Only after submitting does the register show the variance.'], ['Who signs', 'Differences up to IDR 50,000 are signed by the shift PIC with their approval PIN. Bigger ones go to the manager, then to the owner above IDR 500,000. Nobody signs their own count.'], ['What the owner sees', 'Every close lands on the owner dashboard with both names, the variance and a note. Patterns per cashier are visible in the shift report.']] },
  { slug: 'qris-at-peak-hour', title: 'QRIS at peak hour: never ask a guest to pay twice', tag: 'Payments', date: '24 Sep 2026', mins: 4, lead: 'The paid state only comes from the gateway, the code expires in 5 minutes, and pending payments confirm by themselves.',
    body: [['Paid means the bank said so', 'A QRIS payment is only marked paid when the gateway webhook confirms it. A screenshot on the guest’s phone is not a confirmation.'], ['Codes expire', 'Each QR code works for 5 minutes. After that the register offers a new code with one tap; the cart and table stay.'], ['When the gateway is slow', 'Pending payments are kept. If the gateway answers late, the order settles by itself. The cashier can take cash or card in the meantime without creating a duplicate.']] },
  { slug: 'one-pic-per-shift', title: 'One PIC per shift: fewer calls to the manager', tag: 'Teams', date: '11 Sep 2026', mins: 6, lead: 'Give your shift lead clear limits and most voids, discounts and small refunds never reach the manager’s phone.',
    body: [['Limits, not trust', 'A PIC can approve discounts up to 20%, voids and refunds up to IDR 100,000 and cash differences up to IDR 50,000. Everything above goes up the chain automatically.'], ['Exactly one PIC', 'The roster allows one PIC per shift, so there is never confusion about who decides. Hand-offs need the PIC’s PIN.'], ['Escalation', 'If the PIC doesn’t answer in 5 minutes, the request moves to the manager; after 30 minutes, to the owner.']] },
  { slug: 'delivery-without-chaos', title: 'Delivery apps without kitchen chaos', tag: 'Kitchen', date: '29 Aug 2026', mins: 5, lead: 'Separate lanes, calculated ready-by times and busy mode keep delivery from overrunning dine-in.',
    body: [['Two lanes', 'Dine-in and QR tickets sit in one lane, delivery and pickup in another, sorted rush first and then by ready-by.'], ['Ready-by is calculated', 'Nobody types a ready time. It comes from the tier, the channel’s prep time and how busy the kitchen is.'], ['Busy mode', 'When the kitchen is slammed the PIC turns on busy mode for up to 30 minutes; new delivery orders get extra prep time instead of the channel switching off for the night.']] },
];
const postSlug = () => { try { return new URLSearchParams(location.search).get('a'); } catch { return null; } };

export function Blog() {
  const [tag, setTag] = useState<string | null>(null);
  const tags = [...new Set(POSTS.map(p => p.tag))];
  const list = POSTS.filter(p => !tag || p.tag === tag);
  return <Wrap><div className="stack lg">
    <PageHead kicker="Blog & resources" title="Run a better outlet" sub="Practical guides for owners, managers and shift leads, written from how BorNiz outlets actually work." />
    <div className="row wrap"><button className="chip" aria-pressed={!tag} onClick={() => setTag(null)}>All</button>{tags.map(t => <button key={t} className="chip" aria-pressed={tag === t} onClick={() => setTag(t)}>{t}</button>)}</div>
    <div className="grid" style={{ ['--min' as string]: '280px', gap: 12 }}>{list.map(p => <Link key={p.slug} href={'/blog-article?a=' + p.slug} className="card stack" style={{ color: 'var(--fg-1)', textDecoration: 'none' }}>
      <div className="row between"><Badge tone="accent">{p.tag}</Badge><span className="faint" style={{ fontSize: 13 }}>{p.mins} min read</span></div>
      <b style={{ fontSize: 20, lineHeight: 1.2 }}>{p.title}</b><span className="muted" style={{ fontSize: 14 }}>{p.lead}</span><span className="faint" style={{ fontSize: 13, marginTop: 'auto' }}>{p.date}</span></Link>)}</div>
    <Cards min={240} items={[{ t: 'Help center', d: 'Step-by-step tutorials for every screen.', icon: 'life-buoy', href: '/help-center-and-tutorials' }, { t: 'API docs', d: 'Events, tables and webhooks.', icon: 'code', href: '/developer-api-docs' }, { t: 'Case studies', d: 'Numbers from outlets on BorNiz.', icon: 'chart-column', href: '/case-studies-and-testimonials' }]} />
  </div></Wrap>;
}

export function Article() {
  const [slug, setSlug] = useState<string | null>(null);
  useEffect(() => setSlug(postSlug()), []);
  const p = POSTS.find(x => x.slug === slug) ?? POSTS[0];
  const more = POSTS.filter(x => x.slug !== p.slug).slice(0, 2);
  return <><Wrap as="article"><div className="stack lg" style={{ maxWidth: 760, margin: '0 auto' }}>
    <Link href="/blog-resources" className="row" style={{ fontSize: 14 }}><Icon name="arrow-left" size={16} />All articles</Link>
    <div className="row wrap"><Badge tone="accent">{p.tag}</Badge><span className="faint" style={{ fontSize: 13 }}>{p.date} · {p.mins} min read</span></div>
    <h1 style={{ fontSize: 'clamp(34px,4.4vw,52px)', letterSpacing: '-.04em', lineHeight: 1.05 }}>{p.title}</h1>
    <p style={{ fontSize: 20, lineHeight: 1.5, color: 'var(--fg-2)' }}>{p.lead}</p>
    <Prose>{p.body.map(([h, t]) => <section key={h} className="stack sm"><h2>{h}</h2><p>{t}</p></section>)}</Prose>
    <div className="stack"><h3>Read next</h3>{more.map(m => <Link key={m.slug} href={'/blog-article?a=' + m.slug} onClick={() => setSlug(m.slug)} className="card row" style={{ color: 'var(--fg-1)', textDecoration: 'none' }}><span className="grow"><b>{m.title}</b><br /><span className="faint" style={{ fontSize: 13 }}>{m.tag} · {m.mins} min</span></span><Icon name="arrow-right" /></Link>)}</div>
  </div></Wrap><Cta /></>;
}

// ── FAQ & help ──────────────────────────────────────────────────────────────────────────
export const FAQS: [string, [string, string][]][] = [
  ['Getting started', [['How long does setup take?', 'About 5 minutes: verify your WhatsApp, name your business and outlet, pick a tax setting and start from the F&B template or import a CSV. Every step can be skipped and changed later.'], ['Do I need a card to start?', 'No. The Free plan and the 14-day Basic and Pro trials need no card.'], ['Which devices do I need?', 'Any 10" Android tablet or iPad for the register. Printers, EDC, kitchen screens and customer displays are optional.']]],
  ['Payments', [['Which payment methods work?', 'QRIS, cash, debit and credit card (EDC), e-wallets, virtual accounts and split bills, all on one register.'], ['When is a QRIS payment marked paid?', 'Only when the payment gateway confirms it. Codes expire after 5 minutes and pending payments confirm by themselves.'], ['What if the internet drops?', 'Selling continues. Sales are saved on the tablet and sync when you’re back online, without duplicates.']]],
  ['Team & control', [['Who can approve voids and refunds?', 'The shift PIC within limits (void/refund up to IDR 100,000, discount up to 20%), then the manager, then the owner above IDR 500,000. Every approval asks for a 6-digit approval PIN.'], ['Can a manager change prices?', 'A manager can propose; price changes, publishing and payroll wait for the owner’s OK.'], ['Can I change what each role can do?', 'Yes. The roles & permissions matrix lets the owner set each action per role and per outlet.']]],
  ['Billing', [['How is BorNiz priced?', 'Per outlet per month: Free, Basic IDR 149,000, Pro IDR 349,000 and Enterprise on request. Yearly billing gives 2 months free. Prices exclude PPN.'], ['Can I cancel any time?', 'Yes. Your plan runs to the end of the paid period. See the refund policy for details.']]],
];
export function Faq() {
  const [q, setQ] = useState('');
  const ql = q.toLowerCase();
  const groups = FAQS.map(([g, l]) => [g, l.filter(([a, b]) => !ql || (a + b).toLowerCase().includes(ql))] as const).filter(([, l]) => l.length);
  return <><Wrap><div className="stack lg" style={{ maxWidth: 820 }}>
    <PageHead kicker="FAQ" title="Questions, answered" />
    <input className="search" style={{ height: 48 }} placeholder="Search questions" value={q} onChange={e => setQ(e.target.value)} aria-label="Search questions" />
    {groups.map(([g, l]) => <div key={g} className="stack sm"><h3>{g}</h3>{l.map(([a, b]) => <details key={a} className="card tight"><summary style={{ cursor: 'pointer', fontWeight: 600, minHeight: 28 }}>{a}</summary><p className="muted" style={{ marginTop: 8, lineHeight: 1.6 }}>{b}</p></details>)}</div>)}
    {!groups.length && <Empty icon="search-x" title="No question matches">Try another word, or <Link href="/contact-sales-book-a-demo">ask us on WhatsApp</Link>.</Empty>}
  </div></Wrap></>;
}

const TUTORIALS: [string, string, string, string][] = [
  ['Ring up your first sale', 'Pick a product, choose options, charge by QRIS or cash.', 'shopping-bag', '/pos/selling/register-order'],
  ['Pair a register', 'Type the 6-digit code from Owner › Devices on the tablet.', 'tablet-smartphone', '/account/choose-register'],
  ['Close the day', 'Blind drawer count, variance sign-off, X report.', 'banknote', '/pos/shift-change/blind-drawer-count'],
  ['Mark an item sold out', '86 it once on the kitchen display; it disappears everywhere.', 'ban', '/kds/mark-items-out-of-stock'],
  ['Count stock', 'Blind count per area, photo for each difference, someone else signs.', 'clipboard-check', '/owner/inventory/stock-opname'],
  ['Set who can do what', 'Roles & permissions per outlet, signed with your approval PIN.', 'shield-check', '/owner/team/roles-and-permissions-matrix'],
  ['Import your menu', 'CSV with name, price, category and SKU.', 'file-up', '/owner/catalog/import-products'],
  ['Turn on QR ordering', 'Print table QR codes and guests order from their phone.', 'qr-code', '/order/qr-menu/menu-home'],
];
export function Help() {
  const [q, setQ] = useState('');
  const ql = q.trim().toLowerCase();
  const pages = useMemo(() => ql.length < 2 ? [] : PAGES.filter(p => (p.name + ' ' + p.group + ' ' + p.area).toLowerCase().includes(ql)).slice(0, 8), [ql]);
  const faqs = ql.length < 2 ? [] : FAQS.flatMap(([, l]) => l).filter(([a, b]) => (a + b).toLowerCase().includes(ql)).slice(0, 4);
  const tuts = TUTORIALS.filter(t => !ql || (t[0] + t[1]).toLowerCase().includes(ql));
  return <Wrap><div className="stack lg">
    <PageHead kicker="Help center" title="How can we help?" sub="Search tutorials, answers and every screen in BorNiz." >
      <input className="search" style={{ height: 52, maxWidth: 640, fontSize: 16 }} placeholder="Try “QRIS”, “opname” or “refund”" value={q} onChange={e => setQ(e.target.value)} aria-label="Search help" />
    </PageHead>
    {pages.length > 0 && <div className="stack sm"><h3>Screens</h3><div className="grid" style={{ ['--min' as string]: '260px', gap: 8 }}>{pages.map(p => <Link key={p.path} href={p.path} className="card tight row" style={{ color: 'var(--fg-1)', textDecoration: 'none' }}><span className="grow">{p.title}<br /><span className="faint" style={{ fontSize: 12 }}>{p.area} · {p.group}</span></span><Badge>{p.role}</Badge></Link>)}</div></div>}
    {faqs.length > 0 && <div className="stack sm"><h3>Answers</h3>{faqs.map(([a, b]) => <details key={a} className="card tight"><summary style={{ cursor: 'pointer', fontWeight: 600 }}>{a}</summary><p className="muted" style={{ marginTop: 8 }}>{b}</p></details>)}</div>}
    <div className="stack sm"><H2>Tutorials</H2><Cards min={260} items={tuts.map(([t, d, icon, href]) => ({ t, d, icon, href }))} /></div>
    <Cards min={260} items={[{ t: 'Chat on WhatsApp', d: '+62 811 0000 2026 · Mon–Sat 08:00–20:00', icon: 'message-circle' }, { t: 'System status', d: 'Is it us? Check live service health.', icon: 'activity', href: '/system-status' }]} />
  </div></Wrap>;
}

// ── Company ─────────────────────────────────────────────────────────────────────────────
export function About() {
  return <><Wrap><div className="stack lg">
    <PageHead kicker="About us" title="One system for the whole outlet" sub="BorNiz is a cloud POS for Indonesian F&B, retail, UMKM, franchise and services. One system for the counter, the kitchen, the guest’s phone and the owner’s dashboard." />
    <div className="grid" style={{ ['--min' as string]: '260px' }}>{[['Who we build for', 'Cafés and casual restaurants with 1–10 outlets, starting in Jabodetabek, Bandung and Surabaya.'], ['How we make money', 'A monthly fee per outlet and a share of the payment fee on QRIS and VA. Never by selling data.'], ['Why outlets choose us', 'Fast counter UX, real offline, guest pages in the merchant’s own brand, and approvals built for Indonesian shift teams.'], ['What we measure', 'Weekly paid transactions per active outlet. If outlets sell more, we did our job.']].map(([t, d]) => <div key={t} className="card stack sm"><b style={{ fontSize: 18 }}>{t}</b><span className="muted" style={{ fontSize: 14 }}>{d}</span></div>)}</div>
    <div className="stack"><H2 kicker="Roadmap">Where we’re going</H2>
      <ol className="stack" style={{ listStyle: 'none', padding: 0, margin: 0 }}>{[['MVP', 'Sell, cook, pay, close the day at one outlet'], ['v1.0', 'Guests order themselves; owner sees everything'], ['v1.1', 'Every client looks like their own brand'], ['v1.2', 'Bring guests back with loyalty and WhatsApp'], ['v2', 'Franchise, multi-brand, API and accounting sync']].map(([v, d]) => <li key={v} className="row" style={{ alignItems: 'flex-start', gap: 16, padding: '12px 0', borderTop: '1px solid var(--border)' }}><Badge tone="accent">{v}</Badge><span>{d}</span></li>)}</ol></div>
  </div></Wrap><Cta /></>;
}

const JOBS: [string, string, string][] = [['Senior frontend engineer (React)', 'Engineering', 'Jakarta · hybrid'], ['Backend engineer, payments', 'Engineering', 'Jakarta · hybrid'], ['Product designer, staff apps', 'Design', 'Jakarta or remote'], ['Merchant success lead', 'Customer', 'Bandung'], ['Field onboarding specialist', 'Customer', 'Surabaya']];
export function Careers() {
  return <Wrap><div className="stack lg">
    <PageHead kicker="Careers" title="Build the counter Indonesia runs on" sub="Small team, real outlets. We ship to cafés every week and sit at their counters to see how it goes." />
    <div className="grid" style={{ ['--min' as string]: '240px' }}>{[['Go to the counter', 'Every teammate works a shift at a merchant outlet in their first month.'], ['Speed is a feature', 'A cashier has 20 seconds per guest. We design for that.'], ['Say it plainly', 'Plain words in the product, in docs and with each other.']].map(([t, d]) => <div key={t} className="card stack sm"><b>{t}</b><span className="muted" style={{ fontSize: 14 }}>{d}</span></div>)}</div>
    <div className="stack"><H2>Open roles</H2>
      <div className="card flat">{JOBS.map(([t, team, where]) => <a key={t} href={`mailto:careers@bornis.id?subject=${encodeURIComponent(t)}`} className="row" style={{ padding: '16px 20px', borderTop: '1px solid var(--border)', color: 'var(--fg-1)', minHeight: 64 }}>
        <span className="grow"><b>{t}</b><br /><span className="faint" style={{ fontSize: 13 }}>{team} · {where}</span></span><span className="btn btn-sm">Apply</span></a>)}</div>
      <span className="muted" style={{ fontSize: 14 }}>Process: 30-minute call → a short paid task → meet the team → offer within 2 weeks.</span></div>
  </div></Wrap>;
}

// ── Legal ───────────────────────────────────────────────────────────────────────────────
type Doc = { title: string; updated: string; intro: string; sections: [string, ReactNode][] };
const LEGAL: Record<'terms' | 'privacy' | 'refund', Doc> = {
  terms: { title: 'Terms of service', updated: '1 Oct 2026', intro: 'These terms apply when you use BorNiz, the cloud point-of-sale service of PT BorNiz Teknologi Indonesia (“BorNiz”, “we”). By creating an account you agree to them on behalf of your business.',
    sections: [['Your account', 'You are responsible for your account, the people you invite and the PINs they use. Owners must turn on two-step verification. Tell us right away if you think someone accessed your account without permission.'],
      ['Plans and payment', 'Paid plans are billed per outlet in advance, monthly or yearly, in rupiah, plus PPN. Trials end automatically unless you choose to pay. If a payment fails we retry and remind you; after 14 days paid features pause, your data stays.'],
      ['Your data', 'You own your business data: products, orders, customers and reports. We process it only to run the service. You can export it at any time and for 90 days after you leave.'],
      ['Payments to your business', 'Payments from your guests are processed by licensed payment gateways and settled to your bank account under their terms. BorNiz never holds your guests’ card data.'],
      ['Acceptable use', 'Don’t use BorNiz for illegal goods, to send messages to people who didn’t opt in, or to try to access other merchants’ data.'],
      ['Availability', 'We aim for 99.9% monthly availability for the cloud service. Registers keep selling offline during outages and sync afterwards. Planned maintenance is announced on the status page.'],
      ['Liability', 'To the extent the law allows, our total liability in any 12 months is limited to the fees you paid us in that period.'],
      ['Changes and law', 'We’ll give 30 days’ notice of material changes. These terms are governed by the laws of the Republic of Indonesia; disputes go to the South Jakarta District Court.']] },
  privacy: { title: 'Privacy policy', updated: '1 Oct 2026', intro: 'This policy explains what personal data BorNiz handles, why, and the choices you and your guests have. We follow Indonesia’s Personal Data Protection Law (UU PDP No. 27/2022).',
    sections: [['Who is responsible', 'For your account and staff data, BorNiz is the controller. For your guests’ data (members, orders, receipts), your business is the controller and BorNiz processes it on your behalf.'],
      ['What we collect', 'Account details (name, WhatsApp number, email), staff names and PINs (stored hashed), device information, and the business data you enter. For guests: phone number, name, orders and loyalty points, only when they give them.'],
      ['Why we use it', 'To run the POS, sync devices, send receipts and one-time codes, prevent fraud, and bill your plan. Marketing messages to guests are sent only to people who opted in.'],
      ['Where it is stored', 'In data centres in Indonesia, encrypted in transit and at rest. Access by BorNiz support is time-boxed, approved by the owner and logged.'],
      ['How long we keep it', 'While your account is active and for 90 days after it closes, except records we must keep longer by law (such as tax invoices).'],
      ['Your rights', 'You and your guests can ask to see, correct, export or delete personal data. Email privacy@bornis.id; we reply within 3 × 24 hours as required by law.'],
      ['Cookies', 'Our website uses only cookies needed to sign in and remember settings. No advertising trackers.']] },
  refund: { title: 'Refund policy', updated: '1 Oct 2026', intro: 'This policy covers refunds of your BorNiz subscription. Refunds to your own guests are handled in the register with approvals, not by this policy.',
    sections: [['Trials', 'Trials are free and need no card, so there is nothing to refund. If you don’t choose a plan, the account moves to Free when the trial ends.'],
      ['Monthly plans', 'You can cancel any time. The plan runs to the end of the month you paid for; we don’t refund part months.'],
      ['Yearly plans', 'Cancel within 30 days of a yearly payment for a full refund. After 30 days we refund the unused full months, minus the 2 free months included in the yearly price.'],
      ['Downgrades', 'Downgrades apply from the next billing period. Features above the new plan pause, your data stays.'],
      ['Billing mistakes', 'If we charged you twice or for the wrong number of outlets, we refund the difference in full within 7 working days.'],
      ['How refunds are paid', 'To the original method: QRIS and e-wallet within 3 working days, virtual account and card within 14 working days. Hardware bought from us has a separate 7-day return window.'],
      ['Contact', 'Owners can request a refund from Owner › Account › Subscription billing or by emailing billing@bornis.id with the invoice number.']] },
};
export function Legal({ doc }: { doc: 'terms' | 'privacy' | 'refund' }) {
  const d = LEGAL[doc];
  const id = (t: string) => t.toLowerCase().replace(/[^a-z]+/g, '-');
  return <Wrap><div className="row wrap" style={{ gap: 32, alignItems: 'flex-start' }}>
    <div className="hide-sm" style={{ flex: '1 1 220px', position: 'sticky', top: 88 }}><Toc items={d.sections.map(([t]) => [id(t), t])} /></div>
    <div className="stack lg" style={{ flex: '3 1 480px', minWidth: 0, maxWidth: '100%' }}>
      <PageHead kicker={'Updated ' + d.updated} title={d.title} sub={d.intro} />
      <Prose>{d.sections.map(([t, body], i) => <section key={t} id={id(t)} className="stack sm" style={{ scrollMarginTop: 88 }}><h2>{i + 1}. {t}</h2><p>{body}</p></section>)}</Prose>
      <div className="row wrap">{(['terms', 'privacy', 'refund'] as const).filter(x => x !== doc).map(x => <Link key={x} href={x === 'terms' ? '/terms-of-service' : x === 'privacy' ? '/privacy-policy' : '/refund-policy'} className="btn btn-sm">{LEGAL[x].title}</Link>)}</div>
    </div>
  </div></Wrap>;
}
