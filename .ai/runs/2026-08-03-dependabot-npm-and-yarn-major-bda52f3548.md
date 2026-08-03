# Execution plan — port PR #4896 dependency upgrades to `develop` (adopted from PR #4911)

**Origin:** adopted — reconstructed by `om-auto-continue-pr` on 2026-08-03 because PR #4911 carried no execution plan.
**PR:** #4911 · **Branch:** `dependabot/npm_and_yarn/major-bda52f3548` · **Base:** `develop`
**Author:** @pkarw — this plan interprets the requested port and the PR's review feedback; correct it by editing this file or commenting on the PR.

## 🎯 Goal

Land the compatible parts of PR #4896 on `develop`, with the workspace's BullMQ contracts aligned, runtime compatibility verified, and the superseded `main` PR closed and cross-linked.

## Scope

- Preserve the already-ported `@testing-library/jest-dom` 7, `better-sqlite3` 13, and BullMQ 6 dependency updates.
- Align the `@open-mercato/queue` and `@open-mercato/scheduler` peer declarations with the BullMQ version used by the app while retaining BullMQ 5 compatibility.
- Verify the dynamically imported BullMQ runtime paths against a real Redis instance, including queue/worker processing and scheduler synchronization.
- Correct PR #4911's title and description so they describe the three upgrades actually in its diff and explain the compatibility evidence.

## Non-goals

- Do not port the ESLint 10 upgrade from PR #4896; the current ESLint plugin ecosystem on `develop` remains on ESLint 9.
- Do not drop BullMQ 5 support from published workspace packages.
- Do not change queue semantics, scheduler behavior, database schemas, public APIs, or unrelated dependencies.

## Evidence

| Conclusion | Drawn from | Confidence |
|---|---|---|
| PR #4911 is the existing replacement for PR #4896 on `develop`. | PR #4896 closure comment, PR #4911 base/head refs, and both diffs. | high |
| The actual port contains three upgrades and excludes ESLint 10. | PR #4911 diff and root/app package manifests. | high |
| BullMQ 6 does not satisfy the workspace's current `^5.0.0` peer ranges. | `packages/queue/package.json`, `packages/scheduler/package.json`, and the changes-requested review. | high |
| Runtime verification is needed because queue and scheduler load BullMQ dynamically behind local structural types. | `packages/queue/src/pending-probe.ts`, the async strategy, `bullmqSchedulerService.ts`, and the changes-requested review. | high |
| There is no dependency-upgrade spec governing this port. | Search of `.ai/specs/` and `.ai/specs/enterprise/`. | high |

## Assumptions

- Widening the peer range to `^5.0.0 || ^6.0.0` is the most reversible compatibility choice because it accepts the new runtime without breaking existing BullMQ 5 consumers.
- A disposable local Redis smoke run is sufficient runtime evidence for this dependency-only port when paired with the existing repository tests and the full validation gate.
- The existing ready state of this adopted PR belongs to its author and will not be demoted to draft during the resume.

## Risks

- BullMQ 6 is a production queue-backend major; dynamic imports reduce compile-time coverage, so a real Redis smoke run is mandatory before completion.
- `better-sqlite3` 13 is a native-module major; the full build/test gate must prove the supported Node environment can install and load it.
- Dependency and lockfile changes span multiple packages, so the PR remains `risk-high` and requires the existing QA gate.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Already landed on this PR (reconstructed)

- [x] 1.1 Port the compatible dependency majors to `develop` and resolve branch conflicts — 4da0f5b10

### Phase 2: Align and prove BullMQ compatibility

- [x] 2.1 Widen the queue and scheduler BullMQ peer ranges to accept versions 5 and 6, then refresh the lockfile — 485fad015
- [ ] 2.2 Exercise BullMQ 6 queue, worker, and scheduler paths against real Redis and add regression coverage if a repository test gap is exposed

### Phase 3: Correct reviewer-facing metadata

- [ ] 3.1 Update PR #4911's title and description to match the three actual upgrades and document the compatibility assessment

### Phase 4: Validate and finalize

- [ ] 4.1 Run the configured validation gate and authoritative autofix review, then normalize the PR for review
