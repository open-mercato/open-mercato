# Restore the Example Sidebar Group to the End

## Goal

Restore the Example module's sidebar group to its historical tail position in normal monorepo and standalone-app runtimes without weakening the new app-level navigation ordering override.

Source doc: `.ai/specs/2026-07-30-nav-group-order-override-domain.md`

## Scope

- Correct the app configuration that enabled `example.nav.group` as a live ordering override solely to support integration coverage.
- Keep the real-bootstrap integration proof active only inside the existing ephemeral integration-test runtime.
- Mirror the correction in the create-app template and add a regression contract that prevents the test fixture from leaking into default app behavior again.
- Update the existing navigation-ordering spec to record the corrected fixture boundary.

## Non-goals

- Do not change `overrides.nav.groupOrder` prepend semantics or the shipped `defaultGroupOrder`.
- Do not change role or per-user sidebar preferences, persistence, APIs, or the customization editor.
- Do not add a new environment variable or alter navigation for apps that deliberately configure their own group ordering.

## Implementation Plan

### Phase 1: Runtime boundary

- Gate the applied Example-module nav override behind the existing `OM_INTEGRATION_TEST` runtime flag in both the monorepo app and the standalone template, while leaving the copyable override example intact.

### Phase 2: Regression coverage and documentation

- Add a create-app contract test that checks the monorepo/template Example entries remain synchronized and that their applied nav override is explicitly test-only.
- Update the existing nav-ordering spec's integration-coverage explanation and changelog with the root-cause correction.

### Phase 3: Verification and review

- Run focused tests for the changed app/template contract, the configured validation gate, and the authoritative PR review/autofix workflow before marking the run complete.

## Risks

- The integration server must continue receiving `OM_INTEGRATION_TEST=true`; the existing ephemeral runner already sets it for both reusable and fresh runtimes, and the route-level integration test retains coverage of the enabled path.
- A source-contract test can become brittle if the Example entry is substantially reorganized; it intentionally scopes extraction to that entry and validates behavior-bearing syntax rather than the entire modules file.
- Users with saved role or personal ordering remain unaffected because those preferences already have higher precedence than app defaults.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Runtime boundary

- [x] 1.1 Gate the applied Example nav override to integration-test runtimes — 9b4c4e5c4

### Phase 2: Regression coverage and documentation

- [ ] 2.1 Add synchronized app/template regression coverage
- [ ] 2.2 Record the corrected integration-fixture boundary in the source spec

### Phase 3: Verification and review

- [ ] 3.1 Complete the validation gate and authoritative PR review
