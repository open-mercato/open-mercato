# Attachment storage validation implementation

Goal: Implement #6690 with an opt-in fail-closed policy applying to all attachment factory resolutions and stable redacted failures.

Source doc: .ai/specs/2026-10-01-attachment-storage-validation.md (design PR #6819; materialized locally, merges separately)

Scope: attachment factory/policy, affected HTTP and CLI boundaries, provider-owned S3 validator, tests and compatibility docs. No owning-record authorization (#6726), root-path redesign, schema migration or production dependency.

Engine: om-auto-create-pr (steps: 4, --loop: no)

## Implementation Plan

Phase 1 establishes the public policy and factory boundary with tests. Phase 2 covers existing consumers, provider invariants and complete validation evidence.

## Risks

Opt-in strict deployments must register validators and repair legacy implicit configuration. Validate before destructive deletion and before credential enhancement; repeat generic and provider validation after enhancement. Review tooling requires schemas/renderer unavailable in the installed shared skill; independent evidence can be provided, but no formal automated approval is claimed.

## Progress

PR: #6820

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Policy and factory

- [x] 1.1 Add typed policy/validator/error contracts and enforce all factory resolutions. — 2826f7eea0; 7 baseline failures, 32 focused factory/policy assertions pass.

### Phase 2: Consumers and verification

- [x] 2.1 Register provider-owned validation and preserve compatible S3 configurations. — 58ad53083f; 19 targeted S3/DI assertions pass.
- [x] 2.2 Integrate HTTP/CLI failures and deletion ordering; add consumer and native API regressions. — 28b48c23ac; 132 focused core and 146 S3 assertions pass. Real strict HTTP exploration passed missing/unknown/blank drivers, array/scalar configurations, file/image/upload/deletion, metadata and byte preservation. TC-ATT-015 passed all four cases in strict mode and all four in legacy mode against separate managed native runtimes built from this exact commit. Fixtures were bound to the actual API partition/database and cleaned up. Both test runs passed on their first attempts.
- [x] 2.3 Publish public guidance and complete validation, independent inspection and handoff evidence. — 43326d619; public/upgrade guidance and the original local/native verification are complete. Human review 5643676587 confirmed the feature design, compatibility and coverage and requested the remediation below. The current repository review override uses GitHub checks first and no longer requires the old unavailable schema/renderer tooling. Current-head CI and independent re-review remain merge gates; no self-approval or QA approval is claimed.

### Phase 3: Current-main review remediation (2026-10-25)

- [x] 3.1 Merge current main and compose strict validation with reference-counted deletion. — 43326d619; main db279a693 is merged. Resolve the driver before `removeAttachmentRecord`; delete provider bytes only after successful removal with `releaseStorage`. Preserve CLI per-entry transactions and typed configuration-error rethrow. Reconcile the merged lessons catalog to 154 records.
- [x] 3.2 Cover the composed delete semantics and document independent callers. — 43326d619; focused routes/CLI/reference-removal tests pass 80/80. Negative controls fail both strict retention cases when resolution moves after removal, and both legacy/strict shared-reference cases when the release guard is removed. All 16 S3 suites pass 146 tests. The spec, upgrade notes and API guide distinguish process-wide factory validation from caller-level guarantees limited to attachments-owned routes, quota worker and CLI; independent warranty portal/documents/orchestrator work is tracked in #7941 as permitted by the reviewer.

Runner: local. Docker probes found no usable running app (daemon access denied for the dev profile; the full profile requires unavailable local configuration). Focused tests use read-only shared dependencies plus task-owned temporary dependency overlays; repository manifests and shared dependencies were not changed. Post-merge lessons checks pass 5/5, instruction-budget checks pass 8/8, and the narrow standalone harness catalog/context-budget check passes 1/1. `git diff --check` passes for this resume's edits; the merge imports two existing blank-line warnings from main.

The broader Windows attachment fallback reports 32 passing suites and five failures: six pre-existing absolute-path assertions in `localDriver.test.ts`/`storage.test.ts` expect rooted paths without a Windows drive; three UI suites cannot load missing transitive dependencies in the shared install. These are disclosed limitations, not a claim that the complete configured gate passed locally. Exact-head GitHub CI must validate the published merge. No database migration or UI smoke test was run in this resume; the existing strict/legacy native integration evidence above predates this merge.

TC-ATT-015 creates a private partition with a parameterized database fixture because production CI locks the partition-management API and malformed legacy JSON cannot be arranged through its validator. The native runner must supply DATABASE_URL; no developer-env fallback is accepted. All attachment uploads and behavior assertions use real HTTP, and each test restores configuration, deletes its file, and removes its partition. Default/legacy runs assert compatible reads; strict runs assert typed 503 failures before side effects, including primed image-cache reads. No external S3 service is required.
