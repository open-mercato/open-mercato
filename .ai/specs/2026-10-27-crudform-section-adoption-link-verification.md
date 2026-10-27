# CrudForm section adoption link verification

**Status:** Proposed
**Implementation ownership:** Open Mercato core team members only
**Depends on:** `.ai/specs/2026-10-22-crudform-section-adoption-inventory.md`
**Related:** `.ai/specs/2026-10-09-crudform-section-adoption-rollout.md`, `.ai/specs/enterprise/2026-10-22-crudform-section-adoption.md`, issue #6686

## TLDR

Resolve and verify the static adoption inventory's review, PR, issue, and external-owner references through the configured tracker provider. A dedicated fail-closed command and required CI job prove exact-head design approval, causal implementation evidence, valid planned/deferred state, and external coordination without placing run-variant status in committed artifacts. This capability is independently deployable after the offline inventory/static gate.

## Overview

The inventory capability deliberately remains deterministic and offline. It can validate local specs, ids, state shape, canonical URLs, and committed artifacts, but it cannot prove whether a review is approving/current, a PR is open or merged to the configured base, an issue is open/assigned, or an external reference resolves. Those checks require credentials, provider runtime context, rate-limit handling, and a required network CI job with distinct failure and rollback behavior.

## Problem Statement

Treating syntactically valid URLs as delivery evidence would let stale reviews, closed PRs, expired deferrals, or missing external owners claim readiness. Conversely, putting provider responses, current SHAs, timestamps, or check URLs into the committed manifest would make generation nondeterministic and self-referential. Network verification must consume the static artifact without becoming part of its generator or committed bytes.

## Goals and Non-goals

### Goals

- Verify every evidence reference against the tracker/provider configured for the owning repository.
- Pin approving design evidence to the exact reviewed head and reject self-declared or stale approval.
- Prove current-PR or merged-ancestor implementation causality per exact work unit.
- Validate planned PRs, deferred issues, and external owner references fail-closed.
- Publish sanitized ephemeral evidence and provide one required CI check.

### Non-goals

- Scanning source, assigning inventory keys, deriving alternatives, or writing committed manifests.
- Defining domain readiness or changing any adopter state.
- Requiring network access for `yarn generate` or the static inventory check.
- Copying enterprise or official-module topology into OSS artifacts.
- Supporting tracker/provider configuration outside `.ai/agentic.config.json` and its installed descriptor.

## Proposed Solution

Add a verifier command that reads the committed owner-scoped inventory artifacts and the provider-reported validation context, deduplicates canonical URLs, performs bounded tracker reads, evaluates each state-specific evidence contract, and emits an ephemeral JSON/Markdown report. Wire it to required job `crud-form-section-adoption-links` only after the static baseline manifest is committed and one complete verification succeeds. The verifier never rewrites the inventory.

## Evidence Resolution Contract

### Approved design review

`designReview.url` must resolve to an approving GitHub review or the review automation's structured approval comment. Its reviewed head must equal `designReview.reviewedHeadSha`, and that SHA must equal the owning spec PR's current head or merged reviewed head as applicable. A formal approving review must be from an eligible non-author. When the automation shares the PR author's provider identity and cannot submit a formal self-review, its structured comment is valid only when it contains the exact head, independent review run/report id, validation source, and approve verdict. A manifest-authored declaration or ordinary prose comment that merely says “approved,” a dismissed/request-changes verdict, or approval against an older head is invalid.

### Ready implementation PR

A `ready.implementationPr` is valid only when either:

1. it is the current pull request, its base equals the tracker-configured base, the provider-reported head equals the CI event's `pull_request.head.sha` rather than GitHub's synthetic merge SHA, and its body contains `CrudForm-Adoption-Work-Units: <comma-separated invocationId#alternative.id values>` including the exact work unit; or
2. it is merged to the configured base, its merge SHA is an ancestor of the provider-reported validation head, and its body contains the same exact work-unit marker.

The referenced adopter spec must exist in the static manifest and the PR must change or explicitly name it. A sibling alternative cannot inherit readiness.

### Planned spec PR

`planned.specPr` must resolve to an open exact-head approved-design PR or a PR already merged to the configured base. It must change or explicitly name the referenced adopter spec and contain the exact work-unit marker. Closed-unmerged, draft-without-approval, stale-head, or unrelated PRs are invalid.

### Deferred issue

`deferred.issue` must be open, assigned to exactly the canonical `owner`, and contain the exact invocation, alternative, and host ids plus the blocking reason. `revisitBy` is valid `YYYY-MM-DD` UTC and must not be earlier than the verifier's UTC check date. Missing access, missing assignee, closed issue, mismatched owner/ids, or expired date fails.

### External coordination

Each link-only enterprise/official entry must resolve to the declared repository and owner plus an accessible owning spec or open issue. Verification confirms ownership/reference validity only; it does not inspect external invocation topology or claim external delivery complete. External delivery status does not block OSS technical completion unless the program index explicitly asks for portfolio completion.

## Architecture

