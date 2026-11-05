---
title: "Avoid identity-map stale snapshots in command logs"
modules: ["audit_logs","cache","customers","auth"]
areas: ["module-data","debugging","testing"]
topics: ["command-pattern","data-integrity","generated-files","encryption","authorization-locks"]
---

# Avoid identity-map stale snapshots in command logs

**Context**: Command `buildLog()` in multiple modules loaded the "after" snapshot using the same non-forked `EntityManager` used earlier in `prepare()`. MikroORM's identity map returned cached entities, so `snapshotAfter` matched `snapshotBefore`.

**Problem**: Audit logs showed identical before/after snapshots even when updates occurred, because the EM cache was reused.

**Rule**: In `buildLog()`, always load snapshots using a forked `EntityManager` (or explicitly `refresh: true`). This guarantees a fresh DB read and avoids identity-map caching in logs.

**Integration readback**: Audit `snapshot_before`, `snapshot_after`, and command payload columns are encrypted JSON, so a raw PostgreSQL row is not a plaintext snapshot contract. Read snapshots through the authenticated audit actions API, which uses `ActionLogService.decryptEntryPayload`, and select the exact operation log ID. Keep raw SQL for unencrypted membership IDs/timestamps and lock observations. A missing snapshot must fail the same exact-value assertion; never disable encryption to make a test pass.

**Applies to**: Any command that captures `snapshotBefore` in `prepare()` and later loads `snapshotAfter` in `buildLog()`.

**Replay guards (PR #8086)**: `refresh: true` hydrates the existing managed object in place. A retained entity reference is not a before snapshot: copy the owner ID and clone role arrays before any refresh or related lookup, then compare the locked state against those values. Regression fixtures must return the same managed instance and mutate its fields or role array in place; fresh object literals can hide a broken drift guard.
