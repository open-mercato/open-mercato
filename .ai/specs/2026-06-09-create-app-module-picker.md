# create-mercato-app — Per-Module Picker & Official-Modules Selection

- **Status:** Draft
- **Date:** 2026-06-09
- **Scope:** OSS
- **Owner:** Platform / DX
- **Affected package:** `packages/create-app` (`create-mercato-app`)
- **Related:**
  - `.ai/specs/2026-05-19-official-modules-generated-location-decision.md`
  - `.ai/specs/2026-05-12-railway-one-command-deploy.md`
  - `packages/create-app/AGENTS.md`
  - `apps/docs/docs/architecture/module-dependencies.mdx`

---

## TLDR

After the user picks a starter preset (`classic` / `empty` / `crm`), `create-mercato-app` will offer an
optional **module picker**: a checklist of individual modules (core + official) seeded from the chosen
preset, where toggling a module that declares `requires` auto-includes its transitive dependencies with a
one-line notice. Official modules from `open-mercato/official-modules` become first-class picker entries;
selecting them pre-seeds the scaffolded app's `official-modules.json` activated set, and the scaffolder now
**ships the full `official-modules` CLI + postinstall worker into the template** so the generated app can keep
running `yarn official-modules add <x>` after creation. The selectable catalog is fetched live at scaffold
time with a graceful offline fallback to preset-only + free-text entry.

The result: a user can start from a preset, then dial modules in/out (including community/official ones)
without hand-editing `src/modules.ts`, and dependencies are never silently broken.

---

## Problem Statement

Today the scaffolder (`packages/create-app/src/index.ts`) offers exactly three fixed module sets:

```
PRESET_PROMPT_OPTIONS = [ classic (default), empty, crm ]
```

Each preset resolves to a fixed `ModuleEntry[]` (`src/lib/starter-presets.ts` →
`resolvePreset()` → `generateModulesTs()`), written into the new app's `src/modules.ts`. There is **no way to
customize the module set during scaffolding**. To add or remove a module a user must:

1. Finish scaffolding,
2. hand-edit `src/modules.ts`,
3. for official/community modules, manually replicate the monorepo-only `official-modules` tooling, because
   the template ships **only an empty `official-modules.generated.ts`** — not the CLI
   (`scripts/official-modules.mjs`), the config (`official-modules.json`), or the postinstall worker
   (`scripts/official-modules-setup.mjs`).

Two concrete gaps:

- **No per-module control.** Presets are all-or-nothing. A user who wants `empty + sales` or
  `crm − ai_assistant` has no guided path and can easily produce a broken `modules.ts` that violates the
  module dependency graph (e.g. enabling `sales` without `catalog`/`customers`/`dictionaries`).
- **Official modules are unreachable from a fresh app.** The `yarn official-modules` CLI and its submodule
  wiring exist only in the monorepo root. A scaffolded standalone app cannot discover or activate official
  modules without manual, undocumented surgery.

### Existing primitives we build on (do not reinvent)

- **Module dependency declaration** is already canonical: each module exports
  `metadata: ModuleInfo` with an optional `requires: string[]`
  (`packages/shared/src/modules/registry.ts`). Real examples:
  `sales → [catalog, customers, dictionaries]`, `staff → [planner, resources]`,
  `entities → [query_index]`, `portal → [customer_accounts]`, `api_keys → [auth]`.
- **Dependency validation already exists** at generate time: the module-registry generator collects
  `requiresByModule` and `process.exit(1)`s with a clear message if any enabled module's `requires` is not
  satisfied (`packages/cli/src/lib/generators/module-registry.ts`, the
  "Validate module dependencies declared via ModuleInfo.requires" block). This is our **backstop** — the
  picker should never produce a set that fails this check.
