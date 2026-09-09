# Make the i18n usage scanner multiline-aware (#4666)

## Goal

`yarn i18n:check-usage` scanned line by line, so a `t()` call whose key argument sat on a
following line was invisible and its missing catalog entry never surfaced. Make the scanner
see those calls, then define every key the change uncovers.

## Scope

- `scripts/i18n-scanner.mjs` — scan the whole text instead of per line; report each ref at the
  line of its key argument; mark refs as `direct` so callers need not re-derive that.
- `scripts/i18n-check-usage.ts` — filter missing keys on `ref.direct` instead of re-reading the
  ref's line and testing it for `t(`, which by construction cannot match a multiline call.
- `scripts/__tests__/i18n-scanner.test.mjs` — three fixtures: multiline detection, key-argument
  line reporting, and the direct/indirect distinction.
- 20 locale files across 5 modules — the 91 keys the fixed scanner uncovered.

## Findings

The fix surfaced **91 missing keys** in 17 files: customers 44, catalog 18, ai_assistant 16,
attachments 12, auth 1. All 91 carry an inline English fallback at the call site, so `en` was
filled deterministically from what users already see; `pl` / `es` / `de` were translated,
preserving both interpolation conventions in use (`{count}` and `{{entity}}`).

Two observations worth recording, neither of which changes the fix:

- The CI step for `i18n:check-usage` is `continue-on-error: true`, so it is advisory rather than
  a required gate. The issue describes it as required. The local validation gate does treat it as
  blocking, which is why the sweep ships together with the scanner change.
- `packages/ui/src/backend/fields/phone.tsx` — the file whose `defaultCountryHint` key motivated
  the issue — does not exist on `develop` (#4147 is unmerged), so its keys are not among the 91.
  The blind spot itself is real and reproduced by the other 91.

## Progress

- [x] Make the scanner multiline-aware and fix the check's direct-call filter
- [x] Add scanner-level regression coverage with fixtures
- [x] Run `i18n:check-usage` repo-wide and record the count (91)
- [x] Define all 91 keys across en / pl / es / de
- [x] Confirm `i18n:check-usage` and `i18n:check-sync` are both clean
- [x] Decide on the #4608 file-specific guard: not present on `develop`, so nothing to remove
- [x] Run the full validation gate
- [x] Open the PR and request labels from a maintainer
