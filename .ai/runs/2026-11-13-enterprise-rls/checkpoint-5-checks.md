# Checkpoint 5 — production continuations and independent pools

Runner: local Node 24.22.3, TMPDIR=/tmp; bounded commands. PR #9424 remains draft.

- Native authenticated concurrency: 20/30/50/100 persisted distinct users, 2,000 HTTP operations including own CRUD and rejected foreign writes. Zero errors or observed isolation violations; physical-row and unchanged-sentinel oracles pass. Raw per-level evidence and analysis published in PR comment 6857454070. This is not an off/on overhead benchmark.
- Migration/storage lifecycle: package build 42/42; real disposable PostgreSQL 17 harness passes 16 runtime and 26 catalog/transport checks, zero skips. Includes advisory-lock transactional provisioning/reconciliation, rollback/re-enable, restricted NOTIFY/LISTEN, application SQL rejection and stale transport leases.
- Onboarding: merged 0b277cd804; parent reran 151 tests. Canonical persisted workspace binding now uses the neutral owner declaration rather than new business-module lookups.
- CLI/setup boundaries: 82 CLI, 30 shared, 19 auth setup tests pass; shared/CLI typechecks pass. Owner-local command access and fresh tenant setup containers. Live CLI acceptance remains required.
- Search: reviewed and merged bd37d270a4. Parent reran 6 suites/73 tests and search typecheck successfully. Active runtime validates storage with SELECT only; privileged provisioning is owner-local. Actual pgvector SQL compatibility remains unverified.
- Scheduler: reviewed and merged deaa13f99a. Parent reran 33 suites/572 tests and 9 supervisor tests successfully. Persisted schedule identity precedes fresh tenant containers; discovery/probe uses maintenance. Actual live DB/Redis acceptance and remaining owner-specific global job declarations remain required.

No full-spec, security, or merge approval is claimed. Remaining: owner-local global workers/events, live CLI/job/API coverage, People UI screenshots/conflict, paired overhead benchmark, ordered full repository/integration/create-app gates, independent reviews and conflict-resolving subagent.