- **Official-modules machinery already exists** in the monorepo: `scripts/official-modules.mjs` (CLI),
  `scripts/lib/official-modules.mjs` (helpers: `readConfig`, `scanAvailable`, `writeConfig`,
  `writeGenerated`, `renderGenerated`, `moduleId`, `packageName`), `scripts/official-modules-setup.mjs`
  (postinstall worker), `official-modules.json` (committed) + `official-modules.local.json` (gitignored),
  and the generated registry `apps/mercato/src/official-modules.generated.ts`
  (`officialModuleEntries: ModuleEntry[]`, merged into `enabledModules` by `src/modules.ts`).
- **Module-id convention:** package `@open-mercato/<suffix>` ⇒ module id `<suffix>` with dashes → underscores
  (e.g. `@open-mercato/ai-assistant` ⇒ `ai_assistant`).

The spec's job is to **compose these existing primitives** into a guided scaffold-time experience, and to make
the official-modules tooling travel with the generated app.

---

## Goals & Non-Goals

### Goals

1. After preset selection, offer an optional interactive **module picker** seeded with the preset's modules.
2. Treat **core modules and official modules uniformly** as catalog entries.
3. **Auto-include `requires` (transitively)** when a module is selected, printing a notice; never emit a
   `modules.ts` that fails the generate-time dependency check.
4. When official modules are selected, **pre-seed `official-modules.json`** in the new app and ship the
   `official-modules` CLI + postinstall worker so the generated app can keep managing them.
5. **Live-fetch** the catalog at scaffold time, with a graceful **offline fallback** (preset-only set +
   optional free-text module entry) so the scaffolder never hard-fails without network.
6. Remain fully **non-interactive-friendly**: a `--modules` / `--official-modules` CLI flag path so CI and
   scripted scaffolds skip prompts.

### Non-Goals

- No backend/admin UI — this is a terminal scaffolder (`node:readline`, no new prompt dependency).
- No change to the monorepo-root `official-modules` CLI semantics.
- No change to the `ModuleInfo.requires` declaration format or the generate-time validator.
- No attempt to resolve **npm peerDependencies** between provider packages; the source of truth for
  module-level deps remains `ModuleInfo.requires` (npm deps are an install concern handled by `yarn install`).

---

## Proposed Solution

### High-level flow (additive to the current flow)

```
parseArgs()                          ← + --modules, --official-modules, --no-module-picker
  ↓
resolveReadyAppSource()
  ↓
promptForStarterPreset()             ← unchanged (classic | empty | crm)
  ↓
resolvePreset(presetId)              ← unchanged → ResolvedPreset.modules: ModuleEntry[]
  ↓
NEW: runModulePicker(preset, catalog)
       ├─ fetchCatalog()             ← live remote fetch (+ offline fallback)
       ├─ checklist seeded from preset
       ├─ on toggle: auto-include requires (transitive) + notice
       └─ split selection → { coreEntries: ModuleEntry[], officialIds: string[] }
  ↓
scaffold base template (copyDirRecursive)
  ↓
NEW: writeModulesTs(coreEntries)     ← supersedes applyStarterPreset for the modules.ts write
NEW: writeOfficialModulesConfig(officialIds)   ← official-modules.json activated[]
NEW: ship official-modules tooling into the app (scripts + postinstall + config)
  ↓
agentic setup wizard → git init → next steps
```

`classic` keeps its current "use the template's built-in `modules.ts` verbatim" behavior **when the picker is
skipped**; if the user opens the picker on a classic project, the picker is seeded from the template's full
module list (read from the just-copied `src/modules.ts`) so toggling is still consistent.

### The module catalog

The picker needs `{ id, from, title, description, requires }` for every selectable module **before
`yarn install` runs and before any submodule is cloned**. We define a single normalized shape:

```ts
// packages/create-app/src/lib/catalog/types.ts
export type CatalogModule = {
  id: string                       // 'sales'
  from: string                     // '@open-mercato/core' | '@open-mercato/<pkg>'
  title: string                    // 'Sales Management'
  description: string
  requires: string[]               // ['catalog','customers','dictionaries']
  source: 'core' | 'official'
  defaultInPreset?: boolean        // seeded checked for the active preset
}

export type ModuleCatalog = {
  fetchedAt: string
  core: CatalogModule[]
  official: CatalogModule[]
}
```

