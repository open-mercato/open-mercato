## 📸 Complex QA evidence — PARTIAL

QA head: 75f71cceb0ae18b322743c39ef6b1b85cabd15e2

**The repaired production Redis outage path and all exercised checks PASS. Complex coverage remains PARTIAL**, so this grants no QA approval. Current PR head was rechecked and matches the tested fullSHA. Local isolated production build, fresh disposable Postgres, real dedicated Redis, explicitly enabled rate limits, trust-proxy depth1, optimistic locking all, Chromium/Playwright1.61.1. Own tenant-bound actors,roles,stores,cart/code/price fixtures;no source edits or source pushes.

This continues original Claim-Run5af72462/comment6882729531 under the exact inherited lock;no release/reacquisition or competing claim. Historical [outage failure](https://github.com/open-mercato/open-mercato/pull/9448#issuecomment-6881817998) is now re-exercised after [repair/re-review](https://github.com/open-mercato/open-mercato/pull/9448#issuecomment-6882230065). No risk waiver is used by this QA visit.

| # / Priority | Route and action | Expected | Observed | Result / Evidence |
|---|---|---|---|---|
|1/P0|API: production Redis stop/restart,10 independent pairs of stores|Healthy200; outage fresh and warm keys503/no changes; restart200|Each of10 actual stop/start repetitions passed. Fresh store/client keys and warmed store/client keys; valid and invalid codes503/no-store; every cart/line/application/reservation column deep-equal; same fresh cart valid200 on recovery.|PASS|
|2/P0|API: trusted-IP rotation,10 independent stores|20 guesses across20 tokens; token21 throttled|20x409 then429,Retry-After; full aggregate unchanged on refusal.|PASS|
|3/P0|API: unresolved guests,10 independent stores|GuestB remains available after guestA20 failures|Separate guest/cart valid200 after20 invalid409; deliberately unresolvable trusted-last-hop requests.|PASS|
|4/P0|API: unresolved fallback full bound,10 independent stores|Shared100 budget survives token/untrusted-header rotation|100x409 across5 carts; valid101st request on sixth429,reported limit100,no aggregate changes.|PASS|
|5/P0|API: concurrent store capacity,10 independent stores|100 admitted; remaining10 refused|110 distinct-client requests in parallel groups of10:100x409+10x429 in every independent store.|PASS|
|6/P0|API: successful slot refund and real expiry|Only successful current-window slot refunded; time restores admission|99 failures+3 valid200+1failure409;next429/no mutation. Throttled trusted-IP cart admitted409 after actual61s.|PASS|
|7/P0|Real Redis helper across independent processes/window boundary|100 capacity across both processes; delayed refund never rewards next window|10 two-process120-attempt runs each100 admitted/20 limited/0 unavailable;10 callbacks held across actual minute boundary left later100-capacity window exhausted. Supplementary helper evidence,not a two-app deployment.|PASS|
|8/P0|API: same-org cross-store and separate tenant,9 routes each|Foreign token indistinguishable from unknown; no stored changes|GET,promotion apply/remove,line add/update/delete,bulk,merge,undo-merge404 match unknown token; full aggregate deep-equal;own-store200.|PASS|
|9/P0|API: independently calculated money and lifecycle|3x10 net +20% tax=36 gross;10% code=27net+5.40tax=32.40gross|Expected undiscounted and discounted totals matched. Repeat yields1application/1reservation;remove restores36 and0reservations;reapply1;usage counter0;unrelated cart/line fields unchanged.|PASS|
|10/P1|Native integration via repository CLI|Production isolation,background transitions and order/cart totals agree|6/6 passed:TC-CART-STORE-01,SWEEP01-04,TOT01 real SalesOrder equivalence. Runner local with OM_INTEGRATION_MODULES=cart.|PASS|
|11/P1|Closest UI:/backend/codes/create English default/empty double-submit|Default usable;empty form stays on page|Hydrated role snapshot and real default screen;empty double-submit stayed oncreate. No validation-message assertion.|PASS / step-01-default-en.png|
|12/P1|Closest UI:create long name viaCtrl+Enter thenreload|Single201 and persistence after10s|Own code created201;name persisted after10seconds and reload.|PASS / step-03-saved-en.png|
|13/P1|Closest UI:390px and explicit Polish|Usable narrow layout and translated code form|Genuine long-name detail at390px;explicit pl cookie/locale redirect yielded translated title,fields and Save.|PASS / step-05-polish.png|
|14/P0|UI/API:own restricted viewer in separate browser context|Direct page denied/noSave;direct API refused|Independent narrow-role user Access Denied,no Save;GET/POST403;owner create201 positive control.|PASS / step-06-viewer-denied.png|
|15/P0|UI:two real actors save different fields and retry stale form|B quota persists;A stale name rejected twice|B saved a different quota;A button save409,focus/refill thenCtrl+Enter409;entire stored code row equals B after both.|PASS / step-09-stale-conflict.png|
|16/P1|Closest UI:list and empty search|Own rows visible;unmatched search yields no-results state|Hydrated table shows own fixtures;unique query produced No results found/Clear search.|PASS / step-10-empty-list.png|
|17/P1|Cart/promotions native units|Relevant suites pass|50 suites/587tests passed;11 existing skips (1 skipped suite). Local workspace Jest runner.|PASS|
|18/P0|Remaining complex lifecycle and UI matrix|Every applicable complex rule exercised|See explicit limits below:checkout/payment/stock/code worker+expiry,server-error/loading/focus variants and full memory production remain unexercised.|NOT_EXERCISED|

### ⚠️ Not exercised

- Fresh current-head production uses Redis only. Memory behavior is covered by native unit/route suites; a second current-head production memory-mode app was not booted.
- No runtime fault injection for missing/throwing/degraded limiter registration or refund-error path; native units cover those seams. Actual configured Redis loss/recovery is exercised.
- Native4 cart sweepers passed, but promotion reservation-expiry worker,generated-code generation,full code redemption/use/revert/undo/delete quotas and checkout conversion/cancel/paid/refunded stock/payment lifecycle were not exercised.
- Cart exposes APIs and no released cart admin screen; cart/money/isolation/setup checks are API-driven. Closest promotional-code UI is genuine runtime evidence and does not visualize the cart503/429 assertions. Promotion tree was API fixture setup,not UI tree-editor QA.
- UI state matrix:default,empty search,no-permission,long content,mobile,conflict error,persistence passed. Dedicated loading indicator,generic server-error/retry,all submit variants,Escape/nested-dialog behavior,full focus recovery and post-conflict successful refresh were not fully exercised. Empty submit remained onform; no validation-message assertion.
- Independent EUR20%-tax,quantity3,10%code amounts and actual sales-order equivalence passed. Shipping,multicurrency,tax-edge rounding and exports were not exercised. Closest code UI has strings/integer quotas and no decimal monetary field;decimal-comma amount persistence is genuinely inapplicable to that form.
- English/Polish closest screens exercised;other3locales not browser-tested. Diff adds no i18nkeys. No before-fix production app was rebuilt:historical production failure6881817998 and source repair6882230065 are linked for provenance,not relabeled.
- Focused6native integration tests passed;full39cart suite/full repository validation gates and hostedCI were not rerun in this evidence-only task. No QA signoff/failure or pipeline changes;native changes-requested review remains a separate gate.

### Retry transparency and provenance

- Retry transparency:initial fixture rule used children instead of rules and expected200 instead of201;Node fetch did not preserve storefront Host so corrected to repository Playwright API transport;trimmed long-name expectation;stale keyboard retry needed input focus. All corrected runs retained.
- Inherited dynamically published Redis changed port32844 to32845 on stop/start. Replaced only chain-owned container with fixed32844 Redis;final outage scenario rerun10times with fresh+warm independent stores and valid200 precontrol/recovery. Earlier port-drift attempts are fixture errors,not product regressions.
- Unscoped Playwright collection consumedCPU without reaching tests;bounded attempts stopped by exact ownedPID tree. Scoped OM_INTEGRATION_MODULES=cart runner passed6tests in12.2s;no source or test assertions changed.

### Cleanup and claim

Evidence published before teardown. Terminal cleanup/claim proof will be appended after only owned runtime/Postgres/Redis are removed and original comment is marked released with exact-SHA ref lease deletion. Existing screenshots is informational;pipeline/QA approval/failure labels remain unchanged.

Nine selected genuine runtime PNGs accompany this report. They show closest promotional-code UI,not API results. Full machine report,scenario,logs,environment/ownership proof and screenshots are retained in this cockpit run’s Assets.
