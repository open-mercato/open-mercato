# Execution plan — lock shipped order-line pricing controls so the fix passes review (adopted from PR #5279)

**Origin:** adopted — reconstructed by `om-auto-continue-pr` on 2026-08-14 because PR #5279 carried no execution plan.
**PR:** #5279 · **Branch:** `fix/issue-5248-changing-price-blocker` · **Base:** `develop`
**Author:** @Paul-Mlodochowki — this plan interprets their intent; correct it by editing this file or commenting on the PR.

## 🎯 Goal

Editing a sales order line that already has shipped quantities must present the pricing controls as genuinely read-only — visibly showing the price actually charged, accepting no input at all — while a name-only or quantity-only edit still saves cleanly; and the PR must clear the `CHANGES_REQUESTED` review that currently blocks it.

## Scope

- `packages/core/src/modules/sales/components/documents/LineItemDialog.tsx` — the price field's render path and the shipped-line banner copy.
- `packages/core/src/modules/sales/components/documents/lineItemShipmentLock.ts` (+ a new sibling for the read-only price display, if extraction proves the cleanest testable shape).
- `packages/core/src/modules/sales/components/documents/__tests__/` — the missing UI-level regression coverage.
- `packages/core/src/modules/sales/i18n/{en,de,es,ko,pl}.json` — one new informational key.

## Non-goals

- Changing `LookupSelect` itself so that `disabled` suppresses option clicks and the clear button. The reviewer named it as the alternative fix and flagged that it is a shared-component change touching every other call site, needing its own regression test — it belongs in a separate PR, not this bug fix.
- Making the whole line dialog 100% read-only. The server guard `assertShippedOrderLineChangeAllowed` permits quantity increases and name edits on a shipped line, so the narrower lock is the accurate behavior; the reviewer explicitly endorsed this scope call.
- Any change to the write path (`prepareShippedLineUpdatePayload`, payload stripping, total scaling). The review verified it as correct.

## Evidence

| Conclusion | Drawn from | Confidence |
|---|---|---|
| The PR's goal is issue #5248: shipped-line price controls must be disabled and the current price must be visible | PR body "🎯 Goal" + issue #5248 as quoted in the PR body's two numbered symptoms | high |
| The write-path half of the fix is already correct and must not be touched | `om-auto-review-pr` review by @pkarw, "✅ Verified correct" section (payload stripping, total scaling, draft path, price-refresh skip) | high |
| Remaining work item 1: `options` must only be supplied when the field is actually locked, otherwise unshipped lines lose their price list on every parent re-render | Review finding 🟠 Medium 1, with a reproduction verified against the real `LookupSelect` in an RTL harness | high |
| Remaining work item 2: the locked price control still accepts input — option cards stay clickable and "Clear selection" stays enabled — because `LookupSelect`'s `disabled` only disables the search input | Review finding 🟠 Medium 2, plus `packages/ui/src/backend/inputs/LookupSelect.tsx` (`shouldSearch`, not `!disabled`, gates the list and the clear button) | high |
| Rendering a read-only display instead of `LookupSelect` on a shipped line is the preferred fix — it resolves Medium 2 and makes Medium 1 moot | Review finding 🟠 Medium 2, "Fix, either of:" — option 1, named as the smallest change that fully solves it | high |
| Remaining work item 3: the change needs UI-level regression coverage, not only the pure-helper unit test | Review finding 🔵 Low 1; `__tests__/` already holds RTL suites (`ItemsSection.*`, `ShipmentDialog.reRenderLoop.test.tsx`) | high |
| Remaining work item 4: the locked price label needs net/gross context | Review finding 🔵 Low 2 | high |
| Remaining work item 5: the banner should use a dedicated informational key, not the server's 409 error string | Review finding 🔵 Low 3 | high |
| No contract surface is affected, so `BACKWARD_COMPATIBILITY.md` imposes no deprecation protocol | Review "✅ Verified correct" → "No contract-surface changes"; re-checked against the diff | high |

## Assumptions

