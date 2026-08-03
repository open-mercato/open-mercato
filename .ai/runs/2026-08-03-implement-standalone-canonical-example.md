# Run — Implement Standalone Canonical Example Module (Milestone A + policy/schema foundations)

- **Branch:** `feat/implement-standalone-canonical-example`
- **Base:** `develop`
- **Started:** 2026-08-03
- **Status:** in progress
- **Resume with:** `/om-auto-continue-pr-loop <PR#>` or by reading the Tasks table below and continuing from the first non-`done` row.

## Source Specifications

Implements (merged in PR [#4878](https://github.com/open-mercato/open-mercato/pull/4878)):

- [`.ai/specs/2026-07-31-standalone-canonical-example-module.md`](../specs/2026-07-31-standalone-canonical-example-module.md)
- [`.ai/specs/2026-08-01-standalone-agent-spec-first-routing.md`](../specs/2026-08-01-standalone-agent-spec-first-routing.md)
- [`.ai/specs/2026-08-01-standalone-harness-example-read-policy.md`](../specs/2026-08-01-standalone-harness-example-read-policy.md)
- [`.ai/specs/2026-08-01-standalone-harness-knowledge-governance.md`](../specs/2026-08-01-standalone-harness-knowledge-governance.md)

## Scope Decision (user-directed, 2026-08-03)

The canonical spec is an umbrella contract whose §"Delivery Milestones and Merge Boundaries" explicitly
states it is **not** a requirement for one implementation PR and defines four independently-mergeable
milestones. Reconnaissance decomposed the umbrella into 27 steps, ~12 of them large.

**This PR delivers Milestone A (canonical delivery) plus the policy and schema foundations that every
later milestone depends on.** Everything else is recorded in "Deferred Backlog" below with its
dependency edge, so a follow-up run can pick it up without re-deriving the plan.

Second user-directed decision: `src/modules.ts` divergence between the monorepo app and the create-app
template is implemented with a **`TEMPLATE_CONTENT_TRANSFORMS` entry** (permitted — the spec forbids
transforms only under `modules/example/**`), keeping byte-level drift detection on the rest of the file.

## Reconnaissance Corrections to the Specs

The specs' own baselines were stale at `68b544764`. Verified facts:

| Spec claim | Verified state |
|---|---|
| "20 paths differ between the two example trees" | **0.** `diff -rq` is clean; reconciliation landed in `c2a1520a3`, keeping the monorepo side (redo handler + `ensureScope` in `commands/todos.ts`, string icon tokens in `backend/**/page.meta.ts`). |
| "136 files / 746,030 bytes; 104 / 555,327 emitted" | **137 files / 747,826 bytes; 104 / 552,409** excluding `__tests__` + `__integration__`. |
| PR #4277 "open, changes-requested, conflicting" | **Merged** as #4891 = `b2d26489c`, ancestor of HEAD. The design-foundation certification gate is now satisfiable. |
| PR #4301 baseline `bf25803d7a…` | Present, ancestor of HEAD. |
| PR #4883 baseline `092e56572c…` | SHA resolvable, but **PR #4883 is still OPEN/BLOCKED** — `packages/cli/src/lib/generators/module-override-targets.ts` does not exist on `develop`. The override-target fact family is upstream-blocked. |
| 8 pinned `main` baseline assets @ `f7c941570…` | Hashes **verified** correct. |

## Tasks

| # | Step | Spec phase | Status | Commit |
|---|---|---|---|---|
| 1 | Housekeeping: remove the leaked "do not commit" date-picker demo block (and its invalid `git checkout --` recovery hint) from `example/backend/page.tsx`; correct stale spec baselines | CANON-A1.1 | done | — |
| 2 | Fix live cross-tenant leak in `example/api/tags/route.ts` (missing `tenantId` predicate) | CANON-A1 reference-quality | done | — |
| 3 | Add `template-example-module-parity.test.ts` (sorted paths + SHA-256) + `repo-wide-guards.mjs` exception | CANON-A1.2 | done | — |
| 4 | Add `example/README.md`, `references/surface-map.md`, `references/surface-inventory.json` (existing-surface rows) + mirror | CANON-A1.3 | done | — |
| 5 | `TEMPLATE_CONTENT_TRANSFORMS` entry for `src/modules.ts`; drop `empty.files.remove`; remove `example` + `design_system` from template registry | CANON-A2.1 | done | — |
| 6 | Flip preset assertions; add preset-matrix test (source-present / registration-absent / no dead nav) | CANON-A2.2 | done | — |
| 7 | Activation fixtures: `{ id: 'example', from: '@app' }` and `{ id: 'design_system', from: '@open-mercato/core' }` | CANON-A2.3 | done | — |
| 8 | Spec-first routing rule in emitted `AGENTS.md` + planning-skill handoff (resolve instruction-budget headroom first) | SPEC-P1 | done | — |
| 9 | `exampleRoots` / `installedVersionFallback` case-schema fields + evaluator + oracle fixtures | READ-P1a | done | — |
| 10 | Full validation gate + spec changelog updates | CANON-D (partial) | done | — |
| 11 | Fix the cross-request tenant bleed in `example/api/todos/route.ts`; add the `ListConfig.csv` function form; regression test; flip `api.crud-query-engine-custom-fields` | CANON-A1 reference-quality / READ-P1a | done | `c6cf75d34` |
| 12 | Clear the five remaining remediable `qa-only` rows (`cli.ts`, `enrichers.ts`, `example-event.ts`, `organizations`, `tags`/`assignees`/`notifications`); DS tokens on `widgets/components.ts` | CANON-B reference-quality | done | `7dea5f0cf` |
| 13 | Remove the universal `node_modules/@open-mercato/*/src/**` read permission from all 202 cases + checked-disposition test + doc sync | READ-P1b | done | `66998e1c7` |
| 14 | Wire the installed-source fallback reason channel into live runs (`harness.read` reason/capabilityId, trace collector, sanitized `exampleReadPolicy` result summary, 4 family-8 fixtures) | READ-P2 (partial) | done | `ce351d1aa` |
| 15 | Give the new CSV-form fixture route an indexer so `crud-indexer-config` guard passes | — | done | `105288d42` |

## Deferred Backlog (not in this PR)

Each row keeps its dependency edge so a follow-up run can start immediately.

| Deferred work | Depends on | Why deferred |
|---|---|---|
| CANON-B gap slices: encryption, search, translations, `notifications.client.ts`, `data/extensions.ts`, `extension-points.ts` | Task 4 (inventory rows) | 6 independent vertical slices, each with its own integration test. |
| CANON-B: complete optimistic locking; shared Todo form extraction | Task 4 | `beforeList` at `api/todos/route.ts` drops columns; needs its own review. |
| CANON-B: cache + rich DI; setup seeding | Task 4 | Uses DI token `'cache'` (**not** `'cacheService'` as `packages/cache/AGENTS.md` claims — Boy-Scout fix needed). |
| CANON-B: DataTable bulk action + durable outbox + scheduler + CAS-leased worker + progress | Tasks 4, 6 | Largest single runtime slice: new entity + migration + 2 workers + 14-assertion integration test. |
| CANON-B: PR #4883 reader gaps (13 prerequisites) | **Upstream PR #4883 merge** | Changes `packages/cli` generators with monorepo-wide blast radius; `module-override-targets.ts` not on develop. |
| CANON-B: AI tools/agents, specialized registries, generator plugin, page middleware, portal broadcast | PR #4883 | Fact families depend on unmerged extractor work. |
| CANON-B: registry static-readability refactor (`injection-table.ts`, `components.ts`) | — | Behavior-preserving but pinned by existing env-gating tests. |
| CANON-B: reference-quality remediation batch (~49 items) | — | Splittable per-file; the security-critical one is Task 2. |
| CANON-C: `source-link-baseline.json` + 136 fence dispositions | Task 4 | Baseline assets must be read from `f7c941570…` via `git cat-file`; current versions have drifted. |
| CANON-C: `source-link-inventory.json` generator + validator | Task 4 | No markdown-link-validation infrastructure exists anywhere in the repo — greenfield. |
| CANON-C: local reference-fact generation (`portableSourceRoot` / `sourceKind: "local-reference"`) | PR #4883 | `toPortableSourceRoot` needs a new discriminant; 4 emission points. |
| CANON-C: skill/guide link migration (8 owner families) | Task 4 | One PR per owner family. |
| CANON-C: harness case additions | Task 9 | Dedup against OMH-027/035/181/185/193; count pinned in 6 places, writable ids in 5. |
| READ-P2 **remainder**: the "generated facts render exact-file source links only" half of Phase 1 step 2, the redaction fixtures, and the oracle families beyond the eight now covered | Task 9, Task 14 | The reason-gated fallback itself and its live channel landed in Task 14. |
| GOV-P1/P2: `knowledge-change.schema.json`, validator/controller, 9 mandatory workflow steps | CANON-C source-link-inventory | Validator consumes the inventory; needs a real knowledge-contract change to exercise. |
| SPEC-P2: 6 routing cases + 2 writable ordering proofs | Task 8, Task 9 | — |

## Findings From the Reference-Quality Audit (Task 4)

The inventory audit opened every file it was asked to mark `canonical`. **7 capability rows covering
9 files failed the bar** and carry `referenceStatus: "qa-only"` + `readStatus: "qa-only"` + a
`qaOnlyReason` naming the exact defect, so the harness cannot read them until they are remediated.

The most serious finding is a **second live tenant-isolation defect**, distinct from the one fixed in
Task 2 and not yet fixed:

> `apps/mercato/src/modules/example/api/todos/route.ts` — `beforeList` writes module-scoped
> `dynamicCfKeys` / `sortFieldMapRef` from tenant- and organization-scoped `CustomFieldDef` rows, and
> `transformItem` / `sortFieldMap` read them back on *later* requests. One tenant's custom-field key
> set therefore bleeds into another tenant's projection and sort map. `listFields` is also reassigned
> after `makeCrudRoute` already captured it, so that reassignment is dead code.

This is the file the canonical spec designates as the CRUD reference target. It is deliberately **not**
fixed in this PR: the fix changes request-scoped state handling in a route with live custom-field
behavior and needs its own review and regression coverage. It is tracked as the first row of the
deferred backlog. Until then `api.crud-factory` points at `api/customer-priorities/route.ts` — a fully
clean `makeCrudRoute` with scoped ORM binding, sort map, soft delete, and cross-module cache
invalidation — which the spec's "point to a safer exact file" allowance permits.

Remaining qa-only defects: `data/enrichers.ts` (`(context.em as any).fork()` erasing a deliberately
`unknown` type), `widgets/components.ts` (raw `amber`/`blue` palette shades instead of status tokens),
`cli.ts` (`em as any` on a data-mutating ORM handle), `api/organizations/route.ts` (`any` at response
shaping, raw `Response`, raw `console.error`), `api/assignees/route.ts` + `api/notifications/route.ts`
(raw `.json().catch(...)`), `subscribers/example-event.ts` (`any` in the exported handler signature).

## Corrections to the Reconnaissance Itself

- **`packages/create-app/template/src/modules/reference_module/` is NOT a repo artifact.** Recon reported
  it as a stray shadow-module skeleton copied into every scaffold. It is untracked local working-tree
  pollution: `git ls-tree -r origin/develop` has zero entries under that path, and git does not track
  empty directories. No fix was required and none is claimed. Anyone seeing it locally can simply delete it.

## Open Decisions Carried Forward

- Whether `example_customers_sync` registration in the template registry is deleted or left inert
  (it self-disables via its `some(id === 'example')` guard).
- Whether `/blog/123` and the four `app.page.quickLinks.example*` i18n keys are pruned or retained.
- Whether the PR #4883 reader-gap work ships inside this program or as its own reviewed PR
  (recommendation: its own PR, given `packages/cli` blast radius).

## Validation

Runner: **local** (Docker unavailable in WSL).

Gate (`.ai/agentic.config.json` `validation.commands`), plus the canonical spec's sequence:

```bash
yarn template:sync
yarn build:packages
yarn generate
yarn build:packages
yarn i18n:check-sync
yarn i18n:check-usage
yarn workspace create-mercato-app test
yarn agents:check-budget
yarn typecheck
yarn test
yarn build:app
```

## Gate Results (2026-08-03, local runner)

| Command | Result |
|---|---|
| `yarn template:sync` | pass — app and template in sync |
| `yarn build:packages` | pass |
| `yarn generate` | pass |
| `yarn i18n:check-sync` | pass — 51 modules, all in sync |
| `yarn i18n:check-usage` | 21 missing keys — **all pre-existing**, in `design_system/gallery/entries/**` and `packages/ui/src/backend/schedule/ScheduleToolbar.tsx`; none of those files are in this branch's 42-file diff |
| `yarn workspace create-mercato-app test` | pass — 474 tests, 471 pass, 0 fail, 3 skipped |
| `node scripts/repo-wide-guards.mjs` | pass — 23 test files |
| `yarn agents:check-budget` | pass — no new overage; 4 chains now *smaller* than baseline |
| `yarn typecheck` | pass — 21/21 tasks |
| `yarn test` | 1 pre-existing failure: `apps/mercato/src/__tests__/storage-s3-routes.test.ts` (5 tests, `[Bootstrap] Modules not registered`). **Verified pre-existing** by checking out `origin/develop` and reproducing the identical 5 failures. Unrelated to this diff. |
| `yarn build:app` | pass |

Two environment issues surfaced mid-run and were fixed by `yarn install` + `yarn build:packages`, not
by code changes: a missing `typescript-standalone` dependency and a stale `packages/cli/dist` tree.
They accounted for the 11 create-app failures seen earlier.

**Not executed here:** `yarn test:create-app` and `yarn test:create-app:integration`. Both require
Verdaccio via Docker, which is unavailable in this WSL distro (`yarn registry:publish` fails before
reaching any new code). The activation fixtures they host were instead exercised against real
`mercato generate` output inside a staged standalone app, and the fixture engine runs on every
`yarn workspace create-mercato-app test`. The untested residue is the Verdaccio publish, the
`yarn install`, and the `yarn generate` shell wrapper.

## Known Gaps Introduced by This Change

- **Example integration specs now run against an app where the module is unregistered.** With every
  preset shipping `example` disabled, the 22 specs under `apps/mercato/src/modules/example/__integration__/`
  (and `packages/core/src/modules/design_system/__integration__/design-system-gallery.spec.ts`) execute
  against a standalone app that registers neither module. `scripts/test-create-app-integration.ts` boots
  a single ephemeral app and cannot host two mutually-exclusive module sets, so covering this needs two
  boots — an architecture change to that harness. **Not addressed here; must be resolved before those
  specs can be trusted as standalone coverage.**
- `OMH-018` has **49 bytes** of `maxInitialContextBytes` slack left. Anyone growing
  `om-module-scaffold/SKILL.md`, its `contracts.md`/`extensions.md`, or `om-system-extension/SKILL.md`
  will hit it. This, not the root instruction budget, is now the binding constraint on that skill.
- The `installedVersionFallback` schema field is implemented and fixture-covered, but the live-runner
  trace has no reason-code channel yet, so live installed reads fail closed. Wiring that channel is
  READ-P2.
- **Read-policy Phase 1 is not fully closed.** The spec's Phase 1 has three steps and step 2 *is* the
  broad-glob audit/migration, which the user scoped out. All 202 cases still carry
  `node_modules/@open-mercato/*/src/**` in their context. The schema, evaluator and fixtures landed;
  the migration did not.
- **Oracle-family coverage is partial.** The read-policy spec enumerates twelve oracle families; the
  new `agent-harness-example-read-policy.test.ts` covers seven (its own `family 1`–`family 7`
  numbering is a subset, not the spec's list). The remainder depend on PR #4883/#4301/#4277 surfaces
  that are not yet consumable.

## Handoff Log

- **2026-08-03 — session 1:** Branched off `develop` at `68b544764`. Ran a 7-agent reconnaissance
  workflow over presets, template-sync, the example module, the harness, skills, and platform APIs;
  results in the Reconnaissance Corrections table above. Scope bounded by user to Milestone A +
  policy/schema foundations. `modules.ts` divergence mechanism chosen: `TEMPLATE_CONTENT_TRANSFORMS`.
  All 10 tasks completed and the gate run recorded above. PR
  [#4897](https://github.com/open-mercato/open-mercato/pull/4897) opened as a draft on the first commit
  and updated on every push. **Next session starts at the Deferred Backlog**, top row first (the
  `api/todos/route.ts` cross-request tenant bleed).
- **2026-08-03 — session 2 (`/om-auto-continue-pr 4897`):** Resumed from the Deferred Backlog. **Upstream PR #4883 merged** at 12:09Z, so `packages/cli/src/lib/generators/module-override-targets.ts` is now on `develop` and every backlog row that named it as a blocker is unblocked (none were implemented in this session). Three rows landed: the top-priority `api/todos/route.ts` cross-request tenant bleed (`c6cf75d34`), the reference-quality remediation batch (`7dea5f0cf`), and the read-policy broad-glob migration (`66998e1c7`). Decision recorded against the backlog's first row: `api.crud-factory` **stays** on `api/customer-priorities/route.ts` because the two capability rows demonstrate different CRUD mechanisms; only `api.crud-query-engine-custom-fields` flipped. Observed once in four full `yarn workspace create-mercato-app test` runs: `agent-harness-evaluator.test.ts` → "live Codex retries one successful startup that emitted no context reads" failed with `$.durationMs is below minimum 0`, a clock artifact in the fake-runner duration measurement; it did not reproduce in the other three runs and is independent of every change in this session. **Next session starts at the remaining Deferred Backlog rows**, in order: the CANON-B gap slices, the registry static-readability refactor (which is what still holds `umes.component-replacement` at `qa-only`), CANON-C source-link work (now unblocked), READ-P2, SPEC-P2, and GOV-P1/P2.
- **2026-08-03 — session 3 (`/om-auto-continue-pr 4897`):** Re-entered on `1bf4d162b`, merged `origin/develop` again (now `21fff9068`). Landed the READ-P2 live reason-code channel (`ce351d1aa`) and a guard fix for the previous session's CSV fixture route (`105288d42`) — `crud-indexer-config.test.ts` scans test fixtures too, and `repo-wide-guards` had been run *before* that fixture was added, which is how it was missed. **Lesson recorded: run `node scripts/repo-wide-guards.mjs` after the last test file is written, not before.** Create-app suite 483 tests / 480 pass / 0 fail; repo-wide guards green.

  **In flight at the time of writing:** user asked for multi-agent orchestration over the whole remaining backlog. Background workflow `wf_e7482555-423` (`canonical-example-backlog-recon`) is running 9 read-only planners — one per backlog row group — plus a conflict-aware sequencer. Script:
  `~/.claude/projects/.../workflows/scripts/canonical-example-backlog-recon-wf_e7482555-423.js`;
  transcript dir: `~/.claude/projects/.../subagents/workflows/wf_e7482555-423`.
  If this session dies before it returns, its per-agent results are recoverable from `journal.jsonl` in that transcript dir, or re-run it with `Workflow({scriptPath, resumeFromRunId: 'wf_e7482555-423'})` — completed agents return cached results. **Nothing in that workflow writes to the repo**, so an interrupted run leaves no partial state to clean up.

  **Known contended files** any parallel implementation must serialize on: `apps/mercato/src/modules/example/references/surface-inventory.json`, `.../surface-map.md`, `packages/create-app/agentic/shared/ai/harness/cases.json`, the byte-mirrored `packages/create-app/template/src/modules/example/**` tree, and the four specs' changelogs.

  **Next session starts** from the sequencer's wave 1 (or, without it, the Deferred Backlog top-down).

  **Incident (same session), worth not repeating:** `6936451c9` was committed with `git add -A`
  while the recon workflow's agents were reading the worktree. One planner had written probe
  artifacts despite its read-only brief — `packages/cli/src/lib/generators/__tests__/zz-probe.test.ts`
  (a scratch test dumping extension-surface facts to stdout) and an
  `export { readRootObject as __probeReadRootObject }` appended to
  `packages/cli/src/lib/generators/module-extension-facts.ts` — and both were swept into that
  commit and pushed. Reverted in `e211d2e3d`; `packages/cli/` now has a zero diff against
  `origin/develop`. **Rule: never `git add -A` while background agents are running — stage explicit
  paths, and diff `--name-only` against the base before committing.**
