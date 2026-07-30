# Upgrade Notes

Open Mercato `0.5.0` is our biggest release so far. It bundles more than 250 fixes and
improvements that landed after the Hackathon in Sopot, alongside several important
dependency and tooling upgrades. That combination is exactly why this document now exists:
to give downstream app and module authors one place to review the upgrade work that may
require code changes on their side.

This document lists backward-incompatible changes that users of the Open Mercato platform
must apply to their own modules, apps, and extensions when upgrading between framework
versions. It only covers **actionable** incompatibilities — library behavior that affects
code a downstream module author can plausibly write against.

For the platform's own contract-surface stability guarantees, see
[`BACKWARD_COMPATIBILITY.md`](BACKWARD_COMPATIBILITY.md).

For user-facing release highlights see [`CHANGELOG.md`](CHANGELOG.md).

Companion AI skills (one per upgrade window) live in
[`.ai/skills/om-auto-upgrade-<from>-<to>/SKILL.md`](.ai/skills/) and can mechanically migrate
most of the patterns listed below in a user's codebase.

---

## 0.6.6 → 0.6.7 (unreleased)

### Workflows: `UPDATE_ENTITY` commands now need a tenant to switch them on

**Who is affected:** any module that calls `registerWorkflowSafeCommands`.

`UPDATE_ENTITY` used to run any command present in the code-declared catalogue.
It now also requires the command to be **enabled for the tenant** — a tick-box
list at *Settings → Module Configs → Workflow Commands*, stored as one
tenant-scoped `module_configs` row (`workflows` /
`update_entity_enabled_commands`). The command's declared `requiredFeatures` are
still checked against the acting user, unchanged.

A tenant that has never saved the setting resolves to the declarations carrying
the new **`defaultEnabled: true`** grandfather clause. In the platform's own
modules that is `sales.orders.update` alone, so nothing changes for a stock
install.

**Action required for third-party modules:** a command you registered before
this release is a *candidate* from now on and is **off until an administrator
ticks it**. If yours was already reachable and you need it to keep running
without a settings change, add the flag:

```diff
 registerWorkflowSafeCommands([
-  { commandId: 'wms.stock.update', requiredFeatures: ['wms.stock.manage'] },
+  { commandId: 'wms.stock.update', requiredFeatures: ['wms.stock.manage'], defaultEnabled: true },
 ])
```

Otherwise do nothing: the command appears in the settings page and in the
authoring picker (marked unavailable, with the remedy) and starts working the
moment it is ticked. **Do not** set `defaultEnabled` on a command you are
declaring for the first time — it hands your module the tenant's decision.

