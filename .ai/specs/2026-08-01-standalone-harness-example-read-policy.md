# Standalone Harness Example-Read Policy

- **Status:** Draft
- **Date:** 2026-08-01
- **Revised:** 2026-08-03
- **Scope:** OSS standalone harness context/evaluator semantics for capability-scoped example reads
- **Related:** [Standalone Canonical Example Module](./2026-07-31-standalone-canonical-example-module.md), [Standalone Harness Knowledge Governance](./2026-08-01-standalone-harness-knowledge-governance.md), [Standalone AI Development Harness](./2026-07-24-standalone-ai-development-harness.md)

## TLDR

Relevant harness cases must be able to read enough exact example files to solve a task, while unrelated traversal, mutation of canonical sources, secrets, and context dumping remain forbidden. Add a machine-readable per-case `exampleRoots` contract with progressive entrypoints, file/byte budgets, and an explicit installed-version fallback. The canonical module root is the emitted `src/modules/example` tree; this spec exclusively owns generic read semantics while capability specs register their roots, capability inventory, and cases.

## Problem Statement

The current evaluator's tight context allowlists can treat legitimate multi-file example reading as a violation. Loosening all reads would hide inefficient exploration and weaken safety. The harness needs a generic, bounded policy that distinguishes the routed canonical example from arbitrary source traversal. This policy is independently deployable from both the canonical example-module capability and the generic knowledge-change synchronization workflow.

## User-Directed Decision

The 2026-08-01 brief explicitly requires example reading to be allowed widely enough for agents to use precise reference implementations. “Widely” means capability-complete within declared roots, not unrestricted repository access.

## Context Schema

Extend the case schema with:

```json
{
  "context": {
    "exampleRoots": [{
      "root": "src/modules/example",
      "entrypoints": ["README.md", "references/surface-map.md"],
      "allowedCapabilityIds": ["api.crud-factory"],
      "maxFiles": 12,
      "maxBytes": 131072
    }],
    "installedVersionFallback": {
      "allowed": true,
      "reasonCodes": ["INSTALLED_VERSION_CONTRACT_MISMATCH"],
      "maxFiles": 4,
      "maxBytes": 65536
    }
  }
}
```

Paths are case-root relative, normalized through realpath, and reject absolute paths, `..`, symlink escapes, generated caches, credentials, secrets, local ops files, and writable-target reads outside the existing case contract. The evaluator permits multiple exact files under a root up to both budgets. Reading starts from an entrypoint; subsequent reads must map to an `allowedCapabilityId` referenced by the prompt/plan. For the canonical root, IDs and exact files are validated against `src/modules/example/references/surface-inventory.json`; missing IDs, stale paths, `qa-only` entries, and files outside the mapped capability fail. Directory-wide reads, glob dumps, and unrelated capability files fail even below the byte budget.

An example root is read-only context. A case may not write, rename, delete, chmod, or replace anything under a declared root, even when a broader writable pattern such as `src/modules/**` would otherwise match. Root immutability is resolved before writable-pattern matching and cannot be overridden by case configuration.

An installed-package fallback is allowed only after local entrypoint inspection and only when the inventory classifies the requested capability as `specialist-route`, or the trace records an allowed installed-version mismatch for an exact mapped contract. A missing ordinary module surface is not a fallback reason: the canonical example spec must extend `example` and update its inventory. Fallback uses its own smaller budgets and retains the harness's package/version and sensitive-path restrictions. Cases without `exampleRoots` retain current behavior.

The schema accepts only `src/modules/example` for canonical-module cases and rejects shadow or alias roots, duplicate roots, and entries whose inventory path or hash does not match the emitted fixture.

## Ownership Boundary

- This spec owns the schema, path normalization, trace evaluator, budgets, fallback semantics, and generic fixtures.
- A capability spec such as the canonical example owns only its case entries: exact root, entrypoints, capability IDs, inventory mappings, and case-specific budgets/oracles.
- The knowledge-governance spec owns classification and synchronization when this schema/policy later changes; it does not define read semantics.

These are one-way relationships: capability cases consume this policy, and future policy changes are validated by governance. Neither companion is required to define the other's behavior.

## Evaluator Oracles

Focused fixtures cover:

