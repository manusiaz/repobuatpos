// Real pages vs features. The sitemap lists ~600 FEATURES; a merchant navigates ~100 PAGES. Every feature lives on
// exactly one page as a tab, sheet, step, state, setting, template or studio tool. Releases follow the design-system
// roadmap (spec/bn-pm.js): MVP = sell, cook, pay, close the day at one outlet. `npm run check:system` proves it.
import { PAGES, type Page } from './registry.ts';

export type Release = 'MVP' | 'v1.0' | 'v1.1' | 'v1.2' | 'v2';
export const RELEASES: Release[] = ['MVP', 'v1.0', 'v1.1', 'v1.2', 'v2'];
export const RELEASE_GOAL: Record<Release, string> = {
  MVP: 'Sell, cook, pay, close the day at one outlet', 'v1.0': 'Guests order themselves; owner sees everything',
  'v1.1': 'Every client looks like their own brand', 'v1.2': 'Bring guests back', v2: 'Franchise & enterprise',
};
export type Kind = 'page' | 'tab' | 'sheet' | 'step' | 'state' | 'setting' | 'template' | 'tool' | 'section';
export type App = 'web' | 'account' | 'backoffice' | 'pos' | 'online' | 'pic' | 'kds' | 'display' | 'order' | 'kiosk' | 'waiter' | 'mobile' | 'admin';
export const APP_LABEL: Record<App, string> = { web: 'Marketing site', account: 'Account & onboarding', backoffice: 'Back office (owner & manager)', pos: 'POS register', online: 'Online orders',
  pic: 'Shift lead (PIC)', kds: 'Kitchen display', display: 'Customer display', order: 'QR menu & customer links', kiosk: 'Kiosk', waiter: 'Waiter app', mobile: 'Owner mobile', admin: 'Super admin' };

/** Rule: role(s) | group regex | name regex. */
type Rule = [string, RegExp, RegExp];
export interface RealPage { id: string; app: App; module: string; title: string; release: Release; epic: string; proto: string; path: string; rules: Rule[]; managerOnly?: boolean; hidden?: boolean }
const R = (roles: string, group: RegExp, name: RegExp = /./): Rule => [roles, group, name];
const ANY = /./;
const P = (id: string, app: App, module: string, title: string, release: Release, epic: string, proto: string, rules: Rule[], path = '', managerOnly = false): RealPage =>
  ({ id, app, module, title, release, epic, proto, path, rules, managerOnly });

