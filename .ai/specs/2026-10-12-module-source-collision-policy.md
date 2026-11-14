# Module source collision policy

**Date:** 2026-10-12
**Status:** Proposed — design only
**Scope:** OSS module lifecycle and generator preflight in `@open-mercato/cli`
**Related:** [PR #7283](https://github.com/open-mercato/open-mercato/pull/7283), [create-mercato-module PR #6](https://github.com/open-mercato/create-mercato-module/pull/6), [GitHub installation](2026-10-09-github-module-installation.md), [install/eject lifecycle](implemented/SPEC-065-2026-03-14-official-modules-cli-install-and-eject.md), [module overrides](implemented/2026-05-04-modules-ts-unified-overrides.md).

## 📝 TLDR

Keep one enabled provider for each runtime module ID in an application. A canonical source locator identifies its provider, while a package binding determines imports; neither renames the runtime ID. Prevent ambiguous installs, enables and source substitutions before mutation, and validate the same invariant during generation so manual configuration cannot silently choose a winner. Packages with colliding module IDs may remain installed under distinct package bindings, with only one provider enabled.

## Resolved assumptions (autonomous defaults)

| Question | Applied default | Reason |
| --- | --- | --- |
| Q1: Support simultaneous providers with the same runtime ID? | Reject simultaneous activation; do not automatically rename either provider. | Lowest blast radius: preserves existing routes, data, events, RBAC and DI contracts. |
| Q2: Split package installation and lifecycle selection into separate specs? | Keep one invariant across existing lifecycle entry points in this spec; defer a new alias-management capability. | Every entry point must enforce the same provider selection rule to avoid bypasses. |
| Q3: Introduce disable, remove or replace CLI commands? | Use existing `modules.ts` editing and package-manager operations; describe their safeguards without adding commands. | The current CLI exposes add, enable and eject; extra command contracts are unnecessary. |
| Q4: Treat npm and GitHub origins as interchangeable? | No inferred equivalence; retain explicit source provenance. | A repository URL and an npm package with a similar name may contain different code. |

These defaults are reversible design choices, posted for override on the spec PR. None requires weakening a compatibility or security contract.

## 📝 Overview

The intended user can install independent module packages from npm or GitHub, inspect a clear conflict, select exactly one provider, and generate imports that resolve to that provider. This is collision prevention, including all lifecycle paths; simultaneous operation of identical runtime IDs is outside this proposal.

At the surveyed `develop` revision, `modules-config.ts` rejects an existing ID from another `from`, but `module-install.ts` installs before registration and can copy eject sources before registration rejection. `resolver.ts` builds package imports from `from` and the module ID. PR #7283 supplies canonical locator/dependency checks; implementation of this spec must reuse those primitives and close remaining lifecycle gaps, rather than add a second parser or provenance registry. The linked GitHub-install spec is an evolving sibling proposal, not proof that its behavior is already deployed.

## 📝 Problem Statement

`@pkarw/marketing_consents` and `@open-mercato/marketing_consents` can both export `marketing_consents`. Different repositories can also declare the same npm package name. Three collisions must be distinguished:

1. **Runtime ID collision:** two configured providers claim `marketing_consents`.
2. **Package binding collision:** installing another origin under an existing dependency key changes the code of an enabled provider before registration is checked.
3. **Filesystem collision:** ejecting or linking into `src/modules/marketing_consents` can overwrite or shadow existing local code.

Package aliases can resolve the second collision at the package-manager layer. They cannot isolate entity IDs, tables, routes, event IDs, ACL features, i18n namespaces, widget IDs, worker queues or DI keys embedded in module code. Renaming a folder or setting a TypeScript path alias would leave these collisions in place.

## 📝 Proposed Solution

Enforce **one enabled module ID → one selected provider**, with separate source and import identities. Reuse the canonical identifier grammar from PR #7283 and create-mercato-module; do not derive module IDs from npm or repository basenames. Run a shared, read-only collision preflight before install, registration, ejection and generation writes.

Do not add runtime aliases, a second module registry, a database schema, a dependency, or an automatic provider replacement. A developer who needs both implementations running must use separately authored modules with genuinely distinct runtime contracts, or separate applications. A future opt-in runtime alias proposal would require an explicit audit and migration of every namespace listed above, plus package self-imports and persisted references; an `as` field alone cannot make arbitrary third-party modules safe.

### Research: TypeScript ecosystem precedents

| Mechanism | Documented behavior | Decision for Open Mercato |
| --- | --- | --- |
| npm scopes | Scoped packages have distinct install names. | Prefer publisher scopes; preserve full package identity instead of the basename. [npm scope](https://docs.npmjs.com/cli/v11/using-npm/scope/) |
| npm aliases | An alias changes the installed package binding while retaining a separate registry target. | Distinguish `from`/binding from the canonical package and source; never use an alias as proof of provider identity. [npm package spec](https://docs.npmjs.com/cli/v11/using-npm/package-spec/) |
| Yarn package descriptors | Dependency descriptors identify what the package manager resolves. | Delegate package resolution/lockfiles to Yarn; do not create a second package manager. [Yarn add](https://yarnpkg.com/cli/add), [npm protocol](https://yarnpkg.com/protocol/npm) |
| TypeScript `paths` | Type lookup remapping does not rewrite emitted imports. | Do not claim that compiler aliases isolate runtime module registrations. [TypeScript paths](https://www.typescriptlang.org/tsconfig/paths.html) |
| Node package exports | Package entry points and subpaths define valid imports; package-private imports have their own scope. | Generate imports using the actual selected package binding and supported exports; avoid blanket source rewrites. [Node packages](https://nodejs.org/api/packages.html#subpath-exports) |

The conclusion that these mechanisms do not isolate Open Mercato's runtime namespaces is an architectural inference from their documented behavior and Open Mercato's contracts.

## 📝 Architecture

### Identity model

| Value | Meaning | Example |
| --- | --- | --- |
| Runtime module ID | Existing singular application slot; folder/discovery identity, unchanged | `marketing_consents` |
| Source locator | Canonical provider origin, normalized with the shared locator parser | `npm:@pkarw/marketing_consents` or `github:pkarw/consents` |
| Package canonical name | Validated package manifest name, independent of installation alias | `@pkarw/marketing_consents` |
| Import binding | Dependency/workspace key through which this app resolves the package; existing `from` for package-backed modules | `consents_candidate` |
| Local provenance | Ejected module's retained origin and canonical package name; `from` becomes `@app` | `{ id: 'marketing_consents', from: '@app', locator: 'npm:@pkarw/marketing_consents', packageName: '@pkarw/marketing_consents' }` |
| Selection | Version/tag/ref/commit resolved by the package manager; separate from provider identity | npm version or locked Git commit |

Metadata is attribution, not cryptographic authenticity. Prefer the observed install source and actual manifest over self-declared locator claims; reject contradictory observed and declared identities rather than granting official trust. Preserve existing trust/third-party consent. A GitHub origin declaring an official-looking npm name remains a GitHub third-party installation.

Do not concatenate another `#module` suffix into the locator grammar. A multi-module package is addressed by **source locator plus existing module ID selection** (`--module` for add/enable). Package-level `requires` continues to mean the matching package/provider according to the shared dependency resolver; it does not promise that every module exported by that package is active. Bare legacy module requirements select the existing runtime ID. Exact module-in-package dependency syntax is future work unless already supported by the shared parser; do not invent or silently infer it here.

### Shared preflight

The existing config parser/resolver supplies effective enabled entries, package manifests and module directories. Check the candidate's ID, observed source, import binding and destination against those entries. Group active entries by ID before any generator writes: duplicate IDs are errors even if they repeat the same provider. Same-provider repeated `enable` retains the existing documented already-enabled result; it is not a second registration.

Inspect package contents/manifest without executing its module entry points. For remote inputs, resolve the manifest at the exact selected Git commit; for npm, inspect the exact selected artifact using existing package-resolution facilities. If the module ID or binding identity cannot be established before an install that may replace an enabled binding, stop with an actionable inspection error. Never proceed on a guessed basename. Recheck after package installation against the artifact actually installed before enabling/ejecting.

Before `add`, inspect both the selected module and **every enabled module using the dependency binding being changed**. A same-source version update may proceed only if their IDs and importable layout remain available; it must not become an implicit source replacement. If an npm alias is already installed manually and resolves correctly, enable it by its binding and record the actual canonical identity. This spec adds no alias flag and does not broaden accepted `module add` package syntax.

Use the existing AST mutation helpers and resolver as the enforcement seams. Generation validates the whole effective module set once before emitting registries, CSS sources, entities or DI artifacts. No last-wins/first-wins collision resolution. Legitimate local overrides within a **single** registration retain their documented behavior; an extra provider registration is not an override.

## 📝 Data Model

No entities, migrations or PII. Reuse optional locator/package-name fields introduced by the prerequisite work; do not make them mandatory in legacy `ModuleInfo` or `ModuleEntry` contracts. Keep source metadata through eject/edit cycles. For local modules without provenance, show `@app` and the path and treat source identity as unknown; never equate them with an npm package solely by module ID.

Package aliases are not a reason to rewrite the manifest's package name. Realpath equality can recognize the same linked installation, but cannot make two explicit active registrations valid. Distinct npm registries serving the same name are an acknowledged limit of `npm:<name>`: use the project's configured registry and lockfile, and report an unknown origin when evidence is insufficient. Registry-qualified provider identity requires a separate shared-grammar proposal.

## 📝 API Contracts

No HTTP routes or new CLI commands. Existing `yarn mercato module add <packageSpec> [--module <id>]`, `module enable <packageName> [--module <id>]` and eject aliases retain their selectors and trust flags. `enable` takes an installed import binding, not a repository locator or an invented runtime alias. The canonical dependency diagnostic may recommend the proper add command, but must identify the conflicting runtime ID before suggesting installation.

On collision return nonzero and identify: operation, module ID, requested origin/binding, existing origin/binding or local path, and a concrete recovery action. Do not print credential-bearing URLs. Example CLI diagnostic (illustrative wording; use the CLI's existing output conventions):

```text
Cannot enable marketing_consents from npm:@pkarw/marketing_consents.
The module ID is enabled from npm:@open-mercato/marketing_consents.
Keep one provider in src/modules.ts, then run yarn mercato generate.
Installing under another package alias does not allow both module IDs to run.
```

A package-binding conflict additionally identifies the affected enabled module IDs. CLI message implementation must follow the repository's existing translation/output policy; this spec adds no browser strings.

## 📝 UI/UX

CLI only. Print enough provenance to select the intended provider and preserve any existing registration on failure. No web UI, mockups or screenshots apply. Do not offer a misleading automatic rename, force-overwrite or destructive replacement prompt.

## 📝 Edge Cases & Failure Scenarios

| Scenario | Required behavior |
| --- | --- |
| Different npm scopes, same module ID | Raw package-manager install under distinct keys may park both; `module add` (install plus enable) or `enable` rejects the second activation before mutation where knowable. |
| Different GitHub repositories, same module ID | Keep repository origin distinct even when both package names match. Reject the active collision; do not infer equivalence from name/version. |
| Different repositories, same npm name/binding | Reject before Yarn can replace an enabled binding, including when their selected module IDs differ. An already installed distinct alias is a separate binding, not a runtime namespace. |
| Same source, different version/ref | Treat as update of that provider, not coexistence. Preserve requested selector and locked commit; verify all active modules served by that binding. |
| npm vs GitHub source for the same package name | Source change requires deliberate replacement procedure below; a repository field or matching version does not prove equality. |
| Multi-module package | `--module` must resolve an exact exported ID. A colliding selected ID fails; distinct IDs can share a package. A binding replacement must preserve every currently active sibling. |
| Two aliases pointing to one package | Either alias may supply the one active registration. Two entries with the same ID fail. Generated imports follow the chosen alias and metadata keeps canonical identity. |
| Disabled/parked package exports same ID | Ignore parked package for runtime registration uniqueness; never scan and activate it implicitly. Reject package-binding overwrite if it supplies another active module. |
| Disable by editing `modules.ts` | Remove the intended entry; generation validates remaining dependencies and excludes its registrations/CSS/runtime hooks. Package files and explicit source imports are not removed. |
| Provider replacement | Disable the old entry, resolve required dependants explicitly, regenerate, then enable the new provider and regenerate. No automatic cascade or claim of data compatibility. |
| Enabled dependant requires old origin | Replacement fails dependency validation even when the new provider uses the same runtime ID. Bare legacy requirements retain their existing semantics. |
| Eject collides with package registration | Preflight before copying; preserve retained origin when changing the one registration to `@app`. An unrelated existing provider is never ejected as a shortcut to replacement. |
| Eject destination already exists | Fail without overwriting. Never recommend deleting local source as the default recovery. |
| Local override folder with one registration | Preserve existing overlay semantics. Warn/error only for a conflicting second provider or an unsafe copy destination, not every existing overlay. |
| Workspace/symlink/manual file installation | Use observed binding and source where supported. Unknown source does not satisfy an origin-qualified requirement. Do not extend install grammar merely to handle a collision. |
| Manual duplicate or conditional config | Validate the effective environment and fail before generation writes. Document that generation/build is required in every deployed environment; do not reject mutually exclusive branches as simultaneously active. |
| Generated imports vs explicit imports | Emit only selected registrations through the binding. Explicit application imports remain the developer's responsibility and may still load parked code; disabling registration is not a sandbox. |
| Missing export/self-import under alias | Fail resolution with the binding and missing subpath; do not rewrite package internals or fall back to the other provider. Packages that self-import by canonical name may be unsuitable for alias installation. |
| Transitive duplicate packages | Normal package-manager graph may contain duplicates; they never become active modules unless selected by app configuration. |
| Distinct IDs with coincidentally equal routes/DI keys | Existing runtime contract rules still apply. Arbitrary code-level namespace collisions cannot be proven absent by this ID preflight; a general contract collision scanner is deferred. |
| Failed network/manifest inspection | Fail without registration/source edits. Do not switch provider because of auth or network failures. |

### Recovery and rollback

Collision preflight failures perform no package-manager invocation, file copy, registration update or generated write. Package-manager install failures retain the existing package-manager recovery contract; arbitrary install-script effects cannot be rolled back by Mercato. If post-install validation fails because the installed artifact disagrees with inspected metadata, leave registration/source unchanged, identify the installed-but-not-enabled state and the binding/lockfile to restore through the package manager. Do not blindly delete package files or overwrite unrelated concurrent edits.

Generation failure after a valid config mutation reports stale artifacts and the existing regeneration command. Disabling and replacement are explicit configuration operations: commit/back up configuration and lockfile, resolve dependants, regenerate and build before deployment. Neither disable nor removal drops tables, applies migrations or transfers existing data. A different provider reusing a runtime ID is not evidence of schema, migration, ACL or event compatibility.

## Migration & Backward Compatibility

This PR is design-only. Implementation adds diagnostics/validation at existing seams and reuses optional provenance fields from PR #7283. Keep existing ID spelling, config defaults, module discovery filenames, import paths, route mappings, entity IDs, events, widget IDs, DI keys, ACL features and database schemas unchanged. No auto-migration or alias rewriting.

Previously ambiguous manually configured duplicate providers will fail generation instead of silently winning. Implementation must audit whether any documented override contract permits such duplicate entries; preserve valid single-entry overlays, and document invalid duplicate recovery in `UPGRADE_NOTES.md`. If that audit identifies a supported contract being tightened, follow the full deprecation protocol before enforcement; do not silently classify a supported pattern as invalid. Old locator-less configs continue to work with unknown provenance; origin-qualified dependencies require observable evidence, not fabricated metadata.

## 📝 Risks & Impact Review

| Severity | Failure / affected area | Mitigation | Residual risk |
| --- | --- | --- | --- |
| High | Same binding is replaced before active ID validation | Check binding consumers and inspect exact candidate artifact before install | Metadata can change externally; post-install recheck and honest recovery remain necessary |
| High | Automatic aliasing makes two providers share persisted/runtime namespaces | Reject simultaneous identical IDs; no string replacement | Distinct IDs may still contain manually hardcoded conflicting contracts |
| High | Old data assumed compatible with a replacement provider | Explicit replacement with schema/migration review; no automatic data mutation | Operator remains responsible for provider compatibility |
| Medium | Metadata claims another provider or official trust | Compare observed install origin and actual manifest; preserve consent checks | Locator is attribution, not signature verification |
| Medium | Conditional/manual configuration bypasses CLI checks | Shared generation preflight for effective config | Deployment environments must regenerate/validate their own effective config |
| Medium | Alias generates broken imports or wrong dependency matches | Separate binding and identity; compile/resolve fixtures for aliases and exports | Arbitrary package self-imports cannot be repaired transparently |
| Low | Additional metadata inspection costs | Reuse one manifest/package-resolution result per candidate/binding | Remote inspection adds bounded network latency and can fail offline |

No runtime tenant/RBAC/data access changes, caches or new workers. Preflight cost is linear in effective entries plus inspected package modules; avoid repeatedly fetching the same artifact. Rollback removes enforcement changes without changing stored application data, but operators must still repair ambiguous configs.

## 📋 Phasing

One capability, delivered incrementally: Phase 1 establishes the invariant at resolution/generation, Phase 2 closes mutation ordering gaps, and Phase 3 documents and proves the whole lifecycle. Each phase must leave valid applications working; simultaneous runtime aliasing is not a later phase of this plan.

## 📋 Implementation Plan

### Phase 1 — Shared validation

1. Reuse canonical source/dependency parser from PR #7283 and observed package-binding resolution. Add one collision preflight result consumed by existing lifecycle helpers; verify no new mandatory public fields.
2. Validate all effective enabled IDs once before generator output. Preserve single-registration overlays and conditional evaluation. Unit fixtures cover distinct origins, exact duplicate entries, unknown provenance and aliases.

### Phase 2 — Mutating entry points

1. Wire preflight before package installation and before eject/link destination writes; inspect affected binding consumers and exact artifact metadata. Preserve same-provider update and existing already-enabled semantics.
2. Recheck the installed artifact before registration; retain origin/package attribution through eject. Test malformed/unavailable metadata, manifest disagreement and generation failure recovery without destructive cleanup.

### Phase 3 — Lifecycle coverage and guidance

1. Add self-contained CLI integration fixtures for npm-style packages, GitHub metadata/resolution stubs, local/workspace packages, aliases and multi-module packages. Share the canonical identifier conformance cases with create-mercato-module; do not fork the identifier grammar.
2. Document enable selection, disable/edit/regenerate, source replacement, parked packages and explicit-import limits; add applicable upgrade notes. Run the smallest relevant CLI tests/build, generator verification and standalone harness refresh required by repository policy for an implementation PR.

### Required implementation coverage

| Path | Required assertion |
| --- | --- |
| Add npm, GitHub shorthand/URL/canonical input, exact version | Same ID or active-binding collision is detected before install; candidate origin/version remains exact |
| Enable installed normal/aliased binding | Only selected provider registers; alias never masquerades as canonical package identity |
| Multi-module package update | All active siblings survive; ambiguous selection and ID conflicts fail |
| Eject and supported link workflow | Failure leaves source/destination/config byte-identical; successful eject keeps provenance |
| Disable/manual edit + generate | No disabled registrations, worker hooks or generated CSS sources; dependant validation is actionable |
| Import generation | Chosen binding resolves under package exports; parked provider absent from registries; typecheck compiled fixture |
| Replacement npm↔GitHub and origin-qualified requires | Same ID does not satisfy the wrong origin; deliberate compatible replacement works after explicit disable |
| Manual duplicates / conditional environment | Fail before writes for effective duplicates; mutually exclusive registrations work per environment |
| Failure injection | Network/preflight failures make no writes; post-install disagreement reports partial state without false rollback claims |
| Compatibility | Existing core/app overlays and locator-less config fixtures remain valid |

No HTTP or browser API paths change, so API/UI integration coverage is N/A. These CLI integration tests must ship with the implementation, create and remove their own temporary applications/packages, use mocked network boundaries rather than public release availability, and assert package-manager calls plus before/after file contents. This spec PR does not implement or claim these tests passed.

## Final Compliance Report — 2026-10-12

Guides reviewed: root `AGENTS.md`, `.ai/specs/AGENTS.md`, `packages/cli/AGENTS.md`, `BACKWARD_COMPATIBILITY.md`, `.ai/docs/pr-workflow.md`, and spec-writing review/compliance checklists.

| Requirement | Result | Evidence |
| --- | --- | --- |
| Smallest cohesive capability | Pass | One provider-selection invariant; runtime aliasing/new lifecycle commands deferred |
| Existing canonical mechanisms | Pass | Reuses config AST helpers, resolver, locator parser, Yarn and generators |
| Public contracts and undo | Pass | Additive optional metadata only; compatibility audit/deprecation gate and failure recovery specified |
| Identity/source/binding distinction | Pass | Alias, package name, repository provenance and multi-module selection remain separate |
| Every mutation has failure handling | Pass | Preflight, post-install validation, eject/copy and regeneration states documented |
| Tenant isolation, encryption, CRUD, optimistic locking | N/A | No runtime entities, HTTP mutations or user-editable forms |
| UI/design system/accessibility/frontend budgets | N/A | CLI diagnostics only; no browser surface |
| Cache/query/queue performance | N/A | No runtime caching, persistence or workers added |
| Self-contained integration coverage | Pass | Full CLI lifecycle matrix is mandatory for implementation |
| No production dependencies/generated edits | Pass | Design-only document |

**Verdict:** Ready for specification review. Implementation must re-audit current sibling PR behavior and compatibility before choosing remaining gaps; this document does not authorize contract-breaking runtime namespacing.

## Changelog

- **2026-10-12:** Proposed source-aware collision prevention covering installation, activation, disable/edit, imports, updates, ejection and replacement; recorded ecosystem research and autonomous defaults.

### Review — 2026-10-12

- **Reviewer:** Agent; independent scope-cohesion review recorded on the spec PR.
- **Security:** Passed for design; retains observed-origin checks and third-party consent.
- **Performance:** Passed; shared linear preflight with reused metadata resolution.
- **Cache:** N/A; no runtime caching changes.
- **Commands:** Passed; existing command contracts preserved and recovery specified.
- **Risks:** Passed; binding replacement, partial installation and persisted data hazards explicit.
- **Verdict:** Ready for specification review; implementation validation remains required.
