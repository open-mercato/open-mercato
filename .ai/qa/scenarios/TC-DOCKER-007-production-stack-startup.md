# Test Scenario: Production Stack Startup and Shutdown

## Test ID
TC-DOCKER-007

## Category
Docker Command Parity

## Priority
Medium

## Description
Verify that `yarn docker:up` starts the production-like stack (`starters/docker/compose.fullapp.yml`) in detached mode and `yarn docker:down` tears it down. Confirm that monorepo-only exec commands are unavailable in this profile.

## Prerequisites
- Docker Desktop is running
- No existing Open Mercato containers running
- `.env` file present at repo root, containing a real `JWT_SECRET` (generate with `openssl rand -hex 32`) — the stack has no default and refuses to start without one

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
- With `JWT_SECRET` absent or empty in the root `.env`, `yarn docker:up` must fail before starting any service, naming the variable and the `openssl rand -hex 32` hint. A stack that comes up anyway means the signing-secret fallback has been reintroduced (see #5174) — anyone reading this repository could then forge tokens for the deployment
- Setting `JWT_SECRET` to a placeholder (`JWT`) or to fewer than 32 characters must let Compose start the containers but stop the app itself, which exits non-zero with `Refusing to run in production with an unsafe signing secret`. Note that `apps/mercato/.env` is **not** the file to fix this in: Compose interpolates from the `.env` beside the compose file, and the app cannot override a variable already set in its container environment
- Running both dev and production stacks simultaneously may cause port conflicts on 3000 — only one should be active at a time
- `DOCKER_COMPOSE_FILE=starters/docker/compose.fullapp.yml yarn docker:generate` should target the production profile explicitly and fail with the same wrapper-level unsupported-tooling message
