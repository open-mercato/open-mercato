# Standalone Harness Knowledge Governance

- **Status:** Draft
- **Date:** 2026-08-01
- **Scope:** OSS standalone harness evolution/refresh workflows and evaluator synchronization
- **Related:** [Standalone Canonical Example Module](./2026-07-31-standalone-canonical-example-module.md), [Standalone Harness Example-Read Policy](./2026-08-01-standalone-harness-example-read-policy.md), [Standalone AI Development Harness](./2026-07-24-standalone-ai-development-harness.md), follow-up issue [#4670](https://github.com/open-mercato/open-mercato/issues/4670)

## TLDR

Changes to standalone agent knowledge, routing, discovery, source-link expectations, or read permissions can invalidate evaluator behavior even when case JSON still parses. Extend `om-evolve-harness` and repo-local `om-refresh-standalone-harness` so such changes always include fail-before/pass-after evaluator tests, synchronized case/oracle/release assets, generated copies, documentation, and an affected certified lane.

## Problem Statement

The harness skills already coordinate cases and release assets, but they do not make evaluator/read-policy updates an explicit mandatory consequence of knowledge-contract changes. A skill or `AGENTS.md` update can therefore permit new example reads, alter routing, or move canonical sources while tests continue enforcing the old context model. This governance rule is generic and independently deployable from the reference module that exposed the gap.

## User-Directed Decision

The 2026-08-01 brief explicitly requires harness-development guidance to update evaluations whenever the harness knowledge/examples change and to allow relevant example reading more broadly. This is confirmed scope, not an autonomous default.

## Change Classification

The owning workflows classify a change as `knowledge-contract` when it changes any of:

- emitted `AGENTS.md` task routing or mandatory workflow;
- skill ownership, links, progressive-disclosure references, or tier emission;
- canonical example/source locations;
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
  "changedContracts": ["routing | skill-link | discovery | context-read | evaluator | oracle"],
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

The validator derives the class from the diff rather than trusting `changeClass`. A change is `knowledge-contract` when the diff touches emitted/root agent instructions, authoritative skill/reference files, discovery/generator contracts, evaluator/oracle code, or routing/context JSON pointers in `cases.json`; unknown changes fail closed to this class. `asset-sync` is valid only when all changed paths are generated/materialized copies or count/docs snapshots, every `sourcePath` authoritative SHA is unchanged from the base, and regenerated hashes match exactly. A declared class that differs from the derived class fails.

For `knowledge-contract`, the validator requires at least one changed focused test that demonstrates the affected contract and passes the controller-owned base/head execution above, verifies every affected case exists, derives the current catalog count from `cases.json`, checks validator/oracle membership required by each case mode, derives release lanes from `release-matrix.json`, resolves every documentation path, and compares every generated hash with its authoritative source. Missing cases, tests, executions, lanes, docs, hashes, counts, or affected-range entries are hard failures. The manifest cannot waive a required surface; empty arrays are permitted only when the validator derives that the surface is inapplicable for every affected case mode.

## Mandatory Workflow for `knowledge-contract` Changes

Both `packages/create-app/agentic/shared/ai/skills/om-evolve-harness/SKILL.md` and repo-local `.ai/skills/om-refresh-standalone-harness/SKILL.md` must require:

1. Name the changed knowledge contract and affected case IDs/ranges.
2. Add a focused evaluator/oracle/read-policy test that fails for the old behavior; retain sanitized fail-before evidence.
3. Update the authoritative case/context policy and the evaluator implementation together.
4. Synchronize every mode-dependent surface: `cases.json`, validators, writable AST/runtime oracles, release matrix, focused tests, catalog counts, README/RELEASE/spec documentation, and emitted/generated copies.
5. Prove the focused test passes and run the affected certified lane.
6. Reject manual edits to derived copies and reject completion when any authoritative/generated hash or count is stale.
7. Generate and pass the machine validation manifest above; attach its sanitized result to the affected-lane evidence.

The skill provides a checklist and routes to the exact files; it does not paste evaluator implementations.

## Scope Boundaries

### In scope

- The two owning harness skills and their direct workflow references.
- Evaluator/read-policy tests and synchronization guards for knowledge-contract changes.
- Machine validation and affected-lane certification for knowledge-contract changes.

### Out of scope

- Adding a particular reference module or changing a particular feature policy.
- Defining generic example-read semantics, owned by the linked example-read-policy spec.
- Broad multi-runner certification tracked by #4670 beyond affected lanes.
- Weakening secret, credential, writable-root, or network protections.
- Requiring new behavior tests for byte-only asset synchronization.

## Testing and Validation

- Skill contract tests detect the derived `knowledge-contract`/`asset-sync` classification and all seven mandatory steps in both workflows.
- Fixture tests prove missing evaluator, stale generated copy, stale count/doc, or missing certified lane fails completion.
- Schema/validator fixtures prove a false declared class, incomplete arrays, bad hashes, bad catalog count, nonexistent case/range, and missing mode-required oracle all fail.
- One synthetic knowledge change demonstrates fail-before/pass-after and full synchronization without touching production cases.
- Run focused create-app tests, instruction/link budgets, affected harness lane, and the configured validation gate.

## Implementation Plan

### Phase 1 — Add enforceable workflow classification

1. Add failing schema/classifier/contract tests for `knowledge-contract` versus `asset-sync`, the manifest fields, and the mandatory checklist.
2. Update both owning skills/references and make the tests green without duplicating implementation prose.
3. Add stale-asset/count/hash fixtures and green synchronization behavior.

Exit criterion: both workflows use the same machine-derived classification and cannot report a knowledge-contract change complete with missing surfaces or a passing validation manifest.

### Phase 2 — Certify machine-enforced synchronization

1. Add failing fixtures for false classification, missing base/head evidence, stale hashes/counts/docs, missing cases/ranges/oracles, and absent release lanes.
2. Implement the validator/controller evidence contract and make each fixture green before proceeding.
3. Run a synthetic end-to-end knowledge-contract change through the affected lane and refresh authoritative/generated assets through the owning workflow.

Exit criterion: workflow guidance, machine manifest, assets, docs, base/head evidence, and certified lane agree, with all focused and configured gates green.

## Backward Compatibility

The change strengthens internal harness procedure and evaluator policy. It does not change generated application runtime, public APIs, schema, or provider behavior. Existing case IDs remain stable; semantic deduplication and additive evolution rules still apply.

## Risks

| Risk | Mitigation |
|---|---|
| Every refresh becomes expensive | Classify byte-only `asset-sync` separately; require new behavior proof only for knowledge contracts. |
| Skills and evaluator drift | Identical contract tests for both owning workflows and synchronized generated hashes/counts. |
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
| Finite oracle | Machine-derived classes, manifest schema, seven workflow steps, hashes/counts, base/head execution evidence, and affected-lane evidence are deterministic. |
| Incremental delivery | Each phase pairs failing fixtures with implementation and exits green. |
| Runtime/compatibility | No generated-application runtime, API, schema, provider, or case-ID contract changes. |

### Verdict

**Fully specified and ready for implementation after design review.**
