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
| 16 | **W0** truth-up: unblock PR #4883 in both specs, correct OMH-018 slack 49→3 bytes, record the 12-wave plan | W0 | done | `e0806cc5b` |
| 17 | Record the four maintainer decisions (D1-D4) binding the remaining waves | W0 | done | `d75357669` |
| 18 | **Wave 2 C2** — generated facts render exact-file source links only | READ-P1b (step 2 remainder) | done | `8c66c9318` |
| 19 | **Wave 2 C1** — component-override reader defects (props→propsTransform, function-valued props, ComponentReplacementHandles) + fail-closed test | CANON-B / 4883 readers | done | `b4aad8c3e`, `a1c0f7d05` |
| 20 | **Wave 2 F1** — cache DI token/method doc correction + drift guard | CANON-B cache | done | (merge) |
| 21 | **Wave 2 F2** — read-policy redaction/immutability/ledger fixtures + the fix that makes redaction actually tested | READ-P2 | done | `0d9b84b16` |
| 22 | **Wave 3 E1** — optimistic locking on the Todo surface + shared form leaf + workspace scan reaches `apps/` | CANON-B optimistic locking | done | `cb5546797` |
| 23 | **Wave 3 H1** — GOV-P1 knowledge-change schema, classifier, nine workflow steps | GOV-P1 | done | `8b887f7f7` |
| 24 | **Wave 3 C1b** — injection-table slot normalization + two dead bindings removed + budget cap raised | CANON-B / 4883 readers | done | `0fe58373b` |
| 25 | **Wave 4 C3** — local-reference fact emission (`portableSourceRoot`, `sourceKind: "local-reference"`, reference bundle) | CANON-C local facts | done | (merge) |
| 26 | **Wave 4 H2** — SPEC-P2 oracle plumbing (`specRouting`, `expectedSpecRouting`, `routing.spec-decision`) | SPEC-P2 (plumbing) | done | (merge) |
| 27 | **Wave 4 E2** — translations / extension-points / notifications.client + the false-binding-claim fix | CANON-B gaps | done | `1bc2ce509` |
| 28 | Close the `withScopedApiRequestHeaders` coverage loophole in the optimistic-lock workspace scan | CANON-B follow-up | done | `7865c6bc1` |
| 29 | **Wave 5 E3** — both example registries statically readable (extractor 0 → 26/3); injection flag retired + dead refs cleaned | CANON-B registry readability | done | `34e349823` |
| 30 | **Wave 5 H3** — SPEC-P2 routing cases OMH-204..208 (5 of 6 rows) | SPEC-P2 | done | `a8c06457a` |
| 31 | Gate cross-module example injection widgets on their host module (`requiredModules`) | CANON-B / D2 follow-up | done | `8cd970087` |
| 32 | **Wave 6 H4** — visible exact-file example links across 5 owner families + measured budget raises | CANON-C link migration | done | `2e9fd74cb` |
| 33 | **Wave 6 E4** (retry) — encrypted `notes` column + migration + `encryption.ts` + `search.ts`, reworked onto the platform search path | CANON-B encryption/search | done | `f050e659a` |
| 34 | Measure harness runner duration on a monotonic clock (kills the `durationMs < 0` flake) | flake root-cause | done | `4c72bdabc` |
| 35 | **Wave 7 E5** — tenant-scoped cache + first real DI registration + all three setup hooks | CANON-B cache/DI/seeding | done | `0d130e01d` |
| 36 | **Wave 7 H5** — OMH-209..212 declare `exampleRoots`; the read policy is reachable at last | READ-P1/P2 reachability | done | `75d02a6ff` |
| 37 | **Wave 7 C4** — source-link baseline + topics registry + validator (D4) | CANON-C baseline | done | `904d9cf4d` |
| 38 | **Wave 8 H6** — SPEC-P2 writable proofs OMH-213/214 + the oracle-runner guard generalized | SPEC-P2 | done | `8d3a199ca` |
| 39 | **Wave 8 E6** — ai-tools/ai-agents/page-middleware/portal-broadcast + 2 vacuous tests fixed | CANON-B fact families | done | `fef7fc4b1` |
| 40 | Resolve a DI token declared as a computed property key (silent-zero fix) | CANON-B / reader | done | `00cba7f17` |
| 41 | **Wave 9 C6** — fix the `search` silent zero + add the missing diagnostic (0 → 6 ids) | CANON-B / reader | done | (merge) |
| 42 | **Wave 9 E7 (PARTIAL)** — durable Todo bulk-complete: outbox, CAS worker, progress route, bulk widget | CANON-B bulk/progress | partial | `d5fa51253` |
| 43 | **Wave 9 H7** — GOV-P2 controller-owned base/head evidence contract | GOV-P2 | done | `e8eb259b0` |

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
- `OMH-018` has **3 bytes** of `maxInitialContextBytes` slack left (measured 2026-08-03 session 3: the five initial-context files total 40,957 of 40,960 — `AGENTS.md.template` 10,987 + `contracts.md` 8,357 + `om-module-scaffold/SKILL.md` 4,557 + `extensions.md` 12,305 + `om-system-extension/SKILL.md` 4,751; `.ai/guides/modules/**` is excluded from the initial budget by `isInitialContextPath`). The earlier "49 bytes" figure was wrong. Anyone growing
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

## Sequenced Wave Plan (from recon workflow `wf_e7482555-423`, 2026-08-03)

Nine parallel planners plus a conflict-aware sequencer decomposed the whole remaining backlog.
Full per-slice plans (files, tests, contract surfaces, conflict sets) are in that workflow's
`journal.jsonl`. Summary of the execution order:

| Wave | Parallel-safe | Slices |
|---|---|---|
| 1 | no | **W0** truth-up + program conventions (spec/run corrections, per-lane OMH id reservations) |
| 2 | yes | **C1** packages/cli reader fixes (MERGED: registry-static-readability R1 + 4883 reader gaps steps 1-4) · **C2** exact-file fact links · **F1** cache DI-token doc fix · **F2** READ-P2 redaction fixtures |
| 3 | yes | **E1** optimistic locking + shared Todo form · **H1** GOV-P1 |
| 4 | yes | **E2** translations/extension-points/notifications.client · **H2** SPEC-P2 evaluator plumbing · **C3** local-reference fact emission |
| 5 | yes | **E3** registry static-readability (example half) · **H3** SPEC-P2 six routing cases |
| 6 | yes | **E4** encryption + search · **H4** CANON-C link migration (budget rebalance first) |
| 7 | yes | **E5** cache/DI/seeding · **H5** CANON-C harness cases · **C4** source-link baseline |
| 8 | yes | **E6** remaining fact families · **H6** SPEC-P2 writable proofs |
| 9 | yes | **E7** bulk action + outbox + scheduler + progress · **H7** GOV-P2 |
| 10 | yes | **C5** source-link inventory generator · **H8** harness source-selection assertions |
| 11 | no | **E8** entity extensions (needs a `packages/shared` query-engine PR first) |
| 12 | — | Blocked backlog: read-policy oracle families 4/9/10/11/12, GOV-P1 source-link branch, CANON-C packed-artifact work |

