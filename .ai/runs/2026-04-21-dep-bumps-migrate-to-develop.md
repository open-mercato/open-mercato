---
title: Migrate Dependabot PRs 1621 and 1620 to develop as a single PR
date: 2026-04-21
slug: dep-bumps-migrate-to-develop
owner: pkarw
---

# Migrate Dependabot PRs 1621 and 1620 to develop as a single PR

## Goal

Combine the two closed Dependabot PRs that targeted `main`
([#1621 — major group](https://github.com/open-mercato/open-mercato/pull/1621),
[#1620 — minor/patch group](https://github.com/open-mercato/open-mercato/pull/1620))
into a single PR against `develop`, so the next release cycle can consume their
dependency bumps without re-opening separate Dependabot branches against the
moving `develop` base.

## Overview

- Both source PRs are `CLOSED` on GitHub and authored by `app/dependabot`.
- Each is a single-commit change touching only root `package.json`, per-package
  `package.json`, and `yarn.lock`.
- `develop` is 308 commits ahead of `main` and has drifted the root
  `package.json` scripts, added `@napi-rs/canvas` / `pdfjs-dist`, removed
  `pdf2pic`, and bumped `next` to `16.2.3`. A plain cherry-pick will therefore
  conflict on `package.json` and unavoidably conflict on `yarn.lock`.

### External References

None — run was invoked without `--skill-url`.

## Scope

**In scope**

- Port the dependency version changes from PR #1621 and PR #1620 onto a single
  branch based on `origin/develop`.
- Regenerate `yarn.lock` from the merged `package.json` set so the lockfile is
  internally consistent against the current develop tree.
- Run the full validation gate and document any breakage.

**Out of scope (non-goals)**

- Rewriting application code to accommodate major version breaking changes
  (React 19.2.5, TypeScript 6.0, MikroORM 7, `lucide-react` 1.x, `eslint` 10,
  `react-email` 6, `cross-env` 10, etc.). If the validation gate surfaces code
  incompatibilities, they are **explicitly documented** in the PR body and the
  PR is delivered with `Status: in-progress` so a human can decide follow-up.
- Adding new Dependabot bumps beyond what was already in #1621 and #1620.
- Changing any application source, specs, tests, or generated output beyond
  what is required to make the tooling run.

## Risks

- **Major-bump breakage (high likelihood).** React 18→19 is on develop already,
  but TS 5→6, MikroORM 6→7, `lucide-react` 0.x→1.x, `eslint` 9→10, Next 16.1→16.2
  include breaking surface changes. The project may fail `yarn typecheck`,
  `yarn build:packages`, or `yarn test` without additional code work that this
  run is explicitly not performing.
- **Lockfile drift.** Regenerating `yarn.lock` against the merged `package.json`
  can pull in transitive versions that differ from either source PR. This is
  expected, is the correct behaviour for a `develop`-based rebase, and is the
  reason we do **not** attempt to cherry-pick either dependabot `yarn.lock`.
- **Version conflicts between the two PRs.** #1620 targets packages at
  minor/patch level while #1621 bumps a superset to major versions. Where they
  overlap, the major bump from #1621 wins.
- **Develop drift on listed packages.** `next` was bumped to `16.2.3` on
  develop; #1621 wanted `16.1.7`, #1620 wanted `16.2.4`. We keep the higher of
  the PR targets and of the current develop value.

## Implementation Plan

### Phase 1: Branch and plan commit

Establish the working branch and commit the plan so the run is resumable.

### Phase 2: Apply version bumps to package.json files

Port the `package.json` edits from both PRs onto develop by direct edits,
resolving overlaps per the rule in Risks (major wins; current-develop wins if
already higher).

### Phase 3: Regenerate yarn.lock and install

Delete `yarn.lock`, run `yarn install`, commit the regenerated lockfile.

### Phase 4: Validation gate

Run the full validation gate (`yarn build:packages`, `yarn generate`,
`yarn i18n:check-sync`, `yarn i18n:check-usage`, `yarn typecheck`, `yarn test`,
`yarn build:app`) and document pass/fail in the PR body.

### Phase 5: Open PR and reviews

Open the PR against `develop`, apply labels, run `auto-review-pr`, post the
summary comment.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Branch and plan commit

- [ ] 1.1 Create `feat/dep-bumps-migrate-to-develop` from `origin/develop`
- [ ] 1.2 Commit this execution plan as the first commit on the branch
- [ ] 1.3 Push the branch to `origin` so follow-up runs can resume

### Phase 2: Apply version bumps to package.json files

- [ ] 2.1 Apply PR #1620 (minor/patch) version bumps to all affected `package.json` files
- [ ] 2.2 Apply PR #1621 (major) version bumps on top, letting majors supersede where they overlap
- [ ] 2.3 Preserve develop-only additions (scripts, `@napi-rs/canvas`, `pdfjs-dist`, resolutions) and never regress a develop-higher version

### Phase 3: Regenerate yarn.lock and install

- [ ] 3.1 Delete `yarn.lock` and run `yarn install`
- [ ] 3.2 Commit the regenerated lockfile plus the `package.json` changes

### Phase 4: Validation gate

- [ ] 4.1 Run `yarn build:packages`
- [ ] 4.2 Run `yarn generate` then `yarn build:packages` again
- [ ] 4.3 Run `yarn i18n:check-sync` and `yarn i18n:check-usage`
- [ ] 4.4 Run `yarn typecheck`
- [ ] 4.5 Run `yarn test`
- [ ] 4.6 Run `yarn build:app`
- [ ] 4.7 Document gate results in PR body and in this plan's Changelog

### Phase 5: Open PR and reviews

- [ ] 5.1 Push final commits to `origin/feat/dep-bumps-migrate-to-develop`
- [ ] 5.2 Open PR against `develop`
- [ ] 5.3 Apply `review` + `dependencies` + `needs-qa` labels with explainer comments
- [ ] 5.4 Run `auto-review-pr` autofix pass
- [ ] 5.5 Post comprehensive summary comment

## Changelog

- 2026-04-21 — Plan created.
