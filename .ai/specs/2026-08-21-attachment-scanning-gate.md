# Attachment scanning gate

## TLDR

Open Mercato will route every untrusted attachment buffer through one MIT Core security gate before storage, parsing, OCR, indexing or attachment-row persistence. The gate is provider-neutral, uses DI for scanner and quarantine adapters, records a bounded scan receipt, and can fail closed when the scanner is unavailable.

The built-in implementation supplies policy enforcement and an isolated local quarantine store. Antivirus engines such as ClamAV or ICAP remain external adapters.

## Status

Implemented on 2026-08-21. The generic gate, policy enforcement, local quarantine, scan receipts and known ingestion-path coverage are part of MIT Core. A concrete antivirus adapter and production quarantine operations remain deployment responsibilities.

## Overview

The attachments module already blocks executable extensions, active content, oversized uploads and unsafe tenant scope. It does not have one mandatory malware-scanning seam shared by multipart uploads, server-created attachments and import uploads.

This specification adds that seam without adding a production antivirus dependency or changing the attachment database schema.

## Problem Statement

- Multipart attachment uploads can reach storage and OCR without an antivirus verdict.
- Server-side buffer creation and CSV imports use separate storage paths.
- There is no common result vocabulary for clean, rejected, quarantined or unavailable scans.
- Operators cannot inject a scanner through the application container.
- Scanner outages do not have an explicit fail-closed policy.

## Proposed Solution

Add an `AttachmentScanner`, `AttachmentScanGate` and `AttachmentQuarantineStore` contract to MIT Core. Known untrusted byte-ingestion paths must call the gate before any parser or storage driver. Clean or explicitly permitted unavailable results receive a bounded receipt in `storage_metadata`. Rejected or quarantined content never becomes a normal attachment.

### Design Decisions

| Decision | Rationale |
|---|---|
| Keep the gate in MIT Core | Every deployment and every attachment producer needs the same safety boundary. |
| Keep scanner and quarantine implementations behind DI | Operators can connect an antivirus service and remote quarantine without changing Core. |
| Do not ship a pretend antivirus | A signature check for a few samples would create false assurance. The default scanner reports unavailable. |
| Keep `optional` as the compatibility default | Core ships no antivirus engine, so an upgrade must not disable every existing upload deployment. |
| Provide an explicit fail-closed `required` policy | Hardened deployments can make a missing or failed scanner block all unscanned content. |
| Quarantine before returning a blocked result | Suspicious bytes stay outside normal attachment storage and routes. |
| Store only a bounded scan receipt on accepted attachments | Evidence remains available without persisting arbitrary provider responses or secrets. |
| Scan before OCR and import parsing | Untrusted bytes must not reach document parsers before the security decision. |

### Alternatives Considered

| Alternative | Why Rejected |
|---|---|
| Put scanning in each storage driver | It misses parsing that happens before storage and duplicates policy across drivers. |
| Add ClamAV directly to Core | It adds provider-specific operations and deployment dependencies to the MIT package. |
| Scan asynchronously after upload | The file could be downloaded, parsed or indexed before the verdict. |
| Persist quarantined files as ordinary attachments with a metadata flag | Existing readers do not all understand that flag, so a missed filter could expose the file. |
| Fail open whenever the scanner times out | It turns scanner outages into an upload bypass. |

## Architecture

```text
multipart upload / CSV import / internal buffer
  -> existing size, filename and MIME checks
  -> AttachmentScanGate
       -> AttachmentScanner (DI adapter)
       -> policy decision
       -> AttachmentQuarantineStore when blocked content must be retained
  -> only an allowed decision continues
  -> parser / storage driver / attachment row / OCR / indexing
```

### Core contracts

`AttachmentScanner` accepts a bounded in-memory buffer and immutable context:

- tenant and organization IDs;
- file name, detected MIME type and byte length;
- source identifier such as `http_upload`, `sync_excel` or `scoped_upload`;
- abort signal controlled by the gate timeout.

It returns one of:

