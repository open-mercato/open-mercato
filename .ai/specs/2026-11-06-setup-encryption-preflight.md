# Setup encryption compatibility preflight

## TLDR

Follow-up to #8613: successful service authentication does not prove that application encryption keys can open stored data. Before setup database writes (including MCP API-key provisioning), inspect existing data using read-only KMS reads and authenticated decryption. Reject unverifiable reuse without disclosing secrets.

## Overview and Problem Statement

Migration, initialization and reinstall can rewrite data under an incompatible configuration. Vault health and PostgreSQL credentials cannot establish historical tenant-key compatibility. Empty databases have no historical ciphertext; plaintext-only databases must not be described as cryptographically verified.

## Proposed Solution and Architecture

The existing setup write authorization remains first. Containerized init, migrate and ACL synchronization commands are routed through the same helper, which freezes verified settings into their child environment and preserves command exit status/signals. Preflight refusal uses reserved status 78, which remains fatal even in the otherwise nonfatal ACL synchronization path; custom ACL commands returning 78 are treated as fatal configuration errors. Docker images ship the helper next to their initialization script; bind-mounted source layouts use the mirrored scripts helper. A separate, bounded subprocess snapshots effective environment configuration, imports the installed approved encryption helpers, and opens a repeatable-read PostgreSQL READ ONLY transaction. It inventories application tables and materialized views, resolves every discovered tenant/system scope, and selects up to five ciphertext candidate rows per store/scope with server-side filtering. Plaintext audit rows are not transferred or charged against the candidate budget. Samples recursively examine strings/JSON/arrays and authenticate existing v1 envelopes, including deleted records that fall within the selected samples. This is a key-compatibility preflight, not an exhaustive historical ciphertext audit. Mixed historical keys or corruption outside selected samples may remain undetected; existing per-record runtime encryption guards remain required. It resolves tenant keys via getTenantDek only, and the current first-party onboarding system scope via resolveEncryptionKeyId. Nested envelopes in decrypted JSON are checked too.

Forms wrapped DEKs and stored binary revisions/attachments use the existing Forms KMS adapter and decrypt method through a SELECT-only lookup adapter. No module bootstrap, ORM subscribers, key creation, encrypt, rotate, persist or flush is invoked. A custom Forms DI adapter cannot be bootstrapped safely here; environments needing it must stop rather than claim compatibility.

Foreign tables, row-level-security tables, denied reads, unknown populated binary stores, unresolved key scopes, malformed/unknown version envelope candidates and incomplete proof reject. The documents-owned document_contents.yjs_state and document_versions.yjs_snapshot columns are known plaintext CRDT data and are excluded from projection; Forms binary stores remain authenticated. Canonical IV-prefix recognition avoids treating ordinary URNs/versioned identifiers as ciphertext. All helper stdout/stderr are discarded; only a fixed status crosses IPC. Parent failures use static guidance without raw errors, identifiers, addresses, key material or plaintext. The parent kills the child after 60 seconds. Queries have timeouts; sample transfer stops at 100,000 candidate rows / 64 MiB, with JSON/decryption nesting capped at 32 levels. Exceeding limits blocks reuse.

## Data Models and API Contracts

No schema, HTTP API, module discovery or existing CLI flag changes. Internal script helpers are shared byte-for-byte between starter, monorepo and standalone template. Existing encryption configuration is never replaced or filled with a new higher-priority fallback. Only fresh environments with neither env file nor configured KMS/key receive a unique fallback, shared consistently by root and app files. Routine best-effort dev migrations warn and skip their write on compatibility refusal; explicit setup/container mutations still fail closed, and remote-target acknowledgement errors retain their blocking behavior. Non-encryption environment convergence remains existing setup behavior. Effective configuration is frozen into mutation children after successful verification. Setup service selection and remote/session guards are preserved.

## Empty and Plaintext Policy

An absent database (PostgreSQL 3D000), zero tables or entirely empty tables has no historical data to decrypt and can proceed through the existing new-database path. A complete scan of populated tables without recognized ciphertext reports plaintext-only, never keys-compatible. With tenant encryption disabled, existing tenant/system ciphertext still rejects. Forms encryption is independent and is verified through its own configured adapter. For populated application tables with encryption enabled, every discovered tenant/system scope must resolve an existing key via getTenantDek, including scopes with plaintext only. Plaintext-only stores without tenant/system scopes may proceed without cryptographic proof; every discovered scope must resolve its existing key. No plaintext-only result is presented as verified historical ciphertext compatibility. Migration-bookkeeping-only databases are treated as new/empty so initialization can create the first tenant normally. No KMS health flag substitutes for a key read; no historical compatibility is claimed without ciphertext.

