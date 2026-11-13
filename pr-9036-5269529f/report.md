## 📸 UI QA evidence — FAIL

Deleting a call still leaves its planned card, day marker and parent activity count visible after10seconds on a production build. Reload clears them. The new historical-only deletion path itself works.

QA head: 5ff239b66be09e51006f7ab56eb166db9ab2432a

Runner: local; exact-head production ephemeral CLI through `om-prepare-test-env`, cold/warm ready at `http://127.0.0.1:34505`; real Chromium, enterprise flags enabled. Fresh company/call created through UI, historical-only rows inserted solely into this run’s disposable DB because the current API creates canonical records. English then explicit Polish;1440×1000 and375×812. API checks use their own narrow tenant actor.

| # | Action | Expected | Observed | Result / screenshot |
|---|---|---|---|---|
| 1/P1 | Cold/warm exact-head production app; browser doctor and UI company creation | Runnable exact PR code and useful loading/empty states | Production CLI at34505 cold/warm ready; Chromium launched; fresh company created via UI; empty activity history and loading indicator observed | PASS; `step-01-created-company.png` |
| 2/P1 | UI log a fresh call on company Activity log | History, planned card, calendar and activity total show the call | POST201; history1, planned call, day marker1 and activity total1 | PASS; `step-02-live-call.png` |
| 3/P0 | Open row overflow and cancel destructive confirmation with Escape | Delete lives in menu; cancellation preserves the activity | Edit/Delete activity in overflow; translated confirmation; Escape dismisses without deletion | PASS; `step-04-confirm.png` |
| 4/P0 | Confirm canonical delete and wait10.5seconds | History, planned card, day marker and parent count all remove the deleted activity | DELETE200 and history0, but planned call remains, calendar1 event and parent activity total1. Confirmed on production build | FAIL; `step-05-after-delete-10s.png` |
| 5/P0 | API: authenticated readback; reload company | Record remains absent; screen reconciles | Bearer GET200 excludes id; reload clears planned card, marker and total. Initial cookie-only401 was corrected and is not absence evidence | PASS; `step-06-after-reload.png` |
| 6/P0 | Historical-only fixture then delete through actual UI | Adapter bridges and deletes without false version conflict | Own isolated DB inserted only customer_activities row; UI DELETE/api/customers/activities200, no optimistic version header; adapter GET200 excludes row; DB shows canonical same-id soft-deleted bridge | PASS; `step-08-historical-only-deleted.png` |
| 7/P0 | API: repeat delete, fresh narrow viewer and anonymous control | Clear404; viewer can read but cannot delete; anonymous401 | Repeated DELETE404; own narrow tenant actor GET200/DELETE403; anonymous401. Fresh user and final role deleted200; disposable DB teardown removes initial failed-setup role | PASS |
| 8/P1 | Explicit Polish375x812: menu, confirmation and Escape | Translated deletion text and reachable cancellation | Dziennik aktywności/Otwórz akcje/Usuń aktywność/Usunąć aktywność?/Anuluj visible; Escape preserves another own historical fixture | PASS; `step-10-polish-delete-confirm.png` |
| 9/P1 | Narrow viewport containment | Content stays within375px | document.scrollWidth632px at375px. Same overflow recorded in prior9036 QA; no new overflow attribution to legacy-adapter commit | FAIL; `step-09-polish-narrow.png` |
| 10/P1 | Static locale-key audit in module and app | Six new deletion keys in en/pl/es/de/ko; no app overrides | All30 entries present; no shadowing app keys | PASS |
| 11/P1 | Focused units and shipped native integration via CLI | Changed call-site tests pass | 25/25 focused Jest across3 suites PASS; TC-CRM-4273 via authoritative CLI PASS1/1 (216995ms). Native test checks history only and misses stale planned card/count | PASS |
| 12/P0 | Remaining applicable complex checks | Full shared-consumer and lifecycle/permissions matrix | Not exercised after confirmed defect: person/deal/older timeline hosts and other shared RowActions modules; second distinct editor stale write; cross-tenant controls; full-record save comparison; undo/redo, double-submit, Cmd/Ctrl+Enter after error; forced request failure/retry; long content and exhaustive loading/permission UI matrix | NOT_EXERCISED |

### Next action and coverage limits

`ActivityHistorySection` still hands deletion only its local `handleActivityChanged` refresh. Propagate success to the parent detail refresh so planned activities/calendar/KPI reconcile. Extend `TC-CRM-4273` to assert all those surfaces, plus a historical-only fixture, before rechecking person/company/deal hosts. The shipped test passes1/1 and the25 focused unit tests pass, so those assertions alone do not establish whole-screen correctness.

This is **FAIL with partial complex coverage**, not a QA sign-off. The unexercised required checks are retained in row12; shared `RowActions` has consumers beyond the exercised company page. Current narrow-layout overflow was already present in earlier QA; it is observed here without blaming the latest adapter fix. New deletion keys are complete in all five supported locales, with no app overrides. No amount field is changed.

The initial cookie-only API probe answered401 and was repeated correctly with a bearer token; only the latter200 proves absence. Initial actor fixture setup was corrected before negative controls. All fixtures were confined to the disposable DB, now removed; narrow actor/final role deletion also returned200. Own app and DB ports are closed, own container absent, and runtime email-capture changes restored. Teardown’s broad process filter briefly restarted the local tool helper; it was repaired to select only recorded environment-owner descendants. No source fix, project-branch push, merge or QA approval/failure/pipeline mutation was made. Existing `screenshots` means evidence presence only.
