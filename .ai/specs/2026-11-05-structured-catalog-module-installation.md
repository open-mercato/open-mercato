# Structured Catalog Module Installation

- **Status:** Proposal — design only; runtime implementation is pending.
- **Date:** 2026-11-05
- **Scope:** OSS — create-app module picker and coordinated catalog publication.
- **Requested reviewer:** @wojciechszyjka

## TLDR

Replace remote installation-command strings with per-line installation metadata. The scaffolder validates package/module identity and exact versions, then generates its own commands and saved plan. Preserve the existing manual installation flow and CLI installer.

## Resolved assumptions (autonomous defaults)

| Question | Chosen direction | Reason |
| --- | --- | --- |
| Proposal or implementation? | Deliver the proposal and implementation plan only. | The user requested a refactor proposal assigned to Wojciech Szyjka. |
| Automatic installation? | Preserve plan-only scaffolding. | Executing packages during scaffolding is a separate behavior change. |
| Replace the catalog schema immediately? | Add structured fields to v1 and retain a bounded legacy adapter. | Older scaffolders and alternate catalog URLs must continue to work. |
| Add new installer capabilities? | Reuse existing npm add/installed-package enable operations. | GitHub sources, ejection, and execution of saved plans are separate capabilities. |

## Problem Statement

The picker currently accepts `installByLine[line]` or the latest-line `install` command from `picker.json`. The safety filter in commit `cc82ba769734ce6445976ca7247bf5781140a4a7` restricts command prefixes and shell characters. The proposed refactor makes typed installation data authoritative and owns command construction locally.

## Proposed Solution

Add `installationByLine` descriptors referencing the entry's existing package (`from`) and module (`id`). Validate before display sanitization, normalize legacy strings into the same typed representation, and render commands from that representation. Document compatibility, consent, test coverage, and coordinated rollout before implementation.

## Overview and Current Evidence

The existing [module-picker specification](2026-06-09-create-app-module-picker.md) remains the source for selection, presets, dependency resolution, and network behavior. This proposal changes the installation-data boundary only; merging this document does not change runtime behavior.

| Current call site | Observed behavior | Proposed change |
| --- | --- | --- |
| [`fetch-catalog.ts`](../../packages/create-app/src/lib/catalog/fetch-catalog.ts) | Fetches `picker.json`; parses schema v1; sanitizes strings before entry validation; `installCommandFor` returns remote command text after a prefix/metacharacter filter. | Validate installation inputs before presentation sanitization and normalize them into a closed descriptor. |
| [`selection.ts`](../../packages/create-app/src/lib/catalog/selection.ts) | Resolves package/module identity and dependencies, deduplicates `entry.install` strings, writes module records and `commands` to a schema-v1 plan. | Preserve selection semantics; derive command strings from validated descriptors. |
| [`catalog-step.ts`](../../packages/create-app/src/lib/catalog/catalog-step.ts) and [`index.ts`](../../packages/create-app/src/index.ts) | Save `.mercato/catalog-selection.json` and print manual next steps. | Preserve plan-only behavior, warnings, and ordering. |
| [`module-install.ts`](../../packages/cli/src/lib/module-install.ts) | `addOfficialModule` installs via Yarn; both add/enable validate the installed module, register it, and generate artifacts when registration changes. Both enforce third-party opt-in. | Reuse these operations through the existing CLI; no second installer. |
| [`module-search-index.ts`](../../packages/cli/src/lib/module-search-index.ts) | Separately derives search/info installation instructions from `modules.json` and built-in metadata. | No output-contract or search refactor in this proposal. |

