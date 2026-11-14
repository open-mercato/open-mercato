# Starter: optional AI and reusable existing infrastructure

## Goal
Let setup proceed without an LLM key and reuse the matching Mercato infrastructure started by earlier tooling instead of treating it as foreign port owners.

## Scope and non-goals
Starter provider prompt, Compose discovery/read-only adoption, actionable port-conflict guidance, regression tests and related docs/spec. Diagnose the bootstrap module-facts warnings; change only a proven bootstrap logging defect if it is small and covered. Doctor was confirmed working by the operator and stays unchanged. Never kill unrelated processes or delete volumes. The operator chose explicit confirmation to continue using pre-existing services; otherwise print yarn om stop guidance. Preserve the established automatic reinstall behavior of dev:greenfield, as clarified by the operator, and investigate the reported runtime diagnostics.

## Implementation plan
1. Make AI provider configuration optional with an interactive skip and non-interactive continuation; keep existing configured-provider synchronization.
2. Discover and verify existing matching Mercato containers across Compose project identity changes, reuse healthy services, retain readiness checks and diagnose incompatible/foreign owners.
3. Verify meaningful regressions and real read-only discovery on an already-running stack; apply appropriate validation and automated review.

## Risks
A container name or open port alone cannot establish compatible ownership. Preserve existing secrets, mounts and database credentials; do not automatically repoint services or stop another project's stack. Runtime migrations are not part of test execution without approval.

## Progress

PR: #8612

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Implementation

- [x] 1.1 Make the provider step optional and add regression coverage. — 191f8c57f
- [x] 1.2 Discover and reuse existing Mercato infrastructure with regression coverage. — 191f8c57f
- [x] 1.3 Resolve port guidance and module-facts warning diagnosis; update docs/spec. — 191f8c57f
- [x] 1.4 Require an explicit greenfield reset flag and correct Next development environment. — 191f8c57f

- [x] 1.5 Make the diagnostics Retry action recover the runtime instead of reloading stale state. — 1e55286bd

### Phase 2: Verification and publication

- [x] 2.1 Run relevant validation and real read-only discovery checks. — 191f8c57f
- [x] 2.2 Run authoritative review and publish the completed PR. — c2d896060 (review 5752901823; current-head CI and manual QA remain merge gates)

## Greenfield clarification

The operator clarified that dev:greenfield must keep its established automatic --reinstall behavior. Remove this PR's default change while retaining ordinary setup's --skip-if-initialized behavior, optional AI, existing-infrastructure reuse, CSP and Retry fixes. Verify command routing in disposable mocked fixtures only; do not run a live database reset or migration.

### Phase 3: Preserve greenfield compatibility

- [x] 3.1 Restore default greenfield reinstall and align regression coverage and docs. — 865b22dde
- [x] 3.2 Protect unhealthy existing services before startup and cover reuse consent. — 078106eb0
- [x] 3.3 Verify configured PostgreSQL, Redis and Meilisearch credentials before database setup; provide sanitized actionable errors. — 8f8820874
- [x] 3.4 Run focused validation and full PR code review, then publish the updated PR scope. — 2a32c69f9
- [x] 3.5 Execute all eight configured workspace validation commands and finalize the review. — a537df464

## Diagnostic findings

- Module-facts: the first package build precedes generation, so no module registry exists yet; the warning is repeated per discovered module and affects AI documentation facts, not runtime authentication. Imported search constants are intentionally reported when static extraction cannot prove their IDs. No metadata warnings were suppressed.
- Greenfield: automatic --reinstall dates to PR #422 (2026-01-29), later moved from package.json into scripts/dev.mjs by #1141. The operator clarified that this main-branch behavior must remain unchanged; the earlier opt-in change is superseded by Phase 3. Standalone setup remains non-destructive unless --reinstall is explicit.
- Dev CSP: Next dev inherited NODE_ENV=production from the CLI's shared server environment. Set development on the Next child only; production CSP keeps its restrictions.
- localStorage warning reproduces on host Node 26; supported Node 24 does not emit it in the same native-global probe. No global warning suppression added.
- Destination-stream error: the supplied log exposes React's generic writable-stream error wrapper without the underlying stream failure. No unproven streaming patch added.

