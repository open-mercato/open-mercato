# Await module resource-usage snapshot I/O in tests

## Overview

`packages/shared/src/lib/modules/__tests__/resource-usage.test.ts` fails intermittently on CI with `ENOTEMPTY, Directory not empty` from `fs.rmSync(tempDir)` in `afterEach` (seen on open-mercato/open-mercato#7334, run 40358030721). `getModuleResourceUsageReport()` forces a fire-and-forget snapshot write (`writeSnapshotFileAsync`: mkdir, temp file, rename) and fire-and-forget prunes of stale snapshot files. The snapshot tests return while that I/O is still in flight, so cleanup can race a temp file being created inside the directory it is deleting.

## Goal

Make the resource-usage snapshot tests deterministic by letting them await the module's in-flight snapshot file I/O before asserting and cleaning up.

## Scope

- Track in-flight snapshot writes and stale-snapshot prunes in `packages/shared/src/lib/modules/resource-usage.ts`.
- Export an additive `waitForModuleResourceUsageSnapshotWrites()` that resolves once that I/O settles.
- Await it in the test file's `afterEach`, and replace the two snapshot tests' polling loops with it.
- Add a regression test proving the helper waits for the snapshot write.

## Non-goals

- No change to when or how snapshots are written, throttled, pruned or read; the hot path stays fire-and-forget.
- No change to existing exports or the snapshot file format.
- No retries or timeouts added to test cleanup.

## Implementation Plan

### Phase 1: Awaitable snapshot I/O

- Register each snapshot write and stale-file prune promise in a module-level set, removed when it settles.
- Export `waitForModuleResourceUsageSnapshotWrites()`.
- Use it in the tests and add the regression test.

### Phase 2: Verification

- Stress-run the test file and run the configured validation gate.

## Risks

- The helper is a new public export of `@open-mercato/shared` (BACKWARD_COMPATIBILITY.md § 3 Function Signatures, STABLE: a new export is an allowed additive change). Callers that never invoke it see no behavior change.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Awaitable snapshot I/O

- [x] 1.1 Track in-flight snapshot I/O and export a wait helper — squashed
- [x] 1.2 Await snapshot I/O in the resource-usage tests — squashed

### Phase 2: Verification

- [x] 2.1 Stress-run the tests and run the validation gate — squashed
