# Execution Plan — Agentic Skills Restructure (Phases 1+2)

**Run:** 2026-07-03-agentic-skills-restructure-phase1-2
**Source spec:** `.ai/specs/2026-06-27-create-app-agentic-skills-restructure.md`
**Scope of this PR:** Spec Phases **1 (plumbing)** and **2 (the 7 STANDALONE-owning skills)** only. Spec Phase 3 (remaining 14 skills) and Phase 4 (conformance guards for the full set) are a follow-up PR via `om-auto-continue-pr-loop` after review of the pattern set here.

## Tasks

> Authoritative status table. `Status` is one of `todo` or `done`. On landing a Step, flip `Status` to `done` and fill the `Commit` column with the short SHA. The first row whose `Status` is not `done` is the resume point for `om-auto-continue-pr`. Step ids are immutable once a Step has a commit.

| Phase | Step | Title | Status | Commit |
|-------|------|-------|--------|--------|
| 1 | 1.1 | AgenticConfig gains `pr.baseBranch` + interactive base-branch question | done | 2248aa015 |
| 1 | 1.2 | Additive `--pr-base <branch\|auto>` CLI flag (headless-safe) | done | 5cf8c797a |
| 1 | 1.3 | Generator writes `.ai/agentic.config.json` from AgenticConfig | done | e10664578 |
| 1 | 1.4 | Recursive skill-dir copy + resolvePlaceholders; adapt overlays test | done | pending |
| 1 | 1.5 | `build.mjs` cleans `dist/agentic` before copy | todo | — |
| 1 | 1.6 | Drop STANDALONE.md mentions (printSummary, AGENTS.md, AGENTS.md.template) | todo | — |
| 2 | 2.1 | Restructure `om-auto-create-pr` (thin SKILL + workflow/ + absorb STANDALONE) — pattern-setter | todo | — |
| 2 | 2.2 | Restructure `om-auto-continue-pr` | todo | — |
| 2 | 2.3 | Restructure `om-auto-create-pr-loop` (+ subagents/executor.md) | todo | — |
| 2 | 2.4 | Restructure `om-auto-continue-pr-loop` (+ subagents/executor.md) | todo | — |
| 2 | 2.5 | Restructure `om-auto-review-pr` | todo | — |
| 2 | 2.6 | Restructure `om-auto-fix-github` | todo | — |
| 2 | 2.7 | Restructure `om-integration-builder` | todo | — |
| 2 | 2.8 | Flip overlays→no-STANDALONE guard + conformance/no-stale-dist/placeholder guards | todo | — |

## Goal

Separate the standalone agentic skills into three concerns — thin `SKILL.md` router, procedure instruction files (`workflow/`, `subagents/`, `instructions.md`), and a generated `.ai/agentic.config.json` environment file — replacing the 7 `STANDALONE.md` override files. This PR delivers the plumbing (Phase 1) and restructures the 7 `STANDALONE.md`-owning skills (Phase 2), which set the pattern for the remaining 14 skills in a later PR.

## Scope

- `packages/create-app/src/setup/wizard.ts`, `src/index.ts`, `src/setup/tools/shared.ts`
- `packages/create-app/build.mjs`
- `packages/create-app/agentic/shared/ai/skills/{om-auto-create-pr,om-auto-continue-pr,om-auto-create-pr-loop,om-auto-continue-pr-loop,om-auto-review-pr,om-auto-fix-github,om-integration-builder}/**`
- `packages/create-app/agentic/shared/AGENTS.md.template`, `packages/create-app/AGENTS.md`
- Tests under `packages/create-app/src/**`

## Non-goals

- Phase 3 (thinning the other 14 skills) and Phase 4's full-set conformance enforcement — follow-up PR.
- Editing the live monorepo `.ai/skills/**` (these are the standalone COPIES under `packages/create-app/agentic/`; they differ from live and must be edited independently).
- Any runtime module behaviour change (this is agentic-tooling/scaffold assets only).

## Risks

