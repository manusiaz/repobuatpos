# BorNiz — one system

Cloud POS for Indonesian F&B / retail / UMKM. Every surface (marketing, owner, manager, PIC, cashier POS, kitchen, customer display, self-order, kiosk, waiter, super admin) is **one Next.js app, one route, one store**. Never fork a surface into its own app or its own data.

## Owner notes (decisions, keep)
- **One system.** One app, one store. Subdomains are doors into the same app and the same merchant data, never separate apps or separate data per subdomain.
- **Hybrid tenancy (owner decision, Oct 2026).** The env Supabase project is the platform: `bornis.id`, `app.` sign-up/sign-in, `admin.`, the merchant registry, and the shared database every new merchant starts in (isolated per merchant by RLS).
  - A merchant can move to its own database ("cell") with `scripts/tenant-move.sh`. `tenants.cell` + `public.cells` say where it lives; `bn_tenant_cell` resolves it.
  - After a move, all of that merchant's `app.`/`pos.`/`kds.`/`display.`/`order.` traffic goes there. The shared database keeps the old rows read-only and refuses writes (BN050).
  - Server routes find the cell per tenant; each cell's server secret goes in `BORNIZ_CELLS` (`{"<cell>":"<secret>"}`).
  - One database per subdomain was rejected: POS, KDS, display and back office must see the same sale.
- **Host structure** (spec Sitemap hosts, `src/system/hosts.ts` HOSTS):
  | Host | Serves |
  |---|---|
  | `bornis.id` | landing |
  | `app.bornis.id` | account, owner and manager |
  | `pos.bornis.id` | POS, PIC, online orders and waiter |
  | `kds.bornis.id` | kitchen display |
  | `display.bornis.id` | customer display |
  | `<tenant>.bornis.id` | QR menu, kiosk and customer links of that business (`kopibiru.bornis.id/t/07`) |
  | `admin.bornis.id` | super admin |

  - **Owner decision (Oct 2026):** a business lives at `<slug>.bornis.id`, not `bornis.id/<slug>` or `order.bornis.id/<slug>` (spec Sitemap still says `order.`). Old `order.bornis.id/<slug>/…` links redirect. Slugs can never be a platform host (`RESERVED` in `hosts.ts` = `tenants_slug_not_reserved` in the database). DNS + TLS: `bornis.id` and `*.bornis.id`.

  The spec also names:
  - `go.` for the device pairing code
  - `status.` for the status page
  - `preview.` for theme preview links
  - `menu.` as the CNAME target for merchant domains
  - `mail.` for SPF/DKIM
- **Code per host** (one app, shared code stays shared — never copy a module per subdomain):
  - `app.` → `src/screens/{owner,ownerMobile,manager,studios,menu,floor,brand,roles,shifts,loyalty,auth}.tsx`, `manager/`, `studio/`, `studios/`, `src/templates/` (back office)
  - `pos.` → `src/screens/{pos,pic,online,waiter}.tsx`, `pos/`, `pic/`
  - `kds.` → `kds.tsx`, `kitchen/` · `display.` → `display.tsx` · `<tenant>.` → `selforder.tsx`, `selforder/`, `kiosk.tsx` · `admin.` → `admin.tsx`, `admin/` · `bornis.id` → `landing.tsx`, `public/`
  - Shared by several hosts: `insight/` (sales math: app, admin, pos shift), `ops/` (pos PIC, app manager), `guest/` (order, display), `src/domain`, `src/data`, `src/ui`, `src/system`.
- **Self-hosting with git pull:** `deploy/` — `update.sh` (pull, install, build, restart), `borniz.service` (one process), `nginx.conf` (every host → that process; `/iclock` stays on plain HTTP for attendance machines).
- **Root domain** is `NEXT_PUBLIC_BORNIZ_ROOT_DOMAIN`. The spec spells it `bornis.id`; the owner wrote `borniz.id`. Confirm the spelling before buying.
- **Hosting before the domain exists.** Free `*.vercel.app` cannot have subdomains. Each surface gets an alias (`pos-soft-ajie-pos.vercel.app` …) through `NEXT_PUBLIC_BORNIZ_HOSTS`. Switch hosts on together with Supabase: browser storage is per origin.
- **Every feature is developed to depth, not just routed.**
  - A setting must change real behaviour on the surface it governs: no preview-only pages and no switches nobody reads.
  - Each feature gets its data, actions, permissions, approvals, alerts, states, responsive layout and a test.
  - `npm run check:system` lists settings that nothing reads.

