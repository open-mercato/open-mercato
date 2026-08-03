# Standalone Harness Knowledge Governance

- **Status:** Draft
- **Date:** 2026-08-01
- **Revised:** 2026-08-03
- **Scope:** OSS standalone harness evolution/refresh workflows and evaluator synchronization
- **Related:** [Standalone Canonical Example Module](./2026-07-31-standalone-canonical-example-module.md), [Standalone Harness Example and Linked-Source Read Policy](./2026-08-01-standalone-harness-example-read-policy.md), [Standalone AI Development Harness](./2026-07-24-standalone-ai-development-harness.md), follow-up issue [#4670](https://github.com/open-mercato/open-mercato/issues/4670)

## TLDR

Changes to standalone agent knowledge, routing, discovery, canonical example code, visible source links, installed-package versions, or read permissions can invalidate evaluator behavior even when case JSON still parses. Extend `om-evolve-harness` and repo-local `om-refresh-standalone-harness` so such changes always include a complete emitted-owner/source-link audit, fail-before/pass-after evaluator tests, synchronized case/oracle/release assets, packed-target validation, generated copies, documentation, and an affected certified lane. Updating evaluator allowances without adding or repairing the owning visible links is incomplete.

## Problem Statement

The harness skills already coordinate cases and release assets, but they do not make evaluator/read-policy and visible-source-link updates an explicit mandatory consequence of knowledge-contract changes. A skill or `AGENTS.md` update can therefore permit new example reads, alter routing, remove executable examples, render a directory-only fact link, or move canonical/installed sources while tests continue enforcing the old context model. The current gap demonstrates why permissions alone are insufficient: the emitted implementation guides contain no direct example link, generated facts omit several exact source links, and cases broadly admit installed source without binding it to a routed owner. This governance rule is generic and independently deployable from the canonical example that exposed the gap.

## User-Directed Decision

The 2026-08-01 brief explicitly requires harness-development guidance to update evaluations whenever the harness knowledge/examples change and to allow relevant example reading more broadly. The 2026-08-03 clarification also requires the harness itself to preserve example coverage through direct links to the canonical example and installed package modules. These are confirmed requirements, not autonomous defaults.

## Change Classification

The owning workflows classify a change as `knowledge-contract` when it changes any of:

- emitted `AGENTS.md` task routing or mandatory workflow;
- skill ownership, links, progressive-disclosure references, or tier emission;
- canonical example/source locations;
- visible exact-file source links, their owner/topic classification, the source-link inventory, or the prior-example parity ledger;
- installed package/version/preset applicability for a declared source target;
- any file mapped by a case `exampleRoots` entry or `src/modules/example/references/surface-inventory.json`;
- generated fact provenance or rendering of exact source files;
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

The validator derives the class from the diff rather than trusting `changeClass`. A change is `knowledge-contract` when the diff touches emitted/root agent instructions, authoritative skill/reference files, the source-link inventory/parity ledger, discovery/generator contracts, evaluator/oracle code, routing/context JSON pointers in `cases.json`, the canonical example inventory, generated fact provenance/rendering, or any exact source mapped by an affected case. Moving, deleting, or semantically changing a linked file under `apps/mercato/src/modules/example/**`, its byte-identical template mirror, or its emitted runtime-source counterpart is `example-source`. Changing a linked package, package-relative target, version, export/publish set, preset applicability, or resolved packed hash is `installed-source`. Unknown changes fail closed to `knowledge-contract`. `asset-sync` is valid only when all changed paths are generated/materialized copies or count/docs snapshots, every `sourcePath` authoritative SHA is unchanged from the base, and regenerated hashes match exactly. A declared class that differs from the derived class fails.

For `example-source`, the validator resolves mappings from the base and head inventories, requires hashes for the authoring file, template mirror, and emitted file when the scaffold copies it, and rejects stale/missing capability IDs, moved paths without an inventory update, a non-identical template mirror, or a generated copy that was not refreshed. Repository-only `__tests__` and `__integration__` entries may be QA evidence paths but are not falsely required in emitted fixtures and are derived as `readStatus: "qa-only"`; cases may reference only `readStatus: "readable"` source records. Every added or materially changed runtime/discovery extension surface must name at least one self-contained module integration test and its dependency modules, even when the surface is added to an existing capability row; missing test paths, seeded-data reliance, or static/unit-only proof fails. An ordinary module capability cannot be reclassified as an installed fallback merely to avoid extending the canonical example.

For `source-link` and `installed-source`, the controller derives `source-link-inventory.json` from the complete emitted-owner scan plus canonical/packed-source inventories; it is never separately authored. The validator compares rendered Markdown links exactly with that derived output. Every `source-required` topic must have a visible link in its declared owner; every rendered source link must have one manifest record; every fence in the canonical spec's exact eight-asset pinned-`main` baseline must validate against `source-link-baseline.schema.json` and have one checked disposition. The validator verifies the eight full-file hashes, per-asset CommonMark fence counts, and 136 total dispositions before resolving topic mappings. It generates each applicable preset/tier from a coherent package build, installs actual packed/Verdaccio artifacts, resolves each link relative to its emitted owner, and requires an exact regular file with the recorded package/version/hash. It rejects code-span-only paths, directories, roots, wildcards, line anchors, undeclared/orphan links, symlink escapes, unpublished/workspace-only files, missing optional packages, wrong-version duplicates, stale generated facts, QA-only case references, and manual manifests that claim a link the owner does not render. Package `src/**` is preferred and required while it is published; `dist` may be used only after the read tool/evaluator explicitly supports exact compiled files and records degraded provenance.

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

### Out of scope

- Adding a particular canonical example capability or changing a particular feature policy.
- Defining generic example-read semantics, owned by the linked example-read-policy spec.
- Broad multi-runner certification tracked by #4670 beyond affected lanes.
- Weakening secret, credential, writable-root, or network protections.
- Requiring new behavior tests for byte-only asset synchronization.

## Testing and Validation

- Skill contract tests detect the derived `knowledge-contract`/`asset-sync` classification, including `source-link`, `example-source`, and `installed-source`, and all nine mandatory steps in both workflows.
- Fixture tests prove missing evaluator, stale generated copy, stale count/doc, or missing certified lane fails completion.
- Schema/validator fixtures prove a false declared class, incomplete arrays, bad hashes, bad catalog count, nonexistent case/range, and missing mode-required oracle all fail.
- One synthetic knowledge change demonstrates fail-before/pass-after and full synchronization without touching production cases.
- Example-source fixtures cover changed/moved/deleted linked files, stale capability mappings, non-identical template mirrors, correctly filtered repository-only tests, stale emitted copies, and forbidden fallback substitution.
- Whole-harness fixtures cover a missing visible link, manifest-only record, undeclared rendered link, directory/wildcard/line-anchor link, orphan baseline topic, missing generated-fact source, wrong preset/version, unpublished/workspace-only target, symlink escape, and stale packed hash.
- Extension fixtures reject any added or materially changed example runtime/discovery surface without a declared module-local integration test/dependency list, including a new surface placed inside an existing row, and prove each declared test runs self-contained from an activated fresh scaffold.
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
- 2026-08-03: Made the source-link inventory explicitly controller-derived, added baseline-schema validation and readable-versus-QA evidence status, and closed the integration-test evasion path for surfaces added to existing capability rows.
- 2026-08-03: Bound baseline validation to eight exact pinned assets, their full-file hashes, per-asset CommonMark fence counts, and 136 mandatory dispositions.

### Review — 2026-08-03

- **Reviewer:** Agent, with independent cross-spec consistency audit.
- **Scope cohesion:** The fresh pass recommended separating workflow policy from its manifest/controller enforcement. The existing single governance boundary is retained because the controller is the mandatory executable enforcement of the nine-step policy, not an independently accepted outcome; splitting it would permit advisory-only completion.
- **Security:** Passed; example mappings, mirrors, and emitted copies fail closed on drift or fallback substitution.
- **Performance:** Passed; expensive fail-before execution remains limited to semantic knowledge-contract changes.
- **Cache:** N/A; this spec governs harness assets and evidence.
- **Commands:** N/A; no application command behavior changes.
- **Risks:** Passed; false classification, stale hashes/counts/docs, moved sources, mirror drift, and missing lanes have negative fixtures.
- **Verdict:** Approved for design review.
