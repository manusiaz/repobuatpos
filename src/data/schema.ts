// Tables follow the ERD in spec/bn-diagrams.js (DATA MODEL). Every row is tenant-scoped on the server (RLS);
// the local adapter holds one tenant. Money is integer rupiah.
import type { IDR } from '../domain/money.ts';
import type { Method, OrderStatus, PaymentStatus, Source } from '../domain/order.ts';
import type { Level, RequestType } from '../domain/approval.ts';
import type { LedgerRow } from '../domain/loyalty.ts';
import type { Movement, OpnameLine } from '../domain/stock.ts';
import type { Promo } from '../domain/promo.ts';
import type { ProductStatus, Scope } from '../domain/menu.ts';

export type Role = 'owner' | 'manager' | 'pic' | 'cashier' | 'kitchen' | 'waiter' | 'admin' | 'customer' | 'public';

export interface Outlet { id: string; name: string; city: string; serviceBps: number; taxBps: number; taxInclusive: boolean; opens: string; closes: string; tables: number; online: boolean }
export interface Employee { id: string; name: string; role: Role; outlets: string[]; pin: string; approvalPin: string; phone: string; color: string; active: boolean; wage: IDR }
export interface Category { id: string; name: string; station: 'bar' | 'kitchen' | 'pastry' }
export interface ModifierGroup { id: string; name: string; required: boolean; max: number; options: { id: string; name: string; price: IDR }[] }
export interface Product { id: string; name: string; categoryId: string; basePrice: IDR; /** data URL or storage URL set in Menu Studio */ photo?: string; scope: Scope; ownerOutletId: string | null; status: ProductStatus; hue: number; sku: string; desc: string; modifierGroupIds: string[]; promoteRequested?: boolean; cost: IDR }
export interface OutletProduct { productId: string; outletId: string; localPrice: IDR | null; is86: boolean; hidden: boolean }
export interface StockItem { id: string; name: string; unit: string; unitCost: IDR; par: number }
export interface Recipe { productId: string; stockItemId: string; qty: number }
export interface Customer { id: string; name: string; phone: string; email: string; joinedAt: number; optIn: boolean; birthday?: string; credit: IDR; deposit: IDR }

