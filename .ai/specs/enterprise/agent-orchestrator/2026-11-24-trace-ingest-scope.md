# Agent trace ingest scope

## Summary

Authenticate each trace request for a tenant and organization, and verify workflow references against the persisted agent invocation.

## Design

- The verifier uses the two scope headers to select the same scoped signing key as the adapter. It validates both identifiers and retains Standard Webhooks body verification and timestamp tolerance.
- The ingest command checks the organization belongs to the signed tenant and validates the agent and workflow link on the existing run selected by the upsert before writing. A linked run must have a server-recorded invocation and a step execution in the same workflow instance, tenant, and organization. The optional workflow executor dependency is required only for linked traces.
- Confidence stays within zero to one and reported cost is bounded. Signed standalone trace ingestion and its idempotency remain supported.

## Migration & Backward Compatibility

The endpoint and Standard Webhooks payload shape remain stable. Key issuance and client-side signing move from a tenant key to a tenant and organization key as an emergency security exception. Accepting the old tenant key would preserve the old authorization behavior, so the release has a coordinated cutover. Operators pause delivery, provision scoped keys to adapters, finish the server and adapter rollout, and re-sign queued requests. Workflow-linked traces use the server-created run identity and independent trace adapters leave the workflow reference absent. No database migration is needed. See the [upgrade notes](../../../../UPGRADE_NOTES.md#agent-trace-ingest-signing-and-workflow-references).

## Verification

Auth and route tests verify signed request handling and rejection of a mismatched organization key. Command and workflow executor tests cover standalone traces, trusted run binding, missing workflow dependencies, and scoped step lookup. Existing trace integration fixtures use the new signer.

## Changelog

- 2026-11-24 — Bound trace signatures and workflow references to the authenticated scope.
