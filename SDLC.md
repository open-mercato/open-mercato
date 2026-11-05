# Software delivery process

## Purpose

This file documents how work flows from ticket to merged PR in this repository. The agent skills configured in `.ai/agentic.config.json` enforce the process; humans read it here. New PRs default to `main`; existing PRs use their own current target branch (`baseRefName`) for base updates, reviews, required checks, and merging; issues and PRs live in github, with every tracker operation the skills run defined in `.ai/trackers/github.md` (edit that file to extend or override tracker behavior).

Work enters through two paths: a free-form task brief handed to an agent, or a filed ticket. Both converge on the same review loop, the same validation gate, and the same merge gates.

The repository-specific label policy (priority/risk inference, the automated-verification exemption, the claim protocol details) lives in [`.ai/docs/pr-workflow.md`](.ai/docs/pr-workflow.md); when the two disagree, that file wins for this repository.

Before intake, the work is shaped: `om-brainstorm` turns a single idea or question into a routing decision and a brief, and the spec skills (`om-spec-writing`, `om-auto-write-spec`) turn a feature into a design document before anything is built. Those steps feed the table below; they are not the ticket flow itself.

## Roles

- **Author** — the human or agent who writes the change. Owns the ticket from claim to a merge-ready PR.
- **Reviewer** — reads the diff and approves or requests changes. May be a human or the `om-auto-review-pr` skill; the `om-code-review` checklist applies either way. The reviewer is also the second person a `risk-high` change needs and signs off the spec when a feature requires one; a team that names a tech lead or an architect puts them here.
- **Designer** — owns the flow and its states before the code exists, and the design contract the UI review reads back. May be a human, `om-ux-shape` for shaping, `om-ux-design` for detailed screens from a specification, or `om-ux-review-pr` for the pass over a PR's screens.
- **QA reviewer** — exercises user-facing changes before they merge, with `om-prepare-test-env` to boot the app once and `om-auto-qa-pr` to walk it in a real browser. Manual means a person judges the result and owns `qa-approved`; it does not mean the work is unassisted. Always referenced by role, never by name or handle: assignments change.
- **Maintainer** — owns branch protection, the label taxonomy, the config, this document, and the installed skills with their repo-local overrides under `.ai/skills/`; arbitrates when gates conflict. Acts as the release manager unless the team names one.

## Ticket lifecycle

