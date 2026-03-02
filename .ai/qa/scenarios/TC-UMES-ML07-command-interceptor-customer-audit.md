# Test Scenario: Command Interceptor Runs on Customer Operations

## Test ID
TC-UMES-ML07

## Category
UMES — Mutation Lifecycle (SPEC-041m4)

## Priority
Medium

## Description
Verify that the `example.audit-logging` command interceptor fires on customer module commands (matching `customers.*` pattern). The interceptor wraps command execution with timing metadata. Since the audit log is written to server console, this test verifies that customer CRUD operations succeed without errors when the interceptor is active.

## Prerequisites
- User is logged in as `admin` with `customers.companies.create` and `customers.companies.edit` features
- Command interceptor `example.audit-logging` is registered targeting `customers.*`
- Customer CRUD routes are available at `/api/customers/companies`

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Obtain auth token via `POST /api/auth/login` with admin credentials | Token returned (200) |
| 2 | Create a company: `POST /api/customers/companies` with body `{ "name": "Interceptor Test Corp" }` | Company created (201) with `id` |
| 3 | Verify interceptor did not block: response status is 201 | `beforeExecute` returned `{ ok: true }` |
| 4 | Update the company: `PUT /api/customers/companies` with body `{ "id": "{companyId}", "name": "Interceptor Test Corp Updated" }` | Update succeeds (200) |
| 5 | Verify interceptor did not block the update | `beforeExecute` returned `{ ok: true }` |
| 6 | Clean up: `DELETE /api/customers/companies?id={companyId}` | Company deleted (200) |

## Expected Results
- All customer CRUD operations succeed — the audit interceptor observes but does not block
- `beforeExecute` stores `auditStartedAt` metadata for each command
- `afterExecute` reads the metadata and logs timing (server console only)
- The interceptor pattern `customers.*` matches all customer module commands
- No additional HTTP headers or response fields are added by the interceptor

## Edge Cases / Error Scenarios
- If the interceptor's `beforeExecute` throws, the command should fail with 500
- If the interceptor's `afterExecute` throws, the command result is still returned (after hooks are non-blocking)
- Operations on non-customer entities (e.g., `example.todos.*`) should not trigger this interceptor
- Interceptor runs on both `execute()` and `undo()` code paths
