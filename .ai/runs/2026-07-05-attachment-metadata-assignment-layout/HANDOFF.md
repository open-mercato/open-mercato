# Handoff - attachment-metadata-assignment-layout

**Last updated:** 2026-07-05T17:24:35Z
**Branch:** fix/attachment-metadata-assignment-layout
**PR:** https://github.com/open-mercato/open-mercato/pull/3780
**Current phase/step:** final gate blocked
**Last implementation commit:** e90bd6af3 fix(ui): contain attachment assignment row layout

## What just happened
- Copied the source spec into `.ai/specs/` on the implementation branch and created the resumable run folder.
- Added focused regression coverage for long assignment values in `AttachmentMetadataDialog`.
- Updated the assignment row layout to use bounded `minmax(0, ...)` grid tracks, `min-w-0` shrink hooks, full-width inputs, and an accessible DS `IconButton` remove action.
- Focused UI test, UI package build, package build/generate/typecheck/i18n/build app checks passed.
- Final gate is blocked by unrelated template parity/unit-test drift and local integration environment failures recorded in `final-gate-checks.md`.
- Opened draft PR #3780 from the fork branch. Upstream GitHub permissions for this token do not allow setting labels or assignee, so the intended labels (`blocked`, `bug`, `needs-qa`, `priority-medium`, `risk-medium`) were documented in a PR comment instead.

## Next concrete action
- Resolve or explicitly accept the create-app/template parity drift, then rerun `yarn template:sync` and `yarn test`.
- Install the local Playwright browser cache with `yarn playwright install` or run integration in an environment that already has browsers, then rerun `yarn test:integration`.
- Resume from this branch/PR and rerun the final gate before review/merge routing.

## Blockers / open questions
- `yarn template:sync` reports 25 template file drifts and 5 dependency drifts unrelated to this UI change.
- `yarn test` fails in `packages/create-app/src/lib/template-api-dispatcher-require-roles.test.ts` on template dispatcher byte parity.
- `yarn test:integration` cannot complete locally because Playwright Chromium is missing, and the suite also reports unrelated example/API failures.
- GitHub metadata automation is permission-limited on upstream PR #3780: label and assignee mutations fail for `vloneskorpion`.

## Environment caveats
- Dev runtime runnable: not started; this change was verified with focused jsdom tests and package/app builds.
- Playwright / browser checks: blocked by missing local browser cache.
- Database/migration state: clean; no migrations expected

## Worktree
- Path: /Users/kamil-nowak/Documents/work/development/tracecore/open-mercato/.ai/tmp/auto-create-pr/attachment-metadata-assignment-layout-20260705-184251
- Created this run: yes
