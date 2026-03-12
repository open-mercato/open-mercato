# Test Scenario: Ephemeral Stack Startup and Data Reset

## Test ID
TC-DOCKER-008

## Category
Docker Command Parity

## Priority
Medium

## Description
Verify that `yarn docker:ephemeral` starts the preview stack with a fresh database on every restart, and that `yarn docker:ephemeral:down` tears it down with full data loss as expected.

## Prerequisites
- Docker Desktop is running
- No existing Open Mercato preview containers running
- `docker-compose.preview.yaml` present at repo root

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Run `yarn docker:ephemeral` from repo root | Preview stack builds and starts; output streams to terminal |
| 2 | Wait for startup | App is accessible at `http://localhost:5000` |
| 3 | Navigate to `http://localhost:5000/backend` | Login page displayed |
| 4 | Create a test record (e.g. a company) via the UI | Record is created and visible |
| 5 | Run `yarn docker:ephemeral:down` in another terminal | Preview stack is torn down; all containers removed |
| 6 | Run `yarn docker:ephemeral` again | Stack starts fresh with a new database |
| 7 | Navigate to `http://localhost:5000/backend` and log in | Previously created record is gone (fresh DB) |

## Expected Results
- Stack starts on port 5000 (not 3000)
- Database is fully reset on each restart — no data persists between runs
- Teardown is clean and explicit (no leftover volumes unless intentional)
- Suitable for branch previews and throwaway testing

## Edge Cases / Error Scenarios
- Running `docker:ephemeral` while dev or production stack is on port 3000 should not conflict (different port)
- Running `docker:ephemeral:down` when no preview containers are active should exit cleanly without error
