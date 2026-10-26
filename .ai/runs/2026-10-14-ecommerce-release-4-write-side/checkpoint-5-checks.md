# Checkpoint 5 — Step 8.12 Part 1 (live integration gate): BLOCKED on two genuine findings

**Runner:** ephemeral Docker (`yarn test:integration:ephemeral "cart|promotions"`), colima confirmed running first. Images already cached (`node:24.20.0-trixie`, `pgvector/pgvector:pg16`) from a prior run on this host; full cycle (DB init 53s, package build 134s, generate 19s, rebuild 19s, app build 308s, readiness 16s, Playwright run 9.2m) ≈ 10 minutes end to end. Environment torn down cleanly afterward (`.ai/qa/ephemeral-env.json` cleared, no leftover containers/processes).

## Part 1 result: 58 passed / 0 skipped / **8 failed** (66 total)

```
packages/core/src/modules/cart/__integration__/TC-CART-PRICE-03-variant-reprice-isolation.spec.ts            FAILED
packages/core/src/modules/cart/__integration__/TC-CART-PROM-05-applied-promotions-view.spec.ts                FAILED
packages/core/src/modules/cart/__integration__/TC-CART-TOT-01-phase3-promotions-order-equivalence.spec.ts     FAILED
packages/core/src/modules/promotions/__integration__/TC-PROM-022b-concurrent-code-use-race.spec.ts            FAILED
packages/core/src/modules/promotions/__integration__/TC-PROM-074-tree-builder-ui-roundtrip.spec.ts            FAILED
packages/core/src/modules/promotions/__integration__/TC-PROM-075-benefit-cap-selector-auto-assign.spec.ts     FAILED
packages/core/src/modules/promotions/__integration__/TC-PROM-082-phase3-routes-cross-tenant-isolation.spec.ts FAILED
packages/core/src/modules/promotions/__integration__/TC-PROM-083-codes-backend-ui.spec.ts                     FAILED
```

No specs were skipped (previously-skipped CONC-05/CONC-04 are now un-skipped and both passed: `TC-CART-CONC-05` and `TC-CART-CONC-04` are green in this run).

**Per Part 1's own instruction ("if ANY spec fails... determine genuine regression vs environmental, STOP before Part 2 on a genuine regression") — two genuine, well-evidenced findings below. Part 2 (UI screenshots) and Part 3 remain attempted/completed independently where they do not depend on these; Part 2 itself is NOT attempted, per that stop instruction.**

## Finding A (genuine product regression) — Step 8.10's code charset (`/^[A-Z0-9]+$/`) rejects hyphens, breaking every PRE-EXISTING fixture's code-naming convention

Step 8.10 (`8d9c24baef`, QA F9) added `clearableUppercaseStringSchema`'s charset check to `code`/`prefix`/`suffix` restricted to `A-Z0-9` only — no hyphens, no underscores. Five Playwright specs written in Phases 4/6/7/Step-8.4 (all BEFORE Step 8.10 existed) independently chose the obvious, idiomatic `QA-<SUITE>-${stamp}` code-naming convention with hyphens as a separator — none anticipated a future charset restriction that excludes them:

| Spec | Code string used | `POST /api/promotions/codes` result |
|---|---|---|
| `TC-CART-TOT-01` | `` `QA-TOT-${stamp}`.toUpperCase() `` | `400 Must contain only letters A-Z and digits 0-9 (no spaces or symbols)` |
| `TC-CART-PROM-05` | `` `QA-PROM-${stamp}`.toUpperCase() `` | same 400 |
| `TC-PROM-022b` | `` `QA-PROM-022B-${stamp}`.toUpperCase() `` | same 400 |
| `TC-PROM-082` | `` `QA-PROM-082-${stamp}`.toUpperCase() `` | same 400 |
| `TC-PROM-083` | `` `QA-PROM-083-${stamp}`.toUpperCase() `` (typed into the real UI) | same 400 surfaced as a flash error; the test then times out waiting for the detail-page heading that never appears because the create never navigated away |

