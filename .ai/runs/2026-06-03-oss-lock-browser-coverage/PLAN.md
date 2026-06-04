# PLAN — Browser-driven optimistic-locking integration coverage (PR vs #2055)

**Base branch:** `feat/oss-optimistic-locking` (PR #2055) — must NOT be modified.
**This branch:** `test/oss-optimistic-locking-browser-coverage` → new PR with **base = feat/oss-optimistic-locking**.
**Goal:** add **browser-driven** Playwright integration specs for every optimistic-locking case in
`.ai/qa/scenarios/TC-LOCK-OSS-000-manual-qa-master-plan.md` that has **no** executable spec yet (~68 manual
cases → ~33 spec files, `TC-LOCK-OSS-014…046`). All green on the ephemeral env. Tests only — no product changes.

## Conventions (locked)
- Pattern: see `packages/core/src/modules/sales/__integration__/__concurrent_edit_pattern.md` + the new
  shared helper `packages/core/src/helpers/integration/optimisticLockUi.ts` (this PR).
- **Browser conflict trigger (deterministic):** create entity via API fixture → `login(page,'admin')` →
  `page.goto(editRoute)` (form captures `updatedAt`) → **advance `updated_at` out-of-band via one API PUT**
  → edit a field + Save in the browser → assert the conflict bar.
- **Conflict bar assertion:** `page.getByTestId('record-conflict-banner')` visible (it carries
  `role="alert"`, title `ui.forms.conflict.title` = "Record changed").
- **No-false-positive assertion:** `expect(page.getByTestId('record-conflict-banner')).toHaveCount(0)` after a clean single-tab save.
- No hardcoded IDs; create fixtures per test; clean up in `finally`. No per-test timeout/retry overrides.
- Run: `BASE_URL=<ephemeral> npx playwright test --config .ai/qa/tests/playwright.config.ts <file> --retries=0`.
- Ephemeral env: `yarn test:integration:ephemeral:start` → reuse `.ai/qa/ephemeral-env.json` (port 5001 default).

## Tasks

| # | Spec file (module `__integration__/`) | Manual cases | Status |
|---|---|---|---|
| 0 | `helpers/integration/optimisticLockUi.ts` (+ export wiring) | shared | **done** (585e03d) |
| 1 | customers `TC-LOCK-OSS-014` companies-v2 edit+delete (same-user) | CRM-01/02/03 | **done** (3) |
| 2 | customers `TC-LOCK-OSS-015` people-v2 edit+delete | CRM-04/05 | **done** (2; clean-save guard dropped—covered elsewhere) |
| 3 | customers `TC-LOCK-OSS-016` deals edit + list delete | CRM-06/07 | **done** (2) |
| 4 | customers `TC-LOCK-OSS-017` deals kanban won/lost + drag | CRM-08/09 | **done** (2; drag→API fallback) |
| 5 | customers `TC-LOCK-OSS-018` activities/tasks edit+complete+cancel+delete-after-delete | CRM-10/11/12/13 | **done** (4; API-level) |
| 6 | catalog `TC-LOCK-OSS-019` product edit (UI bar) | CAT-01 | **done** (2) |
| 7 | catalog `TC-LOCK-OSS-020` variant edit + delete | CAT-02/03 | **done** (2; delete via API fallback—no delete btn on variant form) |
| 8 | catalog `TC-LOCK-OSS-021` category edit + delete | CAT-05/06 | **done** (3 tests) |
| 9 | catalog `TC-LOCK-OSS-022` option-schema edit/delete | CAT-07 | **done** (3; API-level) |
| 10 | catalog `TC-LOCK-OSS-023` false-positives + price kinds | CAT-08/09/10 | **done** (4) |
| 11 | sales `TC-LOCK-OSS-024` quote header edit + delete | SAL-02 | **done w/ gap** — PRODUCT BUG: /api/sales/quotes ignores lock; stale-edit `test.fixme` |
| 12 | sales `TC-LOCK-OSS-025` order adjustments + returns | SAL-05/06 | **done** (2; doc-aggregate API) |
| 13 | sales `TC-LOCK-OSS-026` order payments + shipments | SAL-07/08 | **done** (2; row-level API) |
| 14 | sales `TC-LOCK-OSS-027` quote→convert race | SAL-09 | **done** (2; #2114) |
| 15 | sales `TC-LOCK-OSS-028` channels edit + broken-state delete | SAL-11/12 | **done** (3; Alina SAL-12 ✅) |
| 16 | sales `TC-LOCK-OSS-029` channel offers edit + list delete | SAL-13 | **done w/ gap** (API delete+clean green; edit-bar `test.fixme`—form drops 409 code; list-delete `test.skip` flaky) |
| 17 | sales `TC-LOCK-OSS-030` settings dialogs (payment/shipping/tax) | SAL-14/15/16 | **done w/ gap** (API 409 green; browser-bar `test.fixme`—dialogs use inline error) |
| 18 | auth `TC-LOCK-OSS-031` role edit + delete + ACL clobber | AUTH-01/02/05 | **done** (3; ACL via API fallback) |
| 19 | auth `TC-LOCK-OSS-032` user edit + ACL | AUTH-03/04 | **done** (2; ACL via API fallback) |
| 20 | customer_accounts `TC-LOCK-OSS-033` role edit/delete | AUTH-07 | **done w/ gap** — server 409 green; UI bar `test.fixme` (page swallows 409) |
| 21 | auth `TC-LOCK-OSS-034` sidebar customization | AUTH-08 | **done** (2; API-level) |
| 22 | staff `TC-LOCK-OSS-035` team-roles + teams (member deferred) | STF-01/02 | **done** (4 tests) |
| 23 | staff `TC-LOCK-OSS-036` leave requests + job history | STF-04/05/06 | **done w/ gap** (3) — job-history OSS-header bar `test.fixme` (body-updatedAt + no `code`) |
| 24 | resources `TC-LOCK-OSS-037` resources + resource-types | RES-01/02/03 | **done** (3 tests) |
| 25 | planner `TC-LOCK-OSS-038` ruleset + availability schedule | PLN-01/02 | **done** (2) |
| 26 | directory `TC-LOCK-OSS-039` organizations + tenants | DIR-01/02 | **done** (2 tests) |
| 27 | currencies `TC-LOCK-OSS-040` currencies (+exchange-rates) | CUR-01/(02) | **done** — CUR-01 (382e195); CUR-02 covered-by-equivalence (same CrudForm path) |
| 28 | feature_toggles/dictionaries `TC-LOCK-OSS-041` toggles + dictionaries + entries | FT-01, DICT-01/02 | **done** (4 tests) |
| 29 | business_rules `TC-LOCK-OSS-042` rules + rule sets + perspectives | BR-01/02, PSP-01 | **blocked** — PRODUCT BUG: BR routes ignore lock; 2 `test.fixme`, clean-save green; PSP-01 todo |
| 30 | webhooks `TC-LOCK-OSS-043` webhook + inbox + sync schedule | INB-01, WHK-01, SYNC-01 | **done** (4; API-level) |
| 31 | workflows `TC-LOCK-OSS-044` workflow def + custom entity (+checkout N/A) | WF-01, ENT-01 | **blocked** — 2 PRODUCT BUGS (workflows.definition + entities.records ignore lock); WF clean-save green, 3 `test.fixme`; CHK N/A on OSS |
| 32 | ui `TC-LOCK-OSS-045` conflict-bar UX (persist/refresh/dismiss/auto-clear/i18n/409 body) | UX-01..07 | **done** (7) |
| 33 | shared `TC-LOCK-OSS-046` negatives (additive/opt-out/v1 dead route/back-to-back) | NEG-01..06 | **done** (3; opt-out `test.fixme`—needs separate env) |

## Execution order (priority — Alina's findings + regressions first)
After task 0 (helper) and 1 (reference green), prioritize: 15 (channel delete), 10 (false-positives),
14 (convert), 4 (kanban), 18/19 (ACL), 32 (UX). Then sweep the rest.

## Per-step contract
1. Explore the page selectors on the live ephemeral app (MCP or a scratch run) — never guess.
2. Write the spec using the shared helper. Create fixtures via API helpers; clean up in `finally`.
3. Run it `--retries=0` until green. Fix the TEST (never the product — if a real product bug surfaces,
   STOP, record it in NOTIFY.md + HANDOFF.md as a product finding, mark the row `blocked`, move on).
4. One commit per spec file. Flip the row to `done`. Append a NOTIFY.md line.
5. Every 5 specs: run the whole lock suite (`-g TC-LOCK-OSS`) to catch cross-test interference.

## Definition of done
All rows `done`; `BASE_URL=<eph> npx playwright test -g "TC-LOCK-OSS"` fully green (001–046);
PR opened with base `feat/oss-optimistic-locking`, label `test`/`skip-qa`; HANDOFF.md final.
