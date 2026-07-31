# Business-Prompt Complete Module Harness — Execution Plan

Source doc: .ai/specs/2026-07-24-standalone-ai-development-harness.md

## Goal

Add OMH-193 as a business-language counterpart to OMH-185 that must produce the same complete searchable, extensible, localized library module—including canonical `DataTable` and `CrudForm` CRUD surfaces—without naming those technical choices in the user prompt.

## Scope

- Preserve OMH-185 and every existing case contract while adding one contiguous case ID.
- Reuse OMH-185's required routing, decisions, context, fixture, oracle, allowed writes, and timeout so the contrast measures prompt abstraction rather than a weaker outcome.
- Synchronize catalog counts, writable/review/release assignments, fixture ownership, focused contract tests, harness documentation, and the existing harness spec.
- Run the new case before changing its knowledge owner, retain only sanitized failure evidence, and tune the smallest owner only when the focused result proves a gap.
- Iterate the focused OMH-193 live writable evaluation and its generated target checks until it passes, plus targeted OMH-185 compatibility and catalog/unit checks.

## Non-goals

- Do not rewrite or weaken OMH-185, its oracle, or any existing evaluation.
- Do not add prompt-level `CrudForm`, `DataTable`, route-path, file-path, command, locking, encryption, search, UMES, migration, or test implementation instructions to OMH-193.
- Do not change runtime framework contracts, product UI, database schema, or generated application files.
- Per the task brief, do not run the repository's full validation command list or the complete all-case release suite; report the focused evidence and this deliberate validation boundary on the PR.
- Do not absorb the still-open PR #4757 diff; this follow-up remains merge-order compatible and references its additive OMH-185 oracle strengthening.

## Risks

- A second complete-module case can drift from OMH-185; shared fixtures/oracles, explicit parity tests, and OMH-193's one-way related-case link mitigate that risk without mutating OMH-185.
- Business wording may under-route UI or extension guidance; failure-first evidence determines whether the shared business blueprint needs the smallest durable clarification.
- Adding a writable release case raises catalog and release counts; every registry and documented total must stay synchronized without changing existing IDs.
- The focused live generation is model-dependent and can exhaust its case timeout; availability or timeout failures must remain failures rather than being converted into passes.

## Implementation Plan

### Phase 1: Contrastive case and failure-first evidence

- Add OMH-193 with a business-only library brief and exact OMH-185 outcome-contract parity.
- Synchronize catalog metadata, fixture/oracle/release registries, focused contract tests, documentation, and the harness spec.
- Run the schema-valid focused case before any owner change and record sanitized failure evidence.

### Phase 2: Smallest-owner optimization

- Classify focused failures against semantic decisions and update only the complete-module business blueprint when the evidence shows missing inference.
- Add regression assertions that preserve business-language abstraction and OMH-185 compatibility.

### Phase 3: Focused proof and delivery

- Iterate OMH-193's live writable evaluation, generated target commands/tests, and generated-code review until the fixed oracle passes.
- Run targeted catalog, OMH-185 compatibility, mandatory safety, and create-app harness unit checks without expanding to the full repository gate.
- Complete the authoritative PR review/autofix pass and publish the final focused verification evidence.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Contrastive case and failure-first evidence

- [x] 1.1 Add OMH-193 with a business-only library brief and exact OMH-185 outcome-contract parity — 33804a48f5
- [x] 1.2 Synchronize catalog metadata, fixture/oracle/release registries, focused contract tests, documentation, and the harness spec — 33804a48f5
- [x] 1.3 Run the schema-valid focused case before any owner change and record sanitized failure evidence — 2bace46392

### Phase 2: Smallest-owner optimization

- [ ] 2.1 Classify focused failures and update only the complete-module business blueprint when evidence requires it
- [ ] 2.2 Add regression assertions for business-language abstraction and OMH-185 compatibility

### Phase 3: Focused proof and delivery

- [ ] 3.1 Iterate OMH-193 live writable evaluation, target checks/tests, and generated-code review to a pass
- [ ] 3.2 Run targeted catalog, OMH-185 compatibility, mandatory safety, and create-app harness unit checks
- [ ] 3.3 Complete authoritative PR review/autofix and publish focused verification evidence
