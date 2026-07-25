# Integrations Credentials Encryption Fail-Closed

## TLDR

Fix issue #2251 by removing the integrations credentials service's local DEK derivation fallback. Integration credentials must be encrypted only with a DEK returned by the shared KMS path. If no DEK is available, credentials reads for encrypted rows and all credential writes fail closed instead of falling back to auth secrets, dev defaults, or public constants.

## Problem Statement

Integration credentials contain third-party API keys, OAuth client secrets, webhook secrets, and passwords. The previous implementation could derive a DEK inside `packages/core/src/modules/integrations/lib/credentials-service.ts` from `AUTH_SECRET`, `NEXTAUTH_SECRET`, a dev default, or the public production constant `om-emergency-fallback-rotate-me` using a single SHA-256 hash. A database dump plus a reused or known secret could decrypt stored credentials offline.

The shared KMS fallback also accepted `AUTH_SECRET` and `NEXTAUTH_SECRET` as tenant-data encryption fallback inputs. That made the integrations fix incomplete unless the shared KMS candidate list was narrowed to data-encryption-specific secrets.

## Proposed Solution

- Remove all local fallback secret resolution and SHA-256 DEK derivation from the integrations credentials service.
- Use only `createKmsService().getTenantDek()` or `createTenantDek()` for credential encryption/decryption.
- Throw a typed `CredentialsEncryptionUnavailableError` when no DEK is available.
- Return HTTP 503 from the credentials API for that typed error.
- Remove `AUTH_SECRET` and `NEXTAUTH_SECRET` from shared KMS derived-key candidates.
- Keep derived KMS available through dedicated data-encryption secrets: `TENANT_DATA_ENCRYPTION_FALLBACK_KEY`, then legacy `TENANT_DATA_ENCRYPTION_KEY`.
- Require `ALLOW_DERIVED_KMS_FALLBACK=true` before using the built-in dev default derived key.

## Architecture

`integrationCredentialsService.save()` resolves the DEK before touching the database. If KMS cannot provide or create a tenant DEK, the method throws and leaves storage untouched. When a row exists, `getRaw()` decrypts the blob only after KMS returns a DEK. Empty/missing credential rows still return `null` without requiring KMS.

The encrypted blob format remains unchanged:

- JSON credentials are encrypted with AES-GCM.
- The encrypted payload stays under `__om_encrypted_credentials_blob_v1`.
- Existing rows remain readable when the same KMS/fallback DEK is configured.

## API Contracts

No route path, method, request body, or successful response shape changes.

New failure behavior:

- `GET /api/integrations/:id/credentials` returns `503` when an existing encrypted credential row cannot be decrypted because no credential DEK is available.
- `PUT /api/integrations/:id/credentials` returns `503` when credentials cannot be encrypted because no credential DEK is available.

The response body is intentionally generic:

```json
{ "error": "Integration credentials encryption is unavailable" }
```

## Migration & Backward Compatibility

This intentionally changes insecure fallback behavior. Deployments that relied on `AUTH_SECRET`, `NEXTAUTH_SECRET`, or the hardcoded integrations fallback must configure Vault KMS or a dedicated `TENANT_DATA_ENCRYPTION_FALLBACK_KEY`.

Existing credentials encrypted with the old integrations-local SHA-256 fallback are not silently migrated by this patch because the old fallback included insecure auth/public constants. Operators should restore the previous secret in an isolated migration/rotation workflow and re-save credentials under Vault or a dedicated fallback key.

The public credentials service type and API routes remain stable. The new typed error is additive.

## Verification Plan

- Unit test the integrations credentials service:
  - encrypts only with a KMS DEK,
  - fails before storage writes when no DEK exists,
  - does not require KMS for missing rows,
  - fails when encrypted rows exist but no DEK exists.
- Unit test shared KMS:
  - auth secrets alone do not create derived tenant keys,
  - dev default derived keys require `ALLOW_DERIVED_KMS_FALLBACK=true`,
  - explicit fallback secret still works when Vault times out.
- Run targeted Jest suites for `integrations` and `shared` encryption.
- Run TypeScript checks for `packages/core` and `packages/shared`.

## Risks & Impact Review

| Risk | Severity | Mitigation |
| --- | --- | --- |
| Deployments using auth secrets as data-encryption fallback can no longer decrypt credential rows. | High | Fail closed and document dedicated fallback requirement. This is the intended security boundary. |
| Local dev environments without Vault/fallback cannot save integration credentials. | Medium | Set `TENANT_DATA_ENCRYPTION_FALLBACK_KEY` or explicitly opt into the dev default with `ALLOW_DERIVED_KMS_FALLBACK=true`. |
| Existing old-fallback ciphertext cannot be read after the insecure path is removed. | Medium | Require explicit operator-controlled rotation instead of automatic reuse of insecure constants. |

## Final Compliance Report

- No API route URLs or methods changed.
- No database schema changes.
- No DI service names changed.
- No integration registry contracts changed.
- Sensitive data remains encrypted through AES-GCM and tenant DEKs.
- The insecure local AES/KMS fallback is removed from integrations credentials.

## Changelog

- 2026-05-29 - Initial security hardening spec for issue #2251.