This isn't 5 independent test-authoring mistakes — it's one narrow charset rule colliding with a convention every pre-existing fixture already used (and a completely normal real-world promo-code convention too — `SUMMER-2026`, `SAVE-20`, etc. are everyday patterns an admin would reasonably type). Verified directly against the running app: `POST /api/promotions/codes` with `code: "QA-TOT-12345"` returns `400` with `details: [{ path: ["code"], message: "Must contain only letters A-Z and digits 0-9 (no spaces or symbols)" }]` (`packages/core/src/modules/promotions/data/validators.ts`'s `codeCharsetStringSchema`, wired via `clearableUppercaseStringSchema`).

**Needs an owner decision, not a unilateral fix from this gate**: (a) widen the charset to also allow `-`/`_` (the two separator characters every real promo-code convention and these 5 fixtures already assume), or (b) keep the stricter charset as an intentional product decision and update all 5 fixtures' code strings to drop hyphens (e.g. `QATOT${stamp}`). Not applied here — this is exactly the kind of contract/behavior-shape call Step 8.12's own "STOP, do not silently adjust" instruction exists for.

## Finding B (two live-UI test-authoring bugs, not product regressions) — pre-existing CrudForm dual-"Save" pattern never disambiguated by the new Step 8.7 code

`TC-PROM-074` fails immediately (3.8s, not a timeout) on:

```
Error: locator.click: Error: strict mode violation: getByRole('button', { name: 'Save promotion' }) resolved to 2 elements:
  1) <button form="_r_0_" type="submit" ...>  (sticky/floating footer button, outside the <form>, linked via the HTML `form` attribute)
  2) <button type="submit" ...>                (the inline in-form footer button)
```

at the EXACT line Step 8.7 added to this spec (`await page.getByRole('button', { name: 'Save promotion' }).click();`, setting the new eligible-currency field before touching the tree). `CrudForm` renders both a sticky and an inline submit button simultaneously at this viewport — a pre-existing, established pattern (not something Step 8.7/8.8 introduced), which Step 8.7's own new locator never disambiguated with `.first()` the way other, older specs that click a CrudForm submit button already do. This is a **test bug**, not a product bug: the real fix is `getByRole('button', { name: 'Save promotion' }).first().click()`.

`TC-PROM-075` hangs for its full 120s budget. It does NOT touch the eligible-currency field or the "Save promotion" button at all (default `product_discount` benefit, no currency-sensitive rule/benefit) — so it is NOT the same root cause as `TC-PROM-074`'s strict-mode violation. Root cause not conclusively identified within this gate's time budget; flagged as a separate, unexplained finding for the orchestrating session to debug directly (trace available: `.ai/qa/test-results/artifacts/packages-core-src-modules--8dfaa-es-selector-and-it-persists*/`).

`TC-CART-PRICE-03` fails immediately on `TypeError: Cannot read properties of undefined (reading 'line')` at `body.outcome.line.id` — a **test-authoring bug**, not a product bug: `POST /api/cart/current/lines`'s response envelope has returned `{ cart: CartView, ... }` for every successful ("added"/"merged") outcome since Step 5.2 (the bare `{ outcome }` shape is reserved for a genuinely hard-stop 422 rejection only, per `api/current/lines/route.ts`'s own `isWarningLevelOutcome` gate) — this Step 8.1 spec was written against a shape that was never current. Real fix: read the added line via `body.cart.lines.find(...)`, not `body.outcome.line`.

## A note on this session's own interference risk, ruled out