## Risks & Impact Review

- High: missing encrypted stores could falsely pass. Inspect bounded ciphertext samples per discovered scope, reject unsupported binary formats/scopes and incomplete proof. Sampling establishes current configured-key compatibility, not complete historical readability. External file/object storage and arbitrary custom encryption are not proven by a database scan.
- High: helper errors can expose secrets. Isolate output and return only fixed statuses.
- Medium: snapshot and later writes can race external writers or key rotation. Run setup with application writers stopped; this is preflight evidence, not a distributed write lock.
- Medium: large databases and custom schemas may reject conservatively. Restore known configuration and ask an administrator to inspect; do not bypass via reinstall or key regeneration.

## Migration & Backward Compatibility

This intentionally narrows unsafe setup reuse; no public signatures or flags are removed. Existing compatible environments continue automatically after verification. Operators must retain original encryption configuration and historical Vault keys. Only the current first-party onboarding system store is recognized; custom/future system-key layouts must reject unless their ciphertext can be verified with its declared scope. Unknown populated binary stores reject even if their bytes are ordinary unencrypted data. No schema migration, key rotation or ciphertext backfill is included. Standalone consumers receive the same script through the create-app template; existing generated apps need their setup scripts updated along with installed helper packages. No production dependency is added.

## Verification Plan

Real existing encryption/KMS helpers with correct/wrong fallback keys; missing/unavailable Vault; encryption disabled over ciphertext; nested/system/Forms stores; empty/plaintext policy; unsupported/inaccessible/incomplete inventory; rejected starter mutation path invokes no command and preserves environment bytes. Disposable PostgreSQL integration covers real READ ONLY transaction, cursor inventory and actual subprocess/module resolution. Test monorepo and standalone script parity and setup call sites.

## Final Compliance Report

Implementation and revised local verification complete for #8913. All eight configured gate commands pass, including the 51-task full test suite and optimized app build. Additional script suite: 1,579 passed / 5 standard skips; standalone setup fixture suite: 37 passed; expanded real PostgreSQL smoke: passed with no skips, including Documents CRDT mixed with ciphertext, 150k plaintext and 150k encrypted rows in one scope, URNs, real KMS/Forms positives and negatives, source-mounted/installed container helpers, and rejected writes preserving stored bytes. Independent review findings at the earlier head are addressed and static re-review has no remaining blockers. Supplied-key root/company precedence, exact dotenv round trips and pre-write redacted rejection are covered. No schema migration, production dependency, base merge or history rewrite is introduced. This remains sampled current-key compatibility evidence, not a complete historical ciphertext audit. Independent PR re-review, QA and CI remain external merge gates. Tracking plan: .ai/runs/2026-11-06-setup-encryption-preflight.md.

## Changelog

- 2026-11-06: Defined read-only fail-closed preflight and operator recovery policy for follow-up #8908.

- 2026-11-06: Refreshed follow-up onto merged setup baseline as #8913 without force-push or base merge; revalidating with corrected temporary-directory environment.

- 2026-11-06: Completed host/container coverage, positive/negative live verification and the full local gate; published ready follow-up #8913, superseding #8908.

- 2026-11-06: Addressed independent review/QA findings with bounded per-scope proof, Documents CRDT handling, canonical envelope detection, preserved optional dev behavior and secure fresh-only encryption defaults.

- 2026-11-06: Completed revised full gate and expanded review/QA regressions; preserved exact supplied configuration and explicit database targeting.

### 2026-11-12 resume

Merged current main and updated the upstream credential-display fixture to stub only the encryption proof; real rejection coverage remains intact. Disposable PostgreSQL QA exposed helper entrypoint detection comparing a symlinked argv path with a canonical module URL. The helper now compares real filesystem paths, so symlinked workspaces and installed-script layouts execute the proof and guarded command instead of silently exiting successfully. Unit regressions exercise both CLI modes through symlinked directories in all three mirrored helpers; the live PostgreSQL positive-boot fixture also uses a symlinked installed-script directory. No public signature or configuration format changes.

- 2026-11-12: CI stabilization preserves supplied primary/Vault configuration when creating a missing app environment, without generating a higher-priority fallback; fallback values also use the shared dotenv serializer and have special-character round-trip regressions.
