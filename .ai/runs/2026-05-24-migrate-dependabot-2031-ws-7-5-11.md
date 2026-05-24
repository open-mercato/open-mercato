# Migrate Dependabot PR #2031 (ws 7.5.10 → 7.5.11) to develop

- Source PR: [#2031](https://github.com/open-mercato/open-mercato/pull/2031) (base `main`, Dependabot)
- Target base: `develop`
- Date: 2026-05-24

## Goal

Apply the exact yarn.lock change from Dependabot PR #2031 (bump `ws@npm:^7.3.1` from 7.5.10 to 7.5.11) on top of `develop`, open a new PR against `develop`, then close PR #2031 referencing the migration PR.

PR #2031 targets `main`, but the team merges deps into `develop` first per the standing PR workflow. Dependabot cannot retarget its own PR, so the standing remedy is to migrate the change to a human-owned branch and close the bot PR.

## Scope

- Single yarn.lock entry: the `ws@npm:^7.3.1` resolution moves from 7.5.10 to 7.5.11 (and the checksum updates accordingly).
- No package.json change — `ws@^7.3.1` is a transitive resolution; no direct dependency declares it.

### Non-goals

- Touching the separate `ws@^8.x` resolution that PR [#2018](https://github.com/open-mercato/open-mercato/pull/2018) is updating to 8.20.1. The two yarn.lock entries are independent.
- Editing root `package.json` or any per-package manifest.
- Running data migrations, regenerating types, or rebuilding apps — yarn.lock-only deps bump.

## Risks

- **Lockfile drift on rebase.** If `develop` advances and another yarn.lock change lands first, the entry near the `ws@npm:^7.3.1` block may need a re-resolve. Mitigation: rebase + `yarn install` to refresh.
- **Indirect dependency only.** No code consumes `ws@^7.3.1` directly; the bump is purely a security patch (limit retained message parts per ws 7.5.11 release notes). The blast radius is whatever transitively depends on `ws@^7.3.1`.

## External References

None (no `--skill-url` arguments supplied).

## Implementation Plan

### Phase 1: Bring the dependabot change onto a develop-based branch

- 1.1 Cherry-pick the yarn.lock diff from PR #2031 (commit `08c1b421cc6cb7431d4bc7f69eb09e507922164e`) onto the new branch.
- 1.2 Run `yarn install` to confirm the lockfile reconciles cleanly with no side-effects.

### Phase 2: Validate

- 2.1 Re-read `git diff` to confirm only the two yarn.lock lines (`version` + `checksum`) for `ws@npm:^7.3.1` are touched.
- 2.2 Optional: `yarn typecheck` smoke (lockfile-only changes do not change types but the gate is cheap).

### Phase 3: Open PR and close source

- 3.1 Push branch and open PR against `develop` with `Tracking plan` line.
- 3.2 Apply `review`, `dependencies`, `skip-qa` labels with explanatory comments.
- 3.3 Comment on #2031 explaining the migration, then close it.
- 3.4 Post the comprehensive run-summary comment on the new PR.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Bring the dependabot change onto a develop-based branch

- [ ] 1.1 Cherry-pick the yarn.lock diff from PR #2031
- [ ] 1.2 Run `yarn install` to confirm reconciliation

### Phase 2: Validate

- [ ] 2.1 Re-read diff for scope creep
- [ ] 2.2 Optional typecheck smoke

### Phase 3: Open PR and close source

- [ ] 3.1 Push branch and open PR against `develop`
- [ ] 3.2 Apply labels with explanatory comments
- [ ] 3.3 Close PR #2031 with link to the migration PR
- [ ] 3.4 Post comprehensive summary comment
