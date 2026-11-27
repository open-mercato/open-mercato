# Per-folder communication channel cursors

Extends: .ai/specs/2026-05-21-email-integration-foundation.md

## TLDR

Host workers need an independent resumption point for each mailbox folder they sync. This spec adds scoped, durable folder cursors alongside the poller's channel-wide cursor and protects each cursor from late writes by other workers.

## Overview

The communication channels module will expose a server-side cursor store for host workers. Workers already responsible for fetching and ingesting folder content can use it to resume after a restart. Each host continues to decide which folders to fetch and when to run.

## Problem Statement

[Issue #4632](https://github.com/open-mercato/open-mercato/issues/4632) describes a host that syncs content outside the built-in inbox and sent folders. The hub owns the provider cursor in `channelState`. The poller verifies its starting cursor under a row lock before replacing sync state. Push writers have their own reserved keys. A host writing an unrelated key would still be participating in the poller's cursor protocol and could lose that key on the next successful poll.

## Proposed Solution

Store one cursor per channel and provider folder. An in-process worker reads the saved cursor, processes a page, and advances the cursor only if the stored version still matches the version it read.

## Resolved assumptions (autonomous defaults)

| Decision | Default | Rationale |
|---|---|---|
| Folder cursor storage | A dedicated table | The issue offers storage and adapter folder selectors as alternatives. Independent storage solves the reported interference for host workers and leaves provider implementations compatible. |
| Cursor and folder identifiers | Opaque, case-sensitive strings | Microsoft Graph scopes message delta links to a folder. IMAP scopes a UID to its mailbox and UIDVALIDITY. The worker keeps each provider's format and resolves any expired cursor. |
| Activation | Explicit use by the host worker | Existing installations continue with their current sync scope. Scheduling, folder discovery, and provider-specific folder fetches remain the host's responsibility. |

Provider references [Microsoft Graph message delta](https://learn.microsoft.com/en-us/graph/delta-query-messages) and [IMAP4rev2 §2.3.1](https://www.rfc-editor.org/rfc/rfc9051.html#section-2.3.1).

## 📝 Delta

### Capability: communication-channel-folder-cursors

#### ADDED Requirement: Independent folder progress

The system SHALL persist each folder cursor independently of other folders and channel polling and push state.

##### Scenario: Concurrent progress

- WHEN a host worker advances one folder and another worker advances a different folder while the channel poller updates its state
- THEN both folder cursors and the channel state remain available at their respective checkpoints

#### ADDED Requirement: Concurrent writes to one folder

The system SHALL advance a folder cursor only when its version matches the worker's last read.

##### Scenario: Two workers start with the same cursor

- WHEN two workers submit advances for the same version, including an absent cursor
- THEN at most one advance succeeds and the other worker can reload the winning version

#### ADDED Requirement: Channel scope

The system SHALL restrict cursor reads and writes to a channel in the supplied tenant and exact organization scope.

##### Scenario: Channel outside scope or soft-deleted

- WHEN a worker provides a different tenant or organization, or the channel has been soft-deleted
- THEN no cursor is returned and no advance succeeds

## Architecture

Register a server-only `channelFolderCursorStore` in the existing communication channels DI registrar. The caller supplies scope from its trusted job context. Bind the tenant, nullable organization and channel ID in each SQL statement, using the parent channel as the scope authority. An organization of `null` matches only a tenant-wide channel. The worker remains responsible for authorization before deriving that context.

Create the first row with an insert that does nothing on conflict. Advance an existing row with a version-conditioned update. PostgreSQL arbitrates concurrent writes without holding a transaction open across provider calls or updating the channel row.

Read the cursor before fetching and persist it only after applying the page durably. On an unsuccessful advance, reload the folder cursor before retrying. The host must make page processing idempotent because it may run again after a crash or competing write.

## Data Model

`communication_channel_folder_cursors` has a UUID primary key, a foreign key `channel_id`, a case-sensitive `folder_id`, an opaque `cursor`, an opaque UUID `version` and `updated_at`. A unique constraint on `(channel_id, folder_id)` enables independent writes. A hard channel delete cascades. A soft-deleted or disconnected channel cannot be accessed through the store. Restoring or reconnecting the same channel can resume its retained cursors.

Use provider identifiers and cursor values that require provider authentication to use. Keep credentials, message content and direct personal identifiers out of cursor strings and logs.

```mermaid
flowchart LR
    classDef newEntity fill:#2f6feb,color:#fff,stroke:#1b4fb0
    classDef existingEntity fill:#e5e7eb,color:#111,stroke:#9ca3af
    entity_1["CommunicationChannel"]:::existingEntity
    entity_2["CommunicationChannelFolderCursor"]:::newEntity
    entity_1 -->|1 to many| entity_2
```

## API Contracts

- `read(key)` yields `{ cursor, version }` or `null` when no eligible checkpoint exists.
- `advance(key, expectedVersion, cursor)` yields `true` after committing an advance. It yields `false` if the key is out of scope, the channel is unavailable, or the expected version is stale. A `null` expected version permits creation of the first checkpoint.
- Keys contain UUID `tenantId` and `channelId`, a UUID or `null` `organizationId`, and a nonempty `folderId` of at most 512 characters. `cursor` accepts up to 16,384 characters. Preserve both strings verbatim and reject NUL characters.

The store is available to backend workers via DI. It adds no HTTP routes or UI flows.

## Migration & Backward Compatibility

An additive migration creates the cursor table empty. Existing `ChannelAdapter.fetchHistory`, default folder behavior and `channelState` data stay compatible. Deploy the migration before enabling workers that use the store. Rolling back the application leaves the table and checkpoints available for a subsequent upgrade. Reversing the migration discards folder progress and requires workers to bootstrap again.

## Risks & Impact Review

| Failure | Impact | Handling |
|---|---|---|
| Worker fails after ingest but before advancing | Page can be fetched again | Use idempotent ingest and advance after applying the page. |
| Workers finish out of order | Late results could regress the cursor | Require the starting version on each advance. |
| Folder ID changes or provider rejects an expired cursor | Stored cursor cannot resume the folder | Worker uses stable provider IDs where available and restarts the affected folder from the provider's bootstrap path. |
| Channel scope is mismatched | Progress could be disclosed or incorrectly moved | Require tenant, exact organization and channel predicates on every read and write. |

## Implementation Plan

### Phase 1 — Scoped cursor persistence

1.1 Add the entity, migration and server-side DI store. Verify input bounds and lifecycle filtering.

1.2 Add PostgreSQL integration coverage for competing first inserts and advances, independent folders and poller writes, exact scope, and deleted channels. Document the worker call sequence.

1.3 Archive the Delta in the capability spec and run the repository validation gate.

## Final Compliance Report

The design uses an additive, same-module foreign key, binds scope at the persistence boundary, and preserves the existing adapter entry point. Integration coverage targets the service and database boundary where concurrency is enforced.

## Changelog

- 2026-11-22 — Proposed an independent cursor store for host-managed folder content sync.