export const REAL: RealPage[] = [
  // ── Marketing site ─────────────────────────────────────────────────────────────────────
  P('web.home', 'web', 'Site', 'Home', 'MVP', 'E9', 'Landing', [R('public', /Core/, /^Home$/), R('public', /Solutions|Resources/, /(Hardware|Integrations|Case studies)/)]),
  P('web.pricing', 'web', 'Site', 'Pricing', 'MVP', 'E9', 'Landing', [R('public', /Core/, /^Pricing/)]),
  P('web.contact', 'web', 'Site', 'Contact sales / demo', 'MVP', 'E9', 'Landing', [R('public', /Core/, /Contact/)]),
  P('web.legal', 'web', 'Site', 'Legal (terms, privacy, refund)', 'MVP', 'E9', 'Landing', [R('public', /Company/, /(Terms|Privacy|Refund)/)]),
  P('web.help', 'web', 'Site', 'Help center', 'MVP', 'E9', 'Landing', [R('public', /Resources/, /(Help center|FAQ)/)], '/help-center-and-tutorials'),
  P('web.features', 'web', 'Site', 'Features & solutions', 'v1.0', 'E9', 'Landing', [R('public', /Core/, /^Features$/), R('public', /Solutions/, /^Solutions/)]),
  P('web.blog', 'web', 'Site', 'Blog', 'v1.0', 'E9', 'Landing', [R('public', /Resources/, /Blog/)]),
  P('web.company', 'web', 'Site', 'About & careers', 'v1.0', 'E9', 'Landing', [R('public', /Company/, /(About|Careers)/)]),
  P('web.status', 'web', 'Site', 'System status', 'v1.0', 'E9', 'Landing', [R('public', /Resources/, /System status/)]),
  P('web.developers', 'web', 'Site', 'Developer API docs', 'v2', 'E9', 'Landing', [R('public', /Resources/, /Developer/)]),
  // ── Account & onboarding ───────────────────────────────────────────────────────────────
  P('acc.login', 'account', 'Account', 'Log in', 'MVP', 'E9', 'Auth', [R('public', /Auth/, /(Login|Forgot|Reset|Verify|2FA)/)], '/account/login'),
  P('acc.register', 'account', 'Account', 'Sign up', 'MVP', 'E9', 'Auth', [R('public', /Auth/, /Register/)]),
  P('acc.onboarding', 'account', 'Account', 'Onboarding', 'MVP', 'E9', 'Auth', [R('public', /Setup/, /^Onboarding/)]),
  P('acc.plan', 'account', 'Account', 'Plan & checkout', 'MVP', 'E9', 'Auth', [R('public', /Setup/, /(plan|Checkout)/i)]),
  P('acc.device', 'account', 'Account', 'Set up this device', 'MVP', 'E9', 'Auth', [R('public', /Device/, /(Choose outlet|Choose register)/)]),
  // ── POS register ───────────────────────────────────────────────────────────────────────
  P('pos.lock', 'pos', 'POS', 'Sign in with PIN', 'MVP', 'E1', 'POS Register', [R('cashier', /Device/, /Lock screen/), R('public', /Device/, /Cashier PIN/)], '/pos'),
  P('pos.register', 'pos', 'POS', 'Register', 'MVP', 'E1', 'POS Register', [R('cashier', /Selling/, /^(?!Open bills|Online & QR|Ride-hailing|Reservations)/), R('cashier', /Payment/), R('cashier', /After sale/, /(Price check|Stock check|sold-out|Manager PIN)/)], '/pos/selling/register-order'),
  P('pos.bills', 'pos', 'POS', 'Open bills', 'MVP', 'E1', 'POS Register', [R('cashier', /Selling/, /^Open bills/)]),
  P('pos.history', 'pos', 'POS', 'Shift transactions', 'MVP', 'E1', 'POS Register', [R('cashier', /After sale/, /(history|void|Reprint|e-receipt|Order detail|Refund|Exchange)/)], '/pos/after-sale/shift-transaction-history'),
  P('pos.shift', 'pos', 'POS', 'Shift & cash', 'MVP', 'E3', 'Shifts', [R('cashier', /^Shift$/), R('cashier', /Shift change/)], '/pos/shift/open-shift'),
  P('pos.device', 'pos', 'POS', 'Device & sync', 'MVP', 'E1', 'POS Register', [R('cashier', /Device/), R('cashier', /After sale/, /Offline/)], '/pos/device/sync-status-and-retry'),
  P('pos.reservations', 'pos', 'POS', 'Reservations & walk-in queue', 'v1.0', 'E2', 'POS Register', [R('cashier', /Selling/, /^Reservations/)]),
  // ── Online orders (cashier, PIC, kitchen, manager, owner) ──────────────────────────────
  P('online.inbox', 'online', 'Online', 'Online orders', 'v1.0', 'E2', 'Online Orders', [R('cashier', /Selling/, /(Online & QR|Ride-hailing)/), R('owner|manager', /Sales|Operations/, /Delivery order kanban/)], '/online'),
  // ── PIC tablet ─────────────────────────────────────────────────────────────────────────
  P('pic.home', 'pic', 'PIC', 'My shift', 'MVP', 'E3', 'PIC', [R('pic', /My shift/)], '/pic'),
  P('pic.approvals', 'pic', 'PIC', 'Approvals', 'MVP', 'E3', 'PIC', [R('pic', /Approvals/)]),
  P('pic.cash', 'pic', 'PIC', 'Cash & handover', 'MVP', 'E3', 'PIC', [R('pic', /Cash & handover/)]),
  P('pic.floor', 'pic', 'PIC', 'Floor (86, incidents, requests)', 'MVP', 'E2', 'PIC', [R('pic', /Floor/)]),
  P('pic.opname', 'pic', 'PIC', 'Stock count (opname)', 'v1.1', 'E4', 'PIC', [], '/pic/floor/stock-opname'),
  // ── Kitchen display ────────────────────────────────────────────────────────────────────
  P('kds.tickets', 'kds', 'Kitchen', 'Tickets', 'MVP', 'E2', 'Kitchen Display', [R('kitchen', ANY, /(Order tickets|Station filter|Prep timers|Rush|Order detail|Call runner|Recall|Clock|Delivery & online)/)], '/kds'),
  P('kds.allday', 'kds', 'Kitchen', 'All-day count & 86', 'MVP', 'E2', 'Kitchen Display', [R('kitchen', ANY, /(All-day|out of stock)/)]),
  P('kds.done', 'kds', 'Kitchen', 'Completed', 'MVP', 'E2', 'Kitchen Display', [R('kitchen', ANY, /Completed/)]),
  P('kds.settings', 'kds', 'Kitchen', 'KDS settings', 'MVP', 'E2', 'Kitchen Display', [R('kitchen', ANY, /settings/i)]),
  P('kds.expo', 'kds', 'Kitchen', 'Expo / pass', 'v1.0', 'E2', 'Kitchen Display', [R('kitchen', ANY, /Expo/)]),
  P('kds.performance', 'kds', 'Kitchen', 'Kitchen performance', 'v1.0', 'E2', 'Kitchen Display', [R('kitchen', ANY, /performance/)]),
  P('kds.recipes', 'kds', 'Kitchen', 'Recipes & prep guide', 'v1.1', 'E4', 'Kitchen Display', [R('kitchen', ANY, /Recipes/)]),
  // ── Guest screens ──────────────────────────────────────────────────────────────────────
  P('display.screen', 'display', 'Customer display', 'Customer display', 'MVP', 'E1', 'Customer Display', [R('customer', /Screens/)], '/display'),
  P('order.menu', 'order', 'QR menu', 'Menu', 'v1.0', 'E5', 'Self Order', [R('customer', /QR menu/, /(Scan|Language|Menu home|Category|Search|Item detail|closed)/)], '/order'),
  P('order.cart', 'order', 'QR menu', 'Cart & checkout', 'v1.0', 'E5', 'Self Order', [R('customer', /QR menu/, /(Cart|Checkout|QRIS)/)]),
  P('order.status', 'order', 'QR menu', 'Order status', 'v1.0', 'E5', 'Self Order', [R('customer', /QR menu/, /(Order status|Call waiter|Add more)/)]),
  P('order.receipt', 'order', 'Customer links', 'Digital receipt', 'MVP', 'E1', 'Self Order', [R('customer', /Customer links/, /Digital receipt/)]),
  P('order.feedback', 'order', 'Customer links', 'Feedback & rating', 'v1.0', 'E5', 'Self Order', [R('customer', /Customer links/, /Feedback/)]),
  P('order.booking', 'order', 'Customer links', 'Book a table', 'v1.0', 'E5', 'Self Order', [R('customer', /Customer links/, /booking/)]),
  P('order.tracking', 'order', 'Customer links', 'Delivery tracking', 'v1.0', 'E5', 'Self Order', [R('customer', /Customer links/, /Delivery tracking/)]),
  P('order.queue', 'order', 'Customer links', 'Queue status', 'v1.0', 'E5', 'Self Order', [R('customer', /Customer links/, /Queue/)]),
  P('order.member', 'order', 'Customer links', 'Member card & vouchers', 'v1.2', 'E7', 'Loyalty', [R('customer', /Customer links/, /(Member card|voucher)/)]),
  P('order.prefs', 'order', 'Customer links', 'Message preferences', 'v1.2', 'E7', 'Self Order', [R('customer', /Customer links/, /Unsubscribe/)]),
  P('kiosk.app', 'kiosk', 'Kiosk', 'Kiosk', 'v1.1', 'E5', 'Kiosk', [R('customer', /Kiosk/)], '/kiosk'),
  P('waiter.app', 'waiter', 'Waiter', 'Waiter app', 'MVP', 'E2', 'Waiter', [], '/waiter'),
  // ── Owner mobile ───────────────────────────────────────────────────────────────────────
  P('mobile.live', 'mobile', 'Owner mobile', 'Live', 'v1.0', 'E8', 'Owner Mobile', [R('system', /Mobile/, /live monitor/)]),
  P('mobile.sales', 'mobile', 'Owner mobile', 'Sales', 'v1.0', 'E8', 'Owner Mobile', [R('system', /Mobile/, /sales/)]),
  P('mobile.approvals', 'mobile', 'Owner mobile', 'Approvals', 'v1.0', 'E8', 'Owner Mobile', [R('system', /Mobile/, /(approvals|decision)/)], '/system/mobile/owner-mobile-approvals'),
  P('mobile.alerts', 'mobile', 'Owner mobile', 'Alerts', 'v1.0', 'E8', 'Owner Mobile', [R('system', /Mobile/, /alerts/)]),
  P('mobile.more', 'mobile', 'Owner mobile', 'More', 'v1.0', 'E8', 'Owner Mobile', [R('system', /Mobile/, /more/)]),
  // ── Super admin ────────────────────────────────────────────────────────────────────────
  P('admin.tenants', 'admin', 'Platform', 'Tenants', 'MVP', 'E9', 'Super Admin', [R('admin', ANY, /^Tenant (list|detail)/)]),
  P('admin.plans', 'admin', 'Platform', 'Plans & pricing', 'MVP', 'E9', 'Super Admin', [R('admin', ANY, /^Plans/)]),
  P('admin.billing', 'admin', 'Platform', 'Tenant invoices & payments', 'MVP', 'E9', 'Super Admin', [R('admin', ANY, /invoices/)]),
  P('admin.support', 'admin', 'Platform', 'Support tickets', 'MVP', 'E9', 'Super Admin', [R('admin', ANY, /Support/)]),
  P('admin.audit', 'admin', 'Platform', 'Audit log', 'MVP', 'E9', 'Super Admin', [R('admin', ANY, /Audit/)]),
  P('admin.overview', 'admin', 'Platform', 'Platform overview', 'v1.0', 'E9', 'Super Admin', [R('admin', ANY, /overview/)], '/admin'),
  P('admin.releases', 'admin', 'Platform', 'Feature flags & releases', 'v1.0', 'E9', 'Super Admin', [R('admin', ANY, /Feature flags/)]),
  P('admin.themes', 'admin', 'Platform', 'Themes, white-label & domains', 'v1.1', 'E6', 'Super Admin', [R('admin', ANY, /(Theme presets|White-label|domain)/)]),
  // ── Back office: home & approvals ──────────────────────────────────────────────────────
  P('mgr.dashboard', 'backoffice', 'Home', 'Manager dashboard', 'MVP', 'E3', 'Manager Dashboard', [R('manager', /Monitor/), R('manager', /Create/)], '/manager', true),
  P('bo.dashboard', 'backoffice', 'Home', 'Owner dashboard', 'v1.0', 'E8', 'Owner Dashboard', [R('owner', /Monitor/)], '/owner'),
  P('bo.approvals', 'backoffice', 'Home', 'Approvals', 'MVP', 'E3', 'Authority', [R('manager', /Operations/, /^Approvals/), R('manager', /Waiting for owner/), R('manager', /Customization/, /Publish request/)], '/manager/operations/approvals'),
  P('mgr.close', 'backoffice', 'Home', 'Daily close', 'MVP', 'E3', 'Shifts', [R('manager', /Operations/, /Daily cash/), R('manager', /Shifts/, /Drawer sessions/), R('manager', /Devices/, /Cash drawer log/)], '', true),
  // Sales
  P('bo.transactions', 'backoffice', 'Sales', 'Transactions', 'MVP', 'E1', 'Back Office', [R('owner', /Sales/, /(transactions|Transaction detail|Order detail|Payment detail|Open bills|Refunds & voids|Discounts|Cash in|Tips report)/), R('manager', /Sales/)], '/owner/sales/sales-transactions'),
  // Catalog
  P('bo.products', 'backoffice', 'Catalog', 'Products', 'MVP', 'E4', 'Menu Studio', [R('owner', /Catalog/, /(Products & menu|Product form|Product detail|Bulk edit|Import products|Barcode|availability|Sold-out|Price change history|photo library)/), R('manager', /Same as owner/, /Products/), R('manager', /Operations/, /Outlet menu/)], '/owner/catalog/products-and-menu'),
  P('bo.categories', 'backoffice', 'Catalog', 'Categories & modifiers', 'MVP', 'E4', 'Menu Studio', [R('owner', /Catalog/, /(Categories|Modifier group|Variant matrix)/)]),
  P('bo.prices', 'backoffice', 'Catalog', 'Price lists', 'v1.0', 'E4', 'Menu Studio', [R('owner', /Catalog/, /Price lists/)]),
  P('bo.bundles', 'backoffice', 'Catalog', 'Bundles & combos', 'v1.1', 'E4', 'Menu Studio', [R('owner', /Catalog/, /Bundles/)]),
  P('bo.recipes', 'backoffice', 'Catalog', 'Recipes & COGS', 'v1.1', 'E4', 'Back Office', [R('owner', /Catalog/, /(Recipes|Menu engineering)/)]),
  P('bo.promos', 'backoffice', 'Catalog', 'Promos & vouchers', 'v1.0', 'E5', 'Menu Studio', [R('owner', /Promo/), R('manager', /Same as owner/, /Promos/)], '/owner/promo/promos-and-vouchers'),
  // Inventory
  P('bo.stock', 'backoffice', 'Inventory', 'Stock', 'MVP', 'E4', 'Back Office', [R('owner', /Inventory/, /(Stock overview|Stock card|Batches|Unit conversion|Low-stock|valuation|Ingredient usage|Serial|Warehouses|Import \/ export)/), R('manager', /Inventory/, /(Outlet stock|Low-stock)/)], '/owner/inventory/stock-overview'),
  P('bo.movements', 'backoffice', 'Inventory', 'Stock movements & waste', 'MVP', 'E4', 'Back Office', [R('owner', /Inventory/, /(Stock movements|Waste|Stock adjustment)/), R('manager', /Inventory/, /(Waste entry|Stock adjustment)/)], '/owner/inventory/stock-movements'),
  P('bo.opname', 'backoffice', 'Inventory', 'Stock opname', 'v1.1', 'E4', 'PIC', [R('owner', /Inventory/, /(Stock opname|count schedule)/), R('manager', /Operations/, /opname/)], '/owner/inventory/stock-opname'),
  P('bo.purchasing', 'backoffice', 'Inventory', 'Purchase orders', 'v1.1', 'E4', 'Back Office', [R('owner', /Inventory/, /(Purchase orders|PO form|PO detail|Goods receipt|Purchase return|Auto purchase)/), R('manager', /Same as owner/, /Inventory, POs/), R('manager', /Inventory/, /Receive goods/)], '/owner/inventory/purchase-orders'),
  P('bo.suppliers', 'backoffice', 'Inventory', 'Suppliers', 'v1.1', 'E4', 'Back Office', [R('owner', /Inventory/, /Supplier/)], '/owner/inventory/suppliers'),
  P('bo.transfers', 'backoffice', 'Inventory', 'Transfers between outlets', 'v1.1', 'E4', 'Back Office', [R('owner', /Inventory/, /(transfer|Stock request approval)/i), R('manager', /Inventory/, /(Stock request|Transfer)/)], '/owner/inventory/stock-transfer-between-outlets'),
  P('bo.production', 'backoffice', 'Inventory', 'Prep & production', 'v2', 'E4', 'Back Office', [R('owner', /Inventory/, /Production/), R('manager', /Inventory/, /Prep/)]),
  // Customers
  P('bo.customers', 'backoffice', 'Customers', 'Customers', 'v1.0', 'E7', 'Loyalty', [R('owner', /Customers/, /(^Customers$|Customer detail|deposits|kasbon|segments|Import customers|merge)/), R('manager', /Customers/, /lookup/)], '/owner/customers/customers'),
  P('bo.reviews', 'backoffice', 'Customers', 'Reviews', 'v1.0', 'E5', 'Self Order', [R('owner', /Customers/, /Reviews/), R('manager', /Customers/, /Reviews/)]),
  P('bo.loyalty', 'backoffice', 'Customers', 'Loyalty', 'v1.2', 'E7', 'Loyalty', [R('owner', /Customers/, /(Loyalty|Membership|Referral|Points|Rewards)/), R('owner', /More studios · Marketing/, /(Loyalty|Referral)/), R('owner', /Menu studio · pages \(/, /(Loyalty rules|Referral page)/), R('manager', /Same as owner/, /Customers & loyalty/)], '/owner/customers/loyalty-program'),
  // Team
  P('bo.employees', 'backoffice', 'Team', 'Employees', 'MVP', 'E3', 'Roles', [R('owner', /Team/, /(^Employees$|Employee detail|Invite|PIN & access)/), R('owner', /Settings/, /users/), R('manager', /Team/, /Employees at/)], '/owner/team/employees'),
  P('bo.shifts', 'backoffice', 'Team', 'Shifts & roster', 'MVP', 'E3', 'Shifts', [R('owner', /Team/, /(Shifts|Attendance|Leave|Timesheet)/), R('manager', /Shifts/), R('manager', /Team/, /(Schedules|handover|Timesheet|Leave)/), R('manager', /Same as owner/, /Team/)], '/owner/team/shifts-and-schedules'),
  P('bo.roles', 'backoffice', 'Team', 'Roles & permissions', 'MVP', 'E3', 'Roles', [R('owner', /Team/, /(Roles|Approval flows)/)], '/owner/team/roles-and-permissions-matrix'),
  P('bo.payroll', 'backoffice', 'Team', 'Payroll & commission', 'v2', 'E3', 'Shifts', [R('owner', /Team/, /(Payroll|Commission|Cash advance)/)]),
  // Outlets
  P('bo.outlets', 'backoffice', 'Outlets', 'Outlets', 'MVP', 'E9', 'Owner Dashboard', [R('owner', /Outlets/, /(^Outlets$|Outlet detail|Targets)/)], '/owner/outlets/outlets'),
  P('bo.tables', 'backoffice', 'Outlets', 'Tables & floor plan', 'MVP', 'E2', 'POS Register', [R('owner', /Outlets/, /(Tables & floor|Table QR)/), R('manager', /Operations/, /Tables/)], '/owner/outlets/tables-and-floor-plan'),
  P('bo.reservations', 'backoffice', 'Outlets', 'Reservations', 'v1.0', 'E2', 'POS Register', [R('owner', /Outlets/, /^Reservations/), R('manager', /Customers/, /Reservations/)]),
  P('bo.services', 'backoffice', 'Outlets', 'Service orders (salon, laundry, couriers)', 'v2', 'E2', 'Back Office', [R('owner', /Outlets/, /(Bookings|Laundry|couriers)/)]),
  // Finance
  P('bo.tax', 'backoffice', 'Finance', 'Tax & service charge', 'MVP', 'E1', 'Back Office', [R('owner', /Finance/, /Tax/), R('owner', /Settings/, /tax/)], '/owner/finance/tax-and-service-charge'),
  P('bo.bank', 'backoffice', 'Finance', 'Bank accounts & payouts', 'MVP', 'E1', 'Back Office', [R('owner', /Finance/, /Bank/)]),
  P('bo.finance', 'backoffice', 'Finance', 'Profit & loss', 'v1.0', 'E8', 'Owner Dashboard', [R('owner', /Finance/, /(Profit|Cash flow|Budget)/), R('manager', /Same as owner/, /Finance view/)], '/owner/finance/profit-and-loss'),
  P('bo.expenses', 'backoffice', 'Finance', 'Expenses', 'v1.0', 'E8', 'Back Office', [R('owner', /Finance/, /Expenses/)]),
  P('bo.assets', 'backoffice', 'Finance', 'Assets & equipment', 'v2', 'E8', 'Back Office', [R('owner', /Finance/, /Assets/)]),
  P('bo.royalties', 'backoffice', 'Finance', 'Franchise royalties', 'v2', 'E8', 'Owner Dashboard', [R('owner', /Finance/, /royalties/)]),
  // Reports
  P('bo.reports', 'backoffice', 'Reports', 'Reports', 'MVP', 'E8', 'Owner Dashboard', [R('owner', /Reports/), R('owner', /Sales/, /(Channel sales|Sales by cashier)/), R('owner', /Team/, /Performance/), R('owner', /Outlets/, /comparison/), R('manager', /Reports/), R('manager', /Team/, /performance/), R('manager', /Same as owner/, /Reports/)], '/owner/reports/reports-and-export'),
  // Account & settings
  P('bo.settings', 'backoffice', 'Settings', 'Settings', 'MVP', 'E9', 'Back Office', [R('owner', /Settings/, /(payment methods|opening hours|notifications|language|backup)/)], '/owner/settings/settings-payment-methods'),
  P('bo.devices', 'backoffice', 'Settings', 'Devices & printers', 'MVP', 'E1', 'Back Office', [R('owner', /Account/, /Devices/), R('owner', /Outlets/, /Kiosk management/), R('manager', /Devices/, /(Registers|routing)/)], '/owner/account/devices'),
  P('bo.business', 'backoffice', 'Settings', 'Business profile', 'MVP', 'E9', 'Auth', [R('owner', /Account/, /Business profile/)]),
  P('bo.billing', 'backoffice', 'Settings', 'Subscription & invoices', 'MVP', 'E9', 'Super Admin', [R('owner', /Account/, /(Subscription|Invoices)/), R('owner', /Customization rules/, /Plan gating/)], '/owner/account/subscription-billing'),
  P('bo.audit', 'backoffice', 'Settings', 'Audit log', 'MVP', 'E3', 'Authority', [R('owner', /Account/, /audit/)]),
  P('bo.profile', 'backoffice', 'Settings', 'My profile & security', 'MVP', 'E9', 'Auth', [R('owner', /Account/, /Profile & security/)]),
  P('bo.integrations', 'backoffice', 'Settings', 'Integrations & API', 'v1.0', 'E2', 'Online Orders', [R('owner', /Sales/, /Ride-hailing integrations/), R('owner', /Finance/, /Accounting/), R('owner', /Account/, /Add-on/), R('owner', /Settings/, /API/), R('owner', /More studios · Governance/, /Webhooks/), R('owner', /^Governance$/, /Webhook/)], '/owner/sales/ride-hailing-integrations'),
  // Messaging
  P('bo.messaging', 'backoffice', 'Marketing', 'WhatsApp & messages', 'v1.2', 'E7', 'Studios', [R('owner', /Messaging/, /(WhatsApp Business|Message templates|Template editor|Opt-in|Message log|credits|sender domain)/), R('owner', /Customers/, /Broadcast/), R('owner', /More studios · (Marketing|Platform)/, /(template editor|Email sender)/), R('owner', /Marketing studio/, /(template editor|Sender email)/), R('system', /Templates/, /(Email|WhatsApp|WABA)/), R('customer', /Customer links/, /(WhatsApp thank-you|Thank-you email)/)], '/owner/messaging-and-automation/whatsapp-business-connection-and-number-verification'),
  P('bo.automations', 'backoffice', 'Marketing', 'Automations', 'v1.2', 'E7', 'Studios', [R('owner', /Messaging/, /Automation/), R('owner', /More studios · Marketing/, /Automations/)]),
  P('bo.marketing', 'backoffice', 'Marketing', 'Marketing studio', 'v1.2', 'E7', 'Studios', [R('owner', /More studios · Marketing/), R('owner', /Marketing studio/), R('owner', /Menu studio · pages \(/, /(Gift card designer|Voucher & promo visuals)/)]),
  // Studios
  P('bo.menustudio', 'backoffice', 'Studios', 'Menu Studio', 'v1.1', 'E6', 'Menu Studio', [R('owner', /^Menu studio/), R('owner', /Outlets/, /Table QR/), R('owner', /Sales/, /Online order link/), R('manager', /Customization/, /Menu studio/)], '/owner/menu-studio-customer-facing/menu-studio-brand-and-all-colors'),
  P('bo.brandstudio', 'backoffice', 'Studios', 'Brand Studio', 'v1.1', 'E6', 'Brand Studio', [R('owner', /Brand studio/), R('manager', /Customization/, /Brand studio/)]),
  P('bo.screens', 'backoffice', 'Studios', 'Customer screens studio', 'v1.1', 'E6', 'Studios', [R('owner', /More studios · Customer screens/), R('owner', /Outlets/, /Queue/), R('owner', /Menu studio · pages \(/, /(Split bill|Reservation|Delivery tracking page|Store closed|Feedback|Queue|Menu board|QRIS payment page|Checkout flow|Multi-page)/)], '/studios'),
  P('bo.print', 'backoffice', 'Studios', 'Receipts & print', 'MVP', 'E1', 'Studios', [R('owner', /(More studios · Print|Print studio)/), R('owner', /Account/, /Receipt designer/), R('system', /Templates/, /(Printed receipt|Kitchen ticket)/)], '/owner/print-studio/receipt-template-per-outlet'),
  P('bo.platform', 'backoffice', 'Studios', 'Platform & workspace', 'v2', 'E6', 'Studios', [R('owner', /More studios · (Platform|Workspace)/), R('owner', /Platform studio/)]),
  P('bo.governance', 'backoffice', 'Studios', 'Franchise & governance', 'v2', 'E6', 'Studios', [R('owner', /More studios · Governance/), R('owner', /^Governance$/), R('owner', /Customization rules/), R('owner', /Industry templates/), R('manager', /Customization/, /Studios/)]),
  // System states are components every app renders (offline, access denied, printer offline …), not pages in a menu.
  { ...P('sys.states', 'backoffice', 'System', 'System states (shared components)', 'MVP', 'E1', 'States Gallery', [R('system', /States/)], '/system/states/empty-states'), hidden: true },
  P('bo.menuextras', 'backoffice', 'Studios', 'Menu rules (upsell, badges, channel menus)', 'v1.1', 'E6', 'Menu Studio', [R('owner', /Menu studio · pages \(/, /(Style per category|Auto theme|Upsell|Combo|Printable menu|Menu & price per channel|Custom badges)/)]),
];

/** Release overrides for single features whose epic ships later than their page (spec/bn-pm.js epics). */
const FEATURE_RELEASE: [RegExp, Release][] = [
  [/(Ride-hailing|GoFood)/, 'v1.0'], [/(Member card scan|Redeem points|Gift card|Thank-you & points|Member sign-up|Membership|deposits|Pay with deposit)/i, 'v1.2'],
  [/(Weighed|Exchange \(retail\)|Serial|IMEI|Variant matrix|Barcode & label|Warehouses|Production)/, 'v2'], [/(Customer display pairing|Tip selection|Rate your visit|Split bill progress)/, 'v1.0'],
  [/(Table QR generator)/, 'v1.0'], [/(Batches & expiry|valuation|Ingredient usage|Low-stock alerts)/, 'v1.1'], [/(COGS & margin|Menu engineering)/, 'v1.1'],
  [/(Targets & KPIs|Outlet comparison|Timesheet|Leave)/, 'v1.0'], [/(Accounting|Add-on|API keys|Webhook)/, 'v2'], [/(Delivery & online order lane|Rush \/ priority)/, 'v1.0'],
  [/(Escalate)/, 'MVP'], [/(Budget)/, 'v2'], [/(Customer segments)/, 'v1.2'],
];

// ── Assignment ─────────────────────────────────────────────────────────────────────────────
const matches = (r: Rule, f: Page) => r[0].split('|').includes(f.role) && r[1].test(f.group) && r[2].test(f.name);
export interface Feature { path: string; name: string; page: RealPage; kind: Kind; release: Release }

function kindOf(f: Page, home: RealPage, isMain: boolean): Kind {
  if (isMain) return 'page';
  const n = f.name;
  if (f.group === 'States' || home.id === 'display.screen' || home.id === 'kiosk.app' || /(closed|expired|failed|success|pending|reminder|idle|attract|Payment failed)/i.test(n)) return 'state';
  if (f.group === 'Templates' || /(template|WhatsApp thank-you|Thank-you email|Printed receipt)/i.test(n) && home.module !== 'Studios') return 'template';
  if (home.module === 'Studios' || home.id === 'bo.marketing' || home.id === 'bo.menuextras') return 'tool';
  if (home.app === 'account' || home.id === 'pos.shift' && /(Shift change|ending|Blind|Handover|Clock out|Next cashier)/.test(f.group + n)) return 'step';
  if (/(^Settings ·|settings|rules|limits|conversion|routing|schedule$|Approval flows|Plan gating|consent|credits|domain)/i.test(n)) return 'setting';
  if (/(\blog\b|report|history|\blist\b|calendar|kanban|inbox|deposits|kasbon|Refunds & voids|overview|performance|Outlet transactions|Open bills)/i.test(n)) return 'tab';
  if (/(\bform\b|detail|^New |^Invite|^Add |scan|picker|sheet|Merge|Move|Split|discount|note|Change price|Redeem|Tips|override|check|request|entry|PIN & access|adjustment|Reprint|Send |Apply|Import|Bulk|Purchase request|Renovation|action sheet|Cash in|Cash drop|Open item|Course|Hold|Guest count|Order type|Refund|Exchange|Order detail|Cash \(|QRIS|Card|E-wallet|Virtual|Multiple|Partial|Customer credit|deposit|rounding|Manual payment|method picker|Lock|pairing|test|connection|Escalate|Pass PIC|Mark items|Incident|Call)/i.test(n)) return 'sheet';
  return 'tab';
}

function build() {
  const out = new Map<string, Feature>(), problems: string[] = [];
  const sitemap = PAGES.filter(p => !p.extra);
  for (const f of sitemap) {
    // the most specific rule wins (a named feature beats a whole group)
    const spec = (r: Rule) => (r[2].source === '.' ? 0 : 1000 + r[2].source.length) + (r[1].source === '.' ? 0 : 1);
    const hits = REAL.flatMap(rp => rp.rules.filter(r => matches(r, f)).map(r => ({ rp, s: spec(r) }))).sort((a, b) => b.s - a.s);
    if (hits.length === 0) { problems.push(`unassigned: ${f.role} | ${f.group} | ${f.name}`); continue; }
    const home = hits[0].rp;
    if (hits.length > 1 && hits[1].s === hits[0].s && hits[1].rp !== home) problems.push(`ambiguous: ${f.name} → ${hits.map(h => h.rp.id).join(', ')}`);
    out.set(f.path, { path: f.path, name: f.name, page: home, kind: 'tab', release: home.release });
  }
  for (const rp of REAL) {
    const mine = sitemap.filter(f => out.get(f.path)?.page === rp);
    if (!rp.path) rp.path = mine[0]?.path ?? '';
    for (const f of mine) {
      const x = out.get(f.path)!;
      x.kind = kindOf(f, rp, f.path === rp.path);
      const ov = FEATURE_RELEASE.find(([re]) => re.test(f.name));
      if (ov && RELEASES.indexOf(ov[1]) > RELEASES.indexOf(rp.release)) x.release = ov[1];
    }
  }
  return { features: out, problems };
}
const BUILT = build();
export const FEATURES = BUILT.features;
export const ASSIGNMENT_PROBLEMS = BUILT.problems;
export const homeOf = (path: string): RealPage | undefined => FEATURES.get(path)?.page ?? REAL.find(r => r.path === path);
export const featuresOf = (id: string) => [...FEATURES.values()].filter(f => f.page.id === id);
export const realById = (id: string) => REAL.find(r => r.id === id);
export const isReleased = (r: Release, upTo: Release) => RELEASES.indexOf(r) <= RELEASES.indexOf(upTo);
