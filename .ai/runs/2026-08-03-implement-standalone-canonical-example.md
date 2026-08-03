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
| 3 | Add `template-example-module-parity.test.ts` (sorted paths + SHA-256) + `repo-wide-guards.mjs` exception | CANON-A1.2 | pending | — |
| 4 | Add `example/README.md`, `references/surface-map.md`, `references/surface-inventory.json` (existing-surface rows) + mirror | CANON-A1.3 | pending | — |
| 5 | `TEMPLATE_CONTENT_TRANSFORMS` entry for `src/modules.ts`; drop `empty.files.remove`; remove `example` + `design_system` from template registry | CANON-A2.1 | pending | — |
| 6 | Flip preset assertions; add preset-matrix test (source-present / registration-absent / no dead nav) | CANON-A2.2 | pending | — |
| 7 | Activation fixtures: `{ id: 'example', from: '@app' }` and `{ id: 'design_system', from: '@open-mercato/core' }` | CANON-A2.3 | pending | — |
| 8 | Spec-first routing rule in emitted `AGENTS.md` + planning-skill handoff (resolve instruction-budget headroom first) | SPEC-P1 | pending | — |
| 9 | `exampleRoots` / `installedVersionFallback` / `sourceReferenceIds` case-schema fields + evaluator + oracle fixtures | READ-P1a | pending | — |
| 10 | Full validation gate + spec changelog updates | CANON-D (partial) | pending | — |

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
| READ-P1b: 202-case `node_modules/@open-mercato/*/src/**` glob migration | Task 9 | Per-case disposition required; no partial-credit path. |
| READ-P2: reason-gated `installedVersionFallback` + redaction fixtures | Task 9 | — |
| GOV-P1/P2: `knowledge-change.schema.json`, validator/controller, 9 mandatory workflow steps | CANON-C source-link-inventory | Validator consumes the inventory; needs a real knowledge-contract change to exercise. |
| SPEC-P2: 6 routing cases + 2 writable ordering proofs | Task 8, Task 9 | — |

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

## Handoff Log

- **2026-08-03 — session 1:** Branched off `develop` at `68b544764`. Ran a 7-agent reconnaissance
  workflow over presets, template-sync, the example module, the harness, skills, and platform APIs;
  results in the Reconnaissance Corrections table above. Scope bounded by user to Milestone A +
  policy/schema foundations. `modules.ts` divergence mechanism chosen: `TEMPLATE_CONTENT_TRANSFORMS`.
