# Sync Excel Customers Import Foundation

## TL;DR

Add the first upstreamable `sync_excel` slice as a file-upload-based `data_sync` provider for CSV imports into `customers.person`. The slice now includes the additive `data_sync` contract changes (`runId`, richer field mapping semantics), a provider-owned upload session entity, upload/preview/import APIs, a `customers.person` adapter with external-ID/email dedupe, an integration-detail admin tab, tenant custom-field mapping support in the preview/import flow, flattened primary-address mapping/import for one address per CSV row, resumable upload/mapping state in the integration detail view, polling-based run/log/health refresh, duplicate-risk warnings, and automated unit/integration coverage. After production verification on split ECS web/worker tasks, the upload attachment now also stores an inline CSV copy in attachment metadata so imports do not depend on container-local attachment storage.

## Overview

THST-134 requires CSV import capability that fits Open Mercato upstream rules: background execution, reusable mapping, additive-only contracts, and alignment with the existing `data_sync` hub. Upstream already reserves `sync_excel` as the file-upload reference provider. This spec captures the first real implementation slice for that architecture.

## Problem Statement

Open Mercato already has a generic `data_sync` hub, but before this slice it lacked a clean way to associate a sync run with transient provider-owned file upload state. That made file-backed imports awkward and encouraged one of three bad options:

- overload long-lived integration credentials with temporary file identifiers
- leak provider-specific upload payloads into generic `data_sync` endpoints
- build a parallel import subsystem outside the existing sync architecture

At the same time, a CSV import UI needs richer field mapping semantics than the legacy `FieldMapping` contract exposed.

## Proposed Solution

Implement `sync_excel` as a first-class `data_sync` provider with these capabilities:

1. Add optional `runId` to `StreamImportInput` and `StreamExportInput`
2. Add optional `mappingKind` and `dedupeRole` to `FieldMapping`
3. Introduce provider-owned `SyncExcelUpload` state backed by attachments with an inline attachment-metadata CSV fallback for worker-safe reads
4. Expose provider APIs for upload, preview, and import start
5. Reuse `data_sync` runs, queue orchestration, and progress lifecycle for background execution
6. Scope the first target adapter to `customers.person`
7. Expose an integration detail tab for upload, mapping, preview, and run status

This keeps the architecture aligned with upstream `SPEC-045b` and avoids a standalone imports subsystem.

## Architecture

### Data Sync foundation changes

`packages/core/src/modules/data_sync/lib/adapter.ts`

- `StreamImportInput.runId?: string`
- `StreamExportInput.runId?: string`
- `FieldMapping.mappingKind?`
- `FieldMapping.dedupeRole?`

`packages/core/src/modules/data_sync/lib/sync-engine.ts`

- forwards `runId` to provider adapters for both import and export
- keeps existing providers backward compatible because all new fields are optional

### Provider module

`packages/core/src/modules/sync_excel/`

- integration registration (`providerKey: excel`, hub/category `data_sync`)
- ACL + setup + DI wiring
- attachment-backed upload storage
- CSV preview parser and mapping suggestion helpers
- `customers.person` import adapter
- provider routes for upload, preview, and import start
- backend integration-detail widget injection

### Execution model

1. Admin uploads a CSV file to `sync_excel`
2. Provider stores the file via `attachments`, persists a `SyncExcelUpload` record, and keeps an inline CSV copy in attachment metadata for worker-safe reads
3. Provider returns headers, sample rows, row count, and suggested mapping
4. Admin confirms mapping and starts import
5. Provider persists/updates `SyncMapping`, creates a `SyncRun`, links it to the upload session, and enqueues a normal `data_sync` run
6. `data_sync` worker invokes the `sync_excel` adapter with `runId`
7. Adapter resolves upload session state, parses the CSV document, and streams imports to `customers.person`
8. Progress and cancellation continue to flow through existing `data_sync` / `progress` contracts

## Data Models

### `SyncExcelUpload`

Introduced in `packages/core/src/modules/sync_excel/data/entities.ts`.

Fields:

- `id`
- `attachmentId`
- `filename`
- `mimeType`
- `fileSize`
- `entityType`
- `headers` (JSON)
- `sampleRows` (JSON)
- `totalRows`
- `status` (`uploaded | previewed | importing | completed | failed`)
- `syncRunId?`
- tenant scope columns and timestamps

### Existing reused models

- `SyncRun`
- `SyncMapping`
- external ID mapping storage from `data_sync/lib/id-mapping.ts`

## API Contracts

### `POST /api/sync_excel/upload`

Request:

- multipart `file`
- optional `entityType` (currently only `customers.person`)

Response:

- `uploadId`
- file metadata
- `headers`
- `sampleRows`
- `totalRows`
- `suggestedMapping`

### `GET /api/sync_excel/preview`

Query:

- `uploadId`
- `entityType`

Response:

- preview payload for the saved upload
- rematerialized mapping suggestions

### `POST /api/sync_excel/import`

Body:

- `uploadId`
- `entityType`
- `mapping`

Behavior:

- validates requested mapping
- upserts the matching `SyncMapping`
- creates a `SyncRun`
- links `syncRunId` back to the upload session
- enqueues a background import through the existing `data_sync` flow

## UI/UX

The current slice adds a `sync_excel` integration detail tab with:

1. CSV file upload
2. preview summary (headers, row count, sample rows)
3. editable column mapping table for `customers.person`, including tenant custom fields from both `customer_entity` and `customer_person_profile` plus flattened address fields for one primary address per row
4. import start button guarded by mapping diagnostics
5. run status / progress / cancel affordances backed by `data_sync` run detail
6. resumable upload session restore via `uploadId` / `runId` query params plus sessionStorage-backed manual mapping state
7. smart polling that keeps run detail, logs, and the health snapshot in sync while a run is active
8. soft duplicate-risk warnings for custom matching and repeat imports of the same upload

