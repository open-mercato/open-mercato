# Test Scenario: Sync Before-Update Subscriber Receives Previous Entity Data

## Test ID
TC-UMES-ML08

## Category
UMES — Mutation Lifecycle (SPEC-041m2)

## Priority
High

## Description
Verify that sync before-update subscribers receive `previousData` containing the entity's state before the mutation. This test confirms that the factory correctly fetches the existing entity from the ORM and passes it in the `SyncCrudEventPayload.previousData` field, enabling subscribers to compare old vs new values.

## Prerequisites
- User is logged in as `admin` with `example.todos.manage` feature
- Sync subscriber `example:prevent-uncomplete` is registered (relies on `previousData`)
- Example todo CRUD routes are available at `/api/example/todos`

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Obtain auth token via `POST /api/auth/login` with admin credentials | Token returned (200) |
| 2 | Create a todo: `POST /api/example/todos` with body `{ "title": "Previous data test" }` | Todo created (201) with `is_done: false` (default) |
| 3 | Update the todo title only: `PUT /api/example/todos` with body `{ "id": "{todoId}", "title": "Updated title" }` | Update succeeds (200) — no block because `is_done` is not being changed |
| 4 | Mark as done: `PUT /api/example/todos` with body `{ "id": "{todoId}", "is_done": true }` | Update succeeds (200) — transitioning from not-done to done is allowed |
| 5 | Update title again: `PUT /api/example/todos` with body `{ "id": "{todoId}", "title": "Still done" }` | Update succeeds (200) — not changing `is_done`, so subscriber allows it |
| 6 | Try to revert: `PUT /api/example/todos` with body `{ "id": "{todoId}", "is_done": false }` | Blocked with 422 — subscriber reads `previousData.is_done === true` and detects revert |
| 7 | Clean up: `DELETE /api/example/todos?id={todoId}` | Todo deleted (200) |

## Expected Results
- `previousData` is populated by the factory via `em.findOne()` before the update runs
- The subscriber can compare `previousData.isDone` / `previousData.is_done` with the incoming payload
- Only the specific transition (done → not-done) is blocked; all other updates succeed
- Title-only updates do not trigger the block even when the todo is completed
- The `previousData` field is available for both command-path and ORM-path updates

## Edge Cases / Error Scenarios
- If the entity is not found (invalid id), `previousData` is undefined and the subscriber returns void
- `previousData` is a serialized snapshot (JSON.parse(JSON.stringify)) — no live ORM references
- Updates to non-existent todos should return appropriate error (not a subscriber block)
