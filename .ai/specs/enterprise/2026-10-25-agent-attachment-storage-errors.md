# Agent attachment storage error integration

Issue: #7941. Companion: `.ai/specs/2026-10-01-attachment-storage-validation.md`.

## Behavior

Attachment staging propagates `AttachmentStorageConfigurationError` without replacing its type. The OpenCode runner records a failed run with the stable storage code and redacted reason, then rethrows the original error. Its existing `finally` releases the workspace lease, disposes the session and revokes the per-run API key. No model request is sent after staging rejection.

Agent run and rerun HTTP endpoints map this typed error to the shared localized attachment-storage 503 body. The workflow invocation job keeps its existing terminal/error-outcome behavior, recording only the stable code and reason for a typed storage failure. It does not retry a configuration problem as a capacity rejection.

## Migration & Backward Compatibility

Legacy remains the default. No entity, migration, status, route, ACL, provider policy or execution lifecycle changes. Generic staging failures retain their existing error behavior. Provider configuration remains owned by each provider package. Other independent agent input/output consumers remain responsible for their own storage error boundary.

## Integration Coverage

Self-contained `opencode-runner` tests exercise real staging/factory resolution for missing partitions, unknown drivers and malformed configuration. They assert the typed rejection, safe persisted failure, no model dispatch and workspace/token cleanup. Actual run/rerun handler tests cover redacted localized 503 responses; workflow job tests cover the safe terminal failure. These fixtures do not claim a running database or live LLM test.

## Changelog

- 2026-10-25: Implement the independent agent attachment caller coverage from #7941.