#### Catalog source — live remote fetch (decision)

Per the maintainer decision, the catalog is **fetched live at scaffold time**, keyed to the create-app's
`PACKAGE_VERSION`:

- **Core catalog:** a published manifest `module-catalog.json` produced from core module `metadata` and served
  from the `open-mercato/open-mercato` repo at the tag matching `PACKAGE_VERSION` (raw GitHub URL), falling
  back to `main`. This manifest is generated by a new build step (Phase 1) that walks
  `packages/core/src/modules/*/index.ts` + the other first-party module packages and emits
  `{ id, from, title, description, requires }`.
- **Official catalog:** a manifest published in the `open-mercato/official-modules` repo (e.g.
  `module-catalog.json` at repo root, or derived from each `packages/*/package.json` + `index.ts`). The
  scaffolder fetches it from the raw GitHub URL. This avoids cloning the submodule just to list options.

Fetch contract:

- Hard timeout (default **4s** per request) and a single retry.
- Responses cached for the process run; no global cache file is written into the new app.
- **Never block scaffolding indefinitely.** Any fetch failure (offline, rate-limited, 404 for the version tag)
  degrades to the offline fallback below, with a printed notice.

#### Offline fallback

When the catalog cannot be fetched:

- **Core:** fall back to a **minimal baked snapshot** of the core catalog embedded in the create-app bundle at
  build time (same generator as the published manifest, written to `dist/`). This guarantees the **core**
  picker always works offline. The notice states the snapshot may lag the installed `@open-mercato/core`
  version; the generate-time validator remains the final authority.
- **Official:** no baked snapshot (the official set is external and version-fluid). Instead, offer **free-text
  entry**: the user types comma-separated official module ids/suffixes; they are recorded in
  `official-modules.json` `activated[]` **unvalidated**, and the app's postinstall worker validates them
  against the cloned submodule on first `yarn install` (its existing "warns if activated id not in available"
  path). This matches how the monorepo CLI already behaves.

> Note: "Live remote fetch" is the primary path for both core and official; the baked core snapshot exists
> **only** as the offline safety net so `create-mercato-app` never hard-fails without network. This is a
> reliability requirement, not a second catalog source of truth.

### The picker UX

Implemented with the existing `node:readline` `ask()` helper (no new dependency), mirroring the numbered-list
style of `promptForStarterPreset` and the comma-separated multi-select of the agentic wizard.

```
🧩  Module selection
   Preset "crm" enables 14 modules. Customize the set? [y/N]: y

   Core modules (space-separated numbers to toggle, Enter to accept):
     [x]  1. auth            Authentication & sessions
     [x]  2. customers       Customer records
     [ ]  3. sales           Quoting, ordering, fulfillment      (requires: catalog, customers, dictionaries)
     [ ]  4. catalog         Products & pricing
     ...
   Official modules (from open-mercato/official-modules):
     [ ] 21. forms           Form builder
     [ ] 22. sdk             Typed SDK
   Toggle numbers [Enter to accept]: 3

   ✓ Added "sales" — also enabling required modules: catalog, dictionaries
   Toggle numbers [Enter to accept]:
   → 16 modules selected (15 core, 1 official)
```

Rules:

- The list is **seeded from the resolved preset** (`defaultInPreset` → checked).
- Toggling **on** a module pulls in its transitive `requires` (computed against the catalog graph) and prints
  `✓ Added "<id>" — also enabling required modules: <list>`.
