# Bounded API-key verification

## TLDR

Address PR #8376's security finding with shared, fail-closed bcrypt admission limits. Keep newly issued API keys at cost 10; preserve legacy bcrypt verification. The maintainer selected “Keep bcrypt with limits” on 2026-11-05. No HMAC credential migration or secret provisioning is included.

## Overview and Problem Statement

The public key prefix selects a stored hash before authentication. Attackers can vary wrong suffixes to defeat full-secret negative caches and repeatedly invoke expensive bcrypt work. Increasing cost from 10 to 12 quadruples that work. Both application and MCP authentication call the shared API-key verifier.

Audit: https://github.com/open-mercato/open-mercato/pull/8376#issuecomment-6554288231

## Proposed Solution and Architecture

`verifyApiKey` delegates to `apiKeyVerification.ts` before calling bcrypt. Each process permits two concurrent comparisons, with a token bucket of four starts and eight replenished starts per second. Admission is synchronous before the first await, has no queue, and uses a monotonic clock. Exhaustion returns false and does not cache the rejection. Errors release the concurrency slot in finally and retain the caller's existing error handling.

Reuse the existing `createApiKeyAuthCache` credential-cache abstraction for both successful and failed comparisons, with explicit 10-second TTLs and a 1,024-entry cap. Its process-random HMAC fingerprints cover the full supplied secret and the stored bcrypt hash; no raw credentials or hashes become retained cache keys. Do not cache principals. Cache entries cannot authorize deleted, expired, or role-revoked keys: callers still load the live key and apply their normal authorization checks. Changing the stored hash changes the cache identity.

The shared boundary covers application resolution in `packages/shared/src/lib/auth/server.ts`, MCP HTTP authentication in `packages/ai-assistant/src/modules/ai_assistant/lib/http-server.ts`, and other service callers. Caller-specific auth caches remain intact. Malformed stored hashes fail closed before bcrypt. Existing valid bcrypt work factors remain readable; new ordinary, session, and one-time keys use cost 10.

## Data Models and API Contracts

No schema, route, credential syntax, prefix, exported service signature, or DI registration changes. No new entity or auto-discovery file. Admission rejection follows the existing invalid-key result rather than adding a public error contract. Optimistic locking, UI, events, commands, and new-entity integration coverage are not applicable.

## Migration & Backward Compatibility

Deploy to every application and MCP authentication process; old binaries retain unbounded verification. No database migration, credential reissuance, or new secret is needed. Existing cost-10 and cost-12 keys remain valid. The intentional behavior change is rejection of uncached authentication attempts when the per-process budget is exhausted; callers may retry after refill. JWT-secret rotation is unaffected.

## Risks & Impact Review

| Scenario | Severity / area | Mitigation | Residual risk |
| --- | --- | --- | --- |
| Distinct wrong suffixes for a known prefix | Medium / availability | Global start-rate and concurrency bounds, no queue | Database lookups still occur |
| Attacker rotates prefixes | Medium / availability | Global budget, constant-size limiter state | Attacker can exhaust budget and deny uncached legitimate requests |
| Traffic across replicas | Medium / availability | Every process independently bounds work | Total admitted work scales with replica count; ingress limits remain useful |
| Cached success after revocation | High / authorization | Live record/expiry/role checks remain; cache stores comparison only | Existing caller cache policies remain unchanged |
| bcrypt exception | Medium / availability | Finally releases slot; no error cache | Existing caller error behavior remains |
| Legacy unusually expensive stored hash | Medium / availability | Concurrency and starts remain bounded; new issuance stays cost 10 | Trusted existing stored costs still determine per-comparison CPU work |

Thresholds deliberately prioritize CPU protection and can reject legitimate bursts. No per-IP identity is trusted or needed. This is a bound on bcrypt verification work, not a guarantee of authentication availability under sustained denial-of-service traffic.

## Implementation Plan

1. Keep cost 10; route every service comparison through the shared guard.
2. Add deterministic distinct-suffix, sequential/parallel admission, token refill, cache, and exception regressions plus real cost-10/cost-12 compatibility tests.
3. Run relevant suites and the configured validation gate; record limitations before requesting publication approval.

## Validation

Runner: local (no compose app container running). Dependencies installed with immutable lockfile; better-sqlite3 native build warned during install.

| Validation | Result |
| --- | --- |
| API-key regressions | 15 suites, 96 tests pass, including capacity-eviction assertions |
| Shared auth/cache regressions | 2 suites, 131 tests pass |
| SCIM dispatcher regressions | 1 suite, 15 tests pass; valid stored-hash fixtures and four-comparison crypto burst asserted; SCIM rejection still skips all credential work |
| build:packages → generate → build:packages | All pass |
| i18n:check-sync | Pass |
| i18n:check-usage | Exceeded 300-second limit |
| typecheck | Fails on duplicate getTelemetryRuntime imports at warranty_claims/[id]/page.tsx lines 9 and 13; both are present unchanged in target main e15497058 |
| test | Initial run exposed stale SCIM fixtures/comparison-count expectations; corrected and focused suite passes; final full rerun pending |
| build:app | Compilation succeeds; TypeScript phase fails on the same unchanged warranty_claims duplicate imports |
| template:sync:fix / lessons:check / diff whitespace | Pass; dispatcher test mirrored byte-identically |

No hosted CI or manual QA result is claimed. Current PR head remains ec15f185 until publication is approved. Full gate failures are disclosed, not waived.

## Final Compliance Report

Root/core rules and backward-compatibility guidance reviewed. Scope is one shared authentication-work bound, without schema/UI/public signature changes. Reuses the established API-key credential cache rather than introducing a new cache backend. No raw secrets logged or retained as cache keys. No authorization query or tenant scope changes. Independent spec-scope review approved (task f64c7401; no repository changes). Independent security code review approved a97408a0b (task 7849dd3d; no blocking findings); parent reran both relevant suites cited by the reviewer. The reviewer's capacity-coverage nit was corrected with direct cache-size and original-fingerprint assertions; all 96 API-key tests pass afterward. No source changed after that review; subsequent changes are tests, template mirror, lesson, and validation documentation.

## Changelog

- 2026-11-05: Recorded maintainer choice to retain bcrypt; implemented shared admission controls and verification cache; added abuse and compatibility regression coverage.

- 2026-11-05: Independent spec/security reviews approved; corrected eviction coverage and SCIM integration fixtures; documented full-gate blockers without claiming merge readiness.
