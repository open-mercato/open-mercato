# PLAN — TC-UNDO-001 Undo/Redo verification across all undoable commands (#2468)

**Branch:** `qa/2468-undo-redo-verification` (off `origin/develop`)
**Issue:** https://github.com/open-mercato/open-mercato/issues/2468
**Spec:** `.ai/qa/scenarios/TC-UNDO-001-undo-redo-all-commands.md`
**Run folder:** `.ai/runs/2026-06-04-2468-undo-redo-verification/`

## Approach (decided autonomously — user away)

Verify against the **real app via the ephemeral integration harness** (`yarn test:integration:ephemeral`),
which boots real Next.js + real Postgres + the real command bus that the UI undo surfaces use.
Per command/entity, drive the real API:

1. CREATE fixture (capture `undo_token` from `x-om-operation` response header), read entity state.
2. UPDATE (capture token), read state.
3. UNDO via `POST /api/audit_logs/audit-logs/actions/undo {undoToken}` → assert pre-state restored (I1–I4).
4. REDO via `POST /api/audit_logs/audit-logs/actions/redo {logId}` → assert post-state reproduced (I6).
5. DELETE → UNDO → assert re-materialized (I2).
6. Negative: double-undo (I5/X5), latest-only (X4), non-undoable commands expose no token (I9).

This exercises the exact same command bus + undo/redo endpoints the banner/Version-History UI uses,
and the spec's own "next stage" is exactly these per-module integration tests — so the deliverable
doubles as the regression suite.

Reusable helper: `packages/core/src/helpers/integration/undoHarness.ts`
- `extractUndoToken(response)` — parse `x-om-operation` header.
- `runUndoRedoCycle(request, token, {create, read, fields})` — create→undo→redo→assert.

## Failure protocol

For each FAIL: file a GitHub issue (`bug` + `priority-high`, data-integrity) with: command id, entity,
field(s) that did not restore, repro steps, root cause (dive into the command's `undo()` /
snapshot code), and a concrete fix sketch. Link each filed issue back to #2468.

## Progress checklist (per spec §3 / §4 / §5)

Status: `[ ]` todo · `[~]` in progress · `[x]` verified-pass · `[!]` failed→bug filed · `[-]` skipped/blocked

### Harness
- [x] H1 ephemeral app booted + auth smoke (admin@acme.com) — base http://127.0.0.1:46203
- [x] H2 undoHarness.ts helper written + self-test (customers.people create/delete verified)

### §3.1 customers
- [~] people create [x] / delete [x] verified-pass; **update [!] BUG #2498** (undo silent no-op); redo-of-create [!] finding (new id, see PR notes). addresses/comments/activities/todos/interactions/cf still TODO
- [x] companies create/update/delete — update→undo verified RESTORED=true (smoke); full relations/cf TODO
- [ ] deals create/update/delete
- [ ] addresses create/update/delete
- [ ] comments create/update/delete
- [ ] activities create/update/delete
- [ ] interactions create/update/delete
- [ ] interactions.complete / cancel
- [ ] personCompanyLinks create/update/delete
- [ ] tags create/update/delete + assign/unassign
- [ ] labels create + assign/unassign
- [ ] todos create + unlink
- [ ] dictionaryEntries create/update/delete
- [ ] dictionaryKindSettings.upsert
- [ ] entityRoles create/update/delete

### §3.2 auth
- [ ] users create/update/delete (+ roles, custom fields)
- [ ] roles create/update/delete (+ features)

### §3.3 catalog
- [ ] products / variants / categories / offers / prices / priceKinds / optionSchemas / productUnitConversions

### §3.4 sales
- [ ] channels / shipping-methods / payment-methods / delivery-windows / tax-rates / notes / payments / shipments / document-addresses / tags

### §3.5 staff
- [ ] team-members (+tags) / teams / team-roles / activities / addresses / comments / job-histories / leave-requests (+accept/reject) / timesheets (time_entries, time_projects, project_members)

### §3.6 resources
- [ ] resources / resource-types / activities / comments / resourceTags (+assign/unassign)

### §3.7 planner
- [ ] availability / availability.weekly.replace / availability.date-specific.replace / availability-rule-sets

### §3.8 currencies
- [ ] currencies / exchange_rates

### §3.9 directory
- [ ] organizations (incl. reparent; org rows log null organization_id — ref #2398)

### §3.10 feature_toggles
- [ ] global create/update/delete

### §3.11 scheduler
- [ ] jobs create/update/delete

### §3.12 checkout
- [ ] template / link create/update/delete

### §4 negative (NO undo affordance)
- [ ] customers pipelines.*, pipeline-stages.*, settings.save*, interaction.recompute_next
- [ ] dictionaries entries.reorder / set_default
- [ ] directory tenants.*
- [ ] feature_toggles overrides.changeState
- [ ] sales returns.create / settings.save
- [ ] translations save/delete
- [ ] messages (all)
- [ ] communication_channels (all)
- [ ] checkout transaction.create / updateStatus
- [ ] currencies fetch-configs
- [ ] scheduler test.echo
- [ ] enterprise/security (all), enterprise/record_locks conflict.*

### §5 cross-cutting
- [ ] X1 banner undo · X2 version-history undo · X3 redo · X4 latest-only · X5 double-undo
- [ ] X6 permission (no undo_self) · X7 cross-actor · X8 tenant/org isolation
- [ ] X9 bulk undo · X10 cf-heavy · X11 relations · X12 search/index consistency

## Bugs filed
- #2498 — customers.people.update — undo returns {ok:true} but restores nothing (encryption deep-decrypt resets change-tracking before flush; SYSTEMIC class — other commands with mutate→query-related-encrypted→flush under withAtomicFlush at risk)

## Findings (under review, not yet bugs)
- redo-of-create mints a NEW entity id rather than restoring the soft-deleted original → original id stays soft-deleted (orphan), redo does not reproduce after-snapshot id. Affects all `*.create` redo. Needs maintainer decision (design vs bug).
