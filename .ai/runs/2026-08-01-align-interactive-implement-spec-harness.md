# Align Interactive Implement-Spec Harness

Source doc: `.ai/specs/2026-07-24-standalone-ai-development-harness.md`

## Goal

Align the standalone app's interactive `om-implement-spec` workflow with the shared `om-auto-implement-spec` contract for spec resolution, phase-derived planning, progress evidence, final report structure, and stable output references while preserving local, user-confirmed, phase-by-phase delivery without PR automation.

## Scope

- Expand the existing OMH-006 and OMH-168 routing evaluations instead of adding a duplicate catalog case.
- Add progressive references under the standalone `om-implement-spec` owner for spec resolution, interactive planning/progress, and report templates.
- Keep the local workflow interactive: confirm ambiguous phase selection and the phase plan before coding, stop at architecture/public-contract/scope gates, and never imply that a PR or autonomous engine ran.
- Synchronize focused create-app guidance tests and the standalone harness specification.

## Non-goals

- Do not modify the shared `open-mercato/skills` implementation of `om-auto-implement-spec` or its pinned external archive.
- Do not turn the local interactive skill into a PR/branch/label automation workflow.
- Do not add a new harness case, writable fixture, release-matrix lane, production dependency, or runtime application behavior.

## Implementation Plan

### Phase 1: Failure-first contract

1. Strengthen OMH-006/OMH-168 and focused guidance tests with the missing resolution, planning, progress, interaction, reporting, and `Spec:` marker expectations; run them against the unchanged owner and retain a sanitized semantic failure.

### Phase 2: Smallest knowledge owner

2. Add the progressive implement-spec references and route the interactive skill through them, borrowing the shared automation's stable contracts while explicitly preserving local user confirmations and phase gates.

### Phase 3: Synchronization and evidence

3. Update the harness spec/guide references, rerun focused tests and related cases, validate a fresh standalone scaffold, and complete the configured repository validation and review gates.

## Risks

- The shared automation skill can evolve independently of the pinned standalone set; the local references will align stable concepts and output markers without copying tracker-specific mechanics.
- A stronger live routing case may expose model variance. Required decisions remain semantic and the owner text will use exact stable labels to keep evaluation reproducible.
- The full live release suite depends on provider capacity and Linux/Bubblewrap containment; any unavailable required lane will be reported as a blocker rather than treated as a pass.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Failure-first contract

- [ ] 1.1 Strengthen OMH-006/OMH-168 and focused guidance tests with the missing resolution, planning, progress, interaction, reporting, and `Spec:` marker expectations; run them against the unchanged owner and retain a sanitized semantic failure.

### Phase 2: Smallest knowledge owner

- [ ] 2.1 Add the progressive implement-spec references and route the interactive skill through them, borrowing the shared automation's stable contracts while explicitly preserving local user confirmations and phase gates.

### Phase 3: Synchronization and evidence

- [ ] 3.1 Update the harness spec/guide references, rerun focused tests and related cases, validate a fresh standalone scaffold, and complete the configured repository validation and review gates.
