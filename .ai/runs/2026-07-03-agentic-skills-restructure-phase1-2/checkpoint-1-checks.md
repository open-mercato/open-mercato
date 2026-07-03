# Checkpoint 1 — Phase 1 (plumbing) verified

**When:** 2026-07-03 (UTC)
**Steps covered:** 1.1 → 1.6 (SHAs 2248aa015 … bd97e7ce0)
**Packages touched:** `packages/create-app`

## Checks

| Check | Result | Notes |
|-------|--------|-------|
| `tsc --noEmit` (create-app) | ✅ pass | No errors |
| Full unit suite (`node --test src/**/*.test.ts`) | ✅ pass | 78 tests, 0 fail |
| `node build.mjs` (with new clean step) | ✅ pass | Exit 0; `Cleaned + copied agentic/ → dist/agentic/`; 9 fact-sheets + 9 legacy stubs emitted |
| `copySkillTree` functional test | ✅ pass | Copies a whole skill dir incl. STANDALONE.md (Phase 1) into a temp dir |
| `buildAgenticConfig` unit test | ✅ pass | Serializes `projectName`/`agentTools`/`pr.baseBranch`; drops `targetDir` |
| `normalizeBaseBranchAnswer` unit tests | ✅ pass | number/keyword/literal/empty cases |
| Overlays test (adapted) | ✅ pass | Recursive-copy wiring asserted; STANDALONE still ships in Phase 1 |

## Environmental note

- The 4 `module-facts-build` / `published CLI bin` tests fail on a fresh `yarn install --mode=skip-build` worktree because `@open-mercato/cli/dist` is not built (build-order requirement). After `yarn build:packages` they pass (verified — 78/78). Not a regression.
- `generateShared()` cannot be exercised directly under `tsx`-on-`src` because `AGENTIC_DIR` resolves relative to `dist/` at runtime. Its full functional path is covered by `yarn test:create-app` (scaffold smoke) at the final gate; the unit-level pieces (`copySkillTree`, `buildAgenticConfig`) are covered here.

## UI verification

- N/A — no UI/frontend surface touched (scaffold generator + build script + skill markdown only). No Playwright.

## Outcome

Phase 1 plumbing is complete and green. Config artifact, `--pr-base` flag, recursive skill-dir copy, and the build clean step are in place; STANDALONE.md files still ship (recursive copy carries them) and are removed per-skill in Phase 2.
