// A number on a tile is never a dead end: it opens the list it counts. One resolver for every KPI tile.
// The role's own app wins (owner → /owner, PIC → /pic …), else the first page the role may open.
import { pageAt } from './registry.ts';
import { canOpen } from './access.ts';
import type { Role } from '../data/schema.ts';

const SALES = ['/pos/after-sale/shift-transaction-history', '/pic/my-shift/shift-sales-and-orders', '/manager/sales/outlet-transactions', '/owner/sales/sales-transactions'];
const LIVE = ['/owner/monitor/live-monitor', '/manager/sales/outlet-transactions', '/pic/my-shift/shift-sales-and-orders', '/pos/selling/open-bills-saved-orders', '/kds/order-tickets'];
const ONLINE = ['/pos/selling/online-and-qr-orders-inbox', '/manager/operations/delivery-order-kanban', '/owner/sales/delivery-order-kanban'];
const REFUNDS = ['/pic/approvals/approval-history-this-shift', '/manager/sales/refund-and-void-history', '/owner/sales/refunds-and-voids'];
const APPROVALS = ['/pic/approvals/approval-queue', '/manager/operations/approvals', '/owner/monitor/notifications-and-activity-center'];
const CASH = ['/pos/shift/shift-summary-before-close', '/pic/cash-and-handover/confirm-drawer-counts-and-variance', '/manager/shifts/drawer-sessions-and-cash-close-per-shift', '/owner/reports/shift-and-cash-variance-report'];
const PAYMENTS = ['/owner/finance/cash-flow-and-settlement', '/admin/tenant-invoices-and-payments'];
const TEAM = ['/pic/my-shift/team-on-shift-and-breaks', '/manager/shifts/live-who-is-on-shift-now', '/owner/team/attendance'];
const MEMBERS = ['/owner/customers/customers'];
const MESSAGES = ['/owner/messaging-and-automation/message-log-and-delivery-status'];
const DEVICES = ['/manager/devices/registers-and-devices-status', '/owner/account/devices'];
const PLATFORM = ['/admin/tenant-list'];
const BILLING = ['/admin/tenant-invoices-and-payments'];

/** Label → the pages that list what it counts. Order matters: the first matching rule wins. */
export const DRILL: [RegExp, string[]][] = [
  [/refund|void/i, REFUNDS],
  [/approval|waiting for owner|decided/i, APPROVALS],
  [/variance|drawer|^cash$/i, CASH],
  [/qris|card|e-wallet|failed payments|settle/i, PAYMENTS],
  [/^tips$/i, ['/owner/sales/tips-report']],
  [/margin/i, ['/owner/reports/cogs-and-margin-report']],
  [/online|needs accept|scheduled|rejected or missed|picked up|on the shelf|order to pickup|quality rating/i, ONLINE],
  [/open orders|^open( now)?$|cooking|late in the kitchen|tables in use/i, LIVE],
  [/on shift|shift now|pic now|late or no-show/i, TEAM],
  [/member|signed up|repeat rate|return visits|came back|active \(30|opted in/i, MEMBERS],
  [/message|^sent|^read|conversation|attributed|^failed$/i, MESSAGES],
  [/device/i, DEVICES],
  [/mrr|arr|active tenants|churn|^outlets$/i, PLATFORM],
  [/outstanding|collected/i, BILLING],
  [/sales|revenue|orders|ticket|transactions|items per order|self-order|ordered by guests/i, SALES],
];

const HOME: Partial<Record<Role, string>> = { owner: '/owner/', manager: '/manager/', pic: '/pic/', cashier: '/pos/', kitchen: '/kds/', admin: '/admin/' };
export function drillTo(label: string, role: Role, here: string): string | null {
  const ok = (DRILL.find(([re]) => re.test(label))?.[1] ?? []).filter(p => { const pg = pageAt(p); return !!pg && canOpen(role, pg); });
  const mine = ok.filter(p => p.startsWith(HOME[role] ?? '\0'));
  const pick = mine.length ? mine : ok;
  return pick.includes(here) ? null : pick[0] ?? null; // a tile on the list it counts stays a plain number
}

/** A row opens its record: the detail page for that object the role may open (back office first, then the register). */
const RECORD: Record<string, [string, string][]> = {
  order: [['/owner/sales/order-detail', 'id'], ['/pos/after-sale/order-detail-and-edit-after-payment', 'o']],
};
export function recordTo(object: 'order', id: string, role: Role): string | null {
  const hit = RECORD[object].find(([p]) => { const pg = pageAt(p); return !!pg && canOpen(role, pg); });
  return hit ? `${hit[0]}?${hit[1]}=${encodeURIComponent(id)}` : null;
}