- Toggling **off** a module that is a `requires` target of another *selected* module is **blocked** with a
  notice naming the dependents (so the user can't create an invalid set interactively). They must deselect the
  dependent first.
- `Cmd/Ctrl+Enter` does not apply in a raw readline list; **Enter on an empty toggle line accepts** the set,
  and `Ctrl+C` aborts the whole scaffold (existing behavior).
- Selecting an **official** module that itself declares `requires` on a **core** module auto-includes the core
  module (and vice-versa) using the same unified graph.

### Dependency auto-resolution

A pure function operating on the merged catalog graph:

```ts
// packages/create-app/src/lib/catalog/resolve-deps.ts
export function resolveWithDependencies(
  selectedIds: Set<string>,
  catalog: ModuleCatalog,
): { ids: Set<string>; added: Record<string, string[]> }
```

- Builds `id → requires[]` from `catalog.core ∪ catalog.official`.
- Computes the transitive closure of `selectedIds`.
- Returns the full id set plus, per originally-selected id, which extra ids it pulled in (for the notice).
- **Cycle-safe** (visited set) and **missing-dep-tolerant**: if a `requires` id is absent from the catalog
  (e.g. a stale official manifest), it is recorded in a `warnings` list and surfaced, not crashed — the
  generate-time validator will catch a truly-missing module later.

### Writing the result

After the picker returns `{ coreEntries, officialIds }`:

1. **`src/modules.ts`** — write `coreEntries` (core + first-party package modules) via the existing
   `generateModulesTs()` path (the same `modules-ts.template` used by `applyStarterPreset`). Official modules
   are **not** written here; they flow through `official-modules.generated.ts` exactly as in the monorepo
   (the template's `modules.ts` already merges `officialModuleEntries`).
2. **`official-modules.json`** — write `{ repo, path, branch, available: [], activated: officialIds }` so the
   scaffolded app's postinstall worker clones the submodule and regenerates the registry on first install.
3. **`official-modules.generated.ts`** — write the activated entries immediately via the shared
   `renderGenerated(officialIds)` logic so the app **builds even before** the first postinstall completes (the
   template already ships a placeholder; we replace it with the selected set). The submodule is what actually
   provides the code — until `yarn install` clones it, the entries reference not-yet-present packages, which is
   acceptable because the user has not built yet and the next step in "next steps" is `yarn install`.

### Shipping the official-modules tooling into the template (decision)

To make `yarn official-modules add <x>` work in a generated app, the template gains:

- `scripts/official-modules.mjs`, `scripts/official-modules-setup.mjs`, `scripts/lib/official-modules.mjs`
  (copied from the monorepo; these are already path-relative and repo-root anchored).
- `official-modules.json` (committed, with `activated` seeded by the picker).
- `official-modules.local.json` added to the template's `.gitignore`.
- `package.json` scripts: `"official-modules": "node scripts/official-modules.mjs"` and a
  `"postinstall": "node scripts/official-modules-setup.mjs"` (merged with any existing postinstall).

These scripts must run **unchanged** outside the monorepo. The spec includes a Phase-2 audit step to confirm
they have no monorepo-only assumptions (e.g. workspace globs); any that exist are parameterized via
`official-modules.json` (`repo`, `path`, `branch`) which already drive them.

> **Maintenance contract:** these three scripts now have **two homes** (monorepo root + template). Per
> `packages/create-app/AGENTS.md` template-sync rules, the Phase-2 work adds them to the template-sync
> checklist and the existing `scripts/__tests__/official-modules.test.mjs` is extended to assert the template
> copy stays byte-identical to the monorepo copy (drift guard), the same way the test already asserts the
> template ships `official-modules.generated.ts`.

### CLI / non-interactive path

```
create-mercato-app my-app \
  --preset empty \
  --modules sales,dashboards \           # core ids; deps auto-included
  --official-modules forms,sdk \         # official ids → official-modules.json activated[]
  --no-module-picker                     # never prompt (CI)
```

- `--modules` and `--official-modules` skip the interactive picker and run the same
  `resolveWithDependencies` + writers.
- `--no-module-picker` with no `--modules` keeps today's exact behavior (preset only) — **backward
  compatible default**.
- Omitting all module flags **and** a TTY present → interactive picker offered (opt-in `y/N`, default **N** to
  preserve current zero-friction UX).

---

## Architecture & Compliance Notes

- **No new prompt dependency** — reuse `node:readline` `ask()` (AGENTS.md: keep create-app dependency-light).
- **Singular naming** preserved (module ids are already singular/canonical snake_case).
- **No cross-module ORM / tenant concerns** — this is a build-time scaffolder, no runtime data access.
- **Source of truth for deps** stays `ModuleInfo.requires`; the catalog is a derived, cached projection of it,
  and the generate-time validator stays the final gate. The picker is a UX convenience + early-warning, never
  an authority that can diverge.
- **Generated-file contract:** `official-modules.generated.ts` remains a *versioned* generated registry that
  must survive `yarn clean-generated` — unchanged from
  `.ai/specs/2026-05-19-official-modules-generated-location-decision.md`.
- **Ready-app imports unaffected:** when `--app`/`--app-url` import a ready app, the picker is **skipped**
  (same rule as the agentic wizard and preset constraints — `constraints.rejectWithReadyApps`).

---

## Phasing

### Phase 1 — Catalog generation & fetch (no UX yet)

Deliver the catalog plumbing behind a flag, fully testable in isolation.

- **1.1** Build-time generator: scan first-party module packages' `index.ts` `metadata` and emit
  `module-catalog.json` (core) into `dist/` (baked offline snapshot) **and** publishable artifact. Add to
  `packages/create-app/build.mjs`.
- **1.2** `CatalogModule` / `ModuleCatalog` types + `fetchCatalog()` with timeout, retry, version-tag URL, and
  offline fallback to the baked snapshot (core) / free-text (official). Pure, unit-tested with a mocked
  fetch.
- **1.3** Publish an official `module-catalog.json` manifest contract in `open-mercato/official-modules`
  (documented here; the manifest file itself is a coordinated change in that repo). Define the exact JSON
  shape and the raw-URL the scaffolder reads.
- **1.4** `resolveWithDependencies()` — transitive closure, cycle-safe, warnings for missing deps. Unit tests
  including `sales → catalog,customers,dictionaries` and `staff → planner,resources` (resources → planner).

**Exit:** `fetchCatalog()` + `resolveWithDependencies()` covered by unit tests; no behavior change to the CLI.

### Phase 2 — Ship official-modules tooling into the template

- **2.1** Copy `scripts/official-modules.mjs`, `scripts/official-modules-setup.mjs`,
  `scripts/lib/official-modules.mjs` into `packages/create-app/template/scripts/`.
- **2.2** Add `official-modules.json` to the template; add `official-modules.local.json` to template
  `.gitignore`; add `official-modules` + `postinstall` scripts to template `package.json`.
- **2.3** Audit scripts for monorepo-only assumptions; parameterize anything not already driven by
  `official-modules.json`.
- **2.4** Extend `scripts/__tests__/official-modules.test.mjs` with a drift guard asserting the template copies
  match the monorepo originals; add to `packages/create-app/AGENTS.md` template-sync checklist.

**Exit:** a freshly scaffolded app (with no picker selection) can run `yarn official-modules add forms` and
get a working submodule + regenerated registry.

### Phase 3 — Interactive picker & writers

- **3.1** `runModulePicker()` readline UX: seed from preset, toggle, auto-include notice, deselect-blocking.
- **3.2** `writeModulesTs(coreEntries)` (reuse `generateModulesTs`) and
  `writeOfficialModulesSelection(officialIds)` (`official-modules.json` activated + `official-modules.generated.ts`
  via shared `renderGenerated`).
- **3.3** Wire into `main()` after `resolvePreset`; respect `rejectWithReadyApps`; default-N opt-in prompt.
- **3.4** `--modules`, `--official-modules`, `--no-module-picker` flags in `parseArgs()` + `--help` text.

**Exit:** end-to-end interactive and flag-driven scaffolds produce a valid `modules.ts` + seeded
`official-modules.json` that passes `yarn generate`.

### Phase 4 — Docs & polish

- **4.1** Update `packages/create-app/AGENTS.md` (new flags, template-sync entries, picker behavior).
- **4.2** Update standalone-app docs / `apps/docs` create-app page with the picker + official-modules walkthrough.
- **4.3** Update `RELEASE_NOTES.md` / changelog (additive feature).

---

## Test & Integration Coverage

Per project rule, every new feature lists integration coverage for all affected paths.

### Unit tests (`packages/create-app`, `yarn test:create-app`)

- `resolveWithDependencies`: transitive closure, cycle safety, missing-dep warning, no-op when no deps.
- `fetchCatalog`: success parse; timeout → offline fallback; 404 version tag → `main` fallback → baked
  snapshot; official fetch failure → free-text mode flag.
- `writeModulesTs`: emitted `src/modules.ts` matches `generateModulesTs` output for a known selection.
- `writeOfficialModulesSelection`: `official-modules.json` `activated` + `official-modules.generated.ts`
  content equals shared `renderGenerated` output (sorted, deduped).
- `parseArgs`: `--modules`, `--official-modules`, `--no-module-picker` parsed; mutually-consistent defaults.

### Catalog/drift guards (`scripts/__tests__/official-modules.test.mjs`)

- Template `scripts/official-modules*.mjs` are byte-identical to monorepo originals (sync guard).
- Template ships `official-modules.json` and the `official-modules` + `postinstall` package scripts.

### Integration tests (`yarn test:create-app:integration`)

- **Preset-only, no picker** (default): scaffolds identically to today (regression lock).
- **Flag-driven core selection:** `--preset empty --modules sales --no-module-picker` →
  `src/modules.ts` includes `sales, catalog, customers, dictionaries`; `yarn generate` passes (dependency
  validator green).
- **Flag-driven official selection:** `--official-modules forms` → `official-modules.json` activated includes
  `forms`; `official-modules.generated.ts` includes `{ id: 'forms', from: '@open-mercato/forms' }`.
- **Offline core fallback:** with network fetch stubbed to fail, picker still lists core modules from the baked
  snapshot and produces a buildable app.
- **Generated app runs `official-modules`:** in the scaffolded app, `yarn official-modules` prints status
  (smoke), proving the tooling travels (network-gated; skip in offline CI with a clear skip reason).

---

## Backward Compatibility

| Surface | Impact | Handling |
|---|---|---|
| `create-mercato-app` default invocation | **None** | Picker is opt-in (`y/N` default N); with no new flags the output is byte-identical to today. |
| Existing `--preset` flag | **None** | Unchanged; picker seeds from the resolved preset. |
| `src/modules.ts` shape | **None** | Same `ModuleEntry[]` written via the same `generateModulesTs` template. |
| `official-modules.generated.ts` contract | **None** | Same shape, produced by the same shared `renderGenerated`. |
| Template `package.json` | **Additive** | Adds `official-modules` + `postinstall` scripts; merges, does not replace, any existing postinstall. |
| Monorepo-root `official-modules` CLI | **None** | Not modified; template gets copies guarded by a drift test. |
| `ModuleInfo.requires` / generate-time validator | **None** | Reused as-is; picker is an early-warning layer above it. |

No frozen/stable contract surface is removed. New CLI flags are additive. New template files are additive.
The deprecation protocol is not triggered.

---

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Network fetch slows or hangs scaffolding | 4s timeout + 1 retry + baked core snapshot fallback; never block on official fetch. |
| Catalog dep graph drifts from installed package version | Picker is advisory; generate-time validator is the authority; notice warns snapshot may lag. |
| Official manifest missing/stale in official-modules repo | Free-text entry path + postinstall validation against the cloned submodule (existing behavior). |
| Two copies of `official-modules*.mjs` drift | Byte-identical drift guard test + template-sync checklist entry. |
| User builds a broken set despite picker | Deselect-blocking + auto-include keep interactive sets valid; generate-time check is the final gate. |
| Ready-app import + picker conflict | Picker skipped for `--app`/`--app-url` via `rejectWithReadyApps`, matching the agentic wizard. |

---

## Open Questions

_None outstanding._ The three forking decisions (official-modules reach, catalog source, dependency UX) were
resolved with the maintainer on 2026-06-09 and are recorded under "Proposed Solution".

---

## Changelog

- 2026-06-09 — Initial draft. Decisions captured: ship full official-modules tooling into the template; live
  remote catalog fetch with baked core offline fallback; auto-include transitive `requires` with a notice.
