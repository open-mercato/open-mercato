## 📸 UI QA evidence — PARTIAL

**QA head:** d471c576ef1afc0015771af6c9bc3911c9c07889
**Verdict:** ⚠️ PARTIAL — the previously failing preview is repaired on this head. Full complex coverage remains incomplete for membership dialogs and persistent events. Evidence-only; no QA approval.

**Fresh decisive evidence:** authorized preview200/threshold789; real invalid selection422 with translated alert, no fabricated defaults and expired cookie; successful recovery. A previously authorized organization returned200/threshold654, then real422 after another actor revoked access. English/Polish,390px mobile, loading, transport/HTTP fallback and10 cancellation races passed. Previous reports supplied scenario context only.

**Environment:** exact-head isolated production build; disposable pgvector/pg16; local runner; Playwright Chromium1.61.1. Own tenant-bound users/organizations and separate own tenantB. App/database stopped and container removed.

| # / Priority | Route/action | Expected | Fresh observation | Result / Evidence |
|---|---|---|---|---|
| 1 / P0 | API: /api/availability/policies positive | Authorized control or scope refusal; no data leakage | HTTP200; authorized/refusal assertion passed; exact body in api-boundaries.json | PASS |
| 2 / P0 | API: /api/availability/policies rejected selection | Authorized control or scope refusal; no data leakage | HTTP422; selection-invalid code, cookie expired | PASS |
| 3 / P0 | API: /api/availability/policies/resolve-preview?productId=ca82195c-a0bb-4b30-a2f6-be33bb3d1f8f positive | Authorized control or scope refusal; no data leakage | HTTP200; authorized/refusal assertion passed; exact body in api-boundaries.json | PASS |
| 4 / P0 | API: /api/availability/policies/resolve-preview?productId=ca82195c-a0bb-4b30-a2f6-be33bb3d1f8f rejected selection | Authorized control or scope refusal; no data leakage | HTTP422; selection-invalid code, cookie expired | PASS |
| 5 / P0 | API: /api/availability/check positive | Authorized control or scope refusal; no data leakage | HTTP200; authorized/refusal assertion passed; exact body in api-boundaries.json | PASS |
| 6 / P0 | API: /api/availability/check rejected selection | Authorized control or scope refusal; no data leakage | HTTP422; selection-invalid code, cookie expired | PASS |
| 7 / P1 | UI: own actor empty preview | Enter product prompt | Prompt rendered; no fabricated trace | PASS / `preview-empty.png` |
| 8 / P1 | UI: real persisted policy preview and pending loader | 200; own policy threshold 789; useful loading; no defaults while pending | 200 and threshold 789; Loading shown across debounce/pending | PASS / `preview-positive-en.png` |
| 9 / P1 | UI: real rejected organization preview English | 422 selection error, expired cookie, alert and no fabricated defaults | Real 422 organization_selection_invalid; translated alert; dl absent; selection cookie expired | PASS / `preview-real-rejection-en.png` |
| 10 / P1 | UI: recover after rejected selection; ten-second observation | 200 trace, no leftover error | Own threshold 789 recovered; no alert after 10s | PASS / `preview-recovery-en.png` |
| 11 / P1 | UI: real rejected organization preview Polish/mobile | Polish error wraps at 390x844, no defaults | 422 with Polish alert; trace values hidden | PASS / `preview-real-rejection-pl-mobile.png` |
| 12 / P1 | UI: injected transport failure Polish | Translated generic error, no fabricated defaults | Aborted preview request displayed Polish fallback | PASS / `preview-transport-fallback-pl.png` |
| 13 / P1 | UI: injected HTTP error without message | Translated generic error | Synthetic HTTP500 {} displayed Polish fallback; not a server failure observation | PASS |
| 14 / P1 | UI: injected long error and HTML-like text | Readable long text; HTML escaped | Long text wraps at mobile; HTML-like payload remains text, no img element | PASS / `preview-long-error-mobile.png` |
| 15 / P1 | UI: edit-page preview consumer | Persisted threshold visible on edit | 789 rendered in shared preview on existing policy edit | PASS / `preview-edit-positive.png` |
| 16 / P1 | UI: own no-permission actor direct route | Readable access denied; controls absent | Access Denied rendered; separate API refusals recorded | PASS / `availability-no-permission.png` |
| 17 / P0 | API: finite scope all policies excludes other organization | Authorized control or scope refusal; no data leakage | HTTP200; authorized/refusal assertion passed; exact body in api-boundaries.json | PASS |
| 18 / P0 | API: /api/availability/policies no permission | Authorized control or scope refusal; no data leakage | HTTP403; authorized/refusal assertion passed; exact body in api-boundaries.json | PASS |
| 19 / P0 | API: /api/availability/policies/resolve-preview?productId=ca82195c-a0bb-4b30-a2f6-be33bb3d1f8f no permission | Authorized control or scope refusal; no data leakage | HTTP403; authorized/refusal assertion passed; exact body in api-boundaries.json | PASS |
| 20 / P0 | API: /api/availability/check no permission | Authorized control or scope refusal; no data leakage | HTTP403; authorized/refusal assertion passed; exact body in api-boundaries.json | PASS |
| 21 / P1 | UI: create long customer group with double-click | One group and correct fields persisted | One matching group; code/name/description/priority/kind/flags read back | PASS / `group-created-long.png` |
| 22 / P1 | UI: group long-name narrow layout | Long row in a usable horizontal table at390px | 390x844 screenshot shows contained horizontal table; later Polish mobile action-menu check reached Edit/Delete after scrolling. | PASS / `group-long-mobile.png` |
| 23 / P1 | UI: ten loading/cancellation attempts | Older delayed success never replaces newer failure | 10/10 attempts retained current real400 alert after delayed real200; pending loader shown | PASS / `preview-superseded-response.png` |
| 24 / P0 | API: restricted group delete with out-of-scope existing member | 409 with no whole-record changes | 409; complete group row unchanged | PASS |
| 25 / P1 | API/DB fixture: existing soft-deleted out-of-scope customer | 409; complete group unchanged | Own disposable row soft-retired via DB fixture (no product soft-delete path); API409 and full row preserved | PASS |
| 26 / P1 | UI: second-user stale write and keyboard retry | 409; B description and every other field preserved | Different users B200 then A409 twice including Ctrl+Enter; whole row equals B version | PASS / `group-stale-conflict.png` |
| 27 / P1 | UI: person and company membership extension consumers | Groups UI reachable for own authorized user | Both own authorized detail pages still had zero Groups tabs after 62 seconds. Registrations detail:customers.person:tabs / detail:customers.company:tabs differ from pages customers.person.detail:tabs / customers.company.detail:tabs; all unchanged by PR. | NOT_EXERCISED / `person-membership-detail.png` |
| 28 / P1 | UI: refresh and save after stale refusal | Fresh save succeeds, no lost fields or leftover conflict after 10s | 200; all fields except intended name/updatedAt match B version | PASS / `group-stale-recovered.png` |
| 29 / P1 | API/DB fixture: hard-deleted orphan cleanup and repeated actions | Orphan no longer blocks delete; membership retired; reassignment refused | Delete200; membership deleted_at set; repeat404; assignment400 | PASS |
| 30 / P1 | UI: group deletion with allowed membership; Escape and Ctrl+Enter | Escape cancels; confirm deletes and retires membership; list refreshes | Escape preserved group; Ctrl+Enter DELETE200; membership items[] after10s | PASS / `group-delete-membership-retired.png` |
| 31 / P0 | API: own tenant-B authorized positive group control | Own group200 | Own tenant-bound user created and listed own group | PASS |
| 32 / P0 | API: foreign tenant group/policy IDs and product | No tenant-A records; delete/check404; preview excludes789 | Foreign lists empty; group DELETE404; product check404; preview no tenant-A threshold | PASS |
| 33 / P1 | UI/API: second actor revokes previously authorized organization | Prior200 then real422 and alert after ACL revoke | Own scope initially[A,B] preview654/200; admin revokedB with version header; same actor now422/alert | PASS / `preview-after-real-revocation.png` |
| 34 / P1 | UI: availability check real rejected selection | Readable refusal, no success result | Double-click returned422 and English selection-unavailable alert | PASS / `availability-check-real-rejection.png` |
| 35 / P1 | UI: check keyboard retry after refusal | 200; readable result; no stale alert after10s | Ctrl+Enter returned200, own789 trace, no stale refusal after10s | PASS / `availability-check-recovered.png` |
| 36 / P1 | UI: availability check Polish/mobile rejected selection | Translated error at390x844 | Real422 showed Polish message within viewport | PASS / `availability-check-rejection-pl-mobile.png` |
| 37 / P0 | API: explicit empty finite organization scope | No data returned with explicit empty organization grants | Custom availability wildcard + organizations[]: dispatcher403 on all three routes; no data. Resolver-empty branch verified by unit tests only | PASS |
| 38 / P1 | UI: Polish mobile group list and horizontal actions | Translated list and action menu reachable at390px | Observed Otwórz akcje, Edytuj and Usuń after horizontal scroll; page remains within viewport | PASS / `groups-polish-mobile-actions.png` |
| 39 / P1 | Runtime: persistent group/membership event delivery | Persistent event consumed and downstream UI refreshed | Database retirement and HTTP list refresh verified; persistent queue delivery and downstream event subscribers not observed | NOT_EXERCISED |
| 40 / P1 | UI: remaining group transient and membership-dialog states | Every applicable state exercised | Membership creation/removal dialogs unavailable because both Groups tabs absent; transient group loader not isolated, beyond captured stable views | NOT_EXERCISED |
| 41 / P1 | UI: policy and group list empty states | Readable empty lists | Both returned200 and rendered actionable empty states before fixture creation | PASS / `policies-empty.png` |
| 42 / P1 | Validation: scoped Jest and locking repetitions | All targeted tests pass | 135/135 tests in7 suites including disposable PostgreSQL; locking suite10/10 attempts,4 tests each | PASS |
| 43 / P1 | Validation: production build/browser/locale setup | Exact-head app boot, provider launch and complete translation keys | Production build passed266s; CLI readiness416s; authenticated warm reuse; Chromium1.61.1 doctor and translation sync passed; keys present en/pl/es/de/ko | PASS |

