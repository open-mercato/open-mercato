# Encrypt MFA method secrets (#3854)

## TLDR

Register `security:user_mfa_method.secret` and `provider_metadata` with tenant encryption. Preserve pending enrollment with a lookup hash. Existing installations must apply the additive migration and run the supported plaintext encryption backfill before this rollout is complete.

## Overview and problem statement

The Security module stores confirmed TOTP seeds in `secret`, older seeds in `providerMetadata.secret`, and signed pending setup tokens in `secret`. No encryption map protects these values. A database reader can recover the second factor when tenant encryption is otherwise enabled. Simply adding the map breaks confirmation because its current WHERE clause compares a plaintext setup token with stored ciphertext.

## Proposed solution and architecture

Use the shared encryption subscriber and decryption helpers, with the existing tenant KMS and encryption configuration. Add nullable `secret_hash`, register it as the secret lookup hash, and compute it when persisting pending enrollment even when encryption is disabled. Confirmation queries the current and legacy lookup-hash candidates. The fallback accepts only a null-hash plaintext pending record, scoped to the authenticated user's tenant and organization, preserving in-flight setups before the historical backfill. Confirmed seeds replace the pending hash.

Encrypt the entire provider metadata JSON column so legacy TOTP seeds receive the same protection without inventing provider-specific JSON encryption. The subscriber restores JSON columns after decryption. Verification and summary consumers use decryption helpers. No provider interfaces or algorithms change.

## Data models

`UserMfaMethod.secretHash` maps to nullable text `user_mfa_methods.secret_hash`. The forward-only migration adds the column before idempotently inserting/appending the two rules for existing encryption-enabled scopes. It preserves custom rules and administrator policy choices. Fresh installations without `encryption_maps` remain supported; normal tenant initialization discovers the new module map.

## API contracts and migration & backward compatibility

Route URLs, bodies, response shapes, event IDs, provider contracts and DI keys are unchanged. The schema and map are additive. Encryption-disabled installations retain their established plaintext behavior. Existing ciphertext and plaintext may coexist during deployment; shared helpers support both. Do not roll back to a version that reads encrypted method fields without decryption helpers.

SQL cannot encrypt tenant-key payloads. After migrations and generated registries are deployed, operators must stop writers and use the established `mercato entities rotate-encryption-key --tenant <tenant UUID> --dry-run` preview, then the same command without `--dry-run` and without an old key, for every affected tenant. This encrypts historical plaintext and skips ciphertext already sealed with the current key. Follow the existing encryption-maintenance safety gates, restart replicas, and verify the preview reports no remaining plaintext. The migration installs maps for existing enabled scopes; it does not claim to rewrite historical values. Explicitly disabled maps remain an operator policy choice.

## Integration coverage

- Unit service regression: ciphertext pending secret resolves by its hash; null-hash legacy setup confirms; foreign-organization pending method is denied.
- Real encryption service composition: both seed locations encrypt, historical plaintext round-trips after backfill, setup hash survives, repeated encryption is idempotent.
- Migration ordering and tenant-map SQL registration.
- Existing MfaService and MfaVerificationService suites retain setup, confirmation, challenge, recovery and provider behavior.
- Deployment verification still requires an initialized database migration/backfill and live setup/confirm/verify exercise; no developer database is migrated by this task.

## Risks & impact review

High: applying encryption without the hash column or old code reading newly encrypted rows can break enrollment or verification. Deploy the migration before new code writes, use compatible application replicas, and follow the maintenance procedure above. Existing backups and action-log snapshots may retain historical plaintext; encrypting the method table cannot revoke previously disclosed seeds. Rotate/re-enroll factors after suspected exposure and apply backup retention policy. Whole metadata encryption requires JSON-aware hydration, covered by the established subscriber. KMS availability and disabled-encryption posture remain shared platform policy.

## Final compliance report

Uses shared encryption and scoped confirmation; no new dependency, provider configuration, direct cross-module ORM relationship or generated-file hand edit. The affected snapshot was updated alongside only the intended SQL migration under the root migration exception. No local migration applied. Startup configuration and architecture are preserved, but encryption upgrade behavior changes; do not apply automerge in this run.

## Changelog

- 2026-11-07: Implemented additive lookup hash, method encryption defaults, existing-scope map migration, compatible reads and regression coverage. Historical data remediation and deployment verification remain operator steps.
