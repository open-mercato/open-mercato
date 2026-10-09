# Execution Plan — Default CI for scaffolded standalone apps

**Date:** 2026-10-09
**Slug:** standalone-app-default-ci
**Branch:** feat/standalone-app-default-ci
**Source spec:** .ai/specs/2026-10-09-standalone-app-default-ci.md
**Pre-implementation analysis:** .ai/specs/analysis/ANALYSIS-2026-10-09-standalone-app-default-ci.md
**Owner:** om-auto-create-pr-loop (run mode: Spec-implementation)

## Tasks

> Authoritative status table. `Status` is one of `todo` or `done`. On landing a Step, flip `Status` to `done` and fill the `Commit` column with the short SHA. The first row whose `Status` is not `done` is the resume point for `om-auto-continue-pr-loop`. Step ids and `Exec` cells are immutable once the plan is committed — per-Step commits touch only `Status` and `Commit`.

| Phase | Step | Title | Exec | Status | Commit |
|-------|------|-------|------|--------|--------|
| 0 | 0.1 | Add the spec and fold in the analysis decisions | inline | done | 37dbf48c67 |
| 0 | 0.2 | Measure the gate on a 7 GB / 2 vCPU container and record results in the spec | inline | done | 4f02386a64 |
| 1 | 1.1 | Add template scripts/ci.mjs quality gate and the ci package script | dispatch | done | 683f415967 |
| 1 | 1.2 | Add template ci.yml workflow and its structure test | dispatch | done | 2f0b503f53 |
| 1 | 1.3 | Add the --ci flag, conditional workflow copy and lockfile-first next steps | dispatch | done | 0444716196 |
| 1 | 1.4 | Assert no agentic generator writes under .github/workflows | dispatch | done | pending |
| 1 | 1.5 | Document the quality gate and route it from the standalone AGENTS.md | dispatch | todo | — |
| 2 | 2.1 | Add opt-in app-owned spec discovery to mercato test:integration | dispatch:capable | todo | — |
| 2 | 2.2 | Add template integration.yml workflow and its structure test | dispatch | todo | — |
| 2 | 2.3 | Document the integration workflow and the new CLI flag | dispatch | todo | — |
| 3 | 3.1 | Run yarn ci on a clean scaffold in snapshot.yml under a 7 GB cap | inline | todo | — |
| 3 | 3.2 | Record implementation status and changelog in the spec | inline | todo | — |

## Goal

Every new template-based standalone app ships a provider-neutral `yarn ci` quality gate plus GitHub Actions `ci.yml` and `integration.yml` (opt-out with `--ci none`), and upstream runs that gate on a fresh scaffold after each snapshot publish.

## Scope

- `packages/create-app`: `template/scripts/ci.mjs`, `template/package.json.template` (`ci` script), `template/.github/workflows/{ci,integration}.yml.template`, `src/index.ts` (`--ci` flag, conditional copy, next-steps order), tests under `src/lib/`.
- `packages/cli`: opt-in app-owned discovery flag for `mercato test:integration` (default unchanged).
- `.github/workflows/snapshot.yml`: post-publish canary step.
- Docs: `apps/docs/docs/customization/standalone-app.mdx`, `apps/docs/docs/cli/test-integration.mdx`, `template/AGENTS.md` + `agentic/shared/AGENTS.md.template` (one routing line each, within the 12 KiB budget).
- Spec: decisions Q10–Q12 plus the analysis remediation; Phase 0 numbers; changelog.

## Non-goals

- No PR-time standalone build job in `ci.yml` (user chose the post-publish canary, Q11).
- No real-GitHub verification run, canary publish or throwaway repo (deferred to manual, Q12).
- No changes to `mercato test:integration` defaults, no `.npmignore` publish-shape changes.
- No Dependabot/CodeQL/GitLab templates; no update path for already-scaffolded apps (Q6).

## Decisions taken at run start (user, 2026-10-09)

- **Q10 — Phase 2 suite scope:** opt-in CLI flag limits discovery to app-owned roots (`src/modules/**/__integration__`, `.ai/qa/tests/**`) and exits 0 on an empty suite before building; only `integration.yml` passes it.
- **Q11 — Upstream guard:** post-publish canary in `snapshot.yml` (clean scaffold, memory-capped `yarn ci`), honestly labelled; pre-merge protection comes from unit/YAML tests.
- **Q12 — Real-GitHub verification:** deferred to a manual follow-up; local verification = Verdaccio scaffold + `yarn ci` under `docker run --memory=7g --cpus=2`.

## Analysis remediation folded in (Step 0.1)

- C3 stub lockfile: next-steps print `yarn install` + commit `yarn.lock` before the GitHub publish block; `ci.yml` runs `node scripts/ci.mjs --check-lockfile` before `yarn install --immutable` and fails with an actionable message on the stub.
- I1/H3 heap: decided by Phase 0 numbers; if the gate does not fit, template scripts honor a pre-set `NODE_OPTIONS` (single gate definition), never a second gate in `ci.mjs`.
- I3/M3 env: `node scripts/ci.mjs --prepare-env` is shared by both workflows; placeholder list comes from Phase 0.
- I4 YAML: `cancel-in-progress: ${{ github.event_name == 'pull_request' }}`; fork-PR guard on `runs-on`.
- I5 `--ci none`: workflows removed after `applyStarterPreset` (L4).
- I6: add Migration & Backward Compatibility and Integration Test Coverage sections.
- L3: structure test asserts the literal `${{ vars.OM_CI_RUNS_ON` survives placeholder substitution.

