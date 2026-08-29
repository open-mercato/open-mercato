# Execution plan — finish all-organization feature-scope hardening (adopted from PR #5778)

**Origin:** adopted — reconstructed by `om-auto-continue-pr` on 2026-08-29 because PR #5778 carried no execution plan.
**PR:** #5778 · **Branch:** `codex/fix-all-organization-feature-scope` · **Base:** `develop`
**Author:** @haxiorz — this plan records the CI follow-up on the existing security-fix branch.

## Goal

Finish PR #5778 by preserving established empty-scope and non-enumerating route behavior while retaining the all-organization feature-scope restriction that closes the reported EUDR read bypass.

## Scope

- Diagnose the two failed ephemeral integration shards and classify whether each failure originates in this branch or its base.
- Correct the dispatcher/RBAC interaction so a principal with the required feature but zero visible organizations passes the feature gate while downstream data access remains narrowed to an empty set.
- Add focused regression coverage for the authorization decision and run the affected Docker integration tests plus the configured validation gate.
- Push the verified correction to the existing PR and return it for review.

## Non-goals

- Do not weaken tenant or organization data scoping.
- Do not change API response contracts, database structure, UI behavior, or ACL feature IDs.
- Do not absorb unrelated changes from the fork's `develop` branch or address unrelated CI failures.

## Evidence

| Conclusion | Drawn from | Confidence |
|---|---|---|
| The all-organization EUDR bypass is closed by deriving and binding the organizations where every required feature is granted | Security report, PR implementation, and EUDR integration regression | high |
| CI shard 3 is branch-caused: an `api_keys.view` principal with an empty organization allowlist now receives an early 403 instead of the established empty 200 list | Run 33272290510 artifact `integration-test-results-3` and `TC-APIKEY-007` | high |
| CI shard 7 is branch-caused: an empty-scope customer detail request now receives an early 403 instead of the established non-enumerating 404 | Run 33272290510 artifact `integration-test-results-7` and `TC-CRM-072` | high |
| The base commit is not responsible for either failure | Both assertions passed before the PR's new empty-allowed-set authorization branch and all other integration shards passed | high |

## Assumptions

- Feature possession and data visibility are separate decisions: an empty feature-authorized organization set must bind downstream reads to no organizations, not fail the feature gate itself.
- Existing list-empty and detail-not-found semantics are security-relevant because they prevent record enumeration and are part of the tested API behavior.
- The minimal correction belongs in the shared dispatcher authorization decision and its generated-app template twin.

## Risks

- Allowing the feature gate to pass with an empty narrowed set would be unsafe if a downstream route ignored the request-bound organization scope; focused tests must prove the shared CRUD layer consumes the empty set fail-closed.
- The API dispatcher and create-app template must remain byte-for-byte behaviorally aligned.
- Authorization caching or wildcard grants could make a narrow unit test pass while integration behavior differs, so Docker integration coverage is required.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Already landed on this PR (reconstructed)

- [x] 1.1 Implement organization-feature narrowing and add the EUDR all-organization regression — ee0a8f0ee4

### Phase 2: Resolve CI regressions

- [x] 2.1 Diagnose failed CI shards and classify their attribution — dc9d7cd541
- [x] 2.2 Preserve empty-scope feature authorization while retaining fail-closed query narrowing — dc9d7cd541
- [x] 2.3 Add regression coverage for empty-list and non-enumerating detail behavior — dc9d7cd541

### Phase 3: Validate and return for review

- [x] 3.1 Run focused Docker integration tests and the configured validation gate — dc9d7cd541
- [ ] 3.2 Complete the authoritative review pass, update PR evidence, and release the continuation lock