| Stage | What happens | Driven by | Done when |
|---|---|---|---|
| Discovery | An idea, question, or itch is talked through before any artifact exists: the problem is questioned, alternatives (including building nothing) are weighed, and the conversation ends in a routing decision — an answer, a filed ticket, a brief for a spec, or a direct change. | `om-brainstorm` or a human | Conversation routed; a brief written when the work continues |
| Intake | A ticket or task brief is filed in github with enough detail to act on: what is wrong or wanted, for whom, and what done looks like. `om-prepare-issue` files it with SDLC labels. | Anyone, `om-prepare-issue` | Ticket exists |
| Triage | Confirm the issue is real, still unfixed on `main`, and not already claimed or covered by an open PR. Read-only; stops the chain cleanly when there is nothing to do. | `om-verify-in-repo` or a human | Confirmed actionable, or closed as no-action |
| Claim | The author claims the ticket so concurrent agents back off. See the claim protocol below. | `om-fix` / `om-auto-create-pr`, or a human | Claim visible on the ticket |
| Design | For a user-facing change, the flow and its states are settled before the code exists: what the screen does when empty, loading, in error, and without permission, and what the change deliberately does not do. Detailed screens may be designed from the specification with repository components; only an accepted version becomes its `Prototype:` reference. A ticket that touches no UI skips this stage. | `om-ux-shape`, optionally `om-ux-design` when chosen, or a human designer | The flow and its states are decided, or the ticket is not user-facing |
| Implement | Locate the minimal change surface (`om-root-cause`, read-only), then implement the change with regression tests and run the validation gate. Task briefs without a ticket go through `om-auto-create-pr`, which plans, implements phase by phase in an isolated worktree, and runs the same gate. | `om-root-cause` + `om-fix`, `om-auto-create-pr`, or a human author | Change complete, validation gate green |
| PR | Commit, push, and open a PR against `main` with normalized labels. On a hand-worked branch, `om-check-and-commit` runs the gate, fixes obvious drift, and pushes when green. | `om-open-pr`, `om-auto-create-pr`, or `om-check-and-commit` | Open, labeled PR |
| Review loop | The reviewer reads the diff against the `om-code-review` checklist and approves or requests changes. Requested changes are addressed (`om-auto-continue-pr` resumes agent PRs from the tracking plan, and adopts a PR that has none by reconstructing the plan from the PR's own context) and the PR is re-reviewed until approved. A user-facing change also gets a design pass: `om-ux-review-pr` walks the changed screens and reports findings ranked by user impact. That pass is advisory — it informs the review, it does not hold the merge. | `om-auto-review-pr` (single PR), `om-review-prs` (sweep), `om-ux-review-pr` (design pass), or a human | Approving review submitted |
| QA | A PR carrying `needs-qa` waits for QA. The reviewer boots the app once with `om-prepare-test-env`, walks the change in a real browser with `om-auto-qa-pr` — which attaches screenshots and a pass/fail report and touches no labels by default — and records the outcome. A flow worth keeping becomes `om-integration-tests` coverage. See the QA gate below. | QA reviewer, with `om-prepare-test-env`, `om-auto-qa-pr`, `om-integration-tests` | `qa-approved` applied by a QA reviewer or the permitted self-QA exception; `qa-failed` routes it back |
| Merge | `om-merge-buddy` reports, read-only, which PRs can merge now and which are close but blocked. `om-approve-merge-pr` re-checks every gate, approves, and squash-merges. `om-auto-merge-triage` proposes candidates for `automerge`, and labels those a human confirms. `om-auto-merge-buddy` works the PRs a human labeled `automerge` unattended until the three automerge signals hold, then marks them ready or squash-merges them. | `om-merge-buddy` + `om-approve-merge-pr`, `om-auto-merge-triage` + `om-auto-merge-buddy`, or a human | PR squash-merged into its current target branch |
| Post-merge housekeeping | Close issues the merged PR fixes; comment on issues whose PRs were closed without merging; turn leftover asks or review comments into tracked follow-up issues. | `om-close-fixed-issues`, `om-followup-issue-from-pr` | Tracker reconciled, follow-ups filed |

After merge, this process stops. Deployment, smoke tests, monitoring, and rollback belong to the repository's release process, not to this document: the Maintainer — or a release manager, when the team names one — drafts the changelog with `om-auto-update-changelog` and reconciles the tracker with `om-close-fixed-issues`, and `om-pipeline-retro` reads finished runs to rank what second passes cost. Merge is where this document ends; delivering the change to users is a separate process the team owns.

## Label state machine

Pipeline labels are mutually exclusive: a PR carries at most one, and it names where the PR sits in the flow.

- A ready, non-draft PR carries `review`.
- The reviewer moves it: request changes → `changes-requested`; after fixes it returns to `review`; approval → `merge-queue`.
- `merge-queue` is routing, not proof of QA: a `needs-qa` PR legitimately sits there until QA signs off.
- Only a QA reviewer sets the `qa` pipeline label. They move a queued `needs-qa` PR from `merge-queue` to `qa` while testing, then back to `merge-queue` with `qa-approved` on pass, or to `qa-failed` on failure. Automated skills request QA with `needs-qa`; they never set `qa`.
- `blocked` and `do-not-merge` are set and cleared by humans and stop the flow wherever it is.

| Group | Labels | Exclusivity | Meaning |
|---|---|---|---|
| Pipeline | `review`, `changes-requested`, `qa`, `qa-failed`, `merge-queue`, `blocked`, `do-not-merge` | one at a time | Workflow state |
| Category | `bug`, `feature`, `refactor`, `security`, `dependencies`, `enterprise`, `documentation` | additive | Kind of change |
| Meta | `needs-qa`, `skip-qa`, `qa-approved`, `qa-self-verified`, `in-progress`, `ci-monitoring`, `screenshots` | additive | Process signals |
| Priority | `priority-low`, `priority-medium`, `priority-high`, `priority-extreme` | one at a time; unset = medium | Urgency of the work |
| Risk | `risk-low`, `risk-medium`, `risk-high` | one at a time; unset = medium | Blast radius of the change |

Priority is how urgent the work is; risk is how dangerous the change is to ship. A one-line fix for an outage can be `priority-extreme` and `risk-low`; a large auth refactor that can wait can be `priority-low` and `risk-high`. A PR inherits both from its source issue unless the scope clearly changed. When an automated skill adds or changes a pipeline or meta label, it leaves a short comment explaining why.

When no priority label is set, infer one:

- `priority-extreme` — production outage, data loss, or an active security incident.
- `priority-high` — security hardening or a release-blocking regression.
- `priority-medium` — ordinary bug fixes and net-new features (also the default reading of unset).
- `priority-low` — cosmetic, docs-only, dependency bumps, follow-up cleanup.

When no risk label is set, infer one:

- `risk-high` — authentication and login sessions, data scoping, money, schema migrations, shared contract surfaces, or broad cross-cutting edits.
- `risk-medium` — an ordinary single-area change that ships with tests (also the default reading of unset).
- `risk-low` — docs-only, test-only, typo, or isolated cosmetic changes.

When signals conflict, pick the higher label and say why in the label comment. A `risk-high` PR is not merely advised to get more scrutiny; it triggers gates:

| Area behind `risk-high` | What the PR must carry |
|---|---|
| Auth, sessions, permissions | an integration test for the denied path and the wrong-scope read; a second person's review |
| Data scoping | an isolation test proving one scope cannot read another |
| Money | tests for the failure, retry, and idempotency paths; a second person's review |
| Schema migrations | a migration test up and down, and a rollback plan in the PR body |
| Shared contract surfaces | the consuming side exercised, per `BACKWARD_COMPATIBILITY.md` |
| Any `risk-high` | `needs-qa` when user-facing; no self-QA; `om-code-review` blocks without the evidence above unless a maintainer waives it on the PR |

Two labels live outside this taxonomy, and only humans decide them (the automerge signal labels below are applied only by `om-auto-merge-buddy`):

- `do-not-close` — on issues that housekeeping skills must never auto-close. Skills only ever read it.
- `automerge` — on a PR the human wants merged without further attention. A human applies it directly, or `om-auto-merge-triage` applies it to the PRs a human confirms from its ranked proposal (eligibility rules: `automerge.eligibility`). Its AI judgment prioritizes important fixes close to merge, inspecting older PRs with screenshots and requested changes. Requested changes must be bounded and pass that judgment before any tier can propose the PR; review, QA and CI remain required. `om-auto-merge-buddy` works these PRs one at a time within a time window (default 2 hours). It resumes due tracked work from local `.ai/meta/merge-buddy.json`, prefers current-user assigned actionable work when tracking is nonempty, and assigns/verifies the current user at the first actionable step. Empty/reset scheduling keeps the global queue; live `in-progress` claims remain protected. Readiness is three signals, each recorded as a label that only this skill applies:
  - `automerge-signal-1-cr` — `om-auto-review-pr` approved the current head; independent native approval is additional only when the resolved policy requires it.
  - `automerge-signal-2-qa` — QA is not required (`skip-qa`, or no `needs-qa`), or `qa-approved` is pinned to the current head by its `QA head:` line. Only `om-auto-qa-pr` may apply it through self-QA, on `risk-high` only under the explicit invocation-scoped risk override below.
  - `automerge-signal-3-ci` — every check on the current head finished green, with no conflicts.

  On its first visit to a PR, when no signal is recorded yet, the buddy derives the initial signals from the PR's real state: its labels, reviews and comments, and its CI checks on the current head. It then starts from the first signal still missing, so review, QA or CI work already done is not repeated. A missing signal is produced by `om-auto-review-pr --autofix`, `om-auto-qa-pr`, or `om-auto-fix-pr`, each run with `--orchestrated` so the buddy alone owns the claim and the labels. CI that is still running is parked under `ci-monitoring` and checked again later. A PR that cannot be fixed within the attempt limit is parked under `automerge-blocked`; remove that label to retry. A fork PR is carried forward to a credited replacement that keeps the label. In `prepare-to-merge` mode, a PR with all three signals gets `merge-queue`. In `prepare-and-merge` mode (the missing-config default) it is squash-merged, bypassing other labels and host merge rules, because the three signals are the gate. Removing `automerge` stops the automation.

Mode and independent review come from `.ai/agentic.config.json`:
`automerge.mode` defaults to `prepare-and-merge`, and
`automerge.requireIndependentReview` defaults to `false`. Explicit `--mode`,
`--require-independent-review` or `--skip-independent-review` override current
config; conflicting review flags/invalid values stop. Automatic code review and
actionable inherited objections remain required. Default mode does not wait
for native approval or a stale requested-changes state after objections are
resolved. Strict policy needs fresh nonauthor/nonautomation human native
approval on the current head before either prepare mode finishes, with no
newer standing requested-changes verdict; missing approval waits without
repeating automated stages or consuming attempts. Recheck policy/evidence at
every entrance and final guard; saved status/scheduler policy is never authority.
Standalone skills keep their existing review gates. `automerge.defaultToHumanQa`
defaults false: missing mandatory local QA approval/testable gaps schedule real
`om-auto-qa-pr --orchestrated` for coverage/legitimate self-sign-off, reusing
current covered evidence. True prefers human approval; explicit `--human-qa` or
`--auto-qa` overrides config. Only verified ineligibility/blockers or explicit
human routing wait for a human; no preference fabricates approval labels.

### Explicit automerge risk override

`om-auto-merge-buddy --force` records the operator’s explicit exception on the
PR and run for this invocation only. It waives the risk-high integration-evidence
requirement and risk-high self-QA exclusion; the QA skill must still complete
real verification, attach screenshots and pin its sign-off to the tested head.
Full review, actual correctness/security findings, the configured validation
gate, required QA, CI, conflicts and the merge head guard remain. It does not
change risk labels or authorize claim takeover. The buddy passes the separate
`--skip-risk-checks` flag to orchestrated stages. Without `--force`, even on
resume, strict gates apply and override-derived review/QA approvals cannot be
reused as ordinary approvals. Standalone skill defaults are unchanged.

The independent `--skip-pre-existing-ci-errors` flag permits only an individual
completed CI failure proved identical on the exact current target SHA, using
matching workflow/job context, unchanged relevant CI definitions and actual
matching diagnostic/root cause. Record both runs, SHAs and the proof; pending,
new, unreadable or unknown failures are not waived. The flag is invocation-only,
never enabled by `--force`; later strict runs and target advances/reruns require
fresh CI evaluation. A waived failure stays visibly failed, not green. Local
validation and all other gates remain unchanged.

For human-authorized automerge PRs, signal 2 also accepts a trusted completed
`om-auto-qa-pr` PASS on the unchanged head, independently of manual-approval
labels or self-QA eligibility, including evidence-only and risk-high reports
with disclosed coverage limitations. Trust requires same-author starter,
report and completion history from an account with write access; resolve legacy
short `Verified` SHAs uniquely to the exact current head. Keep limitations
visible, add no `qa-approved`/`qa-self-verified`, and skip duplicate QA attempts.
Newer trusted FAIL, revocation/deletion or head changes invalidate this evidence.
This automerge signal exception leaves standalone QA and other merge skills'
manual-approval gates unchanged.

## The QA gate

The one hard rule of this process: **a PR carrying `needs-qa` must not merge until it also carries `qa-approved`, even when every other check is green.** `om-merge-buddy` classifies such a PR as blocked; `om-approve-merge-pr` refuses to merge it.

- Apply `needs-qa` to UI changes, new features, and other user-facing behavior that needs manual exercise.
- For a UI change, QA covers more than "it works": the state matrix (default, empty, loading, error, no-permission, long content, narrow viewport) is part of the pass/fail, and so is conformance to the design contract in `.uxproof/` when the repository has one. A missing state fails QA. `om-ux-review-pr` remains the advisory design review; its objective checks are the ones QA runs.
- `skip-qa` is the explicit opt-out for docs-only, dependency-only, CI-only, test-only, and similarly low-risk non-user-facing changes. Never combine it with `needs-qa`.
- `qa-failed`, `do-not-merge`, and `blocked` are hard blocks regardless of every other signal. An active `qa` pipeline label means a tester is on the PR right now — never merge under an active tester.
- The gate is satisfied when a QA reviewer tests the PR and applies `qa-approved`.
- **`qa-approved` is pinned to a commit.** The comment that grants it — the QA reviewer's note, or the self-QA evidence comment — carries the line `QA head: <sha>` for the head that was tested. A push after that line leaves the label in place but stales it: `om-merge-buddy` reports "QA evidence older than head", and `om-approve-merge-pr` asks for confirmation before merging. The way back is a QA reviewer re-testing, or stating on the PR that the new commits do not touch the tested scope, with a fresh `QA head:` line.
- **Self-QA exception**: when no QA reviewer has capacity in time, any engineer — or `om-auto-qa-pr --self-qa-signoff` — may sign off instead, on a `risk-low` or `risk-medium` PR only. The evidence attached to the PR names the scenario exercised, the environment, the test data, the observed result, the negative cases tried, and the `QA head:` line. Then apply both `qa-approved` (so the gate passes) and `qa-self-verified` (so the exception is auditable). No evidence, no `qa-approved`.
- **No self-QA on `risk-high`.** A PR labeled `risk-high`, or one whose diff touches auth, sessions, data scoping, money, schema migrations, or shared contracts (the `risk-high` inference above), needs a QA reviewer, or a maintainer's explicit exception stated on the PR; `om-auto-qa-pr` withholds the sign-off on such a PR and posts the evidence only. A change to auth or money also needs a second person's review regardless of the QA path.

## The claim protocol

Before mutating an issue or PR, an agent claims it with all three signals: it assigns itself, adds the `in-progress` label, and posts a claim comment saying what it is doing. Any agent that finds an existing claim backs off instead of colliding. A PR carrying `in-progress` is also skipped by the merge tooling.

`in-progress` means **actively working**. Once an agent's work is finished and fully reported — labels applied, review submitted, comments posted — it swaps `in-progress` for `ci-monitoring` if it still intends to report the CI outcome. `ci-monitoring` is **not** a claim and blocks nobody: it says only that the CI-result follow-up comment is still owed, so another agent or a human may act on the PR freely. That distinction matters because CI runs long: an agent that reported its work and then died while watching a run leaves an honest, self-describing state instead of a lock nobody holds. The label comes off when the follow-up lands, or when the agent gives up waiting at `ci.maxWaitMinutes` and says so.

The claim is released when the work finishes — on success and on failure alike. A stale `in-progress` with no recent activity may be cleared by the maintainer.

### Reporting is decoupled from CI

Agents apply labels, submit reviews, and post comments **as soon as their work is done**, without waiting for CI to go green. A review submitted while checks are still running says so in its body: branch protection plus the QA-approval gate hold the actual merge, and the approval covers the code, not a green run. The CI outcome arrives afterwards as a follow-up comment, which also corrects the pipeline label if the result changes the verdict.

The wait for that outcome is bounded by `ci.maxWaitMinutes` (default 40). When it expires with checks still running, the agent stops waiting, runs the local validation gate as its own evidence, posts that together with the still-pending check names and an explicit statement that no further follow-up is coming, drops `ci-monitoring`, and finishes.

A red signal does not short-circuit the review either. A failing required check or a conflicted head is collected as a **blocker finding** and reported together with the full code review, never instead of it: one review cycle gives the author the failing check, the conflict, and every code finding at once, rather than the cheapest red flag first and another cycle to discover the rest. Such a verdict is still `changes-requested` — completeness changed, the gate did not.

None of this touches the merge gates. Reporting early is safe; merging early is not — required checks still gate every merge, and the merge tooling refuses until they are genuinely green.

## The automation contract

The `om-auto-*` skills run this process unattended and are chainable: each accepts the artifact the previous one produced (an issue id, a spec path, or a PR number from the `PR: #<number> (link: <url>)` reference line every PR-producing skill emits), and each detects work already started — an open PR referencing the issue or plan — and continues on it rather than opening a duplicate. A completed autonomous run leaves a **ready** (non-draft), fully labeled PR — one pipeline label, category, QA meta, one priority, one risk — with a run-summary comment and, for user-facing changes, screenshots from the working app attached as PR evidence. Draft PRs are reserved for explicitly incomplete states: spec-only design PRs, interrupted hand-offs, or autonomous defaults flagged for human confirmation. Automation applies `qa-approved` only through the self-QA exception (`om-auto-qa-pr --self-qa-signoff`, always paired with `qa-self-verified`, on `risk-high` only under the explicit invocation-scoped risk override below); no authoring, review, or merge skill ever applies it.

## Validation gate

Every PR passes the full validation gate before review sign-off, in this order:

- `yarn build:packages`
- `yarn generate`
- `yarn build:packages`
- `yarn i18n:check-sync`
- `yarn i18n:check-usage`
- `yarn typecheck`
- `yarn test`
- `yarn build:app`

Any non-zero exit fails the gate and blocks the PR. The implementing skills run the gate before opening a PR, and `om-check-and-commit` runs it before pushing a hand-worked branch. The command list lives in `.ai/agentic.config.json`; when it changes, update it there and in this section together.

## Amending this process

This document and `.ai/agentic.config.json` describe the same process: change them together, and re-run the `om-setup-agent-pipeline` skill when the toolchain or label taxonomy changes.

The design contract the Design and Review stages read is set up once: `om-ux-setup` extracts it from the repository and is re-run when the design system changes.

Per-skill deviations — extra review rules, a different PR body template, an added gate step — belong in a repo-local skill of the same name at `.ai/skills/<skill-name>/SKILL.md`, which takes precedence over the installed skill (and can `@`-import or reference it to extend rather than replace it); local rules win, but a repo-local skill cannot grant what the installed skill's safety rules forbid.

## Human-confirmed issue autofix queue

`om-auto-issue-triage` proposes useful open issues with decided scope and bounded
work. It applies `autofix.label` (default `cez-autofix`) only to issues a human
confirms after seeing evidence. It skips active/uncertain claims, preserves
assignees, rechecks current state and verifies label read-back. The label may
trigger the repository's existing worker; this skill does not install or invoke
one. Implementation remains `om-auto-fix-issue` or the existing worker, with all
normal specification, code-review, QA and CI gates unchanged.
