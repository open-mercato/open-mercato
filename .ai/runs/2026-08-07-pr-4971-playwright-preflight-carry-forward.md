# PR #4971 carry-forward — Playwright preflight guard

**Run skill:** `om-auto-fix-pr 4971`
**Original PR:** [#4971](https://github.com/open-mercato/open-mercato/pull/4971) — `fix(create-app): fail fast with a clear message when Playwright browsers are missing`
**Original author:** @mikoajp (fork head `mikoajp:fix/4094-standalone-integration-test-reliability`)
**Carry branch:** `carry/pr-4971-ready` (based on `upstream/develop`)
**Related issue:** #4094 (the investigation that surfaced the failure mode)

## Why a carry-forward

The head branch lives on a contributor fork, so this run cannot push the base merge or the
review fix onto it. Per the fork carry-forward flow, the original commit is cherry-picked onto
a branch in the main repository with authorship preserved, the fixes land on top, and a
replacement PR supersedes #4971 while crediting @mikoajp.

## What had to change

1. **Blocking review finding (major).** The preflight resolved Chromium only through
   `chromium.executablePath()`, which knows nothing about
   `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`. `.ai/qa/tests/playwright.config.ts:72-74` supports
   that override so containers can run the suite against a system Chromium. On such a machine
   the guard turned a working setup into a hard `exit(1)` before the scaffold started.
2. **Review nit.** `ensurePlaywrightBrowsersInstalled` was the file's only exported symbol and
   could not be used by an importer, because it terminates the process instead of throwing.
3. **Test coverage gap.** With the override branch the function carries three distinct
   outcomes and the failing one exits the process — the review asked for a unit test.
4. **Red `test` check.** The failure was a stale base: `yarn i18n:check-sync` failed on
   `attachments` `ko.json` keys already added on `develop`, in a module this PR does not touch.
   Re-basing the work on the current `develop` clears it.

## Progress

- [x] Claim PR #4971 (stale-lock takeover — handed back to the author 2026-08-04, no activity since)
- [x] Create `carry/pr-4971-ready` off the latest `upstream/develop`
- [x] Cherry-pick `e47df2647` preserving @mikoajp's authorship
- [x] Extract the resolution logic into `scripts/lib/playwright-browsers.mjs` and honor
      `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`, reporting the variable itself when it points at a
      missing binary
- [x] Drop the stray `export`; the script keeps the print-and-exit shell, the lib returns a
      failure descriptor
- [x] Add `scripts/__tests__/playwright-browsers.test.mjs` (6 cases, runs in CI via
      `yarn test:scripts`)
- [x] `yarn test:scripts` — 464 pass
- [x] `yarn i18n:check-sync` — green on the current base, confirming the stale-base diagnosis
- [ ] Full `validation.commands` gate
- [ ] Open the replacement PR (`Supersedes #4971` + credit), reassign to @mikoajp
- [ ] Close #4971 in favor of the replacement
- [ ] Labels + summary comment

## Notes

- `scripts/` is not a published surface and the changed script is local-only
  (`yarn test:create-app:integration` runs on no workflow), so there is no UI surface to QA and
  no contract to break. The new unit test is what makes the automated-verification exemption
  apply.
