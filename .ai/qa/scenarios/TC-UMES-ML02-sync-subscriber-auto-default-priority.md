# Test Scenario: Sync Before-Create Subscriber Injects Default Priority

## Test ID
TC-UMES-ML02

## Category
UMES — Mutation Lifecycle (SPEC-041m2)

## Priority
High

## Description
Verify that the `auto-default-priority` sync subscriber fires on `example.todo.creating` and injects `priority: 'normal'` into the mutation payload when the request body omits an explicit priority value.

## Prerequisites
- User is logged in as `admin` with `example.todos.manage` feature
- Sync subscriber `example:auto-default-priority` is registered with `sync: true` and `priority: 50`
- Example todo CRUD routes are available at `/api/example/todos`

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Obtain auth token via `POST /api/auth/login` with admin credentials | Token returned (200) |
| 2 | Send `POST /api/example/todos` with body `{ "title": "No priority set" }` (no `priority` field) | Todo created (201) |
| 3 | Send `GET /api/example/todos` and find the created todo by id | Todo returned with `priority` field present |
| 4 | Assert that the returned todo has `priority` equal to `"normal"` | Priority was injected by the sync subscriber |
| 5 | Send `POST /api/example/todos` with body `{ "title": "Has priority", "priority": "high" }` | Todo created (201) |
| 6 | Send `GET /api/example/todos` and find this second todo by id | Todo returned with `priority: "high"` (subscriber did not override) |
| 7 | Clean up: delete both created todos | Both deleted (200) |

## Expected Results
- When `priority` is absent from request body, the sync before-create subscriber injects `priority: 'normal'` via `modifiedPayload`
- When `priority` is already present, the subscriber does not override it (returns void)
- The injected value persists in the database and is returned on subsequent GET
- The subscriber runs synchronously inside the CRUD pipeline before ORM flush

## Edge Cases / Error Scenarios
- Subscriber with higher priority (lower number) runs first — verify ordering is respected
- If the subscriber throws, the CRUD pipeline should return a 500 error (fail-closed)
- Creating with `priority: ""` (empty string) — subscriber checks `'priority' in body`, so it should not inject
