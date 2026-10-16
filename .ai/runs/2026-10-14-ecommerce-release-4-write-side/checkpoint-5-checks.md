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
