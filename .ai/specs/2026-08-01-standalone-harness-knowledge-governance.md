# Standalone Harness Knowledge Governance

- **Status:** Draft
- **Date:** 2026-08-01
- **Revised:** 2026-08-03
- **Scope:** OSS standalone harness evolution/refresh workflows and evaluator synchronization
- **Related:** [Standalone Canonical Example Module](./2026-07-31-standalone-canonical-example-module.md), [Standalone Harness Example and Linked-Source Read Policy](./2026-08-01-standalone-harness-example-read-policy.md), [Standalone AI Development Harness](./2026-07-24-standalone-ai-development-harness.md), design-foundation [PR #4277](https://github.com/open-mercato/open-mercato/pull/4277) (merged 2026-08-03 as [PR #4891](https://github.com/open-mercato/open-mercato/pull/4891)), design-system gallery [PR #4301](https://github.com/open-mercato/open-mercato/pull/4301), follow-up issue [#4670](https://github.com/open-mercato/open-mercato/issues/4670)

## TLDR

Changes to standalone agent knowledge, routing, discovery, canonical example code, visible source links, installed-package versions, or read permissions can invalidate evaluator behavior even when case JSON still parses. Extend `om-evolve-harness` and repo-local `om-refresh-standalone-harness` so such changes always include a complete emitted-owner/source-link audit, fail-before/pass-after evaluator tests, synchronized case/oracle/release assets, packed-target validation, generated copies, documentation, and an affected certified lane. Updating evaluator allowances without adding or repairing the owning visible links is incomplete.

## Problem Statement

The harness skills already coordinate cases and release assets, but they do not make evaluator/read-policy and visible-source-link updates an explicit mandatory consequence of knowledge-contract changes. A skill or `AGENTS.md` update can therefore permit new example reads, alter routing, remove executable examples, render a directory-only fact link, or move canonical/installed sources while tests continue enforcing the old context model. The current gap demonstrates why permissions alone are insufficient: the emitted implementation guides contain no direct example link, generated facts omit several exact source links, and cases broadly admit installed source without binding it to a routed owner. This governance rule is generic and independently deployable from the canonical example that exposed the gap.

## User-Directed Decision

The 2026-08-01 brief explicitly requires harness-development guidance to update evaluations whenever the harness knowledge/examples change and to allow relevant example reading more broadly. The 2026-08-03 clarifications also require the harness itself to preserve example coverage through direct links to the canonical example, installed package modules, and [PR #4301](https://github.com/open-mercato/open-mercato/pull/4301) design-system gallery sources used by the example UI, while every derived design-system item carries honest [PR #4277](https://github.com/open-mercato/open-mercato/pull/4277) applicability/provenance. These are confirmed requirements, not autonomous defaults.

## Change Classification

The owning workflows classify a change as `knowledge-contract` when it changes any of:

- emitted `AGENTS.md` task routing or mandatory workflow;
- skill ownership, links, progressive-disclosure references, or tier emission;
- canonical example/source locations;
- visible exact-file source links, their owner/topic classification, the source-link inventory, or the prior-example parity ledger;
- installed package/version/preset applicability for a declared source target;
- any file mapped by a case `exampleRoots` entry or `src/modules/example/references/surface-inventory.json`;
- generated fact provenance or rendering of exact source files;
- PR #4883 module-fact/extension enum sets, extraction classification, local-example reference-fact generation, topology correlation, or override-target resolution;
- PR #4301 gallery `types.ts`, `registry.ts`, mapped `entries/**`, mapped UI primitive/backend sources, emitted/local token CSS, example UI imports, or design-system provenance/route/package mappings;
- PR #4277 final provenance/package baseline, local token source or emitted snapshot/generator contract, packed Code Connect config/mapping/public-prop coverage, per-item foundation status, or standalone design-skill/tier availability;
- module discovery/generator contracts;
- case `context.required`, `allowedExtra`, forbidden reads, or framework fallback;
- evaluator interpretation of tool/file-read traces;
- writable AST/runtime oracles needed to prove the new knowledge is used.

Ordinary copy refreshes with byte-identical semantics remain `asset-sync` and do not require a new evaluator behavior test, but still run existing synchronization validation.

### Machine-enforced classification

Add `packages/create-app/agentic/shared/ai/harness/knowledge-change.schema.json` and a validator exposed as `yarn workspace create-mercato-app harness:validate-knowledge-change --manifest <path> --base <ref>`. The run manifest is a validation artifact with:

```json
{
  "changeClass": "knowledge-contract | asset-sync",
  "baseRef": "git ref",
  "resolvedBaseSha": "40 hex",
  "headSha": "40 hex",
  "affectedCaseIds": ["OMH-..."],
  "affectedRanges": ["range-id"],
  "changedContracts": ["routing | skill-link | source-link | example-source | installed-source | discovery | context-read | evaluator | oracle"],
  "focusedTestFiles": ["exact path"],
  "authoritativeFiles": [{ "path": "exact path", "sha256": "64 hex" }],
  "generatedFiles": [{ "path": "exact path", "sha256": "64 hex", "sourcePath": "exact path" }],
  "expectedCatalogCount": 0,
  "requiredReleaseLanes": ["lane-id"],
  "documentationFiles": ["exact path"],
  "sourceLinkInventory": {
    "path": "packages/create-app/agentic/shared/ai/harness/source-link-inventory.json",
    "baselineRef": "40 hex",
    "expectedOwnerCount": 0,
    "expectedTopicCount": 0,
    "resolvedLinkCount": 0,
    "baselineAssetCount": 8,
    "baselineDispositionCount": 136,
    "baselinePath": "packages/create-app/agentic/shared/ai/harness/source-link-baseline.json",
    "baselineSchemaPath": "packages/create-app/agentic/shared/ai/harness/source-link-baseline.schema.json"
  },
  "focusedExecutions": [{
    "testFile": "exact path",
    "command": ["argv", "without shell interpolation"],
    "baseWithTestPatch": { "exitCode": 1, "stdoutSha256": "64 hex", "stderrSha256": "64 hex" },
    "head": { "exitCode": 0, "stdoutSha256": "64 hex", "stderrSha256": "64 hex" }
  }]
}
```

`focusedExecutions`, resolved SHAs, exit codes, and output hashes are controller-owned output fields: authored input must omit them. The validator resolves `--base` and requires the authored `baseRef` to resolve to the same SHA, creates isolated temporary worktrees, applies only the focused-test diff to the base worktree, runs each argv command there, then runs it at HEAD. It writes the completed manifest/result atomically. Every knowledge-contract test must fail non-zero on base-plus-test-only and pass zero at HEAD; an absent test-only diff, unchanged failure, flaky retry, shell-interpolated command, SHA mismatch, or author-supplied evidence fails validation. `asset-sync` requires no fail-before execution only when the derived classifier proves authoritative semantics are byte-identical.

The validator derives the class from the diff rather than trusting `changeClass`. A change is `knowledge-contract` when the diff touches emitted/root agent instructions, authoritative skill/reference files, the source-link inventory/parity ledger, discovery/generator contracts, evaluator/oracle code, routing/context JSON pointers in `cases.json`, the canonical example inventory, generated fact provenance/rendering, or any exact source mapped by an affected case. Moving, deleting, or semantically changing a linked file under `apps/mercato/src/modules/example/**`, its byte-identical template mirror, or its emitted runtime-source counterpart is `example-source`. Changing a linked package, package-relative target, version, export/publish set, preset applicability, or resolved packed hash is `installed-source`. A mapped PR #4301 gallery type/manifest/entry, mapped UI implementation, example public import, or local/template token source change is also `knowledge-contract` and `source-link`; registry/coverage changes with no affected mapped topic are still checked for mapping drift. A mapped PR #4277 token snapshot/generator, local CSS source, Code Connect file/config/public import/prop/node, design skill/tier, final PR/package provenance, or per-item status change is likewise `knowledge-contract`; exact packed Code Connect targets are `installed-source` despite their role-gated non-`src` location. Unknown changes fail closed to `knowledge-contract`. `asset-sync` is valid only when all changed paths are generated/materialized copies or count/docs snapshots, every `sourcePath` authoritative SHA is unchanged from the base, and regenerated hashes match exactly. A declared class that differs from the derived class fails.

For `example-source`, the validator resolves mappings from the base and head inventories, requires hashes for the authoring file, template mirror, and emitted file when the scaffold copies it, and rejects stale/missing capability IDs, moved paths without an inventory update, a non-identical template mirror, or a generated copy that was not refreshed. Repository-only `__tests__` and `__integration__` entries may be QA evidence paths but are not falsely required in emitted fixtures and are derived as `readStatus: "qa-only"`; cases may reference only `readStatus: "readable"` source records. Every added or materially changed runtime/discovery extension surface must name at least one self-contained module integration test and its dependency modules, even when the surface is added to an existing capability row; missing test paths, seeded-data reliance, or static/unit-only proof fails. An ordinary module capability cannot be reclassified as an installed fallback merely to avoid extending the canonical example.

The validator also regenerates the canonical spec's `factCoverage` ledger from the actual PR #4883/shared exports and extracts the local example from each of the authoring, template, and emitted roots. It runs the example through the same correlation batch in an explicitly activated disposable context, writes the result only to `.ai/guides/reference-module-facts.json` / `.ai/guides/reference-modules/example.md` with `projectionKind: "activated-reference"`, `sourceKind: "local-reference"`, and `runtimeSelected: false`, and verifies normal `.ai/guides/module-facts.json` keeps its combined package-module semantics while normal module Markdown stays the enabled-filtered package subset. It requires semantic parity with a fresh activated app-local extraction, layout-correct portable source paths, exact canonical-JSON fingerprints, and every generated Markdown link resolved from its real owner directory. It rejects late object merges, package-only omission, stale enum classification, conditional registries invisible to static extraction, duplicate module IDs, unresolved reference diagnostics, wrong `node_modules` source roots, false current-runtime wording, or a fact claiming a surface without its declared integration proof. `framework-only`, `catalog-only`, `currently-unbound`, and `negative-fixture` are closed statuses; only the exact classifications approved by the canonical spec may use them, and negative fixtures are forbidden in activated canonical output.

For `source-link` and `installed-source`, the controller derives `source-link-inventory.json` from the complete emitted-owner scan plus canonical/packed-source inventories; it is never separately authored. The validator compares rendered Markdown links exactly with that derived output. Every `source-required` topic must have a visible link in its declared owner; every rendered source link must have one manifest record; every fence in the canonical spec's exact eight-asset pinned-`main` baseline must validate against `source-link-baseline.schema.json` and have one checked disposition. The validator verifies the eight full-file hashes, per-asset CommonMark fence counts, and 136 total dispositions before resolving topic mappings. It generates each applicable preset/tier from a coherent package build, installs actual packed/Verdaccio artifacts, resolves each link relative to its emitted owner, and requires an exact regular file with the recorded package/version/hash. It rejects code-span-only paths, directories, roots, wildcards, line anchors, undeclared/orphan links, symlink escapes, unpublished/workspace-only files, missing optional packages, wrong-version duplicates, stale generated facts, QA-only case references, and manual manifests that claim a link the owner does not render. Package `src/**` is preferred and required while it is published; `dist` may be used only after the read tool/evaluator explicitly supports exact compiled files and records degraded provenance. The sole non-`src` exception is an exact packed regular `node_modules/@open-mercato/ui/figma/<name>.figma.tsx` target with `referenceRole: "figma-code-connect"`, an applicable Figma-facing prompt, package version/hash, and no directory/glob/sibling/transitive permission.

For PR #4301 design-system mappings, the controller pins merged/package SHA `bf25803d7a8c85c8552db9e76c7cc4398d1768be` and retains head `186af58044c7530885a889c41f53bb36a5093d82` only as provenance. It derives families and entries from the packed core registry rather than hard-coding counts or allowlists, resolves direct entries to exact separately declared packed UI sources, classifies absent composites such as `CrudForm`/`DataTable` as `composite-not-direct` with checked constituent entries, and maps foundations/tokens to emitted `src/app/globals.css` rather than workspace `apps/mercato/src/app/globals.css`. It requires separate rule-owner, example-source, gallery-entry, UI-implementation, and optional local-token records; registry/types may be discovery records only, while gallery unit/integration tests remain QA-only evidence. Every built-in generated module set must omit `design_system` and mark references `source-only`; a separate activation fixture alone may expose the route. Certification is blocked if the merged core/UI sources and hashes are absent from the packed standalone app.

For PR #4277 design-foundation sidecars, the controller records `fb9b8ddfe4470ef11d312caa4628c46af7d48adf` only as the audited head and certifies against the merged/package baseline. That baseline exists as of 2026-08-03: the work merged as [PR #4891](https://github.com/open-mercato/open-mercato/pull/4891), commit `b2d26489c683edc44265212ac8a79be1b981774f`, so the final-SHA gate is satisfiable rather than blocking; it still blocks whenever a required merged/package SHA or its artifacts are missing. It classifies every PR #4301-derived gallery item, whether or not the canonical example consumes it, for token applicability, independent snapshot availability, Code Connect mapping/artifact/export/coverage/publication status, separate gallery and Code Connect node status/IDs, their derived comparison, and design-tier applicability; derives mappings from actual `figma.connect` AST calls in final packed `@open-mercato/ui/figma/*.figma.tsx` files; correlates exact public import plus export symbol and props/variants with the gallery; and never copies counts or statuses. Local `src/app/globals.css` remains token truth even when a derived snapshot is emitted. Code Connect files remain `installed-packed-auxiliary` and `not-exported` unless final package evidence changes those orthogonal facets; readable does not mean runtime/exported. A standalone token snapshot/guide becomes readable only if emitted deterministically from that local file with rewritten source/parity proof; the monorepo snapshot/exporter remains QA/governance evidence. The opt-in design skill becomes linkable only after a portable standalone emission, local `design` tier selection, complete dependency validation, and installer/hash proof. A certified `unavailable` skill record is valid when no owner/source ID or case depends on it. The validator enforces the canonical mapped/unmapped/not-applicable cross-facet tuples, normalizes both node authorities independently, and derives match/mismatch/not-comparable without allowing either authority to promote the other. Placeholder nodes and incomplete mappings remain placeholder and partial; unmapped coverage is `none`; parse success leaves publication `not-evidenced`. Missing packed files, broad non-`src` reads, default-tier leakage, credentials, operations reports, network, push, or publication fail.

For `knowledge-contract`, the validator requires at least one changed focused test that demonstrates the affected contract and passes the controller-owned base/head execution above, verifies every affected case exists, derives the current catalog count from `cases.json`, checks validator/oracle membership required by each case mode, derives release lanes from `release-matrix.json`, resolves every documentation/example/source-link inventory path, and compares every generated/template/packed-target hash with its authoritative source. Missing owners, baseline dispositions, visible links, cases, tests, executions, lanes, docs, mappings, hashes, counts, or affected-range entries are hard failures. The manifest cannot waive a required surface; empty arrays are permitted only when the validator derives that the surface is inapplicable for every affected case mode.

## Mandatory Workflow for `knowledge-contract` Changes

Both `packages/create-app/agentic/shared/ai/skills/om-evolve-harness/SKILL.md` and repo-local `.ai/skills/om-refresh-standalone-harness/SKILL.md` must require:

1. Name the changed knowledge contract and affected case IDs/ranges.
2. Inventory every emitted knowledge owner affected by the topic and classify it `source-required`, `self-authoritative`, `generated-fact`, or `retained-normative-snippet`; when replacing prior examples, update the finite `main` parity ledger.
3. Render visible exact-file links in each `source-required` owner and update the source-link inventory. Do not treat an evaluator allowance, directory hint, wildcard, or manifest-only entry as delivery.
4. Add a focused evaluator/oracle/read-policy test that fails for the old behavior; retain sanitized fail-before evidence.
5. Update the authoritative case/context policy and the evaluator implementation together.
6. Synchronize every mode-dependent surface: `cases.json`, validators, writable AST/runtime oracles, release matrix, focused tests, catalog counts, README/RELEASE/spec documentation, source-link/example inventories, generated facts, and emitted/generated copies.
7. Generate fresh applicable presets from a coherent build, install packed artifacts, resolve every local/installed link, and run every integration test declared by each added or materially changed example extension surface.
8. Prove the focused test passes and run the affected certified lane; reject completion when any authoritative/generated/packed hash, link, owner, baseline disposition, or count is stale.
9. Generate and pass the machine validation manifest above; attach its sanitized result to the affected-lane evidence.

For PR #4883-shaped changes, steps 2–8 also compare all exported fact/contribution/activation/host/capability/policy/target/resolution/registry/override/diagnostic/surface sets to the example ledger, require one permitted classification per value, and run the reference-fact generator plus activated-extractor parity and every mapped integration test. A public union value that no extractor can emit must be explicitly catalog-only with a tested ownership rationale or `negative-fixture` with a malformed-input proof; it cannot silently count as example coverage. As of 2026-08-03, [PR #4883](https://github.com/open-mercato/open-mercato/pull/4883) is still `OPEN` and `BLOCKED`, and `packages/cli/src/lib/generators/module-override-targets.ts` is absent from `develop`, so the override-target half of this comparison cannot run until it merges; see the upstream-blocked note in the [canonical example spec](./2026-07-31-standalone-canonical-example-module.md). No requirement here is relaxed by that dependency.

For PR #4301-shaped or mapped UI changes, steps 2–8 also derive the gallery family/entry set, validate unique family/entry/variant IDs and snippet/import consistency, resolve exact packed UI sources, refresh direct/composite example mappings and merged/provenance SHAs, assert built-in module registries omit `design_system`, run the existing gallery coverage/integrity/render-smoke suites plus separately activated gallery integration QA, and run the affected example UI/hydration paths. An AST/import-graph check rejects dependencies in either direction between `example` and `design_system`. The workflow never copies the gallery lists, allowlists, snippets, or design rules into harness policy.

For PR #4277-shaped or affected foundation mappings, steps 2–8 also re-run deterministic token export/parity when a local snapshot is emitted, inspect the final package tarball, parse Code Connect sources, derive import/prop/variant/node/coverage status from AST, correlate every PR #4301 item, verify default and opt-in tier installation plus all skill references, refresh every affected foundation record, and execute only affected Figma/design harness cases. Push, publish, Figma network/plugin/REST calls, credentials, and operations reports are forbidden validation steps.

When the change adds a missing ordinary module surface, both workflows route it to the canonical `apps/mercato/src/modules/example/**` authoring tree, materialize the byte-identical create-app mirror through `yarn template:sync:fix`, update the surface/source-link inventories and exact case links, add a self-contained activated integration test, and run `yarn template:sync`. They must not create a second teaching module or satisfy the case only through installed-source fallback.

The skill provides a checklist and routes to the exact files; it does not paste evaluator implementations.

## Scope Boundaries

### In scope

- The two owning harness skills and their direct workflow references.
- Evaluator/read-policy tests and synchronization guards for knowledge-contract changes.
- Machine validation and affected-lane certification for knowledge-contract changes.
- Canonical-example source/link classification and monorepo/template/emitted hash synchronization.
- Complete emitted-owner classification, prior-example parity, visible direct-link synchronization, exact generated-fact provenance, and packed installed-source validation.
- Enforcement that every added or materially changed canonical-example runtime/discovery extension surface declares self-contained integration coverage, regardless of capability-row creation.
- Enum-derived PR #4883 fact/topology/diagnostic coverage, separate local-example reference-fact generation, normal package-output preservation, fact-readable registry enforcement, and exact generated source-link synchronization.
- PR #4301 design-system mapping derivation, exact gallery/UI/example/token source synchronization, packed-package verification, and QA-evidence execution without broadening readable context.
- PR #4277 per-item design-foundation derivation, final packed Code Connect inspection, conditional local snapshot/design-tier synchronization, and no-external-execution enforcement.

### Out of scope

- Adding a particular canonical example capability or changing a particular feature policy.
- Defining generic example-read semantics, owned by the linked example-read-policy spec.
- Broad multi-runner certification tracked by #4670 beyond affected lanes.
- Weakening secret, credential, writable-root, or network protections.
- Manual Figma Variables/Code Connect publication, node-existence certification, screenshots, or any credentialed network operation.
- Requiring new behavior tests for byte-only asset synchronization.

## Testing and Validation

- Skill contract tests detect the derived `knowledge-contract`/`asset-sync` classification, including `source-link`, `example-source`, and `installed-source`, and all nine mandatory steps in both workflows.
- Fixture tests prove missing evaluator, stale generated copy, stale count/doc, or missing certified lane fails completion.
- Schema/validator fixtures prove a false declared class, incomplete arrays, bad hashes, bad catalog count, nonexistent case/range, and missing mode-required oracle all fail.
- One synthetic knowledge change demonstrates fail-before/pass-after and full synchronization without touching production cases.
- Example-source fixtures cover changed/moved/deleted linked files, stale capability mappings, non-identical template mirrors, correctly filtered repository-only tests, stale emitted copies, and forbidden fallback substitution.
- Whole-harness fixtures cover a missing visible link, manifest-only record, undeclared rendered link, directory/wildcard/line-anchor link, orphan baseline topic, missing generated-fact source, wrong preset/version, unpublished/workspace-only target, symlink escape, and stale packed hash.
- Extension fixtures reject any added or materially changed example runtime/discovery surface without a declared module-local integration test/dependency list, including a new surface placed inside an existing row, and prove each declared test runs self-contained from an activated fresh scaffold.
- Module-fact fixtures cover package-only omission of the reference projection, any app-local module leaking into normal package outputs, a wrong/missing local source discriminator, null-core stamp regression, late-merge topology loss, stale canonical-JSON fingerprints/enum-ledger rows, statically invisible conditional registries, unreachable/misclassified activation kinds, false module-override contribution ownership, unbound-surface fabrication, an activated negative-fixture row, missing `unknown-framework-mode` diagnostics, false current-runtime wording, activated-extractor parity failure, non-zero canonical diagnostics, and valid framework/catalog/unbound/negative-fixture classifications.
- Design-system fixtures reject hard-coded family counts/coverage allowlists, stale provenance/merged-package SHAs, broad or sibling gallery reads, false direct composite claims, gallery-only guidance, unresolvable public imports, missing published core/UI source, a fresh preset that registers or exposes `design_system`, stale example mappings, QA-only test reads, workspace token paths, and either runtime dependency direction between `example` and `design_system`; they consume the real gallery coverage/integrity/render-smoke and separately activated integration results as evidence.
- Design-foundation fixtures reject a stale/missing final PR #4277 SHA, absent packed Code Connect file, broad `figma/` read, fabricated mapping, gallery/Code Connect node conflation, invalid mapping/artifact/export/node/coverage/source-ID tuples, placeholder-as-live node, partial-as-complete coverage, parse-as-published status, workspace-only or wrongly sourced snapshot, design-skill leakage into default tiers, unavailable/broken skill references, credentials/operations-report access, and any network/push/publish execution. They derive all PR #4301 item mappings/statuses and prove exact non-`src` resolution on POSIX and Windows paths.
- Run focused create-app tests, instruction/link budgets, affected harness lane, and the configured validation gate.

## Implementation Plan

### Phase 1 — Add enforceable workflow classification

1. Add failing schema/classifier/contract tests for `knowledge-contract` versus `asset-sync`, including `example-source`, the manifest fields, and the mandatory checklist.
2. Add the emitted-owner/source-link inventory and `main` parity ledger, then update both owning skills/references and make the tests green without duplicating implementation prose.
3. Add stale-asset/count/hash/link/owner/integration fixtures and green synchronization behavior.

Exit criterion: both workflows use the same machine-derived classification and cannot report a knowledge-contract change complete with missing surfaces or a passing validation manifest.

### Phase 2 — Certify machine-enforced synchronization

1. Add failing fixtures for false classification, missing base/head evidence, stale hashes/counts/docs/example/source-link mappings, moved/deleted linked files, mirror drift, missing owners/baseline dispositions/cases/ranges/oracles/integration tests, unresolved packed targets, and absent release lanes.
2. Implement the validator/controller evidence contract and make each fixture green before proceeding.
3. Run a synthetic end-to-end knowledge-contract change through the affected lane and refresh authoritative/generated assets through the owning workflow.

Exit criterion: workflow guidance, machine manifest, assets, docs, base/head evidence, and certified lane agree, with all focused and configured gates green.

## Backward Compatibility

The change strengthens internal harness procedure and evaluator policy. It does not change generated application runtime, public APIs, schema, or provider behavior. Existing case IDs remain stable; semantic deduplication and additive evolution rules still apply.

## Risks

| Risk | Mitigation |
|---|---|
| Every refresh becomes expensive | Classify byte-only `asset-sync` separately; require new behavior proof only for knowledge contracts. |
| Skills, canonical example, and evaluator drift | Identical contract tests for both owning workflows plus inventory-derived monorepo/template/emitted hashes and counts. |
| Synthetic proof misses production behavior | Run the affected real certified lane after focused fixtures. |
| Provisional or partial Figma metadata is promoted into harness authority | Require final-baseline pack/AST derivation, closed per-item status, conditional tier emission, and explicit no-network/no-publish enforcement. |

## Final Compliance Report

### AGENTS.md Files Reviewed

- `AGENTS.md`
- `.ai/specs/AGENTS.md`
- `packages/create-app/AGENTS.md`
- `packages/create-app/template/AGENTS.md`
- `.ai/docs/agent-instructions.md`
- `BACKWARD_COMPATIBILITY.md`

### Compliance Matrix

| Area | Result |
|---|---|
| Scope cohesion | One generic process capability: synchronize harness evaluator behavior with knowledge contracts. |
| User decision | Explicitly confirmed by the 2026-08-01 brief; no open architectural default. |
| Read safety | Generic example-read semantics are explicitly outside this spec and owned by the linked companion. |
| Canonical example | Linked `src/modules/example` changes are `example-source` knowledge contracts; exact authoring/template/emitted mappings and declared extension integration tests must agree. |
| Direct source coverage | Every emitted owner and prior implementation topic is classified; source-required owners visibly link exact canonical or packed installed files. |
| Finite oracle | Machine-derived classes, manifest schema, nine workflow steps, owner/topic/link inventories, packed hashes, base/head execution evidence, and affected-lane evidence are deterministic. |
| Incremental delivery | Each phase pairs failing fixtures with implementation and exits green. |
| Runtime/compatibility | No generated-application runtime, API, schema, provider, or case-ID contract changes. |

### Verdict

**Fully specified and ready for implementation after design review.**

## Changelog

- 2026-08-01: Initial draft defined machine-enforced knowledge-contract versus asset-sync governance.
- 2026-08-03: Added `example-source` classification for inventory-linked canonical example code, exact authoring/template/emitted hash synchronization, missing-surface extension routing, and stale/moved/deleted source fixtures.
- 2026-08-03: Added whole-harness owner/link parity, `installed-source` classification, visible exact-file enforcement, packed-package resolution, generated-fact provenance, and mandatory integration-test declarations for new example extensions.
- 2026-08-03: Added PR #4883 enum-ledger governance, separate local disabled-example reference-fact generation, normal package-output preservation, activated-extractor parity, canonical fingerprints, local-source discrimination, negative diagnostic fixtures, static fact-readability checks, topology/override-target validation, and mapped integration execution for every executable mechanism.
- 2026-08-03: Made the source-link inventory explicitly controller-derived, added baseline-schema validation and readable-versus-QA evidence status, and closed the integration-test evasion path for surfaces added to existing capability rows.
- 2026-08-03: Bound baseline validation to eight exact pinned assets, their full-file hashes, per-asset CommonMark fence counts, and 136 mandatory dispositions.
- 2026-08-03: Added PR #4301 design-system knowledge governance: derive gallery mappings, pair exact gallery/UI/example/token sources, validate final packed SHAs and preset availability, consume gallery QA suites, and reject copied lists/rules or gallery-only implementation guidance.
- 2026-08-03: Pinned PR #4301's merged/package baseline, distinguished direct from composite-constituent mappings, required `design_system` to stay unregistered/source-only in every fresh preset, and added bidirectional runtime-decoupling checks.
- 2026-08-03: Added PR #4277 design-foundation governance: final-baseline gating, every-gallery-item applicability, packed Code Connect AST correlation, conditional local snapshot/design-tier emission, and negative enforcement against placeholder/completeness/publication/credential overclaims.
- 2026-08-03: Corrected stale implementation baselines before execution — recorded PR #4277 as merged (PR #4891, `b2d26489c`) with `fb9b8ddf…` retained only as the audited head so the final-baseline gate is satisfiable, and recorded PR #4883 as still upstream-blocked with `module-override-targets.ts` absent from `develop`.
- 2026-08-03: **No implementation.** PR [#4897](https://github.com/open-mercato/open-mercato/pull/4897) (execution record in [`.ai/runs/2026-08-03-implement-standalone-canonical-example.md`](../runs/2026-08-03-implement-standalone-canonical-example.md)) delivered canonical-example Milestone A plus the Phase 1 spec-routing and example-read-policy foundations, and landed nothing from this spec: `knowledge-change.schema.json`, the `knowledge-contract` / `asset-sync` / `example-source` / `installed-source` classifier, the validator/controller evidence contract, the emitted-owner and source-link inventories, the `main` parity ledger, and the nine mandatory workflow steps all remain absent. **Phases 1 and 2 are both still pending.** Phase 1 is gated on the source-link inventory and baseline ledger owned by the canonical spec's Milestone C, which is deferred, and the validator consumes that inventory and needs a real knowledge-contract change to exercise.

### Review — 2026-08-03

- **Reviewer:** Agent, with independent cross-spec consistency audit.
- **Scope cohesion:** The fresh pass recommended separating workflow policy from its manifest/controller enforcement. The existing single governance boundary is retained because the controller is the mandatory executable enforcement of the nine-step policy, not an independently accepted outcome; splitting it would permit advisory-only completion.
- **Security:** Passed; example mappings, mirrors, and emitted copies fail closed on drift or fallback substitution.
- **Performance:** Passed; expensive fail-before execution remains limited to semantic knowledge-contract changes.
- **Cache:** N/A; this spec governs harness assets and evidence.
- **Commands:** N/A; no application command behavior changes.
- **Risks:** Passed; false classification, stale hashes/counts/docs, moved sources, mirror drift, and missing lanes have negative fixtures.
- **Verdict:** Approved for design review.