## Map
- `spec/` — the BorNiz design system (prototypes `BorNiz *.dc.html`, data `bn-*.js`, tokens). Source of truth for design + rules. `spec/CLAUDE.md` = product rules (roles, approval chain, menu scope, opname).
- `scripts/sync-spec.mjs` → `src/system/{pages,authority,alerts,catalog,docs}.json` (`npm run spec`). Never hand-edit those JSON files.
- `src/system/registry.ts` — sitemap → routes. Each page: `path, surface, shell, mode, template, object`. `npm run paths [surface]` lists them.
- `src/system/graph.ts` → `KNOWLEDGE_GRAPH.json` (`npm run graph`): page / surface / object / role / event nodes, data-dependency edges. Viewer at `/graph`.
- `src/domain/*` — pure business rules (money, order totals, approval ladder, loyalty, stock/opname, menu scope, promo, shift). Tested: `npm test`.
- `src/data/schema.ts` (ERD tables), `seed.ts` (Kopi Biru demo tenant), `store.ts` (`useDB`, `commit` → audit + realtime across tabs), `actions.ts` (service layer: the only writers; `notify` = the one alert engine, recipients from the alert catalog), `actions/<surface>.ts` (surface-specific services, still only through `commit`).
- `supabase/migrations/` — production schema (ERD, RLS per tenant + outlet, approval PIN verified in `bn.decide`, ladder in `bn.level_required`, append-only audit/ledger/movements, server-side `bn.recalc_order`). `supabase/tests/core.sql` (`npm run test:db`) proves the rules.
- `src/app/App.tsx` — resolves page → session → access → shell → surface. `src/app/context.tsx` `useApp()` = `{ page, db, user, me, outletId, setOutlet, go }`.
- `src/screens/<surface>.tsx` — dedicated screens (one per prototype). `src/templates/` — the 8 page templates for every back-office page without its own screen.
- `src/system/pagemap.ts` — the ~600 sitemap entries are FEATURES; they live on 114 real pages (kind: page/tab/sheet/step/state/setting/template/tool) with a release (MVP → v2, from spec bn-pm.js roadmap). `src/system/connections.ts` — page links from spec LINKS + shared data. `npm run check:system` proves every feature has a page, every page is connected, no release gap, every code link is declared.
- `src/system/hosts.ts` + `proxy.ts` — domains: `bornis.id`, `app.`, `pos.`, `kds.`, `display.`, `order.<tenant>`, `admin.`, merchant custom domains; or one domain with subfolders (`NEXT_PUBLIC_BORNIZ_ROUTING=path`). Use `linkTo(path)` for any public link (QR, receipt, WA). `npm run check:deploy` prints the domains/DNS and proves every page is reachable.
- `src/system/perms.ts` — permission matrix (`perm(db, role, action, outletId)` → y/o/a/n). `src/system/access.ts` — which roles open which surface (launcher APPS).
- `src/ui/PinSheet.tsx` — the only approval PIN sheet (`usePin()`). `src/screens/insight/metrics.ts` — the only sales math (dashboards + reports).
- `src/ui/kit.tsx` (Icon, Badge, Status, Sheet, Seg, Toggle, Field, Numpad, Kpi, Empty, Loading, toast…), `src/ui/Chart.tsx` (Chart.js per DS), `app/globals.css` (tokens + component classes).

## Rules
- Money = integer rupiah; format with `idr` / `idrShort` from `src/domain/money.ts` at render only.
- Writes only through `src/data/actions.ts` (or a new `src/data/actions/<area>.ts` that calls `commit`). Never mutate `db` in a component.
- Every view of a surface is a URL from the registry (`go(path)` / `<Link>`); a screen must handle every page of its surface.
- Data-origin modes decide actions: `edit` (create/edit/delete), `settings`, `read` (report), `record` (from POS, read-only), `incoming` (accept/reject/reply only), `approve` (approve/reject with approval PIN). Never show “+ New” on record/incoming/read data.
- Approvals: `requestApproval` / `decide` (ladder in `src/domain/approval.ts`); every approve/reject asks the approver’s 6-digit approval PIN (demo `246810`). Nobody approves their own request.
- Tokens only (CSS vars in `app/globals.css`, source `spec/tokens/`); no new colors, no emoji, Lucide icons via `<Icon name="kebab-name" />`. Design system v1.0 (owner PNG set, Oct 2026): brand orange `#FF6A00`, slate neutrals, Satoshi (UI, headings, numbers; loaded from Fontshare), JetBrains Mono (IDs only). Orange text uses `--accent-fg` (ember-700) for contrast. Owner, manager and PIC share the orange; super admin keeps its dark shell. Guest screens (QR menu, kiosk, customer display) wear the merchant brand from Menu Studio.
- Touch: 44 staff · 56 POS · 72 pay button · 64 KDS/kiosk. Text ≥ 13px staff, ≥ 15px kitchen, inputs 16px.
- Demo sign-ins: cashier PIN `1234`, approval PIN `246810`. Users: budi (owner), andi (manager), maya/sari/lia (PIC), rina/tono/wulan (cashier), dimas/hadi (kitchen), joko/putri (waiter), admin.
- Shared registers on Supabase: a tablet the team shares is a 'device' member (owner / manager tap "Make this a shared register"; it re-signs in anonymously, so Supabase › Auth › Anonymous sign-ins must be on). Staff sign in with their PIN → `bn_staff_login` server session; every write carries it (`src/data/staff.ts`, `p_staff`), and `private.staff_rules` enforces the real role. Approval levels are computed on the server (`private.level_required` = `src/domain/approval.ts`).
- BorNiz staff (super admin) on Supabase: a separate account with no business, listed in `private.platform_admins`. Nobody can list themselves; add one in the SQL editor after they sign up: `insert into private.platform_admins (user_id) select id from auth.users where email = '<email>';`

## Changing things
Add a page in the design system sitemap → `npm run spec` → it routes automatically. Then `npm run graph`, `npm test`, `npm run links` (every in-app href must be a registry path), `npx tsc --noEmit`, `npx next build` (statically generates every page).

## Known gaps (local adapter vs production)
- Data lives in the browser (localStorage + BroadcastChannel): one browser, one origin. Subdomain routing therefore needs the Supabase adapter before go-live (each subdomain has its own storage). Production: Supabase realtime on the same tables; swap `store.ts`, keep `actions.ts` signatures.
- Payment gateway, WhatsApp (WABA), delivery-app webhooks and printers are simulated ("Simulate…" buttons). On Supabase with Xendit or Midtrans connected, QRIS/VA/e-wallet are real: `startPayment` asks the gateway (`chargePayment`) and every screen draws the gateway payload (`src/ui/qr.tsx`, QR v1–20). The local adapter and the simulator still draw stand-ins.
- Approval PIN is verified in the browser by the local adapter; production verifies it only in `bn.decide`.
