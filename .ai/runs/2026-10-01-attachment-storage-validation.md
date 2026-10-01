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
- [ ] 2.2 Integrate HTTP/CLI failures and deletion ordering; add consumer and native API regressions. — HTTP/CLI/worker/helper regressions implemented; 132 focused core and 146 S3 assertions pass. Native API run pending.
- [ ] 2.3 Publish public guidance and complete validation, independent inspection and handoff evidence. — Public/upgrade guidance written; independent source inspection found no actionable issues. Full gate and live evidence pending.
