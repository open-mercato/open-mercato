# Patch fast-uri security resolution

## Goal

Remove the vulnerable fast-uri 3.1.7 resolution without changing application contracts.

## Scope

The existing root resolution, its generated Yarn lock entry, and dependency regression coverage. No new dependencies or overrides, application changes, or configuration changes.

## Implementation Plan

1. Verify upstream patch compatibility, installed dependency path and five-day release age.
2. Update the existing resolution to 3.1.9 with pinned Yarn and add regression coverage.
3. Independently verify vulnerability removal, run configured validation in order, and publish evidence on a draft PR for independent review.

## Risks

Repository-wide validation requires installed dependencies and build infrastructure. Any incomplete checks remain explicit blockers; a draft PR is not evidence that alerts on main are resolved.

## Progress

PR: #8778

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Compatibility

- [x] 1.1 Verify compatibility, installed path, release age and deduplication — cdfd2b23d

### Phase 2: Remediation

- [x] 2.1 Update resolution and add dependency regression coverage — f698916f7

### Phase 3: Verification

- [ ] 3.1 Run configured validation and independent removal proof
- [ ] 3.2 Publish draft evidence for independent review
