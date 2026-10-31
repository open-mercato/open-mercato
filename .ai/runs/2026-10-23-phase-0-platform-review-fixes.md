# Execution plan — land the platform pieces marketing-automation phase 0 needs, clean on review (adopted from PR #6863)

**Origin:** adopted — reconstructed by `om-auto-continue-pr` on 2026-10-23 because PR #6863 carried no execution plan.
**PR:** #6863 · **Branch:** `phase/0-platform` · **Base:** `main`
**Author:** @michalper — this plan interprets their intent; correct it by editing this file or commenting on the PR.

## 🎯 Goal

Ship the platform-only prerequisites the marketing-automation phased delivery needs (`ModuleInfo.optionalRequires`, `sendEmail`/Resend `headers`, `HelpTip`/`SectionHeader`, and the two unrelated test/runtime fixes the stack's own test runs turned up) with every `om-auto-review-pr` finding resolved before the phase stack above it continues.

## Scope

`packages/shared` (module metadata type), `packages/cli` (generator read of `optionalRequires`), `packages/channel-resend` (Resend adapter `headers`), `packages/core/communication_channels` (system-email `headers` plumbing), `packages/ui/backend` (`CrudForm`, `DataTable`, `HelpTip`, `SectionHeader`, `DevRuntimeReporter`), plus i18n locale files for the `HelpTip` aria label.

## Non-goals

Anything marketing-automation-specific (ships on the stacked `phase/1-core` → `phase/5-ai` branches). Re-touching PR #6862's branch (its own dependency-check fix is out of scope here, for consistency only).

## Evidence

| Conclusion | Drawn from | Confidence |
|---|---|---|
| Phase 1 (4 original commits) was already landed, reviewed once, and is otherwise sound | PR body, `git log`, the `om-auto-review-pr` review verdict (`REVISE`) on head `4a8da091f7` | high |
| The CrudForm wrapper `div` broke two integration specs by changing the DOM structure `getByText(...).locator('..')` / `label -> xpath=.. -> input` depend on | Review finding 1 (`CrudForm.tsx:4669-4675`, `:4833-4844`; `TC-SALES-4053-inline-customer-address.spec.ts:72-73`; `TC-PUSH-009.spec.ts:63-80`) | high |
| `headers` (adapter + system-email + sendEmail) and `optionalRequires` (module-facts) shipped without tests | Review finding 2 (listed file:line locations) | high |
| No required CI check has run on this fork head; only local gates are available | Review's own CI-status note and this run's confirmation (`gh pr checks` waiting on maintainer approval) | high |

## Assumptions

- The wrapper `div` serves no purpose beyond holding `HelpTip` next to the label — it is not load-bearing for accessibility or layout when no `help` is declared, so reverting to the original unwrapped structure for that case (rather than rewriting the two specs' selectors) is the more reversible, lower-risk fix. No existing caller passes `field.help` yet, so nothing downstream depends on the always-wrapped shape.
- Adding tests at the consuming boundary (`sendMessage`/`convertOutbound` for the adapter, `sendSystemEmail`'s `channelMetadata`, `sendEmail`'s transport call, and the module-facts extraction fixture) satisfies "tests exercising both at the consuming boundary" without inventing a new test file where an existing one already covers the neighboring `replyTo`/`requires` behavior.
- `michalper` (PR author, fork contributor) has read-only access to `open-mercato/open-mercato`: label and `in-progress`-claim mutations are skipped/logged rather than retried.

## Risks

None material. The fix narrows an unconditional DOM change to an opt-in one (no existing caller regresses), and the new tests are additive.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Already landed on this PR (reconstructed)

- [x] 1.1 `ModuleInfo.optionalRequires`, `sendEmail`/Resend `headers`, `HelpTip`/`SectionHeader`, and the two unrelated test/runtime fixes — d469bce59, 5d85c8ecf, 0d7459fb7, 4a8da091f

### Phase 2: Resolve `om-auto-review-pr`'s findings

- [x] 2.1 Stop `CrudForm` from wrapping every field label in a new `div`; wrap only when `field.help` is set; add `CrudForm.fieldHelp.test.tsx` pinning the unwrapped structure the two Playwright specs depend on and the wrapped one for a field with `help` — 69fe4ab87
- [x] 2.2 Add test coverage for `headers` (channel-resend adapter, system-email, sendEmail) and for `optionalRequires` (module-facts owned-contracts fixture) — 3d9c52c72
- [x] 2.3 Run the full validation gate (`build:packages`, `generate`, `build:packages`, `i18n:check-sync`, `i18n:check-usage`, `typecheck`, `test`, `build:app`) and push
