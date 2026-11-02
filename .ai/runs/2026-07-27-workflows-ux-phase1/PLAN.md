# Run Plan — 2026-07-27-workflows-ux-phase1

**Branch:** `feat/workflows-ux-phase1` · **Base:** `feat/workflows-ux-phase0` (STACKED — see Risks) · **Owner:** pat-lewczuk
**Source spec:** `.ai/specs/2026-07-26-workflows-ux-redesign.md` §3.2 + §10 Phase 1 ("The registry + templates")
**Umbrella issue:** #4251 · **Closes:** #4230 · **Depends on:** PR #4532 (Phase 0)

## Tasks

> Authoritative status table. `Status` is one of `todo` or `done`. On landing a Step, flip `Status` to `done` and fill the `Commit` column with the short SHA. The first row whose `Status` is not `done` is the resume point for `om-auto-continue-pr-loop`. Step ids are immutable once a Step has a commit.

| Phase | Step | Title | Status | Commit |
|-------|------|-------|--------|--------|
| 1 | 1.1 | Activity Registry module with types, lookups, and import-boundary test | done | b69f2b664 |
| 1 | 1.2 | Register the 7 built-in activity types with config schemas | done | f54f3679a |
| 1 | 1.3 | Sync dispatch through the registry | done | 7c0036079 |
| 1 | 1.4 | Async worker dispatch through the registry + CALL_API enqueue-time refusal | done | a669adaad |
| 2 | 2.1 | Registry-driven activityTypeSchema and per-type config validation (warning severity) | done | 352ccb1c4 |
| 3 | 3.1 | SET_VARIABLE activity type end-to-end | done | b2699c39d |
| 3 | 3.1-review-fix | Harden SET_VARIABLE async/paths and route the production worker through the registry | done | 338f56b69 |
| 7 | 7.2-ds-fix | Focus ring, radius, and label association on gallery and pickers | done | ee556a79f |
| 4 | 4.1 | Shared activity-type options hook; kill hardcoded label arrays | done | 94b50edd3 |
| 4 | 4.2 | Registry-driven config forms in ActivityArrayEditor (WAIT, SEND_EMAIL, CALL_WEBHOOK, CALL_API) | done | 6c986ee52 |
| 4 | 4.3 | Event picker field for EMIT_EVENT | done | fd323ee66 |
| 4 | 4.4 | Command picker for UPDATE_ENTITY with safe-command list API | done | 8ded5a899 |
| 4 | 4.5 | Workflow function registry seam and function picker | done | fd1b2f2cd |
| 4 | 4.6 | SET_VARIABLE assignments form | done | be5841f08 |
| 5 | 5.1 | #4230 typed OpenAPI responses for workflows definition routes | done | cdbeadb4e |
| 6 | 6.1 | CommandHandler outputSchema seam with customers.deals.update exemplar | done | 14cee0c35 |
| 7 | 7.1 | Template assets and templates list API | done | 62a30be35 |
| 7 | 7.2 | Template gallery dialog wired into list page, empty state, and editor | done | a3fba3824 |
| 7 | 7.1-review-fix | Static template imports to fix whole-project NFT tracing in build:app | done | 9d5246070 |
| 8 | 8.1 | workflow_definition_drafts entity and migration | done | a830038a2 |
| 8 | 8.2 | Draft API routes (GET/PUT/DELETE, user-scoped) | done | 8167b6d2a |
| 8 | 8.3 | Editor draft wiring: debounced draft save + restore banner | done | 7710c7957 |
| 9 | 9.1 | Docs: AGENTS.md activity-type recipe rewrite + user-guide updates | done | f4555d693 |
| 8 | 8.3-review-fix | Explicit comparator in draft-restore stable serializer | done | e1c382b30 |
| 8 | 8.3-review-fix-2 | Fix visual-editor save regression caught by TC-WF-011 | done | c6e20581b |

## Goal

