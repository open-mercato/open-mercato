## 📸 UI QA evidence — FAIL (partial complex coverage)

**The refresh repair passes the tested paths. A fresh read-only CRM user is still offered Delete activity and its destructive confirmation; the server refuses with403. Existing mobile overflow also remains. This is evidence only, not QA approval.**

QA head: 4ef1b46470bbead957d09e68a86b4289eb678cc3
Current head at publication preflight: 4ef1b46470bbead957d09e68a86b4289eb678cc3

Runner: local, exact-head isolated production ephemeral app `http://127.0.0.1:38701`, disposable Postgres33278; enterprise/SSO/security enabled; Chromium1.61.1. Fresh UI company/person/deal and activities; separate fresh editor/viewer/foreign-tenant actors. EN then explicitly selected `locale=pl`; desktop1440×1000/mobile375×812.

### Findings

1. **Permission UX:** view-only role (`customers.people/companies/deals/activities/interactions.view`, no manage grant) sees the **Edit / Delete activity** menu and the destructive confirmation. Actual UI DELETE403 shows “Could not delete activity” and preserves data. Gate the delete affordance by the effective manage feature for canonical/legacy paths. `ActivityHistorySection.tsx:365` creates the handler unconditionally and passes it at498; `ActivityCard.tsx:259` checks only handler presence. Equivalent timeline wiring also needs review. Server authorization is intact; this is not a demonstrated write bypass.
2. **Narrow viewport:** company document632px and person/deal439px at375px. Company overflow was already in prior [QA6862979744](https://github.com/open-mercato/open-mercato/pull/9036#issuecomment-6862979744), so this run does not attribute it to the latest repair. New Polish deletion copy is translated; surrounding existing English month/filter chrome and seeded custom fields remain.

### Observed scenario

| # / Priority | Route/action | Expected | Observed | Result / local screenshot |
|---|---|---|---|---|
| 1 / P1 | Exact-head production provisioning and browser doctor | Own worktree/app/database at current SHA; authenticated readiness | Own port38701/Postgres33278; owner/listener cwd verified; Chromium launched; cold runtime phase263s, warm reuse<1s. Enterprise/SSO/security and optimistic locking enabled. | PASS; `step-01-company-loading.png` |
| 2 / P1 | Company: UI create company and double-click Log call | One create; empty/loading states and all activity views reconcile | One interaction POST201; history/planned/day marker/filter/parent total all1. | PASS; `step-03-company-call-created.png` |
| 3 / P0 | Company: overflow Delete activity then Escape | Destructive confirmation; cancel sends no deletion and preserves every field | Edit/Delete activity menu; Escape closes; complete API record unchanged. | PASS; `step-04-company-delete-confirm.png` |
| 4 / P0 | Company: confirm delete; wait10.5s without reload | All history/planned/day/filter/parent count remove activity | DELETE200; all listed surfaces0 after10.5s. API200 items[]; repeated delete404. | PASS; `step-05-company-delete-after10s.png` |
| 5 / P0 | Company: ten independent UI delete/Undo repetitions | No intermittent stale view; undo restores whole record | 10/10 delete200 and undo200; history/planned/day/filter restored; after10.5s every iteration still correct; only updatedAt differs in whole-record readback. race-results.json. | PASS; `step-07-ten-races-undo.png` |
| 6 / P0 | Fresh narrow viewer: company activity menu and actual UI delete | Read-only role must not offer a mutation it cannot perform | Role has only customers view features; menu still exposes Delete activity and destructive confirmation. UI request403 and friendly Could not delete activity; record survives. New onDelete wiring lacks manage-feature gating. | FAIL; `step-08-viewer-menu.png` |
| 7 / P0 | API: fresh viewer, anonymous and foreign-tenant negative controls | Clear denial; no tenant-A data exposure; working positive control | Viewer GET200/DELETE403; anonymous DELETE401; foreign GET200 empty/DELETE403. Foreign own company POST201/GET200. API-only fixture setup/controls. | PASS |
| 8 / P0 | Person: UI create person/call, title edit with Ctrl+Enter, cancel and double-confirm delete | Title-only save preserves all other fields; cancel unchanged; deletion clears UI | PUT200 changes exactly title/updatedAt; Escape whole record unchanged; double-confirm yields one DELETE200. After10.5s history/day/filter cleared. | PASS; `step-10-person-deleted.png` |
| 9 / P1 | Deal: UI create linked deal and scheduled meeting | History, planned panel, week preview and type count show new activity | Fresh linked company/deal created through UI; planned meeting appears in all four surfaces. | PASS; `step-11-deal-created-week.png` |
| 10 / P0 | Deal: distinct fresh editor B changes location; stale A title save | 409 and B location preserved, with no unintended field changes | B PUT200 changes location/updatedAt only. A PUT409; one record remains, original title plus B location. Dialog closes and conflict bar persists; transient New meeting label not treated as a stable bug. | PASS; `step-13-stale-refusal-stable.png` |
| 11 / P0 | After refusal: refresh, reopen and Ctrl+Enter retry | Working keyboard/focus and clean success retaining B data | Refreshed form contains B location; A title retryPUT200 changes title/updatedAt only. No conflict bar after10.5s. | PASS; `step-14-deal-retry-success.png` |
| 12 / P0 | Deal: delete then Undo; wait10.5s | History/planned/week/filter restore without reload | DELETE200/Undo200. History, planned meeting and week text restored after10.5s. Full response captured in deal-retry-integrity.json. | PASS; `step-15-deal-undo-week.png` |
| 13 / P0 | Deal: Audit Log Redo this action; return to detail | Redo deletes restored activity durably | Redo200 through real Audit Log UI. Return to deal and wait10.5s: title absent in history/planned/week. This involves navigation; live mounted-host redo notification is not browser-proven. | PASS; `step-17-deal-redo-absent.png` |
| 14 / P0 | Legacy-only fixture: UI delete through activities adapter | Bridge/delete succeeds without false optimistic version conflict | Own disposable DB inserted customer_activities only; canonical count before0. Actual DELETE/activities200, version header absent, UI row absent after10.5s; canonical same-id deleted_at verified. | PASS; `step-19-legacy-deleted.png` |
| 15 / P0 | Injected failure: UI delete receiving simulated500; keyboard and Escape recovery | Clear error, no false success or mutation, usable retry/cancel | Browser-only one-request simulated500 (not a product500). Ctrl+Enter submits; Could not delete activity shown; full API record unchanged. Reopen confirmation and Escape work. | PASS; `step-20-simulated-error-preserves-record.png` |
| 16 / P0 | Completed call: Mark done then edit only a long title | Dates, completion status and every other field remain stable | Complete200 then titlePUT200. Changed fields exactly title/updatedAt; scheduledAt/occurredAt/status and all other response fields preserved. | PASS; `step-21-long-completed-call.png` |
| 17 / P1 | Explicit Polish company/person/deal and translated deletion dialog | Translated changed action strings, reachable cancel, no broken narrow layout | New Edit/Delete/confirmation/Cancel text translated; Escape preserves record. Company width632px, person/deal439px at375px. Company overflow already in prior QA6862979744; not attributed to latest refresh repair. Existing English November/filtered chrome and seeded custom-field text also remain. | FAIL; `step-23-polish-delete-confirm.png` |
| 18 / P1 | New locale dictionary keys across en/pl/es/de/ko | Six new deletion keys in every supported module locale, no app shadow | 30/30 new entries present; no matching app override keys found. locale-audit.json. | PASS |
| 19 / P1 | Shared RowActions representatives: CRM lists/timelines, catalog products, sales orders, auth users, Audit Log | Existing no-icon/link/button menus remain reachable and cancellable | Catalog Edit/Delete; ArrowDown focuses Delete, Escape closes. Sales Open/Delete order/Create shipment; auth Edit/Show roles/Delete; company generic list View details/Open in new tab/Delete. Older company timeline exposes Delete activity and Escape preserves record. | PASS; `step-26-catalog-row-menu.png` |
| 20 / P1 | Relevant automated checks | Package suites and committed integration pass at tested head | 112/112 focused package tests PASS (98core+14ui,12suites); authoritative CLI TC-CRM-4273 1/1 PASS213311ms, native Playwright rerun1/1 PASS. Root Jest invocation initially failed TS5011 before running tests; corrected package configs used. Production app build passed. | PASS |
| 21 / P1 | Remaining shared consumer breadth, every lifecycle variant and live-host redo | Every applicable complex path exercised | NOT_EXERCISED: remaining consumer groups in consumer-groups.json (115production files/42groups including shared UI/template); full create/edit/delete/undo/redo for every entity/legacy variant; mounted-host redo without navigation; canonical-toggle alternate mode; old person route; full permission UI matrix, all-organization selector, cross-tenant browser UI and stale-delete concurrency. Confirmed failures retained; no full-complex PASS. | NOT_EXERCISED |
| 22 / P1 | State matrix and perceived performance | Default, empty, loading, error, no-permission, long-content and narrow states | Default/empty/loading captured; actual403 and simulated500 error paths; long title and narrow screens exercised. Useful loading message appears. No measured latency benchmark, exhaustive read-load failure matrix, UXProof contract audit or 15-minute separate exploratory sweep. | NOT_EXERCISED |

### Complex rule classification

| Rule | Result | Evidence / limit |
|---|---|---|
| 1 Conversation | PASS | Every PR conversation page7comments/1review/0inline, linked predecessor4273/5629 comments and9487/9488 read; prior6862979744 read. |
| 2 Runtime surface | PASS | UI/API interactions/legacy adapter and audit undo/redo exercised. No new external worker/webhook/payment path in diff; independent index/worker failure modes not tested. |
| 3 Shared consumers | PARTIAL | 115production files/42groups inventoried; representative CRM/catalog/sales/auth/audit exercised; other groups not exercised after confirmed failures. |
| 4 Intermittency | PASS | 10delete/undo UI repetitions with10.5s restored-state and whole-record checks. |
| 5 Own fixtures | PASS | Own company/person/deal/activities through UI; own API roles/editor/viewer/foreign tenant positive control; legacy-only via ownDB. All removed with disposable DB. |
| 6 UI first | PARTIAL | Primary writes UI. Actor/tenant permission fixtures and negative controls API; historic-only fixture SQL because public API creates canonical rows. |
| 7 Second actor/stale | PASS | Fresh distinct editor B location change; A409; refreshed title retry preserves B. |
| 8 Integrity | PASS | No demonstrated field loss; stale A refused. |
| 9 Whole record | PASS | All response keys compared on company undo, person title edit/cancel, completed title edit and deal B/A saves. |
| 10 Reverse/lifecycle | PARTIAL | Delete/cancel/undo/repeat exercised; redo Audit Log+return. Full matrix and live-host redo not exercised. Money/stock/credit/codes not changed. |
| 11 Amount reconciliation | INAPPLICABLE | No changed amount field, tax/price/balance mutation; deal monetary inputs untouched. |
| 12 Direct refusal | FAIL | Server403/401/isolation controls pass, but new Delete activity still offered to view-only actor. |
| 13 After refusal | PASS | Actual409 refresh/reopen/CtrlEnter success; double-click create/delete; simulated500 CtrlEnter then reopened Escape. |
| 14 Messages | FAIL | New error text clear; existing Polish screens retain English month/filter chrome and demo custom-field text. |
| 15 Decimal comma | INAPPLICABLE | No amount input in changed activity delete/refresh surfaces; no amount edited. |
| 16 Languages | FAIL | EN/PL all three details; new deletion translations complete, existing untranslated surrounding chrome remains. |
| 17 After success | PASS | 10.5s company deletion, every race restore, person deletion, deal restore/redo and successful conflict retry checked. |
| 18 Exploration | PARTIAL | Targeted completed-date, old company timeline, generic menu and mobile exploration done; separate full15minute sweep not completed. |
| 19 Gaps | PASS | API-only, navigation-assisted and unexercised required checks enumerated honestly. |

### Coverage limits and next action

Fix effective-feature gating for the new delete affordance and rerun the narrow viewer case. Preserve the strict whole-screen assertions that now pass, including week/filter/count and Undo. This run exercises significantly more than the shipped history-only TC-CRM-4273; it still does **not** establish complete complex-depth coverage. The unexercised required paths are listed above and in `consumer-groups.json`. No new integration-test follow-up comment is required because the PR already ships a UI test; extend that test with whole-screen, read-only-role and concurrency assertions.

Runtime paths tested: canonical delete, historical adapter bridge/delete, action audit, Undo/Redo and visible refresh effects. Independent worker/index failure modes, external integrations and alternate canonical-toggle configuration are not claimed. No money, stock or credit mutation is part of this diff; decimal-comma/money reconciliation checks are inapplicable to the changed surface.

### Validation and cleanup

- Focused package Jest:12suites/112tests pass. Root direct Jest initially hitTS5011 before tests; package-config runs are the valid results.
- Authoritative `yarn mercato test:integration TC-CRM-4273`:1/1 pass,213311ms. Separate existing-config Playwright rerun1/1 pass. Production build, immutable install and cold/warm authenticated provisioning pass. Full monorepo validation gate was not run.
- Actual process/PID/cwd proof retained. Own app/worker/owner stopped, app38701 and DB33278 ports closed, own container`8ec68b27f716` absent. Teardown fallback repaired to remove only recorded disposable container and verified safe twice. All fixtures removed with that database. Runtime email-capture restored; `git status --porcelain` empty.
- Source read-only; no source fix, source-branch push, merge, QA approval/failure label, pipeline transition or shared `.ai/meta/qa.json` edit. `screenshots` means evidence presence only. This run’s original atomic claim is released after publication; the release is recorded in its original claim comment and local proof.

Local artifacts: `/home/maintenance/cezar/projects/open-mercato/.ai/cezar/artifacts/594f140c-a6fd-40f6-9684-42fad38e8073` (`report.json`, `report.md`,28real PNGs including one diagnostic loading capture, command logs and integrity JSON).
