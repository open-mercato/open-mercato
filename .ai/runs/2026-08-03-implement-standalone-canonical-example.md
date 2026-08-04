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
