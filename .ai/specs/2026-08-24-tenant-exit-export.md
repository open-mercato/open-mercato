# Tenant Exit Export

> **Status:** Implemented
> **Scope:** OSS, `tenant_exports` CLI module

## TLDR

Open Mercato provides a one-command, tenant-scoped exit package containing portable JSON Lines data and attachment binaries. The export fails closed on missing encryption keys, cross-tenant references, or missing attachment data. Authentication secrets and short-lived runtime state are intentionally excluded.

## Overview

Operators need a repeatable way to return customer data without giving database access or creating a provider-specific migration. This feature adds a neutral MIT Core export format that can be inspected and transformed with standard tools.

## Problem Statement

- Existing per-entity exports do not cover the complete tenant data set.
- Attachments are stored outside the database and need to travel with business data.
- Raw database dumps contain credentials, runtime tokens, and data belonging to other tenants.
- Encrypted application fields need to be readable in the exit package.

## Proposed Solution

- Discover tenant-scoped tables from the live PostgreSQL schema.
- Include directly scoped rows and relational child rows that belong to the selected tenant.
- Decrypt registered entity fields, dynamic entity documents, and custom field values.
- Redact credential-shaped columns and exclude authentication/session tables.
- Copy attachment binaries through the configured storage driver.
- Produce an owner-readable `tar.gz` containing a manifest, JSONL table files, attachments, checksums, and handling instructions.

## Architecture

```text
tenant_exports CLI
  -> TenantExitExportService
  -> repeatable-read database snapshot
  -> tenant and relational scope resolver
  -> encryption services
  -> optional attachment storage driver
  -> staged portable package
  -> atomic tar.gz publication
```

The command is an operator surface. It is not exposed through an HTTP route or backend page.

## Data Models

No database migration is required. The archive manifest records:

- format and version;
- tenant, actor and generation timestamp;
- exported tables, row counts, redacted columns and SHA-256 checksums;
- exported and missing attachments;
- excluded tables with reasons;
- warnings and confidentiality handling requirements.

## API Contracts

```text
tenant_exports export --tenant <uuid> --out <path.tar.gz> --actor <identifier>
  [--allow-missing-attachments]
```

The command refuses to overwrite an existing file. The actor is required and is written to the manifest. `--allow-missing-attachments` converts a missing binary into an explicit manifest exception; without it the export aborts.

The archive is not encrypted by Open Mercato. It is created with owner-only permissions and must be transferred and stored through an operator-controlled encrypted channel.

## Integration Coverage

- Unit coverage verifies tenant predicates, credential redaction, deterministic normalization, filename safety, archive publication, attachment inclusion, and strict missing-attachment handling.
- Generation and package builds verify CLI discovery and module registration.
- There is no changed HTTP API or UI path.

## Risks & Impact Review

| Failure scenario | Severity | Mitigation | Residual risk |
|---|---|---|---|
| Cross-tenant row is included | Critical | Exact tenant predicates, relational selection, and foreign-key scope validation | Tables without scope columns or declared relations are listed as excluded |
| Encryption key is unavailable | High | Detect mapped encrypted fields and abort instead of exporting ciphertext | Operator must restore KMS access before retrying |
| Credential leaks through data export | High | Exclude runtime authentication tables and redact credential-shaped columns | Module-specific secrets stored under unexpected names require review |
| Attachment binary is missing | High | Strict failure by default; explicit exception flag and manifest entry | Source storage may change after database snapshot |
| Archive is read by an unauthorized party | High | Mode `0600`, no overwrite, handling warning | Encryption in transit and at rest remains an operator responsibility |

## Migration & Backward Compatibility

The new module, CLI command, service types, and archive format are additive. Existing entities, routes, module identifiers, DI keys and generated registries are unchanged. Archive format version `1` is immutable; future incompatible formats must use a new version.

## Changelog

- **2026-08-24:** Added the MIT Core tenant exit export command, portable package format, attachment collection, decryption, credential filtering, integrity checks and operator documentation.
