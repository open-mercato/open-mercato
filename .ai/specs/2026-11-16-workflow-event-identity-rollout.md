# Workflow Event Identity Rollout

Status: In progress. Issue: #9137. PR: #9639.

## TLDR

Event payload actor fields remain workflow data. Event execution uses the existing
definition grant and server-owned trigger marker. Persisted pre-fix instances
with a payload-derived initiator are refused before privileged execution,
including queued activities, queued agent jobs and inherited sub-workflows.

## Overview and Problem Statement

Changing new-instance creation alone leaves old instances and queue messages
able to borrow an event payload user's authority after deployment. Event trigger
creation has already persisted `metadata.labels.trigger_id`; sub-workflows copy
that metadata. This is an existing durable source marker, distinct from the
caller-editable workflow context.

## Proposed Solution and Architecture

`assertTrustedEventTriggerIdentity` rejects an event-labelled instance unless
`metadata.initiatedBy` equals `trigger:${metadata.labels.trigger_id}`. Call it
before workflow execution, synchronous activity dispatch, queued registry dispatch,
queued agent invocation and direct command/API/agent principal resolution.

The guard does not choose a replacement user, borrow the definition author's
roles, rewrite stored identities, widen a grant or mutate a workflow state.
Existing failure handling remains responsible for its normal failure/audit path.
A refusal cannot be repaired by repeatedly retrying the old instance.

## Data Models and API Contracts

No schema, migration, route, payload field, public signature, ACL feature,
configuration key, startup step or execution topology changes. The guard consumes
existing server metadata. Ordinary manually started instances and canonical event
markers keep their existing behavior. Raw event actor fields remain in context.

## Migration & Backward Compatibility

Untrusted event actors were never authenticated authority; retaining their
execution would retain the security issue. No caller can opt into that path.
Legitimate manual initiators and definition grants are preserved. Custom callers
must treat event `userId`/`actorUserId` as data and configure explicit definition
grants rather than delegating the payload actor's permissions.

Operators must stop/drain workflow writers and workers before rolling out the
fixed version, then restart all replicas together; old processes cannot enforce
this guard. Read-only inventory can select non-deleted `workflow_instances` whose
`metadata->'labels'->>'trigger_id'` is nonempty and whose `metadata->>'initiatedBy'`
is distinct from `'trigger:' || (metadata->'labels'->>'trigger_id')`, always within
the tenant and organization being audited. Include inherited sub-workflows.
Cancel affected runs through supported scoped workflow controls, inspect their
past effects/audit trail, then restart needed business operations using a trusted
manual initiator or fresh event with an explicitly configured definition grant.
Do not relabel stored metadata, replay stale queue messages as a user, or edit
workflow status directly. Already executed effects are not undone by this patch.
No production cleanup or database migration is executed by this change.

## Risks & Impact Review

- High: mixed-version workers can still execute unsafe persisted identities.
  Mitigation: coordinated application/worker rollout; no old-replica bridge.
- High: old queued effects may already have run. Mitigation: operator inventory
  and audit; this guard prevents future dispatch, not historical remediation.
- Medium: affected legacy runs stop instead of silently switching principals.
  Mitigation: explicit cancel/restart instructions; no automatic data rewriting.
- Low: custom manually started runs using reserved trigger labels also fail
  closed when inconsistent. Preserve unrelated labels and ordinary manual starts.

## Coverage and Final Compliance Report

Regression tests cover all three trigger sources, persisted retry/resume with a
payload actor, direct command/API/agent identity consumers, queued registry and
queued agent dispatch, absent/mismatched identities, canonical markers and manual
instances. Source and in-memory authorization boundaries execute real handlers;
persistence and external effects are mocked. No live rollout/audit was performed.
Hosted exact-head CI is still required after publication. No QA approval is
inferred from this specification or from tests alone.

## Changelog

- 2026-11-16: Added durable legacy-event guard, retry/worker regression coverage
  and coordinated rollout/cancel-restart guidance for the inherited security finding.
