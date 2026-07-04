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

---

## Final gate — Phase 3+4 (continuation, all 21 skills)

**When:** 2026-07-04 (UTC)

| Check | Result |
|-------|--------|
| `yarn build:packages` | ✅ exit 0 |
| `node build.mjs` (create-app) | ✅ dist/agentic has 0 STANDALONE.md |
| `tsc --noEmit` (create-app) | ✅ |
| Full create-app unit suite | ✅ **121 tests, 0 fail** (conformance now runs over all 21 skills dynamically) |
| Conformance guard (all 21) | ✅ every SKILL.md ≤60 lines, non-empty frontmatter description, resolvable reference map, no inlined procedure |
| End-to-end `generateShared` (create-app) | ✅ 21 skills, all thin, config written, 0 STANDALONE, 0 literal {{PROJECT_NAME}} |
| End-to-end `agentic:init` (CLI) | ✅ 21 skills, config written, 0 STANDALONE, 0 literal {{PROJECT_NAME}} |
| Substance-preservation check | ✅ 12/14 grew; om-system-extension −19 (~2%) and om-troubleshooter −11 (~2%) reflect de-duplicated `§N` cross-refs → file links, not dropped content (executors confirmed verbatim code/tables) |

**Conformance guard finding (self-fixed):** switching `RESTRUCTURED_SKILLS` to dynamic enumeration surfaced that `referenceMapLinks` only matched `workflow|references|subagents` paths, not `instructions.md` — so the 3 single-flow skills (om-trim-unused-modules, om-prepare-issue, om-auto-upgrade) reported an empty reference map. Fixed the regex (the skills were correct); all 46 conformance assertions pass.

**Verdict:** green. All four spec phases (D4 — all 21 skills) delivered in this PR.