- **R-CI-green:** the recursive-copy refactor (1.4) removes the explicit `ai/skills/<skill>/STANDALONE.md` copy strings the current overlays test greps for, so that test must be adapted in the same commit; STANDALONE files still exist through Phase 1 (recursive copy still ships them), so the no-STANDALONE guard only lands in 2.8 after deletion.
- **R1 over-thinning:** a trigger detail dropped from `SKILL.md` frontmatter `description` breaks auto-invocation — descriptions are preserved verbatim; conformance guard asserts non-empty description.
- **R2 no remote at install:** `pr.baseBranch` defaults to `"auto"`; skills fall back to `gh repo view --json defaultBranchRef` then `main` at runtime.
- **Editorial consistency:** 2.1 is authored in the main session as the canonical pattern; 2.2–2.7 follow it exactly.

## External References

- None (`--skill-url` not used).

## Implementation Plan

### Phase 1 — Plumbing (each Step keeps CI green)

**Step 1.1 — AgenticConfig gains `pr.baseBranch`.** Extend `AgenticConfig` in `wizard.ts` with `agentTools: string[]` and `pr: { baseBranch: string }`. Thread the selected tool ids + resolved base branch into the config in `runAgenticSetup`. Add an interactive question (asked only when a PR-capable tool is selected) "Which branch should automated PRs target? [auto-detect / main / develop / other]", default `auto`. Update `wizard.test.ts`.

**Step 1.2 — `--pr-base` flag.** Add additive optional `--pr-base <branch|auto>` in `index.ts` (default `auto`); validate; thread through `AgenticSetupOptions`/`runAgenticSetup`. Update usage text and examples. Headless `--agents` path stays non-interactive.

**Step 1.3 — config generator.** In `generateShared` (or a dedicated helper), write `.ai/agentic.config.json` = `{ projectName, agentTools, pr: { baseBranch } }`. Cover with `shared.test.ts`.

**Step 1.4 — recursive skill-dir copy.** Replace the per-skill hard-coded `copyFile` calls (and the auto-* loop) with a recursive copy of each `ai/skills/<skill>/` directory that runs `resolvePlaceholders` on every copied text file and skips junk (dotfiles, `.DS_Store`). Update/rewrite `agentic-skills-standalone-overlays.test.ts` so it verifies recursive-copy wiring (green while STANDALONE files still present) and extend `shared.test.ts`.

**Step 1.5 — build clean.** Add `rmSync('dist/agentic', { recursive: true, force: true })` before `cpSync('agentic','dist/agentic',…)` in `build.mjs`.

**Step 1.6 — drop STANDALONE mentions.** `printSummary` stops citing `STANDALONE.md` and mentions `.ai/agentic.config.json`; update `create-app/AGENTS.md` "Agentic Setup Maintenance" and `agentic/shared/AGENTS.md.template` to describe the thin-`SKILL.md` + instruction-files + config layout.

### Phase 2 — Restructure the 7 STANDALONE-owning skills

For each skill: thin `SKILL.md` to the §2.1 contract (frontmatter `name`+`description` verbatim, "When to use", "What it contains", reference map); move the procedure body into `workflow/step-N-<name>.md` (and `subagents/<role>.md` for spawned subagents); author the 6 STANDALONE rules natively into the instructions (base branch → read `.ai/agentic.config.json` `pr.baseBranch`, gh fallback; labels → `gh label list` probe + skip-and-log; validation-gate → probe `package.json` scripts; `src/modules/` layout; `--skill-url` safety; claim discipline); **delete that skill's `STANDALONE.md`**.

- **Step 2.1 — `om-auto-create-pr`** (canonical pattern-setter, authored in main session).
- **Steps 2.2–2.7** — the remaining six, following 2.1's structure.
- **Step 2.8 — guards.** Replace the overlays test with a no-STANDALONE guard (`find agentic -name STANDALONE.md` empty); add a conformance guard for the 7 restructured skills (frontmatter description non-empty; `SKILL.md` line budget; reference-map links resolve); add the no-stale-`dist` assertion (`dist/agentic/**` has no `STANDALONE.md`) and the placeholder guard (no literal `{{PROJECT_NAME}}` after copy).

## Final gate (at spec completion for this PR)

`yarn build:packages` → `yarn generate` → `yarn build:packages` → `yarn typecheck` → `yarn test` → `yarn build:app`; plus `yarn test:create-app` scaffold smoke and `yarn test:create-app:integration` (this run touches packaging/templates). Docs/skill markdown changes are the bulk; DS-guardian is N/A (no UI).