`WorkflowSafeCommandDefinition` also gains an optional `labelKey` (an i18n key
resolved from your own module's locale files) used to name the command in the
settings page and the picker. Both new fields are optional and additive.

`GET /api/workflows/commands` gains `enabled`, `defaultEnabled` and `labelKey`
on each item; `commandId` and `requiredFeatures` are unchanged.

Details: [`apps/docs/docs/framework/workflows/entity-updates.mdx`](apps/docs/docs/framework/workflows/entity-updates.mdx).


### Workflows: existing tolerated-failure runs will start reporting `partial_failure`

**Who is affected:** anyone running workflow definitions that set
`continueOnActivityFailure: true` on a transition, or an `errorDirective` of
`continueWithFallback` on a step — and anyone reading the per-definition KPI
rollup or the failure queue.

`WorkflowInstance` gains an additive, nullable `outcome` column: the run's
**verdict** (`success`, `success_with_warnings`, `partial_failure`, `failure`,
`cancelled`, `compensated`) alongside its unchanged lifecycle `status`. A run
that reached END while tolerating at least one activity or step failure is now
written `status: 'COMPLETED', outcome: 'partial_failure'`.

**This is a reporting change, not a behaviour change.** Nothing runs
differently: the same steps execute, the same routes are taken, the same
`status` is written. Runs that used to look healthy will start looking degraded,
because they always were. Expect the KPI success rate of any workflow relying on
tolerated failures to drop the day this ships — that drop is the previously
hidden truth, not a regression.

What to do:

- `status` is untouched, so no filter, subscriber or integration needs changing.
- `outcome` is `null` on every pre-upgrade row, meaning *"ran before outcomes
  existed"*. Nothing is backfilled; do not read `null` as `success`.
- The KPI rollup reports `runsPartialFailure` as its own number and excludes it
  from `successRate`. The key is `.optional()` in
  `workflowDefinitionMetricsSchema`, so pre-upgrade rollup rows still parse —
  treat a missing key as "this rollup has nothing to say", never as zero.
- `partial_failure` is **not** retryable as a whole run (it reached END; a
  retry would re-run the parts that succeeded). Recover with rerun-from-step on
  the specific failed step.

Full mechanism: [`apps/docs/docs/framework/workflows/run-outcomes.mdx`](apps/docs/docs/framework/workflows/run-outcomes.mdx).

### Workflows: compensated runs finally get a terminal timestamp — and enter the KPIs

**Who is affected:** anyone reading the per-definition KPI rollup for a workflow
that uses compensation.

`compensation-handler` flipped the instance status to `COMPENSATED` (or back to
`FAILED` on a partial compensation) and `completeWorkflow` returned before its
own `completedAt` assignment, so a compensated run had **no terminal timestamp
at all**: it could be attributed to no KPI time window and its duration was
unmeasurable. `COMPENSATED` was excluded from `WORKFLOW_TERMINAL_STATUSES` for
exactly that reason.

The run-outcome write now stamps `completedAt` on those paths, `COMPENSATED`
joins the terminal statuses, and the rollup reports `runsCompensated` (also
`.optional()` in the schema). Expect compensated runs to start appearing in
`runsTerminal` and in the duration percentiles, which will move both. Runs
compensated **before** this ships keep their null timestamp and stay out of
every window — nothing is backfilled.

### Workflows: a tolerated step failure is now recorded as FAILED

**Who is affected:** anyone reading `StepInstance` rows or `STEP_FAILED` events
directly.

`handleAutomatedStep` reports a failed sync activity as `{ status: 'FAILED' }`
instead of throwing, so `executeStep`'s catch never ran: the step row stayed
`ACTIVE` for ever and no `STEP_FAILED` event was logged. Both are now written on
that path too. A run that previously showed a permanently `ACTIVE` step will
show a terminal `FAILED` one, and one additional `STEP_FAILED` event per
tolerated failure appears in the audit log.

This also means `POST /api/workflows/instances/[id]/rerun-step` now **accepts**
such a step; it previously refused it with 409 `WORKFLOW_STEP_STILL_PARKED`.

### Workflows: `MobileMetadataSheet` is deprecated

**Who is affected:** anyone importing `MobileMetadataSheet` from
`@open-mercato/core/modules/workflows/components/mobile/MobileMetadataSheet`.

The Studio's definition metadata moved from an inline band above the canvas into a wide
right-side drawer, `components/DefinitionMetadataDrawer.tsx`, and the mobile editor now
renders the same component. `MobileMetadataSheet` was a second, divergent copy of the same
form that never gained the fields the desktop one did — `contextSchema`, the interpolation
mode and the definition-level error handler were simply not editable on mobile.

It is still exported and still works; it has no call site left in the module and will be
removed one minor after this note. Migrate to `DefinitionMetadataDrawer`, which takes
`{ open, onOpenChange, definitionId, readOnly, metadata, handlers, errorHandlerStepOptions,
onSave, isSaving }`.

`WorkflowMetadataState` / `WorkflowMetadataHandlers` gained **optional** `contextSchema`,
`interpolation` and `errorHandler` members. Existing objects keep type-checking; a caller
that omits them gets a drawer without those sections.

### Workflows: task visibility is now assignment + entity access (security-semantics change)

**Who is affected:** every tenant with workflow user tasks. **This change is ON by default.**

Until this release, any user holding `workflows.tasks.view` could list and read **every** user task in their organization — including other people's work and agent-disposition rows carrying proposal payloads — and any user holding `workflows.tasks.complete` could complete **anyone's** task. As of this release (spec `.ai/specs/2026-07-26-workflows-ux-redesign.md` §6.4), a task is visible and actionable only to a principal who

1. is the assignee, holds the task's claim, or holds one of its assigned roles — **and**
2. passes an access check on every entity the task is bound to (entity-**type** view feature plus tenant/organization scope; there is no record-level ACL in the platform and this change does not add one).

**This is a security-semantics change to an already-shipped, STABLE API surface, and `BACKWARD_COMPATIBILITY.md` has no rule covering that case.** It is not claimed to be covered by one. It ships as an intentional, documented behavior change with the full package: a spec section, this entry, an opt-out bridge that satisfies the deprecation protocol's "keep the old behavior alongside the new one for at least one minor version", and a dedicated security review (`.ai/runs/2026-07-28-workflows-task-visibility/SECURITY-REVIEW.md`) that was a release precondition. Proposing a 14th contract-surface category for route authorization semantics is itself a contract change and is raised separately, not merged here.

**What a deploying tenant will observe change**

| Population | Before | After |
|---|---|---|
| `admin` (`workflows.*`) and superadmins | see all tasks | **unchanged** — the wildcard matches the three new features |
| An employee who is an assignee or role-queue member | saw every task in the organization | **sees only their own work and their role queues.** This is the headline change and the one your support inbox will hear about. |
| An employee assigned nothing | saw every task in the organization | **sees an empty inbox** |
| Anyone completing someone else's task | possible | **refused** (`409 TASK_ASSIGNED_TO_ANOTHER_USER`) |
| Anyone claiming a role queue they do not belong to | possible | **refused** |
| A task with no assignee, no claim and no role queue | anyone with `workflows.tasks.complete` could finish it | **nobody can finish it** — `403 TASK_NOT_ACTIONABLE`; reassign it first |
| A cross-tenant task id on claim | mutated the foreign row, then failed | **404, with no write** |
| Agent-disposition tasks | visible to `workflows.tasks.view` holders | visible to `agent_orchestrator.proposals.view` holders (seeded on `admin`/`employee`/`operator`/`engineer`) |
| A notification deep link to your own task | worked | **works** — single-task read is relationship-based |
| Rows written before entity bindings existed (zero bindings) | — | the entity gate is a **no-op** for them; only the assignment gate applies |

**What you need to do**

- **Nothing, if you use the seeded roles.** `admin` holds `workflows.*`, which matches the three new administration features automatically; `employee` keeps its own work.
- **Grant `workflows.tasks.view_all`** to any role whose members must see other people's tasks (supervisors, support).
- **Grant `workflows.tasks.reassign`** to roles that move work between people. This is now the only supported way to act on someone else's task: an administrator with `view_all` can *see* a task but not complete it — they reassign it to themselves first, with a reason, and the move is audited (`reassigned_by` / `reassigned_at` / `reassign_reason` plus a `USER_TASK_REASSIGNED` workflow event).
- **Grant `workflows.tasks.manage`** for force-unclaim, cancel, bulk operations and the tenant setting below.
- **Then run `yarn mercato auth sync-role-acls`.** New tenants get the grants from `setup.ts`; **existing tenants receive nothing until this command runs.** Treat it as a required deploy step for this release.
- **Check any custom role that receives task assignments** still holds `workflows.view_tasks` (the pages) and `workflows.tasks.view` (the API). Both are in the seeded `employee` grant; a hand-built role may be missing them.

**New ACL features (additive):** `workflows.tasks.view_all`, `workflows.tasks.reassign`, `workflows.tasks.manage`. **No feature id was renamed or removed.** `workflows.tasks.view` is now the dependency root of all three — it admits you to the task API, and the visibility rule decides which rows you get. `workflows.tasks.claim` / `.complete` stay on their routes (a deliberate deviation from the spec's ACL-appendix sentence, which proposed dropping them: removing them would strand two FROZEN ids that no route consults, and the sentence's purpose — portal parity — is served by the new `portal.tasks.*` features instead). Holding `.complete` no longer completes anyone else's task, which is the narrowing §6.4 actually asks for.

**Escape hatch (temporary).** Set the tenant setting `task_permissions_business_context` to `false` (module `workflows`; `PUT /api/workflows/task-settings`, requires `workflows.tasks.manage`) to restore the **read** filter you had before. It restores reads only: completing someone else's task, claiming a queue you do not belong to, and cross-tenant access remain refused, and the portal task routes ignore the setting entirely. A settings read that fails defaults to the **new** model, never the permissive one. **The flag is a migration aid and is removed one minor release from now.**

**New API routes, none removed, no response field dropped.** `POST /api/workflows/tasks/[id]/reassign`, `GET`/`PUT /api/workflows/task-settings`, and the portal trio `GET /api/workflows/portal/tasks`, `GET …/[id]`, `POST …/[id]/complete`. `serializeUserTask` gains `assigneeKind` and `entityTypes` and remains a strict superset.

**New portal surface.** Portal principals can now be task assignees and act on their own bound tasks, through the new customer features `portal.tasks.view` / `portal.tasks.complete`. Two caveats:

- **Existing tenants need one command.** `setup.ts` `defaultCustomerRoleFeatures` is merged into seeded customer roles during *tenant setup* only, so run `yarn mercato customer_accounts sync-customer-role-acls [--tenant <id>]` — the customer-role counterpart of `auth sync-role-acls`. It is idempotent, additive (never revokes a hand-added feature), wildcard-aware (a role holding `portal.*` gains nothing redundant), and never creates roles.
- `CustomerRbacService` caches ACLs for **five minutes**, so a fresh grant is not immediately visible to a signed-in portal user.

The backoffice task routes were **not** loosened for portal principals — a portal session still gets 401/403 there — and a portal task with **no** entity binding is visible to nobody by design (on the portal the binding to your own record *is* the authorization; on the backoffice an absent binding passes vacuously, which is what keeps the pre-existing task corpus readable). Authoring a portal task currently means setting `userTaskConfig.assigneeKind: "customer"` in the Studio's **Code view** — there is no inspector picker yet.

**New event id (additive):** `workflows.task.portal_assigned`, `portalBroadcast: true`, carrying `{ taskId, recipientUserId, tenantId, organizationId }` and nothing else. It is deliberately a separate event rather than `portalBroadcast` on `workflows.task.assigned`: the portal SSE bridge narrows to one recipient only when the payload carries `recipientUserId`, which `workflows.task.assigned` does not — broadcasting it would have leaked task names and entity bindings across customers.

**Schema (additive) — migration `Migration20260728163001_workflows`.** `user_tasks.assignee_kind varchar(20) NOT NULL DEFAULT 'user'` discriminates a backoffice user id from a portal principal id in `assigned_to` (existing rows backfill to `'user'`), and `user_tasks.entity_types text[]` (nullable, **GIN**-indexed) denormalizes the bound entity types so the visibility rule is a `WHERE` rather than a post-filter that would make `pagination.total` lie. No column was renamed or removed. *(The generator emitted a btree for `entity_types`; the migration writes the GIN index by hand, as `workflow_definitions_definition_gin_idx` already does.)*

**Bugs fixed in the same release, previously exploitable:** claiming a task belonging to another tenant wrote to that tenant's row before failing; completing did not check the assignee; claiming did not check that the caller held one of the task's assigned roles.

**Known limits, stated rather than implied.** Role queues still match on role **names**, not ids — names are server-derived so they are not client-spoofable, but they are tenant-mutable, and renaming a role silently orphans assignments authored against the old name. Entity access is entity-**type** access plus scope: there is no per-record check. The backoffice task page still renders the Complete button for a `view_all` administrator (the detail response carries no `canComplete`) and has no reassign control — the refusal is enforced server-side, but the UI currently offers an action it cannot perform. All four are recorded in the security review with follow-ups.

Full model, including the fail-closed rules and the 404-vs-403 policy: [`apps/docs/docs/framework/workflows/task-visibility.mdx`](apps/docs/docs/framework/workflows/task-visibility.mdx).

### Workflows UX Phase 4a: task inspector, Work Inbox, deadlines and task notifications

Phase 4a makes workflow user tasks workable end to end (`.ai/specs/2026-07-26-workflows-ux-redesign.md` §6.1–§6.3, §2.3): a real task inspector, a Work Inbox assembled from registered sources rather than a single-table list, entity context where the work is, deadlines that actually fire, and notifications that are actually sent. The inbox is a **projection** over the existing `user_tasks` rows — no new table, no data migration.

**Four behavior changes to read before upgrading.** Each is a bug fix, and each changes what a definition you already authored does:

1. **Role assignment now persists.** `userTaskConfigSchema` did not declare `assignedToRoles`, `formKey` or `allowedActions`. The editor wrote them and the engine read them, but zod strips undeclared keys and the definitions POST/PUT persist the *parsed* value — so role assignment authored in the Studio was **silently discarded on every save**, and the task came out queued to nobody. It is now declared and survives the round trip. *Action:* definitions saved before this release may have lost their role queue. Re-open any USER_TASK step that should be role-queued, re-pick the roles, and save.
2. **`PT30M` now means thirty minutes.** The task deadline used a naive duration parser that turned any `PT…`-style value into roughly a day. Durations now go through the module's shared ISO 8601 duration utility. *Action:* review `slaDuration` / `deadline` values on existing definitions — tasks that appeared to have a day now have the deadline that was actually written.
3. **Task assignment notifications now fire at all.** `workflows.task.assigned` was declared and subscribed but never emitted, its deep link pointed at a route that did not exist, and role-assigned tasks notified nobody. Assignees — including everyone in a role queue — now receive an in-app notification per created task. *Action:* expect notification volume where there was none. Two more notification types ship alongside it (below).
4. **A variable pill in a task title or instructions now interpolates.** A step name containing a resolvable `{{context.*}}` value is filled in at task creation where it previously persisted verbatim. Pill-free configs are byte-identical.

What else changed, and what you need to do:

- **`/backend/tasks` is now a bridge route, not a deletion.** It forwards to `/backend/work-inbox`, keeps its `page.meta.ts` RBAC guard (`workflows.view_tasks`), and only gains `navHidden` so the sidebar lists the inbox once. It stays in place for **at least one minor release**. **Task detail urls are untouched** — `/backend/tasks/<id>` still resolves and is still where a task is completed.
- **The DataTable id is unchanged: `workflows.tasks.list`.** Every `data-table:workflows.tasks.list:*` widget you inject — columns, row actions, bulk actions, filters — keeps firing on the new page, and a work-inbox row is a strict superset of the row the task list emitted, so a row action reading `proposalId`, `taskName`, `dueDate` or any other task field keeps working with no change.
- **New API routes, none removed.** `GET /api/workflows/work-inbox` (merged, filtered by kind/module/entityType/role/priority/status/overdue/myWork, ordered by priority → due date → age, `limit` capped at 100), `POST /api/workflows/work-inbox/next` (claim-next) and `POST /api/workflows/tasks/[id]/unclaim` (release a claim). **`GET /api/workflows/tasks` is unchanged** and keeps its full response shape.
- **New extension point: `WorkInboxSourceProvider`.** A module contributes work items to the inbox by calling `registerWorkInboxSources([{ moduleId, sources }])` from its own `di.ts` (`@open-mercato/core/modules/workflows/lib/work-inbox/provider`). Registration merges by module id, so order between modules does not matter, and a module that registers nothing simply contributes nothing — the inbox degrades to workflow tasks with no error. A provider whose `list()` throws is reported in the response's `meta.degradedKinds` instead of failing the whole page.
- **New DI key `workInboxService`** (`listWorkInbox`, `listClaimableWorkInbox`). Additive; nothing resolves it implicitly.
- **`claimUserTask` is now a compare-and-set.** It previously read the row with `status: 'PENDING'` and then flushed the entity, so two concurrent callers could both read `PENDING` and both write. It now takes the row with a conditional `UPDATE … WHERE status = 'PENDING' AND claimed_by IS NULL` and raises the same `TASK_NOT_FOUND` (`'Task not found or already claimed'`) when it affects zero rows. Every error code, message and scoping guarantee is unchanged; the only behavior difference is that a losing racer now reliably loses instead of overwriting the winner.
- **`claimUserTask` now verifies queue membership, and takes the caller's role names.** Holding `workflows.tasks.claim` admitted a caller to the endpoint and, until now, to *any* role queue — a user could claim a task queued to a role they do not hold. The handler now compares the task's `assignedToRoles` against the caller's server-derived `auth.roles` and refuses a non-member with the existing `TASK_NOT_FOUND` (`'Task not found or already claimed'`), byte-identical to the refusal a nonexistent id produces, so a queue you do not belong to is indistinguishable from a task that is not there. **Signature change:** `claimUserTask(em, taskId, userId, scope, callerRoleNames)` gains a required fifth parameter (`TaskHandlerService.claimUserTask` likewise). It is required rather than optional on purpose — a caller that cannot supply role names fails to compile instead of silently claiming any queue. *Action:* a third-party module calling `claimUserTask` directly must pass `auth.roles ?? []`. Both sides are role **names**, not ids (the Studio picker writes names and the engine copies them onto the task), so renaming a tenant role orphans existing role assignments; migrating the comparison to immutable role ids is separate, coordinated work.
- **New `user_tasks` columns + migration `Migration20260728104038_workflows`.** All nullable and additive: `entity_bindings` (jsonb — the records a task is about, resolved at creation), `priority` (varchar(20) — authored `low|medium|high|extreme`), and the reassignment audit trio `reassigned_by` / `reassigned_at` / `reassign_reason`. **No `UserTaskStatus` value was added**: reassignment is audit columns plus a workflow event, and a routed deadline breach reuses the existing `ESCALATED` status. Ship the migration as usual; nothing backfills, and rows written before it read exactly as they did.
- **New event ids (additive; §5 of `BACKWARD_COMPATIBILITY.md` allows adding, never renaming).** `workflows.task.reminder_due` and `workflows.task.deadline_breached` join the already-declared `workflows.task.assigned`, which is now actually emitted. All three are `persistent: true` with at-least-once delivery — **subscribers must be idempotent**. `workflows.task.assigned` additionally carries `entityBindings`, which is how a module that owns those records surfaces the task on its own turf: the customers module subscribes to it and writes its own `CustomerTodoLink` with `todoSource: 'workflows'`. Workflows never writes another module's table.
- **New notification type ids** (FROZEN surface, add-only): `workflows.task.reminder_due` and `workflows.task.deadline_breached`, beside the existing `workflows.task.assigned`.
- **New `userTaskConfig` keys, all optional.** `instructions`, `entityBindings`, `priority`, `deadline`, `reminders`, `onBreach`, `decisions`, `editablePrefilled` — plus the three that were being stripped (`assignedToRoles`, `formKey`, `allowedActions`). A config declaring none of them parses to exactly what it parsed to before. `deadline: { duration }` is a superset of `slaDuration`, which keeps working forever; newly authored deadlines write `deadline`, existing configs keep their own key untouched with no migration.
- **`escalationRules` is still dead config.** It is accepted, carried through the editor and round-tripped, but nothing executes it — it never did. Use `deadline` + `reminders` + `onBreach` instead.
- **New extension point: task form renderers.** `registerTaskFormRenderer({ formKey, Renderer, … })` from `@open-mercato/core/modules/workflows/lib/task-form-registry` binds a component to a step's authored `userTaskConfig.formKey`. Duplicate registration throws (like `registerActivityType`); an *unknown* key never throws — the surface falls back to the built-in form and says so.
- **Notification quick actions are constrained on purpose.** A task notification offers a one-click **Complete** button only when the completion is unambiguous: at most one decision button, no form fields and no editable-prefilled fields. The platform's notification-action contract passes only the notification's `sourceEntityId` into the command and drops the `actionId`, so *which* button was pressed cannot reach the completion — with two decisions a quick action would be guessing. Everything else gets the deep link, which is always present regardless.
- **The pending-work record-page panel is enumerated coverage, not universal.** There is no generic record-detail spot id in the platform, so it is wired one line at a time: `detail:customers.person:footer`, `detail:customers.company:footer`, `detail:customers.deal:footer` and `sales.document.detail.order:tabs`. Adding another host page means adding a line to the workflows injection table — the widget itself reads `resourceKind` + `resourceId` from the host's injection context and needs no change. The order page keeps its existing inline `order-approval` widget in the `:details` column; the panel goes on `:tabs` beside it.
- **A task in a parallel branch does not follow its SLA-breach route.** A branch advances on its own token, and overriding that is a parallel-execution change rather than a task-surface one. The breach is still recorded and the skip is logged as `route_skipped_branch`.
- **No ACL change.** The new routes reuse `workflows.tasks.view` and `workflows.tasks.claim`; the page keeps `workflows.view_tasks`.

### Workflows UX Phase 3b: the form editor is retired behind redirects to the Studio

The workflow definition **form editor is retired** (`.ai/specs/2026-07-26-workflows-ux-redesign.md` §10). The visual editor ("Studio") at `/backend/definitions/visual-editor` is now the only workflow authoring surface — it reached the retirement precondition when the Code view (read-only definition JSON + subgraph copy/paste + schema-validation display) shipped in the same release.

What changed, and what you need to do:

- **The two form routes are now bridge routes, not deletions.** `/backend/definitions/create` forwards to `/backend/definitions/visual-editor`, and `/backend/definitions/<id>` forwards to `/backend/definitions/visual-editor?id=<id>`. Both route files and both `page.meta.ts` guards stay in place for **at least one minor release**, so bookmarks, deep links and any third-party navigation keep working with the same RBAC as before. Update your links at your convenience; nothing breaks today.
- **The definitions list has one create entry and one edit row action.** "Create Workflow" opens the template gallery (whose *Blank* card lands on the empty Studio) and the row action `edit` now points at the Studio. The separate `edit-visual` row action was removed because it became a duplicate destination — if you keyed automation or tests off that row-action id, switch to `edit`.
- **The form components are `@deprecated`, not removed.** `components/formConfig.tsx` (every export), `components/StepsEditor.tsx`, `components/TransitionsEditor.tsx` and `components/mobile/MobileDefinitionDetail.tsx` still compile and still behave identically, so a downstream page that embeds the definition form keeps working. They are scheduled for removal **one minor release after this note**; migrate such pages to the Studio (or to the definitions API directly) before then.
- **No API, schema, event or ACL change.** The definitions REST contract, the definition JSONB shape and `workflows.*` features are untouched — this is a UI-surface retirement only.

### Workflows UX Phase 2a: context schema, ledger, pinned samples, mock-first test step

Phase 2a of the workflows UX redesign (`.ai/specs/2026-07-26-workflows-ux-redesign.md`) is additive, but four items deserve downstream attention:

- **New ACL feature `workflows.definitions.test_run`** gates the new mock-first `POST /api/workflows/definitions/[id]/test-step` endpoint (`dependsOn: workflows.definitions.edit`). The default `admin` grant (`workflows.*`) already covers it via wildcard matching; if you grant workflow editing to other roles and want them to test steps, add the feature to those roles and run `yarn mercato auth sync-role-acls` so existing tenants receive it.
- **`metadata.editor.samples` stores pinned per-step sample context UNREDACTED.** Pins live inside the definition's metadata, capped at 64 KB total (`WORKFLOW_EDITOR_SAMPLES_MAX_CHARS`), with no redaction or encryption — anything a user pins (including real customer data) is stored verbatim and visible to anyone who can read the definition. The editor warns at pin time; establish a team policy (fake/representative values only) before using pins on definitions that process sensitive data.
- **Definition 400 bodies now carry enriched `details` entries.** Schema failures on the definitions POST/PUT keep `{ error: 'Validation failed', details: [...] }` with `path` + `message` intact, and each entry additionally carries `code` and, where derivable, `expected`/`got`. Additive — existing parsers keep working.
- **New optional `contextSchema` field on the definition payload** declares typed workflow inputs (same field vocabulary as user-task form schemas) and feeds the editor's context ledger and variable picker. Additive — definitions without it behave exactly as before.

### Workflows UX Phase 1: activity registry, per-type config warnings, SET_VARIABLE, drafts table

Phase 1 of the workflows UX redesign (`.ai/specs/2026-07-26-workflows-ux-redesign.md`) lands several changes downstream authors should know about:

- **Per-type activity-config validation now runs on save and surfaces as editor/API WARNINGS.** Each activity's `config` is checked against its registered zod schema; failures are returned as non-blocking warnings, never schema errors, so legacy definitions that predate per-type validation keep saving unchanged. Strict (blocking) mode arrives later as an opt-in.
- **New `SET_VARIABLE` activity type.** Writes `{ path, value }` assignments at dot paths into top-level workflow context (not namespaced under the activity name). Additive — no action required.
- **`CALL_API` marked `async: true` is now refused at enqueue time** with a clear error (`Activity type CALL_API cannot run asynchronously`). Previously the job enqueued and failed opaquely in the background worker because the activity mints a per-request auth key that cannot cross the queue boundary. Definitions that relied on this never worked — remove the `async` flag from `CALL_API` activities.
- **New `workflow_definition_drafts` table** backs per-user editor autosave (unique per definition+user+tenant). Run the migrations (`yarn db:migrate`) when upgrading — the workflows module ships `Migration20260727074335_workflows.ts`.

Activity types themselves are now registry-driven (`registerActivityType` in `packages/core/src/modules/workflows/lib/activity-registry.ts`); see `apps/docs/docs/framework/workflows/extending.mdx` for the new extension recipe. Existing STABLE executor exports are unchanged.

### Scheduler queue targets now deliver one flat payload contract in both execution modes (#4221)

The local scheduler used to wrap a scheduled queue target's configured `targetPayload` in an undocumented envelope (`{ scheduleId, scheduleName, scopeType, tenantId, organizationId, payload: { …targetPayload }, triggeredAt }`), while the asynchronous execute-schedule worker already spread `targetPayload` onto the worker payload root. Both paths now build their payload through one scheduler-owned helper (`packages/scheduler/src/modules/scheduler/lib/queueTargetPayload.ts`) and deliver the documented flat contract:

```ts
{ ...targetPayload, tenantId, organizationId, _idempotencyKey }
```

Scheduler-owned `tenantId`/`organizationId`/`_idempotencyKey` are applied after the spread, so they always win over conflicting `targetPayload` fields. Scheduler execution metadata (`scheduleId`, `scheduleName`, `scopeType`, `triggeredAt`) is no longer injected into the application payload. The async worker's idempotency key is now derived from the retry-stable execute-schedule job id instead of `Date.now()`, so BullMQ retries of one logical firing reuse the same `_idempotencyKey`.

**Action for downstream:** workers written to the documented flat contract need no change and now also work under the local scheduler. A worker that relied on the undocumented local envelope (reading `job.payload.payload.*` or `scheduleId`/`scheduleName`/`triggeredAt` from the payload) must switch to the flat fields; include any identifiers it needs in `targetPayload` when registering the schedule.

## 0.6.5 → 0.6.6 (unreleased)

### Standalone apps: optimistic-lock guard restored; `src/di.ts` now requires explicit bootstrap wiring (#4201)

Two related DI defects affected standalone (npm) apps:

1. **The default OSS optimistic-lock guard was silently disabled.** The request container is built in Awilix CLASSIC injection mode, and the guard's factory destructured a renamed parameter (`({ em: scopedEm })`), which CLASSIC cannot resolve. The resolution error was swallowed, so every `makeCrudRoute` PUT/DELETE ignored the `x-om-ext-optimistic-lock-expected-updated-at` header and stale writes returned `200` instead of `409`. *Action for downstream:* none — upgrading `@open-mercato/shared` restores the guard. A failed guard resolution now logs a warning (once per process) instead of failing silently.

2. **`src/di.ts` `register()` never ran in standalone apps.** The `@/di` dynamic import inside the published package does not resolve to the app's `src/di.ts`, so the documented app-level DI override hook was dead. Apps now wire it explicitly from `src/bootstrap.ts`. *Action for downstream:* apps scaffolded before 0.6.6 that want `src/di.ts` to work must add the wiring to their `src/bootstrap.ts` (new scaffolds include it):

```ts
import { register as registerAppDi } from '@/di'

export const bootstrap = createBootstrap(
  { /* existing generated data */ },
  { appDiRegistrar: registerAppDi },
)
```

Additionally, two core-module registrations that destructured factory parameters without opting into per-registration PROXY resolution (`catalogPricingService`, `notificationService`) silently received `undefined` dependencies under CLASSIC mode; both now chain `.proxy()`. *Action for downstream:* none, but if your own module's `di.ts` registers `asFunction(({ dep }) => ...)`, chain `.proxy()` (or take plain named parameters) — a guard test (`packages/core/src/__tests__/di-classic-proxy.test.ts`) now enforces this for in-repo modules.

### Opt-in per-entity ACL for custom-entity records (#3857)

Follow-up to the #2612 records-API hardening, which deliberately left custom/EAV entities on the coarse `entities.records.view` / `entities.records.manage` path. Those two features were **entity-agnostic**: any holder could read/modify/delete records of *every* custom entity in their tenant, so sensitive custom entities (salaries, board minutes) could not be compartmentalized from ordinary ones (intra-tenant horizontal privilege; cross-tenant was already blocked).

Custom entities can now be flagged **`access_restricted`**. The change is **additive and default-off**, so existing entities and grants behave exactly as before — no migration, no lockout:

- **Unrestricted (default):** unchanged — the coarse route feature is the whole authorization.
- **Restricted:** `assertEntityAclForRequest` additionally requires a **synthesized per-entity feature** `entities.records.<entityId>.view` / `entities.records.<entityId>.manage` (e.g. `entities.records.hr:salaries.view`). The coarse feature alone no longer grants it; `entities.records.*`, `entities.*`, and super-admin still do (normal wildcard semantics).

Grant the per-entity features in the Role/User ACL editor — `GET /api/auth/features` now appends them for the calling tenant's restricted entities. New DB column `custom_entities.access_restricted` (`boolean not null default false`, migration `Migration20260716120000`). Toggle it per entity on the custom-entity create/edit page, or declare `accessRestricted: true` in a module's `ce.ts` `CustomEntitySpec`. An optional tenant policy `entities.newEntitiesRestrictedByDefault` (module config, default off; read/set via `GET/PUT /api/entities/entity-settings`) makes new entities restricted-by-default for tenants that want deny-by-default.

*Action for downstream:* none to keep current behavior. **If you flag an in-use entity as restricted, existing coarse-feature holders lose access to it** until granted the per-entity feature — this is the intended compartmentalization. If you ship a sensitive custom entity via `ce.ts`, set `accessRestricted: true` and grant the per-entity features to the roles that should see it. See [`.ai/specs/2026-07-16-custom-entity-record-acl-per-entity.md`](.ai/specs/2026-07-16-custom-entity-record-acl-per-entity.md).

### Skills install into the canonical `.agents/skills/` directory (#4155)

`yarn install-skills` (monorepo) and `mercato agentic:init` / `yarn install-skills` (standalone apps) used to write every skill into each agent's own folder — local tier skills were symlinked into both `.claude/skills/` and `.codex/skills/`, and external skills landed in `.agents/skills/` **plus** `.claude/skills/` **plus** a hand-made `.codex/skills/` mirror: three copies of the same skill.

Skills now install **once**, into the canonical cross-agent directory `.agents/skills/`. An agent only gets its own per-skill symlinks when it cannot read that directory: Claude Code does (automatic, unchanged for its users), while Codex and Cursor read `.agents/skills/` natively and no longer get a `.codex/skills/` or `.cursor/skills/` directory at all. Scaffolded apps no longer seed `.codex/skills` / `.cursor/skills` symlinks either.

All existing flags and exit behavior of `yarn install-skills` are unchanged; the new flags are additive. Only gitignored dev-tooling directories are affected — no application code, no committed files.

Contributor action:

- Re-run the installer once so stale `.codex/skills/` (and any `.cursor/skills/`) links from the old layout are swept away:

  ```bash
  yarn install-skills --clean && yarn install-skills
  ```

  A plain `yarn install-skills` also self-heals (it sweeps the legacy per-agent links); the `--clean` form just makes it explicit.
- If a setup still depends on the old layout, `yarn install-skills --legacy-links` restores it.
- To keep an agent's directory from being written at all, pass `--ignore-agents <csv>` or add a persistent `{ "agents": { "ignore": ["cursor"] } }` block to `.ai/skills/tiers.json`.
### Dev-environment starters moved to `starters/`; hybrid mode is the new default

The dev-environment startup surface was consolidated into a top-level [`starters/`](starters/README.md) directory, and the default dev mode changed to **hybrid**: the app and the MCP server run natively on your machine (`yarn dev` now starts both), while OpenCode + postgres/redis/meilisearch run in containers. The fully containerized stack remains as the enterprise path. See `.ai/specs/2026-07-17-hybrid-dev-runtime-and-starters.md`.

Breaking changes (no old-path shims):

- **Compose files moved and were renamed** — `docker-compose.yml` → `starters/docker/compose.infra.yml`, `docker-compose.fullapp.dev.yml` → `starters/docker/compose.fullapp.dev.yml`, `docker-compose.fullapp.yml`, `docker-compose.fullapp.traefik*.yml`, and `docker-compose.preview.yaml` → `starters/docker/compose.{fullapp,fullapp.traefik,fullapp.traefik.dev,preview}.yml`. Bare `docker compose up` at the repo root no longer works. Always invoke via the wrapper scripts (`yarn infra:up`, `yarn docker:dev:up`, …) or the canonical form `docker compose --project-directory . -f starters/docker/compose.<x>.yml …` — the `--project-directory` flag is required to keep `.env` interpolation and relative paths anchored at the repo root.
- **Windows launcher moved** — `scripts\windows\start-windows.bat` (and siblings) → `starters\docker\windows\`. `.bat` copies from old clones self-download `start-dev.ps1` from a raw URL that 404s once the old path leaves `main`; re-clone or use the new path.
- **`scripts/setup-windows-dev.ps1`** → `starters/hybrid/windows-toolchain.ps1`.
- **verdaccio is now opt-in** — add `--profile registry` (it is no longer part of the default infra stack).
- **Containers created from the old layout**: the canonical `--project-directory .` invocation keeps the same compose project name, so existing `mercato-*` containers are adopted in place (verified — services whose config changed, like opencode, are recreated on the next `up`). Only if `up` complains about container names already in use (e.g. you used `-p` or a renamed checkout) run `docker compose down` from the old checkout or `docker rm` the `mercato-*` containers first. Named volumes (`mercato-postgres-data*`, …) are unchanged and reattach — no data loss.
- **`DOCKER_COMPOSE_FILE`** values pointing at old paths fail loudly with a hint; point them at `starters/docker/…`. Legacy root `docker-compose.*dev*.local.yml` personal overrides are still auto-discovered, and the new convention is `starters/docker/compose.*dev*.local.yml`.

Behavior changes in `yarn dev` (monorepo):

- It now **starts the MCP server** (port `MCP_PORT`, default 3001) and provisions its API key into `.mercato/mcp-shared/mcp-api-key` for the OpenCode container. Opt out with `yarn dev --no-mcp` or `OM_DEV_WITH_MCP=0`; `yarn dev:app` never starts it.
- It now **auto-applies pending migrations** at startup (best-effort — a failure warns and dev continues). Opt out with `OM_DEV_AUTO_MIGRATE=0`.

New entry points: `starters/hybrid/install.sh` (Linux/macOS) and `starters\hybrid\install.bat` (Windows) provision prerequisites (git, Node 24, corepack yarn) and install/start the hybrid stack end-to-end; `yarn infra:up` / `yarn infra:down` manage the infra containers.

External coordination: the Dokploy QA deployment config must switch `docker-compose.preview.yaml` → `starters/docker/compose.preview.yml` when this lands (see `.github/QA-DEPLOYMENT.md`).

### Shared `om-*` pipeline skills now come from open-mercato/skills

The generalized agent-pipeline skills (`om-code-review`, `om-auto-create-pr`, `om-auto-review-pr`, `om-merge-buddy`, `om-spec-writing`, the `-loop` variants, `om-prepare-issue`, and 15 more — see the `external` block in [`.ai/skills/tiers.json`](.ai/skills/tiers.json)) were removed from `.ai/skills/` and are now installed from the shared [open-mercato/skills](https://github.com/open-mercato/skills) collection. `yarn install-skills` runs `npx -y skills add open-mercato/skills --skill '*'` after the local tier symlinks, placing the skills under `.agents/skills/` (gitignored), then `npx -y skills update --project` so re-running the installer refreshes the external skills to their latest published versions (the lockfile is gitignored, so `add` seeds and `update` keeps them current).

Contributor action:

- Re-run `yarn install-skills` (network required for the npx step; pass `--no-external` or set `OM_SKIP_EXTERNAL_SKILLS=1` when offline — local tier skills still install).
- Repo-specific behavior for the external skills is configured in [`.ai/agentic.config.json`](.ai/agentic.config.json) (validation gate, labels, base branch), the tracker descriptor [`.ai/trackers/github.md`](.ai/trackers/github.md), the review checklist [`.ai/review-checklist.md`](.ai/review-checklist.md), and repo-local override skills under `.ai/skills/<external-name>/SKILL.md`.
- The local `om-auto-fix-github` skill has been removed and replaced by the external `om-auto-fix-issue` (installed under `.agents/skills/` from the shared open-mercato/skills collection). Update any `/om-auto-fix-github` callers to `/om-auto-fix-issue`.

### Rate-limit proxy trust now defaults to safe direct mode (#4041)

`RATE_LIMIT_TRUST_PROXY_DEPTH` now defaults to `0` instead of `1`. Direct deployments therefore ignore client-supplied forwarding headers and use endpoint-scoped `global` fallback buckets, so missing trusted IP data no longer disables auth, metadata-driven, or checkout throttles. Invalid, negative, and fractional depth values emit a warning and also fall back to `0`; forwarded chains shorter than an explicitly configured positive depth use the same bounded fallback.

**Action for proxied deployments:** set `RATE_LIMIT_TRUST_PROXY_DEPTH` to the exact number of trusted reverse proxies between the client and the app (for example, `1` for a single nginx/ALB hop). Without that explicit setting, all traffic shares each endpoint's configured fallback bucket, which is secure against header spoofing but can reduce availability under load. Direct deployments should leave the value unset or set it to `0`.


### Tenant-scoped search settings + verified provider availability (#3092)

Vector/fulltext search settings (Cmd+K strategies, embedding provider/model, auto-index flag) were stored in a single global `module_configs` row, so any tenant admin's save overwrote every tenant's configuration. Settings are now scoped per tenant: a tenant reads/writes only its own row and inherits the instance default (legacy global row) → env-derived default when unset. Four downstream-visible changes:

1. **Search settings are now tenant-scoped.** Settings `GET` responses gain a `source: 'tenant' | 'instance' | 'env'` field indicating where the effective value came from. *Action for downstream:* none for typical callers; clients must not assume one tenant's settings apply to another.

2. **`ModuleConfigService` gained an optional `scope` argument** on `getRecord`/`getValue`/`setValue`/`invalidate`. This is **additive** — every caller that omits `scope` keeps the exact prior behavior (the global row). `ModuleConfigRecord` gained additive `tenantId`/`organizationId`/`source` fields. *Action for downstream:* none; opt into per-tenant config by passing `scope` where you want it.

3. **`module_configs` schema change (additive).** Added nullable `tenant_id`/`organization_id` columns; replaced the single `(module_id, name)` unique constraint with two partial unique indexes (global `WHERE tenant_id IS NULL`, scoped `WHERE tenant_id IS NOT NULL`). Existing rows keep `tenant_id = NULL` and become the instance default; no backfill required. *Action for downstream:* apply the `configs` module migration (`Migration20260617150000`) before relying on tenant-scoped settings.

4. **Provider availability is now verified (behavior fix).** `isProviderConfigured('ollama')` previously returned `true` unconditionally. A new cached, fail-closed `embeddingProviderProbe` (additive DI key) actively checks Ollama via `GET {OLLAMA_BASE_URL}/api/tags` (key-presence for the other providers). The embeddings settings `GET` returns per-provider `available`/`reason`, and the embeddings `POST` rejects selecting an unreachable provider with `409 { error, reason }`. *Action for downstream:* environments that relied on Ollama always reporting "available" must ensure Ollama is actually reachable at `OLLAMA_BASE_URL` (which was already required for embedding to function).

All changes are additive at the contract surface. No event IDs, widget spot IDs, ACL feature IDs, import paths, or CLI commands changed. The vector index (shared pgvector table) remains instance-level; per-tenant scoping covers settings selection, not stored vectors. See [`.ai/specs/2026-06-15-tenant-scoped-search-settings.md`](.ai/specs/2026-06-15-tenant-scoped-search-settings.md) (tracking issue #3092).

### Versioned browser-storage envelopes for shared UI preference slots (#3457)

Several shared UI surfaces that persist client state to `localStorage` — DataTable perspective snapshots, the AppShell sidebar collapsed-groups set, the AI model picker selection, and the AI chat sessions cache — now write through a shared **versioned-envelope** helper (`packages/shared/src/lib/browser/versionedPreference.ts`) instead of bare JSON. On disk each of these slots now carries a `{ v, data }` shape with an explicit version discriminator, rather than the raw value it stored before.

**No manual action is required for end users.** The `localStorage` **keys are unchanged**, and `readVersionedPreference(...)` migrates a pre-envelope (legacy bare) value forward automatically on the next write when a `legacyIsValid` guard is supplied (as it is for every slot migrated in #3457). Stored data that is version-mismatched or malformed is safely discarded back to the documented fallback instead of crashing or silently corrupting UI state, so a downgrade/upgrade across this boundary simply re-derives defaults at worst.

**Action for module authors who read/write these persisted slots directly.** If your module reads or writes one of these shared `localStorage` keys (or adds its own structured preference slot), go through the helper rather than `safeLocalStorage`/raw `localStorage`:

```ts
import {
  readVersionedPreference,
  writeVersionedPreference,
  // readVersionedIdSet / writeVersionedIdSet for the common "set of ids" shape
} from '@open-mercato/shared/lib/browser/versionedPreference'

// read: validate the envelope, discard stale/mismatched data, migrate a legacy bare value forward
const value = readVersionedPreference(key, version, isValid, fallback, { legacyIsValid })
// write: wraps as { v: version, data: value }
writeVersionedPreference(key, version, value)
```

Follow the **versioning threshold** documented in [`packages/shared/AGENTS.md`](packages/shared/AGENTS.md) when deciding whether a slot needs an envelope: trivial scalar flags (a single boolean/number/string with no schema to evolve, e.g. `om:sidebarCollapsed`) MAY stay raw via `safeLocalStorage`; **structured values** (objects, records, arrays of objects whose shape can change incompatibly) MUST use a versioned envelope so a future shape change can migrate or discard old data. A slot that already carries its own inline `{ v, ... }` discriminator is already migratable and MUST NOT be re-wrapped — re-wrapping changes the on-disk format and discards existing user data.

This is a refactor with no API, event-ID, DI, or DB-schema contract change. Related: #3457 (this change), and the sibling persisted-storage audit tracked in #3174 / #3393.

### Selectable dev-mode watch scope (opt-in, default unchanged)

In the monorepo, `yarn dev` can now watch a **subset** of workspace packages instead of always watching every one. The default remains `all` (watch everything), so **no action is required** — existing `yarn dev` / `yarn dev:greenfield` runs behave exactly as before.

To opt in, pick a scope with the new `OM_WATCH_SCOPE` env var or the `--watch=<mode>` flag (CLI flag wins over the env var):

- `all` (default) — watch every package.
- `auto-optimized` — watch only packages your git working tree / current-branch diff touched, re-checking every 2 minutes and expanding to newly-touched packages.
- `popular` — watch only the most frequently changed packages from recent `git log` history (`OM_WATCH_POPULAR_LIMIT`, default 6; falls back to `core`, `ui`, `shared`).
- `env` — watch exactly the packages in `OM_WATCH_PACKAGES`, or the selection saved by the interactive picker (`yarn dev:watch-select`, persisted to the gitignored `.mercato/watch-packages.local.json`).

```bash
yarn dev --watch=auto-optimized
OM_WATCH_SCOPE=env OM_WATCH_PACKAGES=core,ui yarn dev
yarn dev:greenfield --watch=popular
```

Additional knobs: `OM_WATCH_GIT_STATUS`, `OM_WATCH_GIT_BRANCH`, `OM_WATCH_BASE_REF`, `OM_WATCH_POPULAR_LIMIT`. This is purely a local dev-DX feature: no API, event-ID, DI, ACL, or DB-schema contract changed, and the app source is still fully watched by Next.js/Turbopack regardless of scope. Standalone create-app projects do not run the workspace-package watcher in normal use. See [the troubleshooting guide](apps/docs/docs/appendix/troubleshooting.mdx) for the full reference.

### Attachment organization fix ships with an opt-in reconciliation you must enable to heal existing data (#3765)

`POST/GET/DELETE /api/attachments` and the file/image serve routes now scope by the **currently selected** organization instead of the uploader's pinned home organization. This is a forward-only bug fix — new uploads land under the right org. **Attachments that were already written under the wrong organization while the bug was live are not healed automatically**, and because reads are now scoped to the selected org they become *invisible* to org-scoped surfaces (product/variant media aggregation, list, file/image serve) until reconciled.

The heal is delivered as a version-gated **Upgrade Action** (`attachments.reconcile-organization`, version `0.6.6`) that resets each attachment's `organization_id` to its parent record's org. **Upgrade Actions are disabled by default**, so no data changes on deploy — you must opt in:

1. **Enable Upgrade Actions.** Set the server flag so the action can run, and the public flag so the admin banner renders:

   ```bash
   UPGRADE_ACTIONS_ENABLED=true            # server: required to list + execute actions
   NEXT_PUBLIC_UPGRADE_ACTIONS_ENABLED=true # client: required for the admin CTA banner to appear (build-time inlined)
   ```

   The action is also gated on the running app version being ≥ `0.6.6`.

2. **Run it, one of two ways** (both require the `configs.manage` feature and act **per tenant**; the pass is idempotent, tenant-scoped, and only ever changes `organization_id` — never `tenant_id`, so nothing moves across tenants):
   - **UI:** a `configs.manage` admin clicks the **"Reconcile attachment organizations"** CTA in the upgrade banner.
   - **Manually via the API** (only `UPGRADE_ACTIONS_ENABLED=true` is needed for this path — the public flag is only for the banner):

     ```bash
     curl -X POST https://<host>/api/configs/upgrade-actions \
       -H 'content-type: application/json' \
       --cookie '<authenticated configs.manage session>' \
       -d '{"actionId":"attachments.reconcile-organization"}'
     ```

   Attachments whose parent record's org cannot be resolved (custom/legacy `entityId`s, hard-deleted parents, the virtual `attachments:library` entity) are counted and **left untouched** — nothing is deleted or blanked. Re-running after already-correct data is a no-op (`already_completed`).

*Action for downstream:* if you ran a multi-org setup on an affected build, enable Upgrade Actions and run `attachments.reconcile-organization` once per tenant to heal misfiled attachments; a self-hoster with single-org or clean data can leave Upgrade Actions off. No contract surface changed (the reconciliation helper and upgrade-action entry are additive). See [`.ai/specs`](.ai/specs/) and issue #3765.

### Removed — `MODULE_FACTS_ALLOWLIST` export (module fact-sheet auto-discovery) (#3752, #3798, #3754)

The module fact-sheet generator no longer gates on a hard-coded 9-module allowlist. It now **auto-discovers** every source-available package module: the `create-app` build (and `mercato agentic:init`) bundle a fact-sheet for every package-provided module (`discoverPackageModuleSources`), shipped to scaffolded apps as `.ai/guides/module-facts.json` + per-module sheets. The monorepo no longer emits a committed `apps/mercato/src/module-facts.generated.json` — that artifact had no runtime or test consumer and has been removed along with its generator (`generateModuleFacts`) and the unused registry-driven `discoverEnabledModuleSources` path.

- **Removed (#3754):** `MODULE_FACTS_ALLOWLIST` and `ModuleFactsModuleId` (previously exported from `@open-mercato/cli/lib/generators/module-facts`) are **gone**. Their only remaining runtime consumer was the legacy `core.<module>.md` redirect-stub loop, retired in the same change. Because the whole fact-sheet auto-discovery layer is still `Unreleased` (it never shipped in a tagged release), the exports are removed outright with no deprecation window.
- **Additive, non-breaking API:** `extractModuleFacts` gained an optional `moduleRoot`, and `extractAllModuleFacts` gained an optional `sources`. The legacy `{ coreSrcRoot, moduleIds? }` call shape still works, but with `MODULE_FACTS_ALLOWLIST` gone it no longer falls back to the historical 9-module list — pass an explicit `moduleIds` (or the preferred `sources`) instead.

*Action for downstream:* callers that imported `MODULE_FACTS_ALLOWLIST` to enumerate documented modules must instead read the keys of the bundled `.ai/guides/module-facts.json` (or call `discoverPackageModuleSources` from `@open-mercato/cli/lib/generators/module-facts-discovery`). No tagged release ever exported these names, so no in-the-wild code depends on them. See [`.ai/specs/2026-07-06-module-facts-auto-discovery.md`](.ai/specs/2026-07-06-module-facts-auto-discovery.md).

### Removed — per-module standalone AI guides → generated fact-sheets (#3715, #3754)

The hand-written per-module standalone guides that shipped into scaffolded apps as `.ai/guides/core.<module>.md` (for the user-facing core modules `auth`, `catalog`, `currencies`, `customer_accounts`, `customers`, `data_sync`, `integrations`, `sales`, `workflows`) are replaced by two layers:

- **Generated per-module fact-sheets** — `.ai/guides/modules/<module>.md` plus a combined `.ai/guides/module-facts.json` sidecar, extracted from module source (entities, events, ACL features, API routes with per-method auth, DI service tokens, searchable entities, host extension tokens, notifications, CLI) at build time.
- **One hand-written conceptual guide** — `.ai/guides/module-system.md`, covering the timeless module-system concepts (anatomy, auto-discovery, naming, mandatory mechanisms, data integrity, migrations).

*Action for downstream:* reference `.ai/guides/modules/<module>.md` for a module's concrete facts and `.ai/guides/module-system.md` for conceptual guidance. The legacy `.ai/guides/core.<module>.md` redirect stubs that briefly bridged the old names were **retired outright in #3754**: because they never shipped in a tagged release (the whole layer is still `Unreleased`), they were removed with no deprecation window rather than kept for a minor. Freshly scaffolded apps already link only the new paths. See [`.ai/specs/2026-06-27-ts-morph-module-fact-sheets.md`](.ai/specs/2026-06-27-ts-morph-module-fact-sheets.md).

---

## 0.6.3 → 0.6.4 (2026-06-08)

### Tenant-ownership & per-module ACL authorization hardening (#2612)

Closes a class of Broken Access Control (OWASP A01 / BOLA+BFLA) defects where the platform checked *capability* (route `requireFeatures`) but not *object/target-module ownership* before reading or mutating. Three downstream-visible changes:

1. **Generic entity-records API now enforces the target module's ACL.** `GET/POST/PUT/DELETE /api/entities/records` (and CSV/export) previously authorized with only `entities.records.view` / `entities.records.manage`. They now also require the **owning module's** feature for the requested `entityId` (e.g. `directory.tenants.view` for `directory:tenant`, `customers.people.view` for `customers:customer_person_profile`), resolved from an explicit registry in `packages/core/src/modules/entities/lib/entityAcl.ts`. **Custom/EAV entities are unaffected** — they keep the existing `entities.records.*` + tenant-scope path. **Unmapped ORM-backed entities are fail-closed (super-admin only).** *Action for downstream:* if you exposed a custom **ORM-backed** entity through this generic API, add an entry to the `entityAcl` map (module + view/manage features) or callers without the owning feature will receive `403`.

2. **Public org-slug lookup no longer returns `tenantId`.** `GET /api/directory/organizations/lookup?slug=…` now returns `{ ok, organization: { id, name, slug } }` — the internal `tenantId` field was removed (it was an unauthenticated information leak). The platform-domain customer-portal login/signup flow now resolves the tenant **server-side from `organizationId`** via `resolveTenantContext`. *Action for downstream:* portal clients that read `tenantId` from this response must instead send the org's `id` as `organizationId` to `POST /api/customer_accounts/{login,signup}`. The legacy body `tenantId` is still accepted (with a fail-closed cross-check) for one release, so existing clients keep working during migration. `GET /api/directory/tenants/lookup` is unchanged.

3. **Auth user & role mutations enforce target-tenant ownership.** `PUT`/`DELETE /api/auth/users`, the user ACL/consents/resend-invite routes, and role create/update/delete now verify the **target** user/role belongs to the actor's tenant (and org scope where applicable). A non-super-admin acting on a foreign-tenant or platform (`tenantId = null`) id now receives `404` (cross-tenant/unknown) or `403` (in-tenant, out-of-allowed-org) instead of silently mutating it. Super-admin (incl. selected-tenant) behavior is unchanged. *Action for downstream:* none unless you relied on the cross-tenant bypass; integrators that assumed a tenant admin could edit arbitrary `userId`s will now be denied (this was unintended).

No DB schema change. No ACL feature IDs were renamed or removed (only enforced). See [`.ai/specs/implemented/2026-06-05-tenant-ownership-and-module-acl-authorization.md`](.ai/specs/implemented/2026-06-05-tenant-ownership-and-module-acl-authorization.md). Enterprise `security` (MFA admin/enforcement) variants are tracked separately in [`.ai/specs/enterprise/implemented/2026-06-05-security-mfa-cross-tenant-authorization.md`](.ai/specs/enterprise/implemented/2026-06-05-security-mfa-cross-tenant-authorization.md).

### Enterprise `security` — MFA admin & enforcement views are now tenant-scoped (#2612)

Same root cause as above, in the enterprise `security` module. Because `security/setup.ts` grants default admins `security.*`, every tenant admin held `security.admin.manage` — which previously let them read/act across **all** tenants. Now enforced (super-admin/platform required for cross-tenant or platform-wide views):

1. **Per-user MFA admin (IDOR closed).** `GET /api/security/users/[id]/mfa/status` and `POST /api/security/users/[id]/mfa/reset` now verify the target user belongs to the actor's tenant — a foreign-tenant target returns `404` even with a valid sudo token (sudo validates the actor, not the target).
2. **MFA compliance.** `GET /api/security/users/mfa/compliance?tenantId=…` no longer prefers a caller-supplied `tenantId`; a non-super-admin requesting a foreign tenant gets `403`.
3. **Enforcement compliance & policies.** `GET /api/security/enforcement/compliance` now requires platform-admin for `scope=platform` (previously it counted users across all tenants) and validates `scope=tenant|organisation` ownership; enforcement policy list/create/update/delete reject foreign-tenant/org scopes for non-super-admins (`403`). The unfiltered `em.find(User, { deletedAt: null })` is unreachable for non-super-admins.

*Action for downstream:* none unless internal tooling relied on a tenant admin viewing other tenants' MFA posture or using `scope=platform` — those calls now require a platform/super-admin. No DB schema change; no ACL feature IDs renamed. Service methods (`MfaAdminService`, `MfaEnforcementService`) gained an **optional** actor-context backstop param — additive, existing callers unaffected. Reuses the core `enforceTenantSelection`/`resolveIsSuperAdmin` helpers, so the enterprise build must be paired with a core that has them (true since ≤ 0.6.4). See [`.ai/specs/enterprise/implemented/2026-06-05-security-mfa-cross-tenant-authorization.md`](.ai/specs/enterprise/implemented/2026-06-05-security-mfa-cross-tenant-authorization.md).

### New `om-prepare-issue` skill (deferred-work capture)

A new bundled skill, [`om-prepare-issue`](.ai/skills/om-prepare-issue/SKILL.md), codifies the "park this idea for later" workflow. Given a free-form feature brief it (1) researches and writes a spec under `.ai/specs/` to `om-spec-writing` standards, (2) opens a **docs-only spec PR** against `develop` (labels `documentation` + `skip-qa`, reusing `om-auto-create-pr` worktree/branch/label mechanics), and (3) opens a **tracking GitHub issue** that links the spec path and the spec PR and names the implementer skill (`om-implement-spec` / `om-auto-fix-issue`) for later pickup. It never implements the feature — the only file it adds is the spec.

The skill is registered in the `automation` tier of [`.ai/skills/tiers.json`](.ai/skills/tiers.json) (alongside `om-auto-create-pr` and `om-auto-fix-issue`) and is also shipped into standalone apps scaffolded by `create-mercato-app` (`packages/create-app/agentic/shared/ai/skills/om-prepare-issue/`).

This is purely additive — no existing skill, slash command, API, DB, or module-contract surface changed.

### `om-auto-review-pr` now posts manual-QA instructions on the `needs-qa → qa` transition

[`om-auto-review-pr`](.ai/skills/om-auto-review-pr/SKILL.md) (and `om-review-prs`, which delegates to it) now posts an **additional PR comment with concrete step-by-step manual QA instructions** whenever it routes an approved PR to the `qa` pipeline state (i.e. `needs-qa` present, `skip-qa` absent). The comment uses the house QA route format from `om-auto-qa-scenarios` — P0/P1/P2 priority tags with **Where to click** / **What to verify** / **What can go wrong** blocks derived from the actual diff.

This is additive: the existing claim, pipeline-label, author-handoff, and completion comments are unchanged; the QA-instructions comment is posted only on the `needs-qa → qa` transition (never on `merge-queue`, `changes-requested`, or other states). No action is required from downstream users beyond re-installing skills (below) to pick up the updated `SKILL.md`.

### How to apply these skill changes downstream

Skill content lives in `.ai/skills/<name>/SKILL.md` and is consumed via per-skill symlinks under `.claude/skills/` and `.codex/skills/`. To pick up the new skill and the updated review behavior:

```bash
# List the tier catalog and what is currently installed
yarn install-skills --list

# Re-run the installer to refresh symlinks for your selected tiers.
# om-prepare-issue and om-auto-review-pr both live in the opt-in `automation` tier:
yarn install-skills --with automation      # default tiers + automation
# or install every tier:
yarn install-skills --all
```

The installer is idempotent and tier-driven (`.ai/skills/tiers.json`) — it adds the new symlink and sweeps stale ones; it never edits skill content. Standalone apps generated by `create-mercato-app` receive `om-prepare-issue` automatically the next time agentic setup runs (`yarn mercato agentic:init`).

This is tooling/docs only; no application runtime, API, DB, or module-contract surface changes.

### OSS optimistic locking default-ON (2026-05-27)

The `updated_at`-based optimistic-locking guard introduced in
[`#1981`](https://github.com/open-mercato/open-mercato/pull/2055) is now
**default ON** for every CRUD entity exposed via `makeCrudRoute`. The
runtime behavior is strictly additive — clients that do not send the
`x-om-ext-optimistic-lock-expected-updated-at` header continue to pass
through unchanged — but downstream operators and module authors should
review the following before deploying:

#### What changed

- `parseOptimisticLockEnv(undefined | '' | '   ')` now returns
  `{ mode: 'all' }` (previously `{ mode: 'off' }`). The platform DI
  bootstrap registers a default `crudMutationGuardService` that consults
  the global reader store, which the CRUD factory's
  `registerOptimisticLockReaderIfAbsent` populates at module-load time.
- `OM_OPTIMISTIC_LOCK=off` (case-insensitive; also `false` / `0` /
  `no` / `disabled` / `none`) now disables the guard explicitly.
  Allow-list values (`OM_OPTIMISTIC_LOCK=customers.company,sales.order`)
  continue to work; they narrow coverage to the listed `resourceKind`s.
- `packages/core/src/modules/customers/di.ts` and
  `packages/core/src/modules/sales/di.ts` no longer register their own
  `crudMutationGuardService` — the platform default suffices. They keep
  the hand-wired `registerOptimisticLockReaders(...)` call (companies/
  people use a `kind` discriminator on the polymorphic
  `customer_entities` table, so the generic reader cannot match).

#### When you might see a change in behavior

Only when *all four* of these are true:

1. Your deployment has not set `OM_OPTIMISTIC_LOCK` explicitly.
2. A page issues `PUT` / `PATCH` / `DELETE` with the optimistic-lock
   header set (via `CrudForm` with `optimisticLockUpdatedAt`, or by
   calling `buildOptimisticLockHeader(...)` directly).
3. The header's timestamp does not match the row's current `updated_at`.
4. The route is registered through `makeCrudRoute` (i.e. it picks up
   the auto-registered generic reader).

In that case the mutation now responds with `409` and the structured
body `{ error: 'record_modified', code: 'optimistic_lock_conflict',
currentUpdatedAt, expectedUpdatedAt }` instead of silently winning the
race. Pages built on `CrudForm` already render the localized
`ui.forms.flash.recordModified` flash; custom callers should pin against
`code: 'optimistic_lock_conflict'` (via `extractOptimisticLockConflict`).

#### How to opt out

Set the env var explicitly:

```bash
OM_OPTIMISTIC_LOCK=off
```

Restart the app/dev server — the env is read once at module-load time.

#### Custom modules that registered their own `crudMutationGuardService`

If you wrote a custom module that registers `crudMutationGuardService`
in its `di.ts`, your registration still wins (Awilix replaces same-key
registrations, and module DI runs after the platform default in
`createRequestContainer`). No changes required.

#### Custom modules that built on the old `parseOptimisticLockEnv` default

If your code branches on `parseOptimisticLockEnv(undefined).mode === 'off'`
to short-circuit, that branch now returns `'all'`. Audit any
`if (config.mode === 'off')` paths that fed off the parser default; the
guard's own runtime check (`config.mode === 'off' → PASS`) is unchanged
and still does the right thing.

### Deprecations

#### `GET /api/customers/assignable-staff` → `GET /api/staff/team-members/assignable`

The customer-flow assignable-staff endpoint now lives in the staff module under its canonical URL `/api/staff/team-members/assignable`. The legacy URL `/api/customers/assignable-staff` still works but returns `308 Permanent Redirect` to the new URL with the original query string preserved. RBAC is unchanged (`customers.roles.view` page guard + `customers.roles.manage`/`customers.activities.manage` handler check) so existing role assignments keep working.

```ts
// before
const data = await readApiResultOrThrow('/api/customers/assignable-staff?pageSize=20')

// after
const data = await readApiResultOrThrow('/api/staff/team-members/assignable?pageSize=20')
```

The legacy URL will stay around for at least one minor version and be removed no earlier than the next major release. Update in-tree consumers now; external HTTP clients that follow `308` redirects do not need changes.

See [`.ai/specs/implemented/2026-05-08-staff-decouple-from-core.md`](.ai/specs/implemented/2026-05-08-staff-decouple-from-core.md) for the full migration plan.

### AI coding skills renamed with the `om-` prefix

Every bundled AI coding skill is now namespaced with an `om-` prefix, both under the repo's `.ai/skills/` directory and in the standalone-app scaffolding generated by `create-mercato-app` (`packages/create-app/agentic/shared/ai/skills/`). This avoids collisions with skills a downstream team adds to their own project and matches the `@open-mercato/*` package naming convention.

The rename is purely mechanical — **prepend `om-` to the skill folder name and its `name:` frontmatter**. Skill content and triggers are unchanged. Affected skills:

```
auto-continue-pr            → om-auto-continue-pr
auto-continue-pr-loop       → om-auto-continue-pr-loop
auto-create-pr              → om-auto-create-pr
auto-create-pr-loop         → om-auto-create-pr-loop
auto-fix-github             → om-auto-fix-github
auto-qa-scenarios           → om-auto-qa-scenarios
auto-review-pr              → om-auto-review-pr
auto-sec-report             → om-auto-sec-report
auto-sec-report-pr          → om-auto-sec-report-pr
auto-update-changelog       → om-auto-update-changelog
auto-upgrade-0.4.10-to-0.5.0 → om-auto-upgrade-0.4.10-to-0.5.0
backend-ui-design           → om-backend-ui-design
check-and-commit            → om-check-and-commit
code-review                 → om-code-review
create-agents-md            → om-create-agents-md
create-ai-agent             → om-create-ai-agent
dev-container-maintenance   → om-dev-container-maintenance
ds-guardian                 → om-ds-guardian
fix                         → om-fix
fix-specs                   → om-fix-specs
implement-spec              → om-implement-spec
integration-builder         → om-integration-builder
integration-tests           → om-integration-tests
merge-buddy                 → om-merge-buddy
migrate-mikro-orm           → om-migrate-mikro-orm
open-pr                     → om-open-pr
pre-implement-spec          → om-pre-implement-spec
review-prs                  → om-review-prs
root-cause                  → om-root-cause
skill-creator               → om-skill-creator
smart-test                  → om-smart-test
spec-writing                → om-spec-writing
sync-merged-pr-issues       → om-sync-merged-pr-issues
verify-in-repo              → om-verify-in-repo
```

The create-app scaffolding also ships these standalone-only skills under the same prefix: `om-data-model-design`, `om-eject-and-customize`, `om-module-scaffold`, `om-system-extension`, `om-trim-unused-modules`, `om-troubleshooter`.

What you need to do:

- **Slash-command invocations** change accordingly, e.g. `/auto-create-pr` → `/om-auto-create-pr`, `claude "/module-scaffold"` → `claude "/om-module-scaffold"`.
- **Scripts, docs, or AGENTS.md files** that reference a skill by name or by `.ai/skills/<name>/SKILL.md` path must adopt the `om-` prefix. A one-shot rewrite over your own tree:

  ```bash
  # Update .ai/skills/<name> path references to the om- prefix (review the diff before committing)
  grep -rlE '\.ai/skills/(auto-|backend-ui-design|check-and-commit|code-review|create-|dev-container|ds-guardian|fix|implement-spec|integration-|merge-buddy|migrate-mikro-orm|open-pr|pre-implement-spec|review-prs|root-cause|skill-creator|smart-test|spec-writing|sync-merged-pr-issues|verify-in-repo)' . \
    | xargs sed -i -E 's#(\.ai/skills/)(auto-|backend-ui-design|check-and-commit|code-review|create-|dev-container|ds-guardian|fix|implement-spec|integration-|merge-buddy|migrate-mikro-orm|open-pr|pre-implement-spec|review-prs|root-cause|skill-creator|smart-test|spec-writing|sync-merged-pr-issues|verify-in-repo)#\1om-\2#g'
  ```

- **Custom skills you authored** are unaffected — only the bundled Open Mercato skills moved.

This is tooling/docs only; no application runtime, API, DB, or module-contract surface changes.

---

## 0.6.1 → 0.6.2 (2026-05-19)

No actionable dependency upgrades for downstream user code. See
[`CHANGELOG.md`](CHANGELOG.md) for release highlights.

---

## 0.6.0 → 0.6.1 (2026-05-13)

No actionable dependency upgrades for downstream user code. See
[`CHANGELOG.md`](CHANGELOG.md) for release highlights.

---

## 0.5.0 → 0.6.0 (2026-05-06)

This window carries the MikroORM v6 → v7 migration
([#1513](https://github.com/open-mercato/open-mercato/pull/1513)), the last of the three
majors that were deferred out of the 0.5.0 consolidation. No other dependency majors
shipped in this window.

### Breaking dependency changes that may affect user code

#### `@mikro-orm/*` `^6.6.10` → `^7.0.10`

v7 is ESM-only, dropped Knex for [Kysely](https://github.com/kysely-org/kysely), moved
decorators out of `@mikro-orm/core`, and removed the default `ReflectMetadataProvider`.
Every downstream module with entities, raw SQL, or a standalone ORM bootstrap needs
changes. The full mechanical recipe (incl. tests/Jest setup) lives in the companion skill
[`.ai/skills/om-migrate-mikro-orm/SKILL.md`](.ai/skills/om-migrate-mikro-orm/SKILL.md); the
highlights are:

Decorators moved — import decorators from `@mikro-orm/decorators/legacy`; keep
`OptionalProps`, `Collection`, `EntityManager`, `FilterQuery`, `RequiredEntityData`, etc.
on `@mikro-orm/core`:

```ts
// before
import { Entity, PrimaryKey, Property, ManyToOne, OptionalProps } from '@mikro-orm/core'

// after
import { OptionalProps } from '@mikro-orm/core'
import { Entity, ManyToOne, PrimaryKey, Property } from '@mikro-orm/decorators/legacy'
```

`persistAndFlush` / `removeAndFlush` removed — chain instead:

```ts
// before
await em.persistAndFlush(entity)
await em.removeAndFlush(entity)

// after
await em.persist(entity).flush()
await em.remove(entity).flush()
```

Jest mocks must be updated accordingly (`persist: jest.fn().mockReturnThis(), flush: jest.fn()`).

Knex → Kysely — `em.getConnection().getKnex()` is gone; use `em.getKysely<any>()` and the
Kysely query builder. Operators are mandatory (`.where('col', '=', val)`), JSONB needs
`` sql`${JSON.stringify(doc)}::jsonb` ``, `knex.fn.now()` becomes `` sql`now()` ``, and
aggregate results come back as strings (wrap `count()` rows in `Number(...)`). Upserts use
`.onConflict(oc => oc.columns([...]).doUpdateSet({...}))`.

Migrator API renamed — `orm.getMigrator()` → `orm.migrator`,
`migrator.createMigration()` → `migrator.create()`,
`migrator.getPendingMigrations()` → `migrator.getPending()`.

ORM bootstrap (if you call `MikroORM.init` yourself) — register the metadata provider
explicitly, pass `EntityManager` as a generic, and reshape the pool config:

```ts
import { ReflectMetadataProvider } from '@mikro-orm/decorators/legacy'
import { PostgreSqlDriver, EntityManager as PostgreSqlEntityManager } from '@mikro-orm/postgresql'

await MikroORM.init<PostgreSqlDriver, PostgreSqlEntityManager<PostgreSqlDriver>>({
  driver: PostgreSqlDriver,
  metadataProvider: ReflectMetadataProvider, // v7 no longer installs this by default
  pool: { min, max, idleTimeoutMillis },     // acquireTimeoutMillis / destroyTimeoutMillis removed
  driverOptions: { connectionTimeoutMillis, ssl },
  entities,
})
```

Without `ReflectMetadataProvider` the legacy decorators silently emit wrong column
metadata at runtime.

Stricter typing — v7 tightens `FilterQuery<T>` / `RequiredEntityData<T>`. Expect to add
occasional casts, wrap ambiguous generic filters with `NoInfer<T>`, and watch out for
`em.create(Entity, { ...spread, override })`: v7's inference exposes cases where a
trailing spread silently overwrites computed fields — put the spread first.

Jest / ESM — v7 uses `import.meta.resolve`, which `ts-jest` on CJS can't run. The repo
ships [`scripts/jest-mikroorm-transformer.cjs`](scripts/jest-mikroorm-transformer.cjs);
wire it in every standalone `jest.config.cjs` and bump `tsconfig` `target` to `ES2022`:

```js
transform: { '^.+\\.(t|j)sx?$': '<rootDir>/../../scripts/jest-mikroorm-transformer.cjs' },
transformIgnorePatterns: ['node_modules/(?!(@mikro-orm)/)'],
```

---

## 0.4.10 → 0.5.0 (2026-04-21)

Release context:
- Biggest Open Mercato release so far
- More than 250 fixes and improvements delivered after the Hackathon in Sopot
- Includes several major dependency upgrades, which is why `UPGRADE_NOTES.md` was added
  for this release window

This window bundles the consolidated Dependabot dependency bumps from
[#1620](https://github.com/open-mercato/open-mercato/pull/1620) (minor/patch) and
[#1621](https://github.com/open-mercato/open-mercato/pull/1621) (major), migrated to
`develop` in [#1625](https://github.com/open-mercato/open-mercato/pull/1625).

Three major bumps with deep platform surface impact were **deliberately reverted** and are
**NOT** part of 0.5.0 — they remain on their 0.4.10 versions and are tracked as separate
dedicated upgrades. See [Deferred majors](#deferred-majors) below.

Companion skill: [`om-auto-upgrade-0.4.10-to-0.5.0`](.ai/skills/om-auto-upgrade-0.4.10-to-0.5.0/SKILL.md).

### Breaking dependency changes that may affect user code

#### `meilisearch` `^0.55` → `^1.0`

The exported client class was renamed from `MeiliSearch` to `Meilisearch` (lowercase `s`),
and the package switched to pure ESM (`"type": "module"`).

Code changes:

```ts
// before
import { MeiliSearch } from 'meilisearch'
const client = new MeiliSearch({ host, apiKey })

// after
import { Meilisearch } from 'meilisearch'
const client = new Meilisearch({ host, apiKey })
```

Jest configuration (ESM): Jest's default `transformIgnorePatterns` skips `node_modules`.
Since `meilisearch@1` ships pure ESM, add an allow-list so `ts-jest`/`babel-jest` can
transform it:

```js
// apps/<your-app>/jest.config.cjs
module.exports = {
  // ...
  transformIgnorePatterns: [
    '/node_modules/(?!meilisearch)/',
    '\\.pnp\\.[^\\/]+$',
  ],
}
```

#### `stripe` `^17` → `^22`

The `Stripe.LatestApiVersion` namespace constant was removed and the zero-argument
`stripe.accounts.retrieve()` was replaced by `stripe.accounts.retrieveCurrent()`.

Code changes:

```ts
// before
import Stripe from 'stripe'
const stripe = new Stripe(apiKey, {
  apiVersion: apiVersion as Stripe.LatestApiVersion,
})
const account = await stripe.accounts.retrieve()

// after
import Stripe from 'stripe'
type StripeConfig = NonNullable<ConstructorParameters<typeof Stripe>[1]>
const stripe = new Stripe(apiKey, {
  apiVersion: apiVersion as StripeConfig['apiVersion'],
})
const account = await stripe.accounts.retrieveCurrent()
```

Also bumped in lock-step: `@stripe/react-stripe-js` `^3` → `^6`, `@stripe/stripe-js`
`^7` → `^9`. Consult Stripe's own migration guides for component-level API changes.

#### `lucide-react` `^0.556` → `^1.8`

Brand icons `Linkedin` and `Twitter` were removed for trademark reasons. Replace with
a semantic substitute (the platform uses `Briefcase` for LinkedIn-style links and
`AtSign` for Twitter-style handles):

```tsx
// before
import { Linkedin, Twitter } from 'lucide-react'

// after
import { Briefcase, AtSign } from 'lucide-react'
```

Other lucide icon name stabilizations landed in the v1 cut — check your imports
against https://lucide.dev/icons if you see "module has no exported member" errors.

Server-side navigation metadata:

If you store page, sidebar, or settings-navigation icons in backend metadata that is
serialized on the server, do **not** pass Lucide component references or JSX elements such
as `icon: Users` or `icon: <Users />`. After the v1 upgrade these can cross the
server/client boundary and break routes such as `/api/auth/admin/nav`.

Use one of these patterns instead:

```ts
// preferred for backend/page metadata
icon: 'users'
```

```ts
// also safe when you need a custom shape
const usersIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
  React.createElement('path', { d: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2' }),
  React.createElement('circle', { cx: 9, cy: 7, r: 4 }),
)

icon: usersIcon
```

If your admin navigation starts failing with an error about calling
`node_modules/lucide-react/dist/esm/Icon.js` from the server, audit every metadata-driven
icon in that nav path and replace component references with icon names or inline SVG.

#### `react-markdown` `^9` → `^10`

The `className` prop was removed from `<ReactMarkdown>`. Wrap the invocation in a
`<div>` that carries the class instead:

```tsx
// before
<ReactMarkdown className="prose" remarkPlugins={plugins}>{body}</ReactMarkdown>

// after
<div className="prose">
  <ReactMarkdown remarkPlugins={plugins}>{body}</ReactMarkdown>
</div>
```

#### `cron-parser` `^4` → `^5`

The default-export factory was removed. `parseExpression` is no longer a function exposed
on the default import — use the named `CronExpressionParser.parse` static method:

```ts
// before
import parser from 'cron-parser'
const expr = parser.parseExpression('*/5 * * * *')

// after
import { CronExpressionParser } from 'cron-parser'
const expr = CronExpressionParser.parse('*/5 * * * *')
```

The returned iterator shape (`next()`, `prev()`, `hasNext()`, `hasPrev()`) is unchanged.

#### `@simplewebauthn/server` `^11` → `^13` (and `@simplewebauthn/types` `^11` → `^12`)

Function signatures were narrowed from `Uint8Array` to `Uint8Array<ArrayBuffer>`. A
`TextEncoder().encode(...)` result or a `new Uint8Array(Buffer.from(...))` result is
typed `Uint8Array<ArrayBufferLike>` and is no longer assignable. Coerce with `.slice()`:

```ts
// before
function toWebAuthnUserId(userId: string): Uint8Array {
  return new TextEncoder().encode(userId)
}
function base64UrlToBytes(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, 'base64url'))
}

// after
function toWebAuthnUserId(userId: string) {
  return new TextEncoder().encode(userId).slice()
}
function base64UrlToBytes(value: string) {
  return new Uint8Array(Buffer.from(value, 'base64url')).slice()
}
```

Several exported types also moved from `@simplewebauthn/types@11` to `@simplewebauthn/types@12`.
If you imported passkey types directly, re-run `tsc` — the message is usually the rename is
transparent once the new version is installed.

#### `recharts` `^2` → `^3`

recharts 3 dropped several default props (e.g. `isAnimationActive`) and tightened the
`ResponsiveContainer` width/height typing. If you render charts in a custom module, expect
to audit any non-default props, particularly custom `Tooltip`/`Legend` content renderers,
which now receive slightly different payload shapes. No helper is provided here — review
https://recharts.org upgrade notes.

#### `rate-limiter-flexible` `^9` → `^11`

Two back-to-back major releases. The constructor options object is mostly compatible; the
main breakage is around the deprecated `pointsConsumed` return field and the strictened
Redis client option type (`useRedisPackage`/`storeClient` unioning). Audit any direct
consumers — the platform itself uses this transitively; user modules that wire their own
`RateLimiterRedis` instance are the ones to watch.

#### `framer-motion` `^11` → `^12`

Most `motion.<el>` call sites continue to work. The layout animation engine was rewritten
and some auto-animated layout transitions now behave slightly differently at the pixel
level. Bug-for-bug parity is not guaranteed; verify any long-running, scroll-triggered, or
gesture-driven animations after upgrading.

#### `glob` `^11` → `^13`

Node 20+ now required. The `Glob` class `matchBase` option was renamed to `matchBases`; the
function signature already accepted `signal` and `withFileTypes`. If you used the
`globSync()` one-shot helper, no code change is needed.

#### `esbuild` `^0.25` → `^0.28`

Only affects build tooling in workspace packages that ship a standalone bundle
(`packages/create-app`, `packages/cli`, `packages/checkout`, `packages/scheduler`,
`packages/webhooks`, `packages/sync-akeneo`). The 0.25→0.28 window made `--outdir` with a
non-existent directory error (previously it silently created it); ensure your build scripts
`mkdir -p` explicitly. No runtime behavior change.

#### `eslint` `^9` → `^10`

Flat config is now the only config format (`.eslintrc.*` is removed). If you still ship a
legacy `.eslintrc.js` in a user module, migrate it to `eslint.config.mjs`. ESLint 10 also
drops Node 18 support — make sure your CI runs Node 20+ at minimum.

#### `rimraf` `^5` → `^6`

Pure tooling change. The default-exported function is now async-only and no longer accepts
the legacy callback signature. If you invoke `rimraf` from a build script, `await` it.

#### `@docusaurus/*` `^3.9` → `^3.10`

Minor bump. No user code changes. The consolidation pins `webpack` to `5.104.1` via
root-level `resolutions` because `webpackbar@6.0.1` (a transitive of `@docusaurus/core@3.10`)
is incompatible with webpack `5.106.x`'s stricter `ProgressPlugin` schema. The pin can be
dropped once `webpackbar` ships a fix or Docusaurus bumps it.

#### AI SDK family

`@ai-sdk/amazon-bedrock` `^4.0.8` → `^4.0.96`, `@ai-sdk/anthropic` `^3.0.12` → `^3.0.71`,
`@ai-sdk/cohere` `^3.0.4` → `^3.0.30`, `@ai-sdk/google` `^2` → `^3`, `@ai-sdk/mistral`
`^3.0.5` → `^3.0.30`, `@ai-sdk/openai` `^3.0.5` → `^3.0.53`, `ai` `^6.0.0` → `^6.0.168`,
`ai-sdk-ollama` `3.0.0` → `3.8.3`.

`@ai-sdk/google` is the only major bump here. v3 renamed the default model factory export
and tightened the tool-call result shape; if you import `google` directly and call `.tool()`
or pass a custom fetch, verify against v3 release notes.

#### Miscellaneous smaller bumps (no known user-code impact)

- `next` `16.2.3` → `16.2.4`, `react`/`react-dom` `19.2.1` → `19.2.5`.
- `@tanstack/react-query` `^5.90.12` → `^5.99.2`.
- `@types/node` `^20`/`^24` → `^25`, `@types/react` `^19.2.7` → `^19.2.14`.
- `newrelic` `^13.16` → `^13.19`, `dotenv` `^17.2.3` → `^17.4.2`, `resend` `^6.5.2` → `^6.12.0`.
- `@tailwindcss/postcss` and `tailwindcss` `^4.1.17` → `^4.2.2`, `tailwind-merge` `^3.4.0` → `^3.5.0`.
- `better-sqlite3` `^12.5` → `^12.9`, `bullmq` `^5.34` → `^5.75`, `ioredis` `^5.8` → `^5.10`.
- `zod` `^4.1.13` → `^4.3.6`, `semver` `^7.7.3` → `^7.7.4`, `testcontainers` `^11.12` → `^11.14`.
- `jest` `^30.2` → `^30.3`, `jest-environment-jsdom` `^30.2` → `^30.3`, `ts-jest` `^29.4.6` → `^29.4.9`.
- `eslint-config-next` `16.1.7` → `16.2.4`.
- `@react-email/components` `^1.0.1` → `^1.0.12`, `react-email` `^5.2.10` → `^6.0.0`.
  react-email v6 changed the CLI entry from `email` to `react-email`; if you scripted the
  CLI, update the command name.
- `@uiw/react-markdown-preview` `^5.1.5` → `^5.2.0`, `@uiw/react-md-editor` `^4.0.11` → `^4.1.0`.
- `openid-client` `^6.3.3` → `^6.8.3`, `otpauth` `9.4.1` → `9.5.0`.
- `@modelcontextprotocol/sdk` `^1.26` → `^1.29`.

### Deferred majors

These majors were bumped by Dependabot but **reverted** before merging because their
migration cost crosses the platform's contract surface. They are not part of 0.5.0 and
are tracked as follow-up work:

| Package | Current pin | Dependabot proposed | Why deferred |
|---------|-------------|---------------------|--------------|
| `@mikro-orm/*` | `^6.6.10` | `^7.0.11` | v7 drops decorator re-exports and `persistAndFlush`/`removeAndFlush`, requires invasive migration across every `data/entities.ts` and all write paths — **addressed in the [0.5.0 → 0.5.1](#050--051-unreleased) window** |
| `typescript` | `^5.9.3` | `^6.0.3` | v6 deprecates `moduleResolution=node10` (`error TS5107`) across every package `tsconfig.json`; fix requires either `"ignoreDeprecations": "6.0"` everywhere or a real migration to `bundler`/`node16` |
| `awilix` | `^12.0.5` | `^13.0.3` | v13 changed the `Cradle` generic default from `any` to `{}`, which makes every `container.resolve('em')` return `unknown` at 100+ DI call sites with no code change |

When a dedicated spec and migration PR land for one of these, it will be listed in its own
`0.x.y → 0.x.(y+1)` window in this document and the corresponding `auto-upgrade-...` skill
will cover it.

---

## Template for future entries

```md
## X.Y.Z → X.Y.(Z+1) (unreleased)

Companion skill: [`om-auto-upgrade-X.Y.Z-to-X.Y.(Z+1)`](.ai/skills/om-auto-upgrade-X.Y.Z-to-X.Y.(Z+1)/SKILL.md).

### Breaking dependency changes that may affect user code

#### `<package>` `^<from>` → `^<to>`

<one paragraph describing the breakage>

```ts
// before
<...>

// after
<...>
```
```

When opening a PR that bumps a dependency across a major boundary, add an entry here in
the same PR. The `auto-upgrade-...` skill for the window picks up entries from this file;
keep the headings stable (exactly `#### \`<package>\` \`^<from>\` → \`^<to>\``) so the
skill can parse them.
