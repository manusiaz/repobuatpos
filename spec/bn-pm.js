window.BN_PM = {
 vision: ['BorNiz', 'Cloud POS for Indonesian F&B, retail, UMKM, franchise and services. One system for the counter, the kitchen, the guest’s phone and the owner’s dashboard.',
  [['North-star metric', 'Weekly paid transactions processed per active outlet'], ['Target customer (beachhead)', 'Cafés and casual restaurants, 1–10 outlets, Jabodetabek + Bandung + Surabaya'], ['Business model', 'SaaS per outlet: Free · Basic IDR 149k · Pro IDR 349k · Enterprise custom; payment MDR share on QRIS/VA'], ['Why we win', 'Fast counter UX, real offline, guest pages in the merchant’s own brand, approvals built for Indonesian shift teams']]],
 personas: [
  ['Budi', 'Owner · 3 outlets', '#F26B1D', 'Wants to see every outlet live on his phone and only decide what needs him.', ['Doesn’t know where to edit things', 'Finds out about cash shortfalls days later', 'Can’t compare outlets fairly'], ['Owner Dashboard', 'Owner Mobile', 'Menu Studio']],
  ['Andi', 'Outlet manager', '#2F6FEB', 'Runs one outlet: approvals, roster, stock, closing.', ['Paper rosters and WhatsApp swaps', 'Stock counts nobody trusts', 'Too many approval calls'], ['Manager Dashboard', 'Shifts', 'Menu Studio']],
  ['Maya', 'PIC (shift lead)', '#5B8CFF', 'Leads one shift, signs small things, hands over.', ['Has to call the manager for every void', 'Handover notes get lost'], ['PIC', 'Shifts']],
  ['Rina', 'Cashier', '#F26B1D', 'Takes orders and payments fast during the rush.', ['QRIS confusion at peak', 'Waiting for manager PIN'], ['POS Register']],
  ['Sari', 'Kitchen', '#1F9D55', 'Cooks in order, from 2 m away, wet hands.', ['Lost tickets', 'Delivery orders on a separate tablet'], ['Kitchen Display']],
  ['Dewi', 'Guest / member', '#1F4FD8', 'Orders from the table, pays QRIS, collects beans.', ['Queue at the counter', 'No idea how close she is to a reward'], ['Self Order', 'Loyalty', 'Customer Display']],
 ],
 epics: [
  ['E1', 'Counter selling', 'POS register, payments (cash, QRIS, card, e-wallet, VA, split), receipts, open bills, offline', 'Must', 'MVP', 13, ['POS Register', 'Customer Display'], [
   ['As a cashier, I tap products and charge in under 20 seconds.', ['Product tap gives feedback within 80 ms', 'Charge button always shows the live total', 'Cart survives app reload']],
   ['As a cashier, I take QRIS and see it paid without asking the guest.', ['QR shows on register and customer display', 'Paid state only from gateway webhook', 'QR expires after 5 min with a new-code button']],
   ['As a cashier, I keep selling when the internet drops.', ['Orders queue locally with idempotency key', 'Sync count is visible', 'No duplicate orders after reconnect']],
   ['As a guest, I split the bill evenly, by item or by amount.', ['Each part has its own method and status', 'Order closes only when all parts are paid']]]],
  ['E2', 'Kitchen & floor', 'KDS by station, timers, 86 list, waiter app, tables, online & delivery orders (tiers, ready-by, kitchen lanes, busy mode, pickup shelf)', 'Must', 'MVP', 8, ['Kitchen Display', 'Waiter', 'Online Orders'], [
   ['As a cook, I see tickets oldest first with timers.', ['Amber at 8 min, red at 12 min', 'Bump target 64 px']],
   ['As a cook, I mark an item sold out once and it disappears everywhere.', ['86 hits POS, QR menu, kiosk and delivery apps within 5 s', '86 is per outlet']],
   ['As staff, I accept delivery-app orders but can’t change them.', ['No add item / edit price on GoFood, GrabFood, ShopeeFood orders', 'Cancellation reason comes from the app']],
   ['As a cook, I see delivery orders in their own lane so rush orders never jump a dine-in table.', ['Split lanes: Dine-in & QR · Delivery & pickup', 'Delivery lane sorted Rush → Standard → Saver, then ready-by', 'Ready only by a KDS bump']],
   ['As a PIC, I turn on busy mode when the kitchen is slammed, without switching delivery off for the night.', ['Busy adds 10–20 min for new orders, ends by itself at 30 min', 'Pause max 60 min with a reason', 'Longer or repeated pauses alert manager and owner with lost-sales estimate']],
   ['As a cashier, I hand each bag to the right rider.', ['Pickup shelf slot per platform', 'Picked up only when the platform code matches', 'Wrong code needs PIC PIN + reason']],
   ['As a manager, scheduled orders aren’t cooked hours early.', ['Held until ready-by minus prep', 'Early fire needs a reason; over 30 min needs manager']]]],
  ['E3', 'Shifts, cash & approvals', 'Roster, clock-in, drawer sessions, blind counts, PIC limits, approval chain', 'Must', 'MVP', 8, ['Shifts', 'PIC', 'Manager Dashboard'], [
   ['As a PIC, I approve within my limits on my own tablet.', ['Discount ≤ 20%, void/refund ≤ IDR 100k, variance ≤ IDR 50k', 'Over the limit routes to manager, then owner', 'Nobody approves their own request']],
   ['As a cashier, I close my drawer with a blind count.', ['Expected amount hidden until submit', 'Variance over limit needs a note and sign-off']],
   ['As a manager, I build the week’s roster and see missing roles.', ['Exactly one PIC per shift', 'Coverage row turns red when a role is missing', 'Publish sends the roster to WhatsApp']]]],
  ['E4', 'Menu, stock & opname', 'Global vs local items, outlet prices ±10%, recipes & COGS, stock movements, opname, POs', 'Must', 'MVP → v1.1', 13, ['Menu Studio', 'Back Office', 'PIC'], [
   ['As an owner, I add an item once and it goes to all outlets.', ['Default scope All outlets', 'Outlets can hide but not delete', 'Local price within ±10% if allowed by franchise lock']],
   ['As a manager, I add a local item that waits for owner OK.', ['Invisible to guests until approved', '“Propose for all outlets” lets owner promote it']],
   ['As a PIC, I count stock blind with photos, and someone else signs.', ['Lines locked after submit; recount is a new line', 'Stock changes only as Opname adjustment after approval']]]],
  ['E5', 'Guest experience', 'QR self-order, kiosk, customer display, waiting & ready screens, digital receipts', 'Must', 'v1.0', 8, ['Self Order', 'Kiosk', 'Customer Display'], [
   ['As a guest, I order and pay from the table without an app.', ['Browse without login', 'Required options block Add', 'Status updates live from KDS']],
   ['As a guest, I see promos and flash-sale prices that match the counter.', ['Same promo data on QR menu, kiosk, display', 'Flash price applies at POS too']]]],
  ['E6', 'Customization', 'Menu Studio (brand, menu, pages & promos, receipts, display, kiosk, QR stand, member card), Brand Studio, publish & versions', 'Should', 'v1.1', 13, ['Menu Studio', 'Brand Studio', 'Studios'], [
   ['As an owner, I change logo, colors and banner and preview on a phone.', ['Contrast check blocks publish under 4.5:1', 'Status colors and payment marks stay locked']],
   ['As a manager, my publish waits for the owner.', ['Button reads “Send to owner”', 'Owner approves from phone']],
   ['As an owner, I build a flash sale and it runs everywhere.', ['Discount, items, duration', 'Ends automatically']]]],
  ['E7', 'Loyalty & marketing', 'Beans, tiers, stamps, missions, rewards, vouchers, WABA automations, broadcast', 'Should', 'v1.2', 8, ['Loyalty', 'Studios'], [
   ['As a member, I see how close I am to the next reward.', ['Ring progress to next tier', 'Locked rewards show beans missing']],
   ['As an owner, I send a thank-you WhatsApp after each visit.', ['Only to opted-in guests', 'Meta-approved template', 'Delivery status in message log']]]],
  ['E8', 'Owner insight', 'Live monitor, decision inbox, outlet comparison, P&L, reports & export, owner mobile', 'Must', 'v1.0', 8, ['Owner Dashboard', 'Owner Mobile'], [
   ['As an owner, I see today per hour, 15 min or per minute live.', ['Compare line = same period last week', 'Short money format IDR 2,4 jt in charts']],
   ['As an owner, I decide refunds over IDR 500k from my phone.', ['Push + WhatsApp notification', 'Approve/Reject with note, logged']]]],
  ['E9', 'Platform & billing', 'Sign-up, onboarding, plans, invoices, super admin, feature flags, audit', 'Must', 'MVP', 5, ['Auth', 'Super Admin'], [
   ['As a new owner, I go from sign-up to first sale in 5 minutes.', ['WhatsApp OTP', 'Every onboarding step skippable', 'Free plan needs no card']],
   ['As BorNiz support, I get time-boxed access to a tenant.', ['Owner approves access', 'Every action audited']]]],
 ],
 roadmap: [
  ['MVP', 'Month 1–3', 'Sell, cook, pay, close the day at one outlet', ['E1 Counter selling', 'E2 Kitchen & floor (no delivery apps yet)', 'E3 Shifts & approvals', 'E4 Menu & basic stock', 'E9 Sign-up, Free & Basic plans'], ['20 pilot outlets', '≥ 95% orders synced < 10 s', 'Checkout median < 20 s']],
  ['v1.0', 'Month 4–5', 'Guests order themselves; owner sees everything', ['E5 QR self-order, customer display', 'E8 Owner dashboard & mobile', 'E2 Delivery-app inbox (GoFood first)', 'Pro plan'], ['200 paying outlets', '30% of dine-in orders via QR', 'Owner WAU ≥ 70%']],
  ['v1.1', 'Month 6–7', 'Every client looks like their own brand', ['E6 Menu Studio, Brand Studio, publish & versions', 'E4 Recipes, COGS, opname with photos, POs', 'Kiosk'], ['50% of Pro tenants publish a custom theme', 'Opname variance ↓ 30%']],
  ['v1.2', 'Month 8–9', 'Bring guests back', ['E7 Loyalty, vouchers, WABA automations', 'Referral', 'GrabFood & ShopeeFood'], ['Repeat-visit rate ↑ 15% for members', 'Monthly churn < 2.5%']],
  ['v2', 'Month 10+', 'Franchise & enterprise', ['Franchise lock & royalties', 'Multi-brand', 'API, webhooks, SSO', 'Accounting sync (Jurnal, Accurate)'], ['10 Enterprise logos', 'Net revenue retention > 110%']],
 ],
 metrics: [
  ['Online orders', 'Online orders late', '< 5% past ready-by'],
  ['Online orders', 'Accept time', 'median < 60 s, none > 3 min'],
  ['Online orders', 'Channel pause minutes', '< 30 min / outlet / week'],
  ['Activation', 'First paid transaction within 24 h of sign-up', '≥ 60%'], ['Speed', 'Median time from first tap to payment', '< 20 s'], ['Reliability', 'Orders lost or duplicated', '0 per 10k'], ['Realtime', 'Order → KDS ticket latency (p95)', '< 2 s'],
  ['Adoption', 'Share of dine-in orders via QR', '≥ 30% at v1.0'], ['Owner engagement', 'Owners opening the app ≥ 3 days a week', '≥ 70%'], ['Control', 'Approvals decided < 5 min', '≥ 80%'], ['Retention', 'Logo churn per month', '< 2.5%'], ['Revenue', 'ARPA per outlet', 'IDR 260k+'],
 ],
 risks: [
  ['Delivery apps slow dine-in', 'High', 'Split kitchen lanes with dine-in share; busy mode; ready-by is calculated, never typed'],
  ['QRIS/VA gateway downtime at peak', 'High', 'Two gateways with automatic failover; static QRIS fallback; clear “waiting” state'],
  ['Offline sync conflicts', 'High', 'Server is source of truth; idempotency keys; conflicts only on stock, resolved by movements'],
  ['Delivery-app API access and rate limits', 'Medium', 'Start with one partner; read-only design; fallback to their tablet'],
  ['Owners overwhelmed by settings', 'Medium', 'Help with step-by-step tours; Get-started checklist; sensible defaults per industry template'],
  ['WABA template rejection / cost', 'Medium', 'Pre-approved template library; per-conversation cost shown before sending'],
  ['PB1/PPN rules differ by city', 'Medium', 'Tax per outlet; tax report export; accounting partners'],
 ],
 decisions: [
  ['Who sets ready-by', 'Calculated from tier + channel prep + kitchen load', 'Hand edits hide lateness; busy mode is the only lever'],
  ['Online orders in back office', 'Incoming only; status changes logged', 'A sale only exists if a guest or platform placed it'],
  ['Approval chain', 'Cashier → PIC → Manager → Owner by amount', 'Removes most calls to the manager, keeps owner control on big money'],
  ['Manager = owner tools minus a few', 'Manager can customize, but prices, publishing, payroll and refunds > 500k need owner OK', 'Managers run outlets day to day; owners keep brand and money control'],
  ['Global vs local menu', 'Owner items global by default; manager items local and pending', 'Franchise consistency without blocking outlet-specific items'],
  ['Opname two-person rule', 'Counter can’t approve; photos on differences', 'Builds trust in stock numbers'],
  ['Delivery orders read only', 'Accept, cook, ready; no edits', 'Delivery apps own the order; edits cause disputes'],
  ['One promo source', 'Promos built in Menu Studio → Pages drive every guest screen and POS price', 'No drift between channels'],
 ],
 open: [
  ['Photo tiles vs text tiles on POS at peak?', 'E1', 'Test with 3 pilot cafés'], ['One drawer per cashier or per shift as default?', 'E3', 'Interview 10 managers'], ['List vs grid on QR menu for conversion?', 'E5', 'A/B in v1.0'], ['Beans naming per merchant or fixed?', 'E7', 'Owner survey'], ['Which delivery app first after GoFood?', 'E2', 'Pilot demand'],
 ],
 raci: [
  ['Prices & publishing', 'Owner', 'Owner', 'Manager', 'PIC, cashier'], ['Daily approvals', 'PIC / Manager', 'Manager', 'Owner', 'Cashier'], ['Roster', 'Manager', 'Manager', 'PIC', 'Staff'], ['Opname', 'PIC', 'Manager', 'Owner (> 500k)', 'Kitchen'], ['Brand & menu studio', 'Owner / Manager', 'Owner', 'Designer', 'All outlets'], ['Payroll', 'Owner', 'Owner', 'Manager', 'Staff'],
 ],
};
