# Authenticated RLS concurrency analysis

Status: **LIVE PASS — 2026-11-13**. Corrected native execution passed every level and all 2,000 request assertions. The enclosing native command exited 0; its shutdown separately logged Next.js exit 143 after the successful test and fixture teardown. This verifies the tested build only; remaining full-spec gates are tracked in PLAN.md.

Executable coverage: `src/modules/tenant_boundaries/__integration__/TC-RLS-002-concurrency.spec.ts`, using the existing unchanged `helpers/liveRuntime.ts`. Fixtures persist 100 distinct staff users, sessions and `customers.*` ACLs (50 users per fixture tenant), signed with the shared staff JWT helper. Each level selects 20, 30, 50 or 100 distinct users, balanced across both tenants. These are real authenticated people API requests against the restricted secondary Next application, not a mocked route or connection-only probe.

Each level releases ten barrier-synchronized HTTP waves: retained own GET, retained foreign GET, rejected foreign PUT/DELETE, own POST, created-record GET, own PUT, updated-record GET, own DELETE and deleted-record GET. Every actor creates a fresh isolated person at each level (200 total fixtures). Creates must return 201 and a UUID; own writes must succeed and the privileged database oracle must confirm the exact tenant, organization, display name and live/deleted state. Created and updated GETs must return exactly that ID and display name; the final GET must return no items and the oracle must confirm physical removal of both entity and profile, matching the existing customers command. Missing create IDs fail dependent samples before sending any unscoped request. Foreign writes must return 403 or 404; validation errors, conflicts, authentication failures and server errors do not count as denial success.

The two retained foreign-write sentinel customer records are never targeted by successful mutations. Their tenant, organization, name, version and deletion timestamp are compared against the pre-load baseline after every level. Cleanup removes people profiles and non-sentinel customer entities from the two disposable fixture tenants, including records created before a failed/lost API response, plus staff/session/ACL fixtures; runtime cleanup owns the original sentinel entities and tenants. All HTTP contexts close before fixture cleanup. Cleanup failures propagate.
## Running and collecting actual evidence

Use the repository's **native disposable integration runner**, with enterprise modules enabled. Do not point this test at a developer or production database. The runtime requires `OM_INTEGRATION_TEST`, native `DATABASE_URL` and `JWT_SECRET` privately from that runner. Run only after the parent's build/generation gate has completed. Select `TC-RLS-002-concurrency` with one Playwright worker, retries zero, and a command-level Playwright timeout of 600000 ms (the shared default of 20000 ms is insufficient for this load). Bound the enclosing process as well. Do not print environment credentials.

For every completed level Playwright `testInfo.attach` writes `rls-concurrency-20.json`, `rls-concurrency-30.json`, `rls-concurrency-50.json` and `rls-concurrency-100.json`. Schema fields are `concurrency`, `distinctUsers`, `tenants`, `peakInFlight`, `elapsedMs`, `p50Ms`, `p95Ms`, `errors`, `isolationViolations`, `retainedRowsUnchanged`, and `samples`. Each sample contains a level-local numeric user index, operation, HTTP status (null on transport failure), full response-body latency and validity. No JWT, URL credentials or response body is attached.

The final `rls-concurrency-analysis.md` attachment is generated from actual completed-level results, including failed assertions, and is the durable Markdown result artifact to publish beside the JSON attachments. An empty table means no level completed; missing levels never imply success. Publish the native runner outcome and cleanup failures alongside those attachments. Replace this pending status only after executing and reviewing those artifacts, recording the exact command and environment. Failed/aborted setup is not a passing isolation result.

## Interpretation and remaining limits

`DB_POOL_MAX=1` is inherited from the restricted runtime. Peak HTTP overlap is measured on the client and proves outstanding requests, not simultaneous database execution or backend arrival. PostgreSQL serializes the protected work through one runtime connection; queued reuse is intentional. p50/p95 cover all ten operations per level and include HTTP overhead, pool wait, auth and application work. Privileged persisted-row verification is excluded from request latency and in-flight HTTP counts, but included in level elapsed time. The unchanged runtime subprocess has its own 300-second lifetime bound, so a slow live run can fail before the 600-second test ceiling. Unexpected statuses, malformed responses, timeouts and transport errors increment errors. Invalid successful read responses or accepted foreign writes increment isolation violations; retained-row mismatch independently fails the level.

