# Standalone Harness Example and Linked-Source Read Policy

- **Status:** Draft
- **Date:** 2026-08-01
- **Revised:** 2026-08-03
- **Scope:** OSS standalone harness context/evaluator semantics for capability-scoped canonical-example and declared installed-source reads
- **Related:** [Standalone Canonical Example Module](./2026-07-31-standalone-canonical-example-module.md), [Standalone Harness Knowledge Governance](./2026-08-01-standalone-harness-knowledge-governance.md), [Standalone AI Development Harness](./2026-07-24-standalone-ai-development-harness.md)

## TLDR

Relevant harness cases must be able to read enough exact source files to solve a task, while unrelated traversal, mutation of canonical or installed sources, secrets, and context dumping remain forbidden. Add a machine-readable per-case `exampleRoots` contract plus exact `sourceReferenceIds` that bind visible links in emitted guides/skills/facts to the whole-harness source-link inventory. Canonical-module reads use the emitted `src/modules/example` tree; specialist and exact-host reads may follow declared files under the selected installed package's `node_modules/@open-mercato/*/src/**`. Undeclared fallback remains only for an inventory-classified specialist route or an installed-version contract mismatch, each with its own reason code. Evaluator allowances without visible owner links do not satisfy this policy.

## Problem Statement

The current evaluator's tight context allowlists can treat legitimate multi-file example reading as a violation, while its broad `node_modules/@open-mercato/*/src/**` warning glob is promoted into a read allowance for all 202 cases at the audit baseline. Neither extreme supplies a safe source-navigation contract. Current instructions contain no exact example link; generated facts render a directory-level source root and omit available exact provenance for several surfaces; and the tool accepts exact source files rather than those directory hints. The harness needs bounded reads that start from visible exact links and distinguish declared local/installed references from arbitrary source traversal. This policy is independently deployable from both the canonical example-module capability and the generic knowledge-change synchronization workflow.

## User-Directed Decision

The 2026-08-01 brief explicitly requires example reading to be allowed widely enough for agents to use precise reference implementations, and the 2026-08-03 clarification requires the harness itself to contain direct links to local examples and other installed modules. “Widely” means capability-complete within declared roots and exact declared installed files, not unrestricted repository access.

## Context Schema

Extend the case schema with:

```json
{
  "context": {
    "sourceReferenceIds": [
      "example.api.crud-factory",
      "ui.datatable.implementation"
    ],
    "exampleRoots": [{
      "root": "src/modules/example",
      "entrypoints": ["README.md", "references/surface-map.md"],
      "allowedCapabilityIds": ["api.crud-factory"],
      "maxFiles": 12,
      "maxBytes": 131072
    }],
    "installedVersionFallback": {
      "allowed": true,
      "reasonCodes": [
        "SPECIALIST_ROUTE_NOT_DECLARED",
        "INSTALLED_VERSION_CONTRACT_MISMATCH"
      ],
      "maxFiles": 4,
      "maxBytes": 65536
    }
  }
}
```

`sourceReferenceIds` resolve against emitted `.ai/harness/source-link-inventory.json`. Each ID identifies one visible link in an emitted owner, one exact regular target file, and `readStatus: "readable"`. Repository-only integration evidence and canonical-example rows derived as `readStatus: "qa-only"` remain validation evidence but are forbidden in case `sourceReferenceIds`. A canonical-example reference additionally names its capability ID and must agree with `surface-inventory.json`. An installed-package reference names the selected package, package-relative `src/**` file, package version/hash, and preset/tier applicability. The evaluator verifies that the case required/read the origin owner containing the link before following it, and charges the target against the case's normal file/byte budgets. Source-reference IDs do not grant a directory, glob, sibling file, transitive import, or QA evidence read.

Paths are case-root relative, normalized through realpath, and reject absolute paths, `..`, symlink escapes, generated caches, credentials, secrets, local ops files, and writable-target reads outside the existing case contract. The evaluator permits multiple exact files under a root up to both budgets. Reading starts from an entrypoint; subsequent reads must map to an `allowedCapabilityId` referenced by the prompt/plan. For the canonical root, IDs and exact files are validated against `src/modules/example/references/surface-inventory.json`; missing IDs, stale paths, entries with `referenceStatus: "qa-only"`, and files outside the mapped capability fail. Directory-wide reads, glob dumps, and unrelated capability files fail even below the byte budget.

An example root is read-only context. A case may not write, rename, delete, chmod, or replace anything under a declared root, even when a broader writable pattern such as `src/modules/**` would otherwise match. Root immutability is resolved before writable-pattern matching and cannot be overridden by case configuration.

A declared installed-package reference is first-class context and may be followed directly when the routed owner visibly links it; it is not fallback. Resolution follows `src/modules.ts`, the app lockfile, and Node resolution from the fresh scaffold, then requires the target to be a regular read-only file inside that selected package's published `src/**`. An optional-package link is valid only in presets/tiers that install it. Workspace symlinks, directory links, wrong-version duplicates, unpublished paths, and a path present only in the monorepo fail.

