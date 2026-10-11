# BorNiz — one system

Cloud POS for Indonesian F&B / retail / UMKM. Every surface (marketing, owner, manager, PIC, cashier POS, kitchen, customer display, self-order, kiosk, waiter, super admin) is **one Next.js app, one route, one store**. Never fork a surface into its own app or its own data.

## Map
- `spec/` — the BorNiz design system (prototypes `BorNiz *.dc.html`, data `bn-*.js`, tokens). Source of truth for design + rules. `spec/CLAUDE.md` = product rules (roles, approval chain, menu scope, opname).
- `scripts/sync-spec.mjs` → `src/system/{pages,authority,alerts,catalog,docs}.json` (`npm run spec`). Never hand-edit those JSON files.
- `src/system/registry.ts` — sitemap → routes. Each page: `path, surface, shell, mode, template, object`. `npm run paths [surface]` lists them.
- `src/system/graph.ts` → `KNOWLEDGE_GRAPH.json` (`npm run graph`): page / surface / object / role / event nodes, data-dependency edges. Viewer at `/graph`.
- `src/domain/*` — pure business rules (money, order totals, approval ladder, loyalty, stock/opname, menu scope, promo, shift). Tested: `npm test`.
- `src/data/schema.ts` (ERD tables), `seed.ts` (Kopi Biru demo tenant), `store.ts` (`useDB`, `commit` → audit + realtime across tabs), `actions.ts` (service layer: the only writers).
- `src/app/App.tsx` — resolves page → session → access → shell → surface. `src/app/context.tsx` `useApp()` = `{ page, db, user, me, outletId, setOutlet, go }`.
- `src/screens/<surface>.tsx` — dedicated screens (one per prototype). `src/templates/` — the 8 page templates for every back-office page without its own screen.
- `src/ui/kit.tsx` (Icon, Badge, Status, Sheet, Seg, Toggle, Field, Numpad, Kpi, Empty, Loading, toast…), `src/ui/Chart.tsx` (Chart.js per DS), `app/globals.css` (tokens + component classes).

## Rules
- Money = integer rupiah; format with `idr` / `idrShort` from `src/domain/money.ts` at render only.
- Writes only through `src/data/actions.ts` (or a new `src/data/actions/<area>.ts` that calls `commit`). Never mutate `db` in a component.
- Every view of a surface is a URL from the registry (`go(path)` / `<Link>`); a screen must handle every page of its surface.
- Data-origin modes decide actions: `edit` (create/edit/delete), `settings`, `read` (report), `record` (from POS, read-only), `incoming` (accept/reject/reply only), `approve` (approve/reject with approval PIN). Never show “+ New” on record/incoming/read data.
- Approvals: `requestApproval` / `decide` (ladder in `src/domain/approval.ts`); every approve/reject asks the approver’s 6-digit approval PIN (demo `246810`). Nobody approves their own request.
- Tokens only (CSS vars in `app/globals.css`); no new colors, no emoji, Lucide icons via `<Icon name="kebab-name" />`. Fonts: Space Grotesk (headings, numbers), Instrument Sans (body), JetBrains Mono (IDs).
- Touch: 44 staff · 56 POS · 72 pay button · 64 KDS/kiosk. Text ≥ 13px staff, ≥ 15px kitchen, inputs 16px.
- Demo sign-ins: cashier PIN `1234`, approval PIN `246810`. Users: budi (owner), andi (manager), maya/sari/lia (PIC), rina/tono/wulan (cashier), dimas/hadi (kitchen), joko/putri (waiter), admin.

## Changing things
Add a page in the design system sitemap → `npm run spec` → it routes automatically. Then `npm run graph`, `npm test`, `npx tsc --noEmit`, `npx next build` (statically generates every page).
