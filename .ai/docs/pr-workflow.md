# PR Workflow — Labels, QA Gate, and Auto-Skill Protocol

The authoritative, long-form version of the PR label policy. The root `AGENTS.md` keeps only
the boundaries (which label groups exist, the hard merge blocks, the "exactly one priority +
exactly one risk" rule); everything below is the detail that used to live there. The machine
readable taxonomy lives in `.ai/agentic.config.json` (`labels.*`, `qaGate`).

## Label groups

- Pipeline labels are mutually exclusive: `review`, `changes-requested`, `qa`, `qa-failed`, `merge-queue`, `blocked`, `do-not-merge`.
- Category labels are additive: `bug`, `feature`, `refactor`, `security`, `dependencies`, `enterprise`, `documentation`.
- Meta labels are additive: `needs-qa`, `needs-human-qa`, `qa-batch-check`, `qa-in-progress`, `skip-qa`, `qa-approved`, `qa-self-verified`, `in-progress`, `ci-monitoring`, `screenshots`.
- Issue labels for QA findings: `bug` + `daily-qa` (a defect found in a daily batch or a release QA pass) and `qa-blocker` (that defect blocks the batch). `weekly-qa` is kept on old issues only.
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
  `qa-approved`, so the QA gate applies to the line again.
- Backport deliberately does not copy `needs-human-qa` either: the original PR already passed the
  human-QA gate on `main`, and every backport is covered by the release-line QA pass that runs
  before each release (§ Daily batch QA). Automatic QA still runs, because `needs-qa` is copied.
  Exception: when the cherry-pick conflicted and the conflict was resolved by hand, the backport
  is no longer the code the tester saw, so the reviewer MUST add `needs-human-qa` to the backport
  PR by hand, and the QA-approval merge gate applies.
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
- `auto-review-pr` MUST move approved PRs to `merge-queue` only when every gate holds on the
  current head. A PR that carries `needs-human-qa` without a current-head `qa-approved` keeps
  `review` ("waiting for a human tester") and MUST NOT be moved to `merge-queue`;
  `merge-queue-guard.yml` takes `merge-queue` off such a PR. Auto-skills MUST NOT set the `qa`
  pipeline label — see the `qa` rule below.
- `auto-review-pr` MUST move review failures to `changes-requested`.
- `qa` (pipeline) means **manual QA is in progress**: a QA reviewer has picked the PR up and is
  actively testing it. It is applied **manually by a QA reviewer**, never by an `om-auto-*`
  skill. Auto-skills request QA with the `needs-qa` / `needs-human-qa` meta labels only; they
  never set, move to, or remove `qa`. A QA reviewer flips an approved `needs-human-qa` PR from
  `review` to `qa` (or adds `qa-in-progress`) while testing, then records the outcome with
  `qa-approved` (pass) or `qa-failed` (fail).

The `qa` pipeline label is driven manually by QA reviewers, not by auto-skills. When a QA
reviewer starts testing an approved `needs-human-qa` PR, they move it from `review` to `qa`
(`gh pr edit <number> --remove-label review --add-label qa`) to signal QA is in progress.
When QA passes on the current head, record approval and route it to the queue (`gh pr edit
<number> --remove-label qa --add-label merge-queue --add-label qa-approved`); via the self-QA exception add
`qa-self-verified` as well. When QA fails, route to `qa-failed` (`gh pr edit <number>
--remove-label qa --add-label qa-failed`) and do not add `qa-approved`.

## QA meta labels and the merge gate

- QA triage (`om-auto-review-pr`; `om-triage-pr` once open-mercato/skills#211 ships, same rules; rules in `.ai/agentic.config.json` → `humanQaPolicy`) puts
  every PR in one lane, judging what the change does, not who wrote it:
  - `needs-human-qa`: a tester MUST check it **before merge**, because fixing forward would not
    help. A new feature or visible UX change without an approved design (a merged spec with
    mockups for the changed screens), money or payments, lowered security or widened access or
    tenant scoping, removed fields, tables, API fields or routes without a simple upgrade path,
    destructive migrations, installation and default credentials, external systems automation
    cannot reach, architecture or backward-incompatible contracts, and global styles
    (`globals.css`). Tightening security or fixing a scoping leak does not count.
  - `qa-batch-check` (next to `needs-qa`): merge freely; a tester checks it in the next daily
    batch. Approved-design UX, customer-facing paths (portal pages of any module, customer accounts,
    login, checkout, onboarding), drag and drop, keyboard, focus, responsive layout or printing, more
    than 10 changed UI files, and user-visible changes triage is unsure about.
  - `needs-qa`: automatic QA (`om-auto-qa-pr`) is enough. It does not block the merge.
  - `skip-qa`: nothing user-visible to exercise.

  A reviewer, the author or a tester may add `needs-human-qa` or `qa-batch-check` by hand;
  automation never removes either. When there is no surface to exercise by hand, see the
  automated-verification exemption below.
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
  touch the QA-approval merge gate below: a PR that carries `needs-human-qa` still MUST NOT
  merge without `qa-approved`.
- `qa-approved` records that manual QA passed for a `needs-human-qa` PR (on a batch PR: that
  the batch is stable, see Daily batch QA). It is the durable proof that
  gates the merge; the `merge-queue` pipeline label is the routing state, while `qa-approved` is
  the evidence that QA actually happened. Set both when QA passes.
- `screenshots` records that UI QA visual evidence was attached to the PR (posted by
  `om-auto-qa-pr`, which first runs `om-auto-review-pr` when the PR is still unreviewed); it is
  informational only — it does not gate merge and is orthogonal to `needs-qa`/`qa-approved`.

**QA-approval merge gate (hard rule): a PR that carries `needs-human-qa` MUST NOT be merged
unless it also carries `qa-approved`, even when every other check is green.** `needs-qa` and
`qa-batch-check` do not gate the merge. A gated PR without `qa-approved` MUST NOT carry
`merge-queue`: review skills withhold it and `merge-queue-guard.yml` removes it. This is
a **label policy enforced by reviewers and the PR-automation tooling** (`om-merge-buddy`
classifies it as not-mergeable; `om-approve-merge-pr` and the auto-review/continue skills refuse
to merge it); there is no longer a dedicated `merge-gate` CI workflow, so the maintainer is
responsible for upholding it (optionally via a branch-protection rule that requires the
`qa-approved` label). `skip-qa` is the explicit opt-out: a PR with `skip-qa` does not require
`qa-approved`. Never combine `skip-qa` with `needs-qa`/`needs-human-qa`/`qa-approved`.

**Self-QA exception:** the manual QA is normally performed by the dedicated QA reviewers. When
they have no capacity to test in time, any engineer may self-QA instead — but only by
(1) checking the PR out and running it locally, (2) clicking through the affected flow, and
(3) attaching proof to the PR: a screenshot showing it working, or a written confirmation
describing what was exercised and the observed result. After that, apply BOTH `qa-approved` (so
the gate passes) and `qa-self-verified` (so it is auditable that a non-QA engineer signed off via
this exception, not the QA team). Do not apply `qa-approved` via the self-QA path without the
attached evidence. Refer to QA reviewers by role, never by GitHub handle — assignments change.

**Self-QA requires `triage` permission to finish.** Applying `qa-approved` + `qa-self-verified`
is a label write, so a contributor with `read` permission (the usual case for fork-based
contributions) can perform the testing and attach the evidence but cannot complete the exception.
For them it splits into two halves: the contributor posts the evidence comment on the PR — that
comment is the durable artifact, the labels only record it — and a maintainer applies the two
labels on the strength of it. A maintainer doing so is upholding the gate, not bypassing it, as
long as the linked evidence actually exists. Until the labels are on the PR it stays gated: an
attached evidence comment alone does not make a `needs-human-qa` PR merge-ready, and an `om-auto-*`
skill that cannot apply the labels MUST report that it stopped there rather than treat the
self-QA as complete.

`qa-failed` is a hard block: a PR carrying it MUST NOT merge until QA re-runs and it is cleared.
`do-not-merge` and `blocked` are likewise hard merge blocks. The QA-approval gate (reviewers +
PR-automation tooling) treats any of these as not-mergeable.

## Daily batch QA

Once a day `main` is cut into `stabilize/main-<date>` and opened as one PR back to `main` (the
batch). A tester runs one QA pass on that build: the smoke in `.ai/qa/batch-smoke.md` plus only
the merged PRs that need a human eye. The `om-qa-batch` skill lists them: PRs labelled
`qa-batch-check`, PRs that reached `main` with `needs-human-qa` but without `qa-approved`, and
customer-facing or visibly changed PRs with no QA evidence. QA judges quality; the day's
stabilizer owns the branch, fixes blockers with small PRs into the batch, tags it and merges it
back.

Labels on the batch PR:

- `qa-in-progress` + the tester as assignee: testing started. The batch MUST NOT be refreshed with
  newer `main` commits while it carries this label. An untouched batch may be refreshed.
- `qa-failed`: verdict **unstable**, at least one open blocker. It stays frozen until the retest.
- `qa-approved`: verdict **stable** for the tested head. The stabilizer may tag `green/<date>` and
  merge back. A new head needs a new verdict, except a merge-back conflict fix: the verdict stays
  on the green-tagged commit, and the `main` PRs the fix merges in are tested in the next batch,
  whose range starts at the previous green tag.

The verdict comment carries `QA verdict: STABLE|UNSTABLE`, `QA head: <full sha>` and the range.
The tester also posts the same verdict, with blockers when unstable, as a short message on the
team's QA channel. Retests after fixes cover only the fixed area.

Only `qaBatch.testers` plus the person running `om-qa-batch` are trusted to give a verdict or run
`--retest`. With an empty list, one tester's write action treats another tester's verdict as
untrusted and withdraws a valid `qa-approved`, so teams with more than one tester MUST set
`qaBatch.testers`.

A defect **blocks** the batch when a user cannot finish a main task: a main screen does not load
or a main path returns a server error; signing in, saving or creating a basic record fails; data
is lost, saved wrong or shown to another organization or tenant; a migration fails or the app
does not start. A blocker is an issue with `bug` + `daily-qa` + `qa-blocker` plus a comment on
the batch PR mentioning the stabilizer; open `qa-blocker` issues are listed at the start of the
next batch. Everything else (cosmetics, translations, small UX issues) is an issue with `bug` +
`daily-qa` and never blocks the batch.

When nobody tests on a given day, no new batch is cut while one is open; the open batch grows
with `main` until a tester claims it. The same pass, with an upgrade from the previous version
and migrations, runs on a release line before each release, and the release waits until that pass
is green. That pass is what covers backports,
which do not carry `needs-human-qa` over from the original PR; a backport whose cherry-pick
conflict was resolved by hand gets `needs-human-qa` from the reviewer (§ Release lines and
backports).

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

`ci-monitoring` gates nothing. It does not affect the QA-approval merge gate, the priority/risk
requirements, or any hard merge block.

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
