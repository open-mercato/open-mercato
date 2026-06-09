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

To make `yarn official-modules add <x>` work in a generated app, the template gains copies of the three
monorepo scripts plus config + `package.json` wiring. **A source-level audit (done while writing this spec)
found three monorepo-only assumptions that block a verbatim copy — they are the real Phase-2 work, not
hypotheticals:**

#### Blocker A — `GENERATED_PATH` is hardcoded to `apps/mercato/src/`

`scripts/lib/official-modules.mjs:20` defines:

```js
export const GENERATED_PATH = path.join(repoRoot, 'apps', 'mercato', 'src', 'official-modules.generated.ts')
```

A standalone app has no `apps/mercato/` — its registry lives at `src/official-modules.generated.ts` (app
root). `repoRoot` itself is fine (`path.resolve(here, '..', '..')` → app root when the file sits at
`<app>/scripts/lib/official-modules.mjs`), but the `apps/mercato/src` segment is wrong.

**Fix (BC-preserving, keeps all three scripts byte-identical across both homes):** add an optional
`generatedPath` key to `official-modules.json`, consumed by `readConfig()` and used to derive
`GENERATED_PATH`. Default value `apps/mercato/src/official-modules.generated.ts` (monorepo behavior
unchanged — its `official-modules.json` omits the key). The template's `official-modules.json` sets
`"generatedPath": "src/official-modules.generated.ts"`. `writeGenerated()` / `writeConfig()` /
`renderGenerated()` are otherwise unchanged. Because the *behavior* is config-driven, the **script files
remain identical** between monorepo and template → the drift guard (below) stays a simple equality check.

> The location-decision rationale comment baked into `renderGenerated()` output (and the shipped
> `template/src/official-modules.generated.ts`) still references `apps/mercato/src/` and the
> `2026-05-19-...` decision spec. That comment is informational and identical in both homes — leave it as-is
> so the generated content stays byte-identical; do not branch the comment per layout.

#### Blocker B — submodule packages must be Yarn workspaces, and git must exist

The postinstall worker (`scripts/official-modules-setup.mjs`) runs `git submodule add` at `cwd: repoRoot` and
**no-ops entirely when the dir is not a git work-tree** (`isGitWorkTree()` guard, line 50). And even after the
submodule is cloned, Yarn only links `external/official-modules/packages/*` if they are declared as
workspaces. The monorepo root `package.json:9-13` already lists `"external/official-modules/packages/*"` in
`workspaces`; the template's `package.json.template` has **no `workspaces` field at all** (it is a single
app).

