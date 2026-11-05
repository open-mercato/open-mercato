# Conditional device deactivation

Status: Implemented; pending review and release. Issue: #8599. Date: 2026-11-04.

## Problem
A provider receipt for an obsolete token can delete an active device whose token rotated between receipt lookup and deactivation. A second unlocked read does not close this race.

## Design
The existing devices.user_devices.deactivate command accepts optional expectedPushToken containing a SHA-256 hash and nullable updatedAt timestamp. Under a transaction with a pessimistic row lock it decrypts the current device, validates tenant, organization and user, and compares both token hash and token-update timestamp. An absent, deleted or changed device is a successful no-op for conditional calls; unconditional calls retain their existing not-found behavior. Conditional results add deactivated: boolean. No-op calls produce neither deletion side effects/events nor an undo log. Successful calls preserve normal command audit, undo and CRUD events.

Register/upsert and update acquire the same row lock inside their write transaction before reading mutable state. PostgreSQL therefore serializes rotation and deactivation: a committed rotation is visible before comparison; registration after deactivation revives the row; update after deletion returns not found rather than silently rotating a deleted row. Undo preserves live credentials and its UPDATE participates in PostgreSQL row locking; it never restores token snapshots. First-time registrations retain their existing unique-index conflict behavior.

Push receipt handling resolves devices through DI, compares the delivery token fingerprint/provider and refuses devices rotated after delivery, then forwards a full hash/version expectation. The synchronous send path forwards the token/version it actually sent. Receipt marks commit before command dispatch. Tokens never enter audit logs; only SHA-256 digests cross the new command input boundary.

## Migration & Backward Compatibility
Additive optional command input and result fields; existing command IDs, routes, schemas, database columns and unconditional behavior remain supported. No migration or dependency is needed. Existing calls without an expectation retain their {id} result. Push call sites opt into the conditional path. No token is exposed in responses or logs.

## Validation
Unit regressions: rotation after receipt lookup, changed version even for identical token text, unchanged token deleted once, no-op audit/event suppression, wrong tenant/org/user denied, missing/deleted device conditional no-op, register/update row-lock reads. Persistence integration: exercise actual command handlers against disposable PostgreSQL while controlling transaction ordering for update/register versus conditional deactivation. Existing device API and push delivery suites remain required. No UI changes in this repair.

## Execution plan
- [x] Implement additive schema and locked compare/deactivation.
- [x] Coordinate register/update reads with row locks and preserve postcommit side effects.
- [x] Forward receipt/send token expectations and preserve durable receipt marks.
- [x] Add deterministic and database concurrency regressions.
- [x] Run configured validation and submit the implementation for review.

Validation: the full ordered gate passes on macOS/Node 24.22.2 with the existing #8654 prerequisite. Focused coverage passes 80 tests including 10 PostgreSQL cases; native sales integration passes all four first attempts. Independent review, manual QA approval and release remain separate gates.

## Changelog
- 2026-11-04: Recorded additive protocol and concurrency ordering after operator requested autonomous resolution of the contract blocker.
