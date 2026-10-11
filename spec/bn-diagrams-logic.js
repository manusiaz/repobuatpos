(function () {
var L = [
 ['lg-total', 'Order total calculation', 'Flowchart', 'How the register, QR menu and kiosk compute one total. Same function everywhere, run on the server; clients only preview.',
  [['y', 'All money is integer rupiah. Round only at the end (cash rounding is a separate line).'], ['y', 'Order: line price → modifiers → flash price → line discount → order discount → service → tax.'], ['n', 'Never compute tax on the client and send it.'], ['w', 'PB1 and PPN are per outlet; tax-inclusive outlets back-calculate.']], ['POS Register', 'Self Order', 'Kiosk'],
`flowchart TD
  A[Line: product + qty] --> B{Outlet price?}
  B -- local_price set --> C[use local_price]
  B -- no --> D[use base_price]
  C & D --> E[+ modifiers]
  E --> F{Flash sale active<br/>for this item?}
  F -- yes --> G[price × 1 − flash %<br/>round to 100]
  F -- no --> H[keep price]
  G & H --> I[line total = price × qty]
  I --> J{Line discount?}
  J -- yes --> K[apply, check cashier limit]
  J -- no --> L[subtotal = Σ lines]
  K --> L
  L --> M{Order discount / voucher?}
  M -- yes --> N[validate code, min spend, outlet, expiry]
  N --> O[subtotal − discount]
  M -- no --> O
  O --> P{Dine-in and service on?}
  P -- yes --> Q[service = 5% of O]
  P -- no --> R[service = 0]
  Q & R --> S{Tax mode}
  S -- exclusive --> T[tax = PB1 × O + service]
  S -- inclusive --> U[tax inside price, show only]
  T & U --> V{Cash and rounding on?}
  V -- yes --> W[round to IDR 100, add rounding line]
  V -- no --> X[total]
  W --> X
  K -. over limit .-> AP[[Approval: PIC]]`],
 ['lg-sync', 'Offline queue & sync', 'Flowchart', 'POS, KDS and waiter keep selling without internet. The server decides; the device replays.',
  [['y', 'Each write gets a client UUID + idempotency key before it is queued.'], ['y', 'Replay in creation order; stop on the first permanent error and show it.'], ['y', 'Payments that need a gateway (QRIS, VA) are blocked offline; cash and card EDC keep working.'], ['n', 'Never retry a payment capture without the idempotency key.']], ['POS Register', 'States Gallery'],
`flowchart TD
  A[User action] --> B[Write to IndexedDB queue<br/>uuid + idem_key + created_at]
  B --> C[Apply optimistically on screen]
  C --> D{Online?}
  D -- no --> E[Show offline badge + queued count]
  E --> F{Payment needs gateway?}
  F -- QRIS / VA / e-wallet --> G[Block, offer cash or card EDC]
  F -- cash / EDC --> H[Allow, mark pending sync]
  D -- yes --> I[Send next item]
  I --> J{Server response}
  J -- 200 / 409 already applied --> K[Remove from queue]
  J -- 5xx / timeout --> L[Backoff 1, 2, 4, 8 s]
  L --> I
  J -- 4xx permanent --> M[Stop queue, show error, ask PIC]
  K --> N{Queue empty?}
  N -- no --> I
  N -- yes --> O[Pull latest: menu, 86, prices, promos]
  O --> P[Hide offline badge]`],
 ['lg-86', 'Sold out (86) propagation', 'Flowchart', 'Mark once, gone everywhere for that outlet.',
  [['y', 'is_86 is per outlet; never changes other outlets.'], ['y', 'Auto-reset at business-day start if “reset daily” is on.'], ['n', 'A global item can be 86 at an outlet but never deleted by it.']], ['Kitchen Display', 'POS Register', 'Self Order'],
`flowchart LR
  K[Kitchen / PIC / manager taps 86] --> C[Catalog: OUTLET_PRODUCT.is_86 = true]
  C --> E[event item.86]
  E --> P[POS: tile 45%, not tappable]
  E --> Q[QR menu: Sold out, can’t add]
  E --> KI[Kiosk: hidden or badge]
  E --> CD[Customer display: removed from promos]
  E --> I[Integrations]
  I --> G[GoFood off]
  I --> GR[GrabFood off]
  I --> S[ShopeeFood off]
  C --> A[(Audit: who, when)]
  R[Business day starts] --> X{reset daily?}
  X -- yes --> Y[is_86 = false, event item.back]`],
 ['lg-promo', 'Promo & voucher resolution', 'Flowchart', 'Which promo wins when several apply. One promo engine for POS, QR menu, kiosk.',
  [['y', 'Flash price is a price, not a discount; vouchers apply on top only if “stackable”.'], ['y', 'Best single discount wins when not stackable.'], ['n', 'A voucher code can’t be used after its quota or expiry, even offline.']], ['Menu Studio', 'POS Register', 'Self Order'],
`flowchart TD
  A[Cart changed] --> B[Load active promos for outlet, channel, time]
  B --> C{Visibility rules}
  C -- member only and guest --> X[skip]
  C -- time / outlet / device mismatch --> X
  C -- ok --> D[Eligible list]
  D --> E{Flash items in cart?}
  E -- yes --> F[Set flash price on those lines]
  E -- no --> G[ ]
  F & G --> H{Voucher entered?}
  H -- yes --> I{Valid? quota, expiry, min spend, outlet}
  I -- no --> J[Show reason, keep cart]
  I -- yes --> K{Stackable with flash?}
  K -- no and flash lines --> L[Apply to non-flash lines only]
  K -- yes --> M[Apply to subtotal]
  H -- no --> N{Auto promos}
  N --> O[Pick best single, or sum if stackable]
  L & M & O --> P[Recalculate totals]
  P --> Q[Show savings line]`],
 ['lg-loyalty', 'Loyalty earning & tiers', 'Flowchart', 'Beans are earned on paid orders only and written to an append-only ledger.',
  [['y', 'Earn on subtotal before tax and service, after discounts.'], ['y', 'Refund reverses the earned beans with a negative ledger row.'], ['y', 'Tier is from lifetime beans in the last 12 months.'], ['n', 'Never let balance go negative; block redeem instead.']], ['Loyalty', 'POS Register'],
`flowchart TD
  A[order.paid with member] --> B[base = floor subtotal / 1000]
  B --> C[× tier multiplier<br/>Silver 1 · Gold 1.25 · Platinum 1.5]
  C --> D{2× beans day / hour?}
  D -- yes --> E[× 2]
  D -- no --> F[ ]
  E & F --> G[ledger +earned]
  G --> H{Stamp item in order?}
  H -- yes --> I[stamps + 1, at 10 → free drink reward]
  G --> J{4th visit this month?}
  J -- yes --> K[ledger +50]
  G --> L{Visited every week?}
  L -- yes --> M[ledger +30 streak]
  G --> N[Recompute lifetime 12 months]
  N --> O{≥ 2000 Platinum · ≥ 1000 Gold}
  O --> P[Update tier, notify if up]
  R[refund.done] --> S[ledger −earned for that order]
  T[Redeem reward] --> U{balance ≥ cost?}
  U -- yes --> V[ledger −cost, issue code 7 days]
  U -- no --> W[Show beans missing]`],
 ['lg-approval', 'Approval engine', 'Flowchart', 'One engine for every request type. Level is computed when the request is created.',
  [['y', 'Requester can’t decide. Counter can’t sign own opname.'], ['y', 'Timeouts escalate: PIC 5 min → manager, manager 30 min → owner (optional).'], ['y', 'Every decision writes APPROVAL_DECISION and AUDIT_LOG.']], ['PIC', 'Manager Dashboard', 'Owner Mobile'],
`flowchart TD
  A[Service raises request<br/>type, amount, subject] --> B{type}
  B -- price, publish, payroll, global item --> OW[level = owner]
  B -- local item, promote --> OW
  B -- discount --> D{≤ 20%?}
  D -- yes --> P[level = pic]
  D -- no --> M[level = manager]
  B -- void / refund --> R{amount}
  R -- ≤ 100k --> P
  R -- ≤ 500k --> M
  R -- > 500k --> OW
  B -- cash / opname variance --> V{amount}
  V -- ≤ 50k --> P
  V -- ≤ 500k --> M
  V -- > 500k --> OW
  P & M & OW --> N[Notify eligible deciders<br/>push, in-app, WhatsApp for owner]
  N --> Q{Decider = requester?}
  Q -- yes --> Z[Hide from them]
  Q -- no --> S{Decision}
  S -- approve --> T[event approval.decided ok]
  S -- reject --> U[event approval.decided no]
  S -- recount opname only --> W[back to counter]
  N -. timeout .-> E[Escalate one level]`],
 ['lg-menu', 'Menu change & publish', 'Flowchart', 'What happens when owner or manager changes the menu or the guest theme.',
  [['y', 'Owner publishes directly. Manager publish becomes “Send to owner”.'], ['y', 'Franchise lock “Menu prices” blocks local prices completely.'], ['y', 'Every publish creates a version; any version can be restored.']], ['Menu Studio', 'Back Office'],
`flowchart TD
  A[Edit in Menu Studio] --> B[Draft saved automatically]
  B --> C{Who taps Publish?}
  C -- owner --> D[Contrast check ≥ 4.5:1]
  C -- manager --> E{Change type}
  E -- local price within ±10% and not locked --> F[Allowed, apply at outlet]
  E -- price outside range / locked --> X[Blocked with reason]
  E -- theme, pages, global items, prices --> G[Approval: owner]
  G -- approved --> D
  G -- rejected --> B
  D -- fail --> H[Block, show which colors]
  D -- pass --> I[Create version vN]
  I --> J{Schedule?}
  J -- now --> K[Live on selected outlets]
  J -- later / seasonal --> L[Job at start time]
  L --> K
  K --> M[event theme.published / menu.updated]
  M --> N[QR menu, kiosk, display, POS refresh]`],
 ['lg-stock', 'Stock deduction & movements', 'Flowchart', 'Every sale, receipt, transfer and waste becomes a stock movement. Level = sum of movements.',
  [['y', 'Sale deducts by recipe at order.paid, not at add-to-cart.'], ['y', 'Refund with “return to stock” creates a positive movement.'], ['w', 'Low-stock alert at par level; suggests a PO.']], ['Back Office', 'Manager Dashboard'],
`flowchart LR
  S[order.paid] --> R{Product has recipe?}
  R -- yes --> L[for each RECIPE_LINE<br/>qty × line qty]
  R -- no, stock item --> D[1 × qty]
  L & D --> M[STOCK_MOVEMENT type=sale −qty]
  PO[Goods receipt] --> M2[movement receipt +qty]
  TR[Transfer out → in] --> M3[two movements, same transfer_id]
  W[Waste entry] --> M4[movement waste −qty, reason, photo]
  OP[Opname approved] --> M5[movement opname_adjustment ±diff]
  RF[Refund, return to stock] --> M6[movement +qty]
  M & M2 & M3 & M4 & M5 & M6 --> LV[(STOCK_LEVEL cache)]
  LV --> P{below par?}
  P -- yes --> A[Low-stock alert + PO suggestion]`],
 ['lg-shift', 'Shift handover & cash close', 'Flowchart', 'From end-of-shift reminder to the next cashier selling.',
  [['y', 'Open bills move with their table to the next cashier.'], ['y', 'Float for next shift is counted and left in the drawer.'], ['n', 'A shift can’t close with an unsigned variance.']], ['Shifts', 'PIC', 'POS Register'],
`flowchart TD
  A[15 min before end] --> B[Reminder on register]
  B --> C[List open bills]
  C --> D[Blind count by denomination]
  D --> E[variance = counted − expected cash]
  E --> F{variance}
  F -- 0 --> H[OK]
  F -- ≤ 50k --> G[Note + PIC signs]
  F -- ≤ 500k --> G2[Note + manager signs]
  F -- > 500k --> G3[Note + owner signs]
  G & G2 & G3 --> H
  H --> I[Set float, write notes]
  I --> J[Transfer open bills]
  J --> K[Clock out, X report to WhatsApp]
  K --> L[Next cashier PIN]
  L --> M[Confirm float]
  M --> N{matches?}
  N -- no --> O[Flag to manager]
  N -- yes --> P[New drawer session, sell]`],
 ['lg-auth', 'Sign-in, devices & PIN', 'Flowchart', 'Owners and managers sign in with account + 2FA. Shared devices are paired once; staff use PINs.',
  [['y', 'Device pairing code expires in 10 min and is single-use.'], ['y', '5 wrong PINs lock that person for 5 min on that device.'], ['n', 'PIN login never reaches back-office pages.']], ['Auth', 'POS Register', 'Roles'],
`flowchart TD
  A{Who?} -- owner / manager --> B[Email or WhatsApp + password]
  B --> C[OTP / 2FA]
  C --> D[Back office session, role from ROLE_ASSIGNMENT]
  A -- shared device --> E{Paired?}
  E -- no --> F[Show go.bornis.id code]
  F --> G[Owner / manager enters code in Apps]
  G --> H[Device bound to outlet, gets device token]
  E -- yes --> I[Lock screen: staff rostered now]
  H --> I
  I --> J[Pick person, enter PIN]
  J --> K{PIN ok?}
  K -- no --> L[count +1, lock at 5]
  K -- yes --> M[Load shell for role<br/>cashier · PIC · kitchen · waiter]
  M --> N{Clocked in?}
  N -- no --> O[Clock-in with selfie]
  N -- yes --> P[Work]`],
 ['lg-gate', 'Plan gating & limits', 'Flowchart', 'What happens when a tenant hits a plan limit.',
  [['y', 'Hide nothing: show the feature with an upgrade card.'], ['y', 'Downgrade keeps data read-only, never deletes.']], ['Super Admin', 'Landing'],
`flowchart TD
  A[Feature used] --> B{Plan includes it?}
  B -- yes --> C{Under limit?<br/>outlets, registers, KDS}
  C -- yes --> D[Allow]
  C -- no --> E[Upgrade wall: what you get, price]
  B -- no --> E
  E --> F{Owner?}
  F -- yes --> G[Checkout: QRIS, VA, card]
  F -- no --> H[Ask owner button → notification]
  G --> I[Subscription updated, flags on]
  J[Invoice unpaid 7 days] --> K[Banner, WhatsApp reminder]
  K --> L[Day 14: read-only back office<br/>POS keeps selling]`],
 ['lg-kds', 'Kitchen routing', 'Flowchart', 'Which station gets which item, and when.',
  [['y', 'Routing by category → station, override per product.'], ['y', 'Courses: send now or hold until “fire”.'], ['y', 'Expo screen sees the whole order.']], ['Kitchen Display', 'Waiter'],
`flowchart LR
  O[order.sent] --> L[for each line]
  L --> R{product.station or category.station}
  R -- Bar --> B[Bar KDS]
  R -- Grill --> G[Grill KDS]
  R -- Pastry --> P[Pastry KDS]
  R -- none --> X[Expo only]
  L --> H{course held?}
  H -- yes --> W[wait for fire from waiter / POS]
  W --> R
  B & G & P --> E[Expo: order complete?]
  E -- all bumped --> RD[order.ready → waiter, guest phone, queue screen]`],
 ['lg-notify', 'Notifications & automations', 'Flowchart', 'One rule engine for WhatsApp, email, push and in-app.',
  [['y', 'Respect opt-in and quiet hours 21:00–08:00 for marketing.'], ['y', 'Transactional (receipt, order ready) ignore quiet hours.'], ['n', 'Never send marketing to a guest who unsubscribed.']], ['Studios', 'Loyalty'],
`flowchart TD
  E[Event: order.paid, order.ready, birthday, inactive 30 d, points expiring] --> R[Find automations for tenant]
  R --> C{Conditions match?}
  C -- no --> X[stop]
  C -- yes --> T{Transactional?}
  T -- no --> O{Opted in and not quiet hours?}
  O -- no --> Q[Queue until 08:00 or drop]
  O -- yes --> D[Wait delay]
  T -- yes --> D
  D --> CH{Channel}
  CH -- WhatsApp --> W[Meta-approved template + variables]
  CH -- Email --> M[Sender domain, SPF/DKIM ok?]
  CH -- Push --> P[Member app token]
  W & M & P --> L[(Message log: sent, delivered, read, failed)]
  L --> K[Cost per conversation to billing]`],
 ['lg-table', 'Tables, QR & waiter calls', 'Flowchart', 'How a table QR binds a guest to a table and how calls reach staff.',
  [['y', 'One open bill per table by default; merge and move keep history.'], ['y', 'QR session expires 2 h after last activity.']], ['Self Order', 'Waiter', 'POS Register'],
`flowchart TD
  A[Guest scans T-07 QR] --> B{Table open bill?}
  B -- no --> C[Create bill for T-07, source qr]
  B -- yes --> D[Join same bill]
  C & D --> E[Guest orders]
  E --> F{Pay now or later?}
  F -- now --> G[QRIS on phone]
  F -- later --> H[Added to table bill]
  A --> I[Call waiter / bill / water]
  I --> J[Waiter app: Calls badge + sound]
  J --> K[Waiter taps Going]
  K --> L[Guest sees “Tono is coming”]
  M[POS: move / merge table] --> N[Bill moves, history kept]`],
];
L.unshift(['lg-alert', 'Alert engine (stock, cash, approvals, devices…)', 'Flowchart', 'One engine sends every alert in BorNiz. See the Alerts page for the full list of 160 alerts + 66 guest moments · 22 destinations and who gets each.',
  [['y', 'Scope to outlet; owners see all outlets.'], ['y', 'High: push + sound + owner WhatsApp; repeats until opened.'], ['y', 'Escalate PIC 5 min → manager 30 min → owner.'], ['n', 'Never alert the person who caused a fraud-type alert.']], ['Alerts', 'Owner Mobile', 'PIC'],
`flowchart TD
  E[Event from any service<br/>stock.level, drawer.variance, device.offline, review.created …] --> R[Match alert rules for tenant + outlet]
  R --> T{Threshold crossed?}
  T -- no --> X[ignore]
  T -- yes --> D{Duplicate in last 30 min?}
  D -- yes --> U[update existing alert count]
  D -- no --> W[Find recipients by role + outlet + station]
  W --> F[Remove: off-shift staff, the person who caused it]
  F --> Q{Quiet hours and not High?}
  Q -- yes --> G[Hold for digest 08:00]
  Q -- no --> L{Urgency}
  L -- High --> H[push + sound on devices + owner WhatsApp]
  L -- Warning --> I[in-app + push]
  L -- Info --> J[in-app + daily digest]
  H & I & J --> AC[(Alert center, links to fix screen)]
  AC --> K{Resolved / acted on in time?}
  K -- yes --> OK[close, log who and what]
  K -- no --> ESC[Escalate one level<br/>PIC → manager → owner]
  ESC --> L
  S1[stock below par] -. example .-> E
  S2[stock = 0 → auto-86] -. example .-> E`]);
SEQ0 = 1;
var SEQ = [
 ['sq-lowstock', 'Low stock end to end', 'Sequence', 'From the last sale that drops an item below par to stock on the shelf.',
  [['y', 'PIC first, manager in parallel, owner only if not handled in 24 h.']], ['Alerts', 'PIC', 'Manager Dashboard'],
`sequenceDiagram
  autonumber
  participant POS as POS sale
  participant INV as Inventory
  participant AL as Alert engine
  participant P as PIC tablet
  participant M as Manager
  participant O as Owner
  POS->>INV: order.paid, deduct recipe (oat milk −0.2 L)
  INV->>INV: level 2.8 L < par 12 L
  INV->>AL: stock.low (Senayan, oat milk)
  AL-->>P: Low stock · Request stock
  AL-->>M: Low stock · Create PO
  P->>INV: stock request 10 L
  INV-->>M: request from PIC
  M->>INV: create PO / transfer from Kemang
  INV->>INV: level 0 later? → stock.out
  INV->>AL: stock.out → auto-86 products using it
  AL-->>O: only if not resolved in 24 h or item is top-10
  M->>INV: goods receipt +20 L
  INV->>AL: resolved, close alerts`],
 ['sq-split', 'Split bill by item', 'Sequence', 'Each part is its own payment; the order closes when all parts are paid.',
  [['y', 'Unpaid parts stay visible to all guests at the table.']], ['POS Register', 'Self Order'],
`sequenceDiagram
  autonumber
  participant C as Cashier
  participant API as Orders
  participant PAY as Payments
  C->>API: split order #2048 by item (3 parts)
  API-->>C: parts A, B, C with totals
  C->>PAY: part A QRIS
  PAY-->>API: settled A
  C->>PAY: part B cash
  PAY-->>API: settled B
  C->>PAY: part C card
  PAY-->>API: settled C
  API->>API: all parts paid → order.paid
  API-->>C: print 3 receipts or 1 combined`],
 ['sq-pair', 'Pair a shared device', 'Sequence', 'Owner pairs a tablet once; staff then use PINs.',
  [['y', 'Code single-use, 10 minutes.']], ['Auth', 'POS Register'],
`sequenceDiagram
  autonumber
  participant T as New tablet
  participant API as Auth & devices
  participant O as Owner (Apps)
  T->>API: open go.bornis.id
  API-->>T: show 6-digit code
  O->>API: enter code, choose outlet + kind=pos
  API->>API: create DEVICE, issue device token
  API-->>T: paired to Senayan · POS
  T->>API: load menu, staff on roster
  T-->>T: lock screen with PIN login`],
 ['sq-flash', 'Flash sale start to end', 'Sequence', 'Owner builds once in Menu Studio; every channel follows.',
  [['y', 'Prices revert automatically at end time.']], ['Menu Studio', 'POS Register', 'Self Order'],
`sequenceDiagram
  autonumber
  participant O as Owner
  participant PRM as Promos
  participant CAT as Catalog
  participant CH as POS · QR · kiosk · display
  O->>PRM: publish flash 30% on 4 items, 2 h
  PRM->>CAT: flash.started (items, %, ends_at)
  CAT-->>CH: realtime: new prices + banner
  Note over CH: guests and cashiers see the same price
  PRM->>PRM: timer ends_at
  PRM->>CAT: flash.ended
  CAT-->>CH: realtime: normal prices`],
 ['sq-po', 'Purchase order to stock', 'Sequence', 'From low stock to received goods.',
  [['y', 'Partial receipt keeps the PO open.']], ['Back Office', 'Manager Dashboard'],
`sequenceDiagram
  autonumber
  participant INV as Inventory
  participant M as Manager
  participant O as Owner
  participant S as Supplier
  INV-->>M: oat milk below par, suggest PO
  M->>INV: create PO 40 L
  INV-->>O: approval if over budget
  O->>INV: approve
  INV->>S: send PO via WhatsApp / PDF
  S-->>M: deliver 30 L
  M->>INV: goods receipt 30 L (partial)
  INV->>INV: movement receipt +30
  INV-->>M: PO open, 10 L outstanding`],
];
var A = window.BN_DIAGRAMS || (window.BN_DIAGRAMS = []);
A.splice(1, 0, ['BUSINESS LOGIC', '#E5A000', L]);
var seq = A.find(function (g) { return g[0] === 'SEQUENCES'; });
if (seq) SEQ.forEach(function (s) { seq[2].push(s); });
})();