**Hard sequencing findings:**

- **C1 must ship as ONE PR.** Two planners independently planned edits to
  `packages/cli/src/lib/generators/module-extension-facts.ts` with overlapping but *different*
  defect lists (propsTransform/staticObject/CallExpression/`Array.isArray` vs payload-collapse
  and unknown-framework-mode). Shipped separately each silently undoes half the other's fix.
  C1 is also a hard prerequisite for E3 and E6 — the extractor reads **zero** entries from both
  example registries today, so "made it statically readable" is unverifiable without it.
- **Two program-level cautions to state in every PR body:** (1) no generated artifact contains
  app-local example facts today (both `build.mjs` callers feed `extractAllModuleFacts` from
  `discoverPackageModuleSources` only), so until C3 lands a new example fact is provable only by
  a direct-extractor unit test; (2) zero of the 203 shipped cases declare `exampleRoots`, so new
  capability rows are inert for the live harness until wave 7 and must not be reported as harness
  coverage.
- **11 decisions need a maintainer** before their slices can start. They are listed in the
  workflow result; the biggest are entity-extension routing (E8), injection-table optionality (E3),
  the bulk-action widget shape (E7), the CANON-C baseline/inventory circular dependency, and the
  SPEC-P2 oracle carrier.

## Maintainer Decisions (2026-08-03, session 3)

Answered by the maintainer against the recon workflow's decision list. These are binding for the
remaining waves; a slice that contradicts one must re-open the decision rather than diverge.

| # | Decision | Chosen | Consequence |
|---|---|---|---|
| D1 | Entity extensions (E8) | **Add optional `table?: string` to `EntityExtension`** and prefer it at `packages/shared/src/lib/query/engine.ts:926` | Ships as its own `packages/shared` PR with query-engine unit tests BEFORE the example's `data/extensions.ts`. ADDITIVE to a STABLE type. Fixes the naive-pluralizer bug (`example_customer_prioritys` vs `example_customer_priorities`) for every module, not just the example. Then `api/todos/route.ts` opts into `includeExtensions`. |
| D2 | Registry static-readability gate (E3) | **Always-on entries + pass-through wrappers** | Cross-module injection entries gated only by `metadata.requiredModules` (already enforced at `injection-loader.ts:466-471`); the two checkout component wrappers register unconditionally and return `Original` untouched when the flag is off, so rendered DOM and `TC-CHKT-031`'s `data-testid` hooks stay byte-identical. Retires `NEXT_PUBLIC_OM_EXAMPLE_INJECTION_WIDGETS_ENABLED` — **needs an explicit BC waiver + UPGRADE_NOTES.md entry**, and the env var must also be dropped from both `.env.example` files. Two permanently-registered inert overrides will be visible in the UMES DevTool; that is accepted. |
| D3 | DataTable bulk action shape (E7) | **Data-only `widget.ts` + `readApiResultOrThrow`; amend the spec** | Matches the existing `customer-priority-bulk-actions` precedent. No `packages/ui` contract change. The canonical spec's `widget.client.tsx` / `useGuardedMutation` wording is corrected to reality as part of E7. |
| D4 | CANON-C circular dependency | **Land a checked `source-link-topics.json` registry** | `topicId → declared owner + requirement class`, used as the baseline validator's resolution target. The inventory generator later asserts its derived topic set equals that registry exactly, so the registry stays a contract rather than a second authority. Unblocks C4 before C5. |