Ship Phase 1 of the workflows UX redesign: one declarative Activity Registry replacing the 7-site duplication (dispatch switches, Zod enum, UI lists), schema-driven config forms with real pickers (commands/events/functions), the SET_VARIABLE primitive, typed OpenAPI responses (#4230), the command-output-schema seam, a seeded template gallery with "New workflow" picker, and the greenfield autosave draft layer (dedicated revision table per resolved decision Q4).

## Scope

- `packages/core/src/modules/workflows/` — lib (activity-registry NEW, activity-executor, activity-worker-handler, workflow-function-registry NEW, workflow-safe-commands, seeds), data (validators, entities + migration), components (ActivitiesEditor, TransitionsEditor, fields/*, TemplateGalleryDialog NEW), backend (definitions list/visual-editor pages), api (definitions routes, draft routes NEW, templates route NEW, commands list route NEW, openapi.ts), examples/templates NEW, i18n ×4, AGENTS.md.
- `packages/shared/src/lib/commands/` — additive `outputSchema?` on CommandHandler + `outputSchemaOf` on registry.
- `packages/core/src/modules/customers/commands/deals.ts` — exemplar outputSchema.

## Non-goals

- Legacy dialog deletion (spec requires a post-flip soak; #4532 unmerged — next run).
- INVOKE_AGENT registration (not in this repo — lives on the orchestrator branch; registry ships as an open extension point only).
- Context ledger, pill pickers, endpoint picker (#4235), strict interpolation (Phase 2; forms render against static schemas per the Phase 1 cut line).
- Widening the workflow-safe command allowlist beyond `sales.orders.update` (security-relevant; filed as follow-up — picker shows the allowlist + free-text).
- Fixing the worker's dropped branchInstanceId/transitionId context (triage surprise; separate issue — needs parallel-handler verification).

## Risks

- **Stacked PR:** base is `feat/workflows-ux-phase0` (PR #4532, unmerged behind the QA gate) because this phase builds directly on Phase 0's dialogs/inputs. Deviates from the config's `develop` base deliberately; GitHub retargets to develop when #4532 merges. Documented in the PR body.
- **Validation tightening (the one real BC risk):** per-type config validation could fail previously-unvalidated definitions on next save. Mitigation: config-schema issues surface as **warning severity** in Phase 1 (visible in Problems panel, never save-blocking; API stays non-strict). Errors/strict mode arrive with Phase 2's opt-in.
- **Exported-function stability:** `executeSendEmail`…`executeCallApi`, `enqueueActivity`, `createActivityWorkerHandler` are STABLE exports consumed by tests/worker — the registry delegates to them; the ~2000-line activity-executor test suite must stay green **without edits** (BC proof).
- **Queue serialization boundary:** job payloads keep `activityType: string` + pre-interpolated config; registry objects are never serialized; interpolation stays at enqueue (async) / dispatch (sync).
- **Migration hygiene:** `yarn db:generate` may emit unrelated migrations — delete them, keep only the workflows draft-table migration, update this module's snapshot; never run `yarn db:migrate`.

## External References

- None. Design per spec §3.2 (registry contract incl. runtime contract), §4.7 (save model), §10 Phase 1.

## Implementation Plan

### Phase 1 — Registry core

**1.1 Activity Registry module**
- New `lib/activity-registry.ts`: `ActivityTypeEntry` ({id, icon, i18nKey, configSchema, form: ActivityFormFieldSpec[], execute(config, ctx, deps), async: {capable,queue}|{capable:false,reason}, mock?, compensable?, outputContract? stub}), `registerActivityType`, `getActivityType`, `listActivityTypes`, `activityTypeIds`. Deps shape `{em, container, signal?}` normalizes the 4 handler signatures. Pure module — no React, no module-scope em/container.
- Import-boundary test mirroring `xyflow-import-boundary.test.ts`: registry file imports no React/ORM/container at module scope.

**1.2 Register the 7 built-ins**
- New `lib/activity-types.ts` (avoid circular import): entries for SEND_EMAIL, EMIT_EVENT, UPDATE_ENTITY, CALL_WEBHOOK, EXECUTE_FUNCTION, WAIT, CALL_API delegating to the existing exported executeX handlers (kept exported — STABLE). Async capability: CALL_API `{capable:false, reason:'mintsPerRequestKey'}`; WAIT carries the delayMs enqueue hint; others capable.
- New config schemas in `data/validators.ts` for the 5 missing types (sendEmail: to/subject required; emitEvent: eventName required; updateEntity: commandId+input; executeFunction: functionName; wait: existing superRefine rules extracted). Wire existing `callApiConfigSchema`/`callWebhookConfigSchema` into their entries. i18nKey reuses existing `workflows.activities.types.*`.
- Tests: registry lookups, each entry's configSchema accepts/rejects canonical fixtures.

**1.3 Sync dispatch through the registry**
- `activity-executor.ts` `executeActivityByType` → `getActivityType(...).execute(interpolatedConfig, context, {em, container, signal})`; unknown id keeps `ActivityExecutionError`. Existing test suite green without edits.

**1.4 Async worker + CALL_API refusal**
- `activity-worker-handler.ts` switch → registry lookup gated on `entry.async.capable` (clear error naming the reason). `enqueueActivity` refuses non-capable types at enqueue time (author-side failure instead of worker mystery). WAIT delayMs sourced from the entry hint. Tests: CALL_API async → enqueue-time error; each capable type dispatches via registry.

### Phase 2 — Validation

**2.1 Registry-driven schema + per-type config validation**
- `activityTypeSchema = z.enum(activityTypeIds())`; `activityDefinitionSchema.superRefine` replaces the WAIT-only block with generic per-type `configSchema.safeParse` mapping issues to `path: ['config', …]` — emitted as **warnings** (add severity channel through `collect-validation-issues`; graph/structural issues stay errors). Assert zod-path→edge mapping for `['transitions', i, 'activities', j, 'config']` paths in the collect test.

### Phase 3 — SET_VARIABLE

**3.1 SET_VARIABLE end-to-end**
- `setVariableConfigSchema`: `{assignments: [{path, value}]}`. Registry entry (icon Variable, async capable, mock). Executor returns the assignment map; context application goes through the existing output-merge path (verify `transition-handler.ts` merge semantics first; if merge is namespaced under activity name, apply assignments to top-level context the way outputMapping does — implement whichever the engine already supports without new invariants). i18n `workflows.activities.types.SET_VARIABLE` ×4. OpenAPI picks the enum value up automatically. Tests: executor + validators + a transition-level merge test.

### Phase 4 — Schema-driven forms

**4.1 Shared options hook** — `components/fields/useActivityTypeOptions.ts` reading `listActivityTypes()` + `t(i18nKey)`; adopt in ActivitiesEditor/TransitionsEditor/NodeEditDialog/EdgeEditDialog/ActivityArrayEditor selects; delete the two hardcoded-English arrays (i18n violation fix).

**4.2 Registry-driven config forms in ActivityArrayEditor**
- Field-spec renderer: `entry.form` → components map in `components/fields/index.ts` (text, textarea, DurationInput, KeyValue rows, checkbox). Ship real forms for WAIT (duration XOR until via DurationInput — fixes the default-path regression), SEND_EMAIL (to/subject/template/body), CALL_WEBHOOK (url/method/headers/body), CALL_API (endpoint/method/headers/body/validateTenantMatch — plain inputs; endpoint *picker* is Phase 2). JsonBuilder demoted to a collapsed "Advanced (JSON)" section on every type. Component tests per the durationInputAdoption pattern.

**4.3 Event picker** — `EventNameCrudField` wrapping the existing `EventPatternInput` (`@open-mercato/ui/backend/inputs/EventPatternInput`) for EMIT_EVENT's `eventName`, `allowCustomValues` retained.

**4.4 Command picker**
- `listWorkflowSafeCommands()` export on `lib/workflow-safe-commands.ts`; new `GET api/commands/route.ts` (feature-gated `workflows.definitions.edit`) returning `{commandId, requiredFeatures}`; `CommandPicker` field for UPDATE_ENTITY's `commandId` (combobox over the API + free text preserved). Input stays a KeyValue/JSON section (typed input forms need command *input* schemas — out of scope).

**4.5 Function registry seam** — `lib/workflow-function-registry.ts` (`registerWorkflowFunctions([{name,label?,argsSchema?}])` + `listWorkflowFunctions()`); executor keeps resolving via DI unchanged; `FunctionPicker` with free-text fallback for EXECUTE_FUNCTION. Register the test-fixture function names in tests only.

**4.6 SET_VARIABLE form** — assignments array editor (path input + value input with JSON toggle per row).

### Phase 5 — OpenAPI (#4230)

**5.1 Typed responses**
- `workflowDefinitionResponseSchema`/`workflowDefinitionListResponseSchema` in `api/openapi.ts`; `definition` typed against `workflowDefinitionDataSchema` (not `z.unknown()`); wire `schema:` into definitions GET/POST/PUT + customize + reset-to-code responses keeping examples; delete dead `_openApiDetailedDocs`; generator fallback gains `description: 'Schema not declared'` (advisory). Schemas use passthrough where handlers spread. Test: generated doc for the definitions routes contains object schemas, not bare `{type:'object'}`.

### Phase 6 — Command output schemas

**6.1 Seam + exemplar** — additive `outputSchema?: ZodTypeAny` on `CommandHandler` (packages/shared types) + `commandRegistry.outputSchemaOf(id)`; exemplar `customers.deals.update` gets `z.object({dealId: z.string().uuid()})`; UPDATE_ENTITY's registry `outputContract` stub reads it (returns 'unknown' when absent — honest degradation). Unit tests both sides.

### Phase 7 — Templates

**7.1 Assets + API** — `examples/templates/*.json` (4 templates: order-approval ported from sales/workflows.ts, lead-to-install per the spec's OZE flow, task-escalation with deadline, webhook-integration), each validated against `workflowDefinitionDataSchema` in a test; `GET api/templates/route.ts` (feature-gated `workflows.definitions.view`) serving id/name/description/definition, i18n'd metadata keys.

**7.2 Gallery UI** — `components/TemplateGalleryDialog.tsx` (cards + preview + blank-canvas option); wired: definitions list page actions ("New workflow" opens picker), `ListEmptyState` action, and visual editor's `handleLoadExample` replaced by the gallery (the hardcoded inline example graph deleted). Boy-scout the 3 hardcoded flash strings in visual-editor/page.tsx (i18n ×4). Component test + list-page render test.

### Phase 8 — Draft layer (greenfield)

**8.1 Entity + migration** — `WorkflowDefinitionDraft` (`workflow_definition_drafts`: id, definition_id nullable uuid, user_id, definition jsonb, metadata jsonb null, base_updated_at timestamptz null, tenant/org, timestamps incl. updated_at, deleted_at; unique (definition_id, user_id, tenant_id)). `yarn db:generate`, prune unrelated output, update snapshot. Optimistic-lock guard tests will pick the entity up (updated_at present).

**8.2 Draft API** — `api/definitions/[id]/draft/route.ts` GET (own draft or 404) / PUT (upsert, captures base_updated_at from client) / DELETE (discard). Gated on `workflows.definitions.edit`; tenant+org+userId scoped from the authenticated principal. Route tests incl. cross-user isolation.

**8.3 Editor wiring** — debounced (~2s) draft PUT on editor-state changes (never touches the definition or its lock); on load, if a draft exists and differs, non-blocking "Restore draft / Discard" banner; on restore, base_updated_at vs current updatedAt mismatch shows the conflict-aware copy; explicit Save unchanged (lock header) + deletes the draft on success. i18n ×4. Unit test for the debounce/restore decision helper.

### Phase 9 — Docs

**9.1 Docs** — rewrite module `AGENTS.md` "Adding a New Activity Type" (one registry entry + i18n key; correct file paths); update `apps/docs` user-guide (activities/creating-workflows: registry-driven forms, templates, drafts) and framework extending doc (registerActivityType, workflow function registry, command outputSchema); UPGRADE_NOTES entry for the warning-severity config validation.
