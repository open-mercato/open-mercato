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
- Full preview image build is being validated locally. The first command could not start because this host lacks Buildx and rejects `--progress`; the legacy-builder invocation is running instead. No deployment is requested.
- Standalone snapshot 42686862827 failed an invitation-cancellation button lookup; subsequent successful 42701434354 passed that scenario only on retry. No cause is established yet. Latest snapshot 42708819146 published successfully but standalone validation is still waiting for registry metadata. These are observations, not claimed passes or product diagnoses.
- Baseline PR full CI 42717768431 selects all 15 shards despite the plan-only diff; package/app builds and static checks passed and integrations remain in progress. The Docker fix requires a new full PR run.

## Progress

PR: #9125

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Diagnose and verify scope

- [x] 1.1 Independently investigate current main failures and previously landed fixes — 20ded252f1; investigation 12e5b310 validated
- [x] 1.2 Verify full-suite selection and address demonstrated remaining defects — 370fe936d1

### Phase 2: Validate and review

- [ ] 2.1 Run applicable validation and full PR CI until green
- [ ] 2.2 Complete final independent review and address findings
- [ ] 2.3 Publish evidence, mark ready, and apply automerge
