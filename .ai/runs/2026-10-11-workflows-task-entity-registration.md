# Execution plan — workflows task entity registration seam (#7180)

Issue: https://github.com/open-mercato/open-mercato/issues/7180
Source doc: .ai/specs/2026-10-11-workflows-task-entity-registration.md

## Goal

Let a module register (a) the `view` ACL requirement and (b) a record deep-link builder for its own
entity type, so a task whose `userTaskConfig.entityBindings` point at an app-owned record is visible to
non-superadmins holding the registered features, and the Work Inbox / task detail link to that record.

## Scope

- `packages/core/src/modules/workflows/lib/` — new pure registry, consulted by the §6.4 entity gate
  (`task-entity-access.ts`) and by a server-side href resolver.
- Task/work-inbox API projections carry an additive `href` per binding; task detail and Work Inbox
  render it.
- Spec, docs (`apps/docs/.../workflows`), module AGENTS.md, unit tests.

## Non-goals

- No change to `entities/lib/entityAcl.ts` or the entities records API gate (registration is consulted
  only by the workflows task gate).
- No new auto-discovery file or generator change — registration is a function call from the module's
  existing `workflows.ts` (same seam as `registerWorkflowSafeCommands`).
- No record-level ACL (the gate stays entity TYPE + tenant/org scope, as documented).
- No registration for portal (customer) visibility.

## Implementation Plan

### Phase 1: Registry + entity gate

1. `lib/task-entity-registry.ts`: `registerTaskEntityAclRequirements`, `registerTaskEntityLinkBuilders`,
   lookups, test reset. Core table always wins; empty `view` rejected.
2. `task-entity-access.ts`: system entity with no core requirement → registered requirement, else
   `unavailable` (unchanged). Tests incl. regression + tenant/org scope.

### Phase 2: Deep links

1. `lib/work-inbox/entity-record-href.ts`: server resolver (core enumerated link first, then registered
   builder, sanitized to same-origin relative paths). `href` added to serialized task bindings and
   work-inbox bindings (+ OpenAPI). Task detail + Work Inbox render it. Tests.

### Phase 3: Spec + docs

1. Spec, docs page section, workflows AGENTS.md entry.

## Risks

- Security seam: a registration widens visibility for that entity type only to holders of its
  registered features; core entries cannot be overridden, unregistered types still fail closed.
- Registration happens at module import time; a module whose `workflows.ts` is not loaded in a process
  simply has no registration there (fails closed).

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Registry + entity gate

- [x] 1.1 Task entity registry — b5289c31f
- [x] 1.2 Entity gate consults registered requirements — b5289c31f

### Phase 2: Deep links

- [x] 2.1 Server-resolved binding hrefs in task and work-inbox responses — 551633922

### Phase 3: Spec + docs

- [x] 3.1 Spec, docs and AGENTS.md — 89c87b403
