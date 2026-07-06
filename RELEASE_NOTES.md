# Release Notes

## Unreleased

### Workflows — dedicated `workflow-invoke-agent` queue (contract-adjacent change)

`invoke_agent` workflow jobs are now enqueued to a **new dedicated queue**,
`workflow-invoke-agent`, consumed by the new `workflows:workflow-invoke-agent`
worker (concurrency via `WORKERS_WORKFLOW_INVOKE_AGENT_CONCURRENCY`, default
**5**). Minute-long LLM agent runs no longer share execution slots with fast
workflow activities on the `workflow-activities` queue.

- **Drain bridge (deprecated)**: the `workflow-activities` worker keeps its
  `invoke_agent` branch so jobs enqueued before the cutover deploy drain
  normally. The branch is deprecated and scheduled for removal after one minor
  version per `BACKWARD_COMPATIBILITY.md`.
- **Action for operators** running per-queue workers (`mercato queue worker
  <queue>`): also start a worker for `workflow-invoke-agent`; `worker --all`
  picks it up automatically.

### Workflows — definition versioning (contract-surface change)

The `workflow_definitions` unique constraint is **relaxed** from
`(workflow_id, tenant_id)` to `(workflow_id, version, tenant_id)` so multiple
versions of the same workflow can coexist as separate rows (draft → published
lifecycle). A GIN index is added on `workflow_definitions.definition` to back
sub-workflow caller lookups.

- **Migration**: additive + relaxing. No existing row violates the new
  constraint; Phase-2 backfill defaulted every existing row to
  `lifecycle = 'published'`, `kind = 'workflow'`.
- **Resolution change**: unpinned definition lookups now resolve the latest
  **published** version (`enabled AND lifecycle = 'published'`, version DESC),
  previously "latest enabled". Behaviour is identical for pre-migration data;
  it only diverges once draft/archived rows exist. Version-pinned lookups are
  unchanged.
- **Action for callers relying on `(workflow_id, tenant_id)` uniqueness**: code
  that fetched "the" definition by `workflowId + tenantId` must become
  version-aware (pin a version, or take the latest published). All in-tree
  call sites were updated.

See `.ai/specs/2026-06-26-subworkflow-explicit-ports-schema-builder.md`
(Migration & Compatibility) for the full rationale.
