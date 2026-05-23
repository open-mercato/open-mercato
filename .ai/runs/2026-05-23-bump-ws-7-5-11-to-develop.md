---
title: Migrate PR #2031 (bump ws 7.5.10 → 7.5.11) to develop
date: 2026-05-23
status: in-progress
related-prs:
  - https://github.com/open-mercato/open-mercato/pull/2031
precedent:
  - .ai/runs/2026-05-22-deps-bump-ws-8-20-1.md
  - .ai/runs/2026-05-04-dep-bumps-migrate-to-develop.md
---

## Goal

Reproduce Dependabot PR [#2031](https://github.com/open-mercato/open-mercato/pull/2031) on `develop` so the bug-fix bump of the indirect `ws@^7.x` dependency from `7.5.10` to `7.5.11` lands on the active development line, then close the original `main`-targeted PR with a pointer to the new one.

PR #2031 targets `main`, but the team's policy (mirrored by prior dep-bump migration runs) is to land deps changes on `develop` first and let `main` pick them up at the next release merge.

## Scope

- `yarn.lock` only — bump the `"ws@npm:^7.3.1"` resolution group from `7.5.10` → `7.5.11` (version, resolution, checksum). This mirrors the upstream diff verbatim.
- No `package.json` changes; `ws@^7.3.1` is a transitive dependency.
- No source-code changes, no module changes, no docs changes.
- No spec changes; this is a deps-only change.

### Non-goals

- Do NOT touch the `"ws@npm:^8.17.1, ws@npm:^8.18.0"` 8.19.0 resolution — that is the scope of the separate, already-open PR [#2018](https://github.com/open-mercato/open-mercato/pull/2018) (bumping to 8.20.1).
- Do NOT touch the `"ws@npm:~8.18.3"` 8.18.3 resolution — different semver branch, not in #2031.
- Do NOT introduce a `resolutions` override in `package.json` — would force the bump on all `ws` ranges, exceeding upstream scope.
- No additional dependency bumps in this PR (single-concern).

### External References

None. No `--skill-url` arguments were passed.

## Implementation Plan

### Phase 1: Apply the lockfile bump

1.1 Surgically edit `yarn.lock` so the `"ws@npm:^7.3.1"` block reads `version: 7.5.11` / `resolution: "ws@npm:7.5.11"` with the upstream-published checksum `10/486141e4a01bb75883f9ba39317309c2427e24db1cb75e340fad6e5886b65c03d994a34209f0e4ba06dd6cb9ec95dd1b6a09c52c05eed9a34d6376f4fbbf617c`. This mirrors the PR #2031 diff verbatim.
1.2 Run `yarn install` to confirm the lockfile is internally consistent (yarn must accept it without re-resolving anything else).
1.3 Re-read `git diff` to confirm the change is limited to `yarn.lock` and only to the targeted `^7.3.1` block — no churn elsewhere.

### Phase 2: Validation gate (deps-only minimum)

2.1 `yarn install --immutable` (lockfile integrity)
2.2 `yarn typecheck` (skip surface API compat sanity)
2.3 `yarn test` (unit-level regressions)
2.4 If wall-time permits, `yarn build:packages`. Document any skipped gate step in the PR body under Risks.

### Phase 3: Open PR and apply labels

3.1 Push branch.
3.2 Open PR against `develop` with title `chore(deps): bump ws from 7.5.10 to 7.5.11`, referencing #2031 in the body.
3.3 Apply labels: `review`, `dependencies`, `skip-qa` (deps-only, no customer-facing behavior change).
3.4 Post one short PR comment per label explaining rationale.

### Phase 4: Close PR #2031 with hand-off comment

4.1 Comment on #2031 explaining the migration: link to the new PR, explain that the team lands deps on `develop` first, and recommend Dependabot re-evaluate after the next `develop → main` release merge.
4.2 Close PR #2031 (not merged — superseded).

### Phase 5: auto-review-pr autofix pass

5.1 Invoke `.ai/skills/auto-review-pr/SKILL.md` against the new PR.
5.2 Apply any actionable findings as additional commits (never rewrite history).
5.3 Loop until verdict is clean or remaining findings are non-actionable.

## Risks

- **Lockfile churn beyond the targeted group**: a stray `yarn install` could dedupe or re-resolve other entries. Mitigation: confirm `git diff yarn.lock` matches the upstream PR #2031 diff exactly before committing; revert and retry if not.
- **Upstream PR scope ambiguity**: PR #2031 patches only the `^7.x` line — leaves `^8.x` and `~8.18.x` untouched. Confirmed by reading the upstream diff. We intentionally mirror that scope; the `^8.x` bump is in scope of #2018.
- **Source PR was Dependabot-targeted at `main`**: by closing #2031 we explicitly hand-off to the new PR. The hand-off comment must give Dependabot enough context that the next bot run does not immediately re-open the same PR. Mitigation: explicitly state in the close comment that the bump now lives on develop.
- **No external skill conflicts**: the run did not adopt any external skill rules.
- **BC surface**: none. ws 7.5.11 is a patch release containing only a backported bug fix (`e14c4586` — limit retained message parts); the API surface is identical to 7.5.10.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Apply the lockfile bump

- [ ] 1.1 Edit yarn.lock to mirror PR #2031 (ws@^7.3.1 → 7.5.11)
- [ ] 1.2 Run `yarn install` to validate lockfile internal consistency
- [ ] 1.3 Re-read diff to confirm scope

### Phase 2: Validation gate

- [ ] 2.1 `yarn install --immutable`
- [ ] 2.2 `yarn typecheck`
- [ ] 2.3 `yarn test`
- [ ] 2.4 Optional `yarn build:packages` if wall-time permits

### Phase 3: Open PR and apply labels

- [ ] 3.1 Push branch
- [ ] 3.2 Open PR against develop
- [ ] 3.3 Apply labels (review, dependencies, skip-qa)
- [ ] 3.4 Post label-rationale comments

### Phase 4: Close PR #2031

- [ ] 4.1 Post hand-off comment on #2031
- [ ] 4.2 Close PR #2031

### Phase 5: auto-review-pr autofix

- [ ] 5.1 Invoke auto-review-pr on the new PR
- [ ] 5.2 Apply any findings as new commits
- [ ] 5.3 Confirm clean verdict

## Changelog

- 2026-05-23: Plan drafted. Slot claimed via fresh branch `fix/bump-ws-7-5-11-to-develop` off `origin/develop@e4a05c16e`.
