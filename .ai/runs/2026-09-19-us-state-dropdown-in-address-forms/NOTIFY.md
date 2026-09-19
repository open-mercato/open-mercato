# Notify - 2026-09-19-us-state-dropdown-in-address-forms

> Append-only log. Every entry is UTC-timestamped. Never rewrite prior entries.

## 2026-09-19T00:00:00Z — run started
- Brief: implement `.ai/specs/2026-09-19-us-state-dropdown-in-address-forms.md` - the region control becomes a US state
  dropdown keyed off the address's own country, across the two AddressEditor twins, the sales channel form and the tax
  provider ship-from form.
- External skill URLs: none
- Engine: `om-auto-create-pr-loop` (spec-implementation run, 9 Steps).
- Decision: the branch is cut from `spec/us-state-dropdown-in-address-forms`, not from `develop`, because the release
  step of this workflow merges the spec PR (#11) and this implementation PR together. The spec document is therefore
  already present on the branch and is not re-committed.
- Decision: the implementation PR opens as a draft against `develop` at the user's instruction, so the release step
  owns the promotion.

## 2026-09-19T13:10:00Z — checkpoint 1 (Phase 1 closed, Steps 1.1 to 1.4)
- Targeted validation green: shared, ui and the customers AddressEditor suites, `yarn build:packages`, `yarn typecheck`.
- Decision: `resolveAddressLayout(profile)` with no options now returns 51 rows for a `us` profile instead of 56, because
  the picker filter applies to the profile-keyed branch too (spec invariant 6 and decision D2). The one existing
  assertion in `display.test.ts` was updated. `isValidSubdivision` is untouched, so no stored territory code starts
  warning.
- Decision: both editors resolve `addressDisplayProfile(...)` into its own memo so `effectiveCountry` can be computed
  before the descriptor rather than from it, which is what the spec's UI/UX section asks for.
- Decision: `getSelectableSubdivisions`, `findSubdivision` and `AddressLayoutOptions` were added to the
  `@open-mercato/ui/backend/markets/display` barrel, which exists so a client component takes the display helpers from
  one place. Additive; no existing export changed.
- UI/browser pass skipped at this checkpoint: the four screens are covered together by the integration tests in Steps
  2.3 and 2.4 and by the QA pass on the finished PR.
