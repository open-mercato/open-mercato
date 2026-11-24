# Scoped resource administration and bounded execution

Status: in implementation.

Existing staff and integration actions use their authenticated tenant, organization, and permission scope. Explicit organization IDs in scoped API payloads must be authorized. A document number uses the permission check for the organization where it will be generated. Authenticated warehouse commands use the same scope checks when preparing, applying, and undoing assignments.

An organization administrator can manage attachment partitions owned by that organization and view correctly scoped shared partitions. Shared partitions are maintained by platform administrators. A staff invitation resolves all of its roles within its tenant and organization before issuing the token. A role marked unavailable for ordinary delegation requires the staff role-management feature. Acceptance also requires a currently authorized staff inviter for each such invitation.

Batched analytics uses the single-widget request interceptors for each widget. Interceptors can refine the requested entity's filters. The entity remains fixed throughout the interceptor pipeline. Grouped output is capped at 100 buckets on both aggregation paths, with lower explicit limits supported.

MCP requests use the API key's ACL. A session selects a different principal only for the authenticated server credential explicitly configured for delegation. An ephemeral session key can select its own session. The request header and tool argument must agree when both are present. Internal ephemeral keys are excluded from the administrative key listing. Direct Code Mode search uses the authenticated tool budget and a bounded number of concurrent isolate executions.

System dictionary administrators can edit display metadata and entries. System keys, disablement, and deletion are protected. Export filenames use filesystem-safe subject labels. Shared vector index dimension changes are an operator migration, and a request to use the current dimension remains supported.

## Migration & Backward Compatibility

Valid request and response shapes remain stable. Clients and integrations must target authorized organizations and use a session-bound key or the configured MCP service for session delegation. Update widgets designed for more than 100 buckets to use an explicit aggregation, filter, or paginated workflow. Administrators should schedule and provision a replacement vector index for a new dimension before switching to it.

An explicitly denied organization still prevents every write. Record mutations carrying an `id` preserve the existing not-found response for both existing and absent out-of-scope records; creation payloads without an `id` return forbidden. This preserves the record-existence boundary without adding a database lookup.

## Verification

Use the partition and invitation route suites for organization and grant checks, the scoped payload and document numbering suites for rejected cross-scope writes, the warehouse command suite for direct dispatch, and the single and batch analytics suites for interceptor behavior and group caps. MCP HTTP listing and call suites cover configured delegation, and the driver test verifies that resizing leaves DDL out of the runtime path. Browser QA should verify the administrative and widget paths with restricted and unrestricted users.

## Changelog

- 2026-11-24 — Define scope, delegation, and resource-limit behavior.
- 2026-11-24 — Preserve not-found responses for denied record mutations while retaining forbidden responses for denied creation destinations.
