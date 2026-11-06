# Patch protobufjs Dependabot alert 220

## Goal
Remove GHSA-j3f2-48v5-ccww from the installed protobufjs path.

## Scope
Update the existing protobufjs security resolution from 7.6.4 to compatible 7.6.5 and regenerate yarn.lock. Add a focused lockfile regression. No unrelated dependencies, APIs, schemas, workflows, issues, merges or alert dismissals.

Source identity: dependabot:open-mercato/open-mercato:220; GHSA-j3f2-48v5-ccww; npm:protobufjs; yarn.lock.

## Implementation Plan
Phase 1: Confirm parent paths, update the existing pin and generated lockfile, add regression coverage.
Phase 2: Run the configured ordered gate, request full integration CI, independently review, publish evidence.

## Risks
No node_modules exists in this worktree. Installation and validation may be blocked by runner resources or unrelated baseline failures. Patched 7.6.5 was published 2026-07-04, beyond the five-day gate. Existing parent @grpc/proto-loader accepts ^7.5.5; prefer its compatible patch over a parent major upgrade. Existing PR #3107 fixed an older advisory with 7.6.4 and does not resolve alert 220.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Remediation

- [ ] 1.1 Update protobufjs and add regression coverage

### Phase 2: Verification and publication

- [ ] 2.1 Run ordered validation and record before/after evidence
- [ ] 2.2 Obtain independent review and finalize PR
