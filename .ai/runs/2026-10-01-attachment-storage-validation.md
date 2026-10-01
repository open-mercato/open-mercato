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
- [ ] 2.2 Integrate HTTP/CLI failures and deletion ordering; add consumer and native API regressions. — HTTP/CLI/worker/helper regressions implemented; 132 focused core and 146 S3 assertions pass. Real strict HTTP exploration passed on 68ec152ccd (missing/unknown/blank drivers, array/scalar configurations, file/image/upload/deletion, metadata and byte preservation). TC-ATT-015 now records four self-contained stored-configuration cases; final native run pending.
- [ ] 2.3 Publish public guidance and complete validation, independent inspection and handoff evidence. — Public/upgrade guidance written; independent source inspection found no actionable issues. All configured local gates completed: full test passed 46/47 tasks with 33,501 Jest assertions; only create-app hit Homebrew libuv sandbox rejection, then passed 892 assertions with 5 existing skips under the bundled Node runtime. Production app build passed. Script guards passed 997 with 1 existing skip. Final native evidence and formal-review handoff pending; unavailable schema/renderer prevents formal signoff.

TC-ATT-015 creates a private partition with a parameterized database fixture because production CI locks the partition-management API and malformed legacy JSON cannot be arranged through its validator. The native runner must supply DATABASE_URL; no developer-env fallback is accepted. All attachment uploads and behavior assertions use real HTTP, and each test restores configuration, deletes its file, and removes its partition. Default/legacy runs assert compatible reads; strict runs assert typed 503 failures before side effects, including primed image-cache reads. No external S3 service is required.
