'use client';
// Studios (spec/BorNiz Studios.dc.html): every customization tool beyond Menu & Brand Studio. One frame (tools · settings ·
// live preview); every route opens its tool, some with a preset (e.g. the thank-you template or the salon template).
import { useMemo } from 'react';
import Link from 'next/link';
import { useApp } from '../app/context.tsx';
import { setSetting } from '../data/actions.ts';
import { snapshot } from '../data/store.ts';
import type { DB } from '../data/schema.ts';
import { Badge, Icon, Kpi } from '../ui/kit.tsx';
import { planLocked, PLAN_LABEL, type Ctx, type PP, type Tool, type V } from './studios/core.tsx';
import { StudioFrame } from './studios/frame.tsx';
import { PRINT } from './studios/print.tsx';
import { GUEST } from './studios/guest.tsx';
import { MARKETING } from './studios/marketing.tsx';
import { MESSAGING, setAutoPath, setEditorPath } from './studios/messaging.tsx';
import { PLATFORM } from './studios/platform.tsx';
import { workspaceTools } from './studios/workspace.tsx';

/** Route → [tool, preset]. The first route listed for a tool is its canonical link in the tools list. */
const R: Record<string, [string, V?]> = {
  '/owner/more-studios-print/cup-sticker-and-drink-label': ['cup'], '/owner/print-studio/cup-sticker-drink-label': ['cup'],
  '/owner/more-studios-print/kitchen-ticket-and-station-routing': ['kticket'], '/owner/print-studio/kitchen-ticket-layout-and-station-labels': ['kticket'],
  '/owner/more-studios-print/coupon-on-receipt': ['coupon'], '/owner/print-studio/promo-coupon-printed-on-receipt': ['coupon'],
  '/owner/more-studios-print/letterhead-invoices-and-pdf-reports': ['letter'], '/owner/print-studio/report-invoice-and-pdf-letterhead': ['letter'],
  '/owner/more-studios-print/printed-menu': ['pmenu'],
  '/owner/more-studios-print/receipt-template-per-outlet': ['rcpt'], '/owner/print-studio/receipt-template-per-outlet': ['rcpt'],
  '/owner/more-studios-marketing/wa-email-and-sms-template-editor': ['msg'], '/owner/marketing-studio/whatsapp-email-sms-template-editor': ['msg'],
  '/owner/messaging-and-automation/template-editor-thank-you-after-visit': ['msg', { tpl: 'thanks_visit', ch: 'wa' }],
  '/system/templates/waba-template-order-ready-pickup': ['msg', { tpl: 'order_ready', ch: 'wa' }],
  '/owner/more-studios-marketing/automations': ['flows'],
  '/owner/more-studios-marketing/voucher-and-promo-design': ['voucher'], '/owner/more-studios-marketing/gift-card-design': ['gift'],
  '/owner/more-studios-marketing/push-notification-composer': ['push'], '/owner/marketing-studio/push-notification-designer': ['push'],
  '/owner/more-studios-marketing/referral-program-page': ['referral'], '/owner/marketing-studio/ad-pixels-and-seo-per-page': ['pixels'],
  '/owner/more-studios-platform/custom-fonts': ['fonts'], '/owner/platform-studio/custom-font-upload': ['fonts'],
  '/owner/more-studios-platform/icon-style': ['icons'], '/owner/platform-studio/icon-style': ['icons'],
  '/owner/more-studios-platform/favicon-app-icon-and-share-image': ['appicon'], '/owner/marketing-studio/social-share-image-favicon-and-app-icon': ['appicon'],
  '/owner/more-studios-platform/custom-sounds': ['sounds'], '/owner/platform-studio/custom-sounds': ['sounds'],
  '/owner/more-studios-platform/languages-and-translations': ['lang'], '/owner/platform-studio/extra-languages-and-custom-translations': ['lang'],
  '/owner/more-studios-platform/white-label-member-app': ['white'], '/owner/platform-studio/white-label-app': ['white'], '/admin/white-label-tenants': ['white'],
  '/owner/more-studios-platform/custom-domain-and-sso': ['domain'], '/owner/platform-studio/own-dashboard-domain-plus-sso': ['domain'],
  '/owner/more-studios-platform/embeds-and-widgets': ['embed'], '/owner/platform-studio/embed-code-and-third-party-widgets': ['embed'],
  '/owner/messaging-and-automation/email-sender-domain': ['emaild'], '/owner/more-studios-platform/email-sender-domain': ['emaild'], '/owner/marketing-studio/sender-email-on-own-domain': ['emaild'],
  '/owner/more-studios-platform/import-brand-kit': ['kit'], '/owner/platform-studio/brand-kit-import': ['kit'],
  '/owner/more-studios-platform/auto-theme-from-logo': ['auto'], '/owner/platform-studio/auto-generate-theme-from-logo-or-photo': ['auto'],
  '/owner/more-studios-platform/animation-style': ['anim'], '/owner/platform-studio/motion-preference': ['anim'],
  '/owner/platform-studio/price-display-rules': ['prices'], '/owner/platform-studio/number-and-currency-format-per-outlet': ['numfmt'],
  '/owner/platform-studio/large-text-accessible-kiosk-mode': ['a11y'], '/owner/platform-studio/legal-pages-per-merchant': ['legal'],
  '/owner/platform-studio/theme-save-share-and-template-marketplace': ['market'],
  '/owner/more-studios-workspace/dashboard-widgets-per-role': ['widgets'], '/owner/platform-studio/dashboard-widgets-drag-and-drop': ['widgets'],
  '/owner/more-studios-workspace/terminology': ['terms'], '/owner/platform-studio/rename-module-terms': ['terms'],
  '/owner/more-studios-workspace/custom-fields': ['fields'], '/owner/platform-studio/custom-fields-on-products-and-customers': ['fields'],
  '/owner/more-studios-workspace/theme-per-role': ['roleth'], '/owner/platform-studio/theme-per-role': ['roleth'],
  '/owner/more-studios-governance/franchise-brand-lock': ['lock'],
  '/owner/more-studios-governance/change-approvals': ['approve'], '/owner/governance/theme-approval': ['approve'], '/owner/customization-rules/approval-managers-propose-owner-publishes': ['approve'],
  '/manager/customization/publish-request-and-owner-approval-status': ['requests'],
  '/owner/more-studios-governance/staging-and-preview-link': ['staging'], '/owner/governance/preview-staging-link': ['staging'], '/owner/customization-rules/theme-preview-link-for-stakeholders': ['staging'],
  '/owner/more-studios-governance/a-b-testing': ['ab'], '/owner/governance/a-b-test-two-themes-plus-conversion-stats': ['ab'],
  '/owner/more-studios-governance/menu-analytics': ['stats'], '/owner/more-studios-governance/webhooks-and-api': ['hooks'],
  '/owner/more-studios-governance/industry-templates': ['industry'], '/owner/industry-templates/f-and-b-template': ['industry', { pick: 'fnb' }],
  '/owner/industry-templates/retail-template': ['industry', { pick: 'retail' }], '/owner/industry-templates/salon-spa-template': ['industry', { pick: 'salon' }],
  '/owner/industry-templates/laundry-template': ['industry', { pick: 'laundry' }], '/owner/industry-templates/food-court-multi-tenant-template': ['industry', { pick: 'court' }],
  '/solutions-services': ['industry', { pick: 'salon' }],
  '/owner/more-studios-customer-screens/waiting-screen': ['wait'], '/owner/more-studios-customer-screens/order-ready-and-enjoy': ['ready'],
  '/owner/more-studios-customer-screens/menu-board': ['board'], '/owner/more-studios-customer-screens/queue-and-pickup-screen': ['queue'],
  '/owner/more-studios-customer-screens/qris-payment-on-phone': ['qrpay'], '/owner/more-studios-customer-screens/split-bill-from-phone': ['split'],
  '/owner/more-studios-customer-screens/delivery-tracking': ['track'], '/order/customer-links/delivery-tracking': ['track'],
  '/owner/more-studios-customer-screens/closed-paused-and-sold-out': ['closed'],
  '/owner/messaging-and-automation/whatsapp-business-connection-and-number-verification': ['waba'],
  '/owner/messaging-and-automation/message-templates': ['templates'],
  '/owner/messaging-and-automation/automation-post-visit-thank-you': ['a_thanks'], '/owner/messaging-and-automation/automation-feedback-request-and-review-link': ['a_feedback'],
  '/owner/messaging-and-automation/automation-win-back': ['a_winback'], '/owner/messaging-and-automation/automation-birthday-and-points-expiry': ['a_bday'],
  '/owner/messaging-and-automation/automation-flow-builder': ['builder'], '/owner/messaging-and-automation/opt-in-and-consent': ['optin'],
  '/owner/messaging-and-automation/message-log-and-delivery-status': ['log'], '/owner/messaging-and-automation/messaging-credits-and-cost': ['credits'],
  '/owner/messaging-and-automation/automation-performance': ['perf'],
  '/owner/customization-rules/locked-elements': ['locked'], '/owner/customization-rules/contrast-check-and-publish-blocking': ['contrast'], '/owner/customization-rules/plan-gating': ['plans'],
  '/studios': ['home'], '/manager/customization/studios': ['home'],
};
const CANON: Record<string, string> = {};
for (const [p, [id, pre]] of Object.entries(R)) if (!pre && !CANON[id]) CANON[id] = p;

