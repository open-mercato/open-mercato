## 📸 UI QA evidence — FAIL

**QA head:** edd0c61bf84431af8f17a4216edcd0a3b89d99d6
**Verdict:** ❌ FAIL — availability policy preview hides a rejected organization error and displays module defaults. Evidence-only; no QA sign-off.

**Environment:** exact-head production build; isolated disposable PostgreSQL; Playwright Chromium 1.61.1; local runner. English and explicit Polish; desktop and 390x844. Environment stopped.

### Finding

**P1 — Rejected organization preview silently renders defaults.** At packages/core/src/modules/availability/backend/availability/policies/ResolutionPreviewPanel.tsx:68, a non-ok response is ignored. Lines 95–103 render the null trace as module defaults. The changed endpoint correctly rejects access, but this UI consumer hides its translated error. Live control: **200, threshold 789**. Invalid selection: **422 / organization_selection_invalid**, cookie expired, all values displayed as not-set/module-default with no error. Reproduced twice; expected-message assertion failed. See preview-positive.json, preview-rejection.json and paired screenshots.

| # / Priority | Action | Expected | Observed | Result / Evidence |
|---|---|---|---|---|
| 1 / P0 | API: availability list authorized positive control | Authorized controls succeed; unauthorized scope reads/writes refused and existing data preserved. | Assertions passed; exact HTTP/body and field comparisons in api-boundaries.json. | PASS |
| 2 / P0 | API: GET /api/availability/policies stale organization | Authorized controls succeed; unauthorized scope reads/writes refused and existing data preserved. | Assertions passed; exact HTTP/body and field comparisons in api-boundaries.json. | PASS |
| 3 / P0 | API: GET /api/availability/policies/resolve-preview stale organization | Authorized controls succeed; unauthorized scope reads/writes refused and existing data preserved. | Assertions passed; exact HTTP/body and field comparisons in api-boundaries.json. | PASS |
| 4 / P0 | API: POST /api/availability/check stale organization | Authorized controls succeed; unauthorized scope reads/writes refused and existing data preserved. | Assertions passed; exact HTTP/body and field comparisons in api-boundaries.json. | PASS |
| 5 / P0 | API: finite scope list excludes other organization under all | Authorized controls succeed; unauthorized scope reads/writes refused and existing data preserved. | Assertions passed; exact HTTP/body and field comparisons in api-boundaries.json. | PASS |
| 6 / P0 | API: restricted group delete refuses out-of-scope membership without data loss | Authorized controls succeed; unauthorized scope reads/writes refused and existing data preserved. | Assertions passed; exact HTTP/body and field comparisons in api-boundaries.json. | PASS |
| 7 / P0 | API: hard-deleted customer becomes an orphan and no longer blocks group delete | Authorized controls succeed; unauthorized scope reads/writes refused and existing data preserved. | Assertions passed; exact HTTP/body and field comparisons in api-boundaries.json. | PASS |
| 8 / P0 | API: group cascade retired memberships; repeat delete and assignment refused | Authorized controls succeed; unauthorized scope reads/writes refused and existing data preserved. | Assertions passed; exact HTTP/body and field comparisons in api-boundaries.json. | PASS |
| 9 / P0 | API: tenant B authorized control | Authorized controls succeed; unauthorized scope reads/writes refused and existing data preserved. | Assertions passed; exact HTTP/body and field comparisons in api-tenant-boundaries.json. | PASS |
| 10 / P0 | API: tenant B cannot list tenant A group or policy | Authorized controls succeed; unauthorized scope reads/writes refused and existing data preserved. | Assertions passed; exact HTTP/body and field comparisons in api-tenant-boundaries.json. | PASS |
| 11 / P0 | API: tenant B PUT tenant A group refused | Authorized controls succeed; unauthorized scope reads/writes refused and existing data preserved. | Assertions passed; exact HTTP/body and field comparisons in api-tenant-boundaries.json. | PASS |
| 12 / P0 | API: tenant B DELETE tenant A group refused | Authorized controls succeed; unauthorized scope reads/writes refused and existing data preserved. | Assertions passed; exact HTTP/body and field comparisons in api-tenant-boundaries.json. | PASS |
| 13 / P0 | API: no feature actor direct availability read refused after positive control | Authorized controls succeed; unauthorized scope reads/writes refused and existing data preserved. | Assertions passed; exact HTTP/body and field comparisons in api-tenant-boundaries.json. | PASS |
| 14 / P0 | API/SQL fixture: Existing soft-deleted out-of-scope customer still blocks deletion | 409 without group or membership mutation. | 409; whole group unchanged and membership still live. Product fixtures, tenant/id-scoped SQL legacy soft-delete in CLI-owned DB only. | PASS |
| 15 / P1 | UI: Open availability list/check and group list/create. | Useful rendered screens and empty states. | Four routes returned 200; semantic controls and empty lists rendered. Navigations 1.47–2.28s including 1.2–1.5s deliberate settle; not a server latency benchmark. | PASS / availability-policies.png |
| 16 / P1 | UI: Create a long-named group by double-clicking Create. | One group; fields reload correctly. | One 201, one table row. Code/name/description/kind/priority/default/active reloaded. | PASS / group-created-long-name.png |
| 17 / P1 | UI: A edits name; own user B saves description; A double-clicks stale Save and retries Ctrl+Enter. | Conflict; preserve B change and all untouched fields. | Conflict bar appeared. API retained B description, baseline name/code/priority/kind/flags/parent/metadata. Refresh loaded B description. | PASS / group-second-actor-stale-save.png |
| 18 / P1 | UI: Refresh, save fresh values, wait ten seconds. | Current list; no stale error; untouched fields preserved. | List updated, no residual conflict; API retained B description and untouched fields. | PASS / group-mobile-long-name.png |
| 19 / P0 | UI: Own actor lacking availability feature opens check page. | Access denied; no controls/data. | Readable Access Denied screen. Separate API positive-control/revocation returned 200 then 403. | PASS / availability-no-permission.png |
| 20 / P1 | UI: Availability Check with invalid selected organization, English. | Readable selection-unavailable error. | Translated error displayed, matching API 422. | PASS / availability-stale-selection-en.png |
| 21 / P1 | UI: Retry with own real product after cookie expiry; wait ten seconds. | Success and no stale error. | Not tracked / Can fulfil Yes; own threshold 789 in trace; no stale error. | PASS / availability-recovered-check-en.png |
| 22 / P1 | UI: Invalid-selection check explicitly Polish, 390x844. | Translated error; usable narrow layout. | Polish message wrapped in viewport; inputs and action usable. New key exists in en/pl/de/es/ko. | PASS / availability-stale-selection-pl-mobile.png |
| 23 / P1 | UI/API: Policy create preview: successful then rejected organization, Polish. | Show 422 error and unavailable preview, with retry. | Control 200 showed threshold 789. Rejection 422 cleared cookie but every value became not-set/module-default with no error. Reproduced twice; expected-message assertion exited 1. | FAIL / availability-preview-rejected.png |
| 24 / P1 | UI: Open own person; wait over sixty seconds for Groups. | Membership UI available to admin. | Groups tab absent. Existing registration/person-page spot IDs differ; neither changed by this PR. Assignment used API. | NOT_EXERCISED / person-groups-tab-unavailable.png |
| 25 / P1 | UI: API creates membership; browser deletes group: Escape, reopen, Ctrl+Enter, ten-second wait. | Escape cancels; confirm retires membership and refreshes list. | Escape closed dialog without mutation. Ctrl+Enter deleted; list empty after ten seconds; membership API items [] total 0. | PASS / group-delete-membership-retired.png |
| 26 / P1 | UI: Transient loading and exhaustive mobile row actions. | Useful loader; all actions reachable. | Stable narrow/desktop states captured; transient loader and horizontal row-action interaction not isolated. Mobile group table needs horizontal scrolling. | NOT_EXERCISED / group-mobile-long-name.png |
| 27 / P1 | runtime/UI: Persistent events and company-tab consumer. | Event delivery and consumer refresh. | Database/API cascade verified; persistent worker delivery, company Groups UI and person membership dialog not verified. Person tab absent. | NOT_EXERCISED |

