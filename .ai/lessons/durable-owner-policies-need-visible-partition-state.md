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
