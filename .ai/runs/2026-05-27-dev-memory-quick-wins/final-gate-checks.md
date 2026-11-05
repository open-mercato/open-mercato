# Final-gate checks — 2026-05-27-dev-memory-quick-wins

**Recorded at:** 2026-05-27T06:51:00Z
**Branch:** feat/dev-memory-quick-wins
**HEAD at gate:** 594c9f616 (5 Steps landed, run-folder seed + 4 step commits + the analysis spec commit)

## Steps verified

| Step | Title | Commit (table) | Status |
|------|-------|----------------|--------|
| 1.1 | profile-dev-rss harness + unit tests | 5fe482358 (committed at 3bac114df after amend) | done |
| 1.2 | `yarn dev:profile` / `yarn dev:profile:report` wired | 7d204ca83 (committed at 73ec8cd2a after amend) | done |
| 2.1 | analysis spec | 44e398eaf (committed at 0eb224328 after amend) | done |
| 2.2 | AGENTS.md Task Router cross-link | f6e6e5e43 (committed at 594c9f616 after amend) | done |
| 3.1 | final-gate | this file | done |

## Checks run in the janitor sandbox

| Check | Result | Notes |
|-------|--------|-------|
| `node --check scripts/profile-dev-rss.mjs` | ✅ pass | Syntax OK |
| `node --check scripts/__tests__/profile-dev-rss.test.mjs` | ✅ pass | Syntax OK |
| `node --test scripts/__tests__/profile-dev-rss.test.mjs` | ✅ 10/10 pass | duration 92.36 ms; tests cover `ps` output parsing, BFS tree walk, cycle defense, summary math, markdown report rendering, arg parsing, malformed-JSON skipping, and `kbToMb` rounding |
| `node -e 'JSON.parse(...package.json)'` | ✅ valid JSON | New `dev:profile` and `dev:profile:report` scripts wired |
| `wc -c AGENTS.md` | ✅ 36 805 bytes | Below the 42 KB harness ceiling enforced by #2048 |
| `grep -c '^#' .ai/specs/2026-05-27-dev-mode-memory-quick-wins.md` | ✅ 15 headings | Spec structure intact |
| `git status --short` | ✅ clean | All changes committed and pushed |

## Checks DEFERRED to CI

The janitor sandbox has no installed `node_modules` (top-level `node_modules/` is empty). The following gate items cannot run here and are the CI's responsibility:

| Check | Why deferred | Risk |
|-------|--------------|------|
| `yarn typecheck` (turbo run typecheck) | No deps installed; TS doesn't resolve cross-package paths | **Low** — this PR adds only `.mjs` files (no TypeScript) and a markdown spec; the only TS-adjacent change is a package.json scripts entry |
| `yarn lint` | No eslint binary | **Low** — `.mjs` files have no project-wide eslint config beyond format; package.json edit is a one-line addition |
| `yarn test` (workspace jest) | Requires installed deps | **Low** — the new unit tests use Node's built-in `node:test` and pass independently; this PR adds no workspace-jest tests |
| `yarn build:packages` / `yarn build:app` | Requires installed deps and built outputs | **Low** — no runtime code in `packages/*` or `apps/mercato/src/*` is touched |
| `yarn i18n:check-sync` / `yarn i18n:check-usage` | Requires `tsx` and locale files; no user-facing strings touched | **Low** — no `useT()` / `resolveTranslations()` calls or locale-file edits |
| `yarn generate` | Requires mercato CLI built | **Low** — no module / entity / route / event additions |
| `yarn test:integration` | Requires installed deps + Playwright + Postgres | **Low** — no UI, API, or DB surface change |
| `yarn test:create-app:integration` | Skipped | No packaging changes, no shared package exports touched, no templates touched |
| `ds-guardian` | No UI changes, no DS surfaces touched | Skipped per `.ai/skills/ds-guardian/SKILL.md` — only relevant when UI components are modified |

## Verification recipe (for the human reviewer)

Once `node_modules` is available, the reviewer should run:

```bash
yarn typecheck
yarn lint
yarn test
yarn build:packages
yarn build:app
```

Plus exercise the harness end-to-end:

```bash
yarn dev:profile baseline-2026-05-27
# (wait for "[profile] done")
yarn dev:profile:report
```

Then compare against a stack that has PR #2102 applied to confirm the headline ~1 GB savings.

## Self code-review (per `.ai/skills/code-review/SKILL.md`)

- ✅ No `any` types — pure JS in `.mjs`; types via `z.infer` not applicable
- ✅ No raw `fetch` — no network code
- ✅ No new dependencies — uses only Node 24 stdlib
- ✅ No tenant-scoping concerns — script is local-only
- ✅ No DB writes, no migrations, no encryption surfaces touched
- ✅ No event IDs, widget spot IDs, ACL IDs, DI names, import paths, or contract surfaces changed
- ✅ No `dark:` overrides, no hardcoded status colors, no arbitrary text sizes — N/A (no UI)
- ✅ No comments explaining "what" — only "why" notes where non-obvious (e.g. the cycle-defense comment in walkTree, the entry-point re-glob in scripts/watch.mjs is unchanged)
- ✅ Scope matches PLAN.md — no creep
- ✅ Step-to-commit ratio is 1:1

## BC self-review (per `BACKWARD_COMPATIBILITY.md`)

- ✅ No frozen / stable contract surface touched
- ✅ No API response fields removed
- ✅ No event IDs, widget spot IDs, ACL features, notification IDs, CLI commands changed
- ✅ No generated-file shape changes
- ✅ New scripts and new spec file are **additive**
- ✅ `NODE_OPTIONS=--max-old-space-size=N` is a Node builtin; this PR does not write or read it from any code path

No deprecation protocol required.
