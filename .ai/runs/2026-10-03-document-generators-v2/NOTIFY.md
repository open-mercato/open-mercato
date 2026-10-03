# Notify — 2026-10-03-document-generators-v2

Append-only UTC log.

## 2026-10-03T11:34:03.067366+00:00 — run started
- Implement full Document Generators spec from PR #5323 on fresh develop branch; no external skill URLs.
- Read-only spec-planning subagent completed all-phase breakdown; no old implementation inspected.
- Engine routed to loop: 35 steps exceeds default threshold 20.

## 2026-10-03T11:43:10.770526+00:00 — checkpoint 1
- Steps 1.1 and 1.2 complete, 11 unit tests and package checks passed; UI not present.
- PR #6892 opened; claim comment posted, labels/assignment blocked by GitHub permissions.
- Dependencies installed locally; user retention and code-version decisions accepted.

## 2026-10-03T11:49:50.611852+00:00 — executor fallback
- Step 2.1 delegated and completed by step_2_1 (129c8e2e4). Step 2.2 executor hit provider usage limit before writing code.
- User explicitly requested continued work; main session completed Step 2.2 instead of retrying unavailable executor service. Planned Exec cell retained for audit.
- Step2.2 registry: 18 package tests and package typecheck passed.

## 2026-10-03T11:56:05.807803+00:00 — checkpoint 2
- Steps2.1–2.4 verified; 24 engine and 5 shared tests passed, generated bootstrap inspected.
- Main session continues execution after provider subagent usage limit under user instruction to continue.
- Explicit all-tenant cache refresh rejected by automatic approval review; no bypass. UI not present, browser pass not applicable.

## 2026-10-03T12:05:02.084568+00:00 — checkpoint 3
- Renderers/utilities/toolkit passed 38 tests, build/typecheck and two real PDF renders.
- Browser pass deferred: server toolkit only; no app UI route yet.

## 2026-10-03T12:13:26Z — om-auto-continue-pr-loop resume
- Resumed by: @kriss145 (Claude Code session taking over from the interrupted Codex om-auto-create-pr-loop session).
- Resume point: 4.1 (source: HANDOFF.md + Tasks table, consistent). PR head SHA: 9caac9197.
- Assignee/label writes still refused by GitHub (read-only contributor); claim recorded via PR comment only.
- Decision: Sales gains @open-mercato/document-generators as a peer + dev dependency (same pattern as the existing optional @open-mercato/ai-assistant peer) when the first React-PDF template lands in Step 4.2; Step 4.1 depends on shared contracts only.
- Decision: document seller block is optional and sourced from the source document's own SalesChannel (name, contact email/phone), keeping data inside Sales instead of importing directory entities.

## 2026-10-03T12:31:11Z — checkpoint 4
- Steps 4.1–4.4 (fad1ca91f..0ec18287c) dispatched sequentially to executor subagents (standard tier → Sonnet); each commit verified clean and pushed.
- 63 Sales + 38 engine tests, core typecheck/build, i18n sync and an end-to-end dist render of all three Sales templates passed.
- Browser pass skipped: no UI touched in this window.
- Invoice totals extended with shipping and surcharge so the totals block reconciles.
- Step 5.4: migration generated with yarn db:generate against a throwaway postgres:17 Docker container (DATABASE_URL inline, stopped afterwards); unrelated wms output discarded; down() added by hand (generator emits none).

## 2026-10-03T12:50:57Z — checkpoint 5
- Steps 5.1–5.5 + 5.1-review-fix (23ae21dca..05cf126d8). 133 engine + 63 Sales tests, typecheck, build, generate and i18n sync passed. Browser pass skipped (no UI).
- Decision: kept the spec's public URLs `/api/document-generators/*` via `metadata.path` (the router otherwise prefixes the module id `document_generators`).
- Review fix: selected organization resolved through Directory `organizationScopeService` (super-admin-only cookie override in getAuthFromRequest would scope regular multi-org users to their home org).
- Step 5.5 landed as two commits after an executor sed slip; no history rewrite.

## 2026-10-03T13:01:30Z — checkpoint 6 (lightweight)
- Steps 5.6–5.7 (cbc9d9275, 59d63226c); Phase 5 closed. Step test files pass (41 tests).
- User interrupted: machine froze under heavy validation. Switched to reduced validation mode — only per-Step test files; typecheck/build/generate/full suites/final gate deferred until the user asks.
- 5.6 was finished in the main session from the interrupted executor's uncommitted work; fixed RBAC feature lookup to use auth.sub (CRUD factory parity).

## 2026-10-03T13:13:04Z — checkpoint 7 (lightweight)
- Steps 6.1–6.5 (f518ea49f..10c8138ca); Phase 6 closed. All Step test files pass (30 tests). Typecheck/lint/build/generate/client-boundaries and browser evidence deferred (reduced validation mode; browser pass needs app + migrated DB → user approval).
- Dependency: @open-mercato/ui added to document-generators peer + dev deps (one light yarn install). @tanstack/react-query imported as the root-hoisted dependency, like packages/core.

## 2026-10-03T13:17:53Z — resume paused
- Step 7.1 (fe02a4262) authored TC-DOCUMENT-001..022 + helpers in the engine __integration__ folder; not executed (reduced validation mode).
- Session paused because the user had to shut down the computer. 24 of 36 Tasks rows done; next: 8.1. PR stays draft, Status in-progress.

## 2026-10-03T17:13:56Z — checkpoint 8 (lightweight)
- Resumed by @kriss145 after the pause; Steps 8.1–8.3 done inline (20f82cad2..c506a70f9). Step test files pass.
- Decisions: retention via domain-neutral `<resourceKind>.deleted` subscriber; stored files in existing private `privateAttachments` partition through the attachmentService DI contract (peer modules may not create partitions); history row linked in the attachment transaction; engine-owned download route re-applies template requiredFeatures.

## 2026-10-03T17:24:40Z — checkpoint 9 (lightweight) + run paused for approval
- Steps 9.1, 9.2, 6.2-review-fix (CSP blob: frames), 10.1 done. Step test files pass; template:sync clean.
- All implementation rows done (37/39). Remaining 10.2 (full gate) and 10.3 (integration run, review, UI evidence) need explicit user approval — heavy local load and a migrated database.
- Standalone harness refresh not done (requires failing-first evals) — recorded in spec "Not yet verified".

## 2026-10-03T19:26:45Z — final gate (configured validation) passed
- Sequential local run; author ran typecheck/test/build:app in their terminal. Fixes during the gate: 0648cc031 (example module dictionaries), cc02607c4 (in-package type imports).
- Manual app testing fixed bd405329f (idempotent registry on repeated bootstrap) and 9863f6ea7 (attachment owner assignment). Accidental WMS generator output committed in bd405329f was reverted in 7212b7746.
- Unit tests scoped to changed packages (230 + 929 + 6). Integration suite, lint, client boundaries, DS guardian, screenshots remain.