The [triggering hardening commit](https://github.com/open-mercato/open-mercato/commit/cc82ba769734ce6445976ca7247bf5781140a4a7) rejects obvious unsafe strings. It does not make an installation instruction a validated package/module/version tuple. No exploit or automatic remote-command execution is claimed here: the current scaffolder prints a plan.

## Architecture

The planned boundary is:

```text
existing catalog entry (id, from, locator, verifiedOn)
  + proposed installationByLine[line]
        -> local validation / bounded legacy adapter
        -> normalized installation target
        -> existing selection and dependency ordering
        -> local command renderer
        -> existing terminal output + additive saved-plan fields
```

Implement the normalization and renderer as small pure utilities under `packages/create-app/src/lib/catalog/`, with direct callers in `fetch-catalog.ts` and `selection.ts`. Keep the renderer private to create-app initially; sharing it with CLI search is not required to remove this boundary. Do not add a dependency on CLI internals to the scaffolder or change package exports for hypothetical future execution.

No installation process is added. If a separate feature later executes a plan, it must revalidate the structured target and call the installer or pass a locally chosen executable and argument array through the existing process helpers. Saved `commands` must never be an execution input. Node distinguishes shell command execution from argument-based process APIs; Windows command-script handling still needs care. See [Node child-process documentation](https://nodejs.org/api/child_process.html#child_processexecfilefile-args-options-callback) and the existing [`spawn.ts`](../../packages/cli/src/lib/spawn.ts). An argument array is not a substitute for package-selector validation.

## Data Models

### Catalog additions

Keep `picker.json` `schemaVersion: 1`, identity, compatibility, license, and display fields unchanged. Add optional `installationByLine` to each module:

```json
{
  "id": "gateway_stripe",
  "from": "@open-mercato/gateway-stripe",
  "locator": "npm:@open-mercato/gateway-stripe",
  "verifiedOn": ["0.9"],
  "installationByLine": {
    "0.9": { "kind": "npm", "version": "0.9.0" }
  }
}
```

This is a partial entry; the existing required v1 fields, including legacy `install`, remain present during the bridge. Reuse `from` and `id` rather than introducing a second package or module identity.

The proposed descriptor is a strict discriminated union:

```ts
type CatalogInstallation =
  | { kind: 'npm'; version: string }
  | { kind: 'installed' }
```

`npm` means an exact verified npm version. `installed` means enable this module from an already available package, without a package-manager install. A line requires both an entry in `installationByLine` and membership in `verifiedOn`. There is no latest-line fallback for structured data: the publisher writes every supported line explicitly.

For `installed`, the planner must establish package availability from the scaffold's actual emitted dependency declarations or installed package metadata. Preset module registration and catalog `inPresets` alone do not prove package availability. If availability is unknown or absent, omit the instruction with a diagnostic; never invent an unpinned `add`. Already-enabled modules retain the existing preset suppression. This descriptor does not expose core modules through the picker, whose current core exclusion remains unchanged.

### Normalized target and saved plan

An internal target contains the validated package name, module ID, descriptor, and locally derived `requiresThirdPartyConsent` boolean. Keep dependency identity keyed by package plus module, as today. Render one instruction per selected module in existing dependency order and deduplicate only identical normalized targets. Two modules sharing a package retain separate `--module` instructions; conflicting exact versions of the same package within one plan are rejected with a diagnostic naming both requirements.

Retain `.mercato/catalog-selection.json` schema v1, `modules[].install`, and `commands` as locally generated display projections. Add optional `modules[].installation` containing the resolved descriptor. Existing `from`, `id`, `line`, origin, license, and selection reason remain. The plan records the selected descriptor, so a later catalog update cannot silently change its displayed version. This proposal adds no plan reader or executor and does not rewrite old plan files.

No database entities, migrations, PII, or credential storage are introduced.

## API Contracts and Validation

### Local generation

For a valid `npm` descriptor, generate this fixed grammar:

```sh
yarn mercato module add <from>@<version> --module <id>
```

For a valid and locally available `installed` descriptor:

```sh
yarn mercato module enable <from> --module <id>
```

Append `--allow-third-party` only according to the local package-scope policy already enforced by the CLI: packages outside `@open-mercato/` require it. Never accept a catalog field such as `allowThirdParty`, `args`, `command`, `executable`, `shell`, `cwd`, or `env`. A catalog `source: 'official'` label does not exempt an outside-scope package from consent.

Keep the explicit source/license display and show a third-party notice for every affected selected module, including transitive requirements, beside the generated instruction. Choosing a module plans an installation; the user deliberately runs the displayed command with its consent flag afterward. This preserves existing CLI opt-in semantics without allowing a remote string to supply arbitrary flags. No new trust prompt, CLI flag, or automatic approval is introduced.

### Validation rules

Validate raw installation values before the existing `printable` display transformation. Reject rather than repair whitespace, control characters, or terminal escapes in package/module/version/legacy-command input. Only titles, descriptions, and other presentation text use display sanitization.

- Use strict Zod schemas at this boundary and infer types. Do not add a production dependency solely for validation; confirm a supported existing Zod import/dependency is available, or request the dependency change before implementation.
- `from` must be a lowercase npm registry package name: optional `@scope/` plus a name, each component matching `[a-z0-9][a-z0-9._-]*`, with the npm package-name length limit. Reject whitespace, leading hyphens, percent encoding, path segments, and all selectors/protocols embedded in `from`.
- `id` must match the repository's module convention, `[a-z][a-z0-9_]*`. Installed-package metadata validation remains authoritative when the user runs the command.
- `version` must be an exact canonical semantic version, including supported prereleases. Reject ranges, tags, aliases, build metadata unsupported by the current install path, leading-zero numeric components, URLs, `file:`, `workspace:`, `npm:`, Git sources, and leading-option syntax. Use existing compatible parsing utilities where available; the existing installer grammar remains the upper bound. The catalog must pin a version accepted by that installer.
- Require `locator` to equal `npm:` followed by the validated `from` for this npm/installed contract. Unsupported source kinds receive a diagnostic; do not derive executable behavior from arbitrary locator text.
- Reject unknown keys inside a structured descriptor, invalid discriminants, or an inappropriate `version` on `installed`. Ignore unrelated future top-level catalog metadata as v1 does today.
- Never use catalogue `source`, `tier`, or `verifiedOn` as a substitute for the local consent rule or installed-package eligibility checks.

The [npm package metadata documentation](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/#dependencies) models package identity and version selection as data and documents broader source selectors. This proposal intentionally admits only exact registry versions at the picker boundary; manually invoked CLI capabilities remain unchanged.

### Legacy adapter

When `installationByLine` is absent, select `installByLine[line]`, or `install` only on `lines[0]`, following the existing compatibility fallback. An explicitly present invalid per-line legacy command is rejected, not replaced with `install`. A present structured map is authoritative: an invalid or missing target-line descriptor never falls back to legacy strings.

Parse the selected legacy string with a small, whole-input grammar, not a shell parser or string evaluation. Admit only `yarn mercato module add <npm-name>@<exact-version>` or `yarn mercato module enable <npm-name>`, optionally followed by a single `--module <id>` and a single `--allow-third-party`, in either flag order. The package must equal `from`; a provided module must equal `id`. An omitted module is filled from the entry's validated `id`, so multi-module packages remain explicit. Normalize a recognized consent flag away and recompute it locally. Reject duplicate flags, quoting, escapes, operators, unexpected tokens, `--eject`, and unsupported selectors.

Then render a new command from the normalized target. Never copy a legacy command to output or the plan verbatim. For structured entries, ignore legacy command content entirely; old clients continue using that content during dual publication. Diagnose whether an entry has missing line data, invalid identity, unsupported legacy syntax, an unavailable installed package, or conflicting versions. Invalid entries do not block ordinary scaffolding; an explicit `--modules` request receives an actionable warning and no instruction for the invalid selection, consistent with the current picker. Dependent selections with an unresolvable catalog requirement must not receive an incomplete installation plan; explain the missing requirement.

## UI/UX and Failure Scenarios

This change affects terminal output only. Preserve default picker opt-in/opt-out behavior, noninteractive flags, existing license/origin and collision warnings, core-requirement reporting, timeout/retry/offline degradation, and selection-file location. No new HTTP application API or browser UI path is added. New diagnostics follow the existing CLI/scaffolder translation conventions; do not introduce hardcoded backend UI strings.

| Trigger | Required result |
| --- | --- |
| Catalog unavailable or unsupported top-level schema | Existing notice; scaffold with the chosen preset. |
| Missing structured line or malformed structured descriptor | Omit entry and diagnose; no legacy fallback and no unverified version substitution. |
| Valid structured data plus hostile legacy command | Generate solely from structured data; the legacy text is never printed as an instruction. |
| Legacy package/module differs from entry identity | Reject entry; do not install a different package or module. |
| Same module ID exists in two packages | Preserve existing disambiguation; never select by ID alone when ambiguous. |
| Required package is third-party | Show the local consent notice and derived flag for that requirement too. |
| Installed-only package missing locally | Explain that no valid install instruction is available; no guessed version. |
| Later manual install or generation fails | Preserve existing installer errors and recovery instructions; no scaffolder rollback is needed. |

## Migration & Backward Compatibility

Treat catalog JSON, saved plans, exported types/helpers, and CLI grammar as compatibility surfaces even where this picker format is not explicitly enumerated in `BACKWARD_COMPATIBILITY.md`. Existing CLI commands and flags are STABLE under its §13.

1. **Land consumer support first.** Add optional descriptor fields, the strict legacy adapter, local rendering, and tests. Keep exported helper names/signatures or compatible wrappers; keep required `install` output fields as generated projections. A wrapper for `installCommandFor` may return a generated string while delegating to normalization. Do not remove a public export.
2. **Coordinate the publisher separately.** Catalog maintainers add descriptors for each verified line from the same package/version records used to generate legacy fields. Keep `schemaVersion: 1`, `install`, and `installByLine` for older clients. Publisher tests verify both representations select the same identity and version. The publisher source/deployment is outside this checkout and has not been inspected; locating its implementation and confirming ownership are prerequisites for that follow-up change, not assumptions of completed work.
3. **Retain the bridge for at least one minor release.** Document legacy-field/helper deprecation with `@deprecated` where applicable and in `UPGRADE_NOTES.md` when the implementation ships. A legacy-only custom catalog (`OM_MODULES_PICKER_URL`) remains supported for the documented safe subset. Previously accepted noncanonical commands outside that subset are an intentional validation tightening; document examples and migration to descriptors before rollout. A later removal or schema v2 requires its own explicit compatibility decision.

| Consumer / producer | Expected behavior during rollout |
| --- | --- |
| Old consumer + dual-published catalog | Continues using retained v1 command fields. |
| New consumer + old/custom catalog | Parses the bounded legacy grammar and generates its own instruction. |
| New consumer + dual-published catalog | Uses structured data only for that entry. |
| Existing saved schema-v1 plans | Remain untouched; there is no automatic replay. |

Rollback the publisher's additive field to restore new consumers' legacy path. Do not roll clients back to pre-hardening versions. Already generated plans stay as snapshots. Manual installation can modify dependencies, lockfiles, and module registrations; normal version-control/installer recovery applies, and package lifecycle effects are not generally reversible. This proposal neither performs those operations nor promises to undo them.

## Risks & Impact Review

| Scenario | Severity / area | Mitigation | Residual risk |
| --- | --- | --- | --- |
| Attacker injects options, shell text, or a source selector through metadata | High / installation instructions | Closed descriptors, raw validation, exact npm versions, locally fixed grammar, no execution. | A named package can still contain malicious code or install scripts; catalog trust and package provenance remain necessary. |
| Catalog mislabels a third-party package as official | High / trust | Derive consent from package scope locally; preserve installed metadata checks. | Scope does not itself prove package safety. |
| Legacy-only catalogs depend on permissive strings | Medium / compatibility | Bounded adapter, diagnostics, documented tightening, dual publication and minor-release bridge. | Some unsafe/noncanonical legacy entries become unavailable until corrected. |
| Structured and legacy recipes drift | Medium / mixed client versions | Publisher parity tests and coordinated release; new clients use structured authority. | Older clients still consume legacy fields during the bridge. |
| Wrong per-line pin or conflicting dependency versions | High / compatibility | Explicit per-line descriptors, verified-line gating, conflict rejection, no automatic latest fallback. | Catalog verification can still be inaccurate. |

No production dependency, automation policy, external submodule pointer, database, or application API change is part of this design PR. Future implementation must assess dependency availability and obtain any required approval before adding one.

## Acceptance Criteria and Test Coverage

The implementing change must ship these tests with its code; this proposal does not claim they ran:

| Coverage | Required cases |
| --- | --- |
| Boundary unit tests in create-app catalog tests | Scoped/unscoped names; exact releases/prereleases; multi-module identity; missing/invalid line; malformed descriptor; protocol/range/tag/alias/option/Unicode/control-character inputs; identity/locator mismatch; no mutation of raw values before validation. |
| Legacy compatibility unit tests | Both valid flag orders; omitted module; local consent derivation; duplicate/unknown flags; quotes/operators/escapes/trailing tokens; wrong package/module; old latest-line fallback; present invalid data never downgrades to legacy or latest. Retain the hardening commit's hostile-command cases. |
| Selection/plan tests | Stable dependency order; identical-target deduplication; package+module disambiguation; two modules in one package; conflicting pins; unresolved dependencies block dependent instructions; preset suppression; available/missing installed package; source/license/collision warnings; additive plan fields and generated command projections. |
| Existing CLI end-to-end harness in [`catalog-cli.test.ts`](../../packages/create-app/src/lib/catalog/catalog-cli.test.ts) | Serve fixture catalogs from a test-local HTTP server; run real scaffolder with `--modules` and picker choices; assert stdout and saved plan; assert dependency/module files have only preset changes and no installation process ran; cleanup temporary apps/server in `finally`. Cover legacy-only and dual-published catalogs. |
| Installer regression tests | Preserve third-party refusal/opt-in and normal add/enable behavior in [`module-install.test.ts`](../../packages/cli/src/lib/__tests__/module-install.test.ts); prove generated argv parses correctly with existing [`module-install-args.test.ts`](../../packages/cli/src/lib/__tests__/module-install-args.test.ts). Never run catalog strings as processes. |
| Monorepo and standalone smoke checks | Run the existing create-app package tests and Verdaccio-based scaffold validation with controlled fixtures. No live catalog dependency, seeded tenant data, or credentials. |
| Publisher contract tests in its repository | Each descriptor pins the same verified package/version/module as its legacy projection; old-consumer fixture remains compatible. |

All affected external JSON paths are `GET picker.json` (or `OM_MODULES_PICKER_URL`) and the local saved-plan write. There are no affected application API endpoints or browser UI paths, so Playwright business-module scenarios are not added. The CLI integration harness is the real boundary test. Runtime implementation must run the configured ordered validation gate and package checks; migration application is not required by this refactor.

## Phasing

Deliver one capability: a typed installation boundary for the picker. The following are coordinated rollout phases of that capability, not separate installer features.

## Implementation Plan

### Phase 1: Consumer support with legacy compatibility

- **1.1 Define and validate descriptors.** Add optional catalog fields and strict schemas/types, normalize structured and safe legacy input, and cover raw-input/line/identity failure cases. Existing legacy fixtures continue to work through the adapter.
- **1.2 Integrate local rendering and plan projection.** Update real fetch/selection/output call sites, preserve helper compatibility, local consent notices, dependency behavior, and saved-plan fields. Add CLI integration fixtures and regression tests for both formats in the same change.
- **1.3 Verify and document the bridge.** Run the configured gate, create-app tests, monorepo/standalone checks; record diagnostics, intentional legacy restrictions, helper deprecations, and `UPGRADE_NOTES.md` guidance. No publisher deployment is required for the consumer to work with valid old data.

### Phase 2: Coordinated dual publication

- **2.1 Update the catalog publisher.** Locate its source and owner, add per-line descriptors and old/new projection parity tests, then publish additively after consumer support is available. Keep legacy fields for at least one minor release. Record release evidence and the earliest eligible deprecation-removal release; do not remove the adapter in this phase.

## Final Compliance Report — 2026-11-05

| Rule source | Status | Evidence |
| --- | --- | --- |
| Root `AGENTS.md`, `.ai/specs/AGENTS.md`, `CONTRIBUTING.md` | Compliant as a proposal | Date-first OSS spec, explicit pending status, index and related-spec links, test plan, no runtime changes. |
| `packages/create-app/AGENTS.md` | Design covers required checks | Plan-only behavior and template dependencies preserved; monorepo/standalone verification required for implementation. |
| `packages/cli/AGENTS.md`, `BACKWARD_COMPATIBILITY.md` | Design covers compatibility | Existing installer and commands retained; additive fields and deprecation bridge; no migrations. |
| `.ai/qa/AGENTS.md` | Design covers isolation | Fixture HTTP catalogs and temporary app cleanup; no seeded data or live-service requirement. |
| UI, tenant/entity, encryption, optimistic-locking rules | Not applicable | No browser components, entities, database queries, or credentials are introduced. |

The proposal's contracts, failure cases, rollout, and tests describe the same boundary. Maintainer acceptance is required before implementation. Publisher ownership must be confirmed before Phase 2; Phase 1 can proceed against valid legacy catalogs. This report is a document review, not evidence of a shipped refactor.

## Changelog

- **2026-11-05:** Proposed per-line structured installation metadata, local rendering, bounded legacy compatibility, local third-party consent policy, and coordinated rollout/test coverage. Implementation remains pending.
