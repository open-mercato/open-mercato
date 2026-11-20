# Local integration tests for automerge

Apply this procedure during A3 of `om-auto-fix-pr` and `om-auto-fix-issue`,
including force automerge. Run it after the ordered `validation.commands` gate
and before recording `localCi: pass` or applying
`automerge-signal-3-passes-local-ci-checks`.

## Select the same suite as PR CI

Use the final PR head and its actual target branch. Fetch that target and check
that the worktree is clean and at the verified PR head. Use
`git diff --name-only <target-commit> HEAD` after A3 has brought the target into
the head. This is the local equivalent of CI's first-parent diff on the
synthetic PR merge commit. If the target has advanced, return to A3's base
reconciliation and revalidate the resulting head. A failed fetch or diff
leaves the scope unverified.

Use [the CI workflow](../../.github/workflows/ci.yml)'s
`prepare` → `Compute integration scope` rules in this order:

1. For a same-repository PR with a `stabilize/` head or the `ci-full` label,
   or any change matching CI's `FULL_SUITE_PATTERN`, run the full suite.
   This includes cross-cutting paths such as shared packages and the
   ephemeral test harness.
2. Otherwise, collect the distinct module folder names from
   `packages/<workspace>/src/modules/<module>/` and
   `apps/<app>/src/modules/<module>/`. Run with those names comma-separated
   in `OM_INTEGRATION_MODULES`. Playwright's discovery also includes specs
   that declare one of those modules as a dependency.
3. If CI's scope rules select no suite, record the CI scope skip with the
   target and head SHA. An unavailable runner or a test command finding zero
   tests does not qualify for this skip.

## Run the ephemeral suite

From the final-head worktree on the local host, use the repository's
CI-supported Node version, installed dependencies and a working Docker
daemon. The coverage runner provisions the disposable app and database and
installs Chromium. Use the workflow's committed integration fixture settings
as data. In particular, set all four `OM_ENABLE_ENTERPRISE_MODULES*` flags,
`SELF_SERVICE_ONBOARDING_ENABLED`, `TURBO_ENV_MODE` and
`NEXT_PUBLIC_DOCUMENTS_COLLAB_URL` to the workflow values before invoking the
runner so generation, the app build and discovery agree. Apply the
`ephemeral-integration` job's test-only runtime settings, including the
Documents collaboration flag and its test-only signing fixture. Use only
disposable fixture credentials. Keep these settings scoped to the ephemeral
command.

For a module run, set the value below to the CSV from scope selection. For a
full run, explicitly use an empty value to clear any inherited module filter.
Run the suite in one invocation without a shard flag. CI's shards partition
that same full suite across GitHub runners.

```bash
OM_INTEGRATION_MODULES="$integration_modules" yarn test:integration:coverage --no-reuse-env --force-rebuild
```

The flags create an isolated environment and rebuild the app with the test
configuration. This command uses host Docker through Testcontainers, even
when earlier validation commands used Compose's app container.

## Record the gate result

Include the head SHA, target, selected scope and command exit status in the
local CI evidence. A passing result requires both the ordered validation
commands and the selected integration suite to pass on that head, or an
explicit CI scope skip. Recheck the PR head and scope inputs before publishing
the signal. If the head changes, revalidate through the automerge loop. If the
scope changes, recompute it and run the newly required suite before publishing.

Handle a failure under the existing A3 retry and review rules. If the suite
fails, times out or cannot run, report the reason and record
`localCi: missing` while required evidence is absent. The local CI signal and
force merge both require that evidence.
