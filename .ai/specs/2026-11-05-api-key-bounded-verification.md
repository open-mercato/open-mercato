# Bounded API-key verification

## TLDR

Address PR #8376's security finding by replacing bcrypt for newly issued high-entropy API secrets with versioned HMAC-SHA-256 digests and retaining a bounded bcrypt compatibility verifier. Do not increase bcrypt's work factor on the request authentication path.

## Open Questions

Q1. Provision a dedicated stable `API_KEY_HASH_SECRET` in both application and MCP processes for the recommended HMAC migration, or retain bcrypt and implement admission controls only? A dedicated secret must survive JWT secret rotation; missing configuration must never silently select an unkeyed digest or a random process-local key.

## Problem Statement

The public key prefix selects a stored hash before authentication. Attackers can vary wrong suffixes to defeat full-secret negative caches and repeatedly invoke expensive bcrypt work. Increasing cost from 10 to 12 quadruples that work. Both application and MCP authentication call the shared API-key verifier, making that service the enforcement boundary.

Audit: https://github.com/open-mercato/open-mercato/pull/8376#issuecomment-6554288231

## Proposed Solution

- Keep generated bearer secrets and public prefixes unchanged.
- Store a versioned HMAC digest in the existing text `key_hash` column for new keys; compare fixed-length decoded digests with `timingSafeEqual`.
- Reject unsupported or malformed stored digest formats without bcrypt fallback.
- Retain verification of existing bcrypt hashes behind fail-closed admission controls before comparison. Bound concurrent comparisons and comparison starts over time globally per process; do not create an unbounded wait queue or attacker-controlled limiter map.
- Apply the same enforcement inside the shared verifier for every caller, including MCP. A new full-secret cache alone cannot address distinct-suffix attacks.
- Preserve revocation, expiry, tenant scope, and role checks. Do not cache successful principals inside the verifier.

## Migration & Backward Compatibility

No entity, route, credential syntax, prefix, or exported service signature changes are planned. Existing bcrypt keys continue to verify under the bounded bridge. All authenticating processes must understand the digest version before issuance is enabled: older binaries cannot verify newly issued HMAC keys. Operators need explicit secret provisioning, backup, rotation, and rollback instructions. Never couple long-lived API-key validity implicitly to JWT secret rotation. Final rollout and rotation details depend on Q1.

## Validation Plan

Add real-crypto creation and verification coverage for regular and session keys; correct/wrong-secret and malformed-version cases; legacy bcrypt compatibility; expired/deleted records; missing configuration; and repeated distinct wrong suffixes for one known prefix. Assert actual bcrypt call counts and peak concurrency under both parallel and sequential abuse, including recovery after the admission window and failures. Verify the shared application/MCP call sites cannot bypass the bound. Run the relevant API-key suites and package checks, then the configured PR validation gate when dependencies are available. No validation has run yet.

## Changelog

- 2026-11-05: Recorded audit finding, proposed shared verification boundary, compatibility requirements, and blocking secret-provisioning decision. Implementation pending Q1.
