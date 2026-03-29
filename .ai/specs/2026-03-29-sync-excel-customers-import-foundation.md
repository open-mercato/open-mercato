# Sync Excel Customers Import Foundation

## TL;DR

Introduce the first upstreamable slice of `sync_excel` as a file-upload-based `data_sync` provider for CSV imports into `customers.person`. This slice adds a spec-first contract for provider-owned upload sessions and requires one additive `data_sync` foundation change: sync adapter inputs may carry an optional `runId`, and field mappings may carry optional semantic metadata (`mappingKind`, `dedupeRole`) without breaking existing providers.

## Overview

THST-134 requires CSV import capability for Open Mercato with background processing, reusable field mapping, and future upstream contribution viability. The upstream architecture already reserves `sync_excel` in the `data_sync` hub as the file-upload reference implementation. This spec defines the first incremental change needed to implement that path safely: establish the `sync_excel` foundation and extend the `data_sync` adapter contract additively so file-backed providers can resolve provider-owned upload state from the sync run lifecycle.

## Problem Statement

The current `data_sync` contract assumes API-style providers that can fully derive import/export state from integration credentials, mapping, cursor, and tenant scope. File-upload-driven providers need an additional, provider-owned way to associate a `SyncRun` with an uploaded file session and its preview/mapping state. Without that hook:

- `sync_excel` would have to overload `credentials` with transient file identifiers
- provider-specific upload state would leak into generic `data_sync` routes
- future file-based providers would have no clean contract for run-linked state

At the same time, the existing `FieldMapping` type is too narrow for no-loss CSV mapping flows that need to distinguish core mappings from ignored columns, external IDs, or metadata-only mappings. We need a backward-compatible way to enrich mappings without breaking existing providers.

## Proposed Solution

1. Keep the architecture aligned with the implemented `data_sync` hub reference:
   - `sync_excel` remains a provider built on top of `data_sync`
   - `customers.person` is the first target entity in the follow-up implementation slices
2. Add an optional `runId` field to `StreamImportInput` and `StreamExportInput`
3. Add optional `mappingKind` and `dedupeRole` fields to `FieldMapping`
4. Preserve backward compatibility by:
   - making every new field optional
   - keeping existing adapter call sites valid
   - treating undefined `mappingKind` as the existing default behavior

This PR does not yet implement the `sync_excel` module itself. It only establishes the contracts required by the upcoming `sync_excel` upload/preview/import flow.

## Architecture

### Current

`data_sync` starts a `SyncRun`, resolves credentials and mapping, and calls the registered adapter with:

- `entityType`
- `cursor`
- `batchSize`
- `credentials`
- `mapping`
- `scope`

### Target

`data_sync` will additionally pass:

- `runId`

to both import and export adapters. File-backed providers such as `sync_excel` can then:

1. receive a `runId` from the generic sync engine
2. resolve provider-owned upload session state using that run ID
3. stream rows without leaking upload-specific state into the generic core routes

### Mapping semantics

`FieldMapping` gains two optional semantics fields:

- `mappingKind`
  - `core`
  - `relation`
  - `external_id`
  - `custom_field`
  - `metadata`
  - `ignore`
- `dedupeRole`
  - `primary`
  - `secondary`

These semantics are initially advisory for `sync_excel` and future providers. Existing providers remain unaffected.

## Data Models

No database schema changes are part of this foundation slice.

Future `sync_excel` work will introduce a provider-owned upload session entity and reuse `SyncRun` to bind background execution to uploaded files.

## API Contracts

This foundation slice does not add or modify HTTP routes.

It changes the internal adapter contract additively:

```ts
interface StreamImportInput {
  entityType: string
  cursor?: string
  batchSize: number
  credentials: Record<string, unknown>
  mapping: DataMapping
  scope: TenantScope
  runId?: string
}

interface StreamExportInput {
  entityType: string
  cursor?: string
  batchSize: number
  credentials: Record<string, unknown>
  mapping: DataMapping
  scope: TenantScope
  filter?: Record<string, unknown>
  runId?: string
}

interface FieldMapping {
  externalField: string
  localField: string
  transform?: string
  required?: boolean
  defaultValue?: unknown
  mappingKind?: 'core' | 'relation' | 'external_id' | 'custom_field' | 'metadata' | 'ignore'
  dedupeRole?: 'primary' | 'secondary'
}
```

