# Pre-Implementation Analysis: Default CI for scaffolded standalone apps

**Spec:** `.ai/specs/2026-10-09-standalone-app-default-ci.md` (draft, 2026-10-09)
**Analyzed:** 2026-10-09, against `develop` @ `a108dd07f4`

## Executive Summary

The quality-gate half of the spec (Phases 0, 1 and 3) is sound in shape, but three of its premises are false when checked against the code. A fresh app does not have an empty integration suite. The `snapshot.yml` "upstream guard" runs only after merge and after npm publish. The scaffold's own printed instructions lead to a red first CI run. The proposed verification step (push a Verdaccio scaffold to GitHub) also cannot work. **Recommendation: needs spec updates first.** Phase 2 needs a real design before anyone implements it. Phases 0–1 can proceed once the lockfile, heap and verification issues below are folded in.

## Backward Compatibility

All 14 categories in `BACKWARD_COMPATIBILITY.md` were checked. The spec's API Contracts table cites a "Template output" category that does not exist. The relevant surfaces are #13 CLI Commands and the create-app "Ask First: scaffold modes" rule.

| # | Surface | Finding |
|---|---------|---------|
| 1 | Auto-discovery conventions | Not touched. |
| 2 | Types | Not touched. `Options` in `packages/create-app/src/index.ts` gets one optional field (internal). |
| 3 | Function signatures | `copyDirRecursive(src, dest, placeholders)` (`index.ts:380`) is module-private, so changing it is safe. |
| 4 | Import paths | Not touched. |
| 5 | Event IDs | Not touched. |
| 6 | Widget spot IDs | Not touched. |
| 7 | API routes | Not touched. |
| 8 | DB schema | Not touched. |
| 9 | DI names | Not touched. |
| 10 | ACL features | Not touched. |
| 11 | Notification IDs | Not touched. |
| 12 | AI agent/tool IDs | Not touched. |
| 13 | CLI commands | `create-mercato-app --ci` is an additive optional flag (allowed). **Phase 2 step 1 changes `mercato test:integration` behavior** (exit 0 on an empty suite). See violation 1. |
| 14 | Generated file contracts | Not touched. |

### Violations Found

