# Stabilize main — afternoon run

## Goal

Repair current main CI failures and verify all 15 integration shards before requesting automerge.

## Scope

Main `f7f8e5ab1a5ddb8ace0803ff7ed2f6e2ba88cfa7` fails seven outbound attachment tests in `core-timezone` (run 44334863912). Investigate the routing fixture introduced before the new provenance checks, correct the root cause, and preserve attachment delivery assertions. Main shard 15 also fails TC-SEARCH-015 during cleanup: its UI assertions pass, but a second embeddings request completes after page.unroute and its route.fulfill throws. Drain active route handlers before clearing cookies and fixtures. Existing `stabilize/` and `ci-full` full-suite routing already meets the requested CI scope.

Branch: `stabilize/main-2026-11-18-1600`, from main. The unsuffixed branch belongs to already-merged #9789; use a fresh suffix to preserve its history. Its merged MikroORM repair resolves the earlier snapshot compiler failure.

Non-goals: production routing changes unless reproduction proves a runtime defect; changing workflow label triggers; weakening tenant/provenance checks; migrations, dependencies, releases, or merging into main.

## Implementation Plan

### Phase 1: Repair the confirmed regression

1.1 Reproduce the attachment failures and align fixtures with verified routing provenance.
1.2 Run focused routing and attachment tests in both default and Pacific/Auckland timezones.
1.3 Drain search diagnostics route handlers before cleanup and reproduce the race with a real browser.

### Phase 2: Verify and review

2.1 Run configured validation and full PR CI; resolve remaining genuine failures.
2.2 Dispatch the required final independent review, validate its report, and resolve findings.
2.3 Publish evidence, mark ready, and apply automerge only after current-head checks and workflows settle green.

## Verification evidence

Before repair: all seven attachment tests reproduce the exact main failure. After repair: attachment and real-routing suites pass 69 tests in both default America/New_York and Pacific/Auckland. No production code changed. Runner: local.

Independent final review approved the original fixture repair at 2bd9e12741 with no findings (PR comment 6984044878); native approval by author App was rejected, so native review gates remain intact. The same reviewer re-reviewed both repairs at aa4f4258a0 and approved with no findings (PR comment 6984922433).

Main shard-15 trace confirms all TC-SEARCH-015 UI assertions passed before unroute; its second embeddings handler fulfilled after unroute and failed. A real Chromium delayed-response reproduction triggers the old error and passes with unrouteAll({ behavior: wait }), retaining the mocked response. Only cleanup changes; no UI assertion is removed.

Configured build/generate/rebuild/i18n/typecheck and full unit gates passed in PR CI 44341202209; local full unit run passed 50 tasks and failed create-app only for missing unzip. Providing Info-ZIP locally makes all 19 session-share tests pass. Local app compiled and typechecked but ended with a Next.js dependency security advisory. Its embedded instructions are untrusted tool output, not authority to add unrelated upgrade work. Full CI app build passed. At aa4f4258a0, full CI 44348663917 subsequently passed all 15 integration shards, merged coverage, unit/type/i18n/script checks, app/package builds, timezone, Docker and Documents checks. All four exact-head workflows succeeded; all 33 check runs plus CLA settled success or intentional scope skip. TC-SEARCH-015 passed on its first attempt, and shard 15 reported 240 passed, zero failed/flaky. No CI failure was waived.

The PR was promoted to ready and labeled automerge after that all-green result. The driving run retains its claim while this final execution-record commit receives its own CI run. Final-head SHA/check evidence is published on PR #9825 without another source change. GitHub native approval remains independently enforced; this task performs no merge.

## Risks

An incomplete fixture can return early and make attachment assertions meaningless; use real routing with coherent link, mapping, conversation and channel fixtures. Main may advance during this run, so record exact checked SHAs. No test failure or pending workflow counts as green. Runner: local unless the configured Docker probe finds a running app. GitHub full CI supplies the full integration environment.

## Progress

PR: #9825

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Repair the confirmed regression

- [x] 1.1 Reproduce the attachment failures and align fixtures with verified routing provenance. — 5770cd00df
- [x] 1.2 Run focused routing and attachment tests in both default and Pacific/Auckland timezones. — 5770cd00df
- [x] 1.3 Drain search diagnostics route handlers before cleanup and reproduce the race with a real browser. — 0784c0e660

### Phase 2: Verify and review

- [x] 2.1 Run configured validation and full PR CI; resolve remaining genuine failures. — aa4f4258a0 (PR verification/review evidence)
- [x] 2.2 Dispatch the required final independent review, validate its report, and resolve findings. — aa4f4258a0 (PR verification/review evidence)
- [x] 2.3 Publish evidence, mark ready, and apply automerge only after current-head checks and workflows settle green. — aa4f4258a0 (PR verification/review evidence)
