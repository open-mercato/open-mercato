# Execution plan — make PR #5794's enricher telemetry hardening CI-safe (adopted from PR #5794)

**Origin:** adopted — reconstructed by `om-auto-continue-pr` on 2026-08-30 because PR #5794 carried no execution plan.
**PR:** #5794 · **Branch:** `fix/issue-5782-throttle-slow-enricher-logging` · **Base:** `develop`
**Author:** @haxiorz — this plan interprets their intent; correct it by editing this file or commenting on the PR.

## 🎯 Goal

Deliver issue #5782's throttled slow-enricher diagnostics and telemetry timing metric without causing the required enterprise SSO integration shard to fail.

## Scope

The response-enricher timing/logging implementation, its shared telemetry bridge, focused regression tests, and the CI evidence needed to prove the existing PR is safe.

## Non-goals

Making enrichers faster, changing enricher timeout semantics, creating a general-purpose logging throttle, or changing enterprise SSO behavior unless the failure evidence proves this PR directly broke that path.

## Evidence

| Conclusion | Drawn from | Confidence |
|---|---|---|
| The intended feature is per-enricher log throttling plus low-cardinality timing telemetry. | Issue #5782, PR body, telemetry spec, and existing diff | high |
| The original implementation and focused tests are already landed. | Commit `e0b04ccce9d108c0a48441e4a01c3e1dc2df1458` and the six-file PR diff | high |
| Required CI remains the only open technical gate. | PR checks and the `changes-requested` rationale comment | high |
| The failed shard must be treated as branch-specific until disproved. | User report that contemporaneous PRs passed CI | high |
| The failed shard was not caused by the PR's product code. | The first failure exceeded the SSO fixture's 10-second live OIDC discovery timeout; the remaining failures cascaded after cleanup was skipped. The exact failing test passed 5/5 locally, and CI run `33332985776` passed all 15 integration shards on identical product code. | high |

## Assumptions

- A nearby successful run of the same integration shard is the most reversible comparison baseline.
- Any failure introduced by optional diagnostic telemetry must be isolated so it cannot alter the success or failure of the underlying API request.
- The existing PR, branch, issue link, and non-UI `skip-qa` classification remain the correct delivery vehicle.

## Risks

- The enterprise SSO fixture currently exposes only an HTTP 500 at the call site, so application logs or a focused reproduction may be required to identify the internal exception.
- A CI-only initialization path may not be exercised by the current shared unit tests.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Already landed on this PR (reconstructed)

- [x] 1.1 Implement throttled slow-enricher logging, timing telemetry, tests, and spec updates — `e0b04ccce9`

### Phase 2: Diagnose the required CI regression

- [x] 2.1 Compare the failed SSO shard with a contemporaneous passing run and identify the branch-specific HTTP 500 path — the first activation reached 10.2 seconds against a 10-second live OIDC discovery timeout; retry-state leakage caused the later HTTP 500 cascade, while the same product code passed the focused replay and full CI rerun

### Phase 3: Make the telemetry path failure-safe

- [x] 3.1 Implement the minimal root-cause fix and add regression coverage for the CI-only failure mode — no product patch was justified because the failing SSO path does not initialize or invoke this PR's telemetry bridge and passed unchanged on replay

### Phase 4: Verify and update the existing PR

- [x] 4.1 Run focused checks and the configured full validation gate — focused shared/telemetry tests, the exact SSO replay, and all configured local validation commands passed; CI run `33332985776` also passed
- [x] 4.2 Run automated review, push the completed plan, monitor CI, and normalize PR status — automated review found no findings; GitHub still requires an eligible external reviewer
