# Run: Canonical example — Milestones B, C, D completion (stacked on PR #4897)

**Branch:** `feat/canonical-example-milestone-bcd`, stacked on `feat/implement-standalone-canonical-example` (`520d7e50a`).
**Started:** 2026-08-05. Resumable: this file is the single source of truth for wave state.

## Why this run exists

PR #4897 delivered CANON Milestone A plus the SPEC-P / READ-P / GOV foundations under an explicit
user-directed scope decision. A three-auditor completeness pass at the end of that PR found what
remained, and the maintainer directed that **all of it** be implemented here rather than deferred.

## Upstream premise — VERIFIED before any work started

The previous run recorded #4883 as upstream-blocked and #4301/#4277 as unpacked. All three are now
in `develop`, verified mechanically rather than taken on trust:

| Dependency | State | Evidence |
|---|---|---|
| PR #4883 | **MERGED** 2026-08-03 | `packages/cli/src/lib/generators/module-override-targets.ts` present on `origin/develop` and in this tree |
| PR #4301 | **MERGED** 2026-08-03 | `packages/core/src/modules/design_system/gallery/**` present on `origin/develop` |
| PR #4277 | **CLOSED, not merged** — content landed as **#4891** (`b2d26489c`) | `git merge-base --is-ancestor b2d26489c origin/develop` → yes; `packages/ui/figma/*.figma.tsx` + `figma.config.json` present |

**Correction to carry forward:** cite **#4891 / `b2d26489c`** as the design-foundation baseline. #4277
itself is closed and merged nothing; a spec or fixture that pins "#4277 merged" is asserting something
false.

## Scope

