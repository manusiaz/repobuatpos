'use client';
// Self-order (spec: BorNiz Self Order): QR menu on the guest's phone plus the customer links. Mobile-first single
// column (max 520px, centered on desktop) in the merchant brand. Each registry page maps to one view below.
import { themeNow } from '../system/studio.ts';
import { abTheme, embeds, guestMoney } from '../system/tools.ts';
import { setMoneyStyle } from '../domain/money.ts';
import { GuestFooter } from './guest/published.tsx';
import { useEffect, useRef, type ComponentType } from 'react';
import { useApp } from '../app/context.tsx';
import { sendToKitchen } from '../data/actions.ts';
import { orderPlaced } from '../data/actions/selforder.ts';
import { brandVars } from './guest/kit.tsx';
import { GuestHead, GuestStyle } from './guest/look.tsx';
import { guestVars, guestZoom } from '../system/tools.ts';
import { useGuest, type G } from './selforder/shared.tsx';
import { Unavailable } from './guest/kit.tsx';
import { AddMore, Call, Cart, Category, Checkout, Closed, Home, Item, Landing, Language, Qris, Search, Status } from './selforder/order.tsx';
import { Booking, EmailThanks, Feedback, MemberCard, Prefs, Queue, Receipt, Track, Voucher, WaThanks } from './selforder/links.tsx';
import { ComboPage, GiftCards, PrintMenu, SplitBill, Store } from './selforder/more.tsx';
import { routeQuery } from '../system/hosts.ts';

// Menu Studio pages ride on the registry page they belong to (?combo, ?split, ?v=gift, ?print); the store front is
// order.<root>/<tenant> without a table, the table landing is /<tenant>/t/<n>.
const either = (q: (g: G) => boolean, A: ComponentType<{ g: G }>, B: ComponentType<{ g: G }>) => function View({ g }: { g: G }) { return q(g) ? <A g={g} /> : <B g={g} />; };
const VIEWS: Record<string, ComponentType<{ g: G }>> = {
  order: either(g => !(g.sp.get('t') ?? routeQuery().t), Store, Landing), 'scan-landing': Landing, 'language-picker': Language, 'menu-home': Home,
  'category-full-menu': either(g => !!g.sp.get('print'), PrintMenu, Category), search: Search,
  'item-detail-and-options': either(g => !!g.sp.get('combo'), ComboPage, Item), cart: Cart, 'checkout-and-payment': either(g => !!g.sp.get('split'), SplitBill, Checkout), 'qris-payment': Qris, 'order-status': Status,
  'call-waiter-request-bill': Call, 'add-more-to-existing-order': AddMore, 'table-closed-outside-opening-hours': Closed,
  'digital-receipt': Receipt, 'member-card-and-points': either(g => g.sp.get('v') === 'gift', GiftCards, MemberCard), 'claim-voucher': Voucher, 'feedback-and-rating': Feedback,
  'online-booking': Booking, 'queue-status': Queue, 'delivery-tracking': Track, 'whatsapp-thank-you-message': WaThanks, 'thank-you-email': EmailThanks,
  'unsubscribe-message-preferences': Prefs,
};

export default function Screen() {
  const { db } = useApp();
  // a link to a business that doesn't exist (wrong slug, or not on this database): a clear state, not a crash
  return db.outlets.length ? <Guest /> : <Unavailable />;
}
function Guest() {
  const { page } = useApp();
  const g = useGuest();
  const View = VIEWS[page.slug] ?? Landing;
  setMoneyStyle(...guestMoney(g.db, g.outletId)); // the scanned outlet's number format (Studios)
  const embed = g.sp.get('embed') === '1' && !!embeds(g.db); // iframe widget on the merchant's own site (Studios › Embeds)

  const theme = themeNow(g.db, abTheme(g.db, g.db.theme, g.ab), g.now);
  return <div data-guest style={{ ...brandVars(theme), ...guestVars(g.db, theme), minHeight: '100dvh', background: embed ? 'var(--bn-paper)' : 'color-mix(in srgb,var(--bn-ink) 9%,var(--bn-paper))' }}>
    <GuestStyle db={g.db} /><GuestHead db={g.db} slug={page.slug} theme={theme} />
    <main style={{ maxWidth: embed ? 'none' : 520, margin: '0 auto', minHeight: '100dvh', background: 'var(--bn-paper)', position: 'relative', overflowX: 'hidden', zoom: guestZoom(g.db) }}>
      <View g={g} />
      <GuestFooter db={g.db} outletId={g.outletId} slug={page.slug} />
    </main>
  </div>;
}
