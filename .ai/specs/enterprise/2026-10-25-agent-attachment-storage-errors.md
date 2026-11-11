# Agent attachment storage error integration

Issue: #7941. Companion: `.ai/specs/2026-10-01-attachment-storage-validation.md`.

## Behavior

Attachment staging propagates `AttachmentStorageConfigurationError` without replacing its type. The OpenCode runner records a failed run with the stable storage code and redacted reason, then rethrows the original error. Its existing `finally` releases the workspace lease, disposes the session and revokes the per-run API key. No model request is sent after staging rejection.

Staging reads through the public `attachmentService.readScoped` boundary using the run's authenticated subject. Existing tenant, organization and owner policies apply before storage reads, workspace writes or model dispatch. Missing identity, service wiring or a required owner-policy provider fails closed.

Agent run and rerun HTTP endpoints map this typed error to the shared localized attachment-storage 503 body. The workflow invocation job keeps its existing terminal/error-outcome behavior, recording only the stable code and reason for a typed storage failure. It does not retry a configuration problem as a capacity rejection.

## Migration & Backward Compatibility

Legacy remains the default. No entity, migration, status, route, ACL, provider policy or execution lifecycle changes. Callers staging nonempty attachment inputs must supply the authenticated execution subject. Generic staging failures retain their failure classification while redacting internal exception details. Provider configuration remains owned by each provider package. Other independent agent input/output consumers remain responsible for their own storage error boundary.

## Integration Coverage

Self-contained `opencode-runner` tests exercise real staging/factory resolution for missing partitions, unknown drivers and malformed configuration. They assert the typed rejection, safe persisted failure, no model dispatch and workspace/token cleanup. Actual run/rerun handler tests cover redacted localized 503 responses; workflow job tests cover the safe terminal failure. These fixtures do not claim a running database or live LLM test.

`attachment-staging-access` tests execute the real attachment service and Documents owner resolver with mocked database, storage and model I/O. They cover denied primary/assignment owners, missing providers and actor identity, foreign scopes, allowed owners/shares, safe failures and cleanup before any unauthorized bytes reach the workspace or model.

## Changelog

- 2026-11-03: Enforce existing owner access through authenticated service reads before staging; preserve typed storage failures and redact unexpected details.
- 2026-10-25: Implement the independent agent attachment caller coverage from #7941.
