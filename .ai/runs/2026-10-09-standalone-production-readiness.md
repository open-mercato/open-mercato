# Standalone production-readiness guidance

Source doc: `.ai/specs/2026-07-24-standalone-ai-development-harness.md`
Issue: #6956

## Goal

Publish one provider-neutral, TLS-first production-readiness checklist and make fresh standalone agents route go-live reviews to the same safe guidance, with failure-first harness coverage.

## Scope

- Add the canonical deployment documentation page and link provider-specific runbooks to it.
- Add a compact standalone root route plus one emitted deployment guide, preserving the standalone instruction budget and both generator paths.
- Add the next contiguous read-only harness case with fail-before/pass-after evidence and synchronize every governed count/spec surface.
- Complete the knowledge-change manifest, focused create-app checks, fresh-scaffold validation, and required harness release proof.

## Non-goals

- No live deployment, infrastructure provisioning, credential access, or environment-value inspection.
- No runtime security-default, CLI, database, API, or required-environment-variable contract changes.
- No provider-specific defaults moved into the shared checklist.

## Implementation Plan

### Phase 1: Failure-first harness contract

1. Add the next contiguous read-only production-readiness routing case and a focused test that fails against the unchanged knowledge owner, recording only sanitized evidence.
2. Synchronize the case schema, validator counts, related-case links, and catalog documentation required for the added case.

### Phase 2: Canonical documentation and emitted guidance

1. Add the TLS-first provider-neutral production-readiness page, register it in the Deployment sidebar, and replace duplicated shared advice in VPS/Railway pages with canonical links.
2. Add `.ai/guides/production-deployment.md` to the standalone agentic source and route deployment/go-live requests from both standalone root instruction sources without reading live `.env` values.
3. Extend copy, ownership, and instruction-budget tests so both generator paths emit the same guide and root rule.

### Phase 3: Harness synchronization and knowledge proof

1. Update the governing harness spec and every count/release surface, then prove the new case passes after the owner change.
2. Generate and validate the knowledge-change manifest from the pre-change base, including the affected certified lane and fresh packed standalone scaffold checks.

### Phase 4: Final validation and review

1. Run documentation tests, focused create-app tests, agent budget checks, deterministic harness validation, the required contained release lane, and the configured validation gate; resolve failures without weakening checks.
2. Run code review/autofix, verify issue/PR linkage and labels, and publish sanitized evidence plus collision notes for concurrently open harness-catalog PRs.

## Risks

- Open PRs #6892 and #6688 also claim the current next harness ID. Use the next contiguous ID on the actual base and rebase/renumber if either lands before this PR.
- The knowledge-contract gate intentionally fails closed if fail-before evidence, source ownership, count surfaces, fresh-scaffold proof, or the release lane is incomplete.
- The full harness release lane may be unavailable because of runner capacity or containment prerequisites; report an environment blocker rather than weakening the gate.

## Evidence

- Failure-first focused test (local runner): `node --import tsx --test packages/create-app/src/lib/agent-production-deployment-guidance.test.ts` failed 1/2 before the owner change with the semantic assertion `missing routed production deployment guide`; the OMH-238 catalog contract itself passed.
- Post-change local focused gate: production routing/safety, shared emission/ownership, and instruction-budget tests passed 13/13; CLI agentic ownership passed 18/18.
- Documentation gate after merging and tightening the canonical page: `yarn workspace open-mercato-docs test` built the Docusaurus site and passed 23/23 tests.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Failure-first harness contract

- [x] 1.1 Add the production-readiness case and focused fail-before test — f7930ddca
- [x] 1.2 Synchronize case schema, validators, relations, and catalog docs — c77da7c06

### Phase 2: Canonical documentation and emitted guidance

- [x] 2.1 Add canonical docs and provider-runbook links — 594e100b2
- [x] 2.2 Add the emitted deployment guide and root routing rule — fd7e12d1f
- [x] 2.3 Extend generator, ownership, and budget coverage — fd7e12d1f

### Phase 3: Harness synchronization and knowledge proof

- [x] 3.1 Synchronize the governing spec/count surfaces and pass the new case — c77da7c06, fd7e12d1f
- [ ] 3.2 Generate and validate the knowledge-change manifest and certified lane

### Phase 4: Final validation and review

- [ ] 4.1 Run the required documentation, create-app, harness, release, and repository gates
- [ ] 4.2 Complete review/autofix and publish sanitized evidence
