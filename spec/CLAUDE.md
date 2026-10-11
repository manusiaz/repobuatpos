# BorNiz project rules

## Every change propagates
All pages are connected. When adding or changing anything (a role, a rule, a component, a color, a flow):
1. Search every `BorNiz *.dc.html`, `bn-*.js`, `tokens/*.css`, `readme.md` for related terms before finishing.
2. Update every page that shows, links to, or depends on it: screens, Roles, Shifts, Sitemap, Connections (P, LINKS, GOF, LIVE), Page Spec, Design Notes, States Gallery, Theming, launcher (`bn-launcher.js` APPS + role lists), hub (`BorNiz.dc.html` groups), Design System / Components copy.
3. Add the new links to `LINKS` in `BorNiz Connections.dc.html` (both directions), rebuild every page's Linked pages panel from it, and add a `CHANGES` entry listing every file touched. Any `href` a page uses must exist in `LINKS`.
4. Tell the user exactly which pages were updated.

## Never fork versions
Edit files in place. No "v2" copies.

## Type
Space Grotesk (headings, bold, numbers) · Instrument Sans (body) · JetBrains Mono (IDs). Merchant font only inside guest screens (`[data-guest]`). No emoji, no system fonts.

## Roles
Owner · Manager (same tools as owner incl. customization; price changes, publishing, payroll, refunds > IDR 500k need owner OK) · PIC (shift lead, one per shift, under manager) · Cashier · Kitchen · Waiter · Super admin · Customer.
Approval chain: Cashier → PIC (within limits: discount ≤ 20%, void/refund ≤ IDR 100k, variance ≤ IDR 50k) → Manager → Owner (prices, publishing, payroll, refunds > IDR 500k).

## Menu scope
- Owner adds an item → **All outlets** by default (or chosen outlets / one brand). It is a *global* item: outlets can't delete it, only mark it unavailable (86) and, if allowed, set a local price within ±10%.
- Manager adds an item → **This outlet only** (*local* item), always waits for owner OK. Manager can tick “Propose for all outlets”; owner decides to keep it local or promote it to global.
- Owner deleting a global item removes it everywhere. Manager can hide a global item at their outlet, and archive their own local items.
- Sold-out / 86 is always per outlet (kitchen, PIC, manager). Franchise lock “Menu prices” blocks local prices; “Allow outlet-only items” lets owner turn local items off.

## Stock opname (count) rules
- Counted by the PIC (or staff) on shift, per area, blind (system qty hidden until submit). Each line with a difference needs a photo; manager can require a photo for every line.
- After submit the count is **locked**: nobody edits their own count. Corrections = a new recount line, both kept in history.
- Two people: the counter can't approve their own count. Manager verifies (or asks for a recount). Variance ≤ IDR 50k → PIC can sign; ≤ IDR 500k → manager; > IDR 500k → owner.
- Stock changes only when approved, as a stock movement "Opname adjustment" with who counted, who approved, photos, time. Audit log keeps everything; nothing is deleted.
