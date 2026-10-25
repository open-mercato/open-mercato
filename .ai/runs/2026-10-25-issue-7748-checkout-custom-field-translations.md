# Execution plan — scope checkout custom-field translations (adopted from PR #7754)

**Origin:** adopted — reconstructed by `om-auto-continue-pr --adopt auto` on 2026-10-25 because PR #7754 carried no execution plan.
**PR:** #7754 · **Branch:** `fix/issue-7748-checkout-custom-field-translations` · **Base:** `main`
**Author:** @haxiorz

## Goal

Localize seeded service-package metadata in the pay-link editor while preserving tenant-authored copy and unrelated entities.

## Scope

An optional generic CrudForm text resolver, checkout-owned namespaced translations/default matching, and focused regression tests. Preserve persisted definitions, values and submission keys.

## Evidence

| Conclusion | Drawn from | Confidence |
|---|---|---|
| Polish pay links require localized seeded metadata | Issue #7748, PR body and existing diff | high |
| Global literal lookups and the UI test checkout import must go | @wojciechszyjka review 5643510118 | high |
| Customized copy must remain literal with a stored-text fallback | Review 5643510118 and original acceptance tests | high |

## Assumptions and risks

Translation is opt-in at the owning form; checkout may translate only recognized seeded metadata whose text still matches its English default. No persistence migration or reseed is needed. Shared UI remains domain-independent. Manual QA and reviewer approval remain required.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Already landed on this PR (reconstructed)

- [x] 1.1 Localize persisted metadata and cover locale changes and values — 33c8c1385

### Phase 2: Review remediation

- [ ] 2.1 Scope lookup through explicit checkout-owned opt-in and namespaced keys
- [ ] 2.2 Replace cross-package fixture and cover literal collisions, opt-in and fallback
- [ ] 2.3 Run focused validation and review the final diff
- [ ] 2.4 Publish corrections and request re-review while retaining QA and review gates
