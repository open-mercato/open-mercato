# Pre-Implementation Analysis: Attachment scanning gate

## Executive Summary

The specification is ready for implementation. It adds a single pre-storage security capability, keeps provider integrations replaceable through DI, and avoids a database migration. The critical constraint is ordering: every untrusted buffer must be scanned before parsing, storage, OCR or indexing.

## Backward Compatibility

### Violations Found

None.

| Surface | Planned change | Classification |
|---|---|---|
| Types | Add scanner contracts and an optional `attachmentScanGate` input field | Additive |
| DI | Add `attachmentScanner`, `attachmentScanGate`, `attachmentQuarantineStore` | Additive |
| API | Add `422` and `503` security outcomes to existing upload routes | Additive error behavior |
| Metadata | Add bounded `securityScan` object to existing JSON | Additive |
| Database | No schema change | Compatible |
| Imports | Add new module-local public paths | Additive |

Existing uploads remain compatible because the default policy is optional. The explicit `required` policy provides the fail-closed deployment mode.

### Migration & Backward Compatibility Section

Present and complete. No deprecation bridge or database backfill is required.

## Spec Completeness

All required sections are present: TLDR, overview, problem, solution, architecture, data model, API behavior, configuration, compatibility, phased implementation, testing, risks, compliance and changelog.

No UI is added. No cache, command, event, worker or search-index contract is needed for the gate itself.

## AGENTS.md Compliance

No blocking violations found.

| Rule | Assessment |
|---|---|
| Preserve tenant and organization scope | The immutable scan context and quarantine path carry both values. |
| Guard attachment creation and reads | Quarantined content creates no attachment row or application read path. |
| Use DI for replaceable services | Scanner and quarantine store are additive registrations. |
| Do not add provider-specific configuration to Core | Core exposes only generic policy and adapter contracts. |
| Avoid new production dependencies without approval | No dependency is required. |
| Preserve public contracts | Existing signatures remain valid through an optional input field. |
| Validate inputs | Scanner results and policy values are schema-validated and bounded. |
| Do not expose credentials or raw provider output | Receipts and errors use allow-listed fields only. |

## Risk Assessment

### High Risks

| Risk | Impact | Mitigation |
|---|---|---|
| A parser runs before the gate | Host-level exploit exposure | Move the gate directly after bounded buffering and test call order. |
| Scanner outage blocks uploads | Attachment and import availability | Timeout, `503`, quarantine, monitoring and an explicit rollout policy. |
| Quarantine becomes publicly reachable | Malicious file disclosure | Separate root, opaque paths, no attachment row and no read API. |
| Quarantine fills disk | Host outage | Existing size/quota checks, isolated root, operator retention and monitoring. |
| A caller omits the DI gate | Operator scanner is bypassed | Known callers pass the DI service; helper fallback still records unavailable status under the compatibility policy. |

### Medium Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Scan adds upload latency | Slower file workflows | Configurable bounded timeout and one scan per byte-ingestion path. |
| Adapter output contains secrets | Metadata or log leakage | Zod normalization and allow-listed receipt fields. |
| Local quarantine lacks platform encryption | Confidential blocked files on disk | Owner-only permissions, operator-encrypted storage and replaceable store. |

### Low Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Legacy rows lack receipts | Mixed evidence quality | Treat as pre-gate data; no backfill claim. |

## Gap Analysis

### Critical Gaps

None after the design fixed pre-parser ordering and production fallback behavior.

### Important Gaps

- Quarantine lifecycle management is operational only. A retention worker, review UI and release flow need a separate capability.
- A concrete antivirus adapter must be deployed by the operator. Core must not claim malware detection with only the unavailable default.
- Security logging for scanner health and quarantine volume should integrate with the broader logging-hardening work.

### Nice-to-Have Gaps

- Stream-based scanning could reduce duplicate memory use after the current multipart buffering contract changes.
- Provider health metrics and circuit-breaker state can be added by adapter packages.

## Remediation Plan

### Before Implementation

1. Keep all scanner result fields bounded and exclude raw provider metadata.
2. Define one error type used by HTTP and internal-buffer callers.
3. Resolve the DI gate explicitly at every known runtime byte-ingestion call site.

### During Implementation

1. Test storage and parser call order, not only returned status.
2. Test EICAR through a deterministic mock adapter and confirm zero normal-storage writes.
3. Mirror environment examples in the create-app template.
4. Update the attachments module guide with the new mandatory gate.

### Post-Implementation

1. Build a real scanner adapter as a separate integration package or operator module.
2. Add quarantine retention and operational evidence in a separate specification.

## Recommendation

Ready to implement.