function toolState(db: DB, t: Tool) {
  if (planLocked(t.plan, db)) return ['Locked by plan', 'info'] as const;
  const vs = db.versions.filter(v => v.kind === 'page' && (v.data as V)?.tool === t.id);
  if (vs.some(v => v.status === 'pending_owner' && db.approvals.find(a => a.subjectId === v.id)?.status === 'waiting')) return ['Waiting for owner', 'warning'] as const;
  if (vs.some(v => v.status === 'published')) return ['Published', 'success'] as const;
  if (t.def && db.settings['studio:' + t.id]) return ['Draft', 'neutral'] as const;
  return null;
}

let ALL: Tool[] = [];
const HOME: Tool = {
  id: 'home', group: 'STUDIOS', name: 'Customization studios', icon: 'layout-grid', plan: 'free', desc: 'Make every customer page, printout and message your own. Managers edit everything; publishing goes to the owner.',
  Panel: ({ x }: PP) => { const waiting = x.db.approvals.filter(a => a.type === 'publish' && a.status === 'waiting').length;
    return <div className="stack"><Kpi label="Plan" value={PLAN_LABEL[x.db.tenant.plan]} delta={`${ALL.filter(t => planLocked(t.plan, x.db)).length} tools need an upgrade`} /><Kpi label="Waiting for owner" value={waiting} tone={waiting ? 'warn' : undefined} />
      <Link className="btn" href="/owner/menu-studio-customer-facing/menu-studio-brand-and-all-colors">Menu Studio (guest theme)</Link><Link className="btn" href="/owner/brand-studio-team-workspace/brand-studio-colors">Brand Studio (staff tools)</Link></div>; },
  Preview: ({ x }: PP) => { const groups = ALL.filter(t => t.id !== 'home').reduce<Record<string, Tool[]>>((a, t) => ((a[t.group] ??= []).push(t), a), {});
    return <div className="stack lg" style={{ width: '100%' }}>{Object.entries(groups).map(([g, ts]) => <section key={g} className="stack sm"><span className="cap">{g} · {ts.length}</span>
      <div className="grid" style={{ ['--min' as string]: '220px' }}>{ts.map(t => { const s = toolState(x.db, t); return <Link key={t.id} href={CANON[t.id]} className="card tight stack sm" style={{ color: 'var(--fg-1)', textDecoration: 'none' }}>
        <div className="row between"><Icon name={t.icon} />{s ? <Badge tone={s[1]} dot>{s[0]}</Badge> : t.plan !== 'free' && <Badge>{PLAN_LABEL[t.plan]}</Badge>}</div><b style={{ fontSize: 14 }}>{t.name}</b>
        <span className="muted" style={{ fontSize: 12, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{t.desc}</span></Link>; })}</div></section>)}</div>; },
};
ALL = [HOME, ...PRINT, ...MARKETING, ...MESSAGING, ...PLATFORM, ...workspaceTools(() => ALL), ...GUEST];
const parse = (s: unknown): V => { try { return typeof s === 'string' ? JSON.parse(s) : {}; } catch { return {}; } };

export default function Screen() {
  const { page, db, user, me, outletId, setOutlet, go } = useApp();
  void setOutlet;
  const x: Ctx = useMemo(() => ({ db, me, user, outletId, go, by: me?.id ?? user.id, owner: user.role === 'owner' }), [db, me, user, outletId, go]);
  const [id, preset] = R[page.path] ?? ['home'];
  const tool = ALL.find(t => t.id === id) ?? HOME;
  const homePath = user.role === 'manager' ? '/manager/customization/studios' : '/studios';
  const pathOf = (tid: string) => (tid === 'home' ? homePath : CANON[tid] ?? homePath);
  setAutoPath(pathOf);
  setEditorPath((tpl, c) => { setSetting('studio:msg', JSON.stringify({ ...parse(snapshot().settings['studio:msg']), tpl }), c.by); return pathOf('msg'); });
  return <StudioFrame key={tool.id + page.path} tool={tool} tools={ALL} x={x} preset={preset} pathOf={pathOf} />;
}
