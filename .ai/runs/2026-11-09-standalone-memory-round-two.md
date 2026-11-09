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

## Qualification results

The ORM race was reproduced against the packaged standalone app with 269 real
entities and eight simultaneous callers. Three fresh-process comparisons each
returned eight distinct ORMs before the fix and one afterward; all eight database
queries passed. Median physical footprint fell from 288.8 to 168.8 MiB in that
specific scenario. The ordinary UI/edit workload did not show an additional
whole-application saving, including when combined with generator-isolation
PR #9052. No additive percentage or 30% whole-app reduction is claimed.

Independent lazy embedding, Stripe and email SDK candidates, full Turbopack
eviction, input-source-map disabling and task GC did not demonstrate a convincing
post-edit physical-footprint saving. They remain outside this PR. Every candidate
completed six-page navigation, customer create/read/version-protected delete,
message compose, AI open/dock/close, ten verified structural revisions and a
post-edit customer-list check. Full measurements and scope are in the source doc.

The publication gate uses the local runner because no compose app service is
running. Node 24.22.2 is used for validation; all memory comparisons used
Node 24.13.1. The full configured gate and final code review are still pending.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Establish evidence

- [x] 1.1 Reproduce remaining consumers and restore the standalone measurement fixture. — 80004fd3ba; real-database and whole-app measurements recorded in the source doc.

### Phase 2: Implement and qualify

- [x] 2.1 Implement and verify qualified runtime/import candidates. — 80004fd3ba; only the proven ORM race fix is included.
- [x] 2.2 Measure candidates independently and together with generator isolation. — ten verified revisions per scenario; no additional whole-app saving claimed.

### Phase 3: Deliver

- [ ] 3.1 Validate, document, review and publish only demonstrated improvements.