## Implementation Plan

### Phase 0 — Spec and measurement

#### Step 0.1 — Add the spec and fold in the analysis decisions
- Commit the spec + analysis; add Q10–Q12; rewrite Architecture → Integration discovery, Upstream guard; promote the stub-lockfile edge case to a design fix; add Migration & BC and Integration Test Coverage sections; fix the BC category names.

#### Step 0.2 — Measure the gate on a 7 GB / 2 vCPU container and record results in the spec
- `yarn registry:publish` to local Verdaccio, scaffold a fresh app, `yarn install`.
- Run `generate`, `typecheck`, `lint`, `ds:check`, `test`, `build` each in `docker run --memory=7g --memory-swap=7g --cpus=2` and record cgroup `memory.peak`, wall time, disk.
- Remove `.env`, copy `.env.example`, record which vars `generate`/`build` need.
- Record `mercato test:integration` behavior in a fresh app (spec count discovered, exit code).
- Update the spec with numbers + forced decisions (heap, placeholder list). Gate: if it cannot pass at 7 GB, stop and escalate.

### Phase 1 — Quality gate

#### Step 1.1 — Add template scripts/ci.mjs quality gate and the ci package script
- Plain Node ESM, no deps; steps `generate → typecheck → lint → ds:check → test → build`; stops on first failure naming the step; runs `build` with `OM_SKIP_NEXT_BUILD_TYPECHECK=1`, and template `next.config.ts` sets `typescript.ignoreBuildErrors` only when that env is `1` (Phase 0: build OOMs at 7 GB otherwise); `--prepare-env` (copy `.env.example` → `.env` only when absent, no placeholders per Phase 0, never overwrite, never print secrets); `--check-lockfile` (fail on the stub lockfile with an actionable message). Exported pure helpers + entrypoint guard. Unit tests in `packages/create-app/src/lib/template-ci-script.test.ts`.

#### Step 1.2 — Add template ci.yml workflow and its structure test
- `template/.github/workflows/ci.yml.template` with the `Generated by create-mercato-app {{PACKAGE_VERSION}}` ownership header; triggers `pull_request` + `push` to default branch; `permissions: contents: read`; concurrency with PR-only cancel; fork-guarded `runs-on`; checkout, setup-node 24, corepack, yarn cache, `--check-lockfile`, `yarn install --immutable`, `yarn ci`. Test renders the template with the real placeholder logic and parses YAML with `yaml`.

#### Step 1.3 — Add the --ci flag, conditional workflow copy and lockfile-first next steps
- `--ci <github|none>` (default `github`), invalid value error, `--ci` + `--app/--app-url` error, help text + example, removal of `.github/workflows` after `applyStarterPreset` for `none`, one summary line naming the workflows + docs link, next-steps order puts `yarn install` + commit `yarn.lock` before the GitHub publish block. Tests.

#### Step 1.4 — Assert no agentic generator writes under .github/workflows
- Test that runs the create-app wizard generators (all tools) and `agentic:init` modes (`--force`, `--update-harness`) against a temp scaffold containing workflow files and asserts they are byte-unchanged and no generator writes under `.github/workflows/`.

#### Step 1.5 — Document the quality gate and route it from the standalone AGENTS.md
- `standalone-app.mdx`: `--ci` row, a "Continuous integration" section (what ships, `yarn ci`, `OM_CI_RUNS_ON`, fork guard, ownership, copying into existing apps, commit `yarn.lock`). One routing line in `template/AGENTS.md` and `agentic/shared/AGENTS.md.template`; budget test passes.

### Phase 2 — Integration workflow

#### Step 2.1 — Add opt-in app-owned spec discovery to mercato test:integration
- New opt-in flag; discovery limited to app-owned roots; empty result exits 0 with a clear message before build/boot; default behavior unchanged. Unit tests in `packages/cli`.

#### Step 2.2 — Add template integration.yml workflow and its structure test
- `pull_request` + `workflow_dispatch`; runner fallback chain `OM_CI_INTEGRATION_RUNS_ON || OM_CI_RUNS_ON || ubuntu-latest` (fork-guarded); `--check-lockfile`, install, `--prepare-env`, `npx playwright install --with-deps chromium`, `yarn test:integration:ephemeral` with the new flag, artifact upload on failure. Structure test.

#### Step 2.3 — Document the integration workflow and the new CLI flag
- Docker requirement, Actions minutes cost, switching the trigger to push-only/manual; `cli/test-integration.mdx` flag entry.

### Phase 3 — Upstream guard and close-out

#### Step 3.1 — Run yarn ci on a clean scaffold in snapshot.yml under a 7 GB cap
- In `standalone-integration`, run `yarn ci` on the clean scaffold right after install, before `.env` writing and enterprise/example activation, inside `docker run --memory=7g --cpus=2`. Keep existing workflow guard tests green.

#### Step 3.2 — Record implementation status and changelog in the spec
- Status, per-phase implementation notes, deferred manual verification, changelog entry.

## Risks

- Phase 0 may show the gate does not fit 7 GB → heap step appended, or escalate the default (spec Risks).
- Snapshot canary is post-publish: a broken template gate can still reach npm `@develop` before going red (accepted, Q11).
- Real-GitHub behavior (hardened mode, `vars` on fork PRs) is not verified in this run (Q12).

## External References

- None (no `--skill-url` passed).