1. A relevant module case reads `src/modules/example/README.md`, its map, and several exact CRUD/data/UI files and passes.
2. The same case reads an unrelated capability under the allowed root and fails.
3. A case without the root attempts the same read and fails.
4. A named installed-version gap is recorded after local inspection and a bounded fallback passes.
5. Fallback before local inspection, an unknown reason, broad traversal, budget overflow, symlink escape, generated cache, or sensitive path fails.
6. A writable case attempts to mutate the canonical example through a broad `src/modules/**` grant and fails before the write.
7. A legacy root, stale capability mapping, `qa-only` source, or ordinary-surface fallback fails schema/evaluator validation.

The result records ordered reads, matched root/capability, cumulative files/bytes, fallback reason, and the first violation. It never records file contents or secret values.

## Scope Boundaries

### In scope

- Case schema, evaluator implementation, trace result, canonical-root inventory validation, immutability precedence, and focused fixtures.
- Progressive multi-file reads and bounded installed-version fallback.
- Backward-compatible behavior for cases without the new field.

### Out of scope

- Registering a particular canonical-example case.
- Updating harness-evolution workflow governance.
- Weakening writable roots, network controls, secrets, credential, or local-ops restrictions.

## Testing and Validation

- Schema tests reject malformed or legacy roots, missing entrypoints, unknown/stale/QA-only capability IDs, zero/negative budgets, unsafe paths, and fallback reasons outside the enum.
- Evaluator tests cover the seven oracle families above on POSIX and path-normalization fixtures for Windows syntax.
- Security tests cover symlink escapes, encoded traversal, newline paths, generated caches, credentials, and output redaction.
- A generated `empty` fixture proves the emitted inventory resolves to exact canonical example files and that broad writable roots cannot mutate them.
- Compatibility tests prove existing cases without `exampleRoots` evaluate identically.
- Run focused create-app tests, affected harness lane, and configured validation gate.

## Implementation Plan

### Phase 1 — Add schema and safe path accounting

1. Add failing schema/path fixtures, then implement the fields, normalization, inventory-backed root/capability matching, root immutability precedence, and cumulative budgets.
2. Make each fixture green before adding fallback behavior; preserve identical results for existing cases.

Exit criterion: declared multi-file roots work, unsafe/unrelated reads fail, and all existing evaluator tests remain green.

### Phase 2 — Add ordered fallback and certify

1. Add failing ordered-trace fixtures for valid/invalid installed-version fallback and output redaction.
2. Implement reason-gated fallback and make every fixture green.
3. Run an affected certified lane with a synthetic example root and capture sanitized evidence.

Exit criterion: all seven oracle families, compatibility tests, security tests, generated-empty proof, and the affected lane are green.

## Backward Compatibility and Risks

The schema is additive and cases without it keep current semantics. Main risks are over-broad roots, accidental mutation of shipped examples, stale inventory mappings, and platform path differences; capability IDs, dual budgets, read-only precedence, realpath containment, negative fixtures, and Windows path tests bound them.

## Final Compliance Report

| Area | Result |
|---|---|
| Scope cohesion | One independent capability: safe, capability-scoped multi-file example reads. |
| User decision | Explicitly required by the 2026-08-01 brief. |
| Security | Realpath containment, sensitive-path denial, redacted results, and negative fixtures. |
| Canonical source | `src/modules/example` is inventory-backed, bounded, and immutable; legacy shadow roots are rejected. |
| Finite oracle | One schema and seven enumerated evaluator fixture families. |
| Compatibility | Existing cases retain byte-for-byte evaluator semantics. |

**Verdict: Fully specified and ready for implementation after design review.**

## Changelog

- 2026-08-01: Initial draft established bounded multi-file example reads and installed-version fallback.
- 2026-08-03: Pointed the policy at the shipped `src/modules/example` tree, added inventory validation and read-only precedence, restricted fallback to specialist/versioned gaps, rejected legacy shadow roots, and added generated-empty fixtures.

### Review — 2026-08-03

- **Reviewer:** Agent, with independent cross-spec consistency audit.
- **Scope cohesion:** Passed by the independent fresh-context review; fallback is a subordinate branch of the same bounded-read evaluator policy.
- **Security:** Passed; canonical sources are immutable and unsafe traversal, QA-only files, and sensitive paths fail closed.
- **Performance:** Passed; per-case file and byte budgets remain mandatory.
- **Cache:** N/A; this spec changes harness context evaluation only.
- **Commands:** N/A; no application mutation contract changes.
- **Risks:** Passed; stale inventory, over-broad roots, mutation attempts, fallback abuse, and platform paths have negative fixtures.
- **Verdict:** Approved for design review.
