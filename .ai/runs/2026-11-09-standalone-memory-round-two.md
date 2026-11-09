# Additional standalone development memory reductions

## Goal
Find additional measured standalone memory reductions beyond generator-isolation PR #9052, without disabling modules or hiding memory in unmeasured processes.

## Scope
Investigate the remaining Turbopack graph, concurrent ORM initialization, and eagerly imported embedding-provider SDKs. Implement only source-backed candidates; qualify each independently with a packaged standalone navigation, mutation and repeated-edit scenario. Measure winners together with #9052. Keep rejected candidates unpublished. No public API, tenant scoping, encryption, production dependency, migration or worker-concurrency changes.

Source doc: .ai/specs/2026-05-27-dev-mode-memory-quick-wins.md

## Implementation Plan

### Phase 1: Establish evidence

Reuse preserved baseline package artifacts in a separate disposable standalone fixture. Reproduce the concurrent getOrm initialization path with real registered entities. Compare Turbopack memory eviction/GC using supported installed options, with no forced V8 collection or heap caps in whole-application runs. Source-read independent graph and runtime findings before editing.

### Phase 2: Implement and qualify

Coalesce concurrent ORM initialization without broadening instance lifetime across HMR. Evaluate provider-local embedding SDK imports on first actual use while preserving async operation, configuration invalidation and security validation. Measure promising changes alone and with generator isolation; retain the same workload and report memory, latency and failures separately.

### Phase 3: Deliver

For each demonstrated improvement, create an independently reviewable patch/PR, update existing documentation with measurements, run configured local validation, review contracts and record limitations. No remote push or PR before real standalone qualification, as requested by the user.

## Risks

Global ORM reuse across changing entity registrations is explicitly out of scope. Dynamic imports can introduce concurrent initialization or configuration races and may not reduce Turbopack graph memory. Aggressive cache eviction may trade lower residency for recompilation latency. Node/Next versions and process-tree accounting must match within each pair; package graph size alone is not memory evidence. The approximate 30% target remains unproven.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Establish evidence

- [ ] 1.1 Reproduce remaining consumers and restore the standalone measurement fixture.

### Phase 2: Implement and qualify

- [ ] 2.1 Implement and verify qualified runtime/import candidates.
- [ ] 2.2 Measure candidates independently and together with generator isolation.

### Phase 3: Deliver

- [ ] 3.1 Validate, document, review and publish only demonstrated improvements.
