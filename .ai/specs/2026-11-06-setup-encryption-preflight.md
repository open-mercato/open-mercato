# Setup encryption compatibility preflight

## TLDR

Follow-up to #8613: successful service authentication does not prove that application encryption keys can open stored data. Before setup database writes, inspect existing data using read-only KMS reads and authenticated decryption. Reject unverifiable reuse without disclosing secrets.

## Overview and Problem Statement

Migration, initialization and reinstall can rewrite data under an incompatible configuration. Vault health and PostgreSQL credentials cannot establish historical tenant-key compatibility. Empty databases have no historical ciphertext; plaintext-only databases must not be described as cryptographically verified.

## Proposed Solution and Architecture

The existing setup write authorization remains first. A separate, bounded subprocess snapshots effective environment configuration, imports the installed approved encryption helpers, and opens a repeatable-read PostgreSQL READ ONLY transaction. It inventories application tables and materialized views, streams every row (including deleted records), recursively examines strings/JSON/arrays and decrypts existing v1 envelopes. It resolves tenant keys via getTenantDek only, and the current first-party onboarding system scope via resolveEncryptionKeyId. Nested envelopes in decrypted JSON are checked too.

Forms wrapped DEKs and stored binary revisions/attachments use the existing Forms KMS adapter and decrypt method through a SELECT-only lookup adapter. No module bootstrap, ORM subscribers, key creation, encrypt, rotate, persist or flush is invoked. A custom Forms DI adapter cannot be bootstrapped safely here; environments needing it must stop rather than claim compatibility.

Foreign tables, row-level-security tables, denied reads, unknown populated binary stores, unresolved key scopes, malformed/unknown version envelopes and incomplete scans reject. All helper stdout/stderr are discarded; only a fixed status crosses IPC. Parent failures use static guidance without raw errors, identifiers, addresses, key material or plaintext. The parent kills the child after 60 seconds. Queries have timeouts; scans stop at 100,000 rows / 64 MiB. Exceeding limits blocks reuse.

## Data Models and API Contracts

No schema, HTTP API, module discovery or existing CLI flag changes. Internal script helpers are shared byte-for-byte between starter, monorepo and standalone template. The starter no longer generates a missing tenant encryption fallback key during environment convergence; it preserves the existing app/example encryption configuration. Non-encryption environment convergence remains existing setup behavior. Effective configuration is frozen into mutation children after successful verification. Setup service selection and remote/session guards are preserved.

## Empty and Plaintext Policy

An absent database (PostgreSQL 3D000), zero tables or entirely empty tables has no historical data to decrypt and can proceed through the existing new-database path. A complete scan of populated tables without recognized ciphertext reports plaintext-only, never keys-compatible. With encryption disabled, stored ciphertext still rejects. For populated application tables with encryption enabled, every discovered tenant/system scope must resolve an existing key via getTenantDek, including scopes with plaintext only. A plaintext-only database with no resolvable scope rejects as unverifiable. Migration-bookkeeping-only databases are treated as new/empty so initialization can create the first tenant normally. No KMS health flag substitutes for a key read; no historical compatibility is claimed without ciphertext.

## Risks & Impact Review

- High: missing encrypted stores could falsely pass. Scan all accessible application rows, reject unsupported binary formats/scopes and incomplete inventories. External file/object storage and arbitrary custom encryption are not proven by a database scan.
- High: helper errors can expose secrets. Isolate output and return only fixed statuses.
- Medium: snapshot and later writes can race external writers or key rotation. Run setup with application writers stopped; this is preflight evidence, not a distributed write lock.
- Medium: large databases and custom schemas may reject conservatively. Restore known configuration and ask an administrator to inspect; do not bypass via reinstall or key regeneration.

## Migration & Backward Compatibility

This intentionally narrows unsafe setup reuse; no public signatures or flags are removed. Existing compatible environments continue automatically after verification. Operators must retain original encryption configuration and historical Vault keys. Only the current first-party onboarding system store is recognized; custom/future system-key layouts must reject unless their ciphertext can be verified with its declared scope. Unknown populated binary stores reject even if their bytes are ordinary unencrypted data. No schema migration, key rotation or ciphertext backfill is included. Standalone consumers receive the same script through the create-app template; existing generated apps need their setup scripts updated along with installed helper packages. No production dependency is added.

## Verification Plan

Real existing encryption/KMS helpers with correct/wrong fallback keys; missing/unavailable Vault; encryption disabled over ciphertext; nested/system/Forms stores; empty/plaintext policy; unsupported/inaccessible/incomplete inventory; rejected starter mutation path invokes no command and preserves environment bytes. Disposable PostgreSQL integration covers real READ ONLY transaction, cursor inventory and actual subprocess/module resolution. Test monorepo and standalone script parity and setup call sites.

## Final Compliance Report

In progress. No completion or full-gate claim. Tracking plan: .ai/runs/2026-11-06-setup-encryption-preflight.md.

## Changelog

- 2026-11-06: Defined read-only fail-closed preflight and operator recovery policy for follow-up #8908.
