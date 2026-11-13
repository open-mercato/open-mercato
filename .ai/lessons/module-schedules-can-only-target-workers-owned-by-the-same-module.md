---
title: "Module-registered schedules can only target workers owned by the same module"
modules: ["scheduler","queue","payment_gateways"]
areas: ["architecture","integration"]
topics: ["workers","module-boundaries","provider-lifecycle"]
---

# Module-registered schedules can only target workers owned by the same module

**Context**: A provider package registered a recurring schedule that pointed at a shared `payment_gateways` worker and passed `scope.providerKey` to tell it which provider to run.

**Problem**: The scheduler's `canDispatchScheduleQueueTarget` matches the schedule's `sourceModule` against the registry id of the module (or modules) that declare a worker on the target queue, and refuses cross-module targets. It never parses the worker id. It also rebuilds `scope` itself, so author-supplied keys such as `scope.providerKey` are dropped. Schedules seeded in `seedDefaults` also never exist for tenants created later.

**Rule**: A module that needs a recurring job declares its own worker in its own module that delegates to the shared service with its own provider key. Do not rely on custom `scope` fields reaching the worker. Register or enable the schedule on the relevant state event (for example, integration enabled/configured), not only in `seedDefaults`.

**Applies to**: `packages/scheduler/src/modules/scheduler/lib/safeQueueTargets.ts`, provider packages registering schedules, and module `setup.ts` seeding.
