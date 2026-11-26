# Issue 9142: user-task completion accepts only declared fields

Status: implemented; emergency compatibility exception approved by @pat-lewczuk on 2026-11-26.

## Problem and scope

Staff and portal task completion share `taskHandler.completeUserTask`. The handler checked only that required fields were present, then stored the whole `formData` on the task and merged it into the workflow (or branch) context. A task assignee could add keys such as `id`, `amount` or `__result` and redirect later route conditions and privileged activities (CALL_API, UPDATE_ENTITY, SEND_EMAIL) to values of their choosing.

Out of scope, tracked separately: a declared field whose name matches an earlier context key still overwrites it (fixed only by namespacing task output per step), and signal payloads merged into context (#10609).

## Implementation

Before any write, `completeUserTask` normalizes the task's stored `formSchema` with `normalizeTaskFormSchema`, so both the JSON Schema `properties` shape and the Studio `fields` shape are read. A submitted top-level key is refused when it is not an own declared property, starts with `__`, or is listed by `findReservedContextKeys`, even when declared. A task with no declared fields accepts only empty `formData`. Required-field validation is unchanged. `__decision` is still written by `withRecordedDecision` from a validated `decisionId`, never from `formData`.

The refusal is a `UserTaskError` with code `FORM_VALIDATION_FAILED` and a translated message (`workflows.tasks.errors.invalidFormData`). The staff route maps that code to HTTP 400 by code instead of matching message text; the portal route already did.

## Regression coverage

- Unit: both schema shapes accept declared fields and refuse undeclared ones; schema-less tasks accept `{}` only; reserved and inherited keys are refused; falsy and nested declared values pass; main and parallel-branch completion leave task, context, events and transitions untouched on refusal; staff and portal routes return 400 through the real handler.
- Integration: `TC-WF-9142-task-completion-field-allowlist` covers both schema shapes over the staff API, asserting the task and run snapshot are unchanged after each forged key and that a valid completion still advances the run. TC-WF-015, TC-WF-021 and TC-WF-064 now declare the fields they submit.

## Migration & Backward Compatibility

This narrows STABLE API behavior on `POST /api/workflows/tasks/:id/complete`, `POST /api/workflows/portal/tasks/:id/complete` and the `taskHandler.completeUserTask` DI service. URLs, request and response shapes, events, ACL features and database schema are unchanged. Clients that used `formData` as an arbitrary context patch, including on tasks without a form schema, now receive 400.

A deprecation bridge would keep the vulnerability, so this ships as an emergency security exception. Workflows maintainer Patryk Lewczuk (@pat-lewczuk) approved waiving deprecation steps 1–3 on 2026-11-26, including the decision that a task without a form schema accepts only empty `formData`. Client and operator steps are in `UPGRADE_NOTES.md`; the ledger entry is in `BACKWARD_COMPATIBILITY.md`.

## Changelog

- 2026-11-26: re-implemented on current `main`, superseding draft PR #9330; recorded the maintainer approval; updated integration fixtures that submitted undeclared fields.