### ⚠️ Not exercised
- Person/company membership dialogs could not be exercised: both Groups tabs absent after62 seconds for own authorized actor; unchanged registration/page spot mismatch. Membership setup was API-only.
- Persistent customer_groups lifecycle/membership event delivery and downstream subscriber refresh were not observed. Database retirement, HTTP list refresh and PostgreSQL locking were verified.
- Full state matrix ran on create-preview; edit-preview positive consumer verified. Edit-specific rejection, transient group loading and policy-list UI rejected-selection state were not independently isolated (all three read APIs returned real422).
- Only English and Polish were driven in the browser. New error keys exist in en/pl/es/de/ko and translation sync passes.
- No full repository CI gate or hosted-CI success is claimed. Evidence-only; this run grants no QA approval.

### 🧪 Validation and methodology

- **135/135 tests,7/7 suites** via core Jest configuration; **10/10 PostgreSQL lock-suite attempts**,4 tests each. Production app build, browser doctor, authenticated warm reuse and translation sync passed.
- Both new message keys exist in all five locale dictionaries. Runtime locales: English and Polish.
- Commands and runner corrections are retained in `report.json`, `jest-core.log`, `locking-repeat.log`, `i18n-sync-retry.log` and per-scenario logs. Root Jest/temporary-socket failures were runner issues; no source workaround used.
- API fixture setup and negative submissions are explicitly labeled. Existing soft-delete/orphan states required scoped SQL on disposable fixtures because product DELETE hard-deletes. Synthetic browser errors are labeled injection tests.

### Cleanup and provenance

Owned app35383 and DB35146 are closed; exact owned container `4eb9fd33cb56` removed. No owned runtime processes or ephemeral state. Local teardown fallback repaired and verified twice. Original `cez/b10f417e` branch restored; generated email capture restored; git status/source diff empty. `cleanup.json` records proof. Only owned in-progress claim housekeeping remains until evidence publication; final completion comment records exact-SHA release. Existing screenshots and all QA/pipeline labels retained. No source edits, PR-branch push, merge or shared `.ai/meta/qa.json` changes.

### Follow-up browser coverage

No browser-level test ships in this22-file diff (the added PostgreSQL test is Jest). Extend the existing [follow-up scenario](https://github.com/open-mercato/open-mercato/pull/10996#issuecomment-7233251511) with the now-verified preview alert/loading/recovery and cancellation assertions. Restore Groups injection reachability, then verify membership dialogs and persistent downstream refresh using own fixtures and two actors; clean up in finally.

Artifacts: `report.json`, this report, observations, exact command logs, boundary/whole-record JSON, cleanup proof and **29 genuine browser PNGs**. Each screenshot was non-empty; primary errors inspected full-size and all screenshots inspected in a contact sheet.
