# Issue #8825 — environment clean stop

Issue: https://github.com/open-mercato/open-mercato/issues/8825
Revision inspected: ada24d305c3cfee633c3081c5f55e334330e6b87
Runner: local (Docker daemon unavailable).

Concurrency recheck: issue OPEN, no assignees, no comments, only bug/cez-autofix labels; open and closed PR searches for 8825 returned []. No claim acquired; no lock needs releasing.

The requested module-native browser regression is still needed. Existing workflow integration tests inspected do not cover the Retry/Cancel confirmation matrix. No production or test changes were made because browser discovery and executable verification cannot run safely here.

## Evidence

- `yarn --version`: 4.18.1.
- `node --version`: v26.12.1.
- `yarn test:integration:ephemeral --help`: exit 1, Yarn cannot find node_modules state file; runner never launched, zero tests executed.
- `docker info --format '{{.ServerVersion}}'`: exit 1, configured /Users/piotrkarwatka/.docker/run/docker.sock does not exist.
- `docker compose ps --format json`: same missing Docker socket.
- No worktree node_modules, .ai/qa/test-env.json, .ai/qa/ephemeral-env.json or .ai/scripts/test-env-up.sh exists. The checkout has only test-env.env, whose contents were not read.
- packages/cli/src/lib/testing/integration.ts assertContainerRuntimeAvailable explicitly requires docker info success before provisioning. The repo-local environment skill mandates the CLI managed ephemeral runner; no developer database fallback used.

## Remaining work

Restore Docker and install dependencies using the lockfile on the supported Node version, then rerun om-auto-fix-issue 8825. Create own failed/paused workflows through executor-backed API fixtures; cover EN/PL selected identifiers without raw interpolation tokens, both dismissal paths with full-record equality, Cmd/Ctrl+Enter request target and unaffected control record, 390px long identifiers, and complete fixture teardown. Run via yarn mercato test:integration with the module-native spec filter. Validation, review and browser QA remain outstanding; no PR was opened or qa-approved applied.

No long-running processes were started. CEZ_BIN is unset, so the cockpit task-report command is unavailable; the parent receives this report through its inbox and the session report.
