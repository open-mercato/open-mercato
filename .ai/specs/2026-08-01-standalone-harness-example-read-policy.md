# Standalone Harness Example-Read Policy

- **Status:** Draft
- **Date:** 2026-08-01
- **Scope:** OSS standalone harness context/evaluator semantics for capability-scoped example reads
- **Related:** [Standalone Canonical Example Module](./2026-07-31-standalone-canonical-example-module.md), [Standalone Harness Knowledge Governance](./2026-08-01-standalone-harness-knowledge-governance.md), [Standalone AI Development Harness](./2026-07-24-standalone-ai-development-harness.md)

## TLDR

Relevant harness cases must be able to read enough exact example files to solve a task, while unrelated traversal, secrets, and context dumping remain forbidden. Add a machine-readable per-case `exampleRoots` contract with progressive entrypoints, file/byte budgets, and an explicit installed-version fallback. This spec exclusively owns generic read semantics; capability specs only register their roots and cases.

## Problem Statement

The current evaluator's tight context allowlists can treat legitimate multi-file example reading as a violation. Loosening all reads would hide inefficient exploration and weaken safety. The harness needs a generic, bounded policy that distinguishes a routed example from arbitrary source traversal. This policy is independently deployable from both a particular reference module and the generic knowledge-change synchronization workflow.

## User-Directed Decision

The 2026-08-01 brief explicitly requires example reading to be allowed widely enough for agents to use precise reference implementations. “Widely” means capability-complete within declared roots, not unrestricted repository access.

## Context Schema

Extend the case schema with:

```json
{
  "context": {
    "exampleRoots": [{
      "root": "src/modules/reference_module",
      "entrypoints": ["README.md", "references/surface-map.md"],
      "allowedCapabilityIds": ["api.crud-factory"],
      "maxFiles": 12,
      "maxBytes": 131072
    }],
    "installedVersionFallback": {
      "allowed": true,
      "reasonCodes": ["LOCAL_EXAMPLE_MISSING_VERSIONED_CONTRACT"],
      "maxFiles": 4,
      "maxBytes": 65536
    }
  }
}
```

Paths are case-root relative, normalized through realpath, and reject absolute paths, `..`, symlink escapes, generated caches, credentials, secrets, local ops files, and writable-target reads outside the existing case contract. The evaluator permits multiple exact files under a root up to both budgets. Reading starts from an entrypoint; subsequent reads must map to an `allowedCapabilityId` referenced by the prompt/plan. Directory-wide reads, glob dumps, and unrelated capability files fail even below the byte budget.

An installed-package fallback is allowed only after the ordered trace records an allowed reason code naming the missing local/versioned contract. It starts after local entrypoint inspection, uses its own smaller budgets, and retains the harness's package/version and sensitive-path restrictions. Cases without `exampleRoots` retain current behavior.

## Ownership Boundary

- This spec owns the schema, path normalization, trace evaluator, budgets, fallback semantics, and generic fixtures.
- A capability spec such as the canonical reference owns only its case entries: exact root, entrypoints, capability IDs, and case-specific budgets/oracles.
- The knowledge-governance spec owns classification and synchronization when this schema/policy later changes; it does not define read semantics.

These are one-way relationships: capability cases consume this policy, and future policy changes are validated by governance. Neither companion is required to define the other's behavior.

## Evaluator Oracles

Focused fixtures cover:

1. A relevant module case reads README/map plus several exact CRUD/data/UI files and passes.
2. The same case reads an unrelated capability under the allowed root and fails.
3. A case without the root attempts the same read and fails.
4. A named installed-version gap is recorded after local inspection and a bounded fallback passes.
5. Fallback before local inspection, an unknown reason, broad traversal, budget overflow, symlink escape, generated cache, or sensitive path fails.

The result records ordered reads, matched root/capability, cumulative files/bytes, fallback reason, and the first violation. It never records file contents or secret values.

## Scope Boundaries

### In scope

- Case schema, evaluator implementation, trace result, and focused fixtures.
- Progressive multi-file reads and bounded installed-version fallback.
- Backward-compatible behavior for cases without the new field.

### Out of scope

- Registering a particular reference module/case.
- Updating harness-evolution workflow governance.
- Weakening writable roots, network controls, secrets, credential, or local-ops restrictions.

## Testing and Validation

- Schema tests reject malformed roots, missing entrypoints, unknown capability IDs, zero/negative budgets, unsafe paths, and fallback reasons outside the enum.
- Evaluator tests cover the five oracle families above on POSIX and path-normalization fixtures for Windows syntax.
- Security tests cover symlink escapes, encoded traversal, newline paths, generated caches, credentials, and output redaction.
- Compatibility tests prove existing cases without `exampleRoots` evaluate identically.
- Run focused create-app tests, affected harness lane, and configured validation gate.

## Implementation Plan

### Phase 1 — Add schema and safe path accounting

1. Add failing schema/path fixtures, then implement the fields, normalization, root/capability matching, and cumulative budgets.
2. Make each fixture green before adding fallback behavior; preserve identical results for existing cases.

Exit criterion: declared multi-file roots work, unsafe/unrelated reads fail, and all existing evaluator tests remain green.

### Phase 2 — Add ordered fallback and certify

1. Add failing ordered-trace fixtures for valid/invalid installed-version fallback and output redaction.
2. Implement reason-gated fallback and make every fixture green.
3. Run an affected certified lane with a synthetic example root and capture sanitized evidence.

Exit criterion: all five oracle families, compatibility tests, security tests, and the affected lane are green.

## Backward Compatibility and Risks

The schema is additive and cases without it keep current semantics. Main risks are over-broad roots and platform path differences; capability IDs, dual budgets, realpath containment, negative fixtures, and Windows path tests bound them.

## Final Compliance Report

| Area | Result |
|---|---|
| Scope cohesion | One independent capability: safe, capability-scoped multi-file example reads. |
| User decision | Explicitly required by the 2026-08-01 brief. |
| Security | Realpath containment, sensitive-path denial, redacted results, and negative fixtures. |
| Finite oracle | One schema and five enumerated evaluator fixture families. |
| Compatibility | Existing cases retain byte-for-byte evaluator semantics. |

**Verdict: Fully specified and ready for implementation after design review.**
