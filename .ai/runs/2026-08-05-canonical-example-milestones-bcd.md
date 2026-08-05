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

## Known hard constraint — stated up front, not discovered late

**The fifteen integration specs (B) can be written here but NOT executed.** Playwright integration
runs need a live app, database and queue via Docker, and Docker is unavailable in this WSL distro
(`yarn test:create-app` / `:integration` have been unrunnable for the whole programme). They will ship
as specs whose correctness is reviewed statically and proven by CI, and this file will say so plainly
rather than implying they were run green.

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
