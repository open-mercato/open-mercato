# Fix the red `i18n:check-usage` gate on `develop` — phone custom-field keys

**Issue:** #4607
**Branch:** `fix/4607-phone-custom-field-i18n-keys`
**Base:** `develop`

## Scope

`develop` fails `yarn i18n:check-usage` since #4147 merged (2026-07-29 04:13). The
phone custom-field editor references two translation keys that no `en.json`
defines, and `.github/workflows/ci.yml:468` runs that checker as a required gate.
The failure therefore reds the base branch and every PR that merges it.

| Location | Key |
|---|---|
| `packages/ui/src/backend/fields/phone.tsx:58` | `ui.customFields.phone.defaultCountry` |
| `packages/ui/src/backend/fields/phone.tsx:69` | `ui.customFields.phone.defaultCountryAuto` |
| `packages/ui/src/backend/fields/phone.tsx:84` | `ui.customFields.phone.defaultCountryHint` |

Every call site passes an inline English fallback, so nothing is visibly broken in
the UI — only the catalog is incomplete. The fix is to define the keys in the
`ui.*` catalog, in every locale, in both copies of it.

The third key was added in Phase 4 after code review: `i18n:check-usage` scans
line by line (`scripts/i18n-scanner.mjs`), and that call spreads its arguments
over several lines, so the checker never reports it. It was therefore missing
from every catalog while the gate was green — the same defect the first two keys
had, only invisible to the tool that found them.

Out of scope: the rest of `phone.tsx`, the 3737 advisory unused keys the checker
also reports, and any change to the checker itself. Making the scanner
multiline-aware would surface an unknown number of unrelated missing keys across
the repository and belongs in its own change; the Phase 4 regression test closes
the hole for this file instead.

## Where the keys belong

`ui.*` keys live in `apps/mercato/src/i18n/{en,pl,de,es}.json`, mirrored into
`packages/create-app/template/src/i18n/{en,pl,de,es}.json` per the Template Sync
Checklist in `packages/create-app/AGENTS.md`. Keys are sorted, so both go
directly after `ui.crud.dragHandle.aria`.

## Progress

- [x] 1.1 Reproduce the failure locally on a clean `develop` checkout and confirm the two keys are absent from every `en.json` in the repo
- [x] 1.2 Confirm the keys arrived with #4147 and are not introduced by any open PR of mine
- [x] 1.3 File the base-branch regression as #4607 with the reproduction
- [x] 2.1 Add both keys to `apps/mercato/src/i18n/{en,pl,de,es}.json`, alphabetically placed, matching the inline fallbacks in English
- [x] 2.2 Mirror the same four insertions into `packages/create-app/template/src/i18n/` per the Template Sync Checklist
- [x] 2.3 Verify all eight files still parse as JSON
- [x] 3.1 Run the full validation gate from `.ai/agentic.config.json` (runner: local)
- [x] 3.2 Open the PR with the body template, link #4607, and list the requested labels

### Phase 4: Review follow-up (`changes-requested` on `b056dfc`)

- [x] 4.1 Add `ui.customFields.phone.defaultCountryHint` to `apps/mercato/src/i18n/{en,pl,de,es}.json` and the four create-app template mirrors, localized and in sorted position
- [x] 4.2 Add regression coverage that asserts every `t()` key in `phone.tsx` — including the multiline call the usage scanner cannot see — is defined in all eight catalogs and mirrored between app and template
- [x] 4.3 Re-run the full validation gate and hand the PR back for re-review

### Phase 5: Drive the PR to merge-ready (`om-auto-fix-pr`)

- [x] 5.1 Merge the current `develop` tip into the PR branch so review and CI judge the real merge result
- [x] 5.2 Re-run the full ordered gate on the merged tree (runner: local)
- [x] 5.3 File the scanner blind spot — `i18n:check-usage` cannot see multiline `t()` calls — as a tracked follow-up instead of widening this PR
- [x] 5.4 Push, confirm every required GitHub check is green on the merged head, and post the summary comment handing the PR to `om-approve-merge-pr`

## Validation

Runner: **local** (no `app` container was running for any probed compose file).

Full ordered gate from `.ai/agentic.config.json`: `yarn build:packages`,
`yarn generate`, `yarn build:packages`, `yarn i18n:check-sync`,
`yarn i18n:check-usage`, `yarn typecheck`, `yarn test`, `yarn build:app`.

`i18n:check-usage` is the gate this change exists to fix: it reported
`2 missing keys` before and `0 missing keys` after.

The Phase 5 run repeated the same ordered gate on the tree produced by merging the
current `develop` tip into the branch, so the result reflects the real merge and
not the older base the earlier runs were measured against.

## Notes

Labels cannot be applied from this account (`403`, no `triage`). The requested
set is listed in the PR body as a request to a maintainer.
