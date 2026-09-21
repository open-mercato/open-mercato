# Workflow Mapping Prototype-Pollution Remediation

Source doc: `.ai/specs/2026-06-26-subworkflow-explicit-ports-schema-builder.md`

## Goal

Prevent workflow-authored input and output mappings from reaching inherited object properties or mutating process-wide prototypes while preserving valid mapping behavior.

## Scope

- Add one workflows-internal safe object-path primitive shared by sub-workflow, agent-result, and parallel-join mapping sinks.
- Reject mapping target paths containing `__proto__`, `constructor`, or `prototype` in the workflow definition schemas that own those mappings.
- Add focused regression tests proving malicious mappings neither validate nor pollute `Object.prototype` while normal nested mappings still work.

## Non-goals

- Do not freeze `Object.prototype` or change Node.js process flags; those global controls have broader compatibility and deployment consequences than this sink-local fix requires.
- Do not change workflow ACLs, API routes, persisted definition shapes, or valid mapping semantics.
- Do not redesign source-path lookup or the workflow editor.

## Implementation Plan

### Phase 1: Runtime containment

- Add a workflows-internal safe mapping-path helper that rejects prototype-bearing segments and traverses only own properties while creating nested targets.
- Route sub-workflow, agent-result, and parallel-join mapping writes through the shared guard.

### Phase 2: Authoring validation and regression coverage

- Apply the safe target-path rule to sub-workflow, parallel-join, and invoke-agent mapping schemas.
- Add regression tests for schema rejection, runtime containment, and valid nested mappings.

### Phase 3: Verification and review

- Run focused workflows tests and the repository validation gate, then complete the authoritative PR review/autofix pass.

## Risks

- Persisted workflow definitions containing prototype-bearing target segments will no longer validate or apply those entries. Those paths have no legitimate JSON-context meaning and retaining them would preserve the vulnerability.
- Mapping schemas are split between generic step config and typed activity config; tests must cover both entry points so the runtime guard remains the final defense for legacy persisted data.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Runtime containment

- [ ] 1.1 Add the safe mapping-path helper and route every reported write sink through it

### Phase 2: Authoring validation and regression coverage

- [ ] 2.1 Reject unsafe mapping targets in workflow schemas and add focused regression tests

### Phase 3: Verification and review

- [ ] 3.1 Run the configured validation gate and authoritative PR review
