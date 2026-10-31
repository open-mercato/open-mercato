# Stabilize main CI (12:38 UTC follow-up)

## Goal

Restore every currently failing actionable CI workflow on `main` to green by identifying the present root cause, applying the smallest durable fix, and proving the fix locally and on the pull request.

## Scope

- Inspect the latest completed `main` runs and their failed job logs, including the repeatedly failing Scheduled Dependency Audit.
- Fix only the repository-controlled root cause that is still reproducible from the current `main` dependency graph or workflow configuration.
- Add or update automated coverage for every behavior changed by the fix.
- Run the configured validation gate, the authoritative PR review workflow, and a final independent Cezar review before finalizing the PR.
- Add the repository's `automerge` flag only after the PR is finalized and all required evidence is green.

The completed remote branch `fix/stabilize-main-ci` belongs to the earlier merged PR #8294 and is already an ancestor of `main`. This scheduled follow-up therefore uses the time-scoped `fix/stabilize-main-ci-1238` slot instead of overwriting that completed run.

## Non-goals

- Do not weaken audit severity, suppress a fixable advisory, or make a failing security check pass by ignoring its result.
- Do not alter unrelated application behavior, release automation, or deployment workflows.
- Do not merge this PR or change `main` directly.

## Implementation Plan

### Phase 1: Diagnose current main failures

1. Inspect the latest failing `main` workflow logs and reproduce the failure against the current checkout.
2. Reduce the evidence to one root cause and identify the smallest repository-controlled change surface.

### Phase 2: Implement and test the root-cause fix

1. Apply the minimal fix and add focused regression coverage for the changed behavior.
2. Run the smallest relevant validation commands and remove any unrelated diff.

### Phase 3: Validate and publish

1. Run the complete configured validation gate and verify the latest actionable CI state.
2. Complete the authoritative PR review and final independent Cezar review, address actionable findings, finalize the PR, and apply `automerge`.

## Risks

- Dependency-audit output can change as registry advisories are updated. The diagnosis will record the run and advisory identifiers, and the fix will target the current lockfile rather than a transient log string.
- A dependency remediation can alter transitive versions broadly. The diff and regression tests will be reviewed for unrelated lockfile churn before commit.
- GitHub checks may remain pending after local completion. Pending checks will stay visible and will not be described as green or given the `automerge` flag until they pass.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Diagnose current main failures

- [ ] 1.1 Inspect the latest failing `main` workflow logs and reproduce the failure against the current checkout
- [ ] 1.2 Reduce the evidence to one root cause and identify the smallest repository-controlled change surface

### Phase 2: Implement and test the root-cause fix

- [ ] 2.1 Apply the minimal fix and add focused regression coverage for the changed behavior
- [ ] 2.2 Run the smallest relevant validation commands and remove any unrelated diff

### Phase 3: Validate and publish

- [ ] 3.1 Run the complete configured validation gate and verify the latest actionable CI state
- [ ] 3.2 Complete the authoritative PR review and final independent Cezar review, address actionable findings, finalize the PR, and apply `automerge`
