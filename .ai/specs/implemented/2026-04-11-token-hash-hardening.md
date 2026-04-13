# Token Hash Hardening — Message Access Tokens

## TLDR

Public message access tokens must not be stored as plaintext. New tokens are persisted as SHA-256 hashes, lookup is performed through `token_hash`, and legacy plaintext rows are migrated in-place.

## Overview

This change hardens the message email view link flow backed by `message_access_tokens`.

The public URL contracts remain unchanged. Users still receive raw one-time/random link tokens, but the database stores only deterministic hashes.

Note: Auth password reset token hashing is handled separately (PR #1465).

## Problem Statement

The previous implementation stored full bearer tokens in `message_access_tokens.token`. A read-only database leak, SQL debug dump, or accidental log of entity payloads could expose valid public message links.

## Proposed Solution

Add `token_hash` to `message_access_tokens`. All new token creation computes SHA-256 over the raw token and stores that digest in `token_hash`. For database compatibility with existing non-null unique legacy columns, new code also writes the digest, not the raw token, into the existing `token` column.

Verification first looks up by `token_hash`. A temporary legacy fallback checks `token` for plaintext only when the hash lookup misses, allowing rolling deploys and old rows created before migration. Successful legacy fallback upgrades the row to the hash.

## Architecture

- Shared helper: `hashOpaqueToken(token)` in `@open-mercato/shared/lib/security/token`.
- Messages:
  - `createMessageAccessToken()` returns the raw token for the email URL and persists hashes.
  - Token route and consume command use hash lookup, then legacy fallback.

## Data Models

`message_access_tokens`:

- add nullable unique `token_hash text`
- keep `token text` as deprecated legacy column
- migration hashes existing `token` into `token_hash`, then overwrites `token` with the hash

## API Contracts

No API route URL, method, request body, or response shape changes.

Affected paths retain behavior:

- `GET /api/messages/token/:token`

## Migration & Backward Compatibility

The database change is additive: new `token_hash` column is added and the legacy column remains. Existing plaintext tokens remain usable after migration because `token_hash` is backfilled from the old raw value before the legacy column is overwritten.

The legacy plaintext fallback remains temporarily for rolling deploy compatibility and rows created by older application versions after the column exists. It should be removed in a later minor release after deployments have run this migration.

## Integration Coverage

Unit coverage verifies:

- message access token creation stores hashes, not raw tokens
- message token route resolves by `token_hash`
- message token consume command uses `token_hash` and upgrades legacy plaintext rows

Existing integration scenarios continue to cover the user-facing message-link flows:

- `.ai/qa/scenarios/TC-MSG-008-public-message-email-link-token-view.md`

## Risks & Impact Review

| Risk | Severity | Affected Area | Mitigation | Residual Risk |
|------|----------|---------------|------------|---------------|
| Existing links stop working after migration | High | Message links | Backfill `token_hash = sha256(old token)` before overwriting legacy column | Low |
| Rolling deploy creates plaintext rows after migration | Medium | Messages during deploy | Runtime legacy fallback upgrades rows on successful use | Low |
| Third-party code queries `token` directly | Medium | Module extensions | Keep `token` column and write the hash there; mark entity property deprecated | Medium |
| Database lacks SHA-256 digest function | Medium | Migration | Ensure `pgcrypto` extension exists before using `digest()` | Low |

## Final Compliance Report

- Backward compatibility: additive columns, no route or event changes, legacy columns retained.
- Security: new raw tokens are only returned to email/link generation callers and are not persisted.
- Tenant isolation: unchanged.
- Tests: unit tests added for storage and lookup behavior.

## Changelog

- 2026-04-11: Added SHA-256 token hash storage for message access links, with migration and compatibility fallback.
