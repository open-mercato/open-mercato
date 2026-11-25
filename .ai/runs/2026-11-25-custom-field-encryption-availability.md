# Encrypted custom field write availability

## Goal

Reject tenant-scoped encrypted custom field writes when the data encryption key cannot be obtained.

## Scope

Custom field encryption and persistence tests, with operator-facing failure and recovery guidance.

## Implementation plan

Reuse the existing key resolution and error mapping. Cover missing keys, unhealthy key services, rollback, and key recovery. Review the upgrade impact of rejecting writes that previously completed during an outage.

## Risks

Requests writing encrypted custom fields can return a retryable error during a key-service outage. Deployments must restore access to their encryption keys before retrying.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Encrypted writes

- [ ] 1.1 Reject encrypted custom field writes when a tenant key is unavailable
- [ ] 1.2 Verify rejection, recovery, and rollback
