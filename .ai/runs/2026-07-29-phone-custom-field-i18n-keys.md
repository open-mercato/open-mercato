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

Both call sites pass an inline English fallback, so nothing is visibly broken in
the UI — only the catalog is incomplete. The fix is to define the two keys in the
`ui.*` catalog, in every locale, in both copies of it.

Out of scope: the rest of `phone.tsx`, the 3737 advisory unused keys the checker
also reports, and any change to the checker itself.

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

## Validation

Runner: **local** (no `app` container was running for any probed compose file).

Full ordered gate from `.ai/agentic.config.json`: `yarn build:packages`,
`yarn generate`, `yarn build:packages`, `yarn i18n:check-sync`,
`yarn i18n:check-usage`, `yarn typecheck`, `yarn test`, `yarn build:app`.

`i18n:check-usage` is the gate this change exists to fix: it reported
`2 missing keys` before and `0 missing keys` after.

## Notes

Labels cannot be applied from this account (`403`, no `triage`). The requested
set is listed in the PR body as a request to a maintainer.