- **The reviewer's preferred fix for Medium 2 is the one to take.** Option 1 (read-only display) is chosen over option 2 (changing `LookupSelect`) because it is confined to this module, needs no shared-component regression suite, and the reviewer named it as fully solving the finding. It is also the more reversible of the two.
- **The new i18n key is `sales.documents.items.shippedLineLocked`.** The reviewer named this exact key in Low 3; English copy is authored fresh and the other four locales are translated to match, keeping `errorPriceShipped` untouched for its original 409 use.
- **UI-level coverage means rendering the real dialog**, not asserting on a mocked `CrudForm`. A test that mocks away the form would not actually pin the reviewer's concern, which is about what the rendered controls do.
- **Validation runs locally, not in Docker.** No compose `app` container is running in this environment.

## Risks

- The dialog is a 3,000-line component with heavy dependencies (`#generated` entity ids, `apiCall`, organization-scope hook, custom fields). A full-render RTL test may need substantial mocking; if it becomes brittle rather than protective, the fallback is to extract the locked price display into a small presentational component, unit-test that directly, and keep a narrower dialog-level assertion — but the payload assertion the reviewer asked for (`orderId`, `quantity`, `currencyCode`, `name` only) must survive either way, because that is what pins issue #5248 shut end to end.
- This is a cross-repository fork PR, so labels cannot be applied (`AddLabelsToLabelable` is rejected for `Paul-Mlodochowki`) and CI workflows do not run automatically on the head. Validation therefore has to be demonstrated locally and reported honestly.
- The local primary worktree's branch of the same name has since been reused for unrelated ACL work, so all work here happens in an isolated worktree pushed with an explicit refspec — never from the primary checkout.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Already landed on this PR (reconstructed)

- [x] 1.1 Shipped-line write path: `prepareShippedLineUpdatePayload` strips immutable pricing/catalog fields and scales stored totals; dialog routes both the draft and the CRUD path through it; pricing controls disabled; informational banner added; helper unit tests — f5bb01e

### Phase 2: Resolve the blocking review findings

- [x] 2.1 Replace the price `LookupSelect` with a genuinely read-only price display on shipped lines, removing the injected single-entry `options` array entirely (fixes Medium 2 and Medium 1 together) — b08add8
- [x] 2.2 Give the read-only price display net/gross context so the shown amount is self-describing (fixes Low 2) — b08add8
- [x] 2.3 Add a dedicated `sales.documents.items.shippedLineLocked` informational key across en/de/es/ko/pl and use it for the banner instead of the 409 error string (fixes Low 3) — b08add8

### Phase 3: Regression coverage

- [x] 3.1 Add a UI-level regression test asserting that a shipped line renders its pricing controls disabled, shows the effective price, and submits only `orderId`, `quantity`, `currencyCode`, `name` on a name-only edit (fixes Low 1) — 7788873
- [x] 3.2 Add a regression assertion that an unshipped line keeps its full price list across a parent re-render (pins Medium 1 shut) — 7788873

### Phase 4: Validation and hand-back

- [x] 4.1 Run the full configured validation gate and record the results — 5b9ece8

  `yarn build:packages` ✅, `yarn generate` ✅ (no drift), `yarn build:packages` ✅, `yarn i18n:check-sync` ✅,
  `yarn i18n:check-usage` ✅, `yarn typecheck` ✅, `yarn build:app` ✅. `yarn test` exits 1, but every failing
  suite fails identically on the merge base `cb3419ef` (5 core suites / 14 tests: `DealsKpiStrip`,
  `CompanyKpiBar.dealStatus`, `dashboards/lib/formatters`, `ItemsSection.discountColumn`, `attachments/localDriver`
  — locale- and filesystem-dependent), plus `@open-mercato/ui` `format.test.ts` and `@open-mercato/shared`
  `likeFilterWarning.test.ts` in packages this PR does not touch. The changed code's own suites are green
  (`lineItemShipmentLock` 3/3, `LineItemDialog.shippedLineLock` 5/5).

  Run in a dedicated worktree with its own `yarn install`, so the gate resolved `@open-mercato/*` to this
  branch's sources rather than the primary checkout's.

- [x] 4.2 Run the authoritative `om-auto-review-pr` pass, apply any fixes, and update the PR body, labels and summary comment

  The automated pass could not run in its normal form: this is a fork PR authored by the same account the
  automation runs as, so GitHub rejects the review submission (no self-review) and label writes are rejected
  (`AddLabelsToLabelable` — no triage permission). The `om-code-review` checklist was therefore applied to the
  diff directly and reported in the resume summary comment; the formal re-review is handed back to the maintainer.

