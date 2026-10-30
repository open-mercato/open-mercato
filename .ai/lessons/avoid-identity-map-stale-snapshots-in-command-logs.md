---
title: "Avoid identity-map stale snapshots in command logs"
<<<<<<< HEAD
modules: ["audit_logs","cache"]
areas: ["module-data","debugging"]
topics: ["command-pattern","data-integrity","generated-files"]
=======
modules: ["audit_logs","cache","customers","auth"]
areas: ["module-data","debugging","testing"]
topics: ["command-pattern","data-integrity","generated-files","encryption","authorization-locks"]
>>>>>>> 90fa052c1 (fix(auth): bound AI-generated keys by the user ACL (#8086))
---

# Avoid identity-map stale snapshots in command logs

**Context**: Command `buildLog()` in multiple modules loaded the "after" snapshot using the same non-forked `EntityManager` used earlier in `prepare()`. MikroORM's identity map returned cached entities, so `snapshotAfter` matched `snapshotBefore`.

**Problem**: Audit logs showed identical before/after snapshots even when updates occurred, because the EM cache was reused.

**Rule**: In `buildLog()`, always load snapshots using a forked `EntityManager` (or explicitly `refresh: true`). This guarantees a fresh DB read and avoids identity-map caching in logs.

**Applies to**: Any command that captures `snapshotBefore` in `prepare()` and later loads `snapshotAfter` in `buildLog()`.

**Replay guards (PR #8086)**: `refresh: true` hydrates the existing managed object in place. A retained entity reference is not a before snapshot: copy the owner ID and clone role arrays before any refresh or related lookup, then compare the locked state against those values. Regression fixtures must return the same managed instance and mutate its fields or role array in place; fresh object literals can hide a broken drift guard.
