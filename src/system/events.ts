// Service events (spec Diagrams: "Service events") and the data objects each one changes. Mirrors src/data/actions.ts.
import type { Surface } from './registry.ts';

/** Service events → the data objects they change (mirrors src/data/actions.ts). */
export const EVENTS: Record<string, { writes: string[]; from: Surface[]; note: string }> = {
  'order.created': { writes: ['order'], from: ['pos', 'selforder', 'kiosk', 'waiter'], note: 'newOrder' },
  'order.sent': { writes: ['order'], from: ['pos', 'waiter', 'selforder'], note: 'sendToKitchen: course firing to stations' },
  'payment.created': { writes: ['payment', 'order', 'deposit', 'kasbon'], from: ['pos', 'selforder', 'kiosk', 'display'], note: 'startPayment; QRIS expires in 5 min' },
  'payment.settled': { writes: ['payment', 'order'], from: ['pos', 'display', 'selforder'], note: 'gatewayWebhook only' },
  'order.paid': { writes: ['stock', 'points', 'messaging', 'promo', 'notif'], from: ['pos', 'selforder', 'kiosk'], note: 'recipe deduction, beans, thank-you WA' },
  'approval.requested': { writes: ['notif'], from: ['pos', 'pic', 'manager', 'backoffice', 'shifts', 'menu', 'studios'], note: 'requestApproval: level from type + amount' },
  'approval.approved': { writes: ['refund', 'void', 'discount', 'local', 'price', 'opname', 'drawer', 'cashmove', 'po', 'design', 'adjust', 'points', 'audit'], from: ['pic', 'manager', 'owner', 'ownerMobile', 'backoffice'], note: 'decide with approval PIN; nobody approves own request' },
  'ticket.bumped': { writes: ['order', 'notif'], from: ['kds'], note: 'bump: the only way to set ready' },
  'item.86': { writes: ['sold86', 'notif'], from: ['kds', 'pic', 'pos', 'manager', 'backoffice'], note: 'per outlet, synced to QR, kiosk, delivery apps' },
  'drawer.opened': { writes: ['drawer', 'attendance'], from: ['pos'], note: 'openSession' },
  'drawer.counted': { writes: ['drawer', 'attendance'], from: ['pos', 'pic'], note: 'blind count; variance over limit → approval' },
  'cash.out': { writes: ['cashmove'], from: ['pos', 'pic'], note: 'cash out always needs the PIC or higher' },
  'roster.updated': { writes: ['roster'], from: ['shifts'], note: 'one PIC per shift' },
  'opname.submitted': { writes: ['opname'], from: ['pic', 'manager'], note: 'blind, photo per difference, locked' },
  'po.created': { writes: ['po'], from: ['backoffice', 'manager'], note: '≤ 500k manager, above owner' },
  'po.received': { writes: ['receipt', 'stock', 'payable'], from: ['backoffice', 'manager'], note: 'stock movement type receipt' },
  'product.saved': { writes: ['product', 'local'], from: ['backoffice', 'menu', 'manager'], note: 'owner global, manager local → owner' },
  'price.changed': { writes: ['price'], from: ['backoffice', 'menu'], note: 'manager → owner; ±10% local; franchise lock' },
  'customer.created': { writes: ['customer', 'points'], from: ['pos', 'display', 'selforder', 'loyalty'], note: 'welcome beans' },
  'points.redeemed': { writes: ['points'], from: ['pos', 'selforder', 'loyalty'], note: 'never below zero' },
  'review.created': { writes: ['review', 'notif'], from: ['display', 'selforder'], note: '≤ 2★ alerts PIC + manager' },
  'online.received': { writes: ['online', 'order', 'readyby'], from: ['online'], note: 'incoming only: accept / reject' },
  'publish.requested': { writes: ['design', 'business'], from: ['menu', 'brand', 'studios'], note: 'owner publishes; manager sends to owner' },
  'perms.changed': { writes: ['permmatrix'], from: ['roles'], note: 'owner only, approval PIN' },
};
