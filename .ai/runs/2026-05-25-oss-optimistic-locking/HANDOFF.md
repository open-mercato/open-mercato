# Handoff — 2026-05-25-oss-optimistic-locking

**Last updated:** 2026-05-29 (resume 2 — QA fix + framework + unified conflict bar)
**Branch:** feat/oss-optimistic-locking
**PR:** https://github.com/open-mercato/open-mercato/pull/2055
**Current phase/step:** Through 25.1 done + checkpoint 6. Next = Phase 26 (sales document sub-sections client wiring), then 27 (Playwright/integration + browser screenshots), then 28 (enterprise FR issue + docs + final gate + summary).
**Last code commit:** 35fbd4d30 (sales document page lock wiring). Checkpoint 6 docs commit follows.

## Environment (IMPORTANT — this is how to run Playwright on THIS branch)
- `:3000` = separate standalone `my-app` (published packages) — NOT this branch. Ignore it.
- Boot the branch: `yarn install` → `yarn build:packages` → `yarn turbo run generate` → `yarn build:packages` → then in `apps/mercato/`: `PATH=$PWD/../../node_modules/.bin:$PATH next dev -p 3100` (Turbopack; the `yarn dev` wrapper's package-watcher crashes esbuild here). A dev server is CURRENTLY RUNNING on :3100 — do not restart it unless it died.
- Integration harness works: `BASE_URL=http://localhost:3100 OM_INTEGRATION_MODULES=<mod> yarn test:integration -g <name>`.
- Admin: `admin@acme.com` / `secret`. Token: POST :3100/api/auth/login (form-urlencoded). A token is cached in /tmp/pr2055_tok.txt.
- Shared DB `open-mercato` (no schema change in this PR).

## Resume-2 scope landed so far
- 21.1 root-cause report; 22.1 command-level enterprise hook; 22.2 unified conflict **bar** (per user: persistent error bar like the undo bar, unified across all forms — replaces the transient toast for the 409 conflict); 24.1 catalog variant delete; 25.1 sales document page.

## Key findings
- CRM v2 (companies-v2/people-v2/deals) ALREADY send the header + surface the localized conflict — proven live. v1 company/person `[id]` pages are dead edit routes (list → v2). No CRM client fix needed.
- companies-v2 react-query refetch-on-focus keeps single-tab `updatedAt` fresh → single-tab stale-save can't reproduce the conflict; use two API sessions (integration) or two tabs for deterministic 409. This explains QA's "same-user two-tab" being the only failing case.
- Sales orders/quotes both render `sales/documents/[id]/page.tsx` (uses `useGuardedMutation`; document `updatedAt` = `record.updatedAt`).

## Next concrete action (Phase 26)
Wire the sales document sub-sections to send the document version header + route 409 → conflict bar + reload:
- `packages/core/src/modules/sales/backend/sales/documents/[id]/page.tsx` — pass `documentUpdatedAt={record.updatedAt}` to ItemsSection / AdjustmentsSection / ReturnsSection / ShipmentsSection / PaymentsSection.
- `packages/core/src/modules/sales/components/documents/{ItemsSection,LineItemDialog,AdjustmentsSection,ReturnsSection,ReturnDialog,ShipmentsSection,ShipmentDialog,PaymentsSection,PaymentDialog}.tsx` — wrap create/update/delete with `buildOptimisticLockHeader(documentUpdatedAt)` and `surfaceRecordConflict(err,t)` in catch.
- **Header semantics (from Phase 21 decision):** Items/Adjustments/Returns use the DOCUMENT-aggregate header (their CRUD route nulls candidateId; server `enforceSalesDocumentOptimisticLock` is the guard). Payments/Shipments are row-level-guarded by makeCrudRoute — send the ROW's own `updatedAt`, not the document's; only add conflict surfacing. No double-guard.

## Blockers / caveats
- `gh`/`mercato` need PATH from node_modules/.bin.
- Workspace `tsc` `ignoreDeprecations` TS5103 is pre-existing (use `yarn turbo run typecheck --filter=…` for the real check).
- PLAN.md SHA cells: per-step commit flips Status→done with the committed SHA carried in the NEXT commit (no amend chase).