- `clean`: content may continue;
- `rejected`: policy rejected the file and no quarantine is required;
- `quarantined`: suspicious content must be isolated and blocked;
- `scanner_unavailable`: the scanner could not produce a verdict.

The gate validates and bounds adapter output. Invalid output, exceptions, aborts and timeouts become `scanner_unavailable`.

### Policy behavior

| Policy | Clean | Rejected | Quarantined | Scanner unavailable |
|---|---:|---:|---:|---:|
| `required` | allow | block | quarantine and block | quarantine and block |
| `optional` | allow | block | quarantine and block | allow with receipt |
| `disabled` | allow without adapter call | N/A | N/A | allow with disabled receipt |

The compatibility default is `optional` in every environment. Hardened deployments must explicitly set `required` after registering a scanner. This keeps upgrades operational while making the weaker state visible in every accepted attachment receipt.

### Quarantine

The Core quarantine adapter writes opaque blobs outside every attachment partition and public route. The default location is `.mercato/quarantine/attachments`, configurable by environment variable. Directories and files use owner-only permissions. File paths contain generated IDs, tenant scope and date segments, never the submitted file name.

Each blob has a small JSON sidecar with:

- quarantine ID;
- tenant and organization IDs;
- source, MIME type and byte length;
- SHA-256 digest;
- scan status, scanner ID, reason code and timestamp.

The sidecar excludes provider payloads, submitted file names, credentials and file content. The quarantine root has no application read API. Retention, review, deletion and storage-level encryption remain operator responsibilities until a separate quarantine-management capability is specified.

### Known byte-ingestion paths

The implementation covers:

1. `POST /api/attachments` before storage, OCR or text extraction.
2. `POST /api/sync_excel/upload` before CSV parsing and attachment storage.
3. `attachmentService.createScoped()` before quota reservation or driver storage for cross-module server uploads.

Copying an existing attachment row or linking the same stored object does not rescan bytes because it does not introduce new content. Repository-owned example seed assets are trusted build inputs and remain outside the untrusted-upload gate.

## Data Models

No table or column is added.

Accepted attachment rows add a `securityScan` object to the existing `storage_metadata` JSON:

```json
{
  "securityScan": {
    "status": "clean",
    "scanner": "operator-scanner",
    "policy": "required",
    "checkedAt": "2026-08-21T12:00:00.000Z",
    "contentSha256": "64-character lowercase hex digest",
    "reasonCode": null
  }
}
```

The receipt schema is fixed and bounded. It does not contain raw scanner metadata or threat details.

Quarantined content has no `attachments` row. Its opaque file and sidecar are operational files under the quarantine root.

## API Contracts

Existing routes and successful response shapes remain unchanged.

### `POST /api/attachments`

Additive error behavior:

- `422`: scanner rejected the file or the file was quarantined;
- `503`: a required scan could not complete or quarantine failed.

The response contains only a localized generic error. Scanner names, threat names, storage paths and quarantine IDs are not returned.

### `POST /api/sync_excel/upload`

The same `422` and `503` behavior applies before CSV parsing. Existing successful response fields stay unchanged.

### Scoped attachment service

The existing `AttachmentService.createScoped()` contract remains unchanged. Its DI-owned upload service now scans every buffer and stores the receipt before quota reservation, storage, parsing, OCR or persistence. Operator scanner adapters therefore apply to cross-module uploads without exposing scanner details in the public service contract.

## Configuration

- `OM_ATTACHMENT_SCAN_POLICY=required|optional|disabled`
  - default `optional`;
  - hardened deployments set `required`.
- `OM_ATTACHMENT_SCAN_TIMEOUT_MS`
  - default `15000`;
  - bounded from `1000` to `120000`.
- `OM_ATTACHMENT_QUARANTINE_DIR`
  - default `.mercato/quarantine/attachments` under the process working directory.

Application and create-app environment examples must stay synchronized.

## Migration & Backward Compatibility

