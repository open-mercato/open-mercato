# Scoped resource administration and bounded execution

Status: in implementation.

Existing staff and integration actions use their authenticated tenant, organization, and permission scope. Explicit organization IDs in scoped API payloads must be authorized. A document number uses the permission check for the organization where it will be generated. Authenticated warehouse commands use the same scope checks when preparing, applying, and undoing assignments.

Organization options, tree, and management views use the actor's organization grant. Hierarchy labels and paths are built from the visible organizations before response filters are applied. An organization administrator can manage attachment partitions owned by that organization and view shared partitions. Partition codes are unique per owner. A shared partition reserves its code for the organizations that can use it. Storage, access checks, and background jobs resolve a partition using the attachment's own scope. Shared partitions are maintained by platform administrators. A staff invitation resolves all of its roles within its tenant and organization before issuing the token. A role marked unavailable for ordinary delegation requires the staff role-management feature. For those invitations, acceptance locks and reads the inviter's current staff authorization within the transaction.

Batched analytics uses the single-widget request interceptors for each widget. Interceptors can refine the requested entity's filters. The entity remains fixed throughout the interceptor pipeline. Grouped requests without an explicit limit return up to 100 buckets, or 366 when grouping the date range's own field by a calendar interval. When an implicit cap is exceeded, the response carries the full aggregate and `metadata.truncated`. Explicit limits retain the top-bucket semantics.

MCP requests use the API key's ACL. A session selects a different principal only for the authenticated server credential explicitly configured for delegation. An ephemeral session key can select its own session. The request header and tool argument must agree when both are present. Internal ephemeral keys are excluded from the administrative key listing. Direct Code Mode search uses the authenticated tool budget and a bounded number of concurrent isolate executions.

System dictionary administrators can edit display metadata and entries. System keys, disablement, and deletion are protected. Export filenames use filesystem-safe subject labels. Shared vector index dimension changes are an operator migration, and a request to use the current dimension remains supported.

## Migration & Backward Compatibility

Existing request and response fields retain their shapes. Clients and integrations must target authorized organizations and use a session-bound key or the configured MCP service for session delegation. Consumers can check `metadata.truncated` before rendering a grouped series and narrow the query if they need every bucket. Operators should pause attachment writes, verify existing references, apply the partition index migration, and upgrade partition readers together. The migration stops before changing the index if any existing attachment points at a partition unavailable to its owner. Compatible references remain valid. Operators rehome incompatible references and verify the files using the steps in [Upgrade Notes](../../UPGRADE_NOTES.md#organization-and-attachment-partition-ownership). Integrations that look up partitions by code must include the attachment owner scope. To roll back, resolve duplicate codes across owners before restoring global uniqueness. Administrators should schedule and provision a replacement vector index for a new dimension before switching to it.

An explicitly denied organization still prevents every write. Record mutations carrying an `id` preserve the existing not-found response for both existing and absent out-of-scope records; creation payloads without an `id` return forbidden. This preserves the record-existence boundary without adding a database lookup.

## Verification

Use the partition and invitation route suites for organization and grant checks, the scoped payload and document numbering suites for rejected cross-scope writes, the warehouse command suite for direct dispatch, and the single and batch analytics suites for interceptor behavior and group caps. MCP HTTP listing and call suites cover configured delegation, and the driver test verifies that resizing leaves DDL out of the runtime path. Browser QA should verify the administrative and widget paths with restricted and unrestricted users.

## Changelog

- 2026-11-24 — Define scope, delegation, and resource-limit behavior.
- 2026-11-24 — Preserve not-found responses for denied record mutations while retaining forbidden responses for denied creation destinations.
- 2026-11-26 — Align organization reads with organization grants, scope partition namespaces, and preserve analytics totals and daily series.
- 2026-11-27 — Check attachment partition reachability before replacing the uniqueness constraint, recheck inviter grants inside acceptance, and preserve visible hierarchy when filtering options.
