# Financial module prototype publication

## Goal

Publish the accountant click-through prototype as a focused contribution related to #6061, targeting `develop`.

Source doc: `.ai/specs/2026-10-15-finance-accountant-prototype-coverage.md`

## Scope

The app-specific `finance_previews` module, its activation, source coverage map, specification and executable tests. Preserve the upstream shared design system. Production accounting services, migrations, provider calls and unrelated local work are outside this contribution.

## Implementation plan

1. Transfer the existing prototype onto current develop and verify its shared-component dependencies.
2. Run the repository validation gate and isolated accountant workflow tests; fix compatibility failures.
3. Review security, design-system compliance, contracts and scope; publish validation evidence and QA handoff.

## Risks

- Newer shared controls may differ from the local prototype's previously tested runtime.
- Scenario data is fictional and session-local; coverage does not claim implementation of the production specifications.
- A public test deployment is separate from this source contribution.

## Progress

PR: #7483

### Publication approval

Further pushes and PR updates require the author's explicit approval. The existing draft remains at `bf847de4ebf5f9f53741b5c1ef1ebe94a8269de6`; verification fixes and their evidence remain local for review. Do not promote the draft, change labels or publish additional comments before approval.

### Phase 1: Prepare contribution

- [x] 1.1 Transfer and register the prototype on current develop. — 25de7eb30

### Phase 2: Verify

- [x] 2.1 Run validation and isolated workflow tests; resolve failures. — local evidence pending publication approval
- [x] 2.2 Review the complete diff and record findings. — local review; manual accountant QA remains required

The ordered repository validation gate passed using the local runner and Node 24: package build, generation, package rebuild, translation sync/usage, typecheck, unit tests and application build. `yarn test` completed all 48 tasks successfully. The focused prototype suite passed 54 unit tests; the template DS checker passed 10 tests. Template parity and diff whitespace checks passed. The final isolated browser run passed all 36 cases in 1.7 minutes, with no skipped or flaky cases. A test-only JSON import was corrected after the main gate and verified by test discovery and that complete browser run.

Local verification fixes include same-origin locale updates with error/retry handling, missing ACL catalog entries, scoped semantic form/table styling, stable asset-persistence assertions and locale recovery coverage. A template checker correction distinguishes the shared Alert appearance prop from inline CSS; this governance-related change requires separate review and approval before publication.

Review found no new finance HTTP APIs, entity schema changes, production provider calls or public contract removals. The preview route/ACL feature are additive. Shared DS primitives remain unchanged; app/template module parity is preserved. Screenshot checks covered tax results and mobile annual statements; automated viewport checks covered 1440px and 390px layouts. Exact Figma matching is not claimed for newly proposed views without source frames. Specification gaps remain listed in the coverage map; these tests validate simulation behavior, not production accounting or legal filing.

A follow-up review (2026-10-16 to 2026-10-23) restored these fixes after the temporary checkout was lost and resolved its findings. When the locale update fails, including for a tenant that does not serve Polish, the prototype now renders under a localized warning with a retry action instead of blocking. The supplier bank account number is no longer written to session storage, which resolves the CodeQL clear-text storage alert. Submit buttons use the default DS primary variant instead of a module CSS override of the status-info token.

The complete integration suite ran with the CI environment block, in segments because the local Docker daemon stopped once. All 36 finance cases passed. The only hard failure, TC-AGENT-UXC-002, also fails on the base develop commit (2 of 5 isolated repetitions), so it is pre-existing and unrelated. Forms, sales address-contact and sync_excel cases that failed once passed on retry and are outside this change.

### Phase 3: Publish

- [ ] 3.1 Publish evidence, labels and QA handoff.