**Consequence the spec must make explicit:** official modules in a scaffolded app require (1) the app to be a
git repo, and (2) a `workspaces` entry. Therefore Phase 2 adds a minimal `workspaces`:
`["external/official-modules/packages/*"]` to `package.json.template`, and Phase 3 makes the git-init prompt
**default-yes and strongly recommended** whenever official modules were selected (a plain non-git app can
still pick core modules freely). The install flow becomes a documented two-pass dance (see "Install
ordering" below).

#### Blocker C — the generated `modules.ts` template omits the official-modules merge

`src/lib/templates/modules-ts.template` (used by `generateModulesTs()` for every non-classic preset) does
**not** import or merge `officialModuleEntries`. Only the full classic `template/src/modules.ts` does
(lines 11, 140-142). So today, an `empty`/`crm` scaffold already silently loses official-modules support.
Phase 2 fixes the template to include the import + merge loop so the picker's generated `modules.ts` supports
official modules:

```ts
import { officialModuleEntries } from './official-modules.generated'
// …after the enterprise blocks…
for (const entry of officialModuleEntries) {
  if (!enabledModules.some((existing) => existing.id === entry.id)) enabledModules.push(entry)
}
```

#### Install ordering (document in the generated app's next-steps + docs)

When official modules are selected, the post-scaffold flow is:

1. Scaffolder seeds `official-modules.json` `activated`, writes `src/official-modules.generated.ts`
   (via shared `renderGenerated`), adds the `workspaces` entry, and defaults git-init to yes.
2. `git init` (offered by the scaffolder) → app is a git work-tree.
3. First `yarn install` → `postinstall` runs → git repo + `activated > 0` → `git submodule add` clones
   `external/official-modules` → refreshes `available` → regenerates the registry → prints
   "run `yarn install` once more so Yarn links them as workspaces".
4. Second `yarn install` → Yarn links the now-present submodule packages.

This mirrors the monorepo's own behavior exactly (the worker already prints the same "run yarn install once
more" hint). `printTemplateNextSteps()` (`src/index.ts:439`) must surface this when official modules were
chosen.

> **Maintenance contract:** the three scripts now have **two homes** (monorepo `scripts/` + template
> `scripts/`). Per `packages/create-app/AGENTS.md` § "Template Sync Checklist", Phase 2 adds three rows and
> extends `scripts/__tests__/official-modules.test.mjs` with a byte-identical drift guard — exactly as the
> test already asserts the template ships `official-modules.generated.ts`.

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

> Every step below names the **exact files** to add or edit. New files are marked `(new)`; edits cite the
> current line anchors confirmed against `develop` at spec time. A consolidated table follows in
> "Exact File Inventory".

### Phase 1 — Catalog generation & fetch (no UX yet)

Deliver the catalog plumbing as pure, isolated modules. No change to the CLI flow yet.

- **1.1 — Catalog build-time generator.**
  - `(new)` `packages/create-app/scripts/generate-module-catalog.mjs` — walks the first-party module packages'
    `index.ts` `metadata` exports (core modules under `packages/core/src/modules/*/index.ts`, plus the
    package-backed first-party modules already referenced by presets: `@open-mercato/events`,
    `@open-mercato/ai-assistant`) and emits `{ id, from, title, description, requires }[]`.
  - Edit `packages/create-app/build.mjs` — after the esbuild step (around line 18) and the
    `src/lib/templates` copy (line 24-27), run the generator and write the baked snapshot to
    `dist/module-catalog.core.json`. Mirror the existing `cpSync`/`console.log` style.
  - `(new)` `packages/create-app/src/lib/catalog/baked-core-catalog.json` is **not** hand-authored; it is the
    generator output committed for offline use, or generated into `dist/` only — decide in 1.1 whether to
    commit it (preferred: commit so the published npm tarball always carries it, since `dist/` is published).
- **1.2 — Catalog types + fetch.**
  - `(new)` `packages/create-app/src/lib/catalog/types.ts` — `CatalogModule`, `ModuleCatalog` (shapes in
    "The module catalog").
  - `(new)` `packages/create-app/src/lib/catalog/fetch-catalog.ts` — `fetchCatalog(version, opts)`: version-tag
    raw-GitHub URLs for core (`open-mercato/open-mercato`) and official
    (`open-mercato/official-modules`), 4s timeout + 1 retry, `main` fallback, then baked-core-snapshot /
    free-text fallbacks. Uses global `fetch` (Node 18+ target already set in `build.mjs`).
  - `(new)` `packages/create-app/src/lib/catalog/fetch-catalog.test.ts`.
- **1.3 — Official manifest contract (coordinated, external repo).** Document in this spec the JSON shape and
  the exact raw URL (`https://raw.githubusercontent.com/open-mercato/official-modules/<ref>/module-catalog.json`).
  The manifest file itself is a **separate PR in `open-mercato/official-modules`** — note the merge-order
  dependency (see Risks). Until it lands, official picker uses the free-text fallback.
- **1.4 — Dependency resolver.**
  - `(new)` `packages/create-app/src/lib/catalog/resolve-deps.ts` — `resolveWithDependencies()` (transitive
    closure, cycle-safe, missing-dep warnings).
  - `(new)` `packages/create-app/src/lib/catalog/resolve-deps.test.ts` — cases:
    `sales → catalog,customers,dictionaries`; `staff → planner,resources` (and `resources → planner`
    transitively); cycle; missing-dep warning; no-op.

**Exit:** `fetchCatalog()` + `resolveWithDependencies()` green under `yarn test:create-app`; CLI unchanged.

### Phase 2 — Ship official-modules tooling into the template

Fixes Blockers A/B/C from the design section.

- **2.1 — Parameterize `GENERATED_PATH` (Blocker A).** Edit `scripts/lib/official-modules.mjs`:
  - `readConfig()` (line 45-60) returns a new `generatedPath` field (default
    `apps/mercato/src/official-modules.generated.ts`).
  - `GENERATED_PATH` (line 20) becomes derived from config inside `writeGenerated()` (line 102) — or convert
    it to a `resolveGeneratedPath(config)` helper. Keep the exported constant for BC (mark `@deprecated`,
    point to the helper) per BACKWARD_COMPATIBILITY.md.
  - Edit `scripts/official-modules-setup.mjs` (line 105 `writeGenerated(activated)` and line 61
    `writeGenerated([])`) to pass the resolved path / config.
  - Add a unit test in `scripts/__tests__/official-modules.test.mjs` for the new default + override.
- **2.2 — Copy the three scripts into the template.** `(new)`
  `packages/create-app/template/scripts/official-modules.mjs`,
  `packages/create-app/template/scripts/official-modules-setup.mjs`,
  `packages/create-app/template/scripts/lib/official-modules.mjs` — byte-identical to the monorepo originals
  after 2.1. (They must be plain copies, not `.template` files — they contain no `{{PLACEHOLDER}}` and the
  copier renames `.template`.)
- **2.3 — Template config + gitignore (Blocker B partial).**
  - `(new)` `packages/create-app/template/official-modules.json` — `{ repo, path, branch, available: [],
    activated: [], generatedPath: "src/official-modules.generated.ts" }`.
  - Edit `packages/create-app/template/gitignore` (currently 2 lines around 63-64) — add
    `official-modules.local.json`.
- **2.4 — Template `package.json.template` (Blocker B).** Edit
  `packages/create-app/template/package.json.template`:
  - Add `"workspaces": ["external/official-modules/packages/*"]`.
  - Add scripts `"official-modules": "node scripts/official-modules.mjs"` and
    `"postinstall": "node scripts/official-modules-setup.mjs"` to the `"scripts"` block (lines 7-30; today
    there is **no** `postinstall`, so this is a clean add, not a merge).
- **2.5 — Generated `modules.ts` template gains official merge (Blocker C).** Edit
  `packages/create-app/src/lib/templates/modules-ts.template` — add the
  `import { officialModuleEntries } from './official-modules.generated'` line and the merge `for` loop after
  the enterprise blocks (current lines 27-29). This also fixes the pre-existing `empty`/`crm` gap.
- **2.6 — Drift guard + sync checklist.**
  - Edit `scripts/__tests__/official-modules.test.mjs` — add a test asserting
    `template/scripts/official-modules.mjs`, `…-setup.mjs`, and `lib/official-modules.mjs` are byte-identical
    to the monorepo `scripts/` originals; assert `template/official-modules.json` exists with `generatedPath`
    set; assert `package.json.template` contains the two scripts + the workspaces entry.
  - Edit `packages/create-app/AGENTS.md` § "Template Sync Checklist" (the numbered list) — add rows mapping
    `scripts/official-modules.mjs` / `…-setup.mjs` / `scripts/lib/official-modules.mjs` ↔ their
    `template/scripts/**` copies.

**Exit:** a scaffolded app with **no** picker selection but a manual `git init` + `yarn official-modules add
forms` clones the submodule and regenerates `src/official-modules.generated.ts`; `yarn test:create-app` and
the drift guard pass.

### Phase 3 — Interactive picker, writers & CLI flags

- **3.1 — Picker UX.** `(new)` `packages/create-app/src/lib/module-picker.ts` exporting
  `runModulePicker({ preset, catalog, ask })` → `{ coreEntries: ModuleEntry[]; officialIds: string[] }`.
  Readline list, toggle, auto-include notice, deselect-blocking (see "The picker UX"). `(new)`
  `module-picker.test.ts` driving it with a scripted `ask`.
- **3.2 — Writers.**
  - Edit `packages/create-app/src/lib/apply-starter-preset.ts` — export a `writeModulesTs(targetDir, entries)`
    that reuses `generateModulesTs()` (line 82), so the picker and `applyStarterPreset` share one writer.
  - `(new)` `packages/create-app/src/lib/write-official-selection.ts` — given `officialIds` and `targetDir`,
    rewrite `<app>/official-modules.json` `activated` and `<app>/src/official-modules.generated.ts` using the
    shared `renderGenerated`/`writeConfig` from the **template's** copied `scripts/lib/official-modules.mjs`
    (import the JS helper directly, or re-implement the 6-line `renderGenerated` to avoid a runtime dep on a
    template file — decide in 3.2; prefer importing the monorepo `scripts/lib/official-modules.mjs` at build
    time so output is guaranteed identical). `(new)` `write-official-selection.test.ts`.
- **3.3 — Wire into `main()`.** Edit `packages/create-app/src/index.ts`:
  - New `runModulePicker` orchestration after `applyStarterPreset(presetId, targetDir)` (line 556), gated on
    `!readyAppSource`, on a TTY, and on the opt-in `y/N` prompt (default N). Reuse the `resolvePreset` result
    as the seed (export it from `applyStarterPreset` or call `resolvePreset` again).
  - When official modules were selected, set git-init default to **yes** and extend
    `printTemplateNextSteps()` (line 439) with the two-pass install note.
  - Respect `constraints.rejectWithReadyApps` — picker never runs for `--app`/`--app-url`.
- **3.4 — CLI flags.** Edit `parseArgs()` (lines 84-131) + `Options` (lines 24-34) + `showHelp()` (lines
  36-69): add `--modules <csv>`, `--official-modules <csv>`, `--no-module-picker`. Flag path skips the prompt
  and runs the same writers. Add a `parseArgs` unit test (`packages/create-app/src/lib/` already holds
  sibling `.test.ts` files — add `index-parse-args.test.ts` or extend an existing suite).

**Exit:** interactive and flag-driven scaffolds produce a valid `src/modules.ts` (with official merge) +
seeded `official-modules.json` that passes `yarn generate`; default no-flag invocation is byte-identical to
today.

### Phase 4 — Docs & polish

- **4.1** Edit `packages/create-app/AGENTS.md` — new flags under "Ready App Import Modes" / a new "Module
  Picker" subsection; the template-sync rows from 2.6.
- **4.2** Edit `apps/docs/docs/customization/standalone-app.mdx` and
  `apps/docs/docs/installation/setup.mdx` — document the picker, the `--modules` / `--official-modules` flags,
  and the official-modules two-pass install ordering. (Both already mention `create-mercato-app`.)
- **4.3** Edit `packages/create-app/template/AGENTS.md` — note that `yarn official-modules` is now available in
  the scaffolded app (today its "Agent Automation" table and module docs assume the monorepo CLI).
- **4.4** Add a `RELEASE_NOTES.md` entry (additive feature) and update this spec's Changelog.

---

## Exact File Inventory

| # | File | Action | What changes |
|---|------|--------|--------------|
| **Phase 1 — catalog** | | | |
| 1 | `packages/create-app/scripts/generate-module-catalog.mjs` | new | Build-time core-catalog generator (scans module `metadata`). |
| 2 | `packages/create-app/build.mjs` | edit | Invoke generator; write `dist/module-catalog.core.json`. |
| 3 | `packages/create-app/src/lib/catalog/types.ts` | new | `CatalogModule`, `ModuleCatalog`. |
| 4 | `packages/create-app/src/lib/catalog/fetch-catalog.ts` (+ `.test.ts`) | new | Live fetch + timeout/retry/offline fallback. |
| 5 | `packages/create-app/src/lib/catalog/resolve-deps.ts` (+ `.test.ts`) | new | Transitive `requires` closure. |
| 6 | `packages/create-app/src/lib/catalog/baked-core-catalog.json` | new (generated, committed) | Offline core snapshot shipped in tarball. |
| **Phase 2 — tooling into template** | | | |
| 7 | `scripts/lib/official-modules.mjs` | edit | Add `generatedPath` to `readConfig`; derive `GENERATED_PATH` from config. |
| 8 | `scripts/official-modules-setup.mjs` | edit | Pass resolved generated path to `writeGenerated`. |
| 9 | `packages/create-app/template/scripts/official-modules.mjs` | new (copy) | Byte-identical to monorepo. |
| 10 | `packages/create-app/template/scripts/official-modules-setup.mjs` | new (copy) | Byte-identical to monorepo. |
| 11 | `packages/create-app/template/scripts/lib/official-modules.mjs` | new (copy) | Byte-identical to monorepo. |
| 12 | `packages/create-app/template/official-modules.json` | new | `activated: []`, `generatedPath: "src/official-modules.generated.ts"`. |
| 13 | `packages/create-app/template/gitignore` | edit | Add `official-modules.local.json`. |
| 14 | `packages/create-app/template/package.json.template` | edit | Add `workspaces` + `official-modules` + `postinstall` scripts. |
| 15 | `packages/create-app/src/lib/templates/modules-ts.template` | edit | Add `officialModuleEntries` import + merge loop (Blocker C). |
| 16 | `scripts/__tests__/official-modules.test.mjs` | edit | `generatedPath` test + template byte-identical drift guard. |
| 17 | `packages/create-app/AGENTS.md` | edit | Template-sync rows for the three scripts. |
| **Phase 3 — picker + writers + flags** | | | |
| 18 | `packages/create-app/src/lib/module-picker.ts` (+ `.test.ts`) | new | Interactive picker. |
| 19 | `packages/create-app/src/lib/apply-starter-preset.ts` | edit | Export shared `writeModulesTs`. |
| 20 | `packages/create-app/src/lib/write-official-selection.ts` (+ `.test.ts`) | new | Seed `official-modules.json` + generated registry in the app. |
| 21 | `packages/create-app/src/index.ts` | edit | `parseArgs`/`Options`/`showHelp` flags; picker wiring in `main()`; git-init default + next-steps note. |
| 22 | `packages/create-app/src/lib/index-parse-args.test.ts` | new | Cover new flags. |
| **Phase 4 — docs** | | | |
| 23 | `apps/docs/docs/customization/standalone-app.mdx` | edit | Picker + flags + two-pass install. |
| 24 | `apps/docs/docs/installation/setup.mdx` | edit | Mention module picker. |
| 25 | `packages/create-app/template/AGENTS.md` | edit | `yarn official-modules` now available in-app. |
| 26 | `RELEASE_NOTES.md` | edit | Additive feature entry. |

> **Untouched on purpose:** `template/src/modules.ts` (classic file already merges `officialModuleEntries`);
> monorepo `apps/mercato/src/official-modules.generated.ts` and root `official-modules.json` (no activation
> change); `scripts/official-modules.mjs` CLI (no logic change — only the lib it imports gains `generatedPath`).

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

- `readConfig()` returns the default `generatedPath` (`apps/mercato/src/official-modules.generated.ts`) and
  honors an override.
- Template `scripts/official-modules.mjs`, `…-setup.mjs`, `lib/official-modules.mjs` are **byte-identical** to
  the monorepo `scripts/` originals (sync guard).
- `template/official-modules.json` exists with `generatedPath: "src/official-modules.generated.ts"`.
- `package.json.template` contains `"official-modules"` + `"postinstall"` scripts and the
  `external/official-modules/packages/*` workspaces entry.
- `src/lib/templates/modules-ts.template` contains the `officialModuleEntries` import + merge loop
  (regression lock for Blocker C).

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
| Template `package.json.template` | **Additive** | Adds `workspaces`, `official-modules` + `postinstall` scripts (no `postinstall` existed before — clean add). |
| `official-modules.json` schema | **Additive** | New optional `generatedPath` key; absent → monorepo default `apps/mercato/src/official-modules.generated.ts`. Existing configs unaffected. |
| `scripts/lib/official-modules.mjs` `GENERATED_PATH` export | **Additive / deprecation** | Constant retained for BC, marked `@deprecated`; path now resolved via `resolveGeneratedPath(config)`. CLI surface (a generated-files/CLI contract) keeps working. |
| Monorepo-root `official-modules` CLI | **None** | Behavior unchanged; template gets byte-identical copies guarded by a drift test. |
| `ModuleInfo.requires` / generate-time validator | **None** | Reused as-is; picker is an early-warning layer above it. |
| `src/lib/templates/modules-ts.template` | **Fix (additive)** | Gains the official-modules merge it was missing; `empty`/`crm` scaffolds gain official support they silently lacked. |

No frozen/stable contract surface is removed. New CLI flags, the `generatedPath` key, and new template files
are all additive; the one touched export (`GENERATED_PATH`) keeps a deprecated bridge. The deprecation
protocol is satisfied (retain + `@deprecated` + bridge).

---

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Network fetch slows or hangs scaffolding | 4s timeout + 1 retry + baked core snapshot fallback; never block on official fetch. |
| Catalog dep graph drifts from installed package version | Picker is advisory; generate-time validator is the authority; notice warns snapshot may lag. |
| Official manifest missing/stale in official-modules repo | Free-text entry path + postinstall validation against the cloned submodule (existing behavior). |
| Two copies of `official-modules*.mjs` drift | Byte-identical drift guard test (Phase 2.6) + template-sync checklist entry. |
| User builds a broken set despite picker | Deselect-blocking + auto-include keep interactive sets valid; generate-time check is the final gate. |
| Ready-app import + picker conflict | Picker skipped for `--app`/`--app-url` via `rejectWithReadyApps`, matching the agentic wizard. |
| Official modules selected but app never `git init`-ed → postinstall no-ops, build fails on missing packages | Phase 3 defaults git-init to **yes** when official modules chosen; next-steps + docs spell out the two-pass install; postinstall already no-ops safely without git. |
| `generatedPath` change breaks monorepo regeneration | Default value reproduces today's exact path; covered by a `readConfig()` default test (Phase 2.1). |
| Official `module-catalog.json` manifest not yet in `open-mercato/official-modules` | Free-text fallback works without it; manifest is a **separate coordinated PR** in that repo (no atomic cross-repo PR) — call out merge order to reviewers. |

---

## Open Questions

_None outstanding._ The three forking decisions (official-modules reach, catalog source, dependency UX) were
resolved with the maintainer on 2026-06-09 and are recorded under "Proposed Solution".

---

## Changelog

- 2026-06-09 — Initial draft. Decisions captured: ship full official-modules tooling into the template; live
  remote catalog fetch with baked core offline fallback; auto-include transitive `requires` with a notice.
- 2026-06-09 — Deepened Phases 2+ to file-level precision. Source audit surfaced three concrete monorepo-only
  blockers (A: `GENERATED_PATH` hardcoded to `apps/mercato/src`; B: missing `workspaces` + git-init
  dependency; C: `modules-ts.template` omits the official-modules merge). Added a 26-row "Exact File
  Inventory", the two-pass install ordering, and updated BC/Risks/tests accordingly.
