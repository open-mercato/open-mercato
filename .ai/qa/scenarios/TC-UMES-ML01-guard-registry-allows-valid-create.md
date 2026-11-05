# Test Scenario: Mutation Guard Registry Allows Valid Todo Creation

## Test ID
TC-UMES-ML01

## Category
UMES — Mutation Lifecycle (SPEC-041m1)

## Priority
High

## Description
Verify that the mutation guard registry evaluates the `example.todo-limit` guard during POST and allows creation when the authenticated user has a valid organization context. The guard pipeline runs before the entity is persisted.

## Prerequisites
- User is logged in as `admin` with `example.todos.manage` feature
- Example module is enabled with todo CRUD routes at `/api/example/todos`
- `example.todo-limit` guard is registered via `data/guards.ts`

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Obtain auth token via `POST /api/auth/login` with admin credentials | Token returned (200) |
| 2 | Send `POST /api/example/todos` with body `{ "title": "Guard test todo" }` and auth token | Todo created (201) with `id` in response |
| 3 | Verify response contains `id` field (UUID) | `id` is a valid UUID string |
| 4 | Send `GET /api/example/todos?id={createdId}` with auth token | Todo returned with `title: "Guard test todo"` |
| 5 | Clean up: `DELETE /api/example/todos?id={createdId}` | Todo deleted (200) |

## Expected Results
- Guard `example.todo-limit` evaluates and passes (organization context present from auth)
- Todo is created with HTTP 201
- Response includes the new entity `id`
- The guard runs before ORM persist — no orphaned records on rejection

## Edge Cases / Error Scenarios
- Creating without auth token returns 401
- Multiple guards run in priority order; all must pass for creation to succeed
- Legacy `crudMutationGuardService` bridge runs at priority 0 alongside new guards