| Area | Responsibility |
|---|---|
| static inventory | Versioned deterministic records and canonical evidence references; no network |
| verifier | State-specific provider reads, exact-head/ancestor/marker/owner/date checks |
| tracker descriptor | Provider endpoints, identity, repository, configured base, auth, pagination/rate-limit semantics |
| required CI job | Supply provider event context, run fail-closed command, upload ephemeral report |
| program indexes | Consume verified result for completion; never mutate evidence |

The verifier uses the tracker abstraction and does not embed GitHub-specific HTTP calls outside the installed provider descriptor.

## Data Models

No runtime database model and no committed generated schema. The verifier consumes `CrudFormSectionAdoptionRecord` and static completion references from the inventory spec.

```ts
type AdoptionLinkVerification = {
  schemaVersion: 1
  sourceTreeHash: string
  validationContext:
    | {
        kind: 'pull-request'
        repository: string
        baseRef: string
        baseHeadSha: string
        headSha: string
        checkRunUrl: string
      }
    | {
        kind: 'branch'
        repository: string
        branchRef: string
        headSha: string
        checkRunUrl: string
      }
  checkedAt: string
  results: readonly {
    workUnitId: string
    evidenceUrl: string
    status: 'valid' | 'invalid' | 'unavailable'
    code: string
  }[]
}
```

This object is an ephemeral CI artifact only. Its provider-reported refs and SHAs, check-run URL, manifest source hash, and validation time are the sole run-provenance contract. It is never imported by runtime code, committed, or used as `yarn generate` input.

## API Contracts

No product HTTP, command, event, or import API. The stable tooling contracts are:

- `yarn crud-form-sections:inventory:check-links`;
- required check name `crud-form-section-adoption-links`;
- verifier input: committed static artifact paths plus provider-reported repository/base/head/event context;
- exit 0 only when every required reference is `valid`; invalid or unavailable exits nonzero;
- sanitized diagnostic codes and ephemeral report schema version 1.

Credentials, repository, configured base, and identity come only from `.ai/agentic.config.json`, its installed tracker descriptor, and trusted CI event context. CLI flags cannot redirect verification to another repository or print tokens.

## Provider and Retry Contract

The verifier performs at most three reads per unique canonical URL, caches duplicate evidence within the run, honors provider rate-limit/reset headers, and retries only 429/5xx with bounded 1-second then 2-second backoff. Permission/404, malformed provider responses, invalid state, rate-limit exhaustion, and network unavailability produce distinct sanitized codes and fail closed. Logs include work-unit id, provider/repository, evidence kind, and code, never response bodies, credentials, raw tokens, or private external topology.

## UI/UX

No product UI. CI annotations and the Markdown artifact group failures by invalid, unavailable, stale head, wrong base/ancestry, missing marker, owner/assignment mismatch, expired deferral, and external reference. Each item includes one remediation command or owner action.

## Frontend Architecture Contract

No frontend files, route roots, providers, client boundaries, render-time requests, or bundle output change. This section is testable by an exact source-scope assertion that the implementation touches only CLI/tracker/CI/docs/tests and generated ephemeral-report fixtures, never `.tsx` production files.

## Edge Cases & Failure Scenarios

| Case | Required behavior |
|---|---|
| GitHub CI provides synthetic merge `GITHUB_SHA` | Ignore it for reviewed-head equality; use provider/event head |
| Review approves an older PR head | Invalid stale-head result |
| Current PR names sibling but not exact work unit | Invalid missing-marker result |
| Merged PR targets non-configured base | Invalid even if commit is reachable elsewhere |
| Merge SHA is not ancestor of validation head | Invalid causal-evidence result |
| Issue is open but unassigned/wrong owner | Invalid deferred-owner result |
| Deferral expires at UTC date boundary | Invalid beginning on the next UTC date |
| Same URL supports many work units | One bounded provider fetch; evaluate each marker independently |
| Optional repository is inaccessible | Unavailable external-reference result; no topology is inferred |
| Provider is down after retries | Unavailable, nonzero required check; static generation remains usable |

## Risks & Impact Review

| Risk | Severity | Mitigation | Residual risk |
|---|---|---|---|
| Stale or self-approved evidence claims readiness | High | Exact-head provider verdict and author checks | Provider review models may require adapter updates |
| Network outage blocks merges | Medium | Bounded retries, distinct unavailable status, static gate remains independent | Required network job intentionally fails closed |
| Synthetic merge SHA invalidates correct evidence | High | Provider/event head is authoritative and covered by fixtures | CI event differences require descriptor maintenance |
| Cross-repository verification leaks commercial facts | Critical | Link-only reads and sanitized output; never fetch/store source topology | Access logs remain provider-controlled |
| Rate limits amplify with many work units | Medium | Per-URL deduplication, cache, bounded reads, rate-limit handling | Very large portfolios may need batched provider support |

Rollback removes the required-check setting and job invocation while retaining the command/report reader for compatibility and diagnostics. It does not disable the independent static inventory gate or rewrite work-unit states. Re-enabling requires a successful preview/baseline verification. Published command/check/report names follow deprecation if later replaced.

