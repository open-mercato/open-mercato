## 📸 UI QA evidence — PASS

**Verified:** `cez/8649747f` @ `8896a13d1e1cc2055839aab8db1beb5750a32c40`; isolated native CLI app `http://127.0.0.1:53328`, Node24.22.2 / Playwright1.61.1 / Chromium. Evidence-only run; no QA approval or human waiver is granted.

| # / Priority | Route and action | Expected | Observed | Result / Evidence |
|---|---|---|---|---|
| 1 / P0 | Native TC-CHKT-045 through repository CLI | Both unprotected and password-protected API cases pass; real signed cookie; public/preview omissions and admin preservation | 2 passed, 0 skipped/unexpected/flaky; 94.56s Playwright duration | PASS — [tc045-results.json](tc045-results.json) |
| 2 / P0 | Anonymous public /pay/:slug and GET /api/checkout/pay/:slug | Payer title, pricing and inputs render; administrative members absent | All 18 removed members plus gatewaySettings/passwordHash/scope identifiers absent; remainingUses=10; $49.99 page and Pay now render | PASS — [step-public.png](step-public.png) |
| 3 / P0 | Password-protected pay page before verification | Minimal challenge only, no administrative data | API equals {requiresPassword:true,title}; browser password gate renders | PASS — [step-password.png](step-password.png) |
| 4 / P0 | Wrong then correct password through real UI | Wrong password rejected; signed HttpOnly cookie unlocks public DTO | Wrong password HTTP401; correct verification HTTP200; om_checkout_access HttpOnly cookie observed; browser-loaded payload forbidden fields absent | PASS — [step-password-verified.png](step-password-verified.png) |
| 5 / P0 | Unauthenticated preview for public/password/draft fixtures | Preview requires admin authorization | All three unauthenticated preview requests return HTTP401 | PASS — [cleanup.json](cleanup.json) |
| 6 / P1 | Authenticated draft /pay/:slug?preview=true | Public DTO only, preview=true, available=false; payments disabled | Forbidden fields absent; preview banner rendered and Preview only button asserted disabled; ordinary draft GET404 | PASS — [step-preview.png](step-preview.png) |
| 7 / P0 | Admin GET /api/checkout/links/:id for all three fixtures | Full administrative configuration retained | All 18 keys present; all nine email values/flags exact; maxCompletions=10, counters=0, isLocked=false; timestamps present | PASS — [qa-api-explore.json](qa-api-explore.json) |
| 8 / P1 | Authenticated admin editor email tabs | Configured email subjects/bodies/send settings remain readable | Started subject value, all three body values and checked send flags asserted; screenshots show all three configured subjects and bodies | PASS — [step-admin-started.png](step-admin-started.png) |
| 9 / P1 | Own fixture cleanup | Only disposable fixture records removed | Three deletes HTTP200 with their own updatedAt headers; every subsequent admin GET404; native tests also clean up in finally | PASS — [cleanup.json](cleanup.json) |

### Limits and execution details

Fresh native ephemeral database/app on published head. Cold boot and warm reuse verified; own fixture deletion verified.

No real payment submission, external gateway, email delivery, mobile layout or stored production data exercised.

Initial environment launcher selected Node26 through mise Yarn shim; torn down before QA, corrected local launcher to actual Node24/Yarn binaries and prepared fresh environment.

First admin navigation waited for networkidle and timed out on the backend event-streaming page; replaced the harness wait with DOM-content-loaded plus actual detail-response and field assertions, without increasing any timeout or altering source/test assertions.

API TC-CHKT-045 is committed; browser privacy regression flow was exploratory and has no dedicated committed UI test.

### Follow-up browser test

Automate this verified flow with fixture creation and finally cleanup: anonymous public rendering; password challenge, wrong-password rejection and real-cookie unlock; authenticated draft preview with a disabled payment button; admin email tabs retaining their configuration. Assert forbidden response keys while navigating and keep screenshots. Reuse existing native checkout fixtures and runner; TC-CHKT-045 already covers the API boundary.

### Screenshots

Public, challenge, verified password, draft preview and all three admin email tabs are attached by the native tracker evidence operation. Screenshot bytes were inspected locally; all data is disposable QA content.
