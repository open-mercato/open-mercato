# Test Scenario: Dev Stack Startup and Shutdown

## Test ID
TC-DOCKER-001

## Category
Docker Command Parity

## Priority
High

## Description
Verify that `yarn docker:dev:up` starts the full dev stack in detached mode and `yarn docker:dev:down` tears it down cleanly.

## Prerequisites
- Docker Desktop is running
- No existing Open Mercato containers running (`docker ps` shows no `mercato-*` containers)
- `.env` file present at repo root (or env vars exported)

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Run `yarn docker:dev:up` from repo root | Docker builds the dev image and starts all services (app, postgres, redis, meilisearch) |
| 2 | Wait for startup to complete | No error output; process returns to shell prompt (detached mode) |
| 3 | Run `docker compose -f docker-compose.fullapp.dev.yml ps` | All services show status `running` or `healthy` |
| 4 | Run `docker compose -f docker-compose.fullapp.dev.yml logs app --tail=20` | Logs show `yarn dev` running; no fatal errors |
| 5 | Navigate to `http://localhost:3000/backend` | Login page is displayed |
| 6 | Run `yarn docker:dev:down` | All containers stop and are removed |
| 7 | Run `docker compose -f docker-compose.fullapp.dev.yml ps` | No running containers listed |

## Expected Results
- Stack starts cleanly in detached mode
- App is accessible at port 3000
- All services report healthy
- Teardown removes all containers without errors

## Edge Cases / Error Scenarios
- If port 3000 is already in use, startup should fail with a clear port conflict error
- Running `docker:dev:up` when stack is already running should be idempotent (no duplicate containers)
- Running `docker:dev:down` when no containers are running should exit cleanly without error