### Phase 5: Resolve the strict multi-provider review on `e13df4eb` (2 High, 4 Medium)

**Scope reversal, recorded deliberately.** Phase 2 listed "changing `LookupSelect` so that `disabled`
suppresses option clicks and the clear button" as a non-goal, on the earlier reviewer's advice that it
belonged in a separate PR. The strict review overturned that: fixing only the *price* control left the
product and variant pickers live behind a `disabled` prop that never suppressed their option rows, their
keyboard paths or their "Clear selection" button — so a shipped line could still be mutated through the very
dialog this PR claims to lock, and clearing the product nulls fields a later name-only save then fails on.
The narrow fix could not close the finding, so the shared-primitive fix is taken here, with its own
regression suite in `packages/ui`.

- [x] 5.1 Make `LookupSelect`'s `disabled` mean "no interaction at all" — option rows non-interactive and out
  of the tab order, `aria-disabled` announced, Enter/Space and the ArrowDown+Enter search path inert, and the
  "Clear selection" button plus the action slot not rendered (fixes Medium 2, the shipped product/variant
  mutation path). Covered by six new cases in `packages/ui/src/backend/inputs/__tests__/LookupSelect.test.tsx`.

- [x] 5.2 Resolve shipment state authoritatively and fail closed while it is unknown (fixes Medium 3).
  `ItemsSection` read only page 1 of `/api/sales/shipments` and reported an empty totals map while loading and
  after a failure, so a shipped line on page 2 — or any line during the pending/error window — was treated as
  unshipped, left editable, and submitted with reconstructed pricing the server rejects. It now pages through
  every shipment page and tracks resolution explicitly; the new `shippedQuantityResolved` prop (defaulting to
  `true`, so existing callers are unaffected) makes `LineItemDialog` treat an unresolved state as shipped —
  locking the controls and stripping the payload — behind its own informational copy
  (`sales.documents.items.shippedLineLockPending`, added to all five locales).

- [x] 5.3 Replace the middot in the locked price label with an em dash (fixes Medium 4, `.ai/ds-rules.md:238`),
  and drop the now-duplicated amount from the supporting detail line so it shows the price kind instead.

- [x] 5.4 Rewrite `LineItemDialog.shippedLineLock.test.tsx` (fixes High 1, High 2 and Medium 1). The currency
  assertion now goes through the same `formatMoney` the dialog renders with, instead of demanding an ISO code
  the runtime locale does not produce — which is why the suite was red on `e13df4eb`. The `LookupSelect` mock
  is gone, so the product and variant rows, their clear actions and their keyboard paths are exercised for
  real; the form host remains a harness but a **stateful** one, so an interaction that manages to mutate the
  line is observable and asserted against. Every `any` is replaced with the concrete `CrudField`,
  `CrudCustomField`, `CrudCustomFieldRenderProps`, submit-value and DOM prop types.

  Verified the suite actually protects the boundary: reverting only the `LookupSelect` change turns the two new
  product/variant interaction cases red.

- [x] 5.5 Validation gate, re-run on the merged head

  `yarn build:packages` ✅, `yarn generate` ✅ (no drift), `yarn build:packages` ✅, `yarn i18n:check-sync` ✅
  (the new key needed `--fix` for sort order only), `yarn i18n:check-usage` ✅ advisory, `yarn typecheck` ✅
  22/22 — note a stale `packages/core/tsconfig.tsbuildinfo` reported 18 phantom `E.eudr` errors until it was
  deleted; `yarn build:app` ✅. Focused suites: `LineItemDialog.shippedLineLock` 9/9, `lineItemShipmentLock`
  3/3, `LookupSelect` 13/13, `@open-mercato/core` `modules/sales` 587/589. The remaining failures are the same
  locale-dependent suites this PR does not touch and that already fail on the merge base
  (`ItemsSection.discountColumn`, `@open-mercato/ui` `format.test.ts`, `@open-mercato/shared`
  `likeFilterWarning.test.ts`); each was re-confirmed by stashing this branch's changes and seeing the identical
  failure. Run locally — no compose `app` container is running.