- No database migration or backfill is required.
- Existing attachment rows without `securityScan` remain readable.
- API route URLs, request bodies and success responses do not change.
- The new `422` and `503` responses are additive security outcomes.
- New DI names `attachmentScanner`, `attachmentScanGate` and `attachmentQuarantineStore` are additive.
- The existing `AttachmentService.createScoped()` input and output shapes remain unchanged.
- Existing storage-driver and attachment metadata contracts remain intact.
- Existing deployments keep working under the `optional` compatibility default. Hardened deployments switch to `required` after registering a scanner.

## Implementation Status

### Phase 1: Core gate and adapters — complete

1. Add scanner result schemas, public types, policy parsing, timeout handling and `AttachmentScanError`.
2. Add the isolated local quarantine store with bounded sidecar metadata and cleanup on partial writes.
3. Register default scanner, gate and quarantine services in the attachments DI module.
4. Add unit tests for all result states, policy modes, timeout, malformed adapter output and quarantine failure.

### Phase 2: Ingestion coverage — complete

1. Gate the main attachment upload before storage and OCR.
2. Gate sync Excel bytes before CSV parsing and persist the accepted receipt.
3. Gate the scoped attachment service used by cross-module server uploads.
4. Preserve scan receipts when accepted rows are created.
5. Add EICAR fixture tests proving suspicious bytes never reach normal storage or attachment persistence.

### Phase 3: Documentation and verification — complete

1. Document adapter registration, policy configuration, quarantine ownership and deployment expectations.
2. Update module guidance so future byte-ingestion paths must use the gate.
3. Add localized route errors and OpenAPI outcomes.
4. Run targeted unit tests, a self-contained fail-closed integration test, generation, typecheck and package builds.

## Testing Strategy

- Gate unit tests:
  - clean allows and returns a bounded receipt;
  - rejected blocks without normal storage;
  - EICAR-like scanner verdict quarantines and blocks;
  - scanner exception, timeout and malformed response normalize to unavailable;
  - required unavailable quarantines and blocks;
  - optional unavailable allows with an explicit receipt;
  - disabled policy does not call the adapter;
  - quarantine failure still blocks.
- Quarantine-store tests:
  - generated paths stay within the configured root;
  - owner-only file modes are requested;
  - sidecar contains scope and digest but no submitted file name;
  - a sidecar failure removes the partially written blob.
- Route tests:
  - main upload does not call storage when rejected or quarantined;
  - main upload returns `503` when required scanning is unavailable;
  - sync Excel does not call the CSV parser or storage when blocked.
- Scoped-service tests:
  - scanner runs before the storage driver;
  - EICAR verdict leaves no attachment row;
  - clean receipt is stored in metadata.
- Integration test:
  - an isolated application launched with `required` policy and no scanner returns `503`, creates no attachment row and writes the upload only to quarantine. Deterministic EICAR verdict coverage remains in unit tests so the application does not ship a test scanner or environment backdoor.

## Risks & Impact Review

#### Scanner outage blocks uploads
- **Scenario**: The antivirus service is down or exceeds the scan timeout under `required` policy.
- **Severity**: High
- **Affected area**: Attachment, import and internal-buffer creation paths.
- **Mitigation**: Return `503`, quarantine the bytes outside normal storage, log a bounded status and expose an explicit optional rollout policy.
- **Residual risk**: Upload availability depends on the configured scanner in hardened deployments.

#### Untrusted content reaches a parser before scanning
- **Scenario**: A route parses a CSV, document or image before invoking the gate.
- **Severity**: Critical
- **Affected area**: Import, OCR and preview processes.
- **Mitigation**: Call the gate immediately after bounded buffering and before parsing, storage, OCR or indexing. Cover known paths with ordering tests.
- **Residual risk**: A future custom byte-ingestion path can bypass the gate unless it follows module guidance and review checks.

#### Quarantined bytes become downloadable
- **Scenario**: Quarantine reuses a normal attachment partition or creates an attachment row.
- **Severity**: Critical
- **Affected area**: File download routes and tenant data.
- **Mitigation**: Store quarantine outside all partitions, use opaque generated paths, create no attachment row and expose no application read API.
- **Residual risk**: Operators with host or bucket access can inspect quarantine by design.

