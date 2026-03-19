# Test Scenario: Error Handling — No Running Container

## Test ID
TC-DOCKER-005

## Category
Docker Command Parity

## Priority
High

## Description
Verify that `docker-exec.mjs` prints a clear, actionable error message when no Open Mercato app container is running, rather than hanging or producing a cryptic Docker error.

## Prerequisites
- No Open Mercato containers running (`docker ps` shows no `mercato-*` or compose app containers)
- `DOCKER_COMPOSE_FILE` env var is NOT set

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Ensure no containers are running: `docker compose -f docker-compose.fullapp.dev.yml down` | Confirms no running containers |
| 2 | Run `yarn docker:generate` | Process does NOT hang; exits quickly with a non-zero code |
| 3 | Read error output | Message starts with `Error: No running Open Mercato app container found.` |
| 4 | Verify startup instructions are printed | Output includes `docker compose -f docker-compose.fullapp.dev.yml up --build` and `docker compose -f docker-compose.fullapp.yml up --build` |
| 5 | Verify DOCKER_COMPOSE_FILE override hint is printed | Output mentions `DOCKER_COMPOSE_FILE=<file>` override |

## Expected Results
- Exit code is 1 (non-zero)
- Error message is clear and actionable — tells the user exactly what to run
- No Docker daemon errors or stack traces exposed to the user

## Edge Cases / Error Scenarios
- Setting `DOCKER_COMPOSE_FILE` to a non-existent file: should print `Error: DOCKER_COMPOSE_FILE="<path>" does not exist.` and exit 1
- Setting `DOCKER_COMPOSE_FILE` to an existing but stopped compose file: should still print the "no running container" error (container check fails)
