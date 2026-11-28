# Stabilize main — 2026-11-10

## Goal

Verify main with the full CI suite on an isolated stabilization PR, fix demonstrated root causes, and apply `automerge` only after green CI and independent review.

## Scope

Branch: `stabilize/main-2026-11-10`, based on main at `b8f5a8e87608b97101f6b7a87d69851dbb46e439`. The operator's branch name and wait-until-green requirement override the skill's default prefix and no-wait reporting policy.

Existing CI already selects all 15 integration shards and unfiltered type/unit checks for same-repository `stabilize/*` branches or `ci-full`. Preserve that implementation unless a defect is demonstrated.

Non-goals: unrelated refactors, suppressing tests, weakening gates, production changes, or merging into main.

Source doc: `.ai/specs/implemented/2026-04-10-ci-cd-performance.md`

## Implementation Plan

### Phase 1: Diagnose and verify scope

1.1 Dispatch one independent read-only investigation of current main workflows and historical failures; determine which causes still exist.

1.2 Verify full-suite selection and address only demonstrated remaining defects with regression coverage. The tightly coupled implementation and CI follow-up remain with the parent.

### Phase 2: Validate and review

2.1 Run the applicable validation gate and the PR's full suite; diagnose and fix failures until all applicable checks pass.

2.2 Dispatch exactly one final independent review using `cez task create --kind review --review-of stabilize/main-2026-11-10`, validate its evidence, and address findings.

2.3 Publish final evidence, mark ready, and apply `automerge` only after successful final-head checks and review.

## Risks

- Latest main full CI already passed: https://github.com/open-mercato/open-mercato/actions/runs/42708819007. No corrective code is warranted without evidence of a remaining defect.
- Hosted failures may be transient infrastructure problems; preserve evidence and establish causality before changing code.
- Adding `ci-full` does not schedule a run by itself. The stabilization branch selects full scope from its initial PR event.
- A docs-only outcome uses the skill's docs-only gate exemption. Code changes require the configured ordered validation gate; hosted CI provides the full-suite evidence.

## Diagnosis and validation evidence

- Independent investigation `12e5b310` inventoried 24 active workflows. Parent verified its zero-file diff and the failed QA deployment log at https://github.com/open-mercato/open-mercato/actions/runs/34504173608: CLI package build aborts with ENOENT for `/app/AGENTS.md`. Current preview builder and runner stages both still omit that file and `BACKWARD_COMPATIBILITY.md`, required unconditionally by CLI/create-app builds. Both stages now copy the required root guides. No deployment, publication, or runtime policy changes.
- The regression derives required guide inputs from both package build scripts and checks every preview build stage before its package-build instruction. It fails on the original Dockerfile and passes after the fix. Runner: local, `timeout 30 node --test scripts/__tests__/dockerfile-runtime-copy.test.mjs scripts/__tests__/docker-production-runtime.test.mjs` (7/7 pass). An attempted broader Docker-ignore test could not load the uninstalled `@balena/dockerignore` dependency; hosted CI covers it. No app container was running in the probed compose configurations; local mode selected.
- Full local preview image build passed (exit 0), producing image `5feb0527eb91` tagged `stabilize-8045654f-preview`. Both the builder stage (`yarn build`: package build, generation, rebuild, app build) and runner stage (`yarn build:packages`, 42 successful tasks) completed. The first command could not start because this host lacks Buildx and rejects `--progress`; the legacy-builder invocation succeeded. No deployment was triggered.
- Standalone snapshot 42686862827 failed an invitation-cancellation button lookup; subsequent successful 42701434354 passed that scenario only on retry. No cause is established yet. Latest snapshot 42708819146 published successfully but standalone validation is still waiting for registry metadata. These are observations, not claimed passes or product diagnoses.
- Plan-only PR CI 42717768431 selected all 15 shards and passed builds/static checks before cancellation by the fix push. Fixed-head full CI passed at `0037dc54d6671d6e43820b7a137324f2783aa799`: https://github.com/open-mercato/open-mercato/actions/runs/42720976072. All 15 integration shards and merge-coverage succeeded. Every configured build/generation/i18n/type/unit command, full script suite, template parity, Docker, lint, timezone, multi-instance, and CodeQL check passed. Hosted logs confirm full scope. The earlier unavailable local Docker-ignore dependency is covered by the passing hosted script suite.

- Final independent review `9cac9def` approved exact head `0037dc54d6` with no findings or edits: https://github.com/open-mercato/open-mercato/pull/9125#issuecomment-6754823294. The reviewer independently reran 7/7 focused tests and verified that base, either omitted COPY, and either COPY placed after its build all fail. Parent validated the zero-file reviewer diff, read its evidence, and reran 7/7 tests. GitHub rejected native approval because the App also authored the PR; the evidence comment is an independent verdict and does not satisfy any required native approval gate.
- Branch-protection enumeration returned HTTP 403; every reported check is conservatively inspected instead. Both subtasks are complete, all owned review claims released, and no dispatched changes were merged.
- This final ledger update changes no reviewed source or tests. Publication remains gated on a fresh full CI run for the ledger head. The final readiness and `automerge` actions are recorded in PR #9125's timeline; the PR body remains `Status: in-progress` until those checks pass. Historical snapshot flakiness is not claimed fixed, and latest main standalone validation is monitored separately.

## Progress

PR: #9125

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Diagnose and verify scope

- [x] 1.1 Independently investigate current main failures and previously landed fixes — 20ded252f1; investigation 12e5b310 validated
- [x] 1.2 Verify full-suite selection and address demonstrated remaining defects — 370fe936d1

### Phase 2: Validate and review

- [x] 2.1 Run applicable validation and full PR CI until green — 0037dc54d6; full CI 42720976072
- [x] 2.2 Complete final independent review and address findings — 0037dc54d6; approved, no findings
- [x] 2.3 Publish evidence, mark ready, and apply automerge — final publication gated on final ledger head checks; see PR #9125 timeline
