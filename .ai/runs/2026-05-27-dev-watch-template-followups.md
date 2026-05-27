# Dev-watch template follow-ups (post-#2102)

## Overview

PR #2102 (`feat(dev): consolidate workspace package watchers`) merged into
`develop` at 2026-05-27T13:56:41Z. After that merge, two follow-up commits
were pushed to the source branch `fix/dev-mode-package-watch-consolidation`
to close low-priority code-review findings and patch a template gap that
the consolidation work exposed. A first attempt to ship them as PR #2126
was opened with an empty body and immediately closed at 14:43:39Z — the
branch had drifted from `develop` and the PR carried 10 commits instead
of the 2 new ones.

This run cleanly cherry-picks just the two follow-up commits onto a fresh
`fix/dev-watch-template-followups` branch off the latest `develop` and
opens a focused PR.

### Source commits to carry forward

- `f5157953511bd5b939800cd9f3451e7cce7a89aa` — `fix(dev): address low-priority code-review findings (template parity + env-var docs)`
- `f7e29e416acd70e222c25fd074872f6f66a5263b` — `fix(dev): include dev-shutdown-utils.mjs in template-sync mapping`

Both commits land cleanly because the upstream files have not changed
since #2102 merged.

## Goal

Re-land the two post-merge follow-up commits from
`fix/dev-mode-package-watch-consolidation` as a clean, scoped PR against
`develop`, with no unrelated drift in the diff.

## Scope

- Cherry-pick `f5157953` and `f7e29e41` only.
- No new functionality, no refactors, no rebuilds of the consolidation
  itself (that already shipped via #2102).
- Files touched (per the cherry-pick set):
  - `apps/docs/docs/appendix/troubleshooting.mdx`
  - `packages/create-app/template/scripts/dev.mjs`
  - `packages/create-app/template/scripts/dev-orchestration-log-policy.mjs`
  - `packages/create-app/template/scripts/dev-shutdown-utils.mjs` (added)
  - `scripts/template-sync.ts`
  - `scripts/watch-packages.mjs`

## Non-goals

- Re-implementing or modifying the consolidated watcher behavior.
- Pulling in any other commits from the now-stale source branch.
- Rebasing the source branch on develop (the source branch will remain
  archived; the new branch supersedes it).

## Implementation Plan

### Phase 1: Carry the two follow-up commits

1.1 Branch `fix/dev-watch-template-followups` off the latest `develop`
    in the linked janitor worktree.
1.2 Cherry-pick `f5157953511bd5b939800cd9f3451e7cce7a89aa` (template
    parity + env-var docs).
1.3 Cherry-pick `f7e29e416acd70e222c25fd074872f6f66a5263b` (include
    `dev-shutdown-utils.mjs` in `template-sync` mapping and ship the
    template copy).

### Phase 2: Validation

2.1 Confirm cherry-picks have empty conflict markers and the diff
    matches the two upstream commits.
2.2 Verify `yarn template:sync` would pass (re-run logic: the template
    copies of `dev.mjs` and `dev-orchestration-log-policy.mjs` now
    match root; `dev-shutdown-utils.mjs` exists at template; mapping
    in `scripts/template-sync.ts` is registered).
2.3 Run any cheap targeted checks the sandbox allows (this worktree
    has no installed deps; full gate is deferred to CI — same caveat
    documented in the original `.ai/runs/2026-05-27-dev-mode-package-watch-consolidation/HANDOFF.md`).

### Phase 3: Ship

3.1 Push branch and open PR against `develop`.
3.2 Apply `review` pipeline label and `skip-qa` (docs + scripts +
    template-sync; not customer-facing).
3.3 Post the comprehensive `auto-create-pr` summary comment.

## Risks

- **Most likely regression**: template parity may drift again if the
  root `scripts/dev.mjs` or `scripts/dev-orchestration-log-policy.mjs`
  is changed after this PR but before merge. Mitigation: `yarn template:sync`
  is part of CI and will fail loudly.
- **Second-order effect**: documentation tweak in `troubleshooting.mdx`
  changes the env-var contract description for `OM_WATCH_PACKAGES_MODE`
  vs `OM_PACKAGE_WATCH_MODE`. Both vars already exist in code; this is
  documentation only.
- **BC impact**: none. No frozen / stable contract surface touched.
- **Tenant/isolation risks**: N/A (dev-mode build tooling only).

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Carry the two follow-up commits

- [x] 1.1 Branch off latest develop — aa9fd46df
- [x] 1.2 Cherry-pick template-parity + env-var-docs commit — d61698b6b
- [x] 1.3 Cherry-pick dev-shutdown-utils template-sync commit — af3b6d71c

### Phase 2: Validation

- [x] 2.1 Diff parity vs upstream commits — verified byte-identical for both cherry-picks
- [x] 2.2 Template-sync mapping verification — `dev-shutdown-utils.mjs` registered in `scripts/template-sync.ts:80-82`; root/template diffs empty for all three files
- [x] 2.3 Targeted checks available in sandbox — janitor worktree has no installed deps (same caveat as `2026-05-27-dev-mode-package-watch-consolidation`); full gate deferred to CI

### Phase 3: Ship

- [x] 3.1 Push branch + open PR — PR #2130
- [x] 3.2 Apply labels with explanatory comments — review + skip-qa + documentation
- [x] 3.3 Post comprehensive summary comment
