# PR Workflow — Labels, Merge Rule, Batch QA, and Auto-Skill Protocol

The authoritative, long-form version of the PR label policy. The root `AGENTS.md` keeps only
the boundaries (which label groups exist, the hard merge blocks, the "exactly one priority +
exactly one risk" rule); everything below is the detail that used to live there. The machine
readable taxonomy lives in `.ai/agentic.config.json` (`labels.*`, `qaGate`, `humanQaPolicy`,
`qaBatch`, `prTriage`).

## Ready to merge (standing rule)

A PR squash-merges into `main` when all of these hold on its **current head**:

1. Every required CI check is green on the current head SHA.
2. At least one approving review.
3. No outstanding changes requested (review state or the `changes-requested` label).
4. No merge conflicts.
5. The Enterprise Contribution Guard (`guard`) passed.
6. No hard block: `blocked`, `do-not-merge` or `qa-failed`.

These never block a merge: a missing `qa-approved` (QA runs on the batch after merge, see
Batch QA below) and `review` still on instead of `merge-queue` after approval. `in-progress` is
not part of the rule either, but merge automation (`om-merge-buddy`, `om-auto-merge-buddy`)
waits until the agent releases it. A maintainer may merge a PR that still carries it, with
`--match-head-commit <sha>` so a late push from the agent stops the merge.

**Triage and acceptance.** An external (community) PR is triaged with `om-triage-pr` (category,
priority, risk and QA lane). A maintainer adds `needs-triage` by hand while an external PR waits
for a decision — no workflow sets it — and a human with write permission records the decision:
`accepted` (and remove `needs-triage`), a change request, or a close with a one-line reason.
Labels or approvals from automation accounts never count as that decision, and an external PR
needs a human approval. Core-team PRs are accepted by default and skip the acceptance step. The core
team is the login list in `.github/core-team.json` (compare logins case-insensitively); that file
is the single source, so scripts and skills read it instead of keeping their own list.

## Label groups

- Pipeline labels are mutually exclusive: `review`, `changes-requested`, `qa`, `qa-failed`, `merge-queue`, `blocked`, `do-not-merge`.
- Category labels are additive: `bug`, `feature`, `refactor`, `security`, `dependencies`, `enterprise`, `documentation`.
- Meta labels are additive: `needs-qa`, `skip-qa`, `qa-approved`, `qa-self-verified`, `in-progress`, `ci-monitoring`, `screenshots`.
- Priority labels are mutually exclusive within their group (only one at a time): `priority-low`, `priority-medium`, `priority-high`, `priority-extreme`.
- Risk labels are mutually exclusive within their group (only one at a time): `risk-low`, `risk-medium`, `risk-high`.
- Release-line labels are additive: `backport release/vX.Y.x` (cherry-pick into that line once merged), `backport main` (forward-port a line hotfix), `backport` (marks a PR the Backport workflow opened), `skip-changelog` (left out of generated release notes).

## Release-note labels

Generated release notes (`.github/release.yml`) group a PR by its category label and leave out
PRs labelled `skip-changelog`, so every PR merged into `main` or a `release/v*` line MUST carry
one of the two. Pick the category from what the PR changes for users, using its
conventional-commit type as the starting point:

| Change | Label | Notes section |
|---|---|---|
| `feat` — new capability or public API | `feature` | ✨ Features |
| a fix for a security issue, a tenant-isolation or auth flaw, or a vulnerable dependency | `security` | 🔒 Security |
| `fix` — incorrect behaviour corrected | `bug` | 🐛 Fixes |
| change confined to `packages/enterprise` or enterprise-only modules | `enterprise` | 🏢 Enterprise |
| `refactor`, `perf`, `test`, `ci`, `build`, `chore` with no user-visible behaviour | `refactor` | 🧹 Maintenance |
| `deps` / `chore(deps)` dependency bumps | `dependencies` | 🧹 Maintenance |
| `docs` only | `documentation` | 🧹 Maintenance |
| release and branch bookkeeping: version bumps, changelog carry-backs, branch-sync merges | `skip-changelog` | — (left out) |

- One category is the norm; add `security` next to `bug` or `dependencies` when the fix closes a
  vulnerability (it then lists under Security, the first matching section), and `enterprise` next
  to the type label when the change ships only in enterprise.
- The PR title is what the notes print, so it must read as a release-note line: a conventional
  title stating the user-visible effect (`fix(sales): keep the gross total after a discount edit`).
- Auto-skills set the label when they open a PR and the review step verifies it
  (`.ai/skills/om-code-review/SKILL.md`); a reviewer with label permission corrects a missing or
  wrong category directly, with a one-line rationale comment, instead of only reporting it. Fork
  contributors cannot set labels, so their PRs are labelled by the review step.

## Release lines and backports

Every PR targets `main`, the next minor; released minors live on `release/vX.Y.x` and take fixes
only (CONTRIBUTING.md § Releasing). A fix users of a released line need gets
`backport release/vX.Y.x` — the default for `priority-high`/`priority-extreme` bugs, security
fixes and regressions that exist on that line; never for features or refactors. Find the newest
line with `git branch -r --list 'origin/release/v*'`.

- Label the issue at triage and the PR when opening it; only the PR's label triggers the Backport
  workflow. Auto-skills copy a `backport …` label from the issue to the PR, and label
  normalization MUST NOT strip it.
- A backport PR is reviewed as a real PR: CI green *and* the change still fits the line's code.
  Backport copies category, priority, risk, `needs-qa` and `skip-qa`; it never copies
  `qa-approved`, so QA on the line is recorded afresh.
- Auto-skills never push to `release/v*`, never merge into it outside a reviewed PR, and never
  dispatch Release cut, Release or Release publish, and never create or delete `v*` tags (a tag
  starts a publish) — those are maintainer actions.
- Versions, workspace manifests' `version` fields and released `CHANGELOG.md` entries are never
  edited by hand; a PR that does is a review blocker.

## Priority

Priority labels are applied to issues and PRs to communicate urgency, are additive with
respect to category and meta labels, and default to **unset** (treated as `priority-medium`)
when no priority label is present. Use `priority-extreme` for production outages or security
incidents that require immediate action; `priority-high` for release-blocking issues;
`priority-low` for cosmetic, opportunistic, or follow-up cleanup work.

Treat priority as a first-class signal, not an afterthought. Every issue and every non-draft
PR SHOULD carry exactly one priority label; `om-auto-*` skills are expected to set or infer it
(see the inference rule below) rather than leave it unset. When a PR inherits from an issue,
copy the issue's priority forward unless the change in scope clearly warrants a different one.

**Priority inference** (used by auto-skills when no priority label is present): production
outage, data loss, or a security incident → `priority-extreme`; security hardening,
release-blocking regression, auth/session/tenant-scope/money/event-reliability fixes →
`priority-high`; ordinary bug fixes and net-new features → `priority-medium`; cosmetic,
docs-only, dependency bumps, opportunistic cleanup, or follow-up chores → `priority-low`. When
signals conflict, pick the higher priority and say why in the label comment.

## Risk

Risk labels communicate the **blast radius of the change** — how likely it is to introduce a
regression and how wide the impact would be if it does — and are additive with respect to
pipeline, category, meta, and priority labels. They default to **unset** (treated as
`risk-medium`) when no risk label is present. Risk is orthogonal to priority: priority is *how
urgent the work is*, risk is *how dangerous the change is to ship*. A one-line typo fix for a
production outage is `priority-extreme` + `risk-low`; a large auth-layer refactor that can wait
is `priority-low` + `risk-high`.

Treat risk as a first-class signal alongside priority. Every non-draft PR SHOULD carry exactly
one risk label; `om-auto-*` skills are expected to set or infer it rather than leave it unset.
When a PR inherits from an issue, copy the issue's risk forward unless the change in scope
clearly warrants a different one.

**Risk inference** (used by auto-skills when no risk label is present): changes to
auth/session/tenant-scope/money/billing, database migrations or schema, encryption, event
reliability, shared contract surfaces (types, signatures, event IDs, widget spot IDs, DI keys,
ACL IDs, API routes), or broad cross-module edits → `risk-high`; an ordinary single-module
feature or bug fix that ships with tests → `risk-medium`; docs-only, dependency bumps,
test-only, comment/typo, or isolated cosmetic cleanup → `risk-low`. When signals conflict, pick
the higher risk and say why in the label comment. A `risk-high` PR strengthens the case for
`needs-qa` and deeper review even when it would otherwise look routine.

## Pipeline transitions

- A ready non-draft PR should carry `review` unless it is already in another pipeline state.
- `auto-review-pr` moves approved PRs to `merge-queue`. `merge-queue` is routing only and
  optional: an approved PR that still carries `review` is mergeable under the standing rule.
  `needs-qa` stays in place as the QA lane for the batch. Auto-skills MUST NOT set the `qa`
  pipeline label — see the `qa` rule below.
- `auto-review-pr` MUST move review failures to `changes-requested`.
- `qa` (pipeline) means **manual QA is in progress**: a QA reviewer has picked the PR up and is
  actively testing it. It is applied **manually by a QA reviewer**, never by an `om-auto-*`
  skill. Auto-skills request QA with the `needs-qa` meta label only; they never set, move to, or
  remove `qa`. Per-PR manual QA before merge is optional; when a QA reviewer does test a PR,
  they set `qa` while testing and record the outcome with `qa-approved` (pass) or `qa-failed`
  (fail, a hard block).

## QA meta labels

- `needs-qa` is for UI changes, new features, sales or order flows, and other customer-facing
  behavior that needs manual exercise. It presumes there is a surface a QA reviewer can actually
  exercise by hand; when there is not, see the automated-verification exemption below.
- `skip-qa` is for docs-only, dependency-only, CI-only, test-only, typo-only, changes with no
  manually exercisable surface (see the exemption below), or similarly low-risk
  non-customer-facing changes.
- **Automated-verification exemption (no manually exercisable surface):** a change that touches
  no UI-rendering file — no `.tsx` outside tests, nothing under `packages/ui/src/`, nothing under
  `**/components/**` — gives a QA reviewer nothing to click through, so manual exercise cannot
  produce evidence beyond what the test suite already proves. Such a PR takes `skip-qa` instead of
  `needs-qa`, **but only when it leaves the database structure and API surface unchanged, does not
  break any contract in `BACKWARD_COMPATIBILITY.md`, and ships automated tests covering the
  changed behavior in the same PR**: unit tests at minimum, and an integration test whenever the
  change crosses component boundaries or touches auth, session, tenant scope, money, or event
  reliability. A PR that changes the database structure or API surface, breaks a
  backward-compatibility contract, or lacks the required coverage keeps `needs-qa`; the QA
  reviewer verifies a non-UI change through its applicable interface instead of the UI.
  Translation-only changes to `i18n/*.json` fall under the same exemption: they are verified by
  reading the diff plus `yarn i18n:check-sync` and `yarn i18n:check-usage`, which the validation
  gate already runs. This exemption replaces manual clicking that cannot happen with executable
  proof that runs on every push — it does not lower the bar, so `security` and `risk-high` neither
  qualify nor disqualify a PR for it. The risk-inference rule above still applies: a `risk-high`
  PR is a reason to demand the integration test and a deeper review, not a reason to demand
  clicking that cannot happen. A reviewer may always override the exemption back to `needs-qa`
  with a stated reason (for example when the change alters a response the UI renders). It does not
  change the merge rule: `needs-qa` routes a PR to QA, it never holds the merge.
- `qa-approved` records that manual QA passed, on a PR or on a batch PR. It is evidence, not a
  merge gate for PRs into `main`.
- `qa-batch-check` asks a tester to look at a merged PR in the next batch; `needs-human-qa` asks
  for a human tester. Neither blocks the merge into `main`.
- `screenshots` records that UI QA visual evidence was attached to the PR (posted by
  `om-auto-qa-pr`, which first runs `om-auto-review-pr` when the PR is still unreviewed); it is
  informational only — it does not gate merge and is orthogonal to `needs-qa`/`qa-approved`.

**QA is not a merge gate for PRs into `main`.** A `needs-qa` PR merges under the standing rule
without `qa-approved`; QA happens on the batch (below). `qaGate` is `false` in
`.ai/agentic.config.json`, so `om-merge-buddy`, `om-approve-merge-pr` and the review skills do
not refuse a `needs-qa` PR for a missing `qa-approved`. Never combine `skip-qa` with
`needs-qa`/`needs-human-qa`/`qa-approved`.

## Batch QA

1. PRs keep merging into `main`; nothing targets a batch branch.
2. **On demand** (not daily, not automatically) a maintainer, the stabilizer, cuts
   `stabilize/main-<date>` from `main` and opens it at once as a non-draft PR to `main`. Only one
   batch is open at a time.
3. QA deploys the batch, makes **one QA pass** (`.ai/qa/batch-smoke.md`, added by PR #10712, plus the `om-qa-batch`
   checklist) and files bugs as issues (`bug` + `daily-qa`, plus `qa-blocker` when a user cannot
   finish a main task).
4. QA blockers are fixed **only by the stabilizer**, with commits pushed directly onto the batch
   branch. No PR ever merges into a batch; the fixes reach `main` through the merge-back.
5. QA records the verdict on the batch PR: `qa-approved` (stable) or `qa-failed` (unstable).
6. On a stable verdict the stabilizer tags the tested head `green/<date>` and squash-merges the
   batch PR back into `main` with `--match-head-commit <sha>`.

The step-by-step commands are in CONTRIBUTING.md → "Batch: stabilizer runbook".

**Self-QA exception:** the manual QA is normally performed by the dedicated QA reviewers. When
they have no capacity to test in time, any engineer may self-QA instead — but only by
(1) checking the PR out and running it locally, (2) clicking through the affected flow, and
(3) attaching proof to the PR: a screenshot showing it working, or a written confirmation
describing what was exercised and the observed result. After that, apply BOTH `qa-approved` (the
record that QA passed) and `qa-self-verified` (so it is auditable that a non-QA engineer signed off via
this exception, not the QA team). Do not apply `qa-approved` via the self-QA path without the
attached evidence. Refer to QA reviewers by role, never by GitHub handle — assignments change.

**Self-QA requires `triage` permission to finish.** Applying `qa-approved` + `qa-self-verified`
is a label write, so a contributor with `read` permission (the usual case for fork-based
contributions) can perform the testing and attach the evidence but cannot complete the exception.
For them it splits into two halves: the contributor posts the evidence comment on the PR — that
comment is the durable artifact, the labels only record it — and a maintainer applies the two
labels on the strength of it. A maintainer doing so is upholding the gate, not bypassing it, as
long as the linked evidence actually exists. An `om-auto-*` skill that cannot apply the labels
MUST report that it stopped there rather than treat the self-QA as complete.

`qa-failed` is a hard block: a PR carrying it MUST NOT merge until QA re-runs and it is cleared.
`do-not-merge` and `blocked` are likewise hard merge blocks. Reviewers and the PR-automation
tooling treat any of these as not-mergeable.

## Auto-skill protocol

- Auto-skills that mutate PRs or issues MUST claim them first with all three signals: assignee,
  `in-progress` label, and a claim comment. They MUST release the `in-progress` label when
  finished, even on failure.
- When an auto-skill adds or changes a PR pipeline/meta label, it MUST also leave a short PR
  comment explaining why that label was applied.

## `in-progress` vs `ci-monitoring`

These two meta labels describe **different phases** of an automated run and must never be
conflated. Both are meta labels: they are additive, they coexist with any pipeline label
(`review`, `changes-requested`, `merge-queue`, …) exactly like `needs-qa` does, and neither
participates in pipeline-label mutual exclusivity.

- **`in-progress` — a work claim (a lock).** The agent is actively working the PR: editing code,
  running the review, fixing findings, pushing commits. Its output is not yet on the PR. Other
  auto-skills back off while it is present. It is one of the three claim signals alongside the
  assignee and the claim comment.
- **`ci-monitoring` — a follow-up marker, NOT a claim.** The agent's work is **done and already
  fully reported**: pipeline labels applied, review submitted, comments posted. The only thing
  left is watching CI results and posting the CI-result follow-up comment. The PR's state on
  GitHub is already correct and complete without that comment.

**A PR carrying only `ci-monitoring` is explicitly NOT "already in progress".** In-progress /
concurrency detection MUST consider only the claim signals — the `in-progress` label, a non-self
assignee, and a fresh claim comment. When none of those are present, a PR is free to claim and
act on **even though `ci-monitoring` is on it**; another agent or a human may pick it up without
waiting, and doing so is not a claim violation. Do not lump `ci-monitoring` in with the lock
signals in any skip/back-off condition.

**Lifecycle.** An agent claims with `in-progress`. The moment its work is complete and reported,
it swaps the labels: remove `in-progress`, add `ci-monitoring`. When it posts the CI-result
follow-up comment, it removes `ci-monitoring` — the label's whole meaning is "a CI-result comment
is still owed on this PR". A skill that performs no CI follow-up simply removes `in-progress` as
it always has and never adds `ci-monitoring`.

**Why the split exists.** CI here runs for 20+ minutes to several hours (ephemeral integration
shards). Skills used to hold the review, the labels and the comments back until CI went green,
keeping `in-progress` applied the whole time. If that monitoring process died mid-wait, the PR was
stranded: it still looked claimed by a live agent that no longer existed, so other automation kept
skipping it — with no labels, no review, and no record that any work had happened at all. Reporting
immediately and switching to `ci-monitoring` makes the stranded case honest and self-describing:
the worst outcome is a missing CI-result comment on an otherwise fully processed PR that anyone
is free to take over.

`ci-monitoring` gates nothing. It does not affect the merge rule, the priority/risk
requirements, or any hard merge block. `in-progress` holds back other agents, including merge
automation, until it is released (see the ready-to-merge rule above).

## Design-system governance files

The CODEOWNERS design-system section (`.github/CODEOWNERS`) assigns a single design owner to the
files that encode *how* the design system is governed — the rules, tokens, lint-escalation policy,
guardian skill and docs — as opposed to the UI code those files judge. At time of writing:
`docs/design-system/`, `.ai/ds-rules.md`, `.ai/ui-components.md`, `.ai/skills/om-ds-guardian/`,
`.ai/scripts/ds-health-check.sh`, `packages/eslint-plugin-ds/`, `.ai/ds/`, and both `globals.css`
files. Read CODEOWNERS for the current list rather than trusting this one.

**An automated PR MUST NOT change these files.** File an issue for the design owner instead. A
coding agent cannot weigh a governance trade-off the owner exists to make, and a CODEOWNERS review
request on a bot-authored diff puts that owner in the position of rubber-stamping or re-deriving
the reasoning from scratch.

**UI code and modules stay open.** The restriction is deliberately narrow: it covers the governance
surface, not the components, pages, or module code that the design system applies to. An automated
PR that changes a component while respecting `.ai/ds-rules.md` is doing exactly what it should.