## Validation evidence

Runner: local. 568 starter/dev-runtime Node tests, 16 standalone setup tests and 75 CLI command tests passed. CLI suite also passed with supported Node 24. Mirrored dev runtime and infra-preflight files are byte-identical; template-sync and diff checks passed. Live read-only Docker discovery identified the existing four Mercato services across checkout identities and returned their actual names/states. No live services were stopped/restarted and no database migrations/resets were run. Full workspace validation is delegated to current-head GitHub CI; no claim of a fully green pipeline before it completes.

Runtime Retry follow-up: two failing click regressions reproduced the reload-only behavior. The new path invokes the existing restart control, retains old errors until a new generation becomes ready, and surfaces denied recovery. Banner tests 33/33 and runtime action/state tests 48/48 pass. Browser QA remains required; no live runtime was restarted during tests.

Preview publication: source c2d896060, workflow ref main, run41643337626. The prior source9c9c64d preview published successfully; use final-source URLs for Retry verification.

Credential-verification follow-up: the operator requires real read-only connection/authentication checks before setup mutates a database. PostgreSQL SELECT1, authenticated Redis PING for every configured URL, and a protected Meilisearch API read must succeed; invalid configuration stops with service-specific errors that never expose credentials. Verify disposable targets only.


Final continuation evidence: 653 combined dev-runtime/starter/standalone script tests pass on Node 24.22.2, including 15 credential-verifier cases and 19 standalone script-boundary cases. Template-sync, syntax, whitespace and mirrored-source parity pass. Disposable pgvector/PostgreSQL, password-protected Redis (two consumers/databases), and Meilisearch prove valid connections and sanitized authentication failures for each service. A missing selected database verifies through /postgres with SELECT1 and remains absent afterward; no CREATE DATABASE or initialization was executed. Native macOS listener PID discovery also passed on a disposable listener. No user's existing services were changed.

The requested om-auto-review-pr --autofix pass reviewed the full PR and fixed pre-existing-unhealthy-service consent ordering, effective database-name preview, missing-database compatibility, Redis error-event classification and Meilisearch protected-response validation/cleanup. Monorepo reinstall lines match the main branch; standalone reset remains explicit. No actionable code findings remain after root re-review. Validation source for the full configured gate is current-head GitHub checks under the repository-local review extension; CI and manual browser QA remain merge gates. The focused local results do not claim a full workspace gate pass. Native author self-approval is unavailable, so the automated assessment is recorded as a COMMENT review.

Full-gate follow-up: the operator explicitly requested execution of every configured workspace command for this re-review, superseding the checks-first local optimization. The isolated checkout receives physical dependency copies so build and generator resolution cannot mutate the primary checkout. Do not approve until the required local gate succeeds; current GitHub CI and manual QA remain separate merge gates.


Full-gate completion: all eight configured commands passed locally with Node 24.22.2 on source 728b93806. Builds/generation/i18n/typecheck passed, yarn test passed all 51 Turbo tasks (including 319 UI suites, 113 CLI suites, 2668 core suites/26823 core tests, and 1020 create-app cases with 6 skips), and the app build passed in 141.6 seconds. This is actual execution, not substituted CI evidence.

CI then exposed a merge-ref-only test fixture mismatch: current main calls purgeGreenfieldCaches, while the initialization VM harness only stubbed its previous helper name. Reproduced 12 failures against fetched main; a537df464 adds the cache-ready stub returning true without changing runtime/cache behavior or any reset assertion. The suite passes 20/20 on the branch and 20/20 against current main after the fix. The current-head GitHub test rerun remains pending and still gates merge. The broader local CI script command encountered 15 Mac tooling failures (11 Compose plugin-discovery cases and 4 GNU-timeout-dependent npm tests); all 11 Compose cases pass when pointed at the installed standalone Compose binary. GNU timeout is unavailable locally, so those additional checks are not claimed green. No further system/tooling changes were made.

A supplied fresh-microVM report at 728b938 confirms full monorepo and standalone first-run setup/login/demo data with no LLM key. It is additional attributed evidence, not a substitute for manual browser QA of Retry/CSP or current-head checks. Related PR 8613 adds service mode choices and shares the verified connection helper.