This test covers authenticated own/foreign reads, successful own create/update/delete with read-back, and forbidden foreign update/delete. It does not establish off/on overhead, checkout counts, server-side pool wait, multi-connection SQL overlap, browser behavior, global table enrollment or detached invocation cleanup. Those remain separate acceptance coverage in the enterprise RLS spec. No production business implementation or central domain import is introduced.

Expected sample counts are 200/300/500/1000 at 20/30/50/100 users (2000 total); these match the measured results below. Each completed level asserts its own count. The prior live 800-request read/foreign-denial pass does not validate these added mutations.

## Authoring checks (not live execution)

- `OM_ENABLE_ENTERPRISE_MODULES=true OM_INTEGRATION_MODULES=tenant_boundaries timeout 120 /Users/piotrkarwatka/Projects/mercato-development/node_modules/.bin/playwright test --config .ai/qa/tests/playwright.config.ts TC-RLS-002-concurrency --list --reporter=list` — exit 0, `Total: 1 test in 1 file`.
- `timeout 120 /Users/piotrkarwatka/Projects/mercato-development/node_modules/.bin/tsc -p /tmp/rls-own-tsconfig.json` — exit 0, no diagnostics. Temporary config extends this checkout's `tsconfig.base.json`, selects the concurrency spec/helper, disables incremental/emission, and maps `@open-mercato/shared/lib/db/runtime` to this checkout's source. Without that mapping, the installed workspace export produced three TS2307 diagnostics in existing runtime imports. No dependencies were installed or built.
- `git diff --check` — exit 0. Runner: local existing dependencies; no Docker, native live runner, generation or full validation gate executed.

## First expanded execution (2026-11-13)

The native disposable run at b4ddb4a9d1 executed 200/300/500/1000 requests. Each level passed the first eight operation waves, foreign-write denial and retained sentinel checks. The final two waves failed because the test incorrectly required a soft-deleted entity although the existing command physically deletes the entity and profile. The oracle now requires both rows absent; the corrected run passed as recorded below. The failure counters were 40/60/100/200, including 20/30/50/100 incorrectly classified own-read oracle failures as isolation violations. These counters do not establish a foreign data leak. Factual PR update: https://github.com/open-mercato/open-mercato/pull/9424#issuecomment-6857158501. Raw failed-run attachments are retained in the cockpit Assets directory.


## Corrected live execution (2026-11-13)

Source doc: [.ai/specs/enterprise/2026-11-12-row-level-security.md](../../../../.ai/specs/enterprise/2026-11-12-row-level-security.md).

Command: `timeout 1200 env OM_ENABLE_ENTERPRISE_MODULES=true yarn mercato test:integration TC-RLS-002 --verbose --no-reuse-env`, local Node24.22.3, TMPDIR=/tmp, native disposable PostgreSQL and production Next. Test: 1 passed, 2.5 minutes including fixture server startup; assertions ran in39.3 seconds.

# Authenticated RLS concurrency — actual execution
Recorded: 2026-11-13T15:27:42.322Z
Real /api/customers/people requests; 100 persisted non-superadmin staff users split evenly across two disposable tenants. Restricted runtime DB_POOL_MAX=1; simultaneous HTTP requests queue for database access. This is not an adapter off/on benchmark or proof of simultaneous SQL execution.
| Users | Peak HTTP | Requests | p50 ms | p95 ms | Errors | Isolation violations | Rows unchanged |
|---:|---:|---:|---:|---:|---:|---:|---|
| 20 | 20 | 200 | 307.84 | 1107.48 | 0 | 0 | true |
| 30 | 30 | 300 | 443.06 | 1012.60 | 0 | 0 | true |
| 50 | 50 | 500 | 685.36 | 1528.33 | 0 | 0 | true |
| 100 | 100 | 1000 | 1440.26 | 3450.57 | 0 | 0 | true |
Latency covers the full HTTP response body; privileged persisted-row verification is excluded. Errors include unexpected status, malformed response, timeout and transport failure. Isolation violations count foreign-read contents, unexpected record IDs in own reads or accepted foreign writes; own deletion/name oracle failures count as errors. No tokens, database URLs or request bodies are included.

The command completed with exit 0. Native shutdown logged Next production exit143 after Playwright success; this is recorded separately from assertion and fixture cleanup. Raw JSON artifacts are published with the PR verification comment. This is not full-spec or production security approval.
