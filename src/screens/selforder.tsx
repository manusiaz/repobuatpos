'use client';
// Self-order (spec: BorNiz Self Order): QR menu on the guest's phone plus the customer links. Mobile-first single
// column (max 520px, centered on desktop) in the merchant brand. Each registry page maps to one view below.
import { useEffect, useRef, type ComponentType } from 'react';
import { useApp } from '../app/context.tsx';
import { sendToKitchen } from '../data/actions.ts';
import { orderPlaced } from '../data/actions/selforder.ts';
import { brandVars } from './guest/kit.tsx';
import { useGuest, type G } from './selforder/shared.tsx';
import { AddMore, Call, Cart, Category, Checkout, Closed, Home, Item, Landing, Language, Qris, Search, Status } from './selforder/order.tsx';
import { Booking, EmailThanks, Feedback, MemberCard, Prefs, Queue, Receipt, Voucher, WaThanks } from './selforder/links.tsx';

const VIEWS: Record<string, ComponentType<{ g: G }>> = {
  order: Landing, 'scan-landing': Landing, 'language-picker': Language, 'menu-home': Home, 'category-full-menu': Category, search: Search,
  'item-detail-and-options': Item, cart: Cart, 'checkout-and-payment': Checkout, 'qris-payment': Qris, 'order-status': Status,
  'call-waiter-request-bill': Call, 'add-more-to-existing-order': AddMore, 'table-closed-outside-opening-hours': Closed,
  'digital-receipt': Receipt, 'member-card-and-points': MemberCard, 'claim-voucher': Voucher, 'feedback-and-rating': Feedback,
  'online-booking': Booking, 'queue-status': Queue, 'whatsapp-thank-you-message': WaThanks, 'thank-you-email': EmailThanks,
  'unsubscribe-message-preferences': Prefs,
};

export default function Screen() {
  const { page } = useApp();
  const g = useGuest();
  const View = VIEWS[page.slug] ?? Landing;

  // Pay-now QR orders go to the kitchen the moment the gateway settles them (on whichever phone is open).
  const fired = useRef(new Set<string>());
  useEffect(() => {
    for (const o of g.recent) if (o.status === 'paid' && o.lines.some(l => !l.fired) && !fired.current.has(o.id)) { fired.current.add(o.id); sendToKitchen(o.id, 'guest'); orderPlaced(o.id, false); }
  }, [g.recent]);

  return <div data-guest style={{ ...brandVars(g.db.theme), minHeight: '100dvh', background: 'color-mix(in srgb,var(--bn-ink) 9%,var(--bn-paper))' }}>
    <main style={{ maxWidth: 520, margin: '0 auto', minHeight: '100dvh', background: 'var(--bn-paper)', position: 'relative', overflowX: 'hidden' }}>
      <View g={g} />
    </main>
  </div>;
}