An undeclared installed-package fallback is allowed only after local entrypoint/declared-link inspection and only when the inventory classifies the requested capability as `specialist-route` and records `SPECIALIST_ROUTE_NOT_DECLARED`, or the trace records `INSTALLED_VERSION_CONTRACT_MISMATCH` for an exact mapped contract. A missing ordinary module surface is not a fallback reason: the canonical example spec must extend `example` and update its inventory. Fallback uses its own smaller budgets and retains the harness's package/version and sensitive-path restrictions. Cases without `exampleRoots` or `sourceReferenceIds` retain current non-installed behavior, but every existing case that used the universal installed-source glob must be audited and migrated to visible exact declared references or one of these two reason-gated fallback branches before the glob is removed.

The schema accepts only `src/modules/example` for canonical-module cases and rejects shadow or alias roots, duplicate roots, entries whose inventory path or hash does not match the emitted fixture, unknown/orphan source-reference IDs, and references whose visible owner link or packed target differs from the manifest.

## Ownership Boundary

- This spec owns the schema, exact-file path normalization, trace evaluator, budgets, declared-installed semantics, fallback semantics, broad-glob removal, and generic fixtures.
- A capability spec such as the canonical example owns only its case entries: exact root, entrypoints, capability/source-reference IDs, inventory mappings, visible owner links, and case-specific budgets/oracles.
- The knowledge-governance spec owns classification and synchronization when this schema/policy later changes; it does not define read semantics.

These are one-way relationships: capability cases consume this policy, and future policy changes are validated by governance. Neither companion is required to define the other's behavior.

The canonical capability acceptance must keep DataTable bulk actions and operation progress separately discoverable even when one end-to-end Todo flow connects them: each has its own visible source reference, case/source-selection assertion, structured oracle assertion, and self-contained integration-test assertion. A combined prompt without both reference IDs and both behavioral assertions is incomplete.

## Evaluator Oracles

Focused fixtures cover:

1. A relevant module case reads `src/modules/example/README.md`, its map, and several exact CRUD/data/UI files and passes.
2. The same case reads an unrelated capability under the allowed root and fails.
3. A case without the root attempts the same read and fails.
4. A routed owner contains a visible declared installed-source link, the case follows that exact packed-package file directly, and the trace records the reference ID/package/version/hash.
5. After local/declared inspection, one fixture records `SPECIALIST_ROUTE_NOT_DECLARED` for an inventory-classified specialist route and another records `INSTALLED_VERSION_CONTRACT_MISMATCH` for an exact mapped contract; each bounded fallback passes, while cross-use of the reasons fails.
6. An absent/dead/directory/wildcard/orphan declared link, fallback before local inspection, an unknown reason, broad traversal, budget overflow, symlink escape, generated cache, or sensitive path fails.
7. A writable case attempts to mutate the canonical example or installed package through a broad `src/modules/**` grant and fails before the write.
8. A legacy root, stale capability mapping, source with `referenceStatus: "qa-only"` or `readStatus: "qa-only"`, ordinary-surface fallback, wrong preset/tier, wrong installed version, unpublished path, or workspace-only target fails schema/evaluator validation.
9. Two capability assertions independently select the canonical DataTable bulk-action source and operation-progress source, then one writable/oracle lane proves their connected `progressJobId` lifecycle.

The result records ordered reads, matched root/capability, cumulative files/bytes, fallback reason, and the first violation. It never records file contents or secret values.

## Scope Boundaries

### In scope

- Case schema, evaluator implementation, trace result, canonical-root/source-link inventory validation, immutability precedence, and focused fixtures.
- Progressive multi-file example reads, direct exact declared installed-source reads, and bounded undeclared specialist-route/version-mismatch fallback.
- Backward-compatible non-installed behavior for cases without the new field, plus explicit migration of prior broad installed-source reliance.

### Out of scope

- Registering a particular canonical-example case.
- Updating harness-evolution workflow governance.
- Weakening writable roots, network controls, secrets, credential, or local-ops restrictions.

## Testing and Validation