| Slice | Work | Depends on |
|---|---|---|
| **A** | GOV `sourceLinkInventory` enforcement: read all seven required fields, add `source-link-baseline.schema.json`, resolve the unreachable parity-ledger classifier branch | — |
| **B** | Fifteen `TC-EXAMPLE-003…017` integration specs (Milestone B's hard gate) | H |
| **C** | `context.sourceReferenceIds` (schema + evaluator + trace); reachable reason-gated fallback; a writable case declaring `exampleRoots` | — |
| **D** | SPEC-P decision row 6 (`reuse-spec` read-only case); module-shaped writable-proof oracle clauses; traceability rows + enum-ledger classification | C |
| **E** | PR #4883 `factCoverage` enum-derived ledger, override-target/topology assertions, `unknown-framework-mode` diagnostic | — |
| **F** | PR #4301 design-system reference layer: gallery mappings, direct vs composite, `source-only`, `availabilityByPreset` | E |
| **G** | PR #4891 (#4277 content) `designFoundation` sidecar: packed Code Connect correlation, per-item applicability, design-tier gating | F |
| **H** | Missing example surfaces: `frontend/middleware.ts`, `generators.ts`, `aiToolOverrides`/`aiAgentOverrides`, vector/workflow/currency+payment+shipping identities, compileable override reference, `componentOverrides` `replace` + `props` | — |
| **I** | Milestone D aggregate certification | all |

## Constraint on the integration specs — CORRECTED 2026-08-05, do not carry the old version forward

**Original claim (WRONG): "the fifteen integration specs can be written but not executed, because
Playwright needs Docker."** That conflated the two run modes. Probed directly:

| Prerequisite | State |
|---|---|
| Postgres on `localhost:5432` | **OPEN** — `DATABASE_URL` in `apps/mercato/.env` points at it |
| Playwright Chromium | **installed** — `~/.cache/ms-playwright/chromium-{1217,1223,1228}` |
| App on `localhost:3000` | closed, but startable with `yarn dev` |
| Docker | unavailable — but only `test:integration:ephemeral`/`:coverage` need it |

`yarn test:integration` is plain Playwright against `BASE_URL` + a reachable Postgres. **No Docker.**

Second correction: the recon note that `STATIC_TEST_IGNORES` excludes `.ai/tmp/**` and therefore hides
this worktree is only true when Playwright runs from the MAIN checkout (where this worktree happens to
live under `.ai/tmp/`). Run from inside the worktree, `projectRoot` is the worktree itself and the
specs sit at `apps/mercato/src/modules/example/__integration__/**` — not under `.ai/tmp/**` — so they
ARE discovered.

**Therefore slice B's specs should be RUN, not merely written.** Treat "shipped unexecuted" as a
failure of this run, not an accepted constraint. If a spec genuinely cannot be run after a real
attempt, say which one and what blocked it.

## Method (carried over — it earned its keep)

Every slice runs in an isolated worktree against a per-slice file allowlist and is checked by an
**independent verifier** that re-runs claimed tests and runs its own mutation probes. The previous run
caught seven false premises, eight vacuous tests and three silent-zero fact families that way.

## Wave state

| Wave | Slices | Status |
|---|---|---|
| 1 | A, E, H | not started |
| 2 | C, F | not started |
| 3 | D, G | not started |
| 4 | B | not started |
| 5 | I + spec changelogs | not started |

## Handoff log

- **2026-08-05** — Branch created off `520d7e50a`. Upstream premise verified (table above); the #4277
  → #4891 correction is the first finding. No implementation yet.

## Recon for waves 2–4 (read-only, 2026-08-05) — ten findings, four of them spec-vs-reality mismatches

Run before writing the F/G/B briefs, because brief-level false premises were the top failure mode last
run. Everything below was verified mechanically in-tree.

### The spec is WRONG about packaging — this unblocks F and G properly

Spec L686/L690 defer every `installed-package` target because *"no gate in this batch can verify a
packed artifact"* and claim the #4301 gallery and #4277 `designFoundation` envelopes are **"not packed
in this repository"**. Both are false:

- `npm pack --dry-run --json` on `packages/core` → **all 27 gallery `src` files** (registry, types, all
  17 `entries/*.tsx`, all 4 `components/*.tsx`). `__tests__/**` and `__integration__/**` are NOT packed.
- `npm pack --dry-run --json` on `packages/ui` → `figma.config.json` + **all 12 `figma/*.figma.tsx`**.
- Neither package declares a `files` field, and there is no `.npmignore`.

So `npm pack --dry-run --json` **is** the cheap gate the spec says does not exist. The deferral
rationale is falsifiable and the installed-package reference work is genuinely doable.

### F — the #4301 layer is GREENFIELD, not an extension

`designSystemReferences`, `designFoundation`, `galleryCoverage`, `composite-not-direct`,
`availabilityByPreset`, `designSystemGalleryItems` return **zero hits** in any `.ts`/`.tsx`/`.json` —
they exist only in `.ai/specs/**` and `.ai/runs/**`. `GalleryEntry` (`gallery/types.ts:1-32`) has no
coverage, classification or preset field at all.

Constraint: spec L430 designates `gallery/{registry,types}.ts` as **discovery-only**, so the new
schema must live OUTSIDE them — adding fields there fights the spec's own classification.

Gallery is a hand-maintained manifest (`registry.ts:49-152`), not auto-discovered. 17 families.

### G — Code Connect node correlation is almost entirely placeholder

- **16 of 18** `figma.connect` calls use `node-id=0-1` with a `TODO(figma)` comment. Only two are real:
  Alert `169-2358`, Drawer `486-7366`.
- Gallery side has only **7** `figmaNodeId` values total.
- **Drawer is the ONLY achievable `nodeComparison: "match"` in the entire tree** (gallery `486:7366`
  ↔ Code Connect `486-7366`). Alert's node has no gallery counterpart. Any brief assuming broad
  correlation is wrong; `partial`/`not-comparable` is the honest majority outcome.
- `packages/ui` has **no `./figma/*` export key**, so the files are packed but not importable —
  `codeConnectExportStatus: "not-exported"` is the only factually valid value today.
- Spec L229's `designSkillAvailability: "unavailable"` claim **survives verification unchanged**: the
  `design` tier exists only in `.ai/skills/tiers.json`; the standalone
  `agentic/shared/ai/skills/tiers.json` has `core`/`automation`/`migration` only.

### B — integration specs may be RUNNABLE after all

Two modes, and only one needs Docker:
- `yarn test:integration` → plain Playwright against `BASE_URL` (default `localhost:3000`) + a
  reachable Postgres. **No Docker required.**
- `yarn test:integration:ephemeral` / `:coverage` → CLI runner, **requires Docker** (testcontainers).

Revises the constraint recorded above: the specs may be executable here if an app + Postgres can be
brought up, rather than write-only. To be attempted, not assumed.

Two gotchas:
- `.ai/qa/tests/playwright.config.ts` `STATIC_TEST_IGNORES` excludes **`.ai/tmp/**`** — i.e. THIS
  worktree. Specs written here are invisible to a local Playwright run regardless; they only execute
  from a real checkout path.
- `.ai/qa/AGENTS.md` L507-532 CATEGORY table contains **no `EXAMPLE`, `UMES`, `APP` or `CLI`** entry.
  The example module's IDs sit outside the documented taxonomy — de-facto accepted, but no brief
  should cite that table as authority for `TC-EXAMPLE-*`.

Existing tree: only `TC-EXAMPLE-001` and `-002` exist (plus 19 TC-UMES/APP/CLI specs). Template mirror
is byte-identical across all 23 files.

### Two doc defects to fix (deferred — slice H owns the example tree this wave)

1. `surface-map.md:237` still calls `widgets/injection-table.ts` / `widgets/components.ts`
   *"conditionally spread exports; static module-fact extraction cannot read their entries"* —
   contradicted by L157/L167/L222 **in the same file**, which say both are unconditional literals the
   extractor reads. Internally inconsistent.
2. Spec L686/L690's packaging claims, per the top of this section.

### One brief-targeting correction

`design_system` is stripped from the template registry by `scripts/template-sync.ts:146`
(`TEMPLATE_DISABLED_MODULE_IDS`), **not** by `starter-presets.ts` — which never mentions
`design_system` or `example` at all. A brief saying "remove it from the presets" targets the wrong file.
