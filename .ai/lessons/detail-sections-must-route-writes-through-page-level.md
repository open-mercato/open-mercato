---
title: "Detail sections must route writes through page-level guarded mutations"
modules: ["customers","events","ui","sales","record_locks"]
areas: ["backend-ui","umes","module-data"]
topics: ["events","network-security","testing"]
---

# Detail sections must route writes through page-level guarded mutations

**Context**: Customer detail sections introduced canonical interaction writes in local hooks and components while the surrounding backend pages already had mutation-injection context for record locks and retry flows.

**Problem**: Raw `apiCall` or CRUD-helper writes from detail sections bypass `useGuardedMutation`, so lock/conflict hooks never see those saves. Separately, showing flash messages in both the data hook and the section UI produces duplicate toasts for one mutation.

**Rule**: In backend detail pages, the page owns `useGuardedMutation` and passes a guarded mutation runner into child sections. Data hooks should execute the network call and refresh state, while the section or presenter owns user-facing flash messages so each mutation emits one toast.

**Applies to**: `packages/core/src/modules/customers/components/detail/**/*`, customer detail pages, and any future backend section that performs manual writes outside `CrudForm`.

**CrudForm ownership**: A `CrudForm` already runs mutation injection hooks. Do not wrap its `onSubmit` in another guarded mutation for the same record: enterprise Keep Mine consumes a one-shot resolution during the first hook, so a second hook rejects the retry before the API call. Give the form the aggregate resource kind/id and the matching form ID, then issue its API call with the aggregate optimistic-lock header. A composition regression must model one-shot resolution consumption and verify exactly one write receives both resolution and optimistic-lock headers; a form mock that calls only `onSubmit` cannot catch duplicate guards (sales #8616).
