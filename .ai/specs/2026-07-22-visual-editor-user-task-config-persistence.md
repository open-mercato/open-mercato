---
title: Visual Editor User Task Configuration Persistence
date: 2026-07-22
status: draft
module: workflows
---

# Visual Editor User Task Configuration Persistence

## TLDR

The workflow visual editor must preserve `USER_TASK` assignment and form configuration across node edit, workflow save, API validation, reload, and node reopen. The change establishes one explicit ownership and merge contract for both node-editor variants, prevents stale React Flow snapshots or React callbacks from replacing dialog-edited `node.data`, and extends the workflow definition validator additively so supported user-task fields and extension metadata round-trip instead of being stripped. It does not change user-task runtime execution, authorization, notifications, persistence tables, or workflow state machines.

## Overview

A visual-editor `USER_TASK` moves through the following existing pipeline:

```text
stored workflow definition
  -> definitionToGraph()
  -> visual-editor Node.data
  -> NodeEditDialog or NodeEditDialogCrudForm
  -> page-owned node state
  -> graphToDefinition()
  -> workflowDefinitionDataSchema
  -> POST/PUT workflow definition API
  -> stored workflow definition
```

Every boundary must preserve the same logical configuration. A successful node or workflow save is not sufficient evidence; the canonical acceptance path is save, API read-back, full page reload, and node reopen.

This specification covers one independently deployable capability: lossless visual-editor round-tripping of user-task configuration. It is independent of personal task inboxes, task claim/complete authorization, workflow continuation, task notifications, and contextual business-record actions.

## Current Baseline and Concurrent Work

Baseline reviewed: `open-mercato/open-mercato` `develop` at `40b669666bb510f55bcb1ef841e8a181f3ccd429` on 2026-07-29.

Three open pull requests overlap this delivery surface and must be reconciled before implementation:

