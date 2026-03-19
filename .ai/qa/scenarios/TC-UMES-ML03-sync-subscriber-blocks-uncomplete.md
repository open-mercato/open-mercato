# Test Scenario: Sync Before-Update Subscriber Blocks Reverting Completed Todo

## Test ID
TC-UMES-ML03

## Category
UMES — Mutation Lifecycle (SPEC-041m2)

## Priority
High

## Description
Verify that the `prevent-uncomplete` sync subscriber fires on `example.todo.updating` and blocks attempts to revert a completed todo back to pending status, returning HTTP 422 with an appropriate error message.

## Prerequisites
- User is logged in as `admin` with `example.todos.manage` feature
- Sync subscriber `example:prevent-uncomplete` is registered with `sync: true` and `priority: 60`
- Example todo CRUD routes are available at `/api/example/todos`
- The subscriber reads `previousData` to detect the current completion state

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Obtain auth token via `POST /api/auth/login` with admin credentials | Token returned (200) |
| 2 | Create a todo: `POST /api/example/todos` with body `{ "title": "Block test" }` | Todo created (201), note the `id` |
| 3 | Mark todo as done: `PUT /api/example/todos` with body `{ "id": "{todoId}", "is_done": true }` | Update succeeds (200) |
| 4 | Attempt to revert: `PUT /api/example/todos` with body `{ "id": "{todoId}", "is_done": false }` | Request blocked with 422 |
| 5 | Assert response body contains message `"Completed todos cannot be reverted to pending"` | Error message matches subscriber output |
| 6 | Verify todo is still marked as done: `GET /api/example/todos` and check the todo | `is_done` remains `true` |
| 7 | Clean up: `DELETE /api/example/todos?id={todoId}` | Todo deleted (200) |

## Expected Results
- Marking a todo as done (false → true) succeeds without interference
- Reverting a completed todo (true → false) is blocked by the sync before-update subscriber
- HTTP status is 422 (Unprocessable Entity)
- Response body contains `{ "error": "Completed todos cannot be reverted to pending" }` or similar
- The mutation is never applied — the todo remains completed in the database
- The subscriber reads `previousData` which is loaded from the ORM before the update

## Edge Cases / Error Scenarios
- Updating a non-done todo's title (without changing `is_done`) should succeed — subscriber only blocks when `wasDone && wantUndone`
- Updating with `isDone: false` (camelCase) should also be blocked — subscriber checks both naming conventions
- If `previousData` is unavailable (entity not found), subscriber returns void (no block)
- Updating a todo that was never marked as done should succeed freely
