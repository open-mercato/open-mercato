# Release Notes

## Unreleased

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
