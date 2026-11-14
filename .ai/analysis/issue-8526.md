# Issue 8526 — telemetry pg probe lifecycle

Summary: The PostgreSQL instrumentation child can await a query forever after a failed connection.

Root cause: `pg` connection failure rejects `connect()` without clearing queryability. Socket close drains existing queries once. If socket close precedes the later `query()`, that query is enqueued after the last drain and never settles. Reproduced under Node 24.19.0 by awaiting the client end event before the existing query: last diagnostic stage query, exit 13 with unsettled top-level await. Normal ordering produces actual pg.query spans. CI has no phase diagnostics and times out before SPANS; its exact event order is unavailable, but the race is deterministic locally.

Files to change:
- packages/telemetry/src/__tests__/pg-instrumentation.test.ts — explicitly close failed client, cover both event orderings, capture safe lifecycle stages, require clean child exit and SDK shutdown.

Approach: Preserve default provider instrumentations and the actual bound-parameter query. Close the failed client before querying so pg rejects through its real instrumented query path regardless of socket timing. Disable unrelated test log/metric exporters via existing seams, remove arbitrary delay/forced exit, and verify normal SDK shutdown. Test socket-end ordering fails without explicit close.

Risks: Test-only lifecycle correction; no runtime API/schema/instrumentation config changes. Hosted full-suite confirmation remains CI evidence, distinct from repeated local passes.

## Execution plan
- [x] Read guidance, check concurrency, identify blocked stage.
- [x] Implement and repeat targeted regression tests with original query-span/redaction assertions.
- [x] Attempt ordered validation and record the failures and limits below. PR publication, review, and claim release are tracked in the tracker run report.

## Regression evidence

- Node 24.19.0: `yarn workspace @open-mercato/telemetry test --runInBand pg-instrumentation` passes 10/10 consecutive invocations (both cases each time).
- Node 24.19.0: `yarn workspace @open-mercato/telemetry test` passes 3/3 consecutive invocations, 21 suites / 165 tests each.
- Mutation check: remove the explicit pre-query `client.end()` and run `yarn workspace @open-mercato/telemetry test --runInBand pg-instrumentation -t socket-ended`: fails at `STAGE=query`, exit 13, unsettled top-level await. Restore close: both cases pass.
- `processor.forceFlush()` replaces the arbitrary 250 ms delay; in-memory exports can await resource detection, so reading immediately without flushing is premature.
- Client and SDK cleanup replace `process.exit(0)`; parent rejects timeout, nonzero exit, or signal even if SPANS appeared.
- Missing build output now fails instead of silently skipping coverage.

## Repository validation (local runner)

The configured ordered gate was attempted. Both `yarn build:packages` executions, `yarn generate`, `yarn typecheck`, scoped telemetry typecheck, and template parity passed. The cockpit's long temporary-directory path initially prevents `tsx` from binding its Unix socket (`listen EINVAL`); `TMPDIR=/tmp` resolves that environment failure for translation sync and template parity.

With the short temporary path, `yarn i18n:check-sync` passes, while `yarn i18n:check-usage` reaches the 300-second process bound without a result. `yarn test` exits 1 at `packages/cli/src/lib/generators/__tests__/agent-files-extension.test.ts:609`: the no-output-root case expected a warning, but recorded zero calls. This lies outside the changed telemetry files; no baseline waiver or complete-suite pass is claimed. `yarn build:app` passes (203.6 seconds). Hosted full-suite evidence and PR review are recorded in the PR/run report.
