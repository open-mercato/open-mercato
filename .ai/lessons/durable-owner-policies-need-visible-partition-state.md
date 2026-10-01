---
title: "Durable owner policies need visible partition state"
modules: ["attachments"]
areas: ["module-data", "architecture", "testing"]
topics: ["access-control", "data-integrity", "database-migrations"]
---

# Durable owner policies need visible partition state

**Context**: Attachment owner restrictions must survive disabling the owning module. A separate
ORM fork safely synchronizes durable requirements without flushing unrelated caller state.

**Problem**: That fork cannot see a partition created in an uncommitted caller transaction.
Treating zero rows as successful synchronization lets a protected upload commit without its
required provider marker. Synchronizing every partition on each upload also adds needless work.

**Rule**: Scope upload synchronization to its selected partition and reject a missing durable
target unless the caller's partition already carries every required marker for the same atomic
commit. Keep full scans in trusted setup/upgrade. Preserve concurrent requirements under a row
lock, never overwrite them with a stale caller snapshot, and test both transaction-visibility
cases plus repeat-safe union and disabled-provider behavior.

**Mutation review follow-up**: A bulk guard without a record ID cannot enforce record-specific
restrictions. Keep batch transformations, then guard every locked record and validate its final
prospective owner before changing any attachment. Exercise a guard that rejects only the second
row and a guard that changes the destination.

**Validation and integration follow-up**: Use explicit code-point comparators for canonical
keys and schema validation for feature snapshot shape, keeping live permission decisions in
RBAC. When combining access and storage changes, storage configuration errors inherit the
CRUD error type: access-error handling must wrap storage-error handling so the narrower
localized storage response wins. Preserve strict storage's missing-partition delete status
when integrating both changes, and verify real service boundaries and protected public
cache-hit responses instead of relying only on route prechecks. Helpers imported by DI\nservices must remain loadable under native Node ESM; standard Web Responses avoid pulling\nNext.js-only module resolution into service startup. Verify the built service entrypoints\nin Node as well as the Next.js build, and update the catalog's declared count with new lessons.