Still open (not asked, each has a recommended option recorded in the workflow result): the OMH-018/082/093/176
budget rebalance route (H4), the GOV-P1 standalone-command shape (H1), the SPEC-P2 oracle carrier (H2/H6),
`seedDefaults` content (E5), and the E7 scheduler/optimistic-lock sub-decisions.

  **In flight (session 3, after W0):** wave 2 implementation workflow `wf_701c1552-80e`
  (`canonical-example-wave-2`) — four slices in isolated worktrees, each committing to its own
  branch, each followed by an independent verifier that checks the branch's file list against the
  slice allowlist and re-runs the claimed tests:
  `wave2/c1-cli-reader-fixes`, `wave2/c2-exact-file-fact-links`, `wave2/f1-cache-di-docs`,
  `wave2/f2-read-policy-redaction`.
  Branches are **local to those worktrees and not pushed** — if this session dies before merging,
  the work is in `git worktree list` under `.claude/worktrees/` (or recoverable from the workflow's
  `journal.jsonl`, which records every commit SHA). Nothing has been merged into
  `feat/implement-standalone-canonical-example` yet, so the PR branch is unaffected by an
  interrupted run. Resume with `Workflow({scriptPath, resumeFromRunId: 'wf_701c1552-80e'})`.

  **Wave 2 merged (session 3).** All four slices landed; each was checked by an independent verifier
  before merge, and three came back `needs-work` with findings that were fixed on merge rather than
  waved through:

  - **C1** shipped an uncovered semantic change — the call-expression fallback was narrowed from
    "any call forwards its first argument" to "only identifier-callee calls do", and the whole
    1436-test CLI suite passed with the hunk reverted because the existing tests only exercise
    `ComponentReplacementHandles` calls, which an explicit formula intercepts first. Pinned in
    `a1c0f7d05` with a fail-before negative control. C1 also carries **two BACKWARD_COMPATIBILITY §14
    notes for the PR body**: exactly one leaf changes across a real 55-module facts corpus
    (enterprise/security `section:auth.login.form` mode `replace`→`wrapper`), and modules naming a
    target via `ComponentReplacementHandles.section(...)` now publish `section:ui.detail.NotesSection`
    instead of the nonexistent `ui.detail` — a published-ID change for scaffolded apps.
  - **F2's headline claim was false as landed.** `exampleReadPolicySummary()` was never invoked by
    any test; one fixture validated a hand-built literal, another grepped source text. A real leak
    survived all 495 tests. Fixed in `0d9b84b16` by exporting the emission site's own composition as
    `sanitizedExampleReadPolicy(trace, root)` so there is exactly one project-and-sanitize path and
    it is the one under test. Mutation probe: dropping the sanitizer now fails two fixtures; before,
    it failed none.
  - **C1 defect 2 is NOT merged.** `extractInjectionTable` really does drop the string and
    single-object slot forms `ModuleInjectionTable` allows (measured: catalog 3, sales 3, wms 2,
    staff 1, integrations 1 — integrations contributes nothing today because of it — checkout 2).
    Landing the fix fails the `assertNoUnresolvedExtensionTargets` build guard on two stale core
    entries (`data-table:sales.payments:columns`, which no host declares and no DataTable renders;
    and `data-table:catalog.products:bulk-actions`, a redundant legacy alias). **New backlog row:
    remove those two stale entries, then land the slot normalization.**
  - Also observed: one agent left an uncommitted probe in ANOTHER agent's worktree mid-run. It was
    reverted by its owner and never reached a branch, but it is the second contamination incident
    this session — the per-slice allowlist + independent verifier is what caught both.

  **Gate after wave 2 (local runner):** `template:sync`, `build:packages`, `generate`,
  `i18n:check-sync`, `typecheck`, `build:app`, `repo-wide-guards` (24 files), `agents:check-budget`
  all green; `yarn workspace create-mercato-app test` 496/493 pass/0 fail; `@open-mercato/cli`
  1442/1442; `@open-mercato/core` 8992/8992; `@open-mercato/shared` 1724/1724. `yarn test` still has
  the one pre-existing `storage-s3-routes.test.ts` failure (5 tests), verified against a stashed tree
  in session 2.

  **Next session starts at wave 3** (E1 optimistic locking + shared Todo form; H1 GOV-P1), plus the
  new stale-injection-entry row that unblocks C1 defect 2.

  **In flight (session 3, after wave 2):** wave 3 workflow `wf_3141c54d-2b1` — three slices in
  isolated worktrees on branches `wave3/e1-todo-optimistic-locking`,
  `wave3/h1-gov-p1-knowledge-change`, `wave3/c1b-stale-injection-entries`, each followed by an
  independent verifier that now also runs its OWN mutation probe on every added test (added after
  wave 2 shipped a test whose headline claim was false). Branches are local to those worktrees and
  **not pushed**; nothing is merged into the PR branch until the verdicts are read, so an interrupted
  run leaves the PR branch untouched. Resume with
  `Workflow({scriptPath, resumeFromRunId: 'wf_3141c54d-2b1'})`; every commit SHA is in that run's
  `journal.jsonl`.

  **Wave 3 merged (session 3→4).** Three slices; **E1's verifier died mid-response**, so E1 was
  verified by hand instead of merged on trust — which is how its hole was found.

  - **E1 hole (found and closed).** Neutering the form's version threading (`updatedAt: null`
    instead of `item.updatedAt`), which fully disables optimistic locking on the edit surface, was
    caught by NOTHING: 76 app tests and 201 core optimistic-lock tests all stayed green. The
    API-projection test covers only the route; the workspace scan only greps for the presence of the
    helper primitives. Fixed by extracting the mapping as the pure `toTodoFormValues()` and pinning
    it in `components/__tests__/todo-form-values.test.ts` — that probe now fails 3 tests.
  - **Pre-existing classifier weakness (follow-up).** The scan's `COVERED_PRIMITIVE` regex counts a
    bare mention of `withScopedApiRequestHeaders` as coverage even with no version passed, unlike the
    tokenless `buildOptimisticLockHeader` case which it explicitly demotes. Fixing it means auditing
    every currently-"covered" file repo-wide. **New backlog row.**
  - **C1b was RED as delivered** — the generated-facts JSON budget guard failed at 3,506,266 against
    a 3,500,000 cap. Per maintainer guidance ("you can adjust the budgets in such cases"), raised to
    3,560,000 with a rationale comment matching the file's three previous raises; the ~28KB is the
    twelve recovered contributions. **This also resolves the H4 decision**: OMH-018's 3-byte slack is
    to be handled by raising `maxInitialContextBytes`, not by relocating prose.
  - **`sales.injection.payment-gateway-status-column` is now an UNBOUND registered widget.** Its
    binding could never resolve (PaymentsSection's DataTable has no tableId), so removing it broke
    nothing, but giving that table a real tableId so the column finally renders is a sales feature
    gap. Recorded in place. **New backlog row.**

  **Gate after wave 3 (local):** `template:sync`, `build:packages`, `generate`, `i18n:check-sync`,
  `typecheck`, `build:app`, `repo-wide-guards` (24 files), `agents:check-budget` green.
  create-mercato-app 515 (512 pass, 3 skipped) · core 8993 · shared 1724 · cli 1446 · ui 1758 ·
  cache 72. `yarn test` still carries only the pre-existing `storage-s3-routes.test.ts` failure
  (5 tests), re-verified against a stashed tree.

  **Next session starts at wave 4** (E2 translations/extension-points/notifications.client · H2
  SPEC-P2 evaluator plumbing · C3 local-reference fact emission), plus the two new backlog rows above.

  **In flight (session 4):** wave 4 workflow `wf_c230d9cf-a9b` — branches
  `wave4/e2-canon-b-small-gaps`, `wave4/h2-spec-p2-evaluator`, `wave4/c3-local-reference-facts`,
  each with an independent verifier that runs its own mutation probes plus a slice-specific check
  (C3: prove normal `module-facts.json` is byte-identical for package modules; H2: prove the new
  schema fields are inert for all 203 cases; E2: prove `yarn generate` really discovers the three
  new convention files). E1's inventory drift (`ui.form-create`/`ui.form-edit` need `TodoForm.tsx`)
  is folded into E2, which already owns the inventory. **SPEC-P2 oracle-carrier decision made:**
  the faithful option — `specRouting` in the response schema + `expectedSpecRouting` in the case
  schema + a `routing.spec-decision` validator — because the cheap label-based alternative cannot
  distinguish "wrong decision" from "wrong reason code".
  Branches are local and **not pushed**; nothing merges until verdicts are read. Resume with
  `Workflow({scriptPath, resumeFromRunId: 'wf_c230d9cf-a9b'})`.

  **Housekeeping:** `packages/shared/.tmp-dynamic-loader-*` dirs are leaked by
  `dynamicLoader.tsconfig.test.ts` and are NOT gitignored — sweep them before staging, or they get
  swept into a commit.

  **Wave 4 merged (session 4).** C3 clean; E2 and H2 came back `needs-work`.

  - **E2 shipped a FALSE CLAIM in a reference doc — the exact failure this program exists to
    eliminate.** The inventory and the file's own docstring said "Both hosts are bound to a live
    call site in this module." Run against the framework's own reader, the example emitted
    `unresolved: [example.todoForm, example.todosTable]` with reason `unbound-declaration`, while
    catalog/sales/auth emit zero. `hasDeclarationBinding` only counts a host as bound when the
    declared source REFERENCES `extensionPoints.hosts.<key>`; core modules import the declaration,
    the example duplicated the literal. Its own test **cemented** the defect by regex-matching that
    literal, so adopting house convention would have broken the test. Fixed on merge: both call
    sites now consume the declaration (`unresolved: []`), both tests pin the consumption pattern
    AND the extractor's own verdict, and all three doc claims were rewritten. Reverting a call site
    to a literal now fails 2 tests. A second test (`translations.test.ts`) matched the same literal
    and broke when it vanished — also repointed at the declaration.
  - **C3 is the unblocker and verified the strong way:** the verifier built the real facts corpus
    BOTH ways in one worktree, holding the 55-module corpus and the 1.05MB runtime registry constant
    and swapping only the two generator sources, and confirmed `module-facts.json` byte-identical by
    sha256. BC note: `ExtractAllModuleFactsResult` gained a REQUIRED `unresolvedFirstPartyTargets`
    — a return type, so readers are fine, but constructors/mocks break.
  - **H2 verified inertness three ways** (406 prompts across 203 cases x read-only/writable,
    compared base vs slice). Two notes for the wave that adds the six real cases: a read-only
    spec-routing case fingerprints a REAL `node_modules` twice per case (writable cases dodge it via
    a symlink short-circuit), and `.ai/harness/results` is fingerprinted on mtime/ctime so a
    mid-case touch there surfaces as a spurious read-only violation.
  - **Trap worth remembering:** 7 create-app tests failed after merging C3/H2 and reproduced with my
    own changes stashed — they were STALE BUILD ARTIFACTS, green after `yarn build:packages`. Always
    rebuild before diagnosing a create-app failure that mentions `build emits ...` or `published CLI bin`.

  **New follow-up:** the example's notification renderer is declared inline in
  `notifications.client.ts` rather than in `widgets/notifications/<Name>.tsx` as
  `packages/core/AGENTS.md` prescribes (the path was outside E2's allowlist). Docs tell readers to
  copy the structure, not the location. One-file move plus import.

  **Gate after wave 4 (local):** template:sync, build:packages, generate, i18n:check-sync, typecheck,
  build:app, repo-wide-guards (24), agents:check-budget all green. create-mercato-app 527 (524 pass,
  3 skipped) · app example 94/94. `yarn test` carries only the pre-existing
  `storage-s3-routes.test.ts` failure (5 tests).

  **Next session starts at wave 5** (E3 registry static-readability — note maintainer decision D2
  requires a BC waiver + UPGRADE_NOTES.md entry for retiring
  `NEXT_PUBLIC_OM_EXAMPLE_INJECTION_WIDGETS_ENABLED`; H3 the six SPEC-P2 routing cases OMH-204..209).

  **Concurrent push by another actor (session 4).** While wave 4 was merging, someone pushed
  `c2264fe51 Merge remote-tracking branch 'origin/develop' into review/pr-4897`, bringing 13 develop
  commits onto the PR branch. My push was correctly rejected; merged rather than force-pushed, so
  their work is intact. **Consequence worth celebrating: `ab1620a63` (#4926/#4931, mock i18n in the
  app-level storage_s3 route suite) FIXES the `storage-s3-routes.test.ts` failure this program has
  carried as pre-existing since session 1. `yarn test` now exits 0 — the gate is fully green for the
  first time.** Do not keep quoting that failure as a known-bad in future PR bodies.

  **Conflict resolved (session 4).** After the concurrent push, `develop` advanced again and the PR
  went `DIRTY`. One real conflict: `scripts/repo-wide-guards.mjs`, where both sides appended a
  different entry to the same append-only exemption list — resolved by keeping BOTH
  (`template-example-module-parity.test.ts` from this branch, `standalone-portal-email-env-guard.test.ts`
  from develop). `package.json.template` auto-merged. PR is `MERGEABLE` again at `8ddeba7ba`;
  full gate re-run green (`yarn test` exit 0, create-mercato-app 536/533 pass).
  **This list is a known recurring conflict point** — expect it whenever two branches add a guard.

  **In flight:** wave 5 workflow `wf_30380b88-690` — `wave5/e3-registry-static-readability` and
  `wave5/h3-spec-p2-routing-cases`. E3 carries maintainer decision D2 and therefore drafts an
  `UPGRADE_NOTES.md` entry + removes `NEXT_PUBLIC_OM_EXAMPLE_INJECTION_WIDGETS_ENABLED` from both
  `.env.example` files — **that wording needs maintainer review before merge**. H3 must update the
  case count in 6 documents + 2 hard-coded literals and the writable-id order in 5 places.
  Verifiers now also mechanically re-check every factual claim in any doc the slice touched, after
  wave 4 shipped a provably false one. Resume: `Workflow({scriptPath, resumeFromRunId: 'wf_30380b88-690'})`.

## Injection-flag safety audit (maintainer-raised, session 4) — BINDING ON E3

The maintainer flagged that the injection-widget flags could impact integration tests. Audited
before merging E3; findings change what E3 is allowed to do.

**Two DIFFERENT flags, with opposite risk profiles. Do not conflate them.**

| Flag | Who sets it | Effect of "always-on" | Verdict |
|---|---|---|---|
| `NEXT_PUBLIC_OM_EXAMPLE_INJECTION_WIDGETS_ENABLED` (injection table) | `packages/cli/src/lib/testing/integration.ts` sets `'true'` at **two** call sites (:1989, :3341); `.github/workflows/snapshot.yml:249` and `npm-snapshot-preview.yml:331` set it too | Integration tests **already run with it on**, so making entries unconditional is a **no-op for every integration spec** (incl. `TC-UMES-004`, `todo-priority-validation`) | **SAFE** |
| `NEXT_PUBLIC_OM_EXAMPLE_CHECKOUT_TEST_INJECTIONS_ENABLED` (component wrappers) | Defaults **false** in both `.env.example`s; the harness does **NOT** set it | `TC-CHKT-031-wrappers.spec.ts:13` **skip-gates on it** and asserts `example-checkout-summary-wrapper` / `example-checkout-help-wrapper` testids are visible | **MUST SURVIVE** |

**Binding consequences for E3:**

1. The checkout flag is **NOT** retired. D2's pass-through design is only correct if the flag check
   moves INSIDE each wrapper and the wrapper still renders its `data-testid` div when the flag is
   `true` — otherwise TC-CHKT-031 fails the moment anyone runs it with the flag on. Verify by
   running that spec's DOM assertions, not by reasoning about them.
2. **Do NOT delete `NEXT_PUBLIC_OM_EXAMPLE_INJECTION_WIDGETS_ENABLED` from the `.env.example` files
   or CI.** Per the maintainer's "make it safe or keep it just a side note": deleting it makes four
   live references (2 harness call sites, 2 CI workflows) dead, for no functional gain — the static
   readability E3 actually needs comes from the unconditional export, not from removing the var.
   Deprecate in place instead: leave it defined, documented as a no-op with a pointer to
   `metadata.requiredModules`, and skip the `UPGRADE_NOTES.md` removal entry. **If E3 deleted it,
   revert that part on merge and keep the rest.**

  **Wave 5 merged (session 4).** Both slices landed; the injection-flag audit was applied at merge.

  - **E3 achieved its actual purpose, measured:** the real extractor read **0** injection-table and
    **0** component-override contributions from the example before, **26 and 3** after — and the
    verifier reproduced the 0/0 baseline on a fresh detached worktree instead of taking it on trust.
    Root cause confirmed by reading the code: `staticValue` folds a ConditionalExpression only when
    both branches are deeply equal, and neither registry qualified.
  - **The checkout flag survived**, moved inside each wrapper, as the safety audit required.
    `TC-CHKT-031-wrappers` skip-gates on it while asserting the wrapper testids. The pass-through is
    asserted by React component identity + `renderToStaticMarkup` byte-equality, not by grepping source.
  - **E3's agent caught a false premise in maintainer decision D2.** D2 said cross-module entries
    would be "gated only by `metadata.requiredModules`" — no example widget declares that field. The
    agent verified and REFUSED to write the claim, documenting the gating that actually holds.
    **Follow-up:** add `requiredModules` to the widgets that call other modules' APIs
    (`catalog-seo-report` → `['catalog']`, the customer-priority widgets → `['customers']`).
  - **Completed at merge what E3 could not reach:** four dead env exports (integration harness x2,
    CI workflows x2) and `apps/docs/.../widget-injection.md`, which after E3 documented a live toggle
    that no longer existed — a new false doc claim, caught before it shipped. Plus the UPGRADE_NOTES
    sentence stating the real default change for scaffolded apps.
  - **H3 shipped 5 of 6 rows. Row 6 (reuse-spec) is structurally blocked**, not omitted: the validator
    requires `coveringSpecPath` to name a file that exists in the staged app, a fresh scaffold ships
    only a README and a blank template under `.ai/specs/`, and `validateCatalog` forbids fixtures on
    non-writable cases. **Unblocks when the writable existing-spec proof (wave 8, H6) lands** — it
    seeds its own covering spec. Alternative: ship a real example spec in every scaffold (product
    decision).
  - H3 edited `cases.schema.json` and `validators.json` outside its allowlist — mechanically
    unavoidable (schema pinned `maxItems: 203` and id pattern `20[0-3]`); merged cleanly with H2's
    edits to the same files.

  **Gate after wave 5: FULLY GREEN.** `yarn test` exit 0, create-mercato-app 537 (534 pass, 3
  skipped), all guards, budget, build:app.

  **Next: wave 6** — E4 (encryption + search) and H4 (CANON-C link migration; OMH-018 budget bump is
  approved per the maintainer's budget guidance).

  **In flight (session 4):** wave 6 workflow `wf_8b7a6a12-7d7` — `wave6/e4-encryption-and-search`
  and `wave6/h4-canon-c-link-migration`. E4 is the first slice in this program to touch the DATABASE
  (a nullable encrypted column on `todos` + migration + snapshot), so its verifier has an extra
  blocker-level check: inspect the generated SQL and snapshot diff for unrelated churn, confirm
  `findWithDecryption` is used instead of raw `em.find`, and confirm the encrypted column does not
  break search/sort/CSV (an `$ilike` over ciphertext matches nothing). H4 raises
  `maxInitialContextBytes` per the maintainer's budget guidance rather than relocating prose, and is
  restricted to budget VALUES in `cases.json` — it must not add or remove cases (H3 owns the case set).
  Branches local, not pushed. Resume: `Workflow({scriptPath, resumeFromRunId: 'wf_8b7a6a12-7d7'})`.

  **Wave 6, part 1 (session 4).** H4 merged; **E4's implementer died mid-response and produced ZERO
  commits**, so it was relaunched as `wf_acf7085b-c56` on branch
  `wave6/e4-encryption-and-search-retry` with an explicit instruction to **commit incrementally** —
  the first attempt lost ~2.4h of work to one dropped connection. That instruction is worth keeping
  in every future long slice.

  - **H4's verification was the strongest in this program so far:** rather than trusting the unit
    test, the verifier **scaffolded three real apps** (classic, empty, crm) with full agentic setup
    and resolved all 102 relative links across all 93 emitted Markdown owners against each generated
    root — 0 dead, 0 directory targets. One probe pointed at a file that EXISTS in the repo but that
    `SKIP_DIRS` never copies into a generated app, proving the check tests emitted-app reality rather
    than repo existence.
  - **H4's own negative control caught a self-inflicted bug**: a first/last-occurrence restore had
    silently moved OMH-018's budget raise onto a DIFFERENT case. The full suite caught it; eyeballing
    the diff would not have. Worth remembering when scripting edits across a large JSON catalog.
  - **Two honest findings from H4 carried forward:** (1) the canonical spec says "the eight owner
    families" while its table has NINE data rows — used the table as written, discrepancy recorded in
    the spec changelog rather than silently renumbered; (2) **MEDIUM, pre-existing and disclosed:**
    the initial-context budget arithmetic is computed against REPO AUTHORING SOURCES, not the emitted
    app tree, and the two differ — so every budget number in the harness is a close proxy rather than
    an exact measure. Deepened by this slice, not introduced. **New backlog row.**
  - **CANON-C is NOT complete.** H4 migrated 5 owner families fully, 2 partially (their installed-
    package targets need a packed artifact to prove resolution, which no gate in that slice provides),
    and 2 not at all — the root-instruction pair (`AGENTS.md.template` and `template/AGENTS.md` are
    byte-identical apart from the H1 and must move together; the second was outside the allowlist) and
    the optional Figma owner, **which the slice verified does not exist as an emitted owner at all**
    rather than repeating the spec's assumption. `source-link-inventory.json` /
    `source-link-baseline.json` and the 136-fence ledger remain outstanding.

  **Wave 6 complete (session 4).** E4 was relaunched after its first implementer died with zero
  commits; the retry was told to **commit incrementally** and produced 4 commits — keep that
  instruction in every long slice.

  - **E4's migration passed the sanity gate cleanly**, which mattered: 13 lines, one statement per
    direction, nullable, reversible, and the snapshot diff a single 16-line hunk. The verifier parsed
    the snapshot and confirmed only this module's three tables. **Pre-existing problem it exposed:**
    `yarn db:generate` emits a spurious `packages/core/src/modules/wms` migration + snapshot rewrite
    on EVERY run on a clean tree. The slice deleted that output each time under the coding-agent
    exception. **New backlog row — it makes the migration gate noisy for everyone.**
  - **REWORKED ON MERGE — E4 reinvented a platform capability.** It added a bespoke `notesSearch`
    param resolving ids via `findEntityIdsBySearchTokens`, on the premise that an `$ilike` over
    ciphertext matches nothing. That is only true of RAW SQL: `engine.ts` → `applyFilterOp`
    intercepts like/ilike and rewrites it into a `search_tokens` lookup when the column is encrypted
    and search is active, with `applySearchTokens` applying tenant/org scope itself. Verified
    directly. The hand-rolled path duplicated platform behaviour AND re-derived a scope the platform
    already applies — in the module whose job is to teach the right pattern. It was also strictly
    MORE fail-closed (returning zero rows on `matched: false`, the exact failure it set out to
    avoid, relocated), contradicting the documented MUST NOT in `tokenLookup.ts`. `notes` is now a
    plain `$ilike`; ~30 lines and an exported helper removed.
  - **Another backwards doc claim corrected:** the route said an encrypted column "is not a sortable
    column" because `notes` is absent from `sortFieldMap`. Omitting it blocks NOTHING — the factory
    falls through to the raw field name, so `?sortField=notes` reaches the engine and takes a correct
    but row-capped decrypt-then-sort-in-memory path. Blocking it needs an explicit allowlist.
  - **The `durationMs` flake is fixed at the root**, not re-run away: `Date.now() - started` goes
    negative on an NTP step, failing the result schema's `minimum: 0`. Now `performance.now()` with a
    floor. Seen twice in this program on different live-runner tests, each time unreproducible, each
    time costing a diagnosis.
  - **Still open from E4's verifier** (recorded, not fixed): 9 of 26 of its probes MISSED — the whole
    notes-search block could be disabled or stripped of tenant/org scoping with every example test
    green (not exploitable, since the engine re-applies scope, but asserted-correct with no guard);
    no integration test for a slice adding an API param, a response field and a form field; two raw
    `em.find(Todo, …)` reads remain in `data/enrichers.ts` on an entity that now carries an encrypted
    column; and three installed-harness docs now assert falsehoods ("No canonical encryption map
    exists yet", "the example ships no search.ts") that belong to a harness-refresh slice.

  **Gate after wave 6: FULLY GREEN.** `yarn test` exit 0 (25/25 turbo tasks), create-mercato-app 540
  (537 pass, 3 skipped) across three consecutive runs, all guards, typecheck, build:app.

  **Next: wave 7** — E5 (cache + rich DI + setup seeding) · H5 (CANON-C harness case additions) ·
  C4 (source-link baseline, using the checked `source-link-topics.json` registry per decision D4).

  **In flight (session 4):** wave 7 workflow `wf_d1439c4d-882` — `wave7/e5-cache-di-seeding`,
  `wave7/h5-harness-example-roots`, `wave7/c4-source-link-baseline`.

  - **H5 is the one that matters most for this whole program's honesty.** Zero of the 208 shipped
    cases declare `context.exampleRoots`, so every capability row added so far is INERT for the live
    harness — the read-policy machinery is fully built and fixture-covered but has never been
    exercised by a real case. H5 also has to REWRITE (not delete) the compatibility tests that
    currently assert "no shipped case declares the new fields", which become false the moment it
    lands.
  - **E5 carries an unresolved design question deliberately left open**: what `seedDefaults` actually
    seeds. Option B (no schema change) is the default; Option A revives the dead `ExampleItem` with a
    migration. The agent was told to settle it from the spec's wording and to say plainly if Option B
    produces a hollow demonstration, rather than assume.
  - **C4** implements decision D4 (a checked `source-link-topics.json` registry) to break CANON-C's
    circular dependency, and was told to VERIFY the recon's claims about the 8 pinned assets and 136
    fences rather than build on them — several recon claims have already proven stale.

  Branches local, not pushed. Resume: `Workflow({scriptPath, resumeFromRunId: 'wf_d1439c4d-882'})`.

  **Wave 7 merged (session 4). The milestone here is H5.** Until it landed, ZERO of the 208 shipped
  cases declared `context.exampleRoots` — so every capability row six waves of work had added to the
  example was **inert for the live harness**. OMH-209..212 now declare it across four disjoint
  capability groups. 212 cases, contiguous. The verifier enumerated all **14** count/order pins from
  scratch and confirmed none was missed.

  - **E5 corrected two false premises in its own brief**, and both corrections improved the result.
    (1) The brief framed seeding as `onTenantCreated` vs `seedDefaults`; `ModuleSetupConfig` declares
    a THIRD hook, `seedExamples`, which the spec requires by name — the hooks now differ by
    capability, not by a passed argument. (2) The brief claimed `Todo` is the only tenant-scoped
    store, so scoped defaults needed the dead `ExampleItem` revived with a migration. `ce.ts` already
    declares `example:calendar_entity`, a virtual custom entity in `custom_entities_storage` WITH
    tenant/org columns — which removed Option A's entire motivation, so E5 shipped with **no schema
    change**. Writing briefs from recon summaries is now demonstrably riskier than letting the agent
    check; keep telling them to verify the brief.
  - **E5's own negative control caught a hollow test**: breaking `recordId` left the idempotency
    assertion green because it compared `[undefined, undefined, undefined]` to itself.
  - **Closed on merge, H5's one MISSED probe**: appending a capability to a case's
    `allowedCapabilityIds` silently widened its example-read scope with the whole suite green,
    because the reachability test derived its expected allowlist FROM the case's own declaration —
    widening both sides equally. Per-case capability sets are now pinned; re-running that probe fails.
  - **Closed on merge, C4's emission asymmetry**: the slice put both JSON ledgers and the validator
    under `agentic/shared/**`, which the scaffolder copies wholesale into every generated app. They
    are monorepo-only (the baseline pins monorepo SHAs and validates monorepo files), so that shipped
    ~148KB of dead weight per scaffold. Moved to `packages/create-app/scripts/`, outside the copied
    tree. **Rule worth remembering: anything under `agentic/shared/{ai,scripts}` SHIPS.**
  - C4 verified both recon claims rather than assuming: the 8 assets really are read from SHA
    `f7c941570` via `git cat-file` (all 8 working-tree files have drifted), and the validator reports
    **8 assets, 136/136 dispositions, 125 topics**.
  - **Also addressed, and NOT an E5 defect:** `integrationTestPaths` holds both unit and integration
    evidence by design, but the name reads as a promise of integration coverage — a verifier made
    exactly that misreading and called it blocking. **20 rows predating E5 use the same convention.**
    The inventory note now states the distinction outright and `inventory-evidence-honesty.test.ts`
    pins it, including that every evidence path must resolve on disk.

  **Gate after wave 7: FULLY GREEN.** `yarn test` exit 0 (25/25 tasks), create-mercato-app 546 (543
  pass, 3 skipped), guards, budget, build:app.

  **Next: wave 8** — E6 (remaining fact families: ai-tools, ai-agents, generators, page middleware,
  portal broadcast) · H6 (SPEC-P2's two writable ordering proofs — **this unblocks H3's row 6**,
  the `reuse-spec` case, because the writable proof seeds its own covering spec).

  **In flight (session 4):** wave 8 workflow `wf_22176c0b-7a4` — `wave8/e6-remaining-fact-families`
  and `wave8/h6-spec-p2-writable-proofs`.

  - **H6 unblocks H3's row 6.** The `reuse-spec` case was structurally impossible because the
    validator needs `coveringSpecPath` to name a file existing in the staged app, a fresh scaffold
    ships only a README and a blank template under `.ai/specs/`, and `validateCatalog` forbids
    fixtures on non-writable cases. The existing-spec WRITABLE proof seeds its own covering spec, so
    once it exists the read-only case becomes expressible. H6 was told to add it and state plainly
    whether it is genuinely covered afterwards.
  - **H6 also carries a real design fork the recon flagged**: `evaluate-agent-harness.mjs` (~line
    941) requires every semantic oracle to list `writable-ast-oracles.mjs` as a runner, and a
    MARKDOWN-grading spec oracle does not fit an AST oracle. Either embed it there (impure) or relax
    the guard (weakens a deliberate check). The agent must pick, justify, and NOT quietly work
    around the guard — the verifier is asked to judge exactly that.
  - **E6** was told to run the real extractor before and after and report the delta per fact family,
    because a family still reporting zero contributions is not done regardless of what shipped — and
    to refuse to invent a fake consumer just to pad a fact count.
  - Verifiers now also hunt **self-referential assertions** specifically, after two appeared in this
    program (one deriving its expectation from the declaration it constrained, one comparing
    `undefined` to itself).

  Branches local, not pushed. Resume: `Workflow({scriptPath, resumeFromRunId: 'wf_22176c0b-7a4'})`.

  **Wave 8 merged (session 4).** Both slices came back `needs-work` with real findings, and E6
  surfaced a defect **wave 7 introduced and I merged**.

  - **MY RUN-DOC PREMISE WAS WRONG (third time this program).** I recorded that H6 would unblock
    H3's `reuse-spec` row 6. It does NOT. The implementer reproduced the blocker and the verifier
    re-confirmed it in source: the evaluator forbids `expectedSpecRouting` on a writable case,
    requires `coveringSpecPath` to appear in the case's own context, and requires every declared
    context path to EXIST in the fresh-scaffold root the deterministic lane validates. OMH-214's
    covering spec lives only in a fixture-prepared disposable copy, and read-only cases may not
    declare fixtures. **Row 6 remains blocked; it was not faked.** Unblocking it needs either a real
    example spec shipped in every scaffold (product decision) or an evaluator change.
  - **The oracle-runner fork was resolved honestly**: the guard was generalized to bind each oracle
    to its declared runner and TIGHTENED in both directions, not relaxed. Verifier confirmed.
  - **H6's 3 allowlist deviations were each PROVEN justified** — the verifier reverted each single
    number individually and watched an allowlisted guard go red. It also enumerated **20** count pins
    where the brief said 14, and found one stale: `AGENT-HARNESS.md:23` still said "46 such cases",
    and the spec changelog wrongly claimed that file had been resynchronized. Both fixed on merge.
    **That file is not covered by the count guard and rots silently — check it by hand every time.**
  - **E6: two VACUOUS tests fixed on merge.** (1) "never accepts tenant or organization as tool
    input" fed only scope keys to `safeParse`; for the one tool with a required field the parse
    fails, the fallback empties the object, and all four assertions became
    `expect(undefined).toBeUndefined()` — leaving the pack's headline safety property unpinned for
    the only tool it could matter for. Now asserts the DECLARED schema shape plus a smuggled-key
    case. (2) "stays silent when the write is unscoped" asserted only that the handler resolves; it
    always returns void and swallows emit failures, so it held whether or not it broadcast — a probe
    showed it publishing with empty tenant/org onto the global bus with all 14 tests green. Now
    installs a fake bus and asserts emit was NOT called.
  - **E6 also corrected a false doc claim in 3 places**: the agent's `systemPrompt` is NOT
    "compiled from named PromptTemplate sections … so the override system can address a section by
    name". `AiAgentDefinition.systemPrompt` is a plain string and the override path wraps it as a
    single `role` section.
  - **`di-registration` was a SILENT ZERO introduced in wave 7** (`00cba7f17`). `getPropertyName`
    returned undefined for a computed key, so `{ [SERVICE_TOKEN]: asFunction(...) }` produced no fact
    AND no diagnostic — the unresolved-token path only fires for a NAMED token. The example claimed
    `module.di-registration` while scoring zero. Fixed in the READER, not the example: a computed key
    is the better pattern. Repo-wide, 34 package modules now emit 143 di-registration facts.
  - **Still open — a SECOND silent-zero family:** `search` reports 0 facts although the module ships
    `search.ts` and the inventory claims `search.module-config`. Same class of root cause. **New
    backlog row.** Also still 0: `generator-plugin` (needs a convention file + consumer, outside E6's
    allowlist), `worker`, `vector`.

  **Gate after wave 8: FULLY GREEN.** `yarn test` exit 0 (25/25 tasks), create-mercato-app 577 pass,
  cli 1522, guards, budget, build:app.

  **Next: wave 9** — E7 (the DataTable bulk action + durable outbox + scheduler + CAS-leased worker
  + progress slice, the largest single runtime slice) · H7 (GOV-P2 controller-owned evidence
  contract). Decision D3 already binds E7 to a data-only `widget.ts`, not `widget.client.tsx`.

  **In flight (session 4):** wave 9 workflow `wf_e6893a0f-915` — `wave9/e7-bulk-action-progress`,
  `wave9/h7-gov-p2-evidence`, `wave9/c6-search-silent-zero`.

  - **E7 is the largest single runtime slice in the program** (bulk action + durable outbox +
    scheduler target + CAS-leased worker + operation progress). It was told explicitly that a
    coherent SUBSET with real tests beats a complete-looking slice with vacuous ones, and to amend
    the canonical spec's `widget.client.tsx` wording, which contradicts the code — decision D3 binds
    it to a data-only `widget.ts`. Its verifier runs the migration sanity gate line by line and must
    construct a probe that would breach tenant scope if the bulk guard were removed.
  - **C6 chases the `search` silent zero** and, more usefully, sweeps `generator-plugin` / `worker` /
    `vector` to classify each as legitimately-absent vs silently-unreadable. The verifier must
    classify them independently rather than accept C6's answer — after `di-registration` turned out
    to be a claimed capability scoring zero, that whole family of claims is suspect.
  - The agent brief now carries an explicit **anti-vacuous-test section** listing all four real
    examples from this program and the test "what value would make this fail?", because vacuous
    tests are measurably the #1 failure mode here — more common than wrong behaviour.

  Branches local, not pushed. Resume: `Workflow({scriptPath, resumeFromRunId: 'wf_e6893a0f-915'})`.

  **Wave 9 merged (session 4). E7 is deliberately PARTIAL and the boundary is stated, not implied.**

  - **E7 ships the durable operation end to end in UNITS** — CAS-leased outbox entity, dispatch
    worker, bulk-complete route returning a `progressJobId`, data-only bulk widget (D3),
    idempotency-keyed unique constraint. **NOT shipped:** the Playwright proof
    (`TC-EXAMPLE-003`), which needs a live app + database + running queue/scheduler. The slice
    declined to add an integration spec it could not execute. **The browser half — top-bar progress,
    cleared selection, refresh on the terminal event — and the real queue round trip are UNPROVEN.**
    The surface map says so rather than letting a populated `integrationTestPaths` imply otherwise.
    The DB-backed halves (CAS predicate, unique-constraint race, dispatcher scoped find) are tested
    only through injected interfaces, not against Postgres.
  - **Migration passed the sanity gate**: one CREATE TABLE + one unique constraint, one DROP in
    `down()`, no ALTER, no data migration. Verifier parsed both snapshots and diffed semantically —
    exactly one table added.
  - **TWO MORE FALSE PREMISES in inputs I supplied.** (1) The spec said to give the Todo table an
    `extensionTableId`; it already resolves, because DataTable derives it from `perspective?.tableId`
    FIRST and TodosTable already passes the host's. Spec amended. (2) The recon claimed the example
    would be "the first module to seed a ScheduledJob" — four core modules already do, and
    `payment_gateways` already implements the exact degrade-to-warning wrapper I asked the slice to
    invent. It copied the precedent instead. **That is five false premises across nine waves; assume
    briefs are wrong until the agent checks.**
  - **TWO MORE VACUOUS TESTS, and MY FIRST FIX FOR ONE WAS ALSO VACUOUS.** (1) "keeps the version out
    of the persisted column patch" inspected `prepare`'s undo snapshot — built entirely from the DB
    entity, so it structurally could not carry an input key; a mutation genuinely leaking the value
    into the real patch left it green. Now asserts the exported `buildTodoUpdatePatch`. (2)
    "onTenantCreated gets no container" asserted absence of a key the test itself declined to write;
    adding `container?: unknown` to the real type left it green. **My first rewrite used
    `@ts-expect-error` — the jest transform does not fail on an unused directive, so that was vacuous
    too, and my own probe caught it.** It now calls the hook and asserts the scheduler was NOT
    registered. **Lesson: a type-level assertion is NOT enforced by this repo's test transform; pin
    behaviour at runtime.**
  - **C6 fixed the `search` silent zero and added the missing diagnostic**: 47 → 53 entity ids across
    9 → 12 emitting modules, purely additive. More valuable, the one genuinely unreadable case left
    (checkout) now emits 3 warnings pointing at exact lines instead of silently scoring zero.
  - **H7's verifier died**, so I checked its two carried constraints myself: the validator is still
    unwired from CI/config, and the fail-closed CANON-C reason is still accurate. **Realigned on
    merge:** its forward reference pointed the future inventory at `agentic/shared/ai/harness/`, the
    tree wave 7 deliberately moved these assets OUT of because it is copied into every generated app.
    Left alone, the inventory would have landed back inside every scaffold.

  **Gate after wave 9: FULLY GREEN.** `yarn test` exit 0 (25/25), create-mercato-app 580, guards,
  budget, build:app. One locale-sort fix was needed after E7's new strings.

  **Next: wave 10** — C5 (source-link inventory generator + `topicId` on all inventory rows +
  regenerate-and-diff gate; this is what unblocks H7's fail-closed branch and wires the CANON-C
  validators into CI) · H8 (harness source-selection assertions for the bulk-action and
  operation-progress capabilities).
