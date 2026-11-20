# Workflow Mapping Prototype-Pollution Remediation

Source doc: `.ai/specs/2026-06-26-subworkflow-explicit-ports-schema-builder.md`

## Goal

Prevent workflow-authored input and output mappings from reaching inherited object properties or mutating process-wide prototypes while preserving valid mapping behavior.

## Scope

- Add one workflows-internal safe object-path primitive shared by sub-workflow, agent-result, and parallel-join mapping sinks.
- Reject mapping target paths containing `__proto__`, `constructor`, or `prototype` at first-party workflow authoring boundaries while preserving the exported validator contracts used by third-party modules.
- Add focused regression tests proving malicious mappings neither validate nor pollute `Object.prototype` while normal nested mappings still work.

## Non-goals

- Do not freeze `Object.prototype` or change Node.js process flags; those global controls have broader compatibility and deployment consequences than this sink-local fix requires.
- Do not change workflow ACLs, persisted definition shapes, exported validator behavior, or valid mapping semantics.
- Do not redesign source-path lookup or the workflow editor.

## Implementation Plan

### Phase 1: Runtime containment

- Add a workflows-internal safe mapping-path helper that rejects prototype-bearing segments and traverses only own properties while creating nested targets.
- Route sub-workflow, agent-result, and parallel-join mapping writes through the shared guard.

### Phase 2: Authoring validation and regression coverage

- Apply the safe target-path rule to sub-workflow, parallel-join, and invoke-agent mappings in the create/update API and the shared Studio/AI definition evaluator.
- Add regression tests for schema rejection, runtime containment, and valid nested mappings.

### Phase 3: Verification and review

- Run focused workflows tests and the repository validation gate, then complete the authoritative PR review/autofix pass.

## Risks

- First-party authoring rejects new prototype-bearing target segments, while exported validators continue to parse legacy and third-party definitions. Runtime guards remain the final defense for persisted data.
- Mapping configuration is split between generic step config and typed activities; tests must cover both entry points and the real execution boundary.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Runtime containment

- [x] 1.1 Add the safe mapping-path helper and route every reported write sink through it — 1dcfffc3f1

### Phase 2: Authoring validation and regression coverage

- [x] 2.1 Reject unsafe mapping targets in workflow schemas and add focused regression tests — 6efe18356b

### Phase 3: Verification and review

- [ ] 3.1 Run the configured validation gate and authoritative PR review
