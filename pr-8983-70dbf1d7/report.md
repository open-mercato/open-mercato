## 📸 Independent UI QA evidence — PASS

**Fresh affected-scope complex QA PASS** at `1f3810ddea99b21ef557132fe0495346749a297b`. This supersedes this run’s initial read-only PARTIAL audit. **Evidence only: no new approval/signoff, failure or pipeline label.**

QA head: 1f3810ddea99b21ef557132fe0495346749a297b

Own isolated production environment through `om-prepare-test-env`, port46747 and disposable PostgreSQL33179; cold and authenticated warm readiness passed. Two newly created tenant-bound editor users in separate browser contexts, own forms/roles and a separate view-only negative actor. Playwright/Chromium149 doctor passed. Live aria snapshots preceded UI interactions.

### Fresh observations

| Scenario | Observed |
|---|---|
| Owned tenant-bound distinct actors | Two new users in separate authenticated browser contexts; own editor/viewer roles and own form — PASS |
| Repeated two-actor stale writes | 10 independent rounds,20 UI PATCH409 refusals,truthful failure; each complete server record preserved — PASS |
| Conflict refresh and explicit recovery | Name saved200,other actor description preserved,clean saved state after10s — PASS |
| 503 refusal and explicit next-edit retry | Failed write unchanged whole record; retry saves both pending fields;clean after10s — PASS |
| Coalesced metadata writes | Rapid name and description edits produce exactly one edited-fields-only PATCH — PASS |
| Edit queued behind in-flight mutation | Delayed first save and queued description both200; no false409;latest field values preserved — PASS |
| Reload cancels queued timer | Immediate reload did not persist the unsent title or alter any server field — PASS |
| Publish dialog Escape | Dialog opens from current editor after refusal/recovery and Escape cancels — PASS |
| Five-locale narrow editor | EN/PL/DE/ES/KO editor controls reachable at375px with no document overflow;existing Korean fallback remains attributed — PASS |
| Permission negative with positive control | Owned forms.view-only user denied editor and direct PATCH403;owned editor users previously saved — PASS |
| Loading state | Delayed own form GET shows useful loading state and then editor recovers — PASS |
| Load error and recovery | Controlled503 GET shows explicit localized error;ordinary reload returns usable editor — PASS |
| Whole-record integrity final | All synthetic scenarios concluded with a readable record and unchanged unedited fields — PASS |

**Native regression:** 16/16 PASS, zero skips/flaky, through the repository CLI on the same exact-head environment. Includes original Forms narrow wrapping, EN/PL metadata-autosave regression (both formerly failing cases), Forms ACL/scoping/locking and warranty CRUD/line/optimistic-lock tests. **Focused units:** 3 suites /12 PASS. Build→generate→build and production app build/typecheck passed. No assertions, source or repository configuration were changed.

### History and delta audit

At scan head `a38bce`, real CI [43473952126](https://github.com/open-mercato/open-mercato/actions/runs/43473952126) had150 passing tests and two EN/PL PATCH-wait timeouts, including retries. It was an affected regression, not a proved baseline exception. Independently recomputed automatic main merge tree matches a38 exactly: `2d485c4d293a1d3ff19a4d31af9ca3d087fedc40`.

Current `e87f1f8667` lifecycle fix keeps FormStudio’s autosave/reload identities stable and forwards mutations through the latest guarded handler ref. No assertion weakening or shared hook change. Only other post-scan file is an enterprise documentation spec. Native and own two-user runtime checks above independently verify this materially changed path; old approval was not reused for it.

Consumer search: local metadata controller→FormStudio, locale controls→FormPalettePanel, stage chrome→warranty claim detail. Input/Button/Textarea, apiCall, locking/conflict utilities and mutation-hook source are identical across the old-to-scan merge. Main also adds translated CRUD error strings plus separate warranty portal/line/SLA/setup fixes; this audit does not call all warranty behavior unchanged.

Unchanged browser warranty stage/layout/lifecycle observations remain attributed to [prior complex evidence](https://github.com/open-mercato/open-mercato/pull/8983#issuecomment-6856183983) and its stated coverage limits. They were not rerun as new warranty browser evidence here. Its14 screenshots and older45 unaffected observations retain their original attribution. This run publishes15 genuinely new PNGs. The other owner’s current-head two-image report remains credited separately, not counted as ours.

### Coverage limits and harness notes

API-only work: fixtures, whole-record readback, direct403 negative and native API cases. Primary metadata edits, conflicts, refresh/retry, five-locale layout and permission page were UI-driven. Controlled503/delayed GET are fault injection. No amount fields, worker/webhook/scheduler/external-provider behavior changes in the new FormStudio lifecycle delta. No new locale strings; Korean retains its existing English Forms fallback. Loading/default/empty/error/denied/long-content/narrow states were observed. Monetary reversal and external providers are unchanged-scope prior coverage, not new execution.

Harness attempts are retained: an overlong213-character title correctly returned400; the valid long-title follow-up passed. A follow-up missing route variable and a route-removal race were corrected in artifact-only scripts, with the final loading/error/recovery run actually passing. Initial direct Jest hit TS6 TS5011 before tests; an artifact-only explicit existing rootDir ran all12 unchanged tests. No source or test assertion was weakened.

Full current-head remote CI remains separately required: run [43490913623](https://github.com/open-mercato/open-mercato/actions/runs/43490913623) was still running when inspected. No merge readiness or remote-CI PASS is asserted.

### Cleanup and ownership

Initially respected the foreign atomic claim. Acquired our own claim only after its verified release, retained exact lock `a5b4a546d676f171de903cef63009c072bfb08e3` plus verified in-progress, preserved all assignments. Four own forms archived/read back;12 users and8 roles deleted and absence verified. Browsers closed; crashed-harness fixtures also cleaned. Exact own CLI379638 stopped; app46747 closed and own PostgreSQL container `d6117b7c4a5a` stopped. No sibling services or shared dependencies touched. Runtime email-capture output restored; source status clean. Own in-progress/comment/ref release follows evidence publication. No source pushes/merges, shared QA metadata writes or approval/pipeline changes.

Repeatable native filter: `TC-FORMS-UI|TC-FORMS-ACL|TC-FORMS-TEN|TC-FORMS-LOCK|TC-WC-001|TC-WC-002` through `yarn mercato test:integration` after provisioning an owned production environment with `om-prepare-test-env`. Exact-head reports, native output/results, screenshot hashes and cleanup proofs are retained alongside the inline visuals.
