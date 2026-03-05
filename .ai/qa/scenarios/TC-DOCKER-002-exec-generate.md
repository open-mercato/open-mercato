# Test Scenario: Exec — generate

## Test ID
TC-DOCKER-002

## Category
Docker Command Parity

## Priority
High

## Description
Verify that `yarn docker:generate` executes `yarn generate` inside the running dev container and writes generated files back to the host via the mounted volume.

## Prerequisites
- Dev stack is running (`yarn docker:dev:up` completed successfully)
- Repo is mounted into the container (dev profile only)

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Note the modification time of `apps/mercato/.mercato/generated/` on host | Baseline timestamp recorded |
| 2 | Run `yarn docker:generate` from repo root (Windows terminal or any shell) | Helper prints `[docker-exec] Running in container (docker-compose.fullapp.dev.yml): yarn generate` |
| 3 | Wait for command to complete | Process exits with code 0 |
| 4 | Check `apps/mercato/.mercato/generated/` modification time | Files have been updated (newer than baseline) |
| 5 | Verify no errors in output | No TypeScript or generation errors printed |

## Expected Results
- `docker-exec.mjs` detects the active compose file automatically
- Command runs inside the Linux container
- Generated files are written back to the host filesystem via the volume mount
- Exit code is 0 on success

## Edge Cases / Error Scenarios
- Running with no container active should print: `Error: No running Open Mercato app container found` with startup instructions
- Running with `DOCKER_COMPOSE_FILE=docker-compose.fullapp.yml yarn docker:generate` against the production container should fail with a meaningful error (monorepo tooling not available in runtime image)
