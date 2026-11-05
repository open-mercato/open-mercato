# Test Scenario: Full Mutation Lifecycle End-to-End (Create → Update → Block → Delete)

## Test ID
TC-UMES-ML10

## Category
UMES — Mutation Lifecycle (SPEC-041m)

## Priority
High

## Description
End-to-end integration test covering the complete mutation lifecycle pipeline across all phases: guard validation (m1), sync before/after events (m2), and successful create → update → blocked update → delete flow. This test exercises the unified 19-step mutation pipeline in a single realistic workflow.

## Prerequisites
- User is logged in as `admin` with `example.todos.manage` feature
- All Phase M components are active: guards, sync subscribers, command interceptors
- Example todo CRUD routes are available at `/api/example/todos`

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Obtain auth token via `POST /api/auth/login` with admin credentials | Token returned (200) |
| 2 | Create todo without priority: `POST /api/example/todos` with `{ "title": "E2E lifecycle test" }` | 201 — todo created, guard passes |
| 3 | Fetch the created todo and verify `priority` was injected as `"normal"` | Sync before-create subscriber injected default priority |
| 4 | Update title: `PUT /api/example/todos` with `{ "id": "{todoId}", "title": "Updated E2E" }` | 200 — update succeeds, no subscriber blocks |
| 5 | Fetch and verify title changed to `"Updated E2E"` | Title persisted correctly |
| 6 | Mark as done: `PUT /api/example/todos` with `{ "id": "{todoId}", "is_done": true }` | 200 — marking done is allowed |
| 7 | Attempt revert: `PUT /api/example/todos` with `{ "id": "{todoId}", "is_done": false }` | 422 — blocked by prevent-uncomplete subscriber |
| 8 | Verify error message contains "Completed todos cannot be reverted to pending" | Subscriber rejection message is propagated |
| 9 | Fetch todo and verify `is_done` is still `true` | Blocked mutation was not applied |
| 10 | Delete todo: `DELETE /api/example/todos?id={todoId}` | 200 — deletion succeeds, audit-delete subscriber fires |
| 11 | Verify todo is no longer in list | Soft-deleted, not returned by default |

## Expected Results
- **Guard (m1)**: `example.todo-limit` guard passes — organization context is present from authenticated session
- **Sync before-create (m2)**: `auto-default-priority` injects `priority: 'normal'` on todo creation
- **Sync before-update (m2)**: `prevent-uncomplete` blocks reverting completed todo with 422 and descriptive message
- **Sync after-delete (m2)**: `audit-delete` fires after deletion (server console log, non-blocking)
- **Pipeline ordering**: Guards run before sync subscribers; sync before-events run before mutation; sync after-events run before HTTP response
- All cleanup is handled; no orphaned test data

## Edge Cases / Error Scenarios
- Network errors mid-flow should not leave inconsistent state (each step is independently verifiable)
- Running this test concurrently with others should not cause conflicts (unique title per run)
- The test should be fully self-contained: creates its own fixtures, cleans up in finally block
