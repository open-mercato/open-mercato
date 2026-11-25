# Audit Logs provider for record lock history

Extends: .ai/specs/enterprise/2026-06-09-record-locks-unified-coverage.md

## TLDR

Audit Logs owns the scoped reads that enrich Enterprise Record Locks conflicts. Record Locks owns conflict policy and retains the OSS optimistic-lock floor when Audit Logs is absent.

## Resolved assumptions (autonomous defaults)

Keep the established authorized history selection. Isolate the retrieval workstream from [settings initialization](2026-11-24-record-locks-settings-initialization.md), which runs at tenant setup.

## Overview

This is the audit-history part of workstream 3 of [#10476](https://github.com/open-mercato/open-mercato/issues/10476). Recheck the optional-peer behavior after [#10129](https://github.com/open-mercato/open-mercato/pull/10129). The layered locking spec remains authoritative for the version guard.

## Problem Statement

The target baseline guards missing audit metadata. The Enterprise service still reads the Audit Logs entity for latest history, actor history and a by-ID fallback. This makes the consumer depend on private persistence and decryption. [Latest history](https://github.com/open-mercato/open-mercato/blob/0784f37d75283d3b551e994991d4cf318452977e/packages/enterprise/src/modules/record_locks/lib/recordLockService.ts#L1651-L1713) · [By-ID fallback](https://github.com/open-mercato/open-mercato/blob/0784f37d75283d3b551e994991d4cf318452977e/packages/enterprise/src/modules/record_locks/lib/recordLockService.ts#L1972-L2005)

## Proposed Solution

Expose bounded lookups from the Audit Logs owner and keep audit persistence, DTO normalization and decryption there. Record Locks continues to build conflict summaries. Use the project's existing scoped DI pattern. [Cross-module ownership rules](../../../packages/core/AGENTS.md#cross-module-coupling)

## Architecture

- Extend the Audit Logs server service additively with latest-by-resource, latest-by-actor and by-ID lookups, or expose them through an owner-registered companion when needed for compatibility with existing DI overrides. Accept a required tenant ID and an explicit resource tuple. The actor and row ID are additional filters. Return only the fields used in conflict selection and rendering as an owner DTO, with existing decrypted payload normalization.
- Carry organization selection explicitly. An exact lookup uses the requested and authorized organization, or SQL null for a tenant-level resource. Preserve the latest-by-resource fallback from an exact null lookup only in the existing server-authorized tenant-level path. Represent that case with an explicit query mode and the permitted organization scope carried from the directory/authorization boundary. A missing or unauthorized scope never becomes a wildcard. By-ID and actor reads keep their call site's scope checks. Pin those semantics with scoped, null-scope and cross-organization fixtures before switching the service.
- Route the active-editor notification enrichment through the same owner lookups. Preserve actor-first history selection, the existing event payload and recipient selection. Both latest-history lookups start in the event’s exact organization scope. A miss can use the explicit fallback only when the event has a server-authorized tenant-level resource scope, and only across organizations within that authorization. If no eligible history exists, keep the existing empty enrichment behavior.
- Audit Logs filters deleted rows and applies tenant, organization and resource checks before it decrypts. Use the resource/time index for latest history, retaining the bounded latest-row query, and the primary key for by-ID. Preserve current query bounds and execution order. Record Locks keeps conflict summaries, snapshot comparison and fallback orchestration.
- Resolve the capability only from the live scope. Optional peer absence yields no audit DTO and the normal version guard continues. Runtime DB or decryption failures follow the existing sanitized error policy and cannot silently downgrade a stale write into success.

## Data Model

Use existing `action_logs` and lock rows. No schema, index or data migration is needed.

## API Contracts

Keep lock acquisition, heartbeat, release, force release, validation and conflict payloads, permissions and codes. Owner operations are additive and server-only.

## Migration & Backward Compatibility

Preserve lock IDs, version headers, existing DI overrides, and the version enforcement floor. Apply the same locking behavior before and after code rollback. Notification dispatch and separately tracked conflict presentation changes stay outside this proposal. The history lookup that enriches the existing notification is part of the provider cutover.

## Risks & Impact Review

| Risk | Mitigation and residual risk |
|---|---|
| High — conflict history crosses tenant, organization or resource boundaries. | Carry explicit authorized scope before decryption. Cover wrong tenant/org/resource in each path and exact-null and authorized fallback separately. |
| High — absent Audit Logs or provider errors let stale writes through. | Resolve the capability independently of the guard and exercise writes through the OSS floor. Preserve the current guard's failure policy. |

## Phasing

Ship one implementation PR for scoped owner reads and the Record Locks cutover.

## Implementation Plan

1. Characterize by-resource, by-actor and by-ID queries, decrypted changes, explicit null, fallback and missing-audit cases. Extend `TC-LOCK-9205-optimistic-floor-optional-peers.spec.ts`.
2. Add the owner boundary and switch Record Locks. Exercise lock/validate and heartbeat/release with live locks, force-release authorization, stale API updates and deletes, and comparison/merge via the existing UI. Use isolated cross-scope and encrypted fixtures. Exercise an active-editor notification with actor-specific history and a scoped miss. Verify the same recipients receive the existing event, unauthorized history contributes no fields, and an authorized tenant-level fallback still enriches the event.
3. Verify the reduced Enterprise app and full-module regression tests. Verify query bounds and that Audit Logs remains independent of Enterprise imports.

## Final Compliance Report

Reviewed the layered guard, explicit scope before decryption, bounded reads and stable APIs. Runtime evidence belongs to the implementation PR.

## Changelog

- 2026-11-24 — Proposed an Audit Logs-owned conflict history boundary for #10476.
- 2026-11-24 — Specified the scope and regression cases for active-editor notification enrichment.
