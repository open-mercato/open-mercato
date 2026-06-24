# Phased Integration CI

**Date:** 2026-06-05
**Status:** Draft - not ready to implement
**Scope:** OSS CI workflow, integration-test discovery, standalone parity
**Issue:** [#2588](https://github.com/open-mercato/open-mercato/issues/2588)

---

## TLDR

Keep the current developer habit intact: every PR still gets automatic CI with no new commands, labels, or manual steps required. Add a fail-closed phased integration model so expensive regression suites can move out of the default affected-PR path while remaining easy to run with a single label and mandatory before release.

The model:

| Phase | Trigger | Coverage | Required before merge? |
|---|---|---|---|
| `baseline` | Every PR, including forks | Current static gates + affected integration specs that are not explicitly marked extended | Yes |
| `extended` | Non-fork PR with `extended-integration` label, or manual workflow input | Baseline plus tagged expensive suites: undo, broad CrudForm, optimistic-lock matrix, custom-field matrix, queue/realtime, long request suites | Only when requested or required by policy |
| `full` | Push to `develop`/`main`, shared-path PRs, and every PR targeting `main` | All monorepo integration specs, sharded, with coverage | Yes for release PRs and protected branch pushes |
| `standalone-sentinel` | Standalone-impact paths or `extended-integration` label on a non-fork PR | Minimal create-app installed-package smoke coverage | Required for standalone-impact PRs |
| `standalone-full` | Develop snapshot/release pipeline, every release PR to `main`, and PRs explicitly labeled `publish-npm-snapshot` | Full standalone app integration against published/snapshot packages | Yes before release and opt-in npm snapshot previews |

The critical safety rule: unknown paths, unknown metadata, fork restrictions, or manifest mismatches always fall back to current/full behavior. This spec extends the implemented CI performance work in [`.ai/specs/implemented/2026-04-10-ci-cd-performance.md`](implemented/2026-04-10-ci-cd-performance.md) and the label workflow in [`.ai/specs/implemented/2026-04-13-pr-label-workflow.md`](implemented/2026-04-13-pr-label-workflow.md).

---

## Problem Statement

The current CI already made major improvements: affected-module integration selection, sharded full runs, app-build artifact sharing, and docs/CI-only skips. But integration coverage keeps growing. There are now broad regression families that are valuable but not equally valuable on every PR push:

- undo/redo integration tests for all undoable commands,
- broad CrudForm persistence matrices,
- optimistic-lock UI/API matrix tests,
- custom-field multi-edit and array persistence tests,
- long request and queue/realtime suites,
- standalone create-app parity tests.

Running all of these on every affected PR defeats the purpose of affected selection. Not running them before release is unsafe. The workflow needs an explicit middle layer: cheap by default, easy to extend, label-triggered for maintainers, and mandatory on release paths.

---

## Non-Negotiable Constraints

1. **Do not challenge current developer habits.** Opening a PR and pushing commits must keep working. Developers should not need to learn a new command or remember a new label for normal PRs.
2. **Release PRs to `main` must run all suites automatically.** A release branch cannot rely on a human remembering to add `extended-integration`.
3. **Fork PRs must remain safe.** Do not run privileged npm snapshot/standalone publishing or non-fork-only paths for untrusted forks. If full release evidence is needed for a fork-originated change, a maintainer must replay it from a trusted branch.
4. **Fail closed.** If a path classifier, metadata parser, label expression, or prebuilt manifest cannot decide safely, run the broader phase.
5. **No silent coverage drops.** Existing specs with no phase metadata continue to run in `baseline` until intentionally reclassified.
6. **Standalone parity remains protected.** The cheap sentinel can speed PRs, but `standalone-full` remains required before release.

---

## Proposed Solution

### 1. Integration Phase Environment Contract

Introduce a small environment contract consumed by the Playwright config and CLI:

| Env var | Values | Purpose |
|---|---|---|
| `OM_INTEGRATION_PHASE` | `baseline`, `extended`, `full`, `standalone-sentinel`, `standalone-full` | Primary suite breadth selector |
| `OM_INTEGRATION_GROUPS` | comma-separated group ids | Optional inclusion list for future targeted runs |
| `OM_INTEGRATION_MODULES` | existing comma-separated module ids | Existing affected-module selector; unchanged |
| `OM_INTEGRATION_FORCE_FULL` | `1` / unset | Escape hatch; CI sets it for release PRs and fail-closed paths |

Backward compatibility:

- If `OM_INTEGRATION_PHASE` is unset, behave exactly as today.
- If a spec has no phase metadata, treat it as `baseline`.
- If metadata is malformed, include the spec and print a warning.

### 2. Integration Metadata Extension

Extend `meta.ts` / per-test metadata with optional fields:

```ts
export const integrationMeta = {
  phase: 'extended',
  groups: ['undo', 'crud-form'],
  runtime: 'ui',
  standalone: 'sentinel',
} as const
```

Fields:

| Field | Values | Default | Meaning |
|---|---|---|---|
| `phase` | `baseline`, `extended`, `full` | `baseline` | Earliest monorepo phase where this spec should run |
| `groups` | string[] | `[]` | Semantic tags for explicit inclusion (`undo`, `crud-form`, `lock`, `custom-fields`, `queue`, `realtime`, `long-request`) |
| `runtime` | `api`, `ui`, `queue`, `realtime`, `standalone` | inferred/unknown | Future parallelization and reporting hint only |
| `standalone` | `none`, `sentinel`, `full` | `none` | Whether the spec participates in standalone lanes |

Initial tagging candidates:

| Group | Examples |
|---|---|
| `undo` | `TC-UNDO-*`, sales address undo, scheduler job undo |
| `crud-form` | `TC-*-CRUDFORM-*` |
| `lock` | broad `TC-LOCK-OSS-*` optimistic-lock UI/API matrix |
| `custom-fields` | `TC-*-CF-MULTI-EDIT-*`, custom-field undo |
| `long-request` | broad sales document, import, sync, queue drain, worker/realtime specs |
| `standalone` | `TC-CLI-001-agentic-init`, create-app installed-package smoke |

Do not bulk-move all existing tests into `extended` in one PR. Start with the clearly expensive regression families and prove baseline still catches module-level breakage.

### 3. Automatic Phase Selection

CI computes one `integration_phase` in `prepare` and passes it to downstream jobs.

Rules, ordered from broadest to narrowest:

| Rule | Phase |
|---|---|
| `github.event_name == 'push'` and branch is `develop` or `main` | `full` |
| `pull_request.base.ref == 'main'` | `full` + `standalone-full` evidence required |
| changed path matches shared/full-suite patterns and impact graph cannot narrow it safely | `full` |
| non-fork PR has `extended-integration` label | `extended` |
| changed path matches standalone-impact patterns | `baseline` + `standalone-sentinel` |
| normal PR | `baseline` |
| docs/CI-only PR with no runtime impact | current skip behavior |

GitHub label detection is possible in Actions with:

```yaml
contains(github.event.pull_request.labels.*.name, 'extended-integration')
```

Add `pull_request` activity types for `labeled` and `unlabeled` so adding or removing the label automatically reruns CI:

```yaml
on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review, labeled, unlabeled]
```

This preserves habits: developers keep pushing normally. Maintainers who want more coverage add one label.

### 4. Label Contract

Add one additive CI meta label:

| Label | Type | Meaning |
|---|---|---|
| `extended-integration` | Meta | Run the extended integration phase for a trusted non-fork PR |

This label is not a pipeline state and does not interact with `review`, `qa`, `merge-queue`, `needs-qa`, or `skip-qa`.

Do not overload `needs-qa` initially. It already means manual QA. A future policy may choose to auto-run `extended` for `needs-qa`, but this spec deliberately avoids changing that habit in the first implementation.

### 5. Standalone Coverage Model

Standalone coverage gets two lanes:

| Lane | Trigger | Scope |
|---|---|---|
| `standalone-sentinel` | non-fork PR touching standalone-impact paths, or `extended-integration` label with standalone-impact paths | create-app scaffold/install/generate/initialize/login, one CRUD API, one backend UI load, queue helper path, enterprise-enabled module check |
| `standalone-full` | develop snapshot pipeline, every release PR to `main`, and PRs explicitly labeled `publish-npm-snapshot` | current full standalone integration, ideally using published snapshot package versions |

Standalone-impact paths:

- `packages/create-app/**`
- `packages/cli/src/lib/resolver.ts`
- `packages/cli/src/lib/testing/**`
- `packages/cli/src/lib/generators/**`
- package `exports` / `package.json` files for public packages
- `packages/create-app/template/**`
- root bootstrap files consumed by standalone apps

Fork rule:

- Fork PRs may run baseline monorepo integration.
- Fork PRs do not run privileged npm snapshot publishing or trusted standalone flows.
- If a fork PR targets `main` or changes standalone-impact paths, merging requires a maintainer replay from a trusted branch with full evidence.

---

## Architecture

### Workflow Outputs

`prepare` should emit:

| Output | Example | Consumer |
|---|---|---|
| `skip_integration` | `true` / `false` | `ephemeral-integration`, `docker-build` |
| `affected_modules` | `customers,sales` | Playwright config |
| `integration_phase` | `baseline` / `extended` / `full` | Playwright config |
| `standalone_phase` | `none` / `sentinel` / `full` | standalone job |
| `shard_matrix` | current dynamic matrix | integration job |
| `phase_reason` | `label:extended-integration` | step summary/debugging |

The step summary must print the phase and reason so maintainers can verify why CI chose a given breadth.

### Playwright Filtering

Filtering is a conjunction of module and phase:

1. Discover all specs as today.
2. Apply required module/env filtering as today.
3. Apply `OM_INTEGRATION_MODULES` affected filtering as today, unless phase is `full`.
4. Apply phase filtering:
   - `baseline`: include specs with no metadata or `phase: baseline`.
   - `extended`: include baseline + `phase: extended`.
   - `full`: include everything.
5. If the final list is empty for a runtime-impact PR, fail closed to the current no-tests sentinel only when `skip_integration=true`; otherwise warn and run full for the affected modules.

### Coverage

Keep coverage mandatory for `full` runs. For `baseline` and `extended`, implementation may choose non-coverage execution first if push/develop full coverage remains green. This is Variant B from issue #2588 and must be treated as a separate switch.

### Prebuilt App Artifact Safety

Variant A from #2588 remains the highest-value implementation dependency. Phased suites should still use the prepared build artifact, but only through a manifest:

- source fingerprint,
- generated checksum,
- build-shaping env fingerprint,
- required artifact list,
- app build path and `BUILD_ID`.

If the manifest is missing or mismatched, rebuild as today.

---

## Phasing

### Phase 1 - Documentation and CI Decision Contract

- [ ] Add this spec and `.github/CI-INTEGRATION-PHASES.md`.
- [ ] Add `extended-integration` to label documentation.
- [ ] Update issue #2588 with this spec link.
- [ ] No workflow behavior changes yet.

### Phase 2 - Metadata Parser, No Behavior Change

- [ ] Extend `integration-discovery.ts` metadata parsing for `phase`, `groups`, `runtime`, `standalone`.
- [ ] Add unit tests proving missing metadata defaults to baseline and malformed metadata includes the spec.
- [ ] Keep CI unset for `OM_INTEGRATION_PHASE`, so behavior remains current.

### Phase 3 - CI Phase Outputs, Still Conservative

- [ ] Compute `integration_phase`, `standalone_phase`, and `phase_reason` in `prepare`.
- [ ] Add label-triggered reruns for `labeled`/`unlabeled`.
- [ ] Pass env vars to integration jobs.
- [ ] Leave all existing specs effectively baseline until explicit metadata is added.

### Phase 4 - First Extended Groups

- [ ] Mark selected expensive families as `extended`: undo, broad CrudForm, custom-field multi-edit, long request/queue suites.
- [ ] Validate a normal affected PR still runs baseline specs automatically.
- [ ] Validate a non-fork PR with `extended-integration` runs baseline + extended.
- [ ] Validate fork PR with the label does not run trusted-only standalone lanes.

### Phase 5 - Standalone Sentinel

- [ ] Add `@standalone-smoke` / metadata-backed sentinel tests.
- [ ] Trigger sentinel automatically on standalone-impact paths for non-fork PRs.
- [ ] Keep full standalone coverage in snapshot/develop and release PRs.

### Phase 6 - Full Release Enforcement

- [ ] Ensure PRs targeting `main` run `full` and require standalone-full evidence before merge.
- [ ] Document maintainer replay procedure for fork-originated release fixes.
- [ ] Add a visible GitHub step summary showing `release gate: full + standalone-full`.

---

## API Contracts

No application API or database schema changes.

CI/test-runner contracts are additive:

- optional metadata fields in integration `meta.ts`,
- optional env vars listed above,
- one optional GitHub label.

---

## Risks & Impact Review

| Risk | Severity | Affected area | Mitigation | Residual risk |
|---|---:|---|---|---|
| A regression suite is incorrectly marked `extended` and skipped on normal PRs | High | CI correctness | Start with small tagged set; release/main full runs mandatory; develop push full runs remain | Medium |
| Developers forget to add `extended-integration` | Low | Developer workflow | They do not need to for normal PRs; release/main and shared-path full runs are automatic | Low |
| Maintainer expects `needs-qa` to trigger extended integration | Medium | PR process | Do not overload `needs-qa`; document `extended-integration` separately | Low |
| Fork PR attempts to trigger trusted standalone path | High | Secrets/supply chain | Guard with `github.event.pull_request.head.repo.full_name == github.repository`; require maintainer replay | Low |
| Release PR misses full standalone evidence | Critical | Release safety | Base branch `main` automatically selects full + standalone-full; branch protection should require the check | Low |
| Phase metadata parser misses malformed metadata | Medium | Test selection | Malformed metadata includes the spec and warns | Low |

---

## Final Compliance Report

| Check | Result |
|---|---|
| Preserves current PR habits | Pass - default PR path remains automatic |
| Release PRs to `main` run all suites | Pass - explicit automatic rule |
| Fork safety | Pass - trusted lanes gated to same-repo PRs |
| Backward compatibility | Pass - unset env and missing metadata preserve current behavior |
| Standalone parity | Pass - sentinel for PR speed, full before release |
| Issue linkage | Pass - linked to #2588 |

---

## Changelog

- **2026-06-05** - Initial draft defining phased integration CI, `extended-integration` label semantics, release/main full-suite enforcement, and standalone sentinel/full split.
