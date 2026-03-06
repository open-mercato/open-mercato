# Test Scenario: Exec — initialize with --reinstall

## Test ID
TC-DOCKER-003

## Category
Docker Command Parity

## Priority
High

## Description
Verify that `yarn docker:initialize -- --reinstall` runs the full initialization sequence inside the container, equivalent to native `yarn initialize -- --reinstall`.

## Prerequisites
- Dev stack is running (`yarn docker:dev:up` completed successfully)
- Database is accessible from the app container
- If running this scenario after another Docker exec scenario, run `yarn docker:dev` first to reinitialize the dev environment

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Run `yarn docker:dev` to reinitialize the development environment before the exec test | Dev environment is reinitialized and ready for command parity validation |
| 2 | Run `yarn docker:initialize -- --reinstall` from repo root | Helper prints exec log line with `yarn initialize --reinstall` |
| 3 | Observe output | Initialization sequence runs: migrations, seeds, CLI reinstall |
| 4 | Wait for command to complete | Process exits with code 0 |
| 5 | Navigate to `http://localhost:3000/backend` | Login page accessible; default credentials printed during init work |

## Expected Results
- `--reinstall` flag is forwarded correctly into the container
- Full initialization sequence completes without errors
- App remains accessible after re-init

## Edge Cases / Error Scenarios
- If database is not reachable from container, init should fail with a clear DB connection error (not a silent hang)
- Running initialize twice in a row should handle existing data gracefully (idempotent seed logic)
