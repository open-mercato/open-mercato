# Execution Plan — Workflows visual editor: inline activity validation (#4232)

**Issue:** https://github.com/open-mercato/open-mercato/issues/4232
**Branch:** cez/7f563a52 → base `develop`
**Owner:** pat-lewczuk

## Goal

Stop the workflow visual editor from silently dropping edits when an activity is
missing a required parameter (e.g. a `CALL_API` activity with no `endpoint`).
Surface **upfront, inline validation with visible error messages at edit time**
so the failure is obvious in the node/transition editor instead of silently
persisting a broken activity that only blows up later at runtime.

## Root cause (confirmed)

- `activityDefinitionSchema.config` is `z.record(z.string(), z.any())` — activity
  config is never validated per activity type. The dedicated `callApiConfigSchema`
  (which requires `endpoint`) exists in `data/validators.ts` but is **dead code**,
  referenced nowhere.
- `NodeEditDialog.handleSave` validates only WAIT timer/signal fields;
  `EdgeEditDialog.handleSave` validates nothing. Both flash "updated successfully"
  and close the dialog regardless of activity completeness.
- Result: a `CALL_API` activity missing `endpoint` passes the dialog and the
  top-level `workflowDefinitionDataSchema` check, "saves", and only fails later in
  `lib/activity-executor.ts` (`CALL_API requires "endpoint" field`).

## Scope decision (why edit-time, not schema tightening)

Tightening the shared `activityDefinitionSchema` to enforce required config would
retroactively invalidate the seeded demo `examples/sales-pipeline-definition.json`,
whose activities pervasively use the wrong field names for the current executor
(`url`≠`endpoint`, `eventType`≠`eventName`, `entity/id/data`≠`commandId/input`,
`function`≠`functionName`) — it is already dead at runtime and some CALL_APIs even
point at external URLs that belong in CALL_WEBHOOK. Fixing that demo is a separate,
semantically-tricky rewrite. So this fix adds **edit-time validation in the
dialogs** (only fires on activities the user is actually editing) plus a reusable
shared validator, without penalizing untouched pre-existing data.

## Non-goals

- Rewriting/repairing `examples/sales-pipeline-definition.json` (separate task).
- Tightening the server/save-time `activityDefinitionSchema` / `workflowDefinitionDataSchema`.
- The `NEXT_PUBLIC_WORKFLOW_CRUDFORM_ENABLED` CrudForm dialog variants (feature-flagged off by default).
- The `JsonBuilder` raw-string swallow in shared `packages/ui` (broader blast radius; the required-field check surfaces the same failure as a missing field).

## Implementation Plan

### Phase 1: Shared activity-config validator
- Add `validateActivityConfig(activityType, config)` to `data/validators.ts`
  returning `{ field?, message }[]`, covering runtime-required fields per type
  (CALL_API→endpoint, CALL_WEBHOOK→url, SEND_EMAIL→to+subject, EMIT_EVENT→eventName,
  UPDATE_ENTITY→commandId+input, EXECUTE_FUNCTION→functionName, WAIT→duration XOR
  until reusing existing helpers). Respect `{{...}}` interpolation. Wire the dead
  `callApiConfigSchema` in where natural so it stops being dead code.
- Unit tests in `data/__tests__/validators.test.ts` (accept valid/interpolated,
  reject missing per type). Fix the existing `SEND_EMAIL`-without-subject fixture
  only if it must stay a schema test (it does not — new fn is separate).

### Phase 2: NodeEditDialog inline validation (automated step activities)
- In `handleSave`, run `validateActivityConfig` over `stepActivities`; on issues,
  set inline errors, auto-expand the offending activity, block close. Render the
  message near the activity config, mirroring the existing WAIT-field pattern.

### Phase 3: EdgeEditDialog inline validation (transition activities)
- Add error state; validate `activities` in `handleSave`; inline messages +
  auto-expand + block close.

### Phase 4: Validation gate + PR finalize
- Run the configured `validation.commands` gate; fix drift; finalize labels + summary.

## Risks

- Behavior change: users editing an activity with missing required config are now
  blocked in the dialog until they fix it. Intended — that is the bug being fixed.
- Low blast radius: no shared schema / server change; dialogs are the default
  (non-CrudForm) editor path.

## Progress

PR: #4474 (https://github.com/open-mercato/open-mercato/pull/4474)

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Shared activity-config validator

- [x] 1.1 Add `validateActivityConfig` shared validator — 18e87ac91
- [x] 1.2 Unit tests for `validateActivityConfig` — 18e87ac91

### Phase 2: NodeEditDialog inline validation

- [x] 2.1 Validate automated step activities in `handleSave` with inline errors — 858107a12

### Phase 3: EdgeEditDialog inline validation

- [x] 3.1 Validate transition activities in `handleSave` with inline errors — 858107a12

### Phase 4: Validation gate + finalize

- [x] 4.1 Run full validation gate green (Runner: local — all 8 commands passed)
- [x] 4.2 Finalize PR (labels, summary, ready)