## UI/UX

No UI changes are included in this slice.

Future slices will add an integration detail tab for `sync_excel` with upload, preview, mapping, and background-run status.

## Configuration

No new environment variables or feature flags are introduced in this slice.

## Alternatives Considered

### 1. New standalone `imports` module

Rejected because upstream already defines `sync_excel` as the file-upload reference implementation for `data_sync`. A new parallel import subsystem would fragment the architecture.

### 2. Encode upload identity in generic credentials

Rejected because credentials are integration-owned long-lived settings, while upload sessions are transient provider-owned state. Mixing them would be semantically wrong and harder to reason about.

### 3. Extend generic `POST /api/data_sync/run` with provider-specific payload

Rejected because provider-owned upload routes should create and bind their own run context without polluting the core `data_sync` route contract.

## Implementation Approach

### Phase 1 — foundation

1. Add this spec and update the specs index
2. Extend `packages/core/src/modules/data_sync/lib/adapter.ts`
3. Pass `runId` through `packages/core/src/modules/data_sync/lib/sync-engine.ts`
4. Add focused tests proving the sync engine forwards `runId`
5. Verify compatibility with existing providers and tests

### Follow-up phases

1. Scaffold `packages/core/src/modules/sync_excel/`
2. Add upload session entity + CSV preview parser
3. Add upload/preview/import routes
4. Add `customers.person` adapter
5. Add integration-detail UI and integration tests

## Risks & Impact Review

| Risk | Severity | Affected Area | Mitigation | Residual Risk |
| --- | --- | --- | --- | --- |
| Existing providers accidentally depend on exact input shape | Low | `data_sync` adapters | New fields are optional and additive only | Low |
| Mapping metadata is misused as hard behavior before provider support exists | Low | Future provider implementations | Keep new fields optional and advisory until provider logic explicitly consumes them | Low |
| `runId` is added to import only and export stays asymmetric | Low | Adapter ergonomics | Add to both import and export inputs now for consistency | Low |

## Migration & Backward Compatibility

This change touches **type definitions and function input shapes**, which are stable contract surfaces under `BACKWARD_COMPATIBILITY.md`.

Compatibility strategy:

- do not remove or rename any existing fields
- add only optional fields
- preserve all current call sites
- preserve all current adapter implementations without modification

No deprecation or migration guide is required because the change is purely additive.

## Test Plan

### Unit

- sync engine passes `runId` to import adapters
- sync engine passes `runId` to export adapters
- existing adapter resolution continues to work with optional mapping metadata present

### Integration

This slice does not add new HTTP routes, so no new integration API coverage is required yet.

Future `sync_excel` slices must include integration coverage for:

- upload route
- preview route
- import start route
- run detail / progress visibility

## Success Metrics

- `data_sync` adapters can receive a `runId` without breaking existing providers
- the additive mapping metadata compiles and remains backward compatible
- targeted tests confirm the new fields flow through the sync engine

## Open Questions

- Should `sync_excel` upload sessions link to `SyncRun` only by `runId`, or also persist `integrationId` + `entityType` for defensive validation?
- Should future provider-owned upload APIs upsert a `SyncMapping` before creating a `SyncRun`, or only persist mapping after successful preview confirmation?

## Final Compliance Report

- Aligned with Task Router guidance for `data_sync` and specs
- Matches the implemented upstream direction from `SPEC-045b`
- Backward compatibility reviewed: additive only
- No API route, event ID, ACL feature ID, or DB schema contracts changed in this slice

## Changelog

### 2026-03-29

- Added foundation spec for the first `sync_excel` upstream contribution slice
- Defined additive `data_sync` contract changes for file-backed providers and richer field mapping semantics
