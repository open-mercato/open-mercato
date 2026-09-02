# Signed Audit Evidence Export

> **Status:** Implemented
> **Scope:** OSS, `audit_logs` and shared command runtime

## TLDR

The `audit_logs` CLI will export tenant- and organization-scoped action and access records as a signed JSON evidence bundle. Every record carries a correlation identifier and an HMAC-SHA256 chain link. The verifier detects edits, deletions, insertions, and reordering performed after export.

## Overview

Action logs and access logs already contain the operational facts required for an evidence package, but they are exported separately and without a common integrity envelope. This change adds a reusable MIT Core format and an optional contributor interface so commercial modules can append their own scoped records without creating a Core dependency on Enterprise.

## Problem Statement

- Action and access evidence is not available in one machine-verifiable file.
- Command records do not consistently preserve the request or run correlation identifier.
- Existing CSV exports cannot prove that rows were not changed, removed, or reordered after export.
- Enterprise evidence cannot be hard-coded into an MIT Core module.

## Proposed Solution

- Add an optional `correlationId` to `CommandRuntimeContext` and persist it in action-log context.
- Export decrypted action and access logs for one required tenant and organization.
- Normalize records into a versioned JSON format with source, type, actor, timestamp, correlation and payload.
- HMAC-chain records in deterministic order and sign the complete bundle with `OM_AUDIT_EVIDENCE_HMAC_KEY`.
- Add `evidence:export` and `evidence:verify` CLI commands.
- Add a typed contributor interface resolved optionally through DI.
- Write evidence files with owner-only permissions and refuse overwrite unless `--force` is present.

## Architecture

```text
audit_logs CLI
  -> AuditEvidenceExportService
  -> Core action/access collectors
  -> optional registered contributors
  -> deterministic record sort
  -> HMAC record chain
  -> signed JSON file (0600)

evidence:verify
  -> recompute source counts, chain and bundle signature
  -> fail on any mismatch
```

The integrity boundary starts when the bundle is created. The export detects later changes to that file. It does not prove that a privileged actor did not alter source database rows before export. Operators that require stronger source guarantees should store exports in immutable or Object Lock storage and protect signing keys in a secret manager or KMS-backed process.

## Data Models

No database migration is required.

The evidence bundle contains:

- format and version;
- generation time and tenant/organization/time scope;
- source counts;
- ordered records with `sequence`, `previousHash`, `hash`, `source`, `type`, `id`, `correlationId`, `occurredAt`, actor and payload;
- integrity metadata with algorithm, derived key identifier, final chain hash and bundle signature.

## API Contracts

### Export

`audit_logs evidence:export --tenant <uuid> --org <uuid> --out <path> [--after <ISO>] [--before <ISO>] [--limit <n>] [--force]`

The command requires `OM_AUDIT_EVIDENCE_HMAC_KEY` with at least 32 UTF-8 bytes. The default and maximum per-source limits are bounded. Every collector reads one overflow row and aborts instead of producing a partial bundle when a source exceeds the limit. Existing files are not overwritten unless `--force` is supplied.

### Verify

`audit_logs evidence:verify --file <path>`

The command uses the same environment key, validates the format, counts, sequence, correlation-bearing records, hash chain and bundle signature, and exits with an error when verification fails.

### Contributor

`AuditEvidenceContributor.collect({ em, scope })` returns normalized records. Contributors must apply the exact tenant and organization scope supplied by Core.

## Integration Coverage

- Unit tests verify a valid bundle, payload modification, deletion, reordering, wrong key and minimum key length.
- Unit tests verify command correlation derived from an explicit run identifier or `x-request-id`.
- Core collection tests verify tenant and organization filters and action/access correlation extraction.
- The Core collector test verifies exact tenant and organization filters, correlation extraction and overflow rejection.
- No HTTP API or UI path changes. CLI discovery is covered by generation and the Core package build.

## Risks & Impact Review

| Failure scenario | Severity | Affected area | Mitigation | Residual risk |
|---|---|---|---|---|
| Signing key is weak or missing | High | Evidence authenticity | Reject keys shorter than 32 bytes and never accept a CLI key argument | Operator key custody remains external |
| Export includes another scope | Critical | Tenant isolation | Require both tenant and organization and apply them to every collector | A privileged operator can request another known scope |
| Evidence file leaks sensitive payloads | High | Confidentiality | Owner-only file mode, explicit documentation, secure destination requirement | HMAC does not encrypt the file |
| Export file is edited | High | Evidence integrity | Chain every ordered record and sign the complete bundle | An attacker with both file and key can re-sign it |
| Source rows were changed before export | High | Source integrity | State the integrity boundary and recommend periodic immutable exports | Database-level WORM or continuous seals are future hardening |

## Migration & Backward Compatibility

The command context field, DI registration, CLI commands and contributor interface are additive. Existing action/access entities, routes, exports and command handler signatures remain compatible. No generated identifier, database column or encryption map changes.

## Final Compliance Report

- Core has no Enterprise import.
- Every collection query is tenant- and organization-scoped.
- Encrypted fields are read through the existing decryption helper.
- The bundle is integrity-protected but intentionally not described as encrypted.
- The implementation adds no mutable domain entity and requires no undo path.

## Changelog

- **2026-08-21:** Defined the scoped signed evidence format, CLI contracts, correlation propagation and optional contributor boundary.
- **2026-08-21:** Implemented correlation propagation, complete scoped collection, signed export, verification, CLI commands, tests and operator documentation.
