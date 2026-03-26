# Test Scenario: Sync After-Delete Subscriber Fires on Todo Deletion

## Test ID
TC-UMES-ML04

## Category
UMES — Mutation Lifecycle (SPEC-041m2)

## Priority
Medium

## Description
Verify that the `audit-delete` sync subscriber fires on `example.todo.deleted` after a todo is deleted. The subscriber logs an audit trail to the server console. Since server logs are not directly observable from integration tests, this test verifies that deletion succeeds without errors (proving the after-event subscriber ran without throwing).

## Prerequisites
- User is logged in as `admin` with `example.todos.manage` feature
- Sync subscriber `example:audit-delete` is registered with `sync: true` and `priority: 50`
- Example todo CRUD routes are available at `/api/example/todos`

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Obtain auth token via `POST /api/auth/login` with admin credentials | Token returned (200) |
| 2 | Create a todo: `POST /api/example/todos` with body `{ "title": "Delete audit test" }` | Todo created (201), note the `id` |
| 3 | Delete the todo: `DELETE /api/example/todos?id={todoId}` | Deletion succeeds (200) |
| 4 | Assert response body contains `{ "ok": true }` or similar success indicator | Delete confirmed |
| 5 | Verify todo is gone: `GET /api/example/todos` and confirm the deleted todo is not in results | Todo no longer appears in list (soft-deleted) |

## Expected Results
- Todo is soft-deleted successfully
- The sync after-delete subscriber runs inside the CRUD pipeline before the HTTP response is sent
- After-delete subscribers cannot block the operation — even if they throw, the delete should still succeed
- Server console would contain: `[example:audit-delete] Todo {id} deleted by user {userId} in org {organizationId}`
- No HTTP errors caused by the subscriber execution

## Edge Cases / Error Scenarios
- If the after-delete subscriber throws, the framework swallows the error and the delete still completes
- Deleting a non-existent todo returns appropriate error (404 or similar)
- After-delete subscribers receive `resourceId`, `userId`, and `organizationId` in the payload