### 🧪 Validation

- Scoped Jest: **128/128 tests; 6/6 suites**, including disposable PostgreSQL. Locking suite passed **ten attempts**, four tests each.
- Live boundaries: **14 passing** across rejected selections, finite scopes, tenant isolation, permission revocation, protected deletion, hard-deleted orphans and existing soft-deleted customers.
- Exact-head production bootstrap, warm reuse and Chromium doctor passed. No full repository CI gate rerun.

### ⚠️ Not exercised

Person Groups tab absent after over 60 seconds for authorized admin, so membership creation was API-only; company Groups UI and membership-dialog keyboard/focus remain unverified. Existing registration uses detail:customers.person:tabs while person page requests customers.person.detail:tabs; neither changed here. Transient loaders, exhaustive horizontal row actions, every state on every screen, and persistent event-worker delivery not isolated. Browser locales en/pl only; new key exists in all five locale files. No applicable monetary mutation/decimal amount field changed; .uxproof absent.

### Cleanup and provenance

Owned app/DB ports closed; recorded disposable container removed; ephemeral state and browser drivers absent. Teardown required a scoped ignored-script fallback, proven twice; shared existing runtimes untouched. Original cez/fe8a4186 branch restored, source status/diff empty; runtime-generated email capture restored. No fixes, source commits/pushes, merges, approval labels or pipeline transitions. Claim release follows publication; completion comment records release.

Artifacts: report.json, command logs, boundary JSON, cleanup proof and **15 genuine PNGs**. Existing CI badges excluded. Follow-up browser scenario posted separately.
