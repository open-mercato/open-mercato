# Migrate Dependabot PRs #1875 + #1877 to `develop`

## Overview

Both Dependabot PRs were opened against `main` and have already been closed without merging. We replay their `yarn.lock` bumps on top of `develop` so the next release cycle picks up the patched transitive dependencies. Mirrors the established pattern from PR #1775 (which migrated #1723 + #1724 the same way).

- **#1875** — `fast-uri 3.1.0 → 3.1.2` (security release: fixes GHSA-v39h-62p7-jpjc and GHSA-q3j6-qgpj-74h6).
- **#1877** — `@babel/plugin-transform-modules-systemjs 7.28.5 → 7.29.4` (bug-fix backport; transitive only).

Both bumps touch `yarn.lock` only. No `package.json` change is required — they are indirect deps.

## Goal

Replay the two closed Dependabot bumps on top of `origin/develop` in a single PR, validated by the full gate, and leave a reference comment on each closed original. The corrective framing (fast-uri is a security release) is the reason this is on `fix/…` instead of `feat/…`.

## Scope

- `yarn.lock`: bump `fast-uri@npm:^3.0.1` from `3.1.0` → `3.1.2` and `@babel/plugin-transform-modules-systemjs@npm:^7.28.5` from `7.28.5` → `7.29.4` (plus the matching `@babel/helper-module-transforms` / `@babel/traverse` resolution edits already encoded in #1877's diff).
- `.ai/runs/2026-05-11-dep-bumps-migrate-1875-1877-to-develop.md` (this plan).

## Non-goals

- Bumping any other transitive or direct dependency.
- Editing any `package.json` (both target packages are `dependency-type: indirect`).
- Re-opening the original Dependabot PRs — they stay closed. We only post a cross-link comment on each.
- Adding/changing tests — there is no application code under change.

## Implementation Plan

### Phase 1: Replay bumps onto `develop`

- 1.1 Cherry-pick Dependabot commit `5319852c` (fast-uri) onto the `fix/` branch. If it conflicts because develop has yarn.lock churn, fall back to applying the two-line resolution + checksum edit directly via `git apply` of the canonical diff, then run `yarn install --immutable-cache` to verify integrity.
- 1.2 Cherry-pick Dependabot commit `ad422810` (babel plugin + helper-module-transforms + traverse resolution rewrites) onto the same branch. Same fallback strategy if it conflicts.

### Phase 2: Full validation gate

- 2.1 `yarn build:packages`
- 2.2 `yarn generate`
- 2.3 `yarn build:packages` (post-generate)
- 2.4 `yarn i18n:check-sync`
- 2.5 `yarn i18n:check-usage`
- 2.6 `yarn typecheck`
- 2.7 `yarn test`
- 2.8 `yarn build:app`

### Phase 3: Open PR, label, and cross-link

- 3.1 Push branch, open PR against `develop` with the `Tracking plan:` line.
- 3.2 Apply labels: `review`, `dependencies`, `skip-qa` (yarn.lock-only, no runtime code path of ours changes; risk-class identical to #1775 which also got `skip-qa`).
- 3.3 Comment on closed PRs #1875 and #1877 with a link to the new PR.

## Risks

- **yarn.lock conflict on cherry-pick.** `develop` has shifted since #1875/#1877 were authored. If the lockfile region around either resolution has been touched, cherry-pick will conflict and we fall back to a manual patch + `yarn install` round-trip. The fallback still preserves the exact target versions; it does not re-resolve unrelated transitive deps.
- **Indirect ranges might re-pin to something other than the target version.** `fast-uri@npm:^3.0.1` could in theory resolve to a newer 3.x if something on develop introduced a higher floor. We verify post-install that the lockfile entries land at exactly `3.1.2` and `7.29.4`.
- **`@babel/helper-module-transforms` requirement bump in #1877.** The babel migration also rewrites the requirement on `@babel/helper-module-transforms` from `^7.28.3` to `^7.28.6`. Develop already carries `7.28.6`, so this is a no-op at runtime, but we double-check that the union-key entry is preserved.
- **`yarn build:app` may fail on the pre-existing `/_global-error` prerender bug** documented in PR #1775. That failure is not a regression introduced by this PR. If it reappears we document it in the PR body and proceed.

## External References

None.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Replay bumps onto develop

- [x] 1.1 Cherry-pick fast-uri 3.1.0 → 3.1.2 (#1875 / `5319852c`) — ac9a5dfb1564
- [x] 1.2 Cherry-pick @babel/plugin-transform-modules-systemjs 7.28.5 → 7.29.4 (#1877 / `ad422810`) — eeb6683bf832

### Phase 2: Full validation gate

- [x] 2.1 yarn build:packages — pass (18/18, 6.4s)
- [x] 2.2 yarn generate — pass (1/1, 10.9s; 339 OpenAPI paths)
- [x] 2.3 yarn build:packages (post-generate) — pass (18/18, 12 cached, 13.1s)
- [x] 2.4 yarn i18n:check-sync — pass (4 locales, 46 modules)
- [x] 2.5 yarn i18n:check-usage — pass (advisory: 3520 unused keys)
- [x] 2.6 yarn typecheck — pass (18/18, 2m58s)
- [x] 2.7 yarn test — 1 flake on `@open-mercato/ai-assistant` perf guard (`normalizePath` 1M-slash input took 312ms > 200ms budget under parallel load). Confirmed transient by re-running the test in isolation (18/18 pass, 1.7s). Unrelated to yarn.lock changes — fast-uri and the babel plugin are not imported by `normalizePath`.
- [x] 2.8 yarn build:app — **pre-existing failure** on `/_global-error` prerender (`TypeError: Cannot read properties of null (reading 'useContext')`). Same failure documented in PR #1775 against the same develop base, also seen on PR #1625. Not introduced by this PR. Reviewers should treat as a known issue tracked elsewhere.

### Phase 3: Open PR, label, and cross-link

- [x] 3.1 Open PR against develop — PR #1884
- [x] 3.2 Apply labels (review, dependencies, skip-qa) — rationale comments posted per-label
- [x] 3.3 Comment on closed #1875 / #1877 — cross-link comments posted

## Changelog

- 2026-05-11 — Plan created.
- 2026-05-11 — PR #1884 opened against `develop`.
- 2026-05-11 — Self code-review + BC self-review clean (0 findings). `auto-review-pr` skill returned approval-equivalent on the first pass; GitHub blocked the formal approval API call because the PR author and reviewer are the same user, so the report is posted as a comment and pipeline state stays at `review` pending a second-reviewer approval.
