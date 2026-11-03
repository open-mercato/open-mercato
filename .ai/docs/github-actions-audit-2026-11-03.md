# GitHub Actions audit — 2026-11-03

## Result

The repository's maintained branches are `main` and `release/v0.9.x`; there is no `develop` branch. Both maintained branches contain the same 17 workflow files. None currently triggers on or checks out `develop`.

The misleading entries in GitHub Actions are historical registrations whose workflow files have already been deleted. Their active/disabled state is repository metadata; deleting YAML in this PR cannot remove files that are already absent. Disable the three retired registrations below and retain their run history. This is reversible through GitHub's enable-workflow API or UI; restoring the relevant source/branch is a prerequisite for useful execution.

Source baseline: `c25d98d408479d1b3ca29ecfc958e5be9039a405` on `main`. The audit used the full paginated branch inventory, workflow registrations, latest runs, maintained-branch trees, referenced scripts and Git history. No deployment/release/publish workflow was dispatched for this audit, and no secret values were read.

## Retired registrations

| Workflow | ID / former path | Evidence | Administrative outcome |
|---|---|---|---|
| Develop Release | `238045838` / `.github/workflows/develop.yml` | Only two runs, both on deleted `develop`, last on 2026-02-24; absent on both maintained branches. [Last run](https://github.com/open-mercato/open-mercato/actions/runs/22350074182). | Verified `disabled_manually` |
| Canary Release | `226360510` / `.github/workflows/canary.yml` | Deliberately merged into snapshot by commit `e286dd060`; absent on both maintained branches. None of the latest 100 runs' branches still exists. [Last run](https://github.com/open-mercato/open-mercato/actions/runs/22404273916), 2026-02-25. | Verified `disabled_manually` |
| Historical eval workflow | `297198728` / `.github/workflows/evals.yml` | Only three runs, all on deleted `feat/add-evals-harbor-framework`; absent on both maintained branches. [Last run](https://github.com/open-mercato/open-mercato/actions/runs/27687388612), 2026-06-17. | Verified `disabled_manually` |

Disabling preserves audit logs and prevents these registered workflows from executing if stale copies survive on old topic branches. Do not delete historical runs merely to hide an Actions sidebar entry.

## Current workflows retained

| File under `.github/workflows/` | Reason to retain |
|---|---|
| `ci.yml` | Current PR/main/release-line validation. No retired-branch target. |
| `audit.yml` | Scheduled/manual dependency audit on the default branch; inactivity/failure alone is not obsolescence. |
| `backport.yml` | Supported release-line workflow; `release/v0.9.x` exists. |
| `release-cut.yml` | Maintainer-dispatched creation of the next release line from main; future lines need not exist before a cut. |
| `release.yml` | Dispatches from a release branch. [Successful release-line run](https://github.com/open-mercato/open-mercato/actions/runs/39672482516). |
| `release-publish.yml` | Tag-triggered/manual publication at the tagged commit; a new workflow with no runs is not broken by definition. |
| `snapshot.yml` | Runs on main and successfully publishes the compatibility `develop` npm channel. Only the display name changes to **Main Snapshot Release**. [Successful publish with a downstream test failure](https://github.com/open-mercato/open-mercato/actions/runs/41625583968). |
| `npm-snapshot-preview.yml` | Maintainer preview with an intentional independent-approval gate. A refused unapproved run is expected, not a reason to remove the gate. |
| `package-previews.yml` | Functioning package previews. [Successful run](https://github.com/open-mercato/open-mercato/actions/runs/41643337626). |
| `dev-deploy.yml` | Current source checks out main; older runs on develop are historical. No deploy was attempted to test external infrastructure. |
| `qa-deploy.yml` | Uses a caller-selected branch; referenced Dockerfile and source paths exist. [Successful main deployment](https://github.com/open-mercato/open-mercato/actions/runs/29248062356). External service availability was not asserted. |
| `qa-stop-on-merge.yml` | Complements the still-supported QA-slot deployment flow. |
| `skills-tiers-lint.yml` | Referenced shell entry exists and delegates to the Node validator. [Successful current-main run](https://github.com/open-mercato/open-mercato/actions/runs/41616225654). |
| `mutation-tests.yml` | Active scoped mutation checks; intentionally skipped scopes are valid. |
| `enterprise-contribution-guard.yml` | Active contribution-policy guard. |
| `community-labels.yml` | Active event-driven labeling automation. |
| `partner-request-label.yml` | Active event-driven labeling automation. |

The snapshot's `develop` npm dist-tag and channel are compatibility interfaces, not references to a required Git branch. They remain unchanged. Current workflows have no `workflow_run` dependency on the old snapshot display name; the repository's contributor guide is updated with the new name.

## Registrations retained outside the maintained-branch tree

- **Security Analysis** (`341115769`, `security.yml`) still has source on live `feat/security-readiness`, with successful feature-branch runs. Missing default-branch YAML alone does not prove it cannot work.
- **Standalone PR Compatibility** (`404435636`, `standalone-pr.yml`) still has source on live `fix/standalone-pr-gate`, with a successful run on 2026-11-02. Main deliberately moved standalone validation into existing lanes; do not disable a live topic-branch registration without retiring that work.
- GitHub-managed workflows such as Dependabot, Copilot and managed CodeQL use dynamic paths. They are not missing repository files and are outside the retired-YAML cleanup.

## Verification

Parse every maintained workflow as YAML, run the existing snapshot/preview/provenance regression suites, and verify after cleanup that only the three specified registration IDs changed to `disabled_manually`. No job, event trigger, permission, runner, concurrency rule, publication channel or QA/approval policy changes in source.

Administrative verification completed on 2026-11-03: all three listed IDs read back as `disabled_manually`; a before/after catalog comparison found no other enabled-state changes. Historical run records were retained.
