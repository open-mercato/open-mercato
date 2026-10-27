---
title: "Avoid identity-map stale snapshots in command logs"
modules: ["audit_logs","cache","customers"]
areas: ["module-data","debugging","testing"]
topics: ["command-pattern","data-integrity","generated-files","encryption"]
---

# Avoid identity-map stale snapshots in command logs

**Context**: Command `buildLog()` in multiple modules loaded the "after" snapshot using the same non-forked `EntityManager` used earlier in `prepare()`. MikroORM's identity map returned cached entities, so `snapshotAfter` matched `snapshotBefore`.

**Problem**: Audit logs showed identical before/after snapshots even when updates occurred, because the EM cache was reused.

**Rule**: In `buildLog()`, always load snapshots using a forked `EntityManager` (or explicitly `refresh: true`). This guarantees a fresh DB read and avoids identity-map caching in logs.

**Integration readback**: Audit `snapshot_before`, `snapshot_after`, and command payload columns are encrypted JSON, so a raw PostgreSQL row is not a plaintext snapshot contract. Read snapshots through the authenticated audit actions API, which uses `ActionLogService.decryptEntryPayload`, and select the exact operation log ID. Keep raw SQL for unencrypted membership IDs/timestamps and lock observations. A missing snapshot must fail the same exact-value assertion; never disable encryption to make a test pass.

**Applies to**: Any command that captures `snapshotBefore` in `prepare()` and later loads `snapshotAfter` in `buildLog()`.