#### Scanner adapter returns unsafe or oversized metadata
- **Scenario**: A provider adapter returns malformed values, secrets or a very large payload.
- **Severity**: High
- **Affected area**: Attachment metadata, logs and API errors.
- **Mitigation**: Validate the result, retain only bounded allow-listed fields, never return provider output to clients and never log raw results.
- **Residual risk**: A custom adapter still receives the uploaded bytes and must be treated as a data processor by the operator.

#### Quarantine storage fills the host disk
- **Scenario**: A scanner outage or attack creates many quarantined files.
- **Severity**: High
- **Affected area**: Application host storage and availability.
- **Mitigation**: Existing upload-size and tenant-quota limits run before quarantine, paths are isolated, and operators configure monitoring and retention for the quarantine root.
- **Residual risk**: Core does not yet provide a quarantine retention worker or management UI.

#### Optional policy admits unscanned content
- **Scenario**: An operator leaves `optional` enabled in a sensitive deployment.
- **Severity**: High
- **Affected area**: All accepted attachments during scanner outages.
- **Mitigation**: Accepted unscanned rows carry an explicit `scanner_unavailable` receipt, and deployment docs require `required` mode for hardened environments.
- **Residual risk**: An operator can deliberately choose the weaker policy.

#### Quarantine at-rest protection depends on deployment storage
- **Scenario**: The local quarantine directory is placed on an unencrypted filesystem.
- **Severity**: High
- **Affected area**: Confidentiality of blocked uploaded content.
- **Mitigation**: Use owner-only permissions, exclude submitted file names from paths and sidecars, and document encrypted storage plus restricted host access as operator requirements. Operators may replace the store through DI.
- **Residual risk**: Core cannot guarantee host-level encryption for self-managed deployments.

## Final Compliance Report — 2026-08-21

### AGENTS.md Files Reviewed

- `AGENTS.md`
- `packages/core/AGENTS.md`
- `packages/core/src/modules/attachments/AGENTS.md`
- `.ai/specs/AGENTS.md`
- `BACKWARD_COMPATIBILITY.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|---|---|---|---|
| root | Never expose cross-tenant data | Compliant | Scanner and quarantine context keeps the existing tenant and organization pair. |
| root | Validate input and do not log credentials | Compliant | Adapter output is schema-validated and reduced to bounded fields. |
| root | Ask before adding a production dependency | Compliant | No dependency is added. |
| attachments | Guard every attachment creation path | Compliant | The same gate covers untrusted multipart, import and buffer inputs. |
| attachments | Preserve scope invariant | Compliant | Scope is passed as an immutable pair and no quarantined row is created. |
| core | Use DI for services | Compliant | Scanner, gate and quarantine store are additive Awilix registrations. |
| compatibility | Public types and DI names are additive | Compliant | No field, route, service or import is removed or renamed. |
| specs | OSS and Enterprise scope stay separate | Compliant | Core owns the generic gate; provider adapters remain separate packages. |

### Internal Consistency Check

| Check | Status | Notes |
|---|---|---|
| Data models match API contracts | Pass | Accepted receipts use existing metadata; blocked bytes have no API row. |
| API contracts match ingestion behavior | Pass | `422` and `503` cover blocked and unavailable outcomes. |
| Risks cover all write operations | Pass | Parser ordering, storage isolation, outage and disk growth are covered. |
| Commands defined for mutations | N/A | The gate is a precondition to existing writes and creates no undoable domain state. |
| Cache strategy covers reads | N/A | No read API or cache is added. |

### Non-Compliant Items

None identified in the design.

### Verdict

Fully compliant: implemented and approved.

## Changelog

### 2026-08-21

- Initial specification for the provider-neutral attachment scanning gate, fail-closed policy and isolated quarantine.
- Review: security passed; performance passed with existing bounded buffers and a configurable timeout; cache N/A; commands N/A; risks passed; verdict approved.
- Implemented the MIT Core gate, DI contracts, local quarantine, bounded receipts, upload and import enforcement, internal-buffer enforcement, documentation and automated coverage.