This slice intentionally does **not** yet add an Import button directly to customers DataTables.

## Configuration

No new env vars are introduced by the feature itself.

No new migration is required for the split-task fix because the worker-safe CSV copy is stored in existing `attachments.storage_metadata`.

## Alternatives Considered

### 1. Standalone `imports` module

Rejected because upstream already treats `sync_excel` as the file-upload reference implementation for `data_sync`.

### 2. Encode upload identity in integration credentials

Rejected because credentials represent long-lived integration state, while upload sessions are transient provider state.

### 3. Extend generic `POST /api/data_sync/run` with upload-specific payload

Rejected because provider-owned upload flows should remain behind provider APIs and reuse generic run orchestration only after upload state exists.

## Implementation Approach

### Completed in current branch

1. Spec + `data_sync` additive contract changes
2. `sync_excel` provider scaffolding
3. `SyncExcelUpload` entity and validators
4. CSV parser, column detector, and mapping helpers
5. upload + preview routes
6. `customers.person` import adapter with external ID / email dedupe
7. import start route wired into `data_sync`
8. integration-detail admin tab
9. unit and integration test coverage

### Still required before merge

1. run full verification in an environment that exercises separate web and worker tasks

## Risks & Impact Review

| Risk | Severity | Affected Area | Mitigation | Residual Risk |
| --- | --- | --- | --- | --- |
| Existing providers accidentally depend on exact adapter input shape | Low | `data_sync` adapters | New adapter fields are optional and additive-only | Low |
| CSV mapping UI drops unmapped columns | Medium | `sync_excel` preview/import | Preview preserves all headers and distinguishes unmapped columns explicitly | Low |
| File-backed imports create duplicate people | Medium | `customers.person` import | Prefer external ID mapping, fallback to email dedupe, keep scope limited to one entity type in v1 | Low |
| First PR scope grows into company/address/deals | Medium | reviewability / upstream acceptance | Current slice limits target support to `customers.person` only | Low |
| Split web/worker deployments lose access to container-local upload files | High | release readiness | Persist inline CSV fallback in attachment metadata and verify imports on ECS | Low |

## Migration & Backward Compatibility

This slice touches multiple stable contract surfaces under `BACKWARD_COMPATIBILITY.md`:

- type definitions / adapter inputs
- API routes
- database schema
- generated artifacts / integration registration

Compatibility strategy:

- `data_sync` changes are additive only
- new API routes are additive only (`/api/sync_excel/*`)
- no existing route IDs, event IDs, ACL feature IDs, or widget spot IDs were renamed or removed
- schema change is additive only (`sync_excel_uploads`)

This branch remains additive-only because the operational fix reuses existing attachment columns and does not introduce a schema change.

## Test Plan

### Unit / focused tests

- `sync-engine-run-id.test.ts`
- CSV parser tests
- column detector tests
- `customers` adapter tests
- import route tests

### Integration

- `packages/core/src/modules/sync_excel/__integration__/TC-SX-001.spec.ts`
  - auth/forbidden coverage
  - upload + preview
  - import run start
  - polling `data_sync` run completion
  - integration logs + health snapshot update after a completed run
  - person create + reimport update by external ID
  - primary address create + update + recreate when the existing primary address is missing
  - mapping restore / cleanup

### Repo health checks already verified in current branch

- `git diff --check`
- `yarn generate`
- `yarn build:packages`
- `yarn typecheck`

## Success Metrics

- `sync_excel` is discoverable as an integration provider
- admins can upload CSV files and preview mappings
- `customers.person` import runs in the background via `data_sync`
- reimport updates existing records by external ID, with email fallback in adapter logic
- one flattened primary address can be mapped and imported per CSV row
- current contracts remain backward compatible for existing sync providers

## Open Questions

- Should follow-up slices persist unmapped provider columns as metadata/custom-field candidates instead of keeping them preview-only?
- Should the next slice add `customers.company` / address support before or after a DataTable import entry point?
- Should a future UI slice deep-link from customers DataTables into the `sync_excel` integration with preselected entity type?

## Final Compliance Report

- Aligned with Task Router guidance for `data_sync`, `integrations`, `customers`, `ui`, and specs
- Preserves backward compatibility through additive-only changes
- Keeps `sync_excel` inside the upstream `data_sync` architecture instead of creating a parallel subsystem
- Integration and unit coverage added for the implemented API paths and primary happy path
- Remaining verification focus is explicit: confirm end-to-end imports on split ECS web/worker tasks

## Changelog

### 2026-03-29

- Added `sync_excel` provider foundation for CSV upload, preview, and import via `data_sync`
- Added `SyncExcelUpload` provider-owned upload session entity
- Added `customers.person` import adapter with external ID / email dedupe
- Added integration-detail UI tab for CSV import administration
- Added unit and integration coverage for the first upstream slice
- Recorded production hardening change: inline CSV fallback in attachment metadata removes the split-task filesystem dependency without a schema change

### 2026-04-01

- Added flattened `address.*` mapping targets for `customers.person` CSV preview
- Added auto-match support for one primary address per CSV row
- Added address import behavior that updates an existing primary address or creates a new one when no primary exists
- Added resumable upload/mapping/run state for the integration detail widget via URL params and sessionStorage
- Added smart polling so sync run refresh updates detail, logs, and health without SSE
- Added lifecycle-oriented `data_sync` operational logs and integration state snapshots for `sync_excel`
- Added soft duplicate-risk warnings instead of hard-blocking repeat imports
