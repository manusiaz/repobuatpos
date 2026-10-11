# BorNiz Design System

BorNiz is a cloud POS for Indonesian F&B, retail, UMKM, multi-outlet/franchise and service businesses (salon, laundry). Surfaces: marketing site, owner/manager dashboards, cashier register, customer display + QRIS, kitchen display, self-order (QR menu, kiosk), super admin console.

Sources: user brief + reference screenshots in `uploads/` (order kanban, POS register, analytics dashboards, smooth area chart). The CloudPOS Figma community file was a screen-inventory reference only. No logo was provided, so the wordmark is set in plain type.

## Files
- `BorNiz Design System.dc.html`: living spec (brand, color, type, space, icons, components, POS patterns, payments/QRIS, data viz, motion, sound, dark, voice)
- `BorNiz Sitemap.dc.html`: full page inventory per role
- `styles.css` → `tokens/colors.css`, `typography.css`, `spacing.css`, `motion.css`

## Prototype index
- Product plan: vision, personas, epics & stories, roadmap, metrics, risks, decisions
- Diagrams: architecture, ERDs, state machines, sequences (Mermaid, copy into repo)
- Design Notes: alternatives, must/don't, dev notes per surface (read first)
- POS Register · Kitchen Display · Customer Display · Self Order · Loyalty · Online Orders (tiers, ready-by, kitchen lanes, busy mode, pickup shelf)
- Authority: who creates / edits / approves every data object (62), loopholes closed · Alerts · Roles · Diagrams · States Gallery · Page Spec
- Approval PIN: bn-pin.js, every approve / reject needs the approver’s 6-digit PIN (not the password)
- Owner Dashboard · Owner Mobile · Manager Dashboard · Shifts · Roles
- Auth · Landing · Super Admin · Studios · Brand Studio · Menu Studio (incl. Pages & promos)
- Customer branding demo: bn-brand.js (CSS vars --bn-p, --bn-acc, --bn-ink, --bn-paper, --bn-font, --bn-banner)

- Alerts: 160 staff alerts, 66 guest moments, 22 destinations (bn-alerts.js); bell on every staff app via bn-launcher.js

- Authority: bn-authority.js + Authority page — automatic vs manual data, approvals, escalation, loopholes

## Content fundamentals
EN default; ID is a full translation. Sentence case, verbs on buttons ("Charge IDR 81,900"). "you" / "Anda" ("kamu" in self-order). No emoji in product UI. Prices: `IDR 25,000`; chart/short amounts: `IDR 2,4 jt`, `IDR 23 rb`.

## Visual foundations
- Color: Ember (orange #F26B1D) is used only for the primary action and live data. Ink is a warm neutral family. Status colors appear on badges, alerts and timers only.
- Type: SF Pro Display (display and all numerals, tabular), SF Pro Text (body/UI), SF Mono (IDs, SKU, OTP), all from the system font stack. Fallback: Helvetica Neue / native sans.
- Radius 16px+ (8/12/16/20/28/pill). 1px warm borders over shadows; shadows only on floating layers.
- Touch-first: POS min 56px, pay button 72px, dashboard 40–48px.
- Imagery: product photos on warm neutral, square-ish 4:3 tiles. No gradients except the chart area fill (22% → 0% Ember).
- Hover: one step darker. Press: scale .96 in 80ms. Focus: 4px Ember-200 halo.
- Dark: default for kitchen display and customer display; accent shifts to Ember-400.

## Responsive
Mobile first. Breakpoints xs 320, sm 480, md 768, lg 1024, xl 1280, 2xl 1536. Grid 4/8/12 cols. See `BorNiz Responsive.dc.html` and `tokens/responsive.css`.

## Motion
Snappy. 80 / 140 / 200 / 320ms; exits faster than entrances. Spring overshoot only on payment success, order toast and badge pop. Charts draw in over 600ms with easeOutQuart. Skeleton shimmer at 1200ms. Reduced motion: 120ms fades.

## Sound
sfx-order-in, sfx-pay-success, sfx-pay-fail, sfx-scan. Sine tones under 400ms, mutable per device.

## Iconography
Lucide (open source) at a 2px stroke, 20px in UI and 24px on POS, loaded from the CDN (lucide-static@0.452.0). Use official payment brand marks only (QRIS/GPN/Visa); never redraw them.

## Charts
Chart.js 4. Smooth tension 0.4, ink tooltip, dashed crosshair, dashed comparison line. Palette: Ember plus neutrals; status colors only for semantic meaning.
