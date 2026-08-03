# Standalone Harness Knowledge Governance

- **Status:** Draft
- **Date:** 2026-08-01
- **Revised:** 2026-08-03
- **Scope:** OSS standalone harness evolution/refresh workflows and evaluator synchronization
- **Related:** [Standalone Canonical Example Module](./2026-07-31-standalone-canonical-example-module.md), [Standalone Harness Example-Read Policy](./2026-08-01-standalone-harness-example-read-policy.md), [Standalone AI Development Harness](./2026-07-24-standalone-ai-development-harness.md), follow-up issue [#4670](https://github.com/open-mercato/open-mercato/issues/4670)

## TLDR

Changes to standalone agent knowledge, routing, discovery, canonical example code, source-link expectations, or read permissions can invalidate evaluator behavior even when case JSON still parses. Extend `om-evolve-harness` and repo-local `om-refresh-standalone-harness` so such changes always include fail-before/pass-after evaluator tests, synchronized case/oracle/release assets, generated copies, documentation, and an affected certified lane.

## Problem Statement

The harness skills already coordinate cases and release assets, but they do not make evaluator/read-policy updates an explicit mandatory consequence of knowledge-contract changes. A skill or `AGENTS.md` update can therefore permit new example reads, alter routing, or move canonical sources while tests continue enforcing the old context model. This governance rule is generic and independently deployable from the canonical example that exposed the gap.

## User-Directed Decision

The 2026-08-01 brief explicitly requires harness-development guidance to update evaluations whenever the harness knowledge/examples change and to allow relevant example reading more broadly. This is confirmed scope, not an autonomous default.

## Change Classification

The owning workflows classify a change as `knowledge-contract` when it changes any of:

- emitted `AGENTS.md` task routing or mandatory workflow;
- skill ownership, links, progressive-disclosure references, or tier emission;
- canonical example/source locations;
- any file mapped by a case `exampleRoots` entry or `src/modules/example/references/surface-inventory.json`;
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
  "changedContracts": ["routing | skill-link | example-source | discovery | context-read | evaluator | oracle"],
  "focusedTestFiles": ["exact path"],
  "authoritativeFiles": [{ "path": "exact path", "sha256": "64 hex" }],
  "generatedFiles": [{ "path": "exact path", "sha256": "64 hex", "sourcePath": "exact path" }],
  "expectedCatalogCount": 0,
  "requiredReleaseLanes": ["lane-id"],
  "documentationFiles": ["exact path"],
  "focusedExecutions": [{
    "testFile": "exact path",
    "command": ["argv", "without shell interpolation"],
    "baseWithTestPatch": { "exitCode": 1, "stdoutSha256": "64 hex", "stderrSha256": "64 hex" },
    "head": { "exitCode": 0, "stdoutSha256": "64 hex", "stderrSha256": "64 hex" }
  }]
}
```

`focusedExecutions`, resolved SHAs, exit codes, and output hashes are controller-owned output fields: authored input must omit them. The validator resolves `--base` and requires the authored `baseRef` to resolve to the same SHA, creates isolated temporary worktrees, applies only the focused-test diff to the base worktree, runs each argv command there, then runs it at HEAD. It writes the completed manifest/result atomically. Every knowledge-contract test must fail non-zero on base-plus-test-only and pass zero at HEAD; an absent test-only diff, unchanged failure, flaky retry, shell-interpolated command, SHA mismatch, or author-supplied evidence fails validation. `asset-sync` requires no fail-before execution only when the derived classifier proves authoritative semantics are byte-identical.

The validator derives the class from the diff rather than trusting `changeClass`. A change is `knowledge-contract` when the diff touches emitted/root agent instructions, authoritative skill/reference files, discovery/generator contracts, evaluator/oracle code, routing/context JSON pointers in `cases.json`, the canonical example inventory, or any exact example source mapped by an affected case. Moving, deleting, or semantically changing a linked file under `apps/mercato/src/modules/example/**`, its byte-identical template mirror, or its emitted runtime-source counterpart is `example-source`; unknown changes fail closed to `knowledge-contract`. `asset-sync` is valid only when all changed paths are generated/materialized copies or count/docs snapshots, every `sourcePath` authoritative SHA is unchanged from the base, and regenerated hashes match exactly. A declared class that differs from the derived class fails.

For `example-source`, the validator resolves mappings from the base and head inventories, requires hashes for the authoring file, template mirror, and emitted file when the scaffold copies it, and rejects stale/missing capability IDs, moved paths without an inventory update, a non-identical template mirror, or a generated copy that was not refreshed. Repository-only `__tests__` and `__integration__` entries may be evidence paths but are not falsely required in emitted fixtures. An ordinary module capability cannot be reclassified as an installed fallback merely to avoid extending the canonical example.

For `knowledge-contract`, the validator requires at least one changed focused test that demonstrates the affected contract and passes the controller-owned base/head execution above, verifies every affected case exists, derives the current catalog count from `cases.json`, checks validator/oracle membership required by each case mode, derives release lanes from `release-matrix.json`, resolves every documentation and example-inventory path, and compares every generated/template hash with its authoritative source. Missing cases, tests, executions, lanes, docs, example mappings, hashes, counts, or affected-range entries are hard failures. The manifest cannot waive a required surface; empty arrays are permitted only when the validator derives that the surface is inapplicable for every affected case mode.

## Mandatory Workflow for `knowledge-contract` Changes

Both `packages/create-app/agentic/shared/ai/skills/om-evolve-harness/SKILL.md` and repo-local `.ai/skills/om-refresh-standalone-harness/SKILL.md` must require:

1. Name the changed knowledge contract and affected case IDs/ranges.
2. Add a focused evaluator/oracle/read-policy test that fails for the old behavior; retain sanitized fail-before evidence.
3. Update the authoritative case/context policy and the evaluator implementation together.
4. Synchronize every mode-dependent surface: `cases.json`, validators, writable AST/runtime oracles, release matrix, focused tests, catalog counts, README/RELEASE/spec documentation, and emitted/generated copies.
5. Prove the focused test passes and run the affected certified lane.
6. Reject manual edits to derived copies and reject completion when any authoritative/generated hash or count is stale.
7. Generate and pass the machine validation manifest above; attach its sanitized result to the affected-lane evidence.

When the change adds a missing ordinary module surface, both workflows route it to the canonical `apps/mercato/src/modules/example/**` authoring tree, materialize the byte-identical create-app mirror through `yarn template:sync:fix`, update the surface inventory and exact case links, and run `yarn template:sync`. They must not create a second teaching module or satisfy the case only through installed-source fallback.

The skill provides a checklist and routes to the exact files; it does not paste evaluator implementations.

## Scope Boundaries

### In scope

- The two owning harness skills and their direct workflow references.
- Evaluator/read-policy tests and synchronization guards for knowledge-contract changes.
- Machine validation and affected-lane certification for knowledge-contract changes.
- Canonical-example source/link classification and monorepo/template/emitted hash synchronization.

### Out of scope

- Adding a particular canonical example capability or changing a particular feature policy.
- Defining generic example-read semantics, owned by the linked example-read-policy spec.
- Broad multi-runner certification tracked by #4670 beyond affected lanes.
- Weakening secret, credential, writable-root, or network protections.
- Requiring new behavior tests for byte-only asset synchronization.

## Testing and Validation

- Skill contract tests detect the derived `knowledge-contract`/`asset-sync` classification, including `example-source`, and all seven mandatory steps in both workflows.
- Fixture tests prove missing evaluator, stale generated copy, stale count/doc, or missing certified lane fails completion.
- Schema/validator fixtures prove a false declared class, incomplete arrays, bad hashes, bad catalog count, nonexistent case/range, and missing mode-required oracle all fail.
- One synthetic knowledge change demonstrates fail-before/pass-after and full synchronization without touching production cases.
- Example-source fixtures cover changed/moved/deleted linked files, stale capability mappings, non-identical template mirrors, correctly filtered repository-only tests, stale emitted copies, and forbidden fallback substitution.
- Run focused create-app tests, instruction/link budgets, affected harness lane, and the configured validation gate.

## Implementation Plan

### Phase 1 — Add enforceable workflow classification

1. Add failing schema/classifier/contract tests for `knowledge-contract` versus `asset-sync`, including `example-source`, the manifest fields, and the mandatory checklist.
2. Update both owning skills/references and make the tests green without duplicating implementation prose.
3. Add stale-asset/count/hash fixtures and green synchronization behavior.

Exit criterion: both workflows use the same machine-derived classification and cannot report a knowledge-contract change complete with missing surfaces or a passing validation manifest.

### Phase 2 — Certify machine-enforced synchronization

1. Add failing fixtures for false classification, missing base/head evidence, stale hashes/counts/docs/example mappings, moved/deleted linked files, mirror drift, missing cases/ranges/oracles, and absent release lanes.
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
| Canonical example | Linked `src/modules/example` changes are `example-source` knowledge contracts; exact authoring/template/emitted mappings must agree. |
| Finite oracle | Machine-derived classes, manifest schema, seven workflow steps, inventory hashes/counts, base/head execution evidence, and affected-lane evidence are deterministic. |
| Incremental delivery | Each phase pairs failing fixtures with implementation and exits green. |
| Runtime/compatibility | No generated-application runtime, API, schema, provider, or case-ID contract changes. |

### Verdict

**Fully specified and ready for implementation after design review.**

## Changelog

- 2026-08-01: Initial draft defined machine-enforced knowledge-contract versus asset-sync governance.
- 2026-08-03: Added `example-source` classification for inventory-linked canonical example code, exact authoring/template/emitted hash synchronization, missing-surface extension routing, and stale/moved/deleted source fixtures.

### Review — 2026-08-03

- **Reviewer:** Agent, with independent cross-spec consistency audit.
- **Scope cohesion:** The fresh pass recommended separating workflow policy from its manifest/controller enforcement. The existing single governance boundary is retained because the controller is the mandatory executable enforcement of the seven-step policy, not an independently accepted outcome; splitting it would permit advisory-only completion.
- **Security:** Passed; example mappings, mirrors, and emitted copies fail closed on drift or fallback substitution.
- **Performance:** Passed; expensive fail-before execution remains limited to semantic knowledge-contract changes.
- **Cache:** N/A; this spec governs harness assets and evidence.
- **Commands:** N/A; no application command behavior changes.
- **Risks:** Passed; false classification, stale hashes/counts/docs, moved sources, mirror drift, and missing lanes have negative fixtures.
- **Verdict:** Approved for design review.
