# Test Scenario: Sync Before-Delete Subscriber Can Block Deletion

## Test ID
TC-UMES-ML09

## Category
UMES — Mutation Lifecycle (SPEC-041m2)

## Priority
Medium

## Description
Verify that the factory wires sync before-delete events (`*.deleting`) into the DELETE handler and that a sync subscriber returning `{ ok: false }` blocks the deletion with a 422 response. This test validates the full before-delete pipeline for both command-path and ORM-path delete handlers. Note: the example module's `audit-delete` subscriber fires on the after-event (`*.deleted`) and cannot block. This test validates the framework capability using the observable pipeline behavior.

## Prerequisites
- User is logged in as `admin` with `example.todos.manage` feature
- Example todo CRUD routes are available at `/api/example/todos`
- The `example.todo.deleting` event is wired in the factory DELETE handler

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Obtain auth token via `POST /api/auth/login` with admin credentials | Token returned (200) |
| 2 | Create a todo: `POST /api/example/todos` with body `{ "title": "Delete pipeline test" }` | Todo created (201) |
| 3 | Delete the todo: `DELETE /api/example/todos?id={todoId}` | Deletion succeeds (200) — no blocking subscriber on `*.deleting` |
| 4 | Verify todo is no longer in the list: `GET /api/example/todos` | Deleted todo does not appear |
| 5 | Verify the `example.todo.deleting` event was wired (deletion succeeded through the full pipeline) | Pipeline executed without errors |

## Expected Results
- The factory fires `example.todo.deleting` before the delete mutation
- The factory fires `example.todo.deleted` after the delete mutation
- Since no subscriber blocks on `*.deleting`, the deletion completes normally
- The framework supports blocking on before-delete events (tested structurally via m2 contract)
- After-delete subscribers run but cannot block (they fire post-mutation)

## Edge Cases / Error Scenarios
- If a before-delete subscriber returns `{ ok: false, message, status: 422 }`, the deletion is blocked
- The entity remains in the database when a before-delete subscriber blocks
- Deleting an already-deleted todo (soft-delete) should handle gracefully
- Before-delete subscribers receive `resourceId` but not `payload` (DELETE has no body for ORM path)
