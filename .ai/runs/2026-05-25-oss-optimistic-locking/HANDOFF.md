# Handoff — 2026-05-25-oss-optimistic-locking

**Last updated:** 2026-06-02 (resume 3 — QA round-4 fixes + develop merge, Phase 29)
**Branch:** feat/oss-optimistic-locking
**PR:** https://github.com/open-mercato/open-mercato/pull/2055
**Current phase/step:** COMPLETE for round-4 — Phase 29 (29.0..29.5) done. Merged develop (conflict resolved). Fixed all four @alinadivante round-4 blockers: customer task (todos) lock, activity raw-toast, sales order false-positive, variant not-found UX. 20 lock integration tests green on the ephemeral env (OM_OPTIMISTIC_LOCK=all); full gate green (typecheck/build:packages/generate/i18n/build:app). Awaiting human re-QA + 2nd-approver merge.
**Last code commit:** Phase 29 resume commits (see git log). Merge resolution 46091f33f.

## Resume-3 (2026-06-02) — what changed
- develop merged; `AvailabilityRulesEditor` conflict resolved (selective delete #2325 + per-rule lock #2055).
- #1 todos: client header (canonical `useInteractions.updateInteraction` + legacy `usePersonTasks`), `updatedAt` plumbed through todoCompatibility + route + summary; interactions update/complete/cancel/delete commands enforce `enforceCommandOptimisticLock`.
- #2 activity: `ScheduleActivityDialog` skips raw `record_modified` toast on 409 (bar already shown).
- #3 variant: detail page `RecordNotFoundState` early return; server delete enforcement proven by TC-LOCK-OSS-010.
- #4 sales: `mapUpdateResponse` returns `updatedAt`; `updateDocument` refreshes `record.updatedAt` centrally.
- New tests: TC-LOCK-OSS-009/010/011 (API) + 012 (browser UI). Ephemeral env: `yarn test:integration:ephemeral:start` (base :5001, admin@acme.com/secret).

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
