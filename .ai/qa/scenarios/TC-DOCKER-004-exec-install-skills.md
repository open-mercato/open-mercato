# Test Scenario: Exec — install-skills

## Test ID
TC-DOCKER-004

## Category
Docker Command Parity

## Priority
High

## Description
Verify that `yarn docker:install-skills` runs the skills installer inside the Linux container, bypassing the need for bash or symlink support on the Windows host.

## Prerequisites
- Dev stack is running (`yarn docker:dev:up` completed successfully)
- Skills are available in the container filesystem

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Run `yarn docker:install-skills` from repo root (Windows terminal) | Helper detects active container and routes to `install-skills` script |
| 2 | Observe output | `install-skills.sh` runs inside the Linux container; symlinks created in container |
| 3 | Wait for command to complete | Process exits with code 0 |
| 4 | Verify skills are active | Skills directory contains installed entries inside the container |

## Expected Results
- No bash or WSL required on host
- `install-skills.sh` runs inside the Linux container where bash and `ln -s` are available
- Exit code is 0 on success

## Edge Cases / Error Scenarios
- If skills are already installed, the script should handle re-installation gracefully (no duplicate errors)
- Running natively on Windows without Docker should still fail with the original error (this wrapper doesn't change the native path)
