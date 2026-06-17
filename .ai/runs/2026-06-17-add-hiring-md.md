# Execution plan — add HIRING.md

**Slug:** add-hiring-md
**Date:** 2026-06-17
**Branch:** feat/add-hiring-md

## Goal

Add a top-level `HIRING.md` describing the "Senior AI Engineering / Forward Deployed Engineer" role on the Open Mercato Core Team, with an Apply section that routes applications to `info@openmercato.com` and includes a GDPR-compliant data-processing notice and consent statement.

## Scope

- Add a single new docs file `HIRING.md` at the repo root.
- Verbatim role content supplied by the user, lightly cleaned for Markdown formatting (no stray double-spaces, proper bullet nesting).
- Apply section: require LinkedIn profile, CV, and GitHub links sent to `info@openmercato.com`, plus an explicit GDPR consent line and a "How we process your data" notice (controller, purpose, legal basis, retention, rights, contact).

## Non-goals

- No code changes, no module changes, no generated files.
- No changes to CI, README, or any existing doc.
- No new dependencies.

## Risks

- Docs-only; minimal risk. GDPR copy is informational boilerplate aligned to GDPR Arts. 6(1)(a), 13, 15–21; it is not legal advice and uses the public `info@openmercato.com` contact. No contract surface touched.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Author HIRING.md

- [x] 1.1 Write HIRING.md role content (formatted from the brief) — e801665ae
- [x] 1.2 Add Apply section with info@openmercato.com routing + GDPR consent & processing notice — e801665ae

### Phase 2: Validate & ship

- [x] 2.1 Re-read diff, lint markdown, open PR against develop with labels — (this commit)

### Phase 3: Stabilize CI integration tests (resume)

> The docs-only change is complete; the PR's "Standalone App Integration Tests" job was red due to pre-existing flaky/failing specs unrelated to HIRING.md. Root causes diagnosed from CI runs 27671942959 (PR #3132) and 27670188539 (PR #3131). All fixes are test-harness robustness only — no app behavior changed.

- [x] 3.1 TC-CRM-062 hard fail: field-picker helper grabbed a stale/closing combobox (`.first()` → detached mid-fill) and leaked the regex `i` flag into the search query ("Namei"). Fixed with close-before-open + close-after-select waits and `.source`-based query text.
- [x] 3.2 TC-CRM-059 / TC-CRM-060 / TC-CRM-061 reopen race (People / Companies / Deals "Clear all"): preset-apply closes the panel (onOpenChange(false)); the reopen click raced the Radix exit animation. Now wait for `toBeHidden` before reopening. (TC-CRM-061 surfaced from run 27592817564 / PR #3119.)
- [x] 3.3 TC-CRM-013 pipeline-nav 20s timeout: heavy multi-navigation flow exceeds the default budget under CI load. Added `test.slow()`.
- [x] 3.4 TC-LOCK-OSS-043 conflict-bar: added an optional `timeout` to `expectConflictBanner` (default unchanged, BC) and passed 20s from the webhook list test.

### Phase 4: Second-pass deepening (after CI run on sha 302df6d99 went green but 2 specs still flaked-on-retry)

> Run 27680101869 was green (0 failed) but TC-CRM-062 and TC-LOCK-OSS-043 still needed a retry. Diagnosed the deeper, real root causes from the run's error-context artifacts and fixed them so neither needs a retry.

- [x] 4.1 TC-CRM-062 (now flaked at the reorder assertion, not the helper): the dnd-kit keyboard lift→move→drop fired back-to-back occasionally dropped the ArrowUp, leaving the order unchanged. Wrapped the sequence in a `toPass` retry with `toBeFocused` + settle ticks (Escape resets a half-applied lift).
- [x] 4.2 TC-LOCK-OSS-043: error-context showed the list ended "No Webhooks yet" — the DELETE had SUCCEEDED (no 409), so the timeout bump was the wrong fix. The list fires a second settle GET (org-scope resolve) that occasionally lands after the out-of-band PUT and refreshes the row's lock token to the new value. Added `waitForLoadState('networkidle')` before the bump so all initial GETs settle first and the captured token is deterministically stale.
