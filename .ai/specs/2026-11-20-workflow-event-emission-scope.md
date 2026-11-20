# Workflow event emission scope

## TLDR

Workflow authors can emit events whose owning module explicitly allows tenant-authored
payloads. The executor and the checkout and query-index subscribers use server-owned scope.

## Overview and Problem Statement

`EMIT_EVENT` previously treated nearly every event name as a workflow target. Its payload
could supply scope read by checkout and query-index subscribers that perform privileged
work. A workflow author could also invoke privileged subscribers in their own organization.

## Proposed Solution and Architecture

Add optional `workflowEmittable: true` to event declarations. The executor requires an
exact opted-in ID and excludes private coordination and portal events. The activity picker
suggests the same subset. Shipped workflow examples declare their existing event IDs.
The executor stamps both payload and delivery options from the workflow instance and
removes the payload's multi-organization audience.

Gateway and query-index producers pass scope in the existing emit options. Checkout
reads the subscriber's trusted tenant and organization. Query indexing also uses the
additive `eventScope` context field so it can distinguish an absent scope from a trusted
global or tenant-wide reindex. Explicit all-tenant reindex still requires the existing
all-tenant operation flag and tenant scope of null in trusted emit options.

## Data Models and API Contracts

No storage or migration changes. Event declarations and `GET /api/events` gain the
optional `workflowEmittable` field. Event IDs, workflow configuration fields and
existing subscriber context fields retain their shape.

## Migration & Backward Compatibility

Arbitrary tenant-authored event names and payload-supplied authority are intentionally
withdrawn. Preserving either path would retain the security defect. For custom workflows,
declare a dedicated workflow-safe event and review its subscribers before enabling
`workflowEmittable`. Use the owning module's authorized API or command for state changes.

Upgrade application processes and event workers together. Pre-upgrade jobs without
trusted scope will fail closed after the rollout. Reconcile incomplete payments from the
provider's authoritative state and resubmit necessary index work through supported API
or CLI commands. Do not treat historical event payload scope as trusted.

## Risks & Impact Review

- An opt-in authorizes tenant-controlled event data. Module owners must review all
  subscribers for an opted-in event.
- Old processes still apply their old policy. Coordinate the deployment and reconcile
  failed legacy jobs using authoritative state.

## Coverage and Final Compliance Report

- Workflow executor and activity picker tests cover allowed and refused event names.
- TC-WF-071 verifies stamped scope and removes authored organization audiences in an
  asynchronous activity rerun. TC-WF-082 verifies rejection through the workflow
  definition, execution, and event history APIs.
- TC-CHKT-019 and TC-CHKT-043 cover actual gateway webhook delivery to checkout.
  TC-QIDX-5723 covers API reindex through the event worker and into the index projection.
- Subscriber tests exercise checkout command scope and query-index scope, including
  legacy jobs that have no trusted scope. Producer tests cover runtime/API and CLI dispatch.
- The privileged state transitions and index operations retain their existing contracts.

## Changelog

- 2026-11-20: Defined workflow emission permission and trusted subscriber scope for #9134.