## Migration & Backward Compatibility

This is additive tooling. It consumes schema-versioned static artifacts without changing them. Before making the job required, the implementation records one successful full baseline result for the current manifest and confirms branch protection references the exact check name. No committed artifact gains validation time, current SHA, check URL, or remote status. Provider descriptor evolution preserves the command and diagnostic schema or follows the normal deprecation protocol.

## Phasing and Implementation Plan

1. Implement provider-neutral evidence collection and state-specific evaluators over inventory fixtures; keep the command non-required.
2. Add exact-head design review, current/merged implementation PR, planned spec PR, deferred issue, and external coordination resolvers with sanitized codes and per-URL caching.
3. Add rate-limit/backoff, permission/unavailable handling, ephemeral JSON/Markdown output, and tests proving no secrets or external topology are serialized.
4. Run a complete baseline verification against the committed static manifest, reconcile every result with its work unit, and record the successful artifact/check URL outside committed generated files.
5. Add root script `yarn crud-form-sections:inventory:check-links`, CI job `crud-form-section-adoption-links`, and only then make that exact check required.
6. Run focused CLI/tracker tests, offline-with-network-denied static inventory tests, provider fixtures, `yarn generate` byte comparison, `git diff --check`, and the configured validation gate.

## Integration Coverage

- Design review: eligible non-author approved/requested/dismissed review, invalid plain self-declaration, exact/stale/missing head, same-identity structured automation comment with independent run evidence, and unavailable provider.
- Implementation PR: current exact event head, synthetic merge SHA rejection, configured/wrong base, merged ancestor/non-ancestor, exact/missing/sibling work-unit marker.
- Planned PR: open approved design, merged, draft/unapproved, closed unmerged, wrong spec or marker.
- Deferred issue: open/closed, assigned/unassigned/wrong owner, exact/missing ids, valid/expired date at UTC boundary.
- External reference: correct/wrong repository and owner, accessible/missing spec or issue, no source/topology capture.
- Operations: URL deduplication, three-read cap, 429/5xx backoff, permission/404, rate-limit exhaustion, sanitized logs/artifacts, required-job exit codes.
- Independence: `yarn generate` and static inventory checks pass with network denied and produce byte-identical committed artifacts.

## Acceptance Criteria

1. Every non-compatibility work unit and external coordination reference receives one fail-closed provider-backed result.
2. Exact-head design approval cannot be a plain self-declaration, stale, dismissed, or inferred from spec prose; same-identity automation is accepted only through the structured independent-run comment contract.
3. Ready implementation evidence proves the exact work-unit marker and current-PR or merged-to-base ancestry contract.
4. Planned and deferred evidence enforce exact spec/work-unit/owner/state/date semantics.
5. Provider unavailability is distinct from invalid evidence but both fail the required job after bounded retries.
6. No credential, response body, optional source topology, current SHA, validation time, or check URL enters committed artifacts.
7. Static generation remains fully offline, deterministic, and independently deployable.
8. The required job is enabled only after a clean full baseline verification.
9. Focused and configured validation pass with recorded evidence.
10. Implementation and review are performed by Open Mercato core team members.

## Final Compliance Report — 2026-10-27

### AGENTS.md Files Reviewed

- `AGENTS.md`
- `.ai/specs/AGENTS.md`
- `packages/cli/AGENTS.md`
- `.ai/docs/official-modules.md`
- `.ai/trackers/github.md`
- `BACKWARD_COMPATIBILITY.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|---|---|---|---|
| tracker descriptor | Use configured provider/repository/base/identity and sanitized operations | Compliant | All reads and event-head semantics route through the descriptor |
| root security rules | Never expose credentials, tokens, or commercial topology | Compliant | Link-only reads, sanitized codes, and ephemeral artifacts are mandatory |
| `.ai/specs/AGENTS.md` | One independently deployable capability with integration coverage | Compliant | This spec owns only remote evidence verification and required network job activation |
| official-modules guide | External work remains owner-repository scoped | Compliant | Verifier checks links/ownership only and never reads source topology |
| `BACKWARD_COMPATIBILITY.md` | Preserve published CLI/check/report contracts | Compliant | Names/schema are versioned and rollback retains the reader/command |

### Internal Consistency Check

| Check | Status | Notes |
|---|---|---|
| Data models match API contracts | Pass | Ephemeral schema exactly represents verifier outcomes and never enters runtime/committed data |
| API contracts match UI/UX | Pass | CLI exit codes, annotations, and artifact groups share the same status/code model |
| Risks cover all external interactions | Pass | Stale evidence, outage, SHAs, leakage, and rate limits are covered |
| Commands defined for all mutations | N/A | Read-only provider verification; no tracker or repository mutation |
| Dependency boundary is acyclic | Pass | Verifier depends on static inventory; inventory only relates back for discoverability |

### Non-Compliant Items

None.

### Verdict

- **Fully compliant**: Approved — independently deployable after the static inventory capability.

## Changelog

- **2026-10-27:** Split tracker-backed evidence resolution and required network CI activation from the offline static inventory capability.
