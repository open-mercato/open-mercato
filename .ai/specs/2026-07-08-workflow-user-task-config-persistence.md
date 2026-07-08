---
title: Workflow User Task Config Persistence
date: 2026-07-08
status: in-progress
module: workflows
---

# Workflow User Task Config Persistence

## TLDR

Workflow user-task configuration saved from the visual editor must round-trip without losing assignment roles, form keys, allowed actions, or form-field metadata. The fix keeps visible dialog/CrudForm values from being overwritten by stale advanced JSON, prevents stale React Flow node snapshots from rolling back page-owned node data, and widens the workflow definition validator so it preserves visual-editor user-task fields instead of stripping them.

## Overview

The workflow visual editor supports `USER_TASK` nodes with:

- assignment data (`assignedTo`, `assignedToRoles`)
- form selection (`formKey`)
- form schema (`formSchema.fields`)
- task actions (`allowedActions`)
- runtime extensions and existing advanced `userTaskConfig` fields

The persistence path spans two layers:

1. UI node editing builds React Flow node data.
2. Graph serialization and API validation save that data in the workflow definition document.

Both layers must preserve the same contract.

## Problem Statement

Saving a user-task node could report success while reopening the workflow showed the user-task form fields as empty. Three code paths caused the loss:

1. The legacy node edit dialog loaded `node.data.userTaskConfig` into advanced configuration. When saving, it built a fresh `updates.userTaskConfig` from visible fields, then merged the stale advanced object over the fresh updates. If the advanced object contained `userTaskConfig: {}`, the fresh form schema and role assignment were overwritten.
2. The API validator accepted `userTaskConfig`, but its Zod schema only described a narrow subset of keys. Zod stripped visual-editor keys such as `assignedToRoles`, `formKey`, `allowedActions`, and form-field metadata like `placeholder` or `defaultValue`.
3. The visual editor page accepted full node snapshots from React Flow via `handleNodesChange` and replaced page state with them. A selection or position snapshot from React Flow could contain stale `node.data`, rolling back the node data that had just been saved by the dialog before the final workflow save.

This is a code bug, not an environment configuration issue. The environment can choose the legacy dialog or CrudForm editor, but both persistence paths must preserve the same workflow definition fields.

Existing records that were already saved after stripping cannot be reconstructed automatically because the missing field values are no longer present in the stored definition.

## Proposed Solution

1. Add a shared `mergeAdvancedNodeConfig` helper for node update merging.
2. Use it in both the legacy `NodeEditDialog` and `formValuesToNodeUpdates` CrudForm transform.
3. For `userTask` nodes, merge advanced `userTaskConfig` first and visible form-derived `userTaskConfig` second, so visible edits win over stale advanced JSON.
4. Extend `userTaskConfigSchema` to preserve visual-editor user-task keys and field metadata.
5. Merge React Flow node snapshots with existing page-owned node data before storing them in the editor page.
6. Add unit, component, and integration tests that cover the UI merge and API round-trip.

## Architecture

### UI Merge Contract

`mergeAdvancedNodeConfig(updates, advancedConfig, { nodeType })` preserves existing advanced fields while making one special-case merge for user tasks:

- non-`userTaskConfig` advanced keys are assigned to the update object as before
- if the node is not a user task, legacy behavior is preserved
- if the node is a user task and both sides contain object `userTaskConfig`, the final value is `{ ...advanced.userTaskConfig, ...updates.userTaskConfig }`

This ordering protects visible form edits and still keeps advanced-only keys such as `assignmentRule`, `slaDuration`, or runtime extension values.

### React Flow Node State Contract

`mergeVisualEditorNodes(previousNodes, nextNodes)` mirrors the existing edge-state protection:

- React Flow owns transient node properties like `selected` and `position`
- the visual editor page owns dialog-edited `node.data`
- when React Flow emits a stale snapshot, the page keeps the latest page-owned `data` while still accepting transient graph changes

### API Validation Contract

`userTaskConfigSchema` now explicitly preserves:

- `assignedToRoles`
- `formKey`
- `allowedActions`
- custom `formSchema.fields[*]` metadata including `placeholder`, `defaultValue`, and passthrough UI/runtime keys
- passthrough top-level `userTaskConfig` extension keys

JSON Schema style `formSchema.properties` remains supported.

## Data Models

Representative stored workflow definition shape:

```json
{
  "steps": [
    {
      "stepId": "initial_contact",
      "stepName": "Initial contact",
      "stepType": "USER_TASK",
      "userTaskConfig": {
        "assignedToRoles": ["Sales Representative"],
        "formKey": "initial_contact_form",
        "allowedActions": ["complete", "cancel"],
        "formSchema": {
          "fields": [
            {
              "name": "conversation_summary",
              "type": "textarea",
              "label": "Conversation summary",
              "required": true,
              "placeholder": "Please fill in the details of the conversation",
              "defaultValue": "N/A"
            }
          ]
        }
      }
    }
  ]
}
```

## API Contracts

Affected routes:

- `POST /api/workflows/definitions`
- `GET /api/workflows/definitions/[id]`
- `PUT /api/workflows/definitions/[id]`

The routes remain backward compatible:

- no new required fields
- no database migration
- existing JSON Schema form definitions still validate
- existing advanced user-task fields continue to pass through
- already-stripped historical records are not backfilled

## Test Matrix

| Layer | Coverage |
| --- | --- |
| Validator unit | `workflowStepSchema` preserves visual-editor `userTaskConfig` fields and passthrough metadata |
| Transform unit | `formValuesToNodeUpdates` keeps visible user-task form config when advanced config has stale `userTaskConfig: {}` |
| Component unit | `NodeEditDialog` submits roles, form key, and form schema despite stale advanced config |
| Node state unit | `mergeVisualEditorNodes` preserves page-owned user-task data when React Flow emits a stale node snapshot |
| Integration | `TC-WF-030` create/read-back/update/read-back proves workflow definition API preserves user-task form config |

## Risks & Impact Review

- Risk: Widening passthrough accepts more user-task config keys. This matches the existing JSON-document workflow model and is limited to workflow definition validation.
- Risk: Advanced config merge order changes for `USER_TASK.userTaskConfig`. Visible form fields intentionally win because they are the user's direct edit in the dialog.
- Risk: Node snapshot merging preserves existing `data` over React Flow snapshots. React Flow only owns transient graph state here; node data changes are driven by dialog/page code.
- Impact: No contract break for existing definitions, API clients, or workflow runtime.

## Final Compliance Report

- Local unit coverage passed: workflow validator, node form transform, and legacy `NodeEditDialog` regression tests.
- Local typecheck passed for `@open-mercato/core`.
- Local integration coverage passed: `TC-WF-030` create/read-back/update/read-back.
- Reviewer-facing UI evidence should be attached to the PR before it is marked ready for review.

## Changelog

- 2026-07-08 - Initial in-progress spec for preserving workflow visual-editor user-task configuration across save/read-back.
