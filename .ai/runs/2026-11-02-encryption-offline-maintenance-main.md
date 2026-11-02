# Encryption maintenance review follow-up on main

## Goal

Apply the reviewed encryption-maintenance safety fixes on main, aligned with the release backport and the operator-approved offline maintenance contract.

## Scope

Require tenant-confirmed offline maintenance before retiring encryption maps, preserve concurrent writes through conditional updates, prove complete governed-scope coverage before retirement, and retain a conspicuous compatibility bridge for previous root secrets supplied through argv. Preserve main's custom-entity document rotation and existing encryption hardening.

Source doc: `.ai/specs/implemented/SPEC-031-2026-02-18-decrypt-database-cli.md`

## Implementation Plan

1. Compare the release review repair with current main and adapt only missing fixes.
2. Preserve custom-document support and add focused regression/integration coverage.
3. Align CLI/operator documentation and the existing specification with the offline contract.
4. Execute the configured validation gate and review the resulting diff.
5. Publish the completed PR with validation evidence and independent review.

## Risks

Offline confirmation is an operator acknowledgment, not a mechanism that stops external writers. Operators must stop every writer before map retirement and restart all replicas before resuming. Do not claim online coordination of previously queued encrypted payloads. Keep the argv compatibility bridge explicit and document the exposure.

## Progress

PR: #8488

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Adapt reviewed maintenance changes

- [x] 1.1 Compare and adapt the release safety repair to main. — 56dd6dcca
- [x] 1.2 Preserve custom documents and add focused coverage. — 56dd6dcca
- [x] 1.3 Update operator documentation and specification. — 56dd6dcca

### Phase 2: Verify and publish

- [ ] 2.1 Run validation and inspect the final diff.
- [ ] 2.2 Publish the completed PR and independent review evidence.