| Pull request | Overlap | Required integration decision |
| --- | --- | --- |
| [#4019](https://github.com/open-mercato/open-mercato/pull/4019) | Implements an earlier, narrower version of this persistence fix across validators, editor transforms, page state, tests, and Playwright coverage | This specification supersedes `.ai/specs/2026-07-08-workflow-user-task-config-persistence.md` from #4019. Continue by rebasing and updating #4019 or by explicitly carrying its commits forward; do not start a parallel implementation. Its now-colliding `TC-WF-030` allocation is replaced by the currently available `TC-WF-033`. |
| [#4085](https://github.com/open-mercato/open-mercato/pull/4085) | Owns runtime normalization and rendering of user-task form schemas | If merged first, consume its canonical `user-task-form-schema` helpers instead of introducing a second runtime normalizer. If still open, keep this change limited to editor/definition round-trip and rebase after #4085 before final review. |
| [#4291](https://github.com/open-mercato/open-mercato/pull/4291) | Changes role assignment controls plus the same dialogs, validator, page, and form transforms | If merged first, retain its `RoleSelect` UI and adapt the persistence helper to its values. If still open, do not absorb the role-selector feature into this fix; resolve shared-file conflicts and rerun both editor-variant suites. |

Implementation review must refresh these states and the `develop` baseline. Only one implementation PR may own the persistence fix; superseded branches must be closed or clearly redirected after the carry-forward exists.

## Goals

- Preserve direct assignment, role assignment, form key, allowed actions, form schema, and supported form-field metadata after workflow save and reload.
- Preserve advanced `userTaskConfig` extension keys that are not owned by structured editor controls.
- Make structured controls authoritative for keys they own, including explicit clearing and removal.
- Apply identical collision semantics to the legacy node dialog and the feature-flagged CrudForm dialog.
- Ensure workflow validate and save serialization, plus Test validation, observe the latest page-owned node data.
- Preserve React Flow-owned top-level graph state such as position and selection without allowing an older React Flow snapshot to roll back page-owned `node.data`.
- Keep the workflow definition API, database schema, tenant scoping, optimistic locking, and runtime behavior backward compatible.
- Add deterministic unit, component, integration, hydration, and headed UI evidence for the full round-trip.

## Non-Goals

- Changing `USER_TASK` runtime creation, assignment eligibility, claim, completion, or workflow-resume behavior.
- Adding a personal task inbox, notifications, deep links, contextual actions, or new ACL features.
- Changing workflow, step, activity, or user-task state machines.
- Adding new workflow definition routes, database columns, migrations, events, queues, caches, DI services, or module dependencies.
- Redesigning the visual editor or either node dialog.
- Recovering values that were already removed from previously stored workflow definitions.
- Generalizing a deep-merge utility for arbitrary workflow configuration objects.

## Problem Statement

The current `develop` implementation has three distinct loss points. All three must be addressed because fixing only one still permits a successful save followed by incomplete read-back.

### 1. Structured fields lose to stale advanced JSON

Both editor variants derive structured values and then merge the entire parsed advanced configuration over those updates:

- `NodeEditDialog` uses `Object.assign(updates, advancedConfig)`.
- `formValuesToNodeUpdates` uses `Object.assign(updates, parsed)`.

The advanced editor is initially hydrated from the node's existing `userTaskConfig`. It can therefore contain an older or empty `userTaskConfig` object. Whole-object assignment replaces the newly constructed role and form-schema values even though the structured controls display the new values.

Reversing the spread order alone is insufficient. When a user clears a managed value, an omitted structured property can allow the old advanced value to survive. Clearing the last form field, clearing `formKey`, or clearing assignment roles must remove the corresponding managed value rather than resurrect it from advanced JSON.

### 2. Definition validation strips valid editor fields

`userTaskConfigSchema` currently accepts only a subset of the configuration produced by the visual editor. Known editor fields such as `assignedToRoles`, `formKey`, and `allowedActions`, plus form-field metadata such as `placeholder` and `defaultValue`, are not described by the schema. Zod object parsing consequently removes them from validated payloads.

The custom `formSchema.fields[]` format and the existing JSON Schema-style `formSchema.properties` format are both supported contracts. Each must round-trip unchanged unless the user explicitly edits a JSON Schema-derived field and accepts the existing simplified-format conversion warning.

### 3. The page can serialize or accept stale node data

The visual-editor page stores nodes in React state, while React Flow also emits resolved node snapshots for selection, position, and deletion changes. Immediately after a dialog save:

- a callback created by an earlier render may still close over the previous `nodes` array; and
- a React Flow snapshot may contain current position/selection but older `node.data`.

The current page accepts those snapshots wholesale. Its validate and save callbacks serialize their captured `nodes` value, while Test validates the same captured value without serializing it. Either the wholesale snapshot replacement or a stale callback can therefore ignore the just-edited user-task data before validation or `graphToDefinition()` runs.

## Proposed Solution

### 1. Define field ownership and collision semantics

Use an explicit, module-local merge contract instead of generic deep merge. The canonical persisted representation is part of the contract so both editor variants produce identical JSON.

| Configuration surface | Owner | Non-empty behavior | Canonical persisted clear behavior |
| --- | --- | --- | --- |
| `assignedTo` | Structured user-task control plus legacy compatibility | Persist the entered string. Hydrate a legacy array as role assignment, matching runtime behavior, and normalize it to `assignedToRoles` on the next explicit node save | Omit the key |
| `assignedToRoles` | Structured user-task control | Persist the entered string array | Persist `[]` |
| `formKey` | Structured user-task control | Persist the entered string | Omit the key |
| Custom `formSchema.fields[]` | Structured form-field editor | Persist `{ "fields": [...] }` | Omit the key when the last field is removed |
| JSON Schema `formSchema.properties` | Original schema document plus an explicit form-editor dirty flag | Preserve the original schema when the simplified field editor is untouched. An explicit field edit accepts the existing conversion warning and persists the documented simplified representation | Omit the key only after the user explicitly removes the final field |
| `assignmentRule` | Advanced configuration | Persist the advanced string | Omit a key removed from advanced JSON |
| `slaDuration` | Advanced configuration | Persist the advanced duration string | Omit a key removed from advanced JSON |
| `escalationRules` | Advanced configuration | Persist the advanced array | Omit a key removed from advanced JSON |
| `allowedActions` | Advanced configuration synchronized to the existing graph alias | Persist the advanced string array | If omitted, retain existing graph serialization behavior and persist the default `["complete", "cancel"]` |
| Unknown `userTaskConfig` extension keys | Advanced configuration | Persist the supplied inert JSON value | Omit a key removed from advanced JSON |
| `retryPolicy` and other existing non-user-task advanced keys | Advanced configuration | Preserve existing behavior | Preserve existing behavior |

For a `userTask` node, the merge algorithm must:

1. Parse advanced configuration as a plain JSON object or reject it without updating the node.
2. Copy non-user-task advanced top-level fields using existing semantics.
3. Treat only `assignedTo`, `assignedToRoles`, `formKey`, and a deliberately edited simplified `formSchema` as structured-owned. Treat `assignmentRule`, `slaDuration`, `escalationRules`, `allowedActions`, and unknown extensions as advanced-owned because neither dialog exposes structured controls for them.
4. If `assignedTo` is an existing array, hydrate those values into the roles control, preserve its runtime meaning, and normalize the next explicit save to `assignedToRoles` with `assignedTo` omitted. If both legacy array assignment and `assignedToRoles` exist, the legacy array wins during hydration because that matches `step-handler.ts`.
5. Retain the original form schema and a form-editor dirty flag. Preserve an untouched JSON Schema document exactly as JSON data; replace it with `{ "fields": [...] }` only after an explicit simplified-field edit or remove it only after the last field is explicitly deleted.
6. Build the structured projection using the exact clear representations in the table above, then combine it with advanced-owned keys without allowing the stale advanced copies of structured-owned keys to win.
7. Reject the node update when the resulting `assignedTo` is empty and `assignedToRoles` is empty. The second clear attempt leaves node state unchanged and uses the existing dialog validation surface with a workflows locale key; retaining the other assignment channel keeps the clear valid.
8. Synchronize advanced `allowedActions`, assignment, form, SLA, and escalation values to the existing top-level aliases consumed by `graphToDefinition()`, and remove an alias when its authoritative source is explicitly cleared.
9. Produce a final `userTaskConfig` and top-level node aliases that cannot restore stale configuration during `graphToDefinition()`.

The same pure helper or equivalent shared contract must be used by both node-editor variants. Its inputs distinguish structured values, advanced JSON, original form-schema format, and form-editor dirtiness instead of pretending advanced-only values are structured fields. A small module-local helper is justified because it removes duplicated collision logic and enables deterministic tests; it must not become a general-purpose recursive merge abstraction.

The existing JSON Schema conversion warning remains authoritative. On an explicit simplified-field edit, conversion retains property names, mapped field types, `title` as label, membership in `required`, `enum` as options, `description` as placeholder, and a stringified `default`. It intentionally drops the JSON Schema container and keywords the simplified format cannot represent, including `$schema`, `$id`, `$defs`/`definitions`, `additionalProperties`, composition (`allOf`, `anyOf`, `oneOf`, `not`), constraints such as `pattern`, `minimum`, `maximum`, and `minLength`, and property extensions not mapped above. Untouched save, assignment-only edit, position/selection change, validation, Test, and workflow save must never trigger this conversion.

### 2. Establish a synchronous page-owned node source of truth

The visual-editor page remains the owner of editable `node.data` and node membership. React Flow owns graph mechanics such as position, dimensions, and selection, and may request membership changes only through explicit change provenance.

Introduce one page-local state update boundary that synchronously updates both:

- the rendered React node state; and
- a current-node reference used by immediate validate, save, and Test validation actions.

All page-owned node mutations must go through that boundary: initial definition load, add, dialog save, delete, clear, example load, and React Flow change handling.

The page owns a monotonically increasing graph-source epoch across responsive mobile, compact, and desktop graph remounts. It advances the epoch whenever the active graph render branch changes, passes that epoch to the keyed replacement graph, and accepts its events only after an `onGraphReady(epoch)` handshake. `WorkflowGraphImpl` owns only a per-epoch revision counter and emits a narrow change envelope containing `{ sourceEpoch, revision, resolvedNodes, changes }`, where `changes` is the original React Flow `NodeChange[]`. The page resets the accepted revision only when the new epoch is acknowledged, rejects callbacks from retired epochs plus older or duplicate revisions in the active epoch, applies explicit `add` and `remove` changes to membership, accepts graph-mechanics fields for existing IDs, and always retains the latest page-owned `data`. A resolved array entry without `add` provenance cannot resurrect a node that the page has deleted. The envelope and handshake are narrow graph-component contracts; because their prop interfaces are exported, they extend the public type surface additively.

The package nevertheless exports `WorkflowGraphProps`, `WorkflowGraphImplProps`, and `MobileVisualEditorProps` through `@open-mercato/core` wildcard paths. Their existing `onNodesChange(nodes: Node[])` callback name, argument shape, and behavior remain supported. Add optional `onNodeChangeEnvelope(envelope)` and `onGraphReady(sourceEpoch)` props instead of replacing the legacy callback; the graph may invoke both when both are supplied. The visual-editor page uses the new envelope callback, while existing consumers continue receiving resolved node arrays unchanged. Making the mobile legacy callback optional is allowed, but narrowing or repurposing it is not. Compatibility tests import all three exported prop interfaces and prove a legacy callback still receives `Node[]` while the additive callback receives provenance.

`handleValidate` and `handleSave` must serialize the synchronous current-node reference, not a potentially older render closure. `handleTest` must validate that same current reference only; test execution remains the existing TODO and this capability does not add serialization or execution behavior. Saving a node must also refresh the selected-node snapshot so reopening or retaining the dialog never displays pre-save data.

### 3. Make validation additive and lossless

Extend `userTaskConfigSchema` with optional definitions for:

- `assignedToRoles: string[]`
- `formKey: string`
- `allowedActions: string[]`
- custom form fields with `placeholder?: string` and `defaultValue?: unknown`

Retain existing fields and both form-schema formats. Preserve extension metadata at the narrowest existing JSON-document boundaries:

- custom form-field objects;
- custom and JSON Schema form-schema objects; and
- top-level `userTaskConfig`.

Passthrough is intentionally scoped to configuration JSON that already supports advanced extensions. It must not alter authentication, authorization, workflow execution, expression evaluation, or secret handling. Runtime consumers remain responsible for validating extension keys before acting on them.

This is an additive request and round-trip contract change: keys that were previously stripped may now be stored and returned. The route URLs and envelopes stay stable, but the accepted JSON subset expands. Current consumers are limited to:

| Consumer | Known behavior | Unknown-key behavior required by this spec |
| --- | --- | --- |
| Definition API validation and OpenAPI/type surfaces | Parse or describe the workflow definition and task payloads before persistence/return | Reject malformed known fields; preserve unknown inert extension keys without widening task API behavior |
| `graph-utils.ts` | Maps known assignment, form, action, SLA, and escalation fields between definition and node data | Carry inert extension data without executing it; keep advanced-owned aliases synchronized |
| `NodeEditDialog.tsx`, `NodeEditDialogCrudForm.tsx`, and `nodeFormTransforms.ts` | Hydrate structured fields, simplified form fields, and advanced JSON | Preserve unknown keys; structured ownership wins only for actual controls; preserve untouched JSON Schema documents |
| `step-handler.ts` | Reads `assignedTo`, `assignedToRoles`, `formSchema`, and `slaDuration` when creating a runtime task | Preserve legacy array-assignment meaning and ignore all other keys |
| `task-handler.ts` | Validates completion data against known `formSchema.properties` and `required` keys | Ignore unknown schema/configuration keys and retain existing validation outcomes |
| Backend task detail page | Renders known JSON Schema properties, required flags, titles, descriptions, types, and enums | Ignore unknown keywords and never render them as executable content |
| `MobileTaskForm.tsx` | Renders the same known JSON Schema subset for mobile task completion | Ignore unknown keywords and retain existing known-field rendering |
| Checkout demo task form | Validates required fields and renders known JSON Schema properties | Ignore unknown keywords and retain existing known-field rendering |

Implementation review must repeat this inventory against the final upstream head. Tests must prove malformed values for every known field fail validation rather than bypassing it as passthrough metadata, unknown keys remain inert, and known completion validation/rendering behavior is unchanged in each current task surface.

### 4. Preserve graph serialization and rehydration symmetry

`definitionToGraph()` must continue to expose the full stored `userTaskConfig` to the node and mirror structured fields needed by existing controls. `graphToDefinition()` must emit:

- the current structured values;
- preserved advanced-only keys;
- an untouched original JSON Schema document, or the simplified `fields[]` schema only after an explicit field edit;
- the semantic equivalent of legacy array-form assignment, normalized to `assignedToRoles` on explicit save; and
- no managed key that the user explicitly cleared.

The graph conversion functions must not invent a new API shape. Existing defaults such as `allowedActions` remain behaviorally compatible.

## Data Model

No entity or database schema changes are required. Configuration remains inside the existing workflow definition JSON document.

Representative persisted shape:

```json
{
  "steps": [
    {
      "stepId": "initial_contact",
      "stepName": "Initial contact",
      "stepType": "USER_TASK",
      "userTaskConfig": {
        "assignedToRoles": ["sales_representative"],
        "formKey": "initial_contact_form",
        "allowedActions": ["complete", "cancel"],
        "formSchema": {
          "fields": [
            {
              "name": "conversation_summary",
              "type": "textarea",
              "label": "Conversation summary",
              "required": true,
              "placeholder": "Describe the conversation",
              "defaultValue": ""
            }
          ]
        },
        "extensionMode": "review"
      }
    }
  ]
}
```

The example uses generic identifiers only. It introduces no new required property.

This capability does not relax the workflows module invariant that a runnable user task has `assignedTo` or a non-empty `assignedToRoles`. Both dialogs and `validateWorkflowGraph()` reject an explicit visual-editor state with neither channel, without narrowing the existing definition API schema for legacy documents. Clear-state tests exercise the two assignment fields independently while retaining the other assignment channel, then prove that clearing the final channel is rejected and leaves the prior node state intact.

## API Contracts

### Existing routes

| Route | Method | Role in this capability |
| --- | --- | --- |
| `/api/workflows/definitions` | `POST` | Create a definition containing the complete user-task configuration |
| `/api/workflows/definitions/[id]` | `GET` | Canonical read-back after create or update |
| `/api/workflows/definitions/[id]` | `PUT` | Persist the complete edited definition using existing optimistic locking |

No URL, method, metadata, OpenAPI operation, authentication, feature guard, tenant scope, request envelope, or response envelope changes are proposed. The accepted and returned `userTaskConfig` JSON is expanded additively as described above.

### Validation and errors

- Invalid advanced JSON fails before node state is updated and keeps the dialog open with the existing error surface.
- Clearing the final assignment channel fails before node state is updated, keeps the dialog open, and uses a localized workflows validation message.
- Schema-invalid workflow definitions continue to return the existing validation error response.
- Missing or inaccessible definitions continue to use existing `404` and authorization behavior.
- Concurrent edits continue to use the existing optimistic-lock header and structured `409` conflict flow.
- No partial write is introduced: the workflow definition remains one existing API mutation.

## Backward Compatibility

- All new validator fields are optional and additive.
- Existing JSON Schema-style form definitions remain accepted and remain unchanged on untouched, assignment-only, graph-mechanics, validation, Test, and workflow-save paths.
- An explicit edit in the simplified form-field editor retains the existing conversion warning and applies only the documented lossy mapping; this capability does not silently broaden or hide that conversion.
- Existing custom `fields[]` form definitions remain accepted.
- Existing `assignedTo: string[]` definitions retain their runtime role-assignment meaning and normalize deterministically to `assignedToRoles` only on explicit node save.
- Existing advanced `userTaskConfig` extension keys remain preserved.
- Existing API routes, import paths, event IDs, DI keys, ACL IDs, widget spot IDs, and generated registries are unchanged.
- Existing exported graph/mobile callback props keep accepting resolved `Node[]`; the provenance envelope and source-ready handshake are additive optional props.
- The definition API schema remains readable for legacy unassigned documents; the new both-empty assignment rejection is scoped to explicit visual-editor node save/graph validation so this fix does not silently narrow the wire contract.
- No migration or backfill is required.
- Previously stripped data cannot be inferred and is not reconstructed automatically.
- Rolling back the code does not invalidate untouched stored JSON, but it makes subsequent edits unsafe because the old validator/editor can strip the repaired fields again. Operational rollback must either roll forward promptly or temporarily disable affected visual-editor saves until save/read-back verification passes.

## Security, Tenancy, and Privacy

- The existing workflow definition API authentication, RBAC, tenant, and organization scoping remain authoritative.
- The change adds no query and cannot broaden record visibility.
- Advanced configuration is parsed as JSON data, never evaluated as code.
- No raw HTML rendering, URL construction, file path construction, secret access, logging of definition contents, or external call is added.
- New passthrough metadata is persisted only inside the already-authorized workflow definition document. Runtime features must not execute unknown keys.
- User-task form metadata can describe future free-text fields but this change stores schema, not submitted user data; no new PII column or encryption map is required.

## Undo and Recovery

- Before workflow save, users can cancel the node dialog and retain the previous node state.
- After workflow save, users can reopen the node and edit or clear the configuration using the same optimistic-lock-protected definition update.
- Invalid advanced JSON does not mutate node or workflow state.
- A failed API save leaves the stored definition unchanged and uses existing error/conflict handling.
- No events, notifications, background jobs, or external side effects require compensation.
- There is no automatic recovery for values already absent from storage; users must re-enter them.

## Frontend Architecture Contract

### Server/Client boundary map

| Route / surface | Server root | Client islands | Data owner | Notes |
| --- | --- | --- | --- | --- |
| `/backend/definitions/visual-editor?id=<definitionId>` | Existing generated backend route shell | Existing client `visual-editor/page.tsx`, `WorkflowGraph`, and one of the two node dialogs | Existing workflow definition API plus page-owned current-node state | No new route, provider, or client root |

### `use client` ledger

| File | Reason | Imported by | Heavy deps? | Cleanup / hydration risk | Alternative rejected |
| --- | --- | --- | --- | --- | --- |
| `backend/definitions/visual-editor/page.tsx` | Existing graph editing, React state, browser route state, dialogs | Generated backend route shell | Existing graph surface | Stale callback and hydration regressions covered by route and interaction tests | Converting this bug fix into a server/client redesign would expand scope |
| `components/WorkflowGraph.tsx` | Existing lazy client wrapper and callback type boundary | Visual editor page and mobile wrapper | Existing dynamically loaded graph implementation | Envelope typing must remain type-only and add no eager graph runtime import | Moving graph state into the page would expand the client blob and break the lazy boundary |
| `components/WorkflowGraphImpl.tsx` | Existing React Flow runtime owner | `WorkflowGraph` | Existing `@xyflow/react` dependency | Monotonic revision and change provenance covered by pure and interaction tests | Resolved arrays alone cannot distinguish legitimate membership changes from stale snapshots |
| `components/mobile/MobileVisualEditor.tsx` | Existing mobile client composition | Visual editor page | Existing `WorkflowGraph` | Must forward the same envelope without a second merge policy | A mobile-specific ownership contract would allow variant drift |
| `components/NodeEditDialog.tsx` | Existing stateful dialog and keyboard interaction | Visual editor page | No new dependency | Existing dialog lifecycle; component regression coverage required | Server component cannot own interactive form state |
| `components/NodeEditDialogCrudForm.tsx` | Existing feature-flagged interactive form | Visual editor page | No new dependency | Feature-flag parity must be tested | Removing either variant is out of scope |

No new top-level `use client` file is introduced.

### Client blob guardrail and budgets

| Budget | Spec value |
| --- | --- |
| New generated/backend page-root `use client` files | `0` |
| New client files over 300 LOC | `0` |
| Existing client page/root files newly made larger architectural owners | `0`; pure merge/state logic is extracted to small module-local helpers |
| New heavy browser libraries at page/provider root | `0` |
| Provider/bootstrap registry changes | `0` |
| Hydration smoke | Required for the visual-editor route |
| Performance evidence | Client-boundary static check plus headed route interaction; no bundle increase expected because no dependency is added |

The existing visual-editor page is already a large client surface. This change may route updates through one local boundary but must keep reusable merge behavior in small pure helpers and must not add a new provider, graph library, or global bootstrap dependency.

### UI and design-system constraints

- No layout, visual hierarchy, visible label, status color, icon, or interaction redesign is proposed.
- Existing shared dialogs, inputs, buttons, flash/conflict handling, keyboard submit/cancel, and i18n remain in use.
- Any touched UI line must continue to comply with semantic design tokens, shared primitives, Lucide icon rules, and icon-button accessibility requirements.
- One assignment-required validation key is expected in the workflows locale dictionaries for all supported locales. Any other new user-facing string must follow the same localization path.

## Implementation Plan

### Phase 1: Lossless configuration contract

1. Add validator regression tests that demonstrate current stripping of roles, form key, allowed actions, field metadata, and extension keys.
2. Extend the user-task and form-field schemas additively.
3. Add a small pure user-task configuration merge helper with tests for actual structured/advanced ownership, legacy array assignment, untouched JSON Schema preservation, explicit simplified conversion, invalid input, and clearing.
4. Reject an explicit visual-editor save or graph validation that clears the final assignment channel, surface the localized error in both dialogs, and leave the definition API schema readable for legacy unassigned documents.
5. Apply the same helper to the legacy and CrudForm transformation paths, removing the unused pseudo-structured SLA, assignment-rule, and escalation projections rather than adding new controls.
6. Keep `graphToDefinition()` and `definitionToGraph()` symmetric for advanced-owned aliases and both form-schema formats.
7. Keep both node editor variants working with no visible UI change except the final-assignment validation error.

Working result: both editor transforms produce the same complete node update and schema parsing preserves it.

### Phase 2: Current-node state boundary

1. Add a pure node-change-envelope merge helper that encodes page-owned membership/data, React Flow mechanics, explicit add/remove provenance, page-owned source epochs, and per-epoch revision rejection.
2. Add a synchronous current-node reference and one page update boundary.
3. Add optional source-ready and node-change-envelope callbacks that handshake a page-issued source epoch and forward resolved nodes, original `NodeChange[]`, source epoch, and per-epoch revision. Preserve the exported legacy `onNodesChange(nodes: Node[])` contract, and route initial load, add, dialog save, delete, clear, example load, graph remount, and accepted React Flow changes through the page boundary.
4. Make validate and save serialize the current-node reference, and make Test validate the same reference without adding execution or serialization behavior.
5. Refresh the selected-node snapshot after node save.

Working result: an immediate workflow action or later graph snapshot cannot roll back dialog-edited configuration.

### Phase 3: End-to-end regression proof

1. Add focused component coverage for both dialog variants, including actual structured clears, advanced-owned edits/removals, legacy assignment normalization, and untouched/explicitly converted schemas.
2. Add page coverage that captures pre-edit save/validate/Test callbacks and proves save/validate serialize the later node edit while Test validates it without serializing.
3. Add focused prop-contract coverage proving all exported graph/mobile interfaces still accept the legacy `Node[]` callback while the new envelope callback is additive.
4. Add self-contained integration test `TC-WF-033` for create, read-back, update, second read-back, and cleanup.
5. Run headed UI round-trip coverage for both editor variants on the final implementation head.
6. Capture save, reload, reopened-dialog, and canonical API evidence before QA approval.

Working result: the exact user-visible failure is proven fixed through the complete persistence boundary.

### File Manifest

| File | Action | Purpose |
| --- | --- | --- |
| `packages/core/src/modules/workflows/data/validators.ts` | Modify | Preserve supported user-task and form metadata |
| `packages/core/src/modules/workflows/data/__tests__/validators.test.ts` | Modify | Prove validator round-trip and compatibility |
| `packages/core/src/modules/workflows/lib/nodeConfigMerge.ts` | Create | Centralize narrow user-task collision and clearing semantics |
| `packages/core/src/modules/workflows/lib/__tests__/nodeConfigMerge.test.ts` | Create | Test collision, extension preservation, and clearing |
| `packages/core/src/modules/workflows/lib/nodeFormTransforms.ts` | Modify | Apply the shared contract to CrudForm values |
| `packages/core/src/modules/workflows/lib/__tests__/nodeFormTransforms.test.ts` | Create or modify | Cover CrudForm parity |
| `packages/core/src/modules/workflows/components/NodeEditDialog.tsx` | Modify | Apply the shared contract to the legacy dialog |
| `packages/core/src/modules/workflows/components/__tests__/NodeEditDialog.test.tsx` | Create | Cover legacy dialog persistence and clearing |
| `packages/core/src/modules/workflows/lib/graph-utils.ts` | Modify | Keep advanced aliases, legacy assignment normalization, and both schema formats symmetric |
| `packages/core/src/modules/workflows/lib/__tests__/graph-utils.test.ts` | Create or modify | Cover definition/node round-trip compatibility |
| `packages/core/src/modules/workflows/components/WorkflowGraph.tsx` | Modify | Add optional source-ready and envelope callbacks while preserving the exported legacy resolved-node callback |
| `packages/core/src/modules/workflows/components/WorkflowGraphImpl.tsx` | Modify | Preserve the legacy callback, acknowledge the page epoch, and emit resolved nodes with `NodeChange[]` provenance plus per-epoch revision |
| `packages/core/src/modules/workflows/components/mobile/MobileVisualEditor.tsx` | Modify | Forward the additive callbacks without narrowing the exported legacy prop or adding a second ownership path |
| `packages/core/src/modules/workflows/components/__tests__/WorkflowGraph.callbacks.test.tsx` | Create | Prove legacy callback compatibility and additive envelope/source-ready typing across exported graph/mobile props |
| `packages/core/src/modules/workflows/lib/visual-editor-node-state.ts` | Create | Encode page/React Flow ownership and revision handling |
| `packages/core/src/modules/workflows/lib/__tests__/visual-editor-node-state.test.ts` | Create | Cover positions, selection, explicit add/remove, source replacement, stale epochs/revisions, and latest data |
| `packages/core/src/modules/workflows/backend/definitions/visual-editor/page.tsx` | Modify | Use the synchronous current-node source for graph actions |
| `packages/core/src/modules/workflows/backend/definitions/__tests__/visual-editor.userTaskNodeState.test.tsx` | Create | Cover stale callback serialization |
| `packages/core/src/modules/workflows/__integration__/TC-WF-033.spec.ts` | Create | Prove API and UI-safe canonical round-trip with cleanup |
| `CHANGELOG.md` | Modify | Record the user-visible bug fix |

File names may follow the closest existing naming convention at implementation time. No generated file or migration is expected.

## Testing Strategy

### Unit and component matrix

| Boundary | Required cases |
| --- | --- |
| Validator | Custom `fields[]`; JSON Schema `properties`; direct string and legacy array assignment; roles; form key; allowed actions; assignment rule; SLA duration; escalation rules; placeholder; default value; extension keys; malformed known fields rejected |
| Configuration merge | Empty stale config; collisions for the four actual structured surfaces; advanced-owned actions/rule/SLA/escalations/extensions; invalid/non-object JSON; legacy array normalization; exact clear representations; final assignment clear rejected without mutation |
| CrudForm transform | Structured collision precedence; advanced-owned edits/removals; top-level alias synchronization; legacy array assignment; untouched JSON Schema; deliberate simplified conversion; exact clears; localized both-empty assignment rejection |
| Legacy dialog | The same ownership and compatibility cases as CrudForm; add/edit/remove simplified fields; save payload; localized both-empty assignment rejection; keyboard behavior unchanged; no new pseudo-structured controls |
| Node change envelope | Position/selection accepted; page-owned data retained; explicit additions/removals accepted; replacement source handshake; revision restart in a new epoch; out-of-order snapshots plus retired-epoch and stale/duplicate active-revision rejection; no array-only deleted-node resurrection; deterministic ordering; legacy `onNodesChange` still receives resolved `Node[]` |
| Visual-editor page | Immediate validate/save after dialog edit serializes current data; immediate Test validates current data without serialization; selected node reflects save; delayed callbacks from retired graph sources cannot roll back current data |
| Graph conversion | Definition-to-graph-to-definition preserves untouched JSON Schema, custom fields, extension keys, advanced aliases, and legacy assignment semantics |
| Runtime/task consumers | `step-handler` assignment/form behavior; task completion validation; backend, mobile, and checkout known-field rendering; unknown keys inert |

### Integration coverage

`TC-WF-033` must be a self-contained, retry-safe Playwright test through the real visual-editor route:

1. Authenticate using shared integration helpers.
2. Create uniquely named fixtures through the API covering a custom `fields[]` schema, a JSON Schema `properties` document with unsupported keywords/extensions, and legacy `assignedTo: string[]`, plus all advanced-owned values and one benign extension key.
3. Open `/backend/definitions/visual-editor?id=<definitionId>`, edit structured values through their controls and advanced-owned values through advanced JSON, save the node, force React Flow selection/position updates, and immediately save the workflow.
4. Reload the route, reopen the node, and assert the edited values through the UI.
5. Read each definition through the API and assert exact logical persistence: custom metadata, advanced-only keys, legacy assignment normalized without changing role meaning, and untouched JSON Schema including unsupported keywords.
6. Explicitly edit the simplified fields derived from the JSON Schema fixture, acknowledge the existing warning, and assert the documented converted representation and dropped-key set after API read-back.
7. Exercise structured clears through controls and advanced-owned removals through advanced JSON, save and reload again, then assert the exact canonical representation from the table above in both UI and API read-back. Test direct assignment and role clearing in separate edits so every runnable fixture keeps at least one valid assignment channel.
8. Attempt to clear the remaining assignment channel, assert the localized validation error, and prove through the dialog plus API read-back that the node retains its prior valid assignment.
9. Exercise graph add/remove and drag/select through the visible controls, remount through mobile, compact, and desktop viewport transitions, edit again, immediately save, read the canonical API response, reload, and reopen the node. Prove the visible replacement graph accepts the edit and a removed node remains absent. Out-of-order snapshots, stale or duplicate revisions, retired epochs/sources, and delayed callbacks remain deterministic pure node-state and page component test responsibilities rather than Playwright inputs.
10. Delete every fixture in `finally`, without relying on seeded/demo data.

The same test must be executable in both build configurations: default legacy dialog and `NEXT_PUBLIC_WORKFLOW_CRUDFORM_ENABLED=true`. Before the implementation PR is ready, evidence must show both executions on its final head. The test belongs under the workflows module `__integration__` directory and must use the current shared helper import paths.

### Headed UI coverage

Use headed execution of `TC-WF-033` on the final implementation head for the default legacy dialog and again with `NEXT_PUBLIC_WORKFLOW_CRUDFORM_ENABLED=true`:

1. Open a fixture in `/backend/definitions/visual-editor?id=<definitionId>`.
2. Edit roles and form key through structured controls; edit allowed actions, assignment rule, SLA duration, escalation rules, and one extension key through advanced JSON; edit a simplified form field including placeholder/default value.
3. Save the node, then drag/select it to force a React Flow node update.
4. Invoke Validate, Test, and save immediately; confirm Validate and Test observe the edited node while only save serializes it.
5. Reload the page and reopen the same node.
6. Confirm all edited and advanced-only values remain.
7. Open a legacy array-assignment fixture, save it, and confirm its role meaning is retained through normalization to `assignedToRoles`.
8. Save an untouched JSON Schema fixture after assignment and graph-mechanics changes and confirm the complete schema is unchanged; then explicitly edit a derived field and confirm the warned simplified conversion exactly matches the documented mapping.
9. Clear direct assignment and roles in separate edits while keeping the other assignment channel populated; clear form key and the final simplified field through controls, and remove rule/SLA/escalation/action/extension keys through advanced JSON. Save, reload, and confirm the exact persisted representations.
10. Attempt to clear the remaining assignment channel and confirm the localized rejection leaves the node and canonical API representation unchanged.
11. Confirm canonical API read-back matches the reopened dialog and clean up all fixtures.

Required evidence: route and final commit, editor variant, before-save state, workflow-save result, reloaded dialog, cleared-state reload, API read-back, and cleanup result.

### Targeted verification commands

Use Corepack with the repository-pinned Yarn version. The implementation should run the smallest relevant subsets first, followed by the required integration and boundary checks:

```bash
corepack yarn workspace @open-mercato/core test --runInBand --runTestsByPath <targeted workflow test files>
corepack yarn workspace @open-mercato/core typecheck
corepack yarn check:client-boundaries
corepack yarn test:integration:ephemeral --filter TC-WF-033
```

Run `corepack yarn generate` only if implementation changes an auto-discovered module file shape that requires regeneration. No database migration command is expected.

## Risks and Impact Review

### Data Integrity Failures

#### Cleared fields are restored from advanced configuration
- **Scenario**: The structured editor omits an empty value while its previous value remains in advanced `userTaskConfig`, so a merge restores data the user removed.
- **Severity**: High
- **Affected area**: Workflow visual editor and stored workflow definitions
- **Mitigation**: Define structured ownership, explicit clearing semantics, and regression tests for roles, form key, and the final form field in both editor variants.
- **Residual risk**: A future structured field could be added without joining the managed-key set; review must require ownership coverage for every new control.

#### Immediate workflow action serializes the previous node snapshot
- **Scenario**: The user saves a node and immediately selects Validate, Test, or Save before React commits a render with the new nodes.
- **Severity**: High
- **Affected area**: Visual-editor workflow definition persistence
- **Mitigation**: Synchronize all page-owned node updates into a current reference; Validate and Save serialize it, while Test validates it without introducing nonexistent execution/serialization behavior.
- **Residual risk**: A future node mutation that bypasses the central update boundary could reintroduce the race; page tests and code review must check all node setters.

#### Clearing both assignment channels creates an unclaimable task
- **Scenario**: A visual-editor user removes the final direct or role assignment, leaving a runnable user task that no actor can claim.
- **Severity**: High
- **Affected area**: Workflow authoring, graph validation, and future task execution
- **Mitigation**: Reject the final clear before mutating node state in both dialogs and reject the same both-empty state during visual graph validation, with component and real-route regression coverage.
- **Residual risk**: Legacy API-authored documents may already be unassigned; this capability deliberately keeps those documents readable and does not narrow the established definition wire schema.

#### Legacy array assignment changes meaning during edit
- **Scenario**: An existing `assignedTo: string[]` definition is loaded into a string-only control and is stringified, cleared, or combined differently from runtime behavior.
- **Severity**: High
- **Affected area**: Existing runnable user tasks
- **Mitigation**: Hydrate the array as roles, preserve the current array-wins precedence when both forms exist, and normalize only on explicit save to `assignedToRoles` with graph/API/read-back tests.
- **Residual risk**: The stored representation changes on explicit save, but the runtime assignment meaning remains stable and deterministic.

### Cascading Failures and Side Effects

#### React Flow data changes are accidentally ignored
- **Scenario**: A future graph behavior legitimately updates `node.data`, but the page ownership merge always keeps previous data.
- **Severity**: Medium
- **Affected area**: Visual-editor node rendering and serialization
- **Mitigation**: Document the ownership invariant, carry original `NodeChange[]` provenance plus a page-owned source epoch and per-epoch revision, keep graph mechanics in top-level node fields, and test explicit add/remove, responsive remount, retired source, stale revision, and current mechanics cases.
- **Residual risk**: The invariant must be revisited if React Flow becomes a legitimate `node.data` producer.

#### Editor variants diverge again
- **Scenario**: Legacy and CrudForm dialogs implement different merge or clearing rules.
- **Severity**: Medium
- **Affected area**: Feature-flag-dependent workflow authoring
- **Mitigation**: Reuse one pure contract and run parallel regression cases for both variants.
- **Residual risk**: Variant-specific field mapping still requires component-level coverage.

### Tenant and Data Isolation Risks

#### Broader passthrough persists unintended extension data
- **Scenario**: An authorized workflow editor stores an unknown `userTaskConfig` key that a later runtime feature interprets unsafely.
- **Severity**: Medium
- **Affected area**: Workflow definition JSON and future extension consumers
- **Mitigation**: Scope passthrough to existing advanced configuration boundaries, keep known fields validated, never evaluate unknown data, and require runtime consumers to validate keys before use.
- **Residual risk**: The JSON document can contain inert unknown metadata by design; future consumers remain a review boundary.

No new query, cache, shared resource, or cross-tenant access path is introduced. Existing organization and tenant filters remain unchanged.

### Migration and Deployment Risks

#### Existing form-schema format regresses
- **Scenario**: Validator changes preserve the custom `fields[]` format but reject or rewrite existing JSON Schema-style `properties` definitions.
- **Severity**: High
- **Affected area**: Existing workflow definitions and API clients
- **Mitigation**: Keep the union additive, preserve the full original JSON Schema unless the simplified field editor is explicitly changed, retain the existing conversion warning, and test untouched plus deliberately converted paths through API and graph round-trip.
- **Residual risk**: Explicit simplified conversion remains intentionally lossy for the enumerated unsupported keywords; the warning and exact converted read-back are mandatory evidence.

#### Previously lost data is assumed to be recoverable
- **Scenario**: Operators expect deployment to restore configuration that is already absent from storage.
- **Severity**: Medium
- **Affected area**: Existing affected workflow definitions
- **Mitigation**: State explicitly that there is no backfill and require users to re-enter missing values.
- **Residual risk**: The system cannot distinguish intentionally empty configuration from previously stripped configuration.

The change is deployable without downtime and requires no migration. Rollback leaves untouched stored JSON readable, but affected workflow editing must be disabled or guarded until a roll-forward because an old save can strip the repaired configuration.

### Operational Risks

#### Large client page becomes harder to maintain
- **Scenario**: More state logic is embedded directly in the existing visual-editor client page.
- **Severity**: Low
- **Affected area**: Frontend maintainability and regression risk
- **Mitigation**: Keep the page boundary small and extract pure merge behavior into focused module-local helpers with tests.
- **Residual risk**: The existing page remains large; broader decomposition is intentionally out of scope.

#### Integration coverage passes while the UI path remains broken
- **Scenario**: API create/update/read-back works, but a dialog or React state boundary still drops values.
- **Severity**: High
- **Affected area**: Customer-facing workflow authoring
- **Mitigation**: Require component, page, integration, and headed save-reload-reopen evidence for both variants.
- **Residual risk**: Browser and framework timing can vary; headed evidence must use the final commit and exact affected route.

## Final Compliance Report - 2026-07-22

### AGENTS.md Files and Guides Reviewed

- `AGENTS.md`
- `BACKWARD_COMPATIBILITY.md`
- `.ai/specs/AGENTS.md`
- `.ai/qa/AGENTS.md`
- `.ai/skills/om-spec-writing/SKILL.md`
- `.ai/skills/om-spec-writing/references/spec-template.md`
- `.ai/skills/om-spec-writing/references/spec-checklist.md`
- `.ai/skills/om-spec-writing/references/compliance-review.md`
- `.ai/skills/om-spec-writing/references/frontend-architecture-contract.md`
- `.ai/ds-rules.md`
- `packages/core/AGENTS.md`
- `packages/core/src/modules/workflows/AGENTS.md`
- `packages/ui/AGENTS.md`

### Compliance Matrix

| Rule source | Rule | Status | Notes |
| --- | --- | --- | --- |
| Root `AGENTS.md` | Check existing specs and keep the change minimal | Compliant | One workflows capability; related merged specs do not cover this round-trip |
| Root `AGENTS.md` | Preserve behavior unless explicitly changed | Compliant | Only data-loss behavior changes; runtime and public contracts remain stable |
| Root `AGENTS.md` | New feature specs include API and key UI integration coverage | Compliant | Real-route Playwright coverage is required in both editor configurations, including save/reload/reopen and cleanup |
| `BACKWARD_COMPATIBILITY.md` | API routes, exported types, event IDs, DI keys, ACL IDs, and schema are stable | Compliant | Additive optional validator fields and graph callbacks; exported legacy `Node[]` callbacks remain supported; legacy array assignment keeps runtime meaning; untouched JSON Schema stays unchanged; no frozen identifier changes |
| `.ai/specs/AGENTS.md` | Include required sections, concrete risks, and changelog | Compliant | All required sections are present |
| `.ai/qa/AGENTS.md` | Integration tests are module-local, deterministic, fixture-owned, and cleaned up | Compliant | `TC-WF-033` covers only user-executable real-route behavior and cleans up its definitions; internal epoch, revision, snapshot-order, and retired-source cases remain deterministic unit/component coverage |
| `packages/core/AGENTS.md` | Preserve API metadata, guards, tenant scope, and optimistic locking | Compliant | Existing routes and mutation flow are unchanged |
| Workflows `AGENTS.md` | Do not change state machines; keep workflow data tenant scoped | Compliant | Definition-authoring-only change; no new query or state transition |
| `packages/ui/AGENTS.md` and DS rules | Reuse existing primitives, i18n, dialog keyboard, and semantic tokens | Compliant | No visible UI redesign; the assignment-required error uses workflows locale dictionaries |
| Frontend architecture contract | Declare boundaries, client ledger, budgets, and interaction evidence | Compliant | Existing client surface is bounded; no new heavy dependency/provider/client root |
| Spec checklist | Define undo, security, compatibility, risks, and deployment behavior | Compliant | Explicitly covered; irrelevant cache/event/worker concerns are N/A |

### Internal Consistency Check

| Check | Status | Notes |
| --- | --- | --- |
| Data model matches API contract | Pass | Existing workflow JSON document and routes are unchanged |
| API contract matches UI path | Pass | Both dialogs distinguish actual structured controls, advanced-owned values, and deliberate schema conversion before graph serialization and API validation |
| Clearing semantics match read-back criteria | Pass | Structured clears and advanced-owned removals are separately specified and tested through reload |
| Assignment invariant matches compatibility boundary | Pass | Visual node save and graph validation reject a final clear without narrowing the legacy definition API schema |
| Exported callback compatibility | Pass | Legacy `Node[]` callbacks remain supported and the provenance envelope is additive |
| Risks cover all writes | Pass | One existing atomic definition mutation with optimistic locking |
| Commands/events/cache strategy | N/A | No new domain command, event, cache, worker, or side effect |
| Frontend ownership and hydration plan | Pass | Page/React Flow ownership, budgets, and headed interaction proof are explicit |

### Non-Compliant Items

None in the specification content. Lifecycle approval remains separate: this draft is not implementation authorization until it has completed independent review, merged through the specification-only contribution path, been claimed by a public issue, and received the applicable approval gate.

### Verdict

- **Content**: Fully compliant draft for targeted review.
- **Lifecycle**: Blocked for implementation until the specification contribution and admission sequence complete.

## Changelog

### 2026-07-29

- Reconciled the specification with overlapping open work in #4019, #4085, and #4291, including one-owner and test-ID guidance.
- Preserved the exported `onNodesChange(nodes: Node[])` contract and made graph provenance/ready callbacks additive, with explicit compatibility coverage.
- Enforced the runnable user-task assignment invariant at visual node save and graph validation while retaining legacy API readability.

### 2026-07-22

- Created a dedicated draft for lossless visual-editor `USER_TASK` configuration round-trip.
- Added explicit managed-key clearing semantics, both editor variants, synchronous node-state ownership, additive validation, frontend architecture constraints, and full API/UI regression coverage.
- Incorporated fresh review findings by defining exact persisted clear values, covering every structured-owned key, constraining rollback guidance, requiring real-route Playwright coverage, and classifying passthrough as an additive contract change with a consumer inventory.
- Corrected final contribution-review gaps: ownership now matches actual controls, legacy array assignment keeps its runtime meaning, untouched JSON Schema remains intact, deliberate conversion is enumerated, React Flow changes carry provenance/revisions, the full task consumer inventory is tested, and Test is validation-only.

### Review - 2026-07-22

- **Reviewer**: Fresh read-only reviewer
- **Scope cohesion**: Passed; one independently deployable persistence capability, no split recommended
- **Security**: Passed after adding the passthrough consumer inventory and malformed-known-field tests
- **Performance**: Passed; no dependency/provider expansion and pure logic remains outside the large client page
- **Cache**: N/A; no cache or query change
- **Commands**: N/A; no new domain mutation or side effect
- **Risks**: Passed after exact clear-state, rollback, and durable route-level regression requirements were added
- **Verdict**: Ready for targeted draft review; implementation remains lifecycle-blocked

### Review fix-forward - 2026-07-29

- **Reviewer**: Automated PR review with an independent fresh-context scope pass
- **Scope cohesion**: Passed; the spec remains one independently deployable round-trip capability
- **Backward compatibility**: Passed after preserving exported legacy graph/mobile callbacks and making provenance additive
- **Concurrent work**: Passed after documenting ownership and integration decisions for #4019, #4085, and #4291
- **Data integrity**: Passed after rejecting the final assignment clear without narrowing the legacy definition wire schema
- **Verdict**: Ready for re-review; implementation remains lifecycle-blocked
