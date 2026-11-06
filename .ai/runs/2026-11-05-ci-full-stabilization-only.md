# Stabilization-only full CI

## Goal

Stop ordinary PR label changes from scheduling CI, and make full validation automatic for dedicated stabilization PRs.

## Scope

Update the existing CI workflow, focused workflow regression tests, contributor guidance, and one lesson recording the corrected stabilization-only intent. Preserve required job names, push branches, normal PR affected selection, audit policy, and PR-versus-branch cancellation behavior. No separate privileged dispatcher, new dependency, production code, or branch-protection change.

The proposed policy uses same-repository `stabilize/*` branches for stabilization PRs. These run full typecheck, unit tests, and 15 integration shards from the first eligible PR event. Labels, including legacy `ci-full`, do not schedule work or grant full scope to ordinary PRs. Existing historical `fix/stabilize-*` branches must use the documented branch convention for future stabilization work.

## Evidence and Design Decision

PR #8752 had one commit but 18 CI runs: the opening event plus 17 label additions. The `ci-full` change in #8623 listened to every `labeled` event, gated only `prepare`, and gave unrelated label runs unique concurrency groups. Lint, DS lint, and audit-scope therefore reran. Backport also created skipped runs; this task leaves that separate workflow unchanged.

Read-only architecture review recommended removing `labeled` instead of adding skip conditions to every required check: GitHub reports skipped checks as success. A separate manual dispatcher adds required-check provenance, permission, ref-binding, and concurrency complexity without improving the stabilization branch convention.

Source doc: .ai/runs/2026-11-03-stabilize-main-ci-full.md

## Implementation Plan

### Phase 1: Fix scheduling and scope

1.1 Remove label-triggered CI, restore per-ref concurrency, and scope full validation to stabilization PRs.
1.2 Add behavioral regression tests and document the stabilization convention and label migration.

### Phase 2: Verify and publish

2.1 Run focused validation, inspect GitHub checks, and perform an independent review; resolve actionable findings.
2.2 Publish the final PR explanation, validation limits, and handoff; release the automation claim and clean up its worktree.

## Risks

- Label-only skip results can mask existing checks; removing the label trigger prevents new CI check results for unrelated labels entirely.
- Fork branch names must not opt into stabilization-only extra work; match repository identity as well as the branch prefix.
- Re-running an old workflow uses its original event payload. Future stabilization branches should follow the new automatic convention rather than rely on label timing.
- Remote full-suite checks may outlast this authoring run; never claim them green without final-head evidence, and keep any validation blocker explicit.

## Validation

Use the repository's GitHub-checks-first review policy, with narrow local fallback for the changed workflow tests. Record runner choice and exact results. The configured runtime gate remains required evidence before merge; no label grants review or QA approval.

## Local Verification

Runner: local Docker CLI with a disposable Linux `node:24` container (read-only checkout, network disabled). All 51 focused CI/concurrency/coverage/audit tests passed. The direct macOS run passed 21/23 but could not execute two existing Linux workflow branches using GNU grep/paste; the actual workflow scripts passed all cases under Linux. `git diff --check` passed. Full build/typecheck/unit/integration evidence is supplied by GitHub CI, not inferred from these focused tests.

## Review and Handoff

Independent code review approved the implementation with no findings. The main ruleset still requires `scope`, `guard`, `prepare`, `lint`, `ds-lint`, `test`, `audit-scope`, and `documents-multi-instance`; their names remain unchanged. The legacy branch-protection endpoint returns 404, but the main ruleset was read explicitly. No rule or approval was bypassed.

Validation source: GitHub checks plus the focused Linux fallback. Last inspected CI run was https://github.com/open-mercato/open-mercato/actions/runs/42036316936 at bef8c9256: lint, DS lint, audit-scope, scope, guard, and CLA had passed; prepare and JavaScript/TypeScript CodeQL were still running, with downstream test/integration pending. The completion-document push starts final-head CI; no earlier success is treated as evidence for that new head. The configured build/generate/rebuild/i18n/typecheck/unit/app-build gate is not claimed complete.

The lesson catalog passes the direct Node entrypoint. Its Yarn launcher could not find a worktree node_modules state file, so no dependency install or broad local gate was attempted. The equivalent command `node packages/create-app/agentic/shared/scripts/check-lessons.mjs --root .` passed.

Final authoring status: implementation and regression coverage are complete; publish the PR ready for maintainer review, disclose pending required checks, and do not merge. GitHub prevents author self-approval, so the review assessment is a COMMENTED review and the pipeline remains `review`. The next reviewer owns final-head CI and approval. Release the claim and remove this run's temporary worktree after publishing this record.

## Progress

PR: #8788

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Fix scheduling and scope

- [x] 1.1 Remove label-triggered CI, restore per-ref concurrency, and scope full validation to stabilization PRs. — dad929c5a
- [x] 1.2 Add behavioral regression tests and document the stabilization convention and label migration. — dad929c5a

### Phase 2: Verify and publish

- [x] 2.1 Run focused validation, inspect GitHub checks, and perform an independent review; resolve actionable findings. — dad929c5a
- [x] 2.2 Publish the final PR explanation, validation limits, and handoff; release the automation claim and clean up its worktree.
