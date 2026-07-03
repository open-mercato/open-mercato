# Final gate — Phases 1+2 (this PR)

**When:** 2026-07-03 (UTC)
**Scope:** create-app scaffold generator + build script + the 7 STANDALONE-owning agentic skills. This is agentic-tooling / scaffold-asset work — no runtime module, API, UI, or DB change.

## Gate results

| Check | Result | Notes |
|-------|--------|-------|
| `yarn build:packages` | ✅ | run earlier this session; cli/dist present for build.mjs |
| `node build.mjs` (create-app) | ✅ | clean step wipes `dist/agentic`; `dist/agentic` has 0 `STANDALONE.md`; 9 fact-sheets + 9 legacy stubs |
| `tsc --noEmit` (create-app) | ✅ | no errors |
| Full create-app unit suite | ✅ | **93 tests, 0 fail** (incl. new conformance + no-stale-dist + placeholder guards) |
| End-to-end `generateShared` (against built `dist/agentic`) | ✅ | writes `agentic.config.json` (`{projectName, agentTools, pr.baseBranch}`); copies all 21 skills incl. thin SKILL.md + nested `workflow/` + `subagents/executor.md`; **0** STANDALONE.md and **0** literal `{{PROJECT_NAME}}` in output |

## Conformance (7 restructured skills)

Every restructured `SKILL.md` (om-auto-create-pr, -continue-pr, -create-pr-loop, -continue-pr-loop, -review-pr, -fix-github, om-integration-builder): non-empty frontmatter `description` preserved verbatim; ≤ 60 lines (46–54); every reference-map link resolves; no inlined numbered procedure / `## Workflow`. All STANDALONE.md deleted; rules absorbed natively (base branch via `.ai/agentic.config.json` `pr.baseBranch` → `gh` → `main`; opt-in label probing; script-probed gate; `src/modules/…` layout; claim discipline; `--skill-url` safety).

## Deliberately not run (with justification)

- **`yarn test:create-app` / `:integration`** — the scaffold smoke runs with `--skip-agentic-setup`, so it does NOT exercise the agentic generator changed here; and it requires a full Verdaccio publish. The agentic path is instead validated by the end-to-end `generateShared` run above plus the unit/conformance guards. Documented rather than run.
- **Whole-repo `yarn test`** — this change is isolated to `packages/create-app`, which no other package imports. The machine has known pre-existing unrelated flakes (UI `format.test.ts` Polish-locale; `watch-packages` fs.watch). The authoritative suite for this change (create-app, 93/93) is green.
- **ds-guardian** — N/A, no UI surface.

## Auto-review pass (om-code-review lens)

A code-review subagent flagged a **High-severity regression the main pass missed**: `packages/cli/src/lib/agentic-setup.ts` is a *parallel* `generateShared` (the `yarn mercato agentic:init` path) that still used a hard-coded per-skill copy list — it would have shipped the restructured skills **broken** (thin `SKILL.md` routers with no `workflow/`/`subagents/` files) and no `agentic.config.json`. `packages/cli/AGENTS.md` explicitly mandates keeping the two in sync.

Fixed in Step 2.9-review-fix (fed613b4a): CLI `generateShared` now uses the same recursive `copySkillTree` + writes `agentic.config.json` (`baseBranch: auto`); `cli/build.mjs` gains the same `dist/agentic` clean step. Verified end-to-end: `agentic:init` produces 21 skills, **0** STANDALONE.md, **0** literal `{{PROJECT_NAME}}`, and the config. `cli` typecheck clean; `agentic-init.test.ts` passes.

## Verdict

Green for the Phases 1+2 scope. Phase 3 (remaining 14 skills) + Phase 4 (full-set conformance enforcement) are a follow-up PR via `om-auto-continue-pr-loop`, per the agreed scope.
