# create-mercato-app: Per-Module Picker over the Module Catalog

- **Status:** Draft. Revised 2026-10-23 (catalog-first); Phase 1 implemented behind opt-in flags.
- **Date:** 2026-06-09 (revised 2026-10-23)
- **Scope:** OSS
- **Owner:** Platform / DX
- **Affected package:** `packages/create-app` (`create-mercato-app`)
- **Tracking issue:** #3304 (spec PR #2871)
- **Related:**
  - [Open Mercato Modules](https://modules.openmercato.com): the module catalog that publishes `picker.json`
  - `.ai/specs/2026-05-19-official-modules-generated-location-decision.md`
  - `packages/create-app/AGENTS.md`
  - `apps/docs/docs/architecture/module-dependencies.mdx`
  - `apps/docs/docs/cli/module-add.mdx`, `apps/docs/docs/cli/module-enable.mdx`

---

## TLDR

`create-mercato-app` gets an opt-in way to plan extra modules while scaffolding, sourced from the Open Mercato
Modules catalog (`https://modules.openmercato.com/picker.json`) instead of the `open-mercato/official-modules`
repository:

- `--modules <id-or-package>[,...]` (non-interactive) and `--module-picker` (interactive, TTY only) list only
  modules the catalog **verified on the create-app's own Open Mercato line**, show each module's origin
  (`official`, `community`, `third-party`, `enterprise`), license and level before anything is chosen, pull in
  required catalog modules, and print the exact `yarn mercato module add ...` commands as next steps. The plan
  is saved to `.mercato/catalog-selection.json`. Nothing is installed during scaffolding.
- Both flags are off by default: without them the scaffolder makes no network request and its output is
  unchanged.
- A failed fetch never blocks scaffolding: the app keeps its preset modules and a notice points to the catalog.

The original plan (shipping the `official-modules` submodule tooling into every generated app and a baked
official-modules manifest) is withdrawn; see "Revision 2026-10-23". Customizing the **core** module set of a
preset with `requires` auto-resolution stays planned as Phase 2, now reading `requires` from the same
`picker.json`.

---

## Revision 2026-10-23: catalog-first

What changed since the 2026-06-09 draft, and why:

| Before | Now | Reason |
|---|---|---|
| Catalog = core manifest generated from `packages/core` + official manifest in `open-mercato/official-modules` (raw GitHub URLs, version tags, `main` fallback) | One file, `picker.json`, published by the module catalog at `https://modules.openmercato.com/picker.json` (override: `OM_MODULES_PICKER_URL`) | The catalog already projects every listed package (official, community, third-party, enterprise) plus the core modules into the `CatalogModule` shape of this spec, with nightly install receipts per Open Mercato line. One source, no second manifest to keep in sync. |
| `source: 'core' \| 'official'` | `source: 'core' \| 'official' \| 'community' \| 'third-party' \| 'enterprise'` plus `locator`, `license`, `tier`, `verifiedOn`, `install` | Community and third-party modules are the reason to have a picker; their license and origin must be visible before a choice. |
| Official modules activated through `official-modules.json` + the `external/official-modules` submodule, with the three `official-modules*.mjs` scripts, `workspaces` and a `postinstall` shipped into the template | Removed. Modules are npm packages installed with `yarn mercato module add <package>@<version>` (existing command), core modules with `yarn mercato module enable @open-mercato/core --module <id>` | `module add` already installs, registers and generates; the submodule path needed git, a two-pass install and byte-identical script copies (Blockers A to C of the old draft). The official-modules repository is being retired in favour of npm packages listed in the catalog. |
| Selected modules written straight into `src/modules.ts` | Phase 1 prints the install commands and saves the plan; nothing is written into `src/modules.ts` or `package.json` | Installing third-party code needs `--allow-third-party` and a version pinned to what the catalog verified; `module add` enforces both and runs the generators. Writing `src/modules.ts` before the package exists would break `yarn generate`. |
| Baked core snapshot for offline use | Offline: the preset stays as is, the catalog step is skipped with a notice | Core modules come from the presets, which are compiled into create-app; the catalog step only adds packages, which need the network anyway. |
| Version keyed to `PACKAGE_VERSION` tag | Version mapped to a catalog line: `0.9.x` -> `0.9`, a `*-develop.*` prerelease -> `next`; a version the catalog does not test offers nothing | Only modules with a verified install on the scaffolded line are offered (the catalog's `verifiedOn`, which follows `version.recommended`, so a new release in quarantine does not hide a module). |

---

## Problem Statement

Today the scaffolder (`packages/create-app/src/index.ts`) offers fixed module sets:

```
PRESET_PROMPT_OPTIONS = [ classic (default), empty, crm, wms ]
```

Each preset resolves to a fixed `ModuleEntry[]` (`src/lib/starter-presets.ts` -> `resolvePreset()` ->
`generateModulesTs()`), written into the new app's `src/modules.ts`. There is **no way to customize the module
set during scaffolding** and **no way to discover modules beyond core**:

- **No per-module control.** Presets are all-or-nothing. A user who wants `empty + sales` or
  `crm - ai_assistant` has no guided path and can easily produce a broken `modules.ts` that violates the module
  dependency graph (for example enabling `sales` without `catalog`/`customers`/`dictionaries`).
- **Packages are invisible at scaffold time.** `yarn mercato module add` installs any module package, but a new
  user does not know which packages exist, which are verified on their Open Mercato version, what license they
  carry or whether they are third-party code.

### Existing primitives we build on (do not reinvent)

- **Module dependency declaration** is canonical: each module exports `metadata: ModuleInfo` with an optional
  `requires: string[]` (`packages/shared/src/modules/registry.ts`). The catalog copies it into
  `picker.json` `requires`.
- **Dependency validation** exists at generate time: the module-registry generator fails with a clear message
  if an enabled module's `requires` is not satisfied (`packages/cli/src/lib/generators/module-registry.ts`).
  It stays the backstop.
- **Installation** exists: `yarn mercato module add <package>[@version] [--module <id>] [--allow-third-party]`
  and `yarn mercato module enable <package> --module <id>` (`packages/cli/src/lib/module-install.ts`). The
  catalog's `installByLine[line]` is exactly that command, pinned to the version verified on that line
  (`install` is the same command for the latest line).

---

## Goals & Non-Goals

### Goals

1. Let a user plan catalog modules while scaffolding, interactively (`--module-picker`) or by flag
   (`--modules`), without changing the default flow.
2. Offer only modules the catalog verified on the scaffolded Open Mercato line; show origin, license and level
   before the choice.
3. Pull in required catalog modules (transitively, deepest first) and name core requirements the preset does
   not enable.
4. Never install, never write `src/modules.ts` or `package.json` from the catalog step; print exact commands and
   save the plan to `.mercato/catalog-selection.json`.
5. Never block scaffolding on the network: 4 s timeout, one retry, then a notice.
6. Phase 2: customize the preset's core modules with `requires` auto-resolution (see "The picker UX").

### Non-Goals

- No backend/admin UI; this is a terminal scaffolder (`node:readline`, no new prompt dependency).
- No installation during scaffolding and no bypass of `--allow-third-party` or the Yarn age gate.
- No change to `ModuleInfo.requires`, the generate-time validator or `module add | enable`.
- No `official-modules` submodule tooling in generated apps (withdrawn, see the revision table).

---

## Proposed Solution

### High-level flow (additive)

```
parseArgs()                          + --modules <list>, --module-picker
  |
resolveReadyAppSource()              --modules / --module-picker rejected with --app / --app-url
  |
promptForStarterPreset()             unchanged
  |
scaffold base template + applyStarterPreset()   unchanged
  |
NEW (only with --modules or --module-picker): runCatalogStep()
       |- fetchPickerCatalog()       picker.json, 4 s timeout + 1 retry; unavailable -> notice, skip
       |- catalogLineFor(version)    create-app version -> catalog line, or skip with a notice
       |- selectableModules()        non-core entries whose verifiedOn contains the line and that have an
       |                             install command for it (installCommandFor)
       |- promptCatalogModules()     with --module-picker on a TTY: numbered list, origin, license, level
       |- resolveCatalogSelection()  --modules + picks, requires closure, unknown / ambiguous / unmet notes
       '- writeSelectionFile()       .mercato/catalog-selection.json
  |
agentic setup wizard -> git init -> next steps (+ "Modules you planned from the catalog" commands)
```

### The module catalog

Source: `https://modules.openmercato.com/picker.json` (`PickerIndex`, schema version 1), override with
`OM_MODULES_PICKER_URL`. The catalog publishes it from its registry data; it is additive-only (`schemaVersion`
1, new fields optional).

```ts
// packages/create-app/src/lib/catalog/types.ts
export type CatalogSource = 'core' | 'official' | 'community' | 'third-party' | 'enterprise'

export type CatalogModule = {
  id: string                       // module ID, e.g. 'gateway_stripe'
  from: string                     // npm package, '@open-mercato/core' for core modules
  title: string
  description: string
  requires: string[]               // module IDs or npm names, from ModuleInfo.requires
  source: CatalogSource
  locator: string                  // 'npm:@open-mercato/gateway-stripe'
  license: { spdx: string | null; kind: 'osi' | 'proprietary' | 'enterprise' | 'unknown' }
  tier: 'listed' | 'verified' | null
  verifiedOn: string[]             // catalog lines with a verified install receipt, e.g. ['0.9', 'next']
  install: string                  // exact command for the latest line (lines[0]), e.g.
                                   // 'yarn mercato module add @open-mercato/gateway-stripe@0.9.0'
  installByLine: Record<string, string> | null
                                   // exact command per line in verifiedOn, with the version verified on that
                                   // line (catalog `version.recommended[line]`); null from a catalog that
                                   // predates the field
  inPresets: string[]              // lines whose new app (classic preset) already registers the module;
                                   // [] when the catalog omits the field
  presetNote: string | null        // the catalog's sentence for such a module on the latest line, e.g.
                                   // 'Nothing to install: a new app already registers gateway_stripe in src/modules.ts.'
  conflictsWith: string[]          // module IDs of a new app (classic preset) whose backend route this module adds
                                   // too, so `yarn generate` refuses it there; [] when the catalog omits the field
  warning: string | null           // the catalog's one sentence about that clash, e.g. 'Adds the backend route
                                   // /backend/webhooks, which a new app on 0.8, 0.9 and next already has from ...'
}

export type PickerIndex = { schemaVersion: 1; generatedAt: string; lines: string[]; modules: CatalogModule[] }
```

One item per module ID: a package with several modules yields several items with the same `from` and an
`install` carrying `--module <id>`. Core modules are included with `source: 'core'` and
`install: 'yarn mercato module enable @open-mercato/core --module <id>'`.

Fetch contract (`fetch-catalog.ts`):

- Global `fetch`, `AbortSignal.timeout(4000)`, one retry after a network error or a 5xx; a 4xx or an
  unsupported body is final.
- Malformed module items are dropped; an unknown `schemaVersion` makes the catalog unavailable.
- Line mapping: `major.minor` of the create-app version when the catalog lists that line; a `*-develop.*`
  prerelease maps to `next`; anything else offers nothing (notice:
  `The module catalog does not verify modules for Open Mercato <version> yet.`).
- Install command for the app's line (`installCommandFor`): `installByLine[line]`, else `install` only when the
  line is the latest one (`lines[0]`, the catalog lists the latest line first). `install` pins the version
  verified on the latest line, so an app on an older line or on `next` never gets it: a module verified on that
  line without a command for it is left out with a notice (`Left out of the list: ...` in the picker,
  `<id> is verified on <line>, but the module catalog gives no install command for <line> yet.` for
  `--modules`).
- Selectable = `source !== 'core'`, `verifiedOn` contains the line and the line has an install command; the
  item carries that command as its `install`. Core modules are the presets' job
  (Phase 2); a core ID passed to `--modules` is answered with its `module enable` command, or "the preset
  already enables it".
- Modules the new app already registers are never planned: for `classic` the catalog's `inPresets` contains the
  line, for another preset its own `src/modules.ts` list has the same ID and package. The picker leaves them out
  (`Not listed: <n> catalog modules the app already registers in src/modules.ts.`) and `--modules` answers with
  the catalog's `presetNote` (classic, latest line) or `Nothing to install: <a new app | the preset> already
  registers <id> in src/modules.ts.` instead of a command.
- A module with a catalog `warning` is still offered and planned, since `yarn generate` decides, but the warning
  is printed under its picker row, under its line in the plan (`Warning: <warning>`) and above its command in the
  next steps. It applies to a `classic` app on a line whose app registers a module named in `conflictsWith` (the
  catalog entry of that module, `inPresets`; shown when the catalog does not list it), and to another preset only
  when that preset registers such a module. Modules without the field print exactly what they printed before.
- Catalog strings and keys lose control characters (a newline or tab becomes a space) before they are printed,
  so catalog text cannot rewrite the terminal. The warning text is the catalog's own; for a preset other than
  `classic` it still names the lines of a new classic app.
- Without anything to plan (`--module-picker` without a terminal and no `--modules` items) the catalog is not
  fetched.
- Requests the catalog cannot plan get one of three notes: a module listed in the catalog but not verified on
  the line (`Not verified on <line>: <request> is in the module catalog, ...`), a name the catalog does not have
  with the closest module ID or npm name (`Not in the module catalog: ksef_direct. Did you mean
  integration_ksef_direct?`), or the same without a suggestion when nothing is close.

### Licenses and third-party code

- The picker list shows `source · license · level` for every item (for example
  `third-party · MIT · verified on 0.9`) and a fixed line:
  `Third-party modules run with access to all tenants' data. Check the license before you pick.`
- The plan summary repeats origin and license per module and, when community or third-party modules were
  picked, states that their commands carry `--allow-third-party`.
- The commands are the catalog's commands for the app's line: exact versions verified on that line,
  `--allow-third-party` outside `@open-mercato/*`, `--module <id>` for multi-module packages. Phase 2 writes
  `src/modules.ts` only after the same license display and only through `module add`, so
  `--allow-third-party` is always an explicit part of the command the user runs.

### The picker UX

Phase 1 (implemented): a numbered list of the selectable catalog modules, answered with comma- or
space-separated numbers (Enter = none), re-asked on an invalid number. Ctrl+C aborts the whole scaffold
(existing behaviour).

```
🧩  Modules from the Open Mercato Modules catalog (verified on 0.9)

   1. integration_ksef_direct  KSeF Integration  (third-party · MIT · verified on 0.9)
   2. durable_work             Durable Work  (third-party · MIT · verified on 0.9)
   3. gateway_stripe           Stripe Payment Gateway  (official · MIT · verified on 0.9)

   Third-party modules run with access to all tenants' data. Check the license before you pick.

   Numbers to add, comma-separated [none]: 3
```

Phase 2 (planned): customizing the preset's core modules. After preset selection the user may toggle core
modules seeded from the preset; toggling **on** pulls in transitive `requires` with
`Added "<id>", also enabling required modules: <list>`; toggling **off** a module that a selected module
requires is blocked with a notice naming the dependents. The core list and `requires` come from the core items
of `picker.json`; offline, Phase 2 keeps the preset unchanged.

### Dependency auto-resolution

Phase 1 (`resolveCatalogSelection` in `src/lib/catalog/selection.ts`):

- Matches a request as `<npm name>:<module id>` (one module of one package), then by module ID, then by npm
  name (`from`) or locator (`npm:` prefix optional). A name that matches several module IDs (a multi-module
  package) is reported as ambiguous. Two packages may publish the same module ID, so an ID that matches modules
  of several packages is also reported as ambiguous, listing `<id> from <npm name>`. An ambiguous request plans
  nothing and its notice lists, per candidate, the shortest item that matches that module alone (its ID, its npm
  name, or `<npm name>:<module id>`), so following the advice never leads back to another ambiguous item: with
  `@publisher-a/work` publishing `durable_work` and `other_mod` and `@publisher-b/work` publishing
  `durable_work`, `durable_work` points to `@publisher-a/work:durable_work` and `@publisher-b/work`, and
  `@publisher-a/work` points to `@publisher-a/work:durable_work` and `other_mod`. Picker choices are passed as
  catalog entries and keep their package; the picker shows the npm name of rows that share a module ID.
- Walks `requires` of each picked module: a requirement that is a selectable catalog module is added first
  (`reason: 'required'`), so commands run deepest first; cycles are cut by a visited set. A requirement that
  modules of several packages satisfy is taken from the package the user asked for, and is otherwise reported
  as ambiguous with none of them planned.
- A requirement that is not a selectable module and not enabled by the preset is reported with its fix
  (`yarn mercato module enable @open-mercato/core --module <id>` for a module ID). With the `classic` preset
  (template `modules.ts`) the preset set is not resolved and core requirements are assumed present; the
  generate-time validator remains the final gate.

Phase 2 reuses the same closure over core items (`resolveWithDependencies` of the 2026-06-09 draft).

### Writing the result

`.mercato/catalog-selection.json` (gitignored with the rest of `.mercato/`):

```json
{
  "schemaVersion": 1,
  "catalog": "https://modules.openmercato.com/picker.json",
  "catalogGeneratedAt": "2026-10-23T03:05:00Z",
  "line": "0.9",
  "modules": [
    {
      "id": "gateway_stripe",
      "from": "@open-mercato/gateway-stripe",
      "locator": "npm:@open-mercato/gateway-stripe",
      "source": "official",
      "license": { "spdx": "MIT", "kind": "osi" },
      "tier": "verified",
      "install": "yarn mercato module add @open-mercato/gateway-stripe@0.9.0",
      "reason": "requested"
    }
  ],
  "commands": ["yarn mercato module add @open-mercato/gateway-stripe@0.9.0"]
}
```

`printTemplateNextSteps()` prints a "Modules you planned from the catalog" block with the commands in order,
after the manual install steps. Coding agents in the generated app can read the same file.

### CLI / non-interactive path

```
create-mercato-app my-app --preset crm --modules gateway_stripe,@fastwhitecat/integration-ksef-direct
create-mercato-app my-app --module-picker
```

- `--modules <list>`: comma-separated module IDs, npm names, locators or `<npm name>:<module id>`; no prompt.
- `--module-picker`: interactive list on a TTY; without a TTY it is skipped with a notice (`--modules` still
  applies).
- Both are rejected with `--app` / `--app-url` (imported ready apps keep their own module set).
- Without either flag: no catalog request, output unchanged.
- The 2026-06-09 `--official-modules` and `--no-module-picker` flags are withdrawn: there is no
  official-modules activation anymore, and the picker is off unless asked for.

---

## Architecture & Compliance Notes

- **No new dependency**: `node:readline` and global `fetch` only.
- **No cross-module ORM / tenant concerns**: build-time scaffolder, no runtime data access.
- **Source of truth for deps** stays `ModuleInfo.requires`; `picker.json` is a projection of it and the
  generate-time validator stays the final gate.
- **No install at scaffold time**: commands are printed; `module add` keeps owning installation, third-party
  consent and generation.
- **Ready-app imports unaffected**: both flags are rejected with `--app` / `--app-url`.
- **Generated-file contract:** `official-modules.generated.ts` in the template is untouched.

---

## Phasing

### Phase 1: catalog adapter behind opt-in flags (implemented 2026-10-23)

- `(new)` `packages/create-app/src/lib/catalog/types.ts`: `CatalogModule`, `PickerIndex`, fetch and selection
  file types.
- `(new)` `packages/create-app/src/lib/catalog/fetch-catalog.ts`: `fetchPickerCatalog`, `parsePickerIndex`,
  `resolvePickerUrl`, `catalogLineFor`, `selectableModules`.
- `(new)` `packages/create-app/src/lib/catalog/selection.ts`: `parseModulesFlag`, `resolveCatalogSelection`,
  `installCommands`, `buildSelectionFile`, `writeSelectionFile`, `describeModule`.
- `(new)` `packages/create-app/src/lib/catalog/catalog-step.ts`: `runCatalogStep`, `promptCatalogModules`,
  `parsePickerAnswer`.
- `(new)` `packages/create-app/src/lib/catalog/catalog.test.ts` + `__fixtures__/picker.json` (generated by
  the catalog from real registry data).
- Edit `packages/create-app/src/index.ts`: `Options`, `parseArgs`, `showHelp`, ready-app guard,
  `maybeRunCatalogStep` after `applyStarterPreset`, `printTemplateNextSteps` catalog block.

**Exit:** default invocation unchanged; `--modules` / `--module-picker` produce the plan file and commands;
offline and untested-line runs degrade with a notice.

### Phase 2: core module customization (planned)

- `(new)` `packages/create-app/src/lib/catalog/resolve-deps.ts` (+ test): transitive closure over core items of
  `picker.json`, cycle-safe, missing-dep warnings; cases `sales -> catalog, customers, dictionaries`,
  `staff -> planner, resources`.
- `(new)` `packages/create-app/src/lib/module-picker.ts` (+ test): core toggle list seeded from the preset,
  auto-include and deselect-blocking.
- Edit `packages/create-app/src/lib/apply-starter-preset.ts`: export `writeModulesTs(targetDir, entries)` on
  top of `generateModulesTs()`.
- Edit `packages/create-app/src/index.ts`: core picker after preset selection; `--modules` accepts core IDs
  and writes them into `src/modules.ts` with their requirements.

### Phase 3: docs

- `apps/docs/docs/customization/standalone-app.mdx`, `apps/docs/docs/installation/setup.mdx`: the flags, the
  plan file, how to run the commands.
- `packages/create-app/AGENTS.md`: a "Module catalog" note under "Ready App Import Modes".

---

## Exact File Inventory

| # | File | Phase | Action |
|---|------|-------|--------|
| 1 | `packages/create-app/src/lib/catalog/types.ts` | 1 | new |
| 2 | `packages/create-app/src/lib/catalog/fetch-catalog.ts` | 1 | new |
| 3 | `packages/create-app/src/lib/catalog/selection.ts` | 1 | new |
| 4 | `packages/create-app/src/lib/catalog/catalog-step.ts` | 1 | new |
| 5 | `packages/create-app/src/lib/catalog/catalog.test.ts`, `__fixtures__/picker.json` | 1 | new |
| 6 | `packages/create-app/src/index.ts` | 1, 2 | edit |
| 7 | `packages/create-app/src/lib/catalog/resolve-deps.ts` (+ test) | 2 | new |
| 8 | `packages/create-app/src/lib/module-picker.ts` (+ test) | 2 | new |
| 9 | `packages/create-app/src/lib/apply-starter-preset.ts` | 2 | edit |
| 10 | `apps/docs/docs/customization/standalone-app.mdx`, `apps/docs/docs/installation/setup.mdx` | 3 | edit |
| 11 | `packages/create-app/AGENTS.md` | 3 | edit |

Withdrawn from the 2026-06-09 inventory: `scripts/generate-module-catalog.mjs`, `baked-core-catalog.json`,
the `build.mjs` snapshot step, `scripts/lib/official-modules.mjs` `generatedPath`,
`template/scripts/official-modules*.mjs`, `template/official-modules.json`, the `workspaces` and
`postinstall` additions to `package.json.template`, the `modules-ts.template` official merge,
`write-official-selection.ts` and the drift guard in `scripts/__tests__/official-modules.test.mjs`.

---

## Test & Integration Coverage

### Unit tests (`packages/create-app`, `node --test`)

- `parsePickerIndex`: published `picker.json`, malformed items dropped, unknown schema rejected.
- `catalogLineFor`: `0.9.0 -> 0.9`, `0.8.3 -> 0.8`, develop prerelease -> `next`, untested version -> null.
- `selectableModules`: non-core items verified on the line only, each with the command of that line.
- `installCommandFor` / `modulesWithoutLineInstall`: `installByLine[line]` wins (a `next` version differs from
  the latest one); without `installByLine` only the latest line gets `install`, other lines leave the module
  out.
- `fetchPickerCatalog`: default URL, `OM_MODULES_PICKER_URL`, retry after a network error and after a 5xx,
  no retry after a 404, unsupported body, hanging request cut by the timeout.
- `resolveCatalogSelection`: ID, npm name and locator matches; unknown and unverified requests; required
  catalog modules first; unmet core requirements against the preset; `classic` preset; a module ID two
  packages share (picking the second package plans its command, the bare ID is ambiguous, each npm name
  resolves, a shared requirement comes only from the package asked for; when one of the packages has several
  modules, every suggested item plans exactly one module, and `<npm name>:<module id>` selects it).
- `buildSelectionFile`: full file content.
- `runCatalogStep`: `--modules` writes the plan and returns commands; offline and untested line return nothing
  with a notice and write no file; core IDs answered with `module enable`; interactive picker with license and
  level shown and an invalid answer re-asked; no TTY skips the picker but keeps `--modules`; a develop build
  plans the `next` version; a module without a command for a line other than latest is left out with a notice;
  a module a new classic app or the chosen preset already registers is neither offered nor planned; unknown names
  are told apart from listed but unverified modules, with the closest name suggested; a module with a route
  collision (`conflictsWith` / `warning`) shows the catalog warning in the picker and the plan, only where the
  preset has a conflicting module, and modules without it print no warning.

### Integration tests (`yarn test:create-app:integration`, planned with Phase 1 follow-up)

- Default invocation: scaffold identical to today, no request to the catalog (regression lock).
- `--preset crm --modules gateway_stripe` against a stubbed `OM_MODULES_PICKER_URL`: next steps list
  `yarn mercato module add @open-mercato/gateway-stripe@<version>`, `.mercato/catalog-selection.json` exists,
  `src/modules.ts` unchanged.
- Same with the catalog URL unreachable: scaffold succeeds with the notice.

---

## Backward Compatibility

| Surface | Impact | Handling |
|---|---|---|
| `create-mercato-app` default invocation | None | No new behaviour without the new flags; no network request. |
| CLI flags | Additive | `--modules`, `--module-picker` added; existing flags unchanged. |
| `src/modules.ts`, `package.json`, template files | None in Phase 1 | The catalog step writes only `.mercato/catalog-selection.json`. |
| `picker.json` contract | External, additive | `schemaVersion: 1`; the parser ignores unknown fields and drops malformed items. |
| `official-modules.generated.ts` | None | Untouched. |

---

## Risks & Mitigations

| Risk | Severity | Mitigation | Residual risk |
|---|---|---|---|
| Catalog fetch slows or hangs scaffolding | Medium | Only with the opt-in flags; 4 s timeout, one retry, then a notice. | Up to about 8 s added when the catalog is down and a flag is used. |
| User installs third-party code without noticing | High | Origin and license shown before the choice and in the summary; commands carry `--allow-third-party`; nothing installed by the scaffolder. | The user still runs the commands; `module add` is the consent point. |
| `picker.json` shape changes | Medium | Additive-only contract with `schemaVersion`; unknown version = unavailable, malformed items dropped. | A new required field would be ignored until create-app reads it. |
| App on a line other than latest gets a version verified only on latest | Medium | `installByLine[line]`; without it only the latest line uses `install`, other lines leave the module out with a notice. | A catalog without `installByLine` offers nothing on `0.8` or `next`. |
| Catalog verified a version that later breaks | Low | The command pins the version verified on the app's line; the catalog keeps the last verified version when a new release fails. | Bugs not covered by the catalog's install receipt. |
| Preset does not enable a core module a pick requires | Medium | Named with its `module enable` command; the generate-time validator is the final gate. | `classic` preset is not resolved in Phase 1. |

---

## Open Questions

_None outstanding._ The 2026-06-09 decisions on catalog source and official-modules reach are superseded by the
2026-10-23 revision (catalog-first). Phase 2 scope (core customization) is unchanged from the original draft.

---

## Changelog

- 2026-06-09: Initial draft. Decisions captured: ship full official-modules tooling into the template; live
  remote catalog fetch with baked core offline fallback; auto-include transitive `requires` with a notice.
- 2026-06-09: Deepened Phases 2+ to file-level precision (Blockers A to C, 26-row file inventory, two-pass
  install ordering).
- 2026-10-23: Revised catalog-first. Catalog source is `https://modules.openmercato.com/picker.json`
  (`OM_MODULES_PICKER_URL`) with `source: core | official | community | third-party | enterprise`, license,
  tier, `verifiedOn` and exact install commands per verified line (`installByLine`, `install` for the latest
  line); official-modules repository and submodule phases withdrawn; picks
  are planned (commands + `.mercato/catalog-selection.json`), never installed by the scaffolder; license and
  `--allow-third-party` shown before any choice. Phase 1 implemented behind `--modules` and
  `--module-picker` (default off). Core customization moved to Phase 2. Refs #3304.
- 2026-10-25: Picks and requirements keep their package: a module ID that several packages publish is
  ambiguous until the npm name selects one, instead of resolving to the first package.
- 2026-10-25: `<npm name>:<module id>` picks one module of a multi-module package whose module ID another
  package also publishes; the ambiguity notice suggests, per candidate, an item that matches it alone, so the
  advice can no longer send the user between the module ID and the npm name.
- 2026-10-28: The picker and the plan show the catalog's route-collision warning (`conflictsWith` / `warning`,
  for example `shipment_tracking` next to the built-in `webhooks` route). Entries without it print as before.