export interface OrderLine { id: string; productId: string; name: string; qty: number; unitPrice: IDR; flashPrice: IDR | null; mods: { name: string; price: IDR }[]; note: string; discountPct: number; station: Category['station']; kds: 'new' | 'cooking' | 'done'; fired: boolean; firedAt?: number }
export interface Order {
  id: string; no: string; outletId: string; sessionId: string | null; source: Source; type: 'dine' | 'take' | 'delivery'; status: OrderStatus;
  table: string | null; customerId: string | null; lines: OrderLine[]; discountPct: number; promoIds: string[]; guests: number;
  subtotal: IDR; discount: IDR; service: IDR; tax: IDR; total: IDR; createdAt: number; paidAt: number | null; cashierId: string | null;
  tier?: 'rush' | 'standard' | 'saver'; readyBy?: number; idemKey: string; note?: string; rating?: number;
}
export interface Payment { id: string; orderId: string; outletId: string; method: Method; amount: IDR; tip: IDR; status: PaymentStatus; ref: string; at: number; expiresAt: number | null; sessionId: string | null }
export interface Refund { id: string; orderId: string; paymentId: string; amount: IDR; reason: string; approvalId: string | null; at: number; toStock: boolean; /** drawer the cash went out of (cash refunds) */ sessionId?: string | null }
export interface Approval { id: string; type: RequestType; title: string; subjectId: string | null; amount: IDR; pct: number; level: Level; status: 'waiting' | 'approved' | 'rejected' | 'recount'; requestedBy: string; countedBy?: string; outletId: string; note: string; at: number; decidedBy?: string; decidedAt?: number; decisionNote?: string; payload?: Record<string, unknown> }
export interface Session { id: string; outletId: string; cashierId: string; openedAt: number; openingFloat: IDR; closedAt: number | null; counted: IDR | null; variance: IDR | null; status: 'open' | 'counting' | 'needs_approval' | 'closed'; note: string }
export interface CashMove { id: string; sessionId: string; outletId: string; kind: 'in' | 'out' | 'drop'; amount: IDR; reason: string; by: string; at: number; status: 'done' | 'waiting' }
export interface ShiftDay { outletId: string; day: number; slots: Record<'pagi' | 'siang' | 'malam', { pic: string; crew: string[] }> }
export interface ClockEvent { id: string; employeeId: string; outletId: string; kind: 'in' | 'out' | 'break'; at: number }
export interface Supplier { id: string; name: string; phone: string; terms: string; category: string }
export interface PurchaseOrder { id: string; no: string; supplierId: string; outletId: string; lines: { stockItemId: string; qty: number; price: IDR; received: number }[]; status: 'draft' | 'waiting' | 'sent' | 'partial' | 'received' | 'cancelled'; due: number; createdBy: string; at: number }
export interface Opname { id: string; outletId: string; area: string; countedBy: string; approvedBy: string | null; status: 'counting' | 'submitted' | 'locked' | 'recount' | 'approved' | 'rejected' | 'posted'; lines: OpnameLine[]; at: number; requirePhotoAll: boolean }
export interface Reservation { id: string; outletId: string; name: string; phone: string; at: number; guests: number; table: string; status: 'booked' | 'seated' | 'cancelled' | 'no_show'; deposit: IDR }
export interface Review { id: string; outletId: string; customerId: string | null; name: string; stars: number; text: string; at: number; reply: string | null; orderId: string | null }
export interface Message { id: string; channel: 'wa' | 'email' | 'sms' | 'push'; template: string; to: string; status: 'queued' | 'sent' | 'delivered' | 'read' | 'failed'; at: number; customerId: string | null; orderId?: string }
export interface Device { id: string; outletId: string; kind: 'pos' | 'kds' | 'display' | 'kiosk' | 'pic' | 'printer' | 'edc' | 'waiter'; name: string; lastSeen: number; pairCode: string | null; status: 'online' | 'offline' }
/** A configured connection to a third-party system (src/integrations). Secrets never live here: only which keys are set. */
export interface Integration {
  id: string; connector: string; kind: import('../integrations/types.ts').Kind; outletId: string | null; deviceId: string | null; name: string;
  enabled: boolean; config: Record<string, string | number | boolean>; secrets: string[];
  status: 'off' | 'ok' | 'error'; lastOk: number | null; lastError: string | null; updatedBy: string; updatedAt: number;
}
export interface Audit { id: string; actor: string; action: string; subject: string; before?: unknown; after?: unknown; at: number; outletId?: string }
export interface Notice { id: string; alert: string; level: 'info' | 'warn' | 'high'; to: Role[]; outletId: string | null; text: string; href: string | null; at: number; read: boolean }
export interface Theme { name: string; p: string; acc: string; ink: string; paper: string; font: string; banner: string; img: string }
export interface Version { id: string; kind: 'menu' | 'brand' | 'page'; by: string; at: number; status: 'draft' | 'pending_owner' | 'published'; data: unknown; note: string }
/** Records for objects that don't have a dedicated table yet (generic rows keyed by authority object id). */
export interface Rec { id: string; a: string; b: string; c: string; d: string; e: string; at: number }

export interface DB {
  v: number;
  tenant: { id: string; name: string; plan: 'free' | 'basic' | 'pro' | 'enterprise'; locks: { menuPrices: boolean; outletOnlyItems: boolean; brand: boolean } };
  outlets: Outlet[]; employees: Employee[]; categories: Category[]; modifierGroups: ModifierGroup[]; products: Product[]; outletProducts: OutletProduct[];
  stockItems: StockItem[]; recipes: Recipe[]; movements: Movement[]; customers: Customer[]; ledger: LedgerRow[];
  orders: Order[]; payments: Payment[]; refunds: Refund[]; approvals: Approval[]; sessions: Session[]; cashMoves: CashMove[];
  roster: ShiftDay[]; clock: ClockEvent[]; suppliers: Supplier[]; pos: PurchaseOrder[]; opnames: Opname[]; promos: Promo[];
  reservations: Reservation[]; reviews: Review[]; messages: Message[]; devices: Device[]; integrations: Integration[]; audit: Audit[]; notices: Notice[];
  theme: Theme; staffBrand: { accent: string; logo: string; workspace: string; density: 'compact' | 'comfy' }; versions: Version[];
  perms: Record<string, string>; records: Record<string, Rec[]>; counters: Record<string, number>;
  /** Settings pages: key = page path + ':' + setting id. */
  settings: Record<string, boolean | string | number>;
  device: { outletId: string; online: boolean; queue: { id: string; action: string; at: number }[]; paired: Record<string, string> };
}
