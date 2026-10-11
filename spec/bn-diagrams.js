window.BN_DIAGRAMS = [
 ['ARCHITECTURE', '#141210', [
  ['arch', 'System architecture', 'Flowchart', 'Every client app talks to one API. Realtime goes per outlet over WebSocket. Shared devices keep working offline and sync later.',
   [['y', 'One API gateway; tenant from the token, outlet from the device pairing.'], ['y', 'Realtime channel per outlet: orders, tickets, 86 list, payments, approvals.'], ['y', 'POS, KDS and waiter keep an IndexedDB queue; every write has an idempotency key.'], ['n', 'Clients never talk to payment gateways or delivery apps directly.'], ['w', 'Reports read from a replica, never from the write database.']], ['POS Register', 'Kitchen Display', 'Owner Dashboard'],
`flowchart LR
  subgraph Clients
    POS[POS register]:::staff
    PIC[PIC tablet]:::staff
    KDS[Kitchen display]:::staff
    WAI[Waiter phone]:::staff
    CD[Customer display]:::guest
    SO[QR self-order]:::guest
    KI[Kiosk]:::guest
    BO[Back office<br/>owner / manager]:::mgmt
    OM[Owner mobile]:::mgmt
    SA[Super admin]:::admin
  end
  subgraph Edge
    GW[API gateway<br/>auth · tenant · rate limit]
    WS[Realtime<br/>WebSocket per outlet]
  end
  subgraph Services
    AUTH[Auth & devices]
    CAT[Catalog & menu scope]
    ORD[Orders]
    PAY[Payments]
    INV[Inventory & opname]
    SHF[Shifts & cash]
    APR[Approvals]
    LOY[Loyalty]
    PRM[Promos & pages]
    THM[Themes & studios]
    NOT[Notifications · WABA]
    REP[Reports]
    INT[Integrations]
    BIL[Billing & plans]
  end
  subgraph Data
    PG[(Postgres primary)]
    RO[(Read replica)]
    RD[(Redis pub/sub)]
    S3[(Object storage)]
  end
  subgraph External
    PGW[Payment gateway<br/>QRIS · VA · e-wallet]
    EDC[EDC terminal]
    DLV[GoFood · GrabFood · ShopeeFood]
    WA[WhatsApp Business API]
  end
  POS & PIC & KDS & WAI & CD & SO & KI & BO & OM & SA --> GW
  POS & PIC & KDS & WAI & CD & BO & OM -. subscribe .-> WS
  GW --> AUTH & CAT & ORD & PAY & INV & SHF & APR & LOY & PRM & THM & REP & BIL
  ORD & PAY & INV & SHF & APR --> RD --> WS
  AUTH & CAT & ORD & PAY & INV & SHF & APR & LOY & PRM & THM & BIL --> PG
  REP --> RO
  PG -. replicate .-> RO
  INV & THM & CAT --> S3
  PAY <--> PGW
  POS <-. local .-> EDC
  INT <--> DLV
  NOT --> WA
  INT --> ORD
  classDef staff fill:#FFF3EB,stroke:#F26B1D,color:#141210
  classDef guest fill:#E6EEFD,stroke:#1F4FD8,color:#141210
  classDef mgmt fill:#E3F5EA,stroke:#1F9D55,color:#141210
  classDef admin fill:#EFE7FD,stroke:#7C3AED,color:#141210`],
  ['domains', 'Service events', 'Flowchart', 'Which service owns which data and which events connect them. A service writes only its own tables; others react to its events.',
   [['y', 'Orders owns orders and lines. Payments owns payments and refunds.'], ['y', 'Inventory changes stock only through stock movements.'], ['y', 'Approvals is generic: any service raises a request and listens for the decision.'], ['n', 'No service writes another service’s tables.']], ['Connections', 'Operations Guide'],
`flowchart TB
  ORD[Orders] -- order.paid --> INV[Inventory]
  ORD -- order.paid --> LOY[Loyalty]
  ORD -- order.created --> KT[(Kitchen tickets)]
  PAY[Payments] -- payment.settled --> ORD
  PAY -- refund.requested --> APR[Approvals]
  APR -- approval.decided --> PAY
  INV -- opname.submitted --> APR
  APR -- approval.decided --> INV
  CAT[Catalog] -- item.local_created --> APR
  APR -- approval.decided --> CAT
  CAT -- item.86 --> INT[Integrations]
  SHF[Shifts & cash] -- drawer.variance --> APR
  PRM[Promos] -- flash.started --> CAT
  THM[Themes] -- publish.requested --> APR
  ORD & PAY & INV & SHF --> REP[Reports]
  APR -- every decision --> AUD[(Audit log)]`],
 ]],
 ['DATA MODEL', '#F26B1D', [
  ['erd-core', 'Tenant, people & devices', 'Entity relationship', 'Multi-tenant: every row has tenant_id. Roles are per outlet. PIC is a flag on a shift assignment, not a permanent role.',
   [['y', 'tenant_id on every table, enforced with row-level security.'], ['y', 'One person can be manager at one outlet and cashier at another.'], ['y', 'Devices pair to one outlet; staff sign in on them with a PIN.'], ['n', 'Never store PINs in plain text.']], ['Roles', 'Shifts', 'Super Admin'],
`erDiagram
  TENANT ||--o{ BRAND : has
  TENANT ||--o{ OUTLET : has
  BRAND ||--o{ OUTLET : groups
  TENANT ||--o{ USER : employs
  USER ||--o{ ROLE_ASSIGNMENT : holds
  OUTLET ||--o{ ROLE_ASSIGNMENT : scopes
  OUTLET ||--o{ DEVICE : pairs
  TENANT ||--|| SUBSCRIPTION : pays
  TENANT ||--o| FRANCHISE_LOCK : sets
  TENANT {
    uuid id PK
    string name
    string plan
  }
  OUTLET {
    uuid id PK
    uuid tenant_id FK
    uuid brand_id FK
    string name
    string timezone
    int pb1_bps
  }
  USER {
    uuid id PK
    uuid tenant_id FK
    string phone
    string email
    string pin_hash
    bool twofa
  }
  ROLE_ASSIGNMENT {
    uuid user_id FK
    uuid outlet_id FK
    string role "owner manager cashier kitchen waiter"
  }
  DEVICE {
    uuid id PK
    uuid outlet_id FK
    string kind "pos kds display kiosk pic"
    datetime last_seen
  }
  FRANCHISE_LOCK {
    uuid tenant_id FK
    bool menu_prices
    bool outlet_only_items
    bool brand
  }`],
  ['erd-menu', 'Menu scope & prices', 'Entity relationship', 'One product table for global and local items. Each outlet has a row with its local price, availability (86) and hidden flag.',
   [['y', 'scope = global (owner) or local (manager, needs owner OK).'], ['y', 'OUTLET_PRODUCT.local_price must stay within ±10% of base_price.'], ['y', 'is_86 is per outlet.'], ['n', 'Outlets can’t delete a global product, only hide it.'], ['w', 'promote_requested = the manager proposed a local item for all outlets.']], ['Menu Studio', 'Back Office', 'Kitchen Display'],
`erDiagram
  CATEGORY ||--o{ PRODUCT : groups
  PRODUCT ||--o{ OUTLET_PRODUCT : "per outlet"
  OUTLET ||--o{ OUTLET_PRODUCT : lists
  PRODUCT ||--o{ PRODUCT_MODIFIER_GROUP : uses
  MODIFIER_GROUP ||--o{ MODIFIER : has
  PRODUCT ||--o{ RECIPE_LINE : "made of"
  STOCK_ITEM ||--o{ RECIPE_LINE : "used in"
  PRODUCT ||--o{ PRICE_CHANGE : history
  PRODUCT {
    uuid id PK
    uuid tenant_id FK
    string scope "global local"
    uuid owner_outlet_id FK
    int base_price
    string status "draft pending_owner live archived"
    bool promote_requested
  }
  OUTLET_PRODUCT {
    uuid product_id FK
    uuid outlet_id FK
    int local_price
    bool is_86
    bool hidden
  }
  PRICE_CHANGE {
    uuid id PK
    uuid product_id FK
    int old_price
    int new_price
    uuid requested_by
    uuid approved_by
  }
  RECIPE_LINE {
    uuid product_id FK
    uuid stock_item_id FK
    float qty
    string unit
  }`],
  ['erd-sales', 'Orders & payments', 'Entity relationship', 'Every order belongs to a business day, a shift and a drawer session. Refunds are new records; a paid order is never edited.',
   [['y', 'Money is integer rupiah; format only at render.'], ['y', 'ORDER.source: pos, qr, kiosk, waiter, gofood, grabfood, shopeefood.'], ['n', 'Delivery-app orders are read only in the back office.'], ['n', 'A refund never edits the payment row.']], ['POS Register', 'Self Order', 'Owner Dashboard'],
`erDiagram
  BUSINESS_DAY ||--o{ SHIFT : splits
  SHIFT ||--o{ DRAWER_SESSION : opens
  DRAWER_SESSION ||--o{ ORDER : records
  ORDER ||--o{ ORDER_LINE : contains
  ORDER_LINE ||--o{ LINE_MODIFIER : has
  ORDER ||--o{ PAYMENT : "paid by"
  PAYMENT ||--o{ REFUND : reversed
  CUSTOMER |o--o{ ORDER : member
  RESTAURANT_TABLE |o--o{ ORDER : at
  ORDER {
    uuid id PK
    uuid outlet_id FK
    uuid session_id FK
    string source
    string type "dine take delivery"
    string status
    int subtotal
    int tax
    int service
    int total
    string idem_key
  }
  ORDER_LINE {
    uuid id PK
    uuid order_id FK
    uuid product_id FK
    int qty
    int unit_price
    bool flash
  }
  PAYMENT {
    uuid id PK
    uuid order_id FK
    string method "cash qris card ewallet va"
    int amount
    string status
    string gateway_ref
  }
  REFUND {
    uuid id PK
    uuid payment_id FK
    int amount
    string reason
    uuid approval_id FK
  }`],
  ['erd-stock', 'Stock, opname & purchasing', 'Entity relationship', 'Stock level is a cache of the sum of movements. Opname creates a movement only after approval.',
   [['y', 'Every stock change is a STOCK_MOVEMENT with a type and source id.'], ['y', 'OPNAME_LINE.counted is locked after submit; a correction is a new recount line.'], ['y', 'Photos live in object storage, linked from OPNAME_PHOTO.'], ['n', 'counted_by can’t equal approved_by.']], ['PIC', 'Manager Dashboard', 'Back Office'],
`erDiagram
  STOCK_ITEM ||--o{ STOCK_LEVEL : "per outlet"
  STOCK_ITEM ||--o{ STOCK_MOVEMENT : moves
  OPNAME ||--o{ OPNAME_LINE : counts
  OPNAME_LINE ||--o{ OPNAME_PHOTO : proves
  STOCK_ITEM ||--o{ OPNAME_LINE : "counted as"
  OPNAME |o--o| APPROVAL_REQUEST : needs
  SUPPLIER ||--o{ PURCHASE_ORDER : receives
  PURCHASE_ORDER ||--o{ PO_LINE : lists
  PURCHASE_ORDER ||--o{ GOODS_RECEIPT : "delivered as"
  STOCK_MOVEMENT {
    uuid id PK
    uuid outlet_id FK
    uuid stock_item_id FK
    float qty
    string type "sale receipt transfer waste opname_adjustment"
    uuid source_id
    uuid by_user
    datetime at
  }
  OPNAME {
    uuid id PK
    uuid outlet_id FK
    string area
    uuid counted_by
    uuid approved_by
    string status
    int variance_value
  }
  OPNAME_LINE {
    uuid id PK
    uuid opname_id FK
    float system_qty
    float counted
    bool locked
    uuid recount_of FK
  }
  OPNAME_PHOTO {
    uuid line_id FK
    string url
    datetime taken_at
  }`],
  ['erd-ops', 'Shifts, approvals, loyalty & audit', 'Entity relationship', 'Approvals are one generic table. Loyalty is an append-only ledger. The audit log keeps before and after for every change.',
   [['y', 'level_required is computed from type and amount when the request is created.'], ['y', 'Exactly one SHIFT_ASSIGNMENT per shift has is_pic = true.'], ['y', 'Loyalty balance = sum of ledger rows.'], ['n', 'Audit rows are never updated or deleted.']], ['Shifts', 'Loyalty', 'Operations Guide'],
`erDiagram
  SHIFT ||--o{ SHIFT_ASSIGNMENT : staffs
  USER ||--o{ SHIFT_ASSIGNMENT : works
  SHIFT_ASSIGNMENT ||--o{ CLOCK_EVENT : logs
  APPROVAL_REQUEST ||--o{ APPROVAL_DECISION : gets
  CUSTOMER ||--o{ LOYALTY_LEDGER : earns
  CUSTOMER ||--o| MEMBERSHIP : holds
  TIER ||--o{ MEMBERSHIP : grants
  SHIFT_ASSIGNMENT {
    uuid shift_id FK
    uuid user_id FK
    string role
    bool is_pic
    string station
  }
  APPROVAL_REQUEST {
    uuid id PK
    string type "discount void refund variance price publish local_item payroll"
    int amount
    string level_required "pic manager owner"
    string status "waiting approved rejected recount"
    uuid requested_by
    uuid subject_id
  }
  APPROVAL_DECISION {
    uuid request_id FK
    uuid by_user
    string decision
    string note
    datetime at
  }
  LOYALTY_LEDGER {
    uuid id PK
    uuid customer_id FK
    int points
    string reason
    uuid order_id FK
  }
  AUDIT_LOG {
    uuid id PK
    uuid tenant_id FK
    uuid actor
    string action
    json before
    json after
    datetime at
  }`],
 ]],
 ['STATE MACHINES', '#1F9D55', [
  ['st-order', 'Order lifecycle', 'State', 'One order, every channel. Delivery orders enter as accepted and can’t be edited by staff.',
   [['y', 'Paid is final; changes after that are refunds.'], ['y', 'Void before payment needs PIC when above cashier limit.'], ['n', 'Delivery orders: no void or price change in BorNiz.']], ['POS Register', 'Kitchen Display', 'Waiter'],
`stateDiagram-v2
  [*] --> Open : add first item
  Open --> Sent : send to kitchen
  Open --> Held : save bill
  Held --> Open : reopen
  Sent --> Preparing : KDS starts
  Preparing --> Ready : bump
  Ready --> Served : waiter / pickup
  Open --> Paying : charge
  Served --> Paying : charge
  Paying --> Paid : payment settled
  Paying --> Open : payment failed
  Open --> Voided : void (PIC if over limit)
  Paid --> PartRefunded : refund approved
  Paid --> Refunded : full refund approved
  Paid --> [*]
  Refunded --> [*]
  Voided --> [*]`],
  ['st-pay', 'Payment (QRIS / VA / card)', 'State', 'The client shows the state; only the gateway webhook moves a payment to Settled.',
   [['y', 'QRIS expires after 5 minutes; a new attempt makes a new payment row.'], ['y', 'Webhook is idempotent on gateway_ref.'], ['n', 'Never mark Settled from the client.']], ['POS Register', 'Customer Display', 'Self Order'],
`stateDiagram-v2
  [*] --> Created
  Created --> Pending : QR / VA / push shown
  Pending --> Settled : gateway webhook
  Pending --> Expired : timeout
  Pending --> Failed : declined
  Expired --> [*]
  Failed --> [*]
  Settled --> RefundRequested : refund raised
  RefundRequested --> Refunded : approved + gateway OK
  RefundRequested --> Settled : rejected
  Settled --> [*]`],
  ['st-opname', 'Stock opname', 'State', 'Blind count, locked after submit, approved by someone else, stock changes only at the end.',
   [['y', 'Variance ≤ IDR 50k → another PIC; ≤ 500k → manager; > 500k → owner.'], ['y', 'Every line with a difference needs a photo (or every line, if the manager requires it).'], ['n', 'The counter can’t approve their own count.']], ['PIC', 'Manager Dashboard'],
`stateDiagram-v2
  [*] --> Counting : PIC starts, system qty hidden
  Counting --> Submitted : submit with photos
  Submitted --> Locked : lines locked
  Locked --> Recount : approver asks recount
  Recount --> Submitted : new recount lines
  Locked --> Approved : approver signs
  Locked --> Rejected
  Approved --> Posted : stock movement opname_adjustment
  Posted --> [*]
  Rejected --> [*]`],
  ['st-menu', 'Menu item scope', 'State', 'Owner items go live everywhere. Manager items stay local and wait for the owner.',
   [['y', 'Owner can keep a local item local or promote it to global.'], ['y', 'Franchise lock “Allow outlet-only items” off = managers can’t create local items.'], ['n', 'Global items can’t be deleted by an outlet.']], ['Menu Studio', 'Back Office'],
`stateDiagram-v2
  state "Owner adds" as OA
  state "Manager adds" as MA
  [*] --> OA
  [*] --> MA
  OA --> GlobalLive : all outlets
  MA --> PendingOwner : local, waits
  PendingOwner --> LocalLive : owner approves
  PendingOwner --> Rejected
  LocalLive --> PromoteRequested : manager proposes
  PromoteRequested --> GlobalLive : owner promotes
  PromoteRequested --> LocalLive : owner keeps local
  GlobalLive --> HiddenAtOutlet : manager hides
  HiddenAtOutlet --> GlobalLive
  LocalLive --> Archived : manager archives
  GlobalLive --> Deleted : owner deletes
  Deleted --> [*]`],
  ['st-shift', 'Shift & drawer session', 'State', 'People change, the counter stays. Every sale belongs to one drawer session.',
   [['y', 'Blind count at close; variance over the PIC limit goes up.'], ['y', 'A forgotten session auto-closes at outlet closing + 30 min.']], ['Shifts', 'PIC', 'POS Register'],
`stateDiagram-v2
  [*] --> Scheduled
  Scheduled --> ClockedIn : PIN + selfie
  ClockedIn --> DrawerOpen : count opening float
  DrawerOpen --> Selling
  Selling --> Counting : end of shift
  Counting --> VarianceCheck : submit blind count
  VarianceCheck --> Closed : within limit
  VarianceCheck --> NeedsApproval : over limit
  NeedsApproval --> Closed : PIC / manager signs
  Closed --> HandedOver : notes + float
  HandedOver --> [*]`],
 ]],
 ['SEQUENCES', '#2F6FEB', [
  ['sq-qris', 'QRIS payment at the counter', 'Sequence', 'The cashier and the guest see the same state. The register waits for the webhook, not for the guest.',
   [['y', 'Show the QR on the customer display and the register at once.'], ['y', 'Print the receipt only after Settled.']], ['POS Register', 'Customer Display'],
`sequenceDiagram
  autonumber
  participant C as Cashier POS
  participant API as BorNiz API
  participant PG as Payment gateway
  participant CD as Customer display
  participant G as Guest bank app
  C->>API: POST /orders/:id/payments {method: qris}
  API->>PG: create dynamic QRIS
  PG-->>API: qr_string, expires_at
  API-->>C: payment pending
  API-->>CD: realtime: show QR
  G->>PG: scan and pay
  PG->>API: webhook payment.settled
  API->>API: mark paid, emit order.paid
  API-->>C: realtime: paid
  API-->>CD: realtime: thank you
  C->>C: print receipt, open drawer if cash`],
  ['sq-refund', 'Big refund approval', 'Sequence', 'A cashier asks; the system routes it to the right level by amount.',
   [['y', 'Refund ≤ 100k: PIC. ≤ 500k: manager. > 500k: owner.'], ['y', 'Every step is in the audit log with both names.']], ['POS Register', 'PIC', 'Owner Mobile'],
`sequenceDiagram
  autonumber
  participant K as Cashier
  participant API as Approvals
  participant P as PIC
  participant M as Manager
  participant O as Owner phone
  participant PAY as Payments
  K->>API: request refund IDR 620,000 #2033
  API->>API: level_required = owner
  API-->>P: FYI only, over PIC limit
  API-->>M: FYI, over manager limit
  API-->>O: push + WhatsApp: approve?
  O->>API: approve with note
  API->>PAY: approval.decided
  PAY->>PAY: create REFUND row, call gateway
  PAY-->>K: refund done, print slip`],
  ['sq-delivery', 'Delivery-app order (read only)', 'Sequence', 'GoFood / GrabFood / ShopeeFood orders come in by webhook. Staff accept and cook; they can’t add items or change prices.',
   [['y', '86 in BorNiz pushes to every delivery app.'], ['n', 'No “add item” or “edit price” on these orders anywhere in BorNiz.'], ['w', 'Cancellations come from the app; BorNiz only shows the reason.']], ['Kitchen Display', 'POS Register', 'Back Office'],
`sequenceDiagram
  autonumber
  participant APP as GoFood / Grab / Shopee
  participant INT as Integrations
  participant ORD as Order service
  participant POS as POS inbox
  participant KDS as KDS (delivery lane)
  participant PIC as PIC
  APP->>INT: new order (items, prices, tier, scheduled?)
  INT->>ORD: create order · channel · tier
  ORD->>ORD: ready-by = tier + channel prep + kitchen load
  alt scheduled
    ORD->>ORD: hold until fire time (ready-by − prep)
  end
  ORD->>POS: show in inbox (channel, tier, ready-by)
  alt auto-accept on
    ORD->>APP: accepted
  else manual
    POS->>ORD: Accept (cashier / PIC)
    ORD->>APP: accepted
    Note over POS,PIC: not accepted 3 min → PIC → Manager
  end
  ORD->>KDS: ticket · sort Rush → Standard → Saver → ready-by
  KDS->>ORD: bump = ready (only way to set ready)
  ORD->>APP: ready · shelf slot
  Note over KDS,PIC: past ready-by → PIC · busy mode adds time for new orders
  APP->>POS: rider arrives with pickup code
  POS->>ORD: picked up (code must match, else PIC PIN)
  ORD->>APP: picked up · payout reconciles later`],
  ['sq-opname', 'Opname with co-sign', 'Sequence', 'Counter and approver are always two different people.',
   [['y', 'Stock moves only at Posted.'], ['y', 'Recount keeps the old lines in history.']], ['PIC', 'Manager Dashboard'],
`sequenceDiagram
  autonumber
  participant A as PIC Maya (counts)
  participant API as Inventory
  participant B as PIC Rina / Manager
  A->>API: start opname Storage
  API-->>A: items, system qty hidden
  A->>API: submit counts + photos
  API->>API: lock lines, compute variance
  API-->>B: approval request (by amount)
  alt recount
    B->>API: ask recount
    API-->>A: recount lines 2, 5
    A->>API: submit recount
  end
  B->>API: sign
  API->>API: post STOCK_MOVEMENT opname_adjustment
  API-->>A: done`],
  ['sq-local', 'Manager adds a local menu item', 'Sequence', 'Manager proposes, owner decides. Optional “propose for all outlets”.',
   [['y', 'Until approved, the item is invisible to guests and the POS.']], ['Menu Studio', 'Owner Mobile'],
`sequenceDiagram
  autonumber
  participant M as Manager (Menu Studio)
  participant CAT as Catalog
  participant O as Owner
  participant ALL as POS · QR · kiosk
  M->>CAT: create item scope=local, promote_requested=true
  CAT-->>O: approval: new local item
  alt keep local
    O->>CAT: approve local
    CAT-->>ALL: live at this outlet only
  else promote
    O->>CAT: promote to global
    CAT-->>ALL: live at all outlets
  end`],
  ['sq-thanks', 'Thank-you WhatsApp after a visit', 'Sequence', 'Automation runs from order.paid. Only sends if the guest opted in.',
   [['y', 'Uses a Meta-approved template.'], ['n', 'No message without opt-in.']], ['Studios', 'Loyalty'],
`sequenceDiagram
  autonumber
  participant ORD as Orders
  participant AUT as Automations
  participant NOT as Notifications
  participant WA as WhatsApp API
  participant G as Guest
  ORD->>AUT: order.paid (customer, outlet)
  AUT->>AUT: opted in? wait 60 min
  AUT->>NOT: send template thanks_visit
  NOT->>WA: template + variables
  WA-->>G: Terima kasih sudah mampir!
  G->>WA: taps Rate your visit
  WA-->>NOT: status read`],
 ]],
 ['ROLES', '#7C3AED', [
  ['approvals', 'Approval routing', 'Flowchart', 'One rule for every request: the amount decides who signs.',
   [['y', 'Every approve / reject needs the approver’s own 6-digit approval PIN (not the login password).'], ['y', 'Cashier → PIC (discount ≤ 20%, void/refund ≤ 100k, variance ≤ 50k) → Manager → Owner.'], ['y', 'Owner only: prices, publishing, payroll, refunds > 500k.'], ['n', 'Nobody approves their own request.']], ['Roles', 'PIC', 'Manager Dashboard'],
`flowchart TD
  R[Request raised] --> T{Type}
  T -- price / publish / payroll --> OW[Owner]
  T -- discount / void / refund / variance --> A{Amount}
  A -- within PIC limit --> PIC[PIC on shift]
  A -- up to IDR 500k --> MG[Manager]
  A -- over IDR 500k --> OW
  PIC -- not same person --> D[Decision]
  MG --> D
  OW --> D
  D --> AU[(Audit log)]
  D --> S[Service applies change]`],
 ]],
];
