# Issue 7223: revoke deactivated staff session API keys

## TLDR

A session API key must stop authenticating on the next request after its staff owner is deactivated, including a successful cache hit in another process. Independently issued regular API keys retain their existing policy.

## Overview

This narrow security fix complements `2026-10-29-inactive-tenant-authentication.md`. Tenant liveness alone does not revoke a delegated session key when its user becomes unconfirmed.

## Problem Statement

`resolveApiKeyAuth` checks user existence and scope on cold resolution but omits `isConfirmed`. Positive cache hits only recheck tenant liveness, allowing deactivated owners to retain delegated access until cache/key expiry.

## Proposed Solution

Require an existing, confirmed, non-deleted session owner on both cold resolution and every positive cache hit. Recheck the original tenant and organization on cache hits. Keep all existing session markers, including hashed and legacy plaintext token fields during rolling upgrades, fail-closed: a session-marked key without `sessionUserId` cannot fall back to its creator.

## Architecture

The resolver keeps a private weak map from cached auth objects to their session classification. No classification field enters the returned principal or public cache interface. Unknown cached objects take the full key-resolution path, including after module reload. Each process reads the current owner from the database rather than relying on process-local invalidation events. Owner reads use the encryption-aware helper with `refresh: true`, avoiding stale ORM identity-map state. Bcrypt/key resolution and last-used debounce remain cached; tenant checks remain intact. Transient database failures preserve the existing retryable resolution status and do not poison successful cache entries.

## Data Models

Existing User and API-key fields suffice. No migration or entity/subscriber changes.

## API Contracts

No routes, response/principal fields, token formats, exported signatures, DI names or cache APIs change. Session keys owned by deactivated or out-of-scope users no longer authenticate. Regular keys do not acquire a new confirmation requirement.

## Migration & Backward Compatibility

This is the explicitly requested security revocation behavior change; no consumer migration is required. Deploy all authentication processes to enforce the live owner check everywhere. Old running processes retain the old behavior until restarted. The parent task owns any root upgrade-note wording: “Session-bound staff API keys are rejected immediately after owner deactivation, including cached authentication. Independently issued regular API keys retain their existing policy.”

## Implementation Plan

1. Add cold/warm owner-liveness tests, independent-cache coverage, tenantless/active and regular-key controls, malformed-marker and scope checks.
2. Add the live owner checks and run focused tests plus the serialized configured validation gate.
3. Publish and review a new fix PR; report unavailable checks and release the tracker claim.

## Risks & Impact Review

| Failure | Severity | Mitigation | Residual risk |
| --- | --- | --- | --- |
| Another process keeps a positive cached principal | High | Every process reads live owner state on session cache hits | All deployed processes must run the fix |
| Regular keys gain session revocation semantics | High | Session-only confirmation predicate; regular-key control tests | Existing regular-key policy remains intentional |
| Scope change or malformed marker permits fallback | High | Original tenant/org constraints; retain marker classification and missing-owner denial | Already in-flight requests may finish |
| Database lookup fails | Medium | Existing fail-closed/retryable status; no poisoned success cache | Session-key authentication depends on DB availability |

## Validation

Focused shared tests cover the HTTP auth resolver with mocked persistence, including two independently prewarmed auth caches without a local invalidation event. `TC-AUTH-071-deactivated-session-api-keys.spec.ts` creates its own organizations, user, role and API-key fixtures; marks owned key rows as session fixtures in the database; exercises the HTTP authentication boundary before/after user deactivation and an external organization move; and cleans up. No UI paths change. Live execution requires an isolated application/database environment.

## Final Compliance Report

Implemented without public signature, token, cache-interface, schema, dependency or root compatibility/upgrade-document changes. The shared authentication suite passes 10 suites/217 tests. Running the expanded cache suite against the original resolver produced 41 failures/42 passes. Both self-contained `TC-AUTH-071` API regressions passed in hosted CI at `b7d3c951c2e5fe4a8a172ecb681049eb977b97ee`, including cold/warm deactivation, external organization movement, and the regular-key control ([CI run](https://github.com/open-mercato/open-mercato/actions/runs/41014056059)).

Historical local validation follows; the hosted CI result below supersedes its readiness blocker. Runner: local; all resource-intensive gate runs use `flock /tmp/cezar-93432443-validation.lock`, with logs under `/tmp/issue-7223-*`.

| Configured command, in order | Result |
| --- | --- |
| `yarn build:packages` | Pass, 40 workspaces |
| `yarn generate` | Pass |
| `yarn build:packages` | Pass, 40 workspaces |
| `yarn i18n:check-sync` | Pass on retry with `TMPDIR=/tmp` |
| `yarn i18n:check-usage` | Pass on retry with `TMPDIR=/tmp`; unused keys are advisory |
| `yarn typecheck` | Pass, 40 workspaces |
| `yarn test` | Failed, exit 129: docs Docusaurus build exhausts the forced 1 GB heap; Turbo stops remaining work |
| `yarn build:app` | Pass |

`TMPDIR=/tmp yarn template:sync` passes. Translation and template commands initially failed because the inherited temporary directory exceeds the Unix socket path limit used by `tsx`. The first split non-docs run additionally hit that path problem in two unrelated bootstrap tests (2 failed, 2,976 passed, 16 skipped in shared). Isolated docs validation with a 4 GB heap passes all 24 tests. These supplemental runs do not make the exact configured `yarn test` command green. Hosted CI subsequently completed successfully at the unchanged source head: 32 successful checks and 3 intentionally skipped checks. The single initial cart concurrency failure passed a failed-job-only rerun without source or assertion changes; it is tracked separately in #8090. The latest-base merge must receive its own current-head checks before merge readiness is asserted.

The automated-verification exemption in `.ai/docs/pr-workflow.md` applies: no UI-rendering files, database structure, API surface or public contract changes, with both unit and live HTTP integration coverage in the same PR. This is a `skip-qa` basis, not a claim of manual QA or `qa-approved`.

## Changelog

- 2026-10-30: Defined and implemented the scoped session-owner revocation fix and regression coverage for #7223.
- 2026-10-30: Reconciled historical local validation limits with successful hosted API/CI evidence and recorded the automated-verification QA basis.
- 2026-10-30: Integrated the landed main test-mock fix and session-token hashing; retained legacy marker rejection, expanded hashed-marker coverage, and aligned HTTP fixtures with hashed storage.