- Schema tests reject malformed or legacy roots, missing entrypoints, unknown/stale/QA-only capability IDs, unknown/orphan or QA-only source-reference IDs, zero/negative budgets, unsafe paths, and fallback reasons outside the exact two-value enum.
- Evaluator tests cover the nine oracle families above on POSIX and path-normalization fixtures for Windows syntax.
- Security tests cover symlink escapes, encoded traversal, newline paths, generated caches, credentials, and output redaction.
- A generated `empty` fixture and each applicable preset/tier prove the emitted inventory resolves every visible local or installed link to an exact regular file from actual packed packages, not workspace symlinks, and that broad writable roots cannot mutate them.
- A whole-harness scanner compares rendered links with the inventory and rejects missing, undeclared, directory-only, wildcard, line-anchored, dead, unpublished, stale-hash, wrong-version, wrong-preset, and orphan records. It also proves generated facts render exact-file provenance for entities, events, ACL, DI, search, notifications, hosts, and contributions rather than clickable source roots.
- A checked migration audit enumerates every existing case whose prior warning/read allowlist included `node_modules/@open-mercato/*/src/**`, records whether the case actually relied on it, and replaces every reliance with an exact visible declared reference or an allowed reason-gated fallback before removal. Compatibility tests prove non-installed reads remain identical and migrated installed reads use only their new exact contract; unmigrated broad reads fail rather than warn/permit.
- Run focused create-app tests, affected harness lane, and configured validation gate.

## Implementation Plan

### Phase 1 — Add schema, source inventory, and safe path accounting

1. Add failing schema/path fixtures, then implement the fields, normalization, canonical/source-link inventory matching, `readStatus`, visible-owner ordering, source immutability precedence, and cumulative budgets.
2. Audit every existing case carrying the universal installed-source glob, replace actual reliance with exact case source references or an enumerated fallback reason, remove the glob, and make generated facts render exact-file source links only.
3. Make each fixture green before adding fallback behavior; preserve identical results for existing cases except removal of the accidental broad installed-source permission.

Exit criterion: declared multi-file roots work, unsafe/unrelated reads fail, every old glob-dependent case has a checked migration disposition, and existing non-installed evaluator behavior remains green.

### Phase 2 — Add ordered fallback and certify

1. Add failing ordered-trace fixtures for valid/invalid specialist-route and installed-version fallback, reason cross-use, and output redaction.
2. Implement reason-gated fallback and make every fixture green.
3. Run an affected certified lane with a synthetic example root and capture sanitized evidence.

Exit criterion: all nine oracle families, compatibility tests, security tests, packed fresh-scaffold proofs, and the affected lane are green.

## Backward Compatibility and Risks

The schema is additive, but installed-source permissions are intentionally tightened. Cases without new fields keep current non-installed semantics; cases that relied on the accidental universal installed-source permission must be explicitly migrated before that permission is removed. Main risks are over-broad roots, accidental mutation of shipped examples/packages, stale or workspace-only links, optional-package mismatch, inventory drift, incomplete legacy-case migration, and platform path differences; capability/reference IDs, dual budgets, visible-owner ordering, read-only precedence, packed-artifact resolution, the checked migration audit, realpath containment, negative fixtures, and Windows path tests bound them.

## Final Compliance Report

| Area | Result |
|---|---|
| Scope cohesion | One independent capability: safe, capability-scoped multi-file example reads. |
| User decision | Explicitly required by the 2026-08-01 brief. |
| Security | Realpath containment, sensitive-path denial, redacted results, and negative fixtures. |
| Canonical source | `src/modules/example` and declared installed files are inventory-backed, bounded, exact, and immutable; legacy shadow roots and broad installed globs are rejected. |
| Finite oracle | One schema and nine enumerated evaluator fixture families plus whole-harness packed-link validation. |
| Compatibility | Non-installed behavior stays identical; every prior broad installed-source reliance receives an explicit migration disposition and an exact declared reference or reason-gated fallback before permission removal. |

**Verdict: Fully specified and ready for implementation after design review.**

## Changelog

- 2026-08-01: Initial draft established bounded multi-file example reads and installed-version fallback.
- 2026-08-03: Pointed the policy at the shipped `src/modules/example` tree, added inventory validation and read-only precedence, restricted fallback to specialist/versioned gaps, rejected legacy shadow roots, added generated-empty fixtures, and made `referenceStatus: "qa-only"` a deterministic read denial.
- 2026-08-03: Added visible owner-bound source references, first-class exact installed-package links, packed-artifact resolution, generated-fact exact links, broad-glob removal, and whole-harness dead/orphan link enforcement.
- 2026-08-03: Added separate specialist/version-mismatch reason codes, readable-versus-QA evidence status, a complete legacy-glob migration audit, and distinct DataTable bulk-action/progress capability assertions.

### Review — 2026-08-03

- **Reviewer:** Agent, with independent cross-spec consistency audit.
- **Scope cohesion:** Passed by the independent fresh-context review; fallback is a subordinate branch of the same bounded-read evaluator policy.
- **Security:** Passed; canonical sources are immutable and unsafe traversal, QA-only files, and sensitive paths fail closed.
- **Performance:** Passed; per-case file and byte budgets remain mandatory.
- **Cache:** N/A; this spec changes harness context evaluation only.
- **Commands:** N/A; no application mutation contract changes.
- **Risks:** Passed; stale inventory, over-broad roots, mutation attempts, fallback abuse, and platform paths have negative fixtures.
- **Verdict:** Approved for design review.
