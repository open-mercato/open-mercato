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

The waves are `1: A, E, H`, `2: C, F, G`, `3: D`, `4: B`, `5: I + spec changelogs`. Their **status**
lives in exactly one place: the **"Wave state"** table at the end of this document, rewritten in
place as waves land. This header previously carried a second status table, which drifted and ended
up contradicting the authoritative one (#4991 review nit) — it is deliberately not duplicated here.

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

## Wave 1 result — ALL THREE SLICES `needs-fixes`. Nothing integrated yet.

Six agents (3 implement + 3 independent adversarial verify). The verifier layer found **15 vacuous
probes** across the three slices, plus three blocking defects. This is the layer working as intended:
every slice reported itself complete and green, and none of the three was.

### Blocking

| Slice | Defect |
|---|---|
| **A** | The gate is bypassable by a one-key edit **to a file already in the change set**. `declaredBaselinePath` reads `inventory.inputs.baseline` from the very asset an author edits; delete that key and the cross-check silently skips. Separately, the ledger schema's *content* is never pinned — the verifier replaced the whole schema with `{"type":"object"}` and validation returned `ok:true`. |
| **E** | The headline fix is vacuously covered. Reverting `code: result.outcome` (`module-override-targets.ts:224`) — reinstating the exact conflation bug the slice claims to fix — left **all 1569 CLI tests green**. The tests exercise only the pure resolver, never the line that publishes the diagnostic. |
| **H** | The central documented rule is **false for the code path the module ships**. There are two resolvers with different composition semantics; `resolveRegisteredComponent` is a sequential fold where `replacement` assigns and discards everything composed before it. The docs, the inventory row and the tests all describe the resolver the showcase does *not* use. |

### The worst finding, because it is the defect class this programme exists to eliminate

**Slice E's `factCoverage` ledger is not wired into generation at all.** `buildModuleFactCoverageLedger`
has **zero call sites outside its own test**, while the shipped `generatedNote` claims the inventory is
*"generated from"* those ledgers and that *"an added enum value with no row fails generation"*. Neither
is true. A published claim of enforcement that does not exist — the same shape as the two false claims
corrected in #4897, now caught before merge instead of after.

Adjacent: `enumSource` is unverified prose (the verifier rewrote every occurrence to a nonexistent
`file#symbol` and the whole suite stayed green), and `missing-owned-fact` is published as a
negative-fixture row for a fixture that exists nowhere.

### Two premises in MY OWN briefs were wrong

1. **"Base branch is feat/canonical-example-milestone-bcd."** The worktrees started at `1da2982e9`,
   where `agentic/shared/ai/harness/` and `scripts/source-links/` did not exist at all. Slice A caught
   it and reset before doing anything; E and H are confirmed based on `9c83f5fbc`, a real commit on
   this branch. No work was lost, but the brief was wrong.
2. **"create-app suite is 610 tests / 607 pass."** It is **571 / 561 pass / 10 fail** in this tree, and
   the 10 failures are PRE-EXISTING — confirmed by stashing the slice work and re-running. Root cause
   is a stale build (`TypeError: assertPackageModuleFactsOnly is not a function` at
   `build.mjs:139`), the same stale-artifact trap recorded in the previous run. `yarn build:packages`
   is the fix; the baseline I quoted was from a built tree.

Slice A also found the brief undercounted: **eight** fields were unread, not seven — `baselineRef` too.

### Conflict warning carried forward

Slice H bumped two `maxBytes` values in `agentic/shared/ai/harness/cases.json`. Slices **C and D also
touch that file**. Integrate H before launching them, or expect a conflict.

Fix wave launched: each slice's findings written to a file, fixed in its existing worktree, then
re-verified by a fresh adversarial agent that re-runs every originally-vacuous probe.

## Wave 1 INTEGRATED — `3e27096ca`, full gate green

Three rounds of adversarial verification before anything merged. Round 1: all three slices
`needs-fixes`, 15 vacuous probes. Round 2: every original probe closed; deeper probing found new
holes in A and E. Round 3: A and E closed those; H `sound`.

### The two most instructive findings

**A's gate was redirectable, twice over.** Round 2 closed "delete the anchor key"; round 3 found
"change the anchor key" still open — the parity-ledger path was anchored only to a string inside the
asset under audit, so an author could point it at a rogue ledger they also committed. Now pinned to a
module-level literal; the inventory can only agree or fail. Separately the schema pin was purely
behavioural and an `anyOf` escape hatch defeated it (a schema can pass all 21 probes while accepting
anything) — now a SHA-256 pin.

**E introduced an escape hatch out of its own oracle.** `requiresGeneratedRegistry` made the
anti-silent-zero proof `continue`, with nothing checking the flag was warranted — one boolean could
silence the exact guarantee the ledger exists to provide. Same shape as the three silent-zero fact
families this programme already found.

### A cross-slice artifact that would have read as a defect

E's only blocking finding — `OMH-209 declares 113151 bytes against maxBytes 102400` — was NOT an E
defect. H raised that cap to 131072 independently, in a worktree E could not see. Verified by
comparing both worktrees' `cases.json` before concluding. Integrated together: read-policy 50/50.
**Lesson for later waves: a per-slice verifier cannot see cross-slice interactions. Check them at
integration, and do not let a verifier's blocking verdict short-circuit that check.**

### My brief was wrong twice more

- Eight fields were unread, not seven (`baselineRef` too) — found by slice A.
- The 10 "pre-existing" create-app failures the agents saw were stale-build artifacts. After
  `yarn build:packages` on the integrated tree the whole suite is green — 25/25 tasks. The agents
  were right that the failures pre-dated their work, and right to flag them; the cause was the
  worktrees never having been built.

### Also fixed during integration

H added 10 new i18n keys to en/de/es/pl but skipped `ko.json` (486 vs 496 keys), which would have
failed `i18n:check-sync`. Translated properly rather than left as English placeholders, and mirrored.

### Gate at `3e27096ca`

`build:packages`, `generate`, `i18n:check-sync`, `typecheck`, `test` **25/25 tasks**, `build:app`,
`repo-wide-guards` (27 files), `agents:check-budget` (exit 0), `template:sync`,
`validate-source-links` (8 assets / 136 dispositions / 125 topics),
`source-link-inventory --check` (125 records / 28 owners / 102 links) — all green.

### Wave state

| Wave | Slices | Status |
|---|---|---|
| 1 | A, E, H | **INTEGRATED** `3e27096ca` |
| 2 | C, F | next — H's `cases.json` bump is in, so the conflict warning is cleared |
| 3 | D, G | pending |
| 4 | B (15 integration specs) | pending — and they must be RUN, see the corrected constraint above |
| 5 | I + spec changelogs | pending |

## Wave 2, slice C — `sourceReferenceIds` INTEGRATED (`baf17a6ff`, `ad864d30e`)

Slice C's first two thirds are in. `context.sourceReferenceIds` exists end to end: schema field,
emitted inventory projection, evaluator resolution, allowlist widening, owner-before-follow rule,
trace with package/version/hash, and the whole negative half.

### The design decision worth defending

**`referenceId` IS `topicId`, not a second derivation of it.** The obvious alternative — mint a
separate `example.api.crud-factory`-style ID space, as the spec's illustrative example shows — was
rejected: two identifier spaces are free to drift, which is the exact defect class this programme
keeps finding. A test pins the equality so a later change has to argue for forking them.

### Repository inventory vs emitted projection

`source-link-inventory.test.ts` previously asserted the inventory is **never** copied into a
scaffolded app, and that assertion was right about the file it named. The full inventory carries
monorepo authoring paths, harness case IDs, baseline block IDs and repository-only QA evidence,
none of which mean anything in an app. So the app gets a **projection** of the same derivation
with those fields *dropped rather than blanked* — a blanked field reads as a real empty one. Both
artifacts are written and `--check`ed by the same generator run, so neither can be refreshed alone.

### Ledger: five/three/four → six/two/four

| Family | Before | After | Why |
|---|---|---|---|
| 6 | partial | **covered** | The absent/dead/directory/wildcard/orphan declared-link half now exists and each defect is staged one at a time into the real shipped projection, pinning the exact message it must produce. |
| 8 | partial | partial | Declared-reference half closed; the installed-package half remains. |
| 4 | uncovered | uncovered | **The blocker MOVED, and that is the honest outcome.** It was "the field does not exist". It is now "no emitted owner renders a link into `node_modules/@open-mercato/*/src/**`, so no record is `installed-package`". |

### Family 4 is genuinely smaller now, and the recon says the old rationale was false

The spec (L686/L690) defers installed-package targets because *"no gate in this batch can verify a
packed artifact"*. The wave-2 recon already falsified that: `npm pack --dry-run --json` **is** that
gate. So family 4 is doable — it needs `validate-source-links.mjs` to resolve a
`node_modules/@open-mercato/<pkg>/src/**` target against its workspace package and prove packed
presence, then one emitted owner to render such a link. That is the next unit of slice C work, not
a permanent deferral.

### Finding: two shipped cases route no link to their own capability

OMH-215 (`runtime.bulk-operation-progress`) and OMH-216 (the AI capabilities) declare **no**
references, because no owner they route renders a link to those capabilities. An agent routed
there is told about a capability no visible link can point it at. This is precisely the whole-
harness link-parity guarantee CANON-C is supposed to provide, and it does not hold for these two.
Fabricating references would have meant inventing links no owner renders, so it is recorded here
for the wave that owns owner rendering.

## Wave 2, slice C — installed-package references INTEGRATED, family 4 CLOSED

The blocker recorded above did not survive the same session. The recon's falsification was correct
and acting on it was cheap.

**The spec's deferral rationale was false.** Spec L686/L690 defers every `installed-package` target
because *"no gate in this batch can verify a packed artifact"*. `npm pack --dry-run --json` **is**
that gate — it lists the tarball contents without building or publishing, and
`packages/ui` packs `src/backend/DataTable.tsx` (verified: 1437 packed files, that path among them).

What landed:

- `validate-source-links.mjs` resolves a `node_modules/@open-mercato/<pkg>/src/**` link against the
  **publishing workspace package** and then against **what that package actually packs**. A file
  present in the workspace but excluded from the tarball is a dead link in every real app, and is
  now rejected as one.
- `.ai/guides/backend-ui.md` renders one such link, to the exact installed DataTable implementation.
- The inventory record carries `packageName` and `packageRelativePath`. It deliberately does **not**
  carry version or content hash: those belong to the install a given app made, so the evaluator
  reads them from that install at read time. Freezing them at derivation would be asserting
  something about someone else's `node_modules`.
- Four fixtures: the shipped record is packed-verified against the real `npm pack`; a declared
  installed reference is followed directly **with no reason code** (asserted against
  `trace.fallback`, so it cannot be confused with the family-5 fallback lane) and the trace carries
  package, version and hash; a sibling in the same packed directory is refused; and a target the
  app never installed fails closed.

### Two things the change broke, both of which were right to break

1. **A guide-budget violation.** The first version of the added paragraph pushed a case's declared
   initial context to 53291 bytes against a 53248 limit — 43 bytes over. The budget exists to keep
   guides tight, so the prose was tightened rather than the budget raised.
2. **A duplicated invariant.** `context-guidance-contracts.test.ts` carries its own copy of "every
   emitted owner links only to files a scaffolded app really has". It now **imports**
   `installedPackageTarget`/`packedFilesOf` from the validator instead of gaining a third
   re-implementation of the same rule.

### Ledger after slice C: seven covered, two partial, three uncovered

| Family | Status | Note |
|---|---|---|
| 4 | **covered** | Installed-package lane, end to end. |
| 6 | **covered** | Declared-link negative half. |
| 8 | partial | Only preset/tier applicability remains: every emitted owner ships in every preset, so no record narrows to one and "wrong preset" has nothing to be wrong about yet. |
| 9 | partial | Still needs the writable case. |
| 10, 11, 12 | uncovered | Untouched by this work. |

### Still open in slice C

- A **writable** shipped case declaring `exampleRoots` (family 9's second clause). Requires a new
  case beyond `OMH-216`, so it also moves `cases.schema.json`'s `minItems`/`maxItems`/id pattern,
  the fixture seeds, a validator ID and a writable oracle. Not started.
- Preset/tier applicability on inventory records (family 8's remainder).
- Visible links for OMH-215's and OMH-216's capabilities, so those two cases can declare
  references at all.

### Wave state

| Wave | Slices | Status |
|---|---|---|
| 1 | A, E, H | **INTEGRATED** `3e27096ca` |
| 2 | C (schema/evaluator/cases), F | C **mostly integrated** `baf17a6ff`, `ad864d30e`, plus the installed-package lane; C's writable case + preset/tier applicability open; F not started |
| 3 | D, G | pending |
| 4 | B (15 integration specs) | pending — and they must be RUN, see the corrected constraint above |
| 5 | I + spec changelogs | pending |

### Carried into wave 2

- Slice A left three minors: `isRegularFile` follows symlinks (string pin, not bytes-at-path);
  `checkSourceLinkInventory` returns silently when `baselinePath`/`baselineSchemaPath` are non-strings,
  delegating its preconditions to an author-editable schema read off disk; and `makeFixtureRoot` leaks
  `/tmp/om-knowledge-change-*` dirs (8944 swept).
- Slice E left two minors: `getFrameworkOverrideModes` now has no production consumer, and
  `CLOSED_LEDGER_STATUSES` is a test-local literal with no runtime counterpart.
- Slice H left three minors, all in `ai-overrides.test.ts` spy handling and one residual unqualified
  clause in the override reference.

## Wave 2, slices F and G — INTEGRATED (`b34f5bb98`, `11e84e4d2`, `f34827af6`)

Both design-system slices landed together, because the spec requires a **non-null**
`designFoundation` on every gallery item: shipping F without G would have produced an asset that
violated its own contract at every row. One derived asset, two facets.

### What landed

- `scripts/design-system-sources.mjs` — static readers for the PR #4301 gallery and the PR #4891
  Code Connect layer, through the TypeScript compiler API (both are TSX with live render closures
  and a Figma runtime, so neither can be imported by a plain Node script).
- `scripts/generate-design-system-inventory.mjs` (+ `harness:generate/check-design-system-inventory`)
  — derives `design-system-inventory.json` and its app-facing projection: **113 items across 17
  families, 297 variants**, each with entry source, resolved implementation, route, per-preset
  availability and a closed `designFoundation`.
- `designSystemReferences` — the 8 canonical example UI rows mapped: **10 direct, 6
  composite-not-direct, 4 named coverage gaps**, one row (`ui.frontend-page`) with nothing to map.
- 19 create-app tests + 5 runtime parity tests in `packages/core`.

### The parity decision worth defending

A static reader is a convenience, **not a second authority**. `inventory-parity.test.ts` loads the
real registry and asserts the derived asset matches it family for family, entry for entry, variant
for variant. Mutation-probed: an under-counted variant list and an invented node id each kill it.
Without that, a reader that quietly failed to resolve some shape would ship an inventory that
under-reports the gallery while every other gate stayed green.

That risk was not hypothetical. The first reader returned **one** variant for `state-tokens` where
seven render, because the family builds them with `...FIGMA_STATE_TO_CODE.map(...)`. The reader now
resolves that shape and **throws** on any spread it cannot account for — silence was the bug.

### Five findings, three of which contradict something previously written down

1. **The recon's "no `./figma/*` export key" was right for the wrong reason.** `@open-mercato/ui`
   *does* declare wildcard export keys (`./*`, `./*/*`, …) — but every one targets `./src/**`, and
   the Code Connect files live *outside* `src/`. So they are packed and still unreachable by any
   public specifier. `codeConnectArtifactAvailability` and `codeConnectExportStatus` are recorded
   separately precisely so "packed" can never imply "importable".
2. **The spec's audited head `fb9b8ddfe` is NOT an ancestor of this tree** — verified, not assumed.
   PR #4277 was closed and merged nothing. The generator keeps it as provenance only and checks the
   **real** baseline `b2d26489c` (PR #4891) for ancestry on every run.
3. **Drawer is the only `nodeComparison: "match"`**, exactly as the recon predicted — now derived
   rather than asserted. Alert has a real Code Connect node with no gallery counterpart, and Table
   has a gallery node with no mapping; both are `not-comparable`, because the two node authorities
   stay independent.
4. **A generic type argument is not a rendered component.** `useState<FilterValues>` matched a
   naive JSX probe and manufactured a visual reference for a type-only import. Caught in this
   slice's own output before commit.
5. **A barrel module is not evidence of direct coverage.** The first pass credited the gallery with
   covering `SendObjectMessageDialog` because a sibling entry shares its module. It does not.
   Direct coverage now needs an unambiguous one-entry module or an entry whose snippet renders the
   symbol; that component moved to a named gap.

### A gallery gap this work surfaces, owned by another module

`ValueIcons` (`BooleanIcon`, `EnumBadge`) is rendered by the canonical DataTable rows, has **no**
gallery entry, and its implementation composes nothing the gallery covers. Recorded as a named gap,
never fabricated. **Why it went unnoticed:** `gallery-coverage.test.ts` only scans
`packages/ui/src/primitives`, so `src/backend` components are outside the guard entirely. Closing
this means adding the entry through `design_system`, not pasting an implementation into `example`.

### Deliberately NOT done, and stated rather than implied

The references live in the derived asset and are joined to `surface-inventory.json` by
`capabilityId`; they are **not yet inlined into the canonical rows themselves**, which is the shape
the spec's row definition describes. Inlining means the generator becomes a writer for that file
and its template mirror. That is the next unit of F work, not a completed one.

## Slice B is UNBLOCKED — the integration lane was executed here, green, on 2026-08-06

The corrected constraint above said the fifteen specs "may be executable here … to be attempted, not
assumed". It has now been **attempted and proven**, so no future entry may record slice B as
write-only. `TC-EXAMPLE-001` was run end to end through the managed ephemeral runner and **passed**:

```
$ yarn test:integration:ephemeral --filter TC-EXAMPLE-001 --verbose
Running 1 test using 1 worker
  ✓  1 …/TC-EXAMPLE-001-todo-label-edit.spec.ts:58:3 › … replaces its search token (3.7s)
  1 passed (6.9m)
```

The whole stack works in this environment: testcontainers Postgres, migrations for 30+ modules,
`yarn initialize`, the production app build, the app on `127.0.0.1:5001`, and the queue workers.

**Three findings that cost the first two attempts, recorded so the next run skips them:**

1. **A worktree needs `yarn generate && yarn build:packages` before the ephemeral runner.** Without
   it the run dies at bootstrap on `packages/core/dist/generated/entities.ids.generated.js`, and the
   message names `audit_logs`/`wms` rather than the missing generation step, which reads like a
   module defect instead of a build-order one.
2. **The trailing `exit code 143` is teardown, not failure.** The runner reports
   `[server] Next.js production server exited unexpectedly with exit code 143` *after* Playwright has
   already printed its result; 143 is SIGTERM from the runner's own shutdown. Read the Playwright
   tally, not the last line — the green run above still ends with that message.
3. **Chromium's system libraries are absent here and there is no root.** The failure surfaces as
   `browserType.launch: Target page, context or browser has been closed` with a 1 ms test duration,
   which reads like a test defect; the real cause is
   `chrome-headless-shell: error while loading shared libraries: libnspr4.so`. Eleven libraries are
   missing (`libnspr4`, `libnss3`, `libnssutil3`, `libasound2t64`, `libgbm1`, `libxcomposite1`,
   `libxdamage1`, `libxfixes3`, `libxkbcommon0`, `libxrandr2`, `libxrender1`). `playwright
   install-deps` needs root, but the packages can be staged into userspace without it:

   ```bash
   mkdir -p /tmp/om-pw-libs && cd /tmp/om-pw-libs
   apt-get download libnspr4 libnss3 libasound2t64 libgbm1 libxcomposite1 \
     libxdamage1 libxfixes3 libxkbcommon0 libxrandr2 libxrender1
   for f in *.deb; do dpkg -x "$f" extracted; done
   export LD_LIBRARY_PATH=/tmp/om-pw-libs/extracted/usr/lib/x86_64-linux-gnu:$LD_LIBRARY_PATH
   ```

   This modifies nothing outside `/tmp` and is a machine property, not a repository change, so
   nothing about it belongs in the tree — it belongs here, where the next run will look.

### Wave state

| Wave | Slices | Status |
|---|---|---|
| 1 | A, E, H | **INTEGRATED** `3e27096ca` |
| 2 | C | mostly integrated; writable case + preset/tier applicability still open |
| 2 | F, G | **INTEGRATED** `b34f5bb98`, `11e84e4d2`, `f34827af6` |
| 3 | D | not started |
| 4 | B (15 integration specs) | not started — and they must be RUN |
| 5 | I + spec changelogs | not started |
