# Development and review workflow

This overview describes the repository's agent-assisted development flow.
[PR workflow](.ai/docs/pr-workflow.md) is the authoritative policy;
[agent configuration](.ai/agentic.config.json) supplies machine-readable settings.
If this overview and policy differ, follow the policy and update the overview.

## From request to pull request

1. Establish the smallest safe scope. Check existing specifications under
   `.ai/specs/` and `.ai/specs/enterprise/`, and follow the task router in `AGENTS.md`.
   New features need a specification and integration coverage; small fixes can
   proceed with focused regression coverage.
2. Implement in an isolated worktree. Autonomous PR runs commit their execution
   plan before implementation, open a progress draft, and push incremental commits.
3. Validate the change, review correctness, security and compatibility, then
   publish the result. Follow `BACKWARD_COMPATIBILITY.md` for public surfaces.
4. Complete applicable QA. The implementing run promotes its draft when complete;
   a ready PR is a request for review, not permission to merge.
5. Merge only after current-head review, QA and CI gates pass. Release and
   deployment follow `CONTRIBUTING.md`; they are separate maintainer actions.

## Labels and ownership

Pipeline labels are mutually exclusive: `review`, `changes-requested`, `qa`,
`qa-failed`, `merge-queue`, `blocked`, `do-not-merge`. Review approval routes to
`merge-queue`; that label alone does not satisfy QA or CI. Only a QA reviewer
sets `qa` to indicate manual testing is underway.

Every ready PR needs a category, one priority and one risk label, using the
configuration's taxonomy. Priority measures urgency; risk measures blast radius.
A `needs-qa` PR cannot merge without `qa-approved`. Never combine `skip-qa` with
`needs-qa` or `qa-approved`. QA sign-off describes evidence and the tested head;
changed scope needs fresh verification. Self-QA follows the exception and evidence
requirements in the PR workflow, including both approval and self-verification labels.

Automations acquire the tracker’s atomic claim before mutation, then record
assignment when supported, `in-progress`, and a timestamped claim comment.
Foreign ownership blocks work. Release only the claim owned by the run.
`ci-monitoring` describes an owed CI follow-up; it never reserves the PR.

## Unattended processing

The human-controlled `automerge` label opts a PR into queue processing; removing
it stops that processing. It grants no code-review, QA, legal or CI approval.
Configured human-only labels/authors and `blocked`, `do-not-merge`, `qa-failed`
and active manual QA remain gates.

The configured mode is `prepare-and-merge`, with independent review required.
The worker may prepare and squash-merge only after all applicable gates pass on
the reviewed head. The tracker merge operation matches that commit SHA and keeps
GitHub's branch rules enforced. Neither a replacement PR nor a fresh commit
attests to a contributor's CLA: the CLA service must evaluate the new head.

Inspect workflow runs as well as individual checks. Pending workflows can exist
before jobs appear; partial check lists cannot establish success. Report completed
work without waiting for CI, disclose pending checks, and let the merge gates hold
merging. The configured CI follow-up budget is 40 minutes.

## Validation

Runner selection follows `.ai/docs/agent-instructions.md`. The configured gate is:

1. `yarn build:packages`
2. `yarn generate`
3. `yarn build:packages`
4. `yarn i18n:check-sync`
5. `yarn i18n:check-usage`
6. `yarn typecheck`
7. `yarn test`
8. `yarn build:app`

Record actual results and limits; never present pending checks as passes.
Docs-only runs use relevant documentation/configuration checks and a manual diff
review, as allowed by the authoring skill. PR reviews use GitHub checks first
under the repository review skill. Keep this list synchronized with configuration.

## Maintaining the pipeline

Update configuration and this overview together when policy changes. Repository
skill overrides extend their installed counterparts without relaxing safety
boundaries. Keep credentials, scheduler state and local QA artifacts out of git.
The `om-auto-continue-pr` skill resumes interrupted runs from their committed plan;
consult `om-auto-create-pr` for the initial execution workflow.
