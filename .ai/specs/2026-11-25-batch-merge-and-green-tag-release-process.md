# Batch Merge and Green-Tag Release Process

**Date:** 2026-11-25
**Status:** Approved shape, ready for development (phased)
**Scope:** OSS repository process: CI workflows, PR labels, review/QA skills, GitHub rulesets, release-line tooling
**Flow diagram:** [Open Mercato merge, stabilize, release and backport flow](https://drop-3c71c226-a58.patzick.workers.dev/) (sections are linkable, e.g. [`#labels`](https://drop-3c71c226-a58.patzick.workers.dev/#labels), [`#implementation-plan`](https://drop-3c71c226-a58.patzick.workers.dev/#implementation-plan))
**Related:** [Phased Integration CI](2026-06-05-phased-integration-ci.md) (draft), [CI/CD Performance](implemented/2026-04-10-ci-cd-performance.md), PR #10434 and PR #10457 (open drafts)

---

## TLDR

PRs keep targeting `main`, but merge on checks sized to their risk: a 1–2 minute fast gate by default, more tests only when triage (a skill first, a human on top) adds a `ci-*` label. Once a day the stabilizer cuts `main` into `stabilize/main-<date>` (the batch), which runs the full suite and one manual QA pass. Problems are fixed forward on the batch; a green batch is tagged `green/<date>` and merged back into `main`. Every 2–3 weeks a release line is cut from a green tag instead of from `main`'s untested tip. Backports keep using the existing labels.

The plan is ordered so every safety net (daily batch, QA, label-driven scope, triage) runs before the per-PR default drops to the fast gate, which is where the CI-minute savings come from and where the risk is.

## Current vs target

| Area | Current (2026-11-25) | Target |
|---|---|---|
| PR to `main` | Scoped CI on every PR: affected-module integration tests, unit tests, build; 13–43 min. Full suite when `FULL_SUITE_PATTERN` matches or `ci-full` is set | Fast gate (changed-package typecheck, lint, related unit tests, guard, CLA) by default, 1–2 min. `ci-targeted` / `ci-area:*` / `ci-full` add tests. `FULL_SUITE_PATTERN` stays as a floor |
| Who decides test scope | Nobody; CI derives it from paths. `ci-full` only applies from the next push | Triage skill sets labels on open and each push (raise only); humans can add. CI re-runs on label change |
| Docs-only PRs | Install, build, lint and unit tests still run | Docs lane: guard, CLA, docs-specific checks only, under 1 minute; docs site built on `apps/docs` PRs |
| External PRs | Same path as core PRs | Acceptance triage (`needs-triage` → `accepted`, automerge for simple fixes, or decline) |
| Stabilization | `stabilize/main-<date>` cut by hand, sometimes 2–3 a day, squash-merged back | One batch a day with a named stabilizer, full suite + QA pass, `green/<date>` tag, merged back |
| QA | Per-PR `needs-qa` gate plus a weekly pass of `main` (`weekly-qa`) | `needs-human-qa` before merge for risky changes; one daily pass on the batch from a skill-built checklist (`daily-qa`) |
| `main` safety net | Full suite on every push to `main` | Unchanged; agent opens a stabilization PR when it goes red |
| Release cut | `release-cut.yml` cuts `release/vX.Y.x` at `main`'s tip | Cut at a chosen `green/<date>` tag; changelog split at that commit |
| Merge methods on `main` | Ruleset allows squash only | Squash stays; the green tag preserves the tested commit (see Open decisions) |

## Overview

The diagram linked above is the reference for the process. This spec turns it into implementable phases. Each step is sized to be one task or one PR. Owners:

- **Maintainers**: `.github/workflows/**`, `scripts/**` (covered by `CODEOWNERS`).
- **Skills repo**: `om-*` pipeline skills live in [open-mercato/skills](https://github.com/open-mercato/skills) and are installed into `.agents/skills/`; repo-local overrides go in `.ai/skills/<name>/`.
- **QA**: label definitions for QA, checklists, verdicts.
- **Admin**: GitHub rulesets (required checks, merge methods) and label creation where no workflow does it.

## Problem Statement

The team targets about 80 merged PRs a day. Running scoped or full integration CI on every PR costs 13–70 minutes and many runner minutes per PR, which caps merge throughput. Stabilization already happens on ad-hoc `stabilize/` branches, QA tests `main` weekly, and release lines are cut from an untested `main` tip. The process needs to: merge faster, spend full-suite and QA time once per day instead of per PR, keep `main` releasable through daily green points, and keep contributors' workflow unchanged (PRs still target `main`).

## Proposed Solution

Phases 0–6 below, plus optional follow-ups. The order is deliberate:

1. Phase 0 runs the daily batch and QA by hand, on today's tooling, so the team learns real QA time and failure rates before anything changes in CI.
2. Phase 1 records the decisions.
3. Phases 2–3 build the label-driven scope engine and the triage skills while today's default CI stays in place (no risk to `main`).
4. Phase 4 flips the default to the fast gate only after those nets work.
5. Phases 5–6 add acceptance and green-tag releases, which depend on the labels and green tags already existing.

---

### Phase 0: Daily batch by hand (process only)

**Goal.** Run one batch a day with today's tools: cut, full suite, QA pass, fix forward, tag, merge back. Learn the real QA time per batch and how often batches go red.
**Why first.** Everything later assumes a working daily batch. It needs no code: `FORCE_FULL_SUITE` already covers `stabilize/` PRs and `qa-deploy.yml` already takes any branch.
**Owner.** Maintainers (stabilizer rotation), QA.
**Size.** 2–3 days to set up, then 2 weeks of running it.

**Entry criteria.** Team agreed on the diagram. A stabilizer rotation exists.

**Steps.**
1. **Stabilizer rotation.** Publish who owns each day's batch (team calendar or pinned issue). No files.
2. **Daily cut.** The stabilizer branches `stabilize/main-<date>` from `main` and opens it as a PR to `main` (a branch without a PR runs no CI). Full suite runs through `FORCE_FULL_SUITE` in `.github/workflows/ci.yml`. No changes.
3. **QA deploy.** QA runs `qa-deploy.yml` with `branch: stabilize/main-<date>` on a free slot (`qa1`–`qa4`). No changes.
4. **Labels.** Create `daily-qa` (issue label for non-blocking batch bugs) and `qa-batch-check` (PR label: check in the next batch). QA confirms the names first. Admin or maintainer via `gh label create`.
5. **QA pass and reporting.** QA smoke-tests main flows and works a checklist picked by hand from the PRs merged since the last batch. Blockers: a comment on the batch PR that mentions the stabilizer. Other bugs: issues labelled `bug` + `daily-qa`. Verdict (stable/unstable, blocker list) on `#qa` and on the batch PR.
6. **Fix forward.** Stabilization PRs target `stabilize/main-<date>`; QA retests only the fixed area. Revert only as a last resort and as the team's call.
7. **Green tag and merge back.** When the full suite is green and QA says stable, the stabilizer tags the batch tip `green/<date>` (`git tag green/<date> <sha> && git push origin green/<date>`) and squash-merges the batch PR into `main` (the only merge method the `main` ruleset allows). The tag keeps the tested commit reachable.
8. **No-tester days.** No new batch while one is open. An untested batch with no fixes yet is recreated from `main`'s tip the next day; open blockers stay listed on the batch PR.
9. **Record metrics** (see Phase 4 metrics) in a pinned issue: QA time per batch, red batches, time to green.

**Exit criteria.** 10 batches run. QA time per batch and red-batch rate are known. QA has a draft label set and blocker definition. No CI changes yet.
**Rollback.** Stop cutting daily batches; nothing else changed.

---

### Phase 1: Spec and decisions

**Goal.** Agree on this spec, resolve the open decisions that block Phases 2–4, and settle PRs #10434 and #10457.
**Why now.** Phase 0 data informs the decisions (QA capacity, batch cadence). Phase 2 needs the scope file format and label names fixed.
**Owner.** Maintainers, QA.
**Size.** 1–2 days.

**Entry criteria.** At least one week of Phase 0 data.

**Steps.**
1. **Review and approve this spec** (PR with this file and the `.ai/specs/README.md` row).
2. **Decide the open decisions** marked "blocks Phase 2–4" below; record answers in the Changelog section.
3. **PR #10457** (fast gate for batch candidates): extract its fast-gate job definition into Phase 4 step 1; close the PR with a link to this spec.
4. **PR #10434** (fast CI for daily batch branches + separate batch branch): close; the separate batch branch is replaced by "`main` is the integration branch, the daily batch is cut from it". Carry over any reusable docs into Phase 0's runbook.
5. **Stabilizer runbook.** Add a short section to `CONTRIBUTING.md` → Stabilization CI describing Phase 0 steps 2–8.

**Exit criteria.** Spec merged. Decisions recorded. #10434 and #10457 closed or repurposed.
**Rollback.** None needed (docs only).

---

### Phase 2: CI scope engine, default unchanged

**Goal.** Make `ci-*` labels and a scope file drive what CI runs, while the default for an unlabelled PR stays today's scoped CI.
**Why now.** Labels must work, re-run on change and be enforced before triage can rely on them, and before the default can be lowered.
**Owner.** Maintainers (all files are under `CODEOWNERS`). Admin for step 7.
**Size.** 1–2 weeks, 6–7 PRs.

**Entry criteria.** Phase 1 done. Label names and area grouping decided.

**Steps.**
1. **Scope file.** Add `.github/ci-scope.json`: `levels` (`targeted`, `full`), `areas` (`commerce`, `crm`, `platform`, `integrations`, `portal`, `workflows`, `ai`, `enterprise` → module directories), `levelLabels` (`risk-high`, `security`, `backport *` → `targeted`), `docsOnly` path allow-list. Plus a JSON schema and a unit-tested resolver script `scripts/ci/resolve-ci-scope.mts` that, given changed files and labels, returns level, modules and lane. Touches: `.github/ci-scope.json`, `scripts/ci/resolve-ci-scope.mts`, its tests.
2. **Use the resolver in `prepare`.** Replace the inline `FULL_SUITE_PATTERN` / `FORCE_FULL_SUITE` logic in the `prepare` job of `ci.yml` with the resolver. Keep `FULL_SUITE_PATTERN` semantics as the floor and `stabilize/` → full. The unlabelled default remains today's scoped run. Write a one-line job summary ("level: targeted, modules: sales, catalog; reason: label ci-area:commerce"). Touches: `ci.yml`.
3. **Re-run on label change.** Add `labeled`, `unlabeled` to `pull_request.types` in `ci.yml`; skip the run early (a cheap filter job) when the changed label is not `ci-*`, `risk-high`, `security` or `backport *`. Concurrency already cancels the stale PR run. Touches: `ci.yml`.
4. **Label sync.** New workflow `.github/workflows/ci-labels-sync.yml` (push to `main` touching `ci-scope.json`, plus `workflow_dispatch`) that creates or updates every `ci-*` label from the scope file. Touches: new workflow.
5. **Unknown-label check.** In the resolver step, fail with a clear message on a `ci-*` label not in the scope file. Touches: `ci.yml`, resolver.
6. **`ci-scope` check.** A job named `ci-scope` that passes only if the run covers the PR's head SHA and its current labels (compare the event payload labels with a fresh API read at job time; fail if they differ, so the label-change run is the one that counts). Touches: `ci.yml`.
7. **Docs lane.** When every changed path matches `docsOnly`, skip install/build/tests and run only guard, CLA, `agents:check-budget` (for `AGENTS.md`/`CLAUDE.md`), and the docs site build for `apps/docs/**`. Keep the required check names reporting success (skipped jobs count as passing for rulesets). Touches: `ci.yml`.
8. **Fork behavior.** Document and keep: fork PRs keep normal scope even with `ci-full` (secrets). Touches: `CONTRIBUTING.md`.
9. **Required checks.** Admin adds `ci-scope` to the `main` ruleset's required status checks (today: `scope`, `guard`, `prepare`, `lint`, `ds-lint`, `test`, `audit-scope`, `documents-multi-instance`). Touches: GitHub ruleset `main`.

**Exit criteria.** On real PRs: adding `ci-targeted`, `ci-area:*` or `ci-full` changes the run within a minute without a push; removing a label re-runs; an unknown `ci-*` label fails; docs-only PRs finish under 1 minute; the job summary states the scope. No regression in failure detection on `main` for two weeks.
**Rollback.** Revert the `ci.yml` PRs (each step is separate). Remove `ci-scope` from required checks. Labels can stay; they are inert without the resolver.

---

### Phase 3: Triage and QA skills (shadow mode)

**Goal.** Skills set the `ci-*` level and areas, `needs-human-qa` and `qa-batch-check`, and build the daily QA checklist. Run them in shadow mode first: they comment, CI does not depend on them yet.
**Why now.** Phase 4 lowers the default to the fast gate; that is only safe once triage reliably raises risky PRs. Shadow mode measures that.
**Owner.** Skills repo (with repo-local overrides in `.ai/skills/` where the rules are repo-specific); QA for the QA label rules.
**Size.** 1–2 weeks build, 1–2 weeks shadow.

**Entry criteria.** Phase 2 merged (labels exist and drive CI). QA label set final.

**Steps.**
1. **Triage rules file.** Add `.ai/ci-triage.md` (repo-local, read by the skill): when to set `ci-targeted`, which areas map to which paths, the `needs-human-qa` list (features without an approved design, payments, lowered security, removed fields or data), the `qa-batch-check` list (new screens, UX changes, login, portal). Touches: `.ai/ci-triage.md`.
2. **Triage skill.** Either extend `om-auto-review-pr` with a triage step, or add `om-ci-triage` (decision below). It runs on PR open, ready-for-review and each push; it can only raise the level; it posts one comment with its reasoning. Touches: skills repo; `.ai/skills/tiers.json` if new.
3. **`ci-triage` check.** The skill (or a small workflow reacting to its comment/label) sets a `ci-triage` commit status: success when triage ran on the head SHA. In shadow mode it is not required. Touches: skill, optional `.github/workflows/ci-triage-status.yml`.
4. **QA checklist skill.** New skill (e.g. `om-batch-qa-checklist`, or an extension of `om-auto-qa-scenarios`): input is the batch PR, output is a comment listing PRs merged since the previous `green/*` tag that need a human eye, with click paths. Touches: skills repo.
5. **Shadow run.** For 1–2 weeks, compare triage calls with what each batch actually broke. Track "missed" (batch failure caused by a PR triage left at fast gate) and "over" (PRs raised without need).

**Exit criteria.** Triage runs on 100% of PRs. Missed rate below the threshold agreed in Phase 1 (proposal: at most 1 batch failure per week traced to an under-triaged PR). QA uses the generated checklist for every batch.
**Rollback.** Disable the skill trigger; labels stay manual.

---

### Phase 4: Fast gate as the default (the savings)

**Goal.** An unlabelled PR runs only the fast gate. Triage and `ci-scope` become required.
**Why now.** All nets are in place: the daily batch with full suite and QA (Phase 0), label-driven scope (Phase 2), triage with a measured miss rate (Phase 3), full suite on every push to `main` (exists).
**Owner.** Maintainers; admin for the ruleset.
**Size.** 2–3 days of work, then 2 weeks of watching.

**Entry criteria.** Phase 3 exit criteria met. Stabilizer rotation stable for 2+ weeks.

**Steps.**
1. **Fast gate job.** Using the job from #10457: typecheck of changed packages, lint, related unit tests, enterprise guard, CLA. Touches: `ci.yml`.
2. **Flip the default.** In `.github/ci-scope.json` set the unlabelled default to `fast`; integration jobs are skipped unless the resolver says `targeted` or `full`. Required check names keep reporting. Touches: `ci-scope.json`, `ci.yml`.
3. **Require `ci-triage`.** Admin adds `ci-triage` to the `main` ruleset. A PR that was never triaged cannot merge. Touches: GitHub ruleset `main`.
4. **Auto-fix on red `main`.** When the push run on `main` fails an integration test, trigger the fixer (e.g. `om-auto-fix-pr --ci-only` against a new `stabilize/` branch) and notify the stabilizer. Touches: new workflow `.github/workflows/main-red-autofix.yml` or a scheduled agent.
5. **Metrics dashboard.** Weekly job or issue comment with the metrics below.

**Metrics (watch for 2 weeks, then monthly).**
- Red batches per week (target: at most 2).
- Time from batch cut to green tag (target: same day on QA days).
- CI runner minutes per merged PR (baseline from Phase 0; target: at least 50% lower).
- Median PR time from approval to merge (target: under 10 minutes).
- Triage misses: batch failures traced to a PR left at fast gate (target: at most 1 per week).
- Red time on `main`: hours per week the latest push run on `main` is red.
- QA time per batch and number of untested days.

**Exit criteria.** Two weeks within targets.
**Rollback.** One-line change: set the unlabelled default in `ci-scope.json` back to `targeted` (today's behavior). Remove `ci-triage` from required checks if the skill is down.

---

### Phase 5: Acceptance for external PRs

**Goal.** Decide whether an external PR is wanted before spending review and CI on it; let review qualify simple external fixes for automerge.
**Why now.** It reuses the `ci-triage` check (Phase 3–4) and the triage skill. Doing it earlier would add a merge gate before the core flow is stable.
**Owner.** Maintainers (workflow), skills repo (skill), admin (labels).
**Size.** 3–5 days.

**Entry criteria.** Phase 4 stable.

**Steps.**
1. **Labels.** Create `needs-triage` and `accepted`. Touches: labels.
2. **Workflow.** `.github/workflows/acceptance-triage.yml` on `pull_request_target` (opened, reopened): if `author_association` is not `MEMBER`, `OWNER` or `COLLABORATOR`, add `needs-triage`. No checkout of PR code (same pattern as `partner-request-label.yml`). Touches: new workflow.
3. **Gate.** `ci-triage` is green for an external PR only when it carries `accepted` (or `automerge`). Touches: the `ci-triage` status logic from Phase 3.
4. **Acceptance skill step.** Extend the triage skill: for `needs-triage` PRs post a summary and a draft verdict (accept / needs changes / decline, with reasons: product fit, linked issue or spec, size, `packages/enterprise/` policy, CI/release files under `CODEOWNERS`, CLA). For simple, low-risk fixes it may set `automerge` (the existing automerge buddy handles the merge). Touches: skills repo.
5. **Partners.** Certified partners (already labelled `partner-request`) go first in the triage queue; whether they skip acceptance is an open decision.

**Exit criteria.** Every external PR gets a verdict comment within the agreed response time; no external PR merges without `accepted` or `automerge`.
**Rollback.** Disable the workflow; remove the `accepted` condition from `ci-triage`.

---

### Phase 6: Release lines cut from green tags

**Goal.** `release-cut` starts `release/vX.Y.x` at a chosen `green/<date>` tag instead of `main`'s tip, and the line gets a release QA pass before each release.
**Why now.** Needs green tags (Phase 0) and a working daily batch. Should land before the next minor release.
**Owner.** Maintainers (`CODEOWNERS` covers both files); QA for the checklist.
**Size.** 3–5 days.

**Entry criteria.** At least 5 `green/*` tags exist. Next minor release planned.

**Steps.**
1. **Workflow input.** Add a `green_tag` input to `.github/workflows/release-cut.yml` (default: the newest `green/*` tag); validate it exists and is reachable from `main` or from a merged `stabilize/` PR. Touches: `release-cut.yml`.
2. **Cut at a commit.** In `scripts/release-line.mts` `cut()`, accept `--at <ref>` and create the branch at that ref instead of `main`'s tip; keep the guard that the workflow runs from `main`. Touches: `scripts/release-line.mts`.
3. **Changelog split.** In `scripts/lib/release-line.mts`, split `main`'s leading `# Unreleased` section: entries whose PRs are contained in the cut ref go to the line; the rest stay on `main` for the next minor. Unit tests for the split (PR in tag, PR after tag, entry without PR number). Touches: `scripts/lib/release-line.mts` and its tests.
4. **Release QA checklist.** QA writes the release checklist (upgrade from the previous version, migrations, main flows) in `.ai/qa/release-checklist.md`; release owner records go/no-go on the release PR. Touches: `.ai/qa/release-checklist.md`.
5. **Docs.** Update `CONTRIBUTING.md` → Releasing (release cut row) to say "at a green tag". Touches: `CONTRIBUTING.md`.

**Exit criteria.** One minor release cut from a green tag with a correct changelog on both the line and `main`.
**Rollback.** Run `release-cut` without the input (falls back to `main`'s tip, today's behavior).

---

### Later, optional

1. **Automatic batch.** A scheduled workflow cuts the daily batch and opens its PR; refreshes an untested batch with no fixes to `main`'s tip. Touches: new workflow. Owner: maintainers.
2. **Full suite on `main`: per push or nightly.** Decide with Phase 4 metrics; a nightly run frees runners. Touches: `ci.yml`. Owner: maintainers.
3. **npm snapshot per green tag.** In addition to today's per-push `develop` snapshot. Touches: `snapshot.yml`. Owner: maintainers.
4. **Retire `weekly-qa`.** Once `daily-qa` is used for 4 weeks. Owner: QA.
5. **Better automatic module detection.** Follow events, subscribers and extensions when selecting targeted modules. Touches: resolver. Owner: maintainers.
6. **Backports wait for a green batch.** Turn the team rule into a check on `release/v*` PRs. Touches: `backport.yml` or a new check. Owner: maintainers.

---

## Architecture

Contracts this plan introduces or changes (no application code, data model or API changes):

| Surface | Kind | Change |
|---|---|---|
| `.github/ci-scope.json` | New config | Levels, areas, level-implying labels, docs-only paths |
| `scripts/ci/resolve-ci-scope.mts` | New script | Pure function: changed files + labels → level, modules, lane |
| `ci.yml` `prepare` job | Changed | Uses the resolver; triggers on `labeled`/`unlabeled`; new jobs `ci-scope`, fast gate, docs lane |
| `ci-scope`, `ci-triage` | New required checks | Added to the `main` ruleset in Phases 2 and 4 |
| Labels | New | `ci-targeted`, `ci-area:*` (8), `qa-batch-check`, `daily-qa`, `needs-triage`, `accepted` |
| Labels | New meaning | `risk-high`, `security`, `backport release/vX.Y.x` imply `ci-targeted` |
| Tags | New | `green/<YYYY-MM-DD>` on the batch tip |
| `release-cut.yml` | Changed | `green_tag` input |
| `scripts/release-line.mts`, `scripts/lib/release-line.mts` | Changed | `cut --at <ref>`; changelog split by contained PRs |

## Data Models

None. No database or entity changes.

## API Contracts

None. No HTTP API changes. The contract surfaces are CI check names, labels and workflow inputs listed above. Existing required check names (`scope`, `guard`, `prepare`, `lint`, `ds-lint`, `test`, `audit-scope`, `documents-multi-instance`) keep reporting so the `main` ruleset keeps working.

## Open decisions

Blocks Phase 2–4:
- Area grouping for `ci-area:*` (sketch: 8 areas in the diagram's labels section).
- Triage: extend `om-auto-review-pr` or add `om-ci-triage`; may it raise the level on later pushes without asking.
- Triage miss threshold for leaving shadow mode.
- Labels that imply `ci-targeted` (proposed: `risk-high`, `security`, `backport …`).

Other:
- **PR #10434 and #10457.** Proposed: close #10434 (its separate batch branch is replaced by cutting from `main`); repurpose the fast-gate job of #10457 in Phase 4 step 1, then close it.
- **Merge back: squash or merge commit.** The `main` ruleset allows squash only. Proposed: keep squash; `green/<date>` tags keep tested commits reachable and release cuts use the tag. Alternative: admin enables merge commits on `main` for batch PRs only by convention.
- Who answers external PRs and how fast; whether certified partners skip acceptance.
- Stabilizer rotation and the daily cut time (judgement call at first).
- Who owns the release QA checklist and the go/no-go.
- Whether normal backports wait for a green batch.
- Full suite on every push to `main` vs nightly.
- npm snapshot per green tag.

## Risks & Impact Review

| Risk | Severity | Area | Mitigation | Residual |
|---|---|---|---|---|
| Fast gate lets an integration break into `main`; it stays up to a day | Medium | All modules | Phases 0–3 before Phase 4; triage raises risky PRs; full suite on every `main` push; auto-fix PR; no release from `main` | Accepted by the team: `main` can be red for up to a day |
| Triage skill under-scores PRs | Medium | CI | Shadow mode with a miss threshold; `FULL_SUITE_PATTERN` floor; raise-only | Some misses surface in the batch |
| Label-change runs flood runners | Low | CI cost | Early filter job ignores non-scope labels; concurrency cancels stale PR runs | Small |
| Required check names disappear when jobs are skipped | High | Merging | Keep job names; skipped jobs report success; verify on a test PR before changing rulesets | Low |
| No tester on some days | Medium | QA | Batch rolls over; blockers stay listed; green tag waits | Releases may wait a day |
| Squash merge-back drops the green commit from `main` history | Low | Bisect, releases | Tags keep commits; release cut uses the tag | Low |
| Changelog split misattributes entries | Medium | Release notes | Unit tests; dry run of `release-cut` | Low |
| Fork PRs cannot run `ci-full` | Low | External PRs | Maintainer re-pushes to a same-repo branch when needed | Low |

## Final Compliance Report

- Spec location and name follow `.ai/specs/AGENTS.md` (OSS, `{date}-{title}.md`).
- No application code, data model, API, event, ACL or DI changes. Backward-compatibility surfaces touched: CI check names and labels only; existing required check names are preserved.
- `CODEOWNERS`-covered files (`.github/workflows/**`, `scripts/release-line.mts`, `scripts/lib/release-line.mts`) are owned by maintainers in every phase.
- Ruleset changes (required checks, merge methods) are admin actions and listed explicitly.
- Integration tests: not applicable to application paths; CI changes are verified by unit tests of the resolver and the changelog split, plus observed runs on real PRs (exit criteria per phase).

## Changelog

- 2026-11-25: Initial spec from the approved flow diagram and team discussion (QA feedback, acceptance triage, label set). Found that the `main` ruleset allows squash merges only; plan adapted to squash merge-back with green tags.