| # | Surface | Issue | Severity | Proposed Fix |
|---|---------|-------|----------|-------------|
| 1 | CLI Commands (STABLE) | Phase 2 step 1 changes the default exit semantics of `mercato test:integration` when no specs match. Scripts and CI that rely on a non-zero exit to catch "no tests found" (e.g. a typo'd `--filter`) would go silently green. This also contradicts the spec's own claim that "no existing flag, script or generated file changes meaning". | Warning | Add an opt-in flag (e.g. `--pass-with-no-tests`, mirroring Jest) or scope flag (see Gap C1) and use it only from `integration.yml`. Keep the default unchanged. |
| 2 | Public convention (new) | `OM_CI_RUNS_ON` / `OM_CI_INTEGRATION_RUNS_ON` are frozen once shipped (the spec says so). Their fallback-chain semantics are also part of the contract and are not written down as normative. | Warning | Add a "Migration & Backward Compatibility" subsection stating the names and the fallback order as STABLE. |

### Missing BC Section

The spec has no dedicated "Migration & Backward Compatibility" section. The API Contracts table and Final Compliance Report partly cover it, but they state "No existing flag, script or generated file changes meaning", which Phase 2 step 1 violates. Add the section and list violations 1–2 with their resolutions.

## Spec Completeness

### Missing Sections

| Section | Impact | Recommendation |
|---------|--------|---------------|
| Migration & Backward Compatibility | Reviewers can't see the CLI behavior change or the new variable contract in one place | Add it (see above). |
| Integration Test Coverage | The spec has unit/YAML-structure tests and manual GitHub evidence, but no automated test that runs a scaffolded `yarn ci` before merge (see Risk H2) | Add a section listing: create-app unit tests (flag parsing, conditional copy, rendered YAML), `ci.mjs` unit tests, and a PR-time scaffold-and-gate job. |
| Overview | Minor. The TLDR and Problem Statement cover it | Optional. |

### Incomplete Sections

| Section | Gap | Recommendation |
|---------|-----|---------------|
| Architecture → Integration discovery | The premise is false: a fresh app does **not** discover zero specs (Gap C1) | Rewrite after a design decision on suite scope. |
| Architecture → Upstream guard | `snapshot.yml` triggers on `push: [develop]` only, and `standalone-integration` has `needs: snapshot` (publishes to npm first) | Rewrite the guard as a PR-time job, or relabel it as a post-publish canary (Gap C2). |
| Edge Cases → `yarn.lock` not committed | Listed as an edge case, but it is the documented happy path (Risk H1) | Promote it to a design fix. |
| Phase 1 step 6 / Phase 2 step 4 verification | A `--verdaccio` scaffold writes `npmRegistryServer: "http://localhost:4873"` into the committed `.yarnrc.yml` (`buildRegistryConfig`, `index.ts`). A GitHub-hosted runner cannot reach it, so `yarn install` fails | Verify with a canary-published version (`release-snapshot.sh canary`, an Ask First publish step) or a `create-mercato-app@develop` snapshot, not Verdaccio. |
| Edge Cases → memory | The fallback ("`ci.mjs` calls `tsc`/`next build` directly") creates a second gate definition, which breaks Q4 | Make the template scripts respect an existing `NODE_OPTIONS` instead (Risk H3). |
| Phase 0 | Measures RAM and wall time but not disk. Private-repo runners have ~14 GB SSD; `node_modules` (~1.6k deps), `.next`, Chromium and the pgvector image may not fit | Add peak disk usage to Phase 0 step 1 and step 3. |
| Phase 2 step 4 | Refers to "the template's example spec". The template ships none: `template/.ai/qa/tests/` contains only `playwright.config.ts` | Say which spec to add, or add a minimal smoke spec under `template/src/modules/**/__integration__`. Note that `SKIP_DIRS` would strip it, so it would need a non-skipped location. |

## AGENTS.md Compliance

### Violations

| Rule | Location | Fix |
|------|----------|-----|
| create-app Ask First: "changing scaffold modes" | Whole spec (default-on) | The spec acknowledges this as the ask. Keep it explicit in the PR description for core-team sign-off. |
| create-app rule 8: keep `template/AGENTS.md` and `agentic/shared/AGENTS.md.template` aligned | Phase 1 step 5 names only "the template `AGENTS.md`" | Edit both files. They are 10,951 and 10,955 bytes against the 12 KiB (12,288) target, and the module-fact index is injected on top, so a new line can trip the `enforceRootInstructionBudget` fallback. Measure with `agent-instruction-budget.test.ts` before and after. |
| create-app rule 1: test monorepo and standalone | Phase 1 step 6 | Satisfied by `yarn test:create-app`, but see the Verdaccio/GitHub issue above for the remote run. |
| Lesson: "Generated standalone app installs in CI must opt out of immutable lockfiles" | `ci.yml` uses `yarn install --immutable` | This is correct **only** once the user has committed a real lockfile. The lesson exists because the scaffold ships the stub `yarn.lock.template`. The spec must handle the stub case explicitly (Risk H1). |
| Lessons: "Standalone template env examples must mirror security-sensitive env keys" and "Standalone CI runners must mirror webhook-security env from parity scripts" | `ci.mjs` `.env` placeholder materialization; `integration.yml` | The placeholder list must be derived from the same source as `scripts/test-create-app-integration.ts` and the CLI ephemeral env (e.g. `MOCK_GATEWAY_WEBHOOK_SECRET`). `integration.yml` currently has no `.env` step at all (Gap I3). |
| Root AGENTS.md: no `[internal]`-less hardcoded user-facing strings | `ci.mjs` / summary output | N/A. These are CLI/script logs, not i18n-scoped UI. No action. |

No UI, entity, API, event, ACL, encryption or cache surfaces are involved, so those checklist items do not apply.

## Risk Assessment

### High Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| **H1 — The first push is red by default.** `printGitHubSyncInstructions` (`index.ts` ~553–558) prints `git add -A && git commit && gh repo create --push`. Nothing requires `yarn install` first, and `--init-git` runs before it. The committed lockfile is then the stub `yarn.lock.template`, `ci.yml` fires on push, and `yarn install --immutable` fails with YN0028. | The very first CI check a new user sees is red. The spec itself calls that worse than no CI. | Two parts: (a) reorder the summary so `yarn install` and committing `yarn.lock` come before the GitHub publish block; (b) have `ci.yml` (or a tiny pre-step) detect the stub lockfile (only the `@workspace:.` entry) and fail with an actionable message such as "run `yarn install` and commit `yarn.lock`". |
| **H2 — The upstream guard is post-publish, not pre-merge.** `snapshot.yml` triggers on `push: [develop]` only, and `standalone-integration` `needs: snapshot` (npm publish). Phase 3 step 2 ("confirm green on a PR") is impossible as written. | A template change that breaks `yarn ci` merges and publishes to npm before anything goes red. New scaffolds from `@develop` inherit it. | Add a PR-time job (Verdaccio publish → scaffold → `yarn ci`), or explicitly downgrade the Phase 3 claim to "post-publish canary". Run `yarn ci` on a **clean** scaffold right after install, not after the job's `.env` writing and enterprise/example activation (`snapshot.yml` ~229–310). Otherwise the `.env.example` → `.env` path users hit is never exercised. |
| **H3 — Heap tuning conflicts with Q4.** `typecheck` and `build` in `package.json.template` hard-code `cross-env NODE_OPTIONS=--max-old-space-size=8192`, which overrides any outer `NODE_OPTIONS` and exceeds the 7 GB runner. The spec's fallback is a second gate definition in `ci.mjs`. | OOM on private-repo runners, or two gate definitions that drift apart. | Make the template scripts honor a pre-set `NODE_OPTIONS` (e.g. a tiny wrapper that only sets the heap default when unset). Then `ci.mjs` sets a tuned value and keeps calling the same scripts. This changes template output for new scaffolds only, so it is additive. |
| **H4 — Phase 2 premise is false: a fresh app runs a large platform suite.** `discoverIntegrationSpecFiles` (`packages/cli/src/lib/testing/integration-discovery.ts` ~395–404) walks `node_modules/@open-mercato`. Only `core`, `documents` and `enterprise` exclude `__integration__` via `.npmignore`. `npm pack --dry-run` on `webhooks` (and `search`, `checkout`, `ai-assistant`, channel packages, …) publishes `src/modules/*/__integration__/*.spec.ts`. | `integration.yml` would run dozens of upstream specs that need ~40 env vars (`snapshot.yml` ~232–283). Expect red runs lasting hours on 2 vCPU, on every PR, from day one. | Decide the suite scope before Phase 2: (a) a discovery option limiting specs to app-owned roots (`src/modules/**`, `.ai/qa/tests`), opt-in from `integration.yml`, plus a fast exit before the app build when nothing matches; and/or (b) add `__integration__` to the other packages' `.npmignore` (a publish-shape change, Ask First). Remove the Phase 0 step 3 "verify zero" premise. |

### Medium Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| **M1 — Concurrency cancels default-branch runs.** The group `<workflow>-<ref>` with `cancel-in-progress: true` also cancels push runs on `main` when merges land back to back. | Commits on the default branch with no CI result. | `cancel-in-progress: ${{ github.event_name == 'pull_request' }}`. |
| **M2 — Fork PRs and self-hosted runners.** `runs-on: ${{ vars.OM_CI_RUNS_ON \|\| 'ubuntu-latest' }}` can send public-repo fork PRs to self-hosted runners if the variable resolves for fork-triggered runs. GitHub warns against self-hosted runners on public repos. Whether `vars` resolves for fork PRs must be verified. | Untrusted code on the user's infrastructure. | Guard it: `github.event.pull_request.head.repo.fork && 'ubuntu-latest' \|\| vars.OM_CI_RUNS_ON \|\| 'ubuntu-latest'`, and document the risk. The guard is harmless if `vars` is already empty for forks. |
| **M3 — `integration.yml` has no `.env` step.** Only `ci.mjs` materializes `.env`, but the ephemeral runner builds and boots the app. | Integration fails on env-dependent build/start paths. | Expose the helper (`node scripts/ci.mjs --prepare-env`) and call it from both workflows. |
| **M4 — Disk exhaustion** (see the Phase 0 gap). | `ENOSPC` mid-build or mid-Playwright. | Measure in Phase 0. If tight, add a cleanup step or skip artifact caching. |
| **M5 — Verification plan cannot run as written** (Verdaccio registry baked into `.yarnrc.yml`). | Phase 1/2 evidence step blocks the PR. | Use a canary or snapshot version (publishing is Ask First). |

### Low Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| L1 — `systemd-run -p MemoryMax=7G` needs systemd and privileges, which are unverified on `blacksmith-4vcpu-ubuntu-2404`. | The Phase 3 cap silently does nothing or fails. | Prefer `docker run --memory=7g --cpus=2` (the same tool Phase 0 uses), or verify `systemd-run` first. |
| L2 — `generate` runs twice: `ci.mjs` runs it, and `build` runs `yarn generate &&` again. | ~1 extra minute per run. | Accept and document it, or drop `generate` from `ci.mjs` and rely on `build`. Note that `typecheck`/`lint` need generated files, so the explicit first step is still useful. |
| L3 — `.template` placeholder substitution. It is safe today: the regex matches only `{{APP_NAME}}`, `{{PACKAGE_VERSION}}` and `{{REGISTRY_CONFIG}}`, not `${{ vars.* }}`. A future placeholder named like a GitHub context would corrupt the YAML. | Broken workflow in new scaffolds. | Make the YAML structure test assert that the rendered file still contains the literal `${{ vars.OM_CI_RUNS_ON`. |
| L4 — `applyStarterPreset` runs after the copy. | It could recreate or remove files if presets ever touch `.github/`. | Apply the `--ci none` removal after the preset step, or assert it in a test. |
| L5 — The root `AGENTS.md` budget fallback (see AGENTS.md compliance). | Loss of the inline routing index. | Measure; shorten elsewhere if needed. |

## Gap Analysis

### Critical Gaps (Block Implementation)

- **C1 — Integration suite scope (Phase 2):** a design decision on which specs a user app's CI runs (app-owned only vs platform), the CLI mechanism (opt-in flag) and the empty-suite behavior, without changing `mercato test:integration` defaults.
- **C2 — Pre-merge guard (Phase 3):** either a PR-time scaffold + `yarn ci` job, or an honest relabel as post-publish. The current text promises PR-time protection that the trigger cannot give.
- **C3 — Stub-lockfile first push (Phase 1):** a concrete fix (summary reorder + stub detection) instead of "docs say commit `yarn.lock`".

### Important Gaps (Should Address)

- **I1 — Heap strategy** that keeps a single gate definition (H3).
- **I2 — Verification registry:** canary/snapshot instead of Verdaccio for the GitHub runs.
- **I3 — Shared `.env` preparation** for both workflows, with the placeholder list sourced from the parity runner's env contract (lessons on webhook-security env).
- **I4 — Concurrency and fork-runner guards** in the workflow YAML (M1, M2).
- **I5 — How `--ci none` is implemented:** say whether `copyDirRecursive` gains an exclusion option or the directory is removed after copy and preset.
- **I6 — Migration & Backward Compatibility section** and an **Integration Test Coverage** section.

### Nice-to-Have Gaps

- Phase 0 disk measurement and a record of the runner image used.
- Add `--ci` to the `--help` examples block (`index.ts` ~70–83) alongside `--agents`.
- A test asserting `.github/workflows/*.yml` is copied into a scaffold's `.github/` alongside Copilot's `copilot-instructions.md`/`instructions/`/`skills` without collision, using `--agents github-copilot`.

## Remediation Plan

### Before Implementation (Must Do)

1. **Redesign Phase 2 suite scope (C1):** pick app-owned-only discovery via an opt-in CLI flag, keep defaults unchanged, and rewrite Architecture → Integration discovery and Phase 0 step 3. Alternatively, split Phase 2 into a follow-up spec so Phases 0, 1 and 3 can ship.
2. **Fix the guard placement (C2):** add a PR-time scaffold-and-gate job, or reword Phase 3 as post-publish. Run it on a clean scaffold before the integration job mutates `.env`/modules.
3. **Fix the first-push path (C3):** reorder `printTemplateNextSteps`/`printGitHubSyncInstructions` so install and committing the lockfile come first, and add stub-lockfile detection with a clear message to `ci.yml`/`ci.mjs`.
4. **Choose the heap strategy (I1):** template scripts honor an existing `NODE_OPTIONS`. Drop the "call `tsc`/`next build` directly" fallback.
5. **Replace Verdaccio in the verification steps (I2)** with a canary/snapshot version, and note that publishing it is an Ask First action.
6. **Add the missing sections:** Migration & Backward Compatibility, Integration Test Coverage.

### During Implementation (Add to Spec)

1. Record the Phase 0 numbers (RAM, wall time, **disk**), the placeholder env list and its source of truth.
2. Workflow YAML: `cancel-in-progress` only for PRs; fork guard on `runs-on`; shared `--prepare-env` step in both workflows.
3. State the `--ci none` implementation (exclusion option vs post-copy removal, ordered after `applyStarterPreset`).
4. Rendered-YAML test asserting `${{ vars.OM_CI_RUNS_ON` survives placeholder substitution.
5. Update both `template/AGENTS.md` and `agentic/shared/AGENTS.md.template`, and record the byte budget before and after.

### Post-Implementation (Follow Up)

1. Consider adding `__integration__` to `.npmignore` in every publishable package (Ask First: changes publish shape). It would make the "fresh app has zero platform specs" assumption true and shrink package size.
2. Revisit Q6 (updating CI in existing apps) using the agentic ownership-manifest semantics, as the spec already notes.
3. Add a lesson record if H1 or H4 bites during implementation (topic: `template-sync`, `package-runtime`).

## Recommendation

**Needs spec updates first.** Phases 0–1 are close to ready once C3, I1, I2 and I5 are folded in. Phase 3 needs C2 resolved. Phase 2 needs a real design for suite scope (C1) and should be split out or explicitly marked blocked until that decision is made.