While the live stack was warming up, this session briefly started a SEPARATE Playwright process against the same already-running app (attempting to reuse the stack for Part 2 per the task's own instruction) before the main suite's own Playwright run had started. It was killed within seconds, before it produced any output (confirmed: its own log file was empty), once the main suite's failures started appearing. Of the 8 failures: 4 (`TC-CART-TOT-01`, `TC-PROM-022b`, `TC-PROM-082`, and `TC-CART-PROM-05`) use only the `request` fixture (no browser `page` at all) and fail on a `POST /api/promotions/codes` 400 — unreachable by a concurrent browser session. The 3 UI-driven failures (`TC-PROM-074/075/083`) each get a fresh browser context per Playwright's own test isolation; `074`'s and `083`'s root causes are independently explainable by a locator bug and the same charset regression respectively, with no contamination signature (no unexpected login state, no unrelated data). `075`'s hang is the one case without a confirmed root cause and cannot be fully ruled out as contamination, but the timing (the interfering script was already dead before the main suite reached test #61) makes it unlikely.

## Part 2 (UI screenshots for 8.7/8.8) — NOT ATTEMPTED

Per Part 1's own stop instruction. Standing up a second ephemeral environment to capture screenshots while Finding A (code charset) and Finding B (CrudForm dual-button locator bug) are unresolved risks capturing misleading "working" evidence for the 8.7 rule-tree save-error screenshot specifically (which needs to create a code-bearing promotion to demonstrate the OTHER save-error path, or at minimum needs the orchestrating session's sign-off that these two findings don't block a UI pass). Deferred to a follow-up pass once Finding A/B are triaged.

## Part 3 (documentation) — completed independently; see the separate commit

Documentation corrections do not depend on Finding A/B's resolution and were completed in full: `apps/docs/docs/api/{cart,promotions}.mdx`, `packages/core/src/modules/cart/AGENTS.md`'s Gotchas/Ask-First (CONC-05 removed as fixed) and Key Entities (`Cart.totals` note corrected per Step 8.2), both specs' changelogs, and `HANDOFF.md`'s OPEN ITEM 3 correction.

## Recommendation for the orchestrating session

1. Decide Finding A (widen the code charset to allow `-`/`_`, or update the 5 affected fixtures) — this is a product-contract call, not something to resolve unilaterally from this gate.
2. Fix Finding B's two test bugs (`.first()` on the Save-promotion locator in `TC-PROM-074`; `body.cart.lines.find(...)` instead of `body.outcome.line` in `TC-CART-PRICE-03`) — these are safe, mechanical test corrections once reviewed.
3. Debug `TC-PROM-075`'s hang directly (trace + screenshot already captured at `.ai/qa/test-results/artifacts/packages-core-src-modules--8dfaa-es-selector-and-it-persists*/`) before trusting it either way.
4. Re-run the full `cart`+`promotions` live suite once 1–3 land, THEN run Part 2's UI screenshot pass.
5. Step 8.12's Tasks-table row stays `todo` until this re-run is clean — not flipped by this pass.

---

# Checkpoint 5 re-run — Phase 8 live integration green, UI screenshots captured

Resumed after the orchestrating session's fix-forward commit (`5a851c5af`, PLAN.md Step 8.13): widened `CODE_CHARSET_PATTERN` to `/^[A-Z0-9_-]+$/` (Finding A) and fixed the three test-authoring bugs in `TC-CART-PRICE-03`/`TC-PROM-074`/`TC-PROM-075` (Finding B).

## Part 1 re-run result: 64 passed / 0 skipped / **2 failed** (66 total, 6.4m)

**Runner:** `yarn test:integration:ephemeral "cart|promotions"` — same command as the original pass. The first attempt was killed mid-build by an external SIGTERM broadcast (a known gotcha: concurrent worktree/task teardown can kill unrelated background processes on this host); colima and Docker were unaffected, so the run was simply restarted (`nohup ... &` + `disown`) and completed cleanly the second time.

All 6 of the original 8 failures that were covered by Finding A/B now pass:

| Spec | Result |
|---|---|
| `TC-CART-PRICE-03-variant-reprice-isolation` | ✅ pass |
| `TC-CART-PROM-05-applied-promotions-view` | ✅ pass |
| `TC-CART-TOT-01-phase3-promotions-order-equivalence` | ✅ pass |
| `TC-PROM-022b-concurrent-code-use-race` | ✅ pass |
| `TC-PROM-075-benefit-cap-selector-auto-assign` | ✅ pass |
| `TC-PROM-082-phase3-routes-cross-tenant-isolation` | ✅ pass |

Two failures remain — **both NEW failures, different from the original ones at the same spec**, since the specs got further than before once Finding A/B stopped blocking them. Both were root-caused directly against a live ephemeral stack (`yarn test:integration:ephemeral:start`) with ad-hoc debug Playwright specs (written, run, then deleted — never committed) and confirmed to be **pre-existing defects unmasked by the fix-forward commit, not regressions it introduced**, so Part 2 was not blocked.

### TC-PROM-074 — pre-existing TEST BUG (locator, not product)

New failure point: `expect(page.locator('label').filter({ hasText: 'Value' })).toHaveCount(1)` resolves to 2 instead of 1, immediately after the first "Add rule" click (before any benefit exists) — stable for the full 20s timeout, not a transient render race.

Root cause (confirmed live): the "Rule type" field's `<label>` renders as `"Rule typeOrder value"` (the field's own `<span>Rule type</span>` text concatenated with the `Select`'s current display value, "Order value" — the default rule type). Playwright's `locator().filter({ hasText: <string> })` does **case-insensitive** substring matching, so `hasText: 'Value'` also matches "Order **value**" (lowercase v). A same-moment `page.evaluate(() => document.querySelectorAll('label'))` with a case-sensitive `.includes('Value')` check found only the real "Value" field — confirming the UI itself is correct (one rule, one "Value" input = 0, Operator = Equals, Tax inclusive, Limit to category; verified via screenshot and ARIA snapshot too). This assertion was never exercised before this pass — the spec always died earlier on the dual-button "Save promotion" bug (Finding B, now fixed) — so this is a second, independent, pre-existing locator bug in the same file, only now unmasked. Not fixed in this pass (out of this gate's scope); the mechanical fix is to scope the locator more tightly, e.g. `page.locator('[data-crud-field-id... ]')`-style scoping to the rule card, or `hasText: /^Value$/`.

### TC-PROM-083 — genuine but PRE-EXISTING backend bug (cache invalidation), unrelated to Phase 8

New failure point: `expect.poll(... generated === amount ...)` on `GET /api/promotions/codes?ids=...` times out after 30s even though the dynamic-code generation worker actually completes.

Root cause (confirmed live via direct API reproduction, bypassing the UI/queue-drain helper): `POST /api/promotions/codes/{id}/generate` enqueues the job; the worker log shows `Job completed queue=promotions-code-generate`; the underlying `Code.generated` row is genuinely updated in Postgres — but `GET /api/promotions/codes?ids=...` kept returning the stale `generated: 0` across 5+ polls taken *after* the job had already completed. `packages/core/src/modules/promotions/workers/code-generation.worker.ts` (lines 142-148) writes `code.generated = actualCountAfter; await em.flush()` as a **raw ORM mutation**, bypassing the CRUD command/route layer entirely, so it never invalidates the opt-in CRUD list cache (`ENABLE_CRUD_API_CACHE=true`, which both `test:integration` and `test:integration:ephemeral` always set). No subscriber on the worker's own `promotions.generated_code.created` event invalidates it either. This worker and the cache flag predate Phase 8 entirely — Steps 8.1-8.13 only touched currency/budget fields, rule/benefit-type `Select`s, the labels editor, date-inclusive end, and code casing/charset, never this worker or cache wiring. It was simply never reachable before this pass because `TC-PROM-083` always died earlier on the static-code charset rejection (Finding A, now fixed). **This is a real product bug worth a follow-up fix** (give the worker a cache-invalidation call, or route the final write through a command), but it is a pre-existing defect unrelated to anything this release's Phase 8 touched — not fixed in this pass, out of scope for this gate.

### Verdict

No genuine Phase-8 regression in either remaining failure. Per Part 1's own stop condition ("a pre-existing/environmental flake unrelated to anything this release touched is fine to document and continue past"), proceeded to Part 2.

## Part 2 result: UI screenshots captured, all verified

Reused the live stack from the Part 1 re-run's own `yarn test:integration:ephemeral:start` debug session (same server, `http://127.0.0.1:5001`, admin@acme.com / secret) rather than standing up a second one. Captured via a throwaway Playwright spec (written, run, screenshots copied out, spec deleted — never committed) under `${RUN_DIR}/checkpoint-5-artifacts/`:

| File | Proves |
|---|---|
| `8.7-currency-budget-fields.png` | Settings panel: "Eligible currencies" multi-select open with USD + EUR picked (EUR visible checked in the scrolled list), "Max budget" = 5000, "Budget currency" = USD. |
| `8.7-rule-tree-save-error.png` | An `order_value` rule with no eligible currency set, "Save rules" clicked, the specific Step-8.7 flash: *"Add an eligible currency in the promotion's Settings panel before saving a rule or benefit that needs one"* — not the old generic "Could not save the rule tree". |
| `8.8-rule-type-select-open.png` | Rule-type `Select` OPEN, all 11 options visible: Order value, Order date, Product count, Cart weight, Row total, Specific product, Category, Product attribute, Customer group, Customer order history, Promotion code. |
| `8.8-benefit-type-select-open.png` | Benefit-type `Select` OPEN, all 5 options visible: Product discount, Cart discount, Free product, Buy X get Y, Tiered discount. |
| `8.8-labels-editor-locale-select-open.png` | Labels editor with one existing label row (`en` / "10% off") showing the `Input` and delete `IconButton` at matching heights, plus the "Add locale" locale `Select` OPEN showing the remaining real app locales (`pl`, `es`, `de`, `ko`; `en` correctly excluded as already used). |

Environment torn down cleanly afterward (`SIGINT` to the `yarn mercato test:ephemeral` process; `.ai/qa/ephemeral-env.json` cleared; `docker ps -a` confirms no leftover `testcontainers`/Postgres containers).

## Recommendation for the orchestrating session (re-run)

1. **No action required to unblock Step 8.12** — both remaining failures are pre-existing, out-of-scope defects, not Phase-8 regressions; the live gate is otherwise green (64/66, the only 2 reds independently explained and evidenced above).
2. Consider filing follow-up issues for: (a) `TC-PROM-074`'s `hasText` case-insensitivity collision (mechanical test fix), and (b) the code-generation worker's missing cache invalidation (`code-generation.worker.ts` — real product bug, low severity since it only affects the CRUD-list-cache read path when `ENABLE_CRUD_API_CACHE=true`).
3. Step 8.12's Tasks-table row is left `todo` by this pass per this task's own instructions — the orchestrating session flips it once it has reviewed this full re-run.

---

# Checkpoint 5 final correction — TC-PROM-074 re-categorized and fixed (Step 8.14)

The re-run above characterized `TC-PROM-074`'s remaining failure as "pre-existing, unmasked, not Phase-8-caused." The orchestrating session's independent code review found a more precise root cause: the `hasText: 'Value'` collision with the rule-type field's own label ("Rule type" + "Order value") is only *exercisable* because Step 8.8 swapped that field from `ComboboxInput` (selected text lives in a plain `<input value>`, invisible to Playwright's text-content matching) to `Select` (`SelectValue` renders the selection as a real DOM text node). Confirmed by diffing `RuleCard.tsx` at the pre-8.8 commit (`9827edb6f6`): the identical `<label>` wrapper existed before, but its inner control never contributed matchable text content until the swap. This makes it directly attributable to Step 8.8, not an unrelated pre-existing defect.

Fixed (`5c8c19817f`, PLAN.md Step 8.14): `valueFields`/`operatorFields` now use `hasText: /^Value/` / `/^Operator/` (case-sensitive, start-anchored) instead of case-insensitive substring matching. Swept the rest of `promotions/__integration__/*.spec.ts` for the same collision risk against any of the 11 rule-type/5 benefit-type labels — none found.

**Targeted live re-verification** (this one spec only, not the full suite — `yarn test:integration:ephemeral "TC-PROM-074"`, ~8.5 min full cycle): **1 passed (10.2s)**. Environment torn down cleanly.

## Final live-gate status for `cart`+`promotions`

**65 / 66 passing.** The sole remaining red is `TC-PROM-083`'s code-generation cache-invalidation gap — confirmed via direct code read (`code-generation.worker.ts` lines 147-148, no cache invalidation on the worker's raw `em.flush()`; no subscriber on `promotions.generated_code.created` either) to be a genuine, pre-existing, out-of-scope defect predating Phase 8 by two phases (built at Step 6.4). Filed as a follow-up issue by the orchestrating session (see the PR's own follow-up-issues list) rather than fixed in this gate, consistent with Step 8.12's own scope (QA findings F1-F15, not a general bug hunt).
