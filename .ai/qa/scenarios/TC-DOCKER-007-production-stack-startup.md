# Test Scenario: Production Stack Startup and Shutdown

## Test ID
TC-DOCKER-007

## Category
Docker Command Parity

## Priority
Medium

## Description
Verify that `yarn docker:up` starts the production-like stack (`docker-compose.fullapp.yml`) in detached mode and `yarn docker:down` tears it down. Confirm that monorepo-only exec commands are unavailable in this profile.

## Prerequisites
- Docker Desktop is running
- No existing Open Mercato containers running
- `.env` file present at repo root

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Run `yarn docker:up` from repo root | Docker builds production image and starts services (app, postgres, redis, meilisearch) |
| 2 | Wait for startup | All services reach healthy state |
| 3 | Navigate to `http://localhost:3000/backend` | App is accessible |
| 4 | Run `yarn docker:generate` | Wrapper detects the production-like profile before `docker compose exec` |
| 5 | Observe result | Command fails fast with a clear unsupported-tooling message and a non-zero exit code |
| 6 | Run `yarn docker:db:migrate` | Runs `yarn db:migrate` inside production container |
| 7 | Observe result | Migration runs successfully (db:migrate is supported in both profiles) |
| 8 | Run `yarn docker:down` | All production containers stop and are removed |

## Expected Results
- Production stack starts cleanly
- Monorepo-only commands (generate, lint, typecheck, test) fail gracefully with a wrapper-level unsupported-tooling error before container exec
- `db:migrate` works in both dev and production profiles
- Teardown is clean

## Edge Cases / Error Scenarios
- Running both dev and production stacks simultaneously may cause port conflicts on 3000 — only one should be active at a time
- `DOCKER_COMPOSE_FILE=docker-compose.fullapp.yml yarn docker:generate` should target the production profile explicitly and fail with the same wrapper-level unsupported-tooling message
