# WCAG in Storybook, the Native Catalogue, and PR Tests

## TLDR

Extend the existing Storybook and the native `/backend/design-system` catalogue with accessible usage patterns, guidance, and component tests after real interactions. One maintained source feeds both catalogues. An independent Playwright/axe gate detects new violations in PRs and retains evidence. The [master specification](2026-10-01-wcag-22-aa-accessibility.md) defines the product accessibility target.

Status: **draft proposed for review; no Storybook/CI changes or dependencies added**. These tools do not certify product conformance. Changes to required checks or the pipeline require separate approval.

## Overview

The developer catalogue provides accessible component examples and guidance, backed by interaction tests and evidence for PR review. Storybook and the native design-system catalogue share the same maintained source.

## Problem Statement

Current state on develop `7f0ebf65398fbf75a3f2485cc79d31da92a108b3`: Storybook, `@storybook/nextjs-vite`, and `@storybook/addon-a11y` 10.6.0; `@playwright/test` resolves to 1.62.1, and axe-core 4.13.0 is present only as a transitive dependency. The addon is configured in `packages/ui/.storybook/main.ts:14`, and `packages/ui/.storybook/preview.tsx:56` has `test: 'todo'`. The smoke runner renders components and performs selected keyboard checks, but does not run axe. CI and `.ai/agentic.config.json` do not invoke Storybook.

The specification, commands, generator, smoke runner, and addon also exist on main `fefc71d09efe2aa8c732dc6fafaa084a0e0dae3c`. On both branches, preview uses `todo`, and the smoke runner does not execute axe; no Storybook invocation was found in the inspected CI/configuration. `check:tokens` includes a test against real CSS, executed in CI through `test:scripts`; preserve this gate.

Related work: the [master backlog](2026-10-01-wcag-22-aa-accessibility.md#existing-issue-links) defines regression families in actual consumers. [#6223](https://github.com/open-mercato/open-mercato/issues/6223) is a closed historical catalogue integrity bug; integrity evidence is separate from a WCAG pass. [#4651](https://github.com/open-mercato/open-mercato/issues/4651) already has a partially implemented token/contrast gate. The [readiness report](analysis/ANALYSIS-2026-10-01-wcag-22-aa-accessibility.md) documents dependencies.

Before S1, the catalogue owner records the selected upstream SHA, and registry/generator/output consistency, then presents a concrete diff for approval. S2 requires the same provenance for the static build, stories, and runtime evidence. Extend approved sources without automatically importing uncommitted work.

`todo` is an advisory setting. Switching to `error` works with an appropriate runner, but does not enforce checks in the current custom smoke script. According to [Storybook accessibility testing](https://storybook.js.org/docs/writing-tests/accessibility-testing), tests must run and their results must be read in a compatible environment. Avoid adding a second test framework unnecessarily when Playwright is already available.

## Proposed Solution

1. Keep canonical accessibility guidance/examples with source gallery entries and sidecar metadata keyed by stable entry/variant IDs. Do not change the required `GalleryEntry/GalleryVariant` interface.
2. Provide an “Accessibility / WCAG 2.2 AA” Storybook guide and a native “Accessibility” page covering keyboard interaction, labels/errors, the focus lifecycle, live feedback, contrast/zoom, and a new-feature checklist.
3. Use real stories of production primitives and composites with controlled mocks; keep the snippet and render together. An inline screenshot specimen of a dialog does not replace a live portaled dialog for focus testing.
4. Extend the existing Playwright approach with an axe adapter after explicit approval of the development-only dependency and version. Prefer `@axe-core/playwright`; direct axe-core is an alternative. Do not treat an incidental hoisted/transitive dependency as a stable contract.
5. Add a separate CI check for components/states and retain existing module E2E tests for actual workflows. New gates do not replace manual QA.

## Architecture

### Generation and Ownership

`scripts/storybook-generate.mjs` reads `design_system/gallery` through an AST reader and generates `packages/ui/.storybook/generated`, the theme/catalogue, and `source-library.generated.ts`. Edit gallery sources, the generator, or separate hand-authored stories; never edit generated output. The native module does not call tenant APIs and never introduces gallery-specific props into `packages/ui`.

Guide and metadata: keep one manually maintained source under the design_system module, owned by its maintainer; the generator materializes story documentation. The native renderer consumes the same source. Do not place the scanner in the runtime gallery or a global application provider. Links to results identify scope/HEAD/state instead of displaying a “WCAG compliant” badge. Translate guide chrome according to the actual locale inventory, currently including KO; retain technical proper nouns.

## Data Models

No entities are introduced. Sidecar metadata v1 contains entryId, variantId, surfaceType (`isolated`, `composition`, `page`), applicable states, keyboard contract, criteria IDs, interactions, required methods, documentation keys, and justified N/A decisions. Do not add scanner-specific properties to runtime components.

## API Contracts

No API endpoints or runtime component contracts are introduced or changed. The internal scanner report contract is described below.

Scan reports contain HEAD/build hash, runner/browser/axe versions, storyId, state, theme/locale/viewport, enabled rules/tag policy, violations, incomplete results, selected elements, configured exclusions, and trace. A separate coverage report identifies which declared combinations ran. No tests, a missing story/target, crash, timeout, missing build, unsupported rule set, or stale result produces a failed/incomplete run—never an empty successful result.

The axe policy includes supported rules tagged `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, and `wcag22aa`, with capabilities verified against the installed version. Review violations at every impact level; do not limit review to critical/serious. Report best-practice findings separately. The tool does not cover all 55 criteria.

An isolated component context has explicit differences from full-page rules, such as landmarks. Do not globally disable `region` or other rules for real routes because an individual button story does not represent a page. An exception applies to a precise rule/element/story/state, is reviewed, and has a rationale; broad `.exclude()` calls must not conceal widgets or dialog portals.

## UI/UX — Catalogue for Feature Authors

Each new primitive/composite receives usage documentation covering its accessible name and state; required props; label/help/error relationships; keyboard model; focus on open/close/unmount; status/live announcements; relevant pointer/touch alternatives; visual states/contrast; and parent-host constraints. Show a valid production snippet, rather than a separate mock that repairs a defect in the actual component.

Include only states relevant to the component: default, focus, hover, selected/expanded, invalid, loading, empty, readonly/disabled. Disabled and read-only are not interchangeable. Form documentation demonstrates the actual save/validation pattern with controlled handlers; DataTable demonstrates sort/filter/row actions; dialogs demonstrate portals and return focus; charts provide text equivalents; scheduler/kanban demonstrate a non-drag pointer path. Clearly label intentionally invalid educational examples and exclude them from production conformance coverage with a rationale; they must not become the default pattern copied by authors.

A new feature must identify a reusable pattern or add an appropriate composition story. A module-only feature may instead provide module E2E coverage and justify story N/A; do not require artificial exposure of a business route in the DS. The accessibility contract and tests remain mandatory within the relevant scope.

## State Tests and Matrix

| Area | Test Sequence | Coverage |
|---|---|---|
| Label/help/error | Render → invalid submit → read error → correct input | Role/name, relationships, retained values |
| Dialog/menu/combobox | Open with keyboard → navigate → scan → dismiss | Focus, portal DOM, background, return focus |
| Table | Sort/filter/select/page → scan and assertions | Sort state, named controls, results/empty state, focus |
| Async/live | Trigger controlled async operation → loading → success/error | Scan every phase; screen reader speech tested separately |
| DnD | Drag and alternative pointer interaction + keyboard | Equivalent outcome, rather than a keyboard-only fallback |
| Theme | Light/dark, focus/hover/selected/portals | Actual computed colors, compositing/gradients |
| Reflow | 320 CSS px + 200% text/400% zoom + spacing | Browser geometry + manual inspection without content loss |
| User-agent settings | Forced-colors emulation in light and dark, focus/selected/checked/invalid states | Focus, selection and state remain visible without `box-shadow` or background colour (`ENS-13` in the [supplement](../qa/accessibility/en-301-549-supplement.csv)) |
| Authoring components | Editor image, table, link and heading insertion; media and field-definition forms | The produced markup carries alternative text, header cells, link text and a label (`ENS-16`) |

Serialize scans with interactions and async UI readiness. Use readiness conditions instead of fixed sleeps. The axe query covers the document/portals in the correct iframe, rather than only `#storybook-root`. A DOM scan does not establish whether spoken announcements are correct; manual screen reader testing requires its own evidence.

Full baseline: all declared stories/states in both supported themes; real pages have a separate complete-flow matrix. For each PR: changed stories/consumers, relevant states, PL/EN plus the longest-text/KO risk, and mobile/desktop. Global CSS/token/theme/shared-primitive changes or an unresolved dependency impact trigger the full relevant suite. When path matching cannot determine scope, fall back to a full run rather than skipping. After CI approval, a periodic full matrix may be agreed separately; this specification does not create an automation.

## Ratchet and CI Gate

Proposed future commands, which do not exist yet: `yarn test:storybook:a11y` for scans/interaction coverage and `yarn a11y:coverage:check` for manifest validation. Existing `storybook:check`, build-storybook, and test:storybook retain their roles; do not describe them as complete WCAG tests.

CI sequence: generate from maintained sources → drift check → static build → browser readiness → interaction/axe run → report completeness validation → artifacts. The generator's --check mode can currently create the output directory: do not execute it during the current read-only stage. Run it in an isolated CI workspace to avoid modifying a developer's work.

A new A/AA violation or regression in the changed scope fails the run. Unresolved incomplete results produce an incomplete outcome and require review. Global `todo` is not the intended final mechanism. Each legacy baseline issue has a stable rule+surface+state+element fingerprint, owner, issue reference, expiry, and rationale. Comparing only violation counts is prohibited. Existing debt may justify a staged gate rollout, but does not exempt the product from its conformance target. New features do not receive an automatic allowlist entry.

Introduce test exit semantics and PR requirements only after CI changes are approved. UI changes still require `needs-qa`; the scanner does not set qa-approved. Do not change label taxonomy or merge behavior in the first step. An automated PR must not modify DS governance: guidance/policy/tokens require the owner approval path defined in pr-workflow, even when the change concerns WCAG.

## Frontend Architecture / Internationalization

Storybook Next.js/Vite is a development boundary. The native guide remains a lazy family/route consumer. Add no global providers, include no axe in the application bundle, and make no API calls from the gallery. Each new/touched client file receives a record of the reason for its client boundary and cleanup obligations; static documentation does not require a new client root. Attach the exact bundle diff and gallery hydration smoke results before merge.

## Implementation Plan

| Phase | Deliverable | Acceptance |
|---|---|---|
| S1 | Contract documentation + sidecar + native/Storybook guide | One source, stable IDs, i18n, read-only mocked examples |
| S2 | Real composition/state tests + pinned adapter | Seed known failure → fail; after fix → pass; actual portal captured |
| S3 | Scoped runner and completeness report | Zero tests / crash / stale result cannot pass; full fallback |
| S4 | Approved CI rollout | Artifacts, required check aligned with the current repository; QA policy preserved |

## Integration Test Coverage

Meaningful runner tests: a failing label/contrast case in an otherwise working story; a dialog violation detected after a late open interaction; a portal outside the root scanned; replacement of legacy violations by new violations detected despite equal counts; the correct iframe context; a theme failure invisible in light mode detected in dark mode; no tests/unsupported rule/crash failing the run. Preserve current generator integrity and coverage checks. Do not conceal full-page failures through isolated-story rule exclusions.

Module flow/API path tests remain aligned with the master specification; Storybook mocks do not establish correct behavior on RBAC/auth/payment routes. Create and remove fixtures per test without requiring live provider secrets. Changes to the generator/knowledge source require the applicable harness procedure and packed standalone parity. Select the local/Docker runner once; record actual commands and versions in the evidence.

## Migration & Backward Compatibility

Do not change required GalleryEntry/GalleryVariant fields, entry IDs, URL deep links, or role features. New metadata is an internal v1 sidecar. Never edit `.generated.*` files manually. Mirroring stylesheets/locales into create-app remains mandatory; do not repair unrelated drift. Development dependencies require an approved version and lockfile; no production dependencies are proposed.

## Risks & Impact Review

### Risk Register

#### Configuration Does Not Enforce the Gate

- **Scenario**: A configuration error leaves the scanner advisory or prevents violations from failing CI.
- **Severity**: High
- **Affected area**: CI accessibility checks.
- **Mitigation**: Run a real failing fixture and assert the exit code.
- **Residual risk**: Runner/version compatibility still requires verification.

#### Accessible Demo with an Inaccessible Runtime Host

- **Scenario**: A story passes while the production host breaks accessible interactions or announcements.
- **Severity**: High
- **Affected area**: Real application flows.
- **Mitigation**: Use the same component/snippet and test its consumers through module E2E coverage.
- **Residual risk**: Host-specific authentication and async behavior require separate evidence.

#### Broad Exclusions Conceal Violations

- **Scenario**: An exclusion intended for an isolated story hides defects in a widget, portal, or real page.
- **Severity**: High
- **Affected area**: Scanner coverage and conformance evidence.
- **Mitigation**: Review scoped exceptions and apply a full-page rule profile to actual pages.
- **Residual risk**: Axe covers only part of WCAG and requires complementary methods.

#### An Oversized Matrix Slows Every PR

- **Scenario**: Running every combination for every change makes the gate impractical.
- **Severity**: Medium
- **Affected area**: Developer workflow.
- **Mitigation**: Determine scope from the manifest and diff impact, retain a full fallback, and shard only with a complete report.
- **Residual risk**: Changes to shared primitives or themes still require expensive coverage.

#### Governance Files Enter an Automated PR

- **Scenario**: An automated WCAG PR modifies DS guidance, policy, or tokens without the required governance path.
- **Severity**: High
- **Affected area**: Design-system governance and PR policy.
- **Mitigation**: Follow the owner approval path and maintain a separate file manifest.
- **Residual risk**: The owner must make the required decision before the change proceeds.

#### Stories or Mock Handlers Call Tenant APIs

- **Scenario**: A story or mock handler accidentally calls a tenant API and exposes production data.
- **Severity**: High
- **Affected area**: Tenant data privacy and catalogue examples.
- **Mitigation**: Enforce a static mock boundary and network assertions.
- **Residual risk**: Changes in third-party wrappers require renewed boundary checks.

## Final Compliance Report — 2026-10-02

### AGENTS.md Files Reviewed

The original design review covered these guides; the English revision preserves its findings and does not constitute a new runtime audit.

- `AGENTS.md` (root)
- `.ai/specs/AGENTS.md`
- `packages/ui/AGENTS.md`
- `packages/ui/src/backend/AGENTS.md`
- `.ai/qa/AGENTS.md`
- `packages/core/src/modules/design_system/AGENTS.md`
- `packages/create-app/AGENTS.md`

The review also covered DS governance and the generator source.

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|---|---|---|---|
| Root and UI guides | Reuse existing components and approved sources | Compliant in design | Extend existing Storybook and the native catalogue; record upstream provenance before S1. |
| Root AGENTS.md | Never edit generated files by hand | Compliant in design | Edit gallery sources, the generator, or hand-authored stories. |
| Root and design_system guides | Preserve tenant isolation and catalogue boundaries | Compliant in design | No storage or API changes; mock-only examples and no tenant API calls. Implementation checks remain pending. |
| Root AGENTS.md and backward compatibility contract | Preserve existing public contracts | Compliant in design | Keep required gallery fields, stable IDs, deep links, role features, and runtime component contracts. |
| UI and create-app guides | Use i18n and mirror applicable stylesheet/locale changes | Compliant in design | Guide chrome follows the locale inventory; template parity remains an implementation requirement. |
| QA guide | Test affected UI flows with self-contained fixtures | Compliant in design | State tests complement module E2E; create and remove fixtures per test. Tests have not been implemented. |
| PR governance | Obtain approval for pipeline and DS-governance changes | Pending approval | S4, required checks, dependencies, and governance edits are not authorized by this documentation-only change. |
| Spec guide | Include risks, compatibility, coverage, and compliance review | Compliant | English revision preserves requirements and follows the specification template. |

### Internal Consistency Check

| Check | Status | Notes |
|---|---|---|
| Data models match API contracts | Pass | Internal sidecar/report contracts only; no entities or API endpoints. |
| API contracts match UI/UX | Pass | Examples use existing production components and controlled mocks without new runtime props. |
| Risks cover write operations | Pass | No product writes are introduced; generation and CI artifact risks are addressed. |
| Commands are defined for mutations | Not applicable | No application mutations or events are introduced. Proposed test commands do not yet exist. |
| Cache strategy covers read APIs | Not applicable | No read APIs or application caching are introduced. |
| Scope and evidence remain consistent | Pass in design | Component/state evidence is separate from full-flow coverage and manual AT evidence; implementation verification is pending. |

### Non-Compliant Items

No additional design-rule violation was identified in the original documentation review. Implementation readiness remains unresolved: runner code, approved dependency/version, current-upstream integration, CI approval/enforcement, and manual AT/product audit have not been completed. The proposed design cannot establish product conformance or an operational quality gate.

### Verdict

**Blocked for implementation pending the stated approvals and provenance prerequisites; design remains available for review and is not implemented.** No runtime audit or conformance verdict is claimed by this English revision.

## Changelog

- 2026-10-01 — Designed reuse of the existing Storybook + native gallery, an interaction/axe test runner, metadata, a debt ratchet, and controlled CI rollout.
- 2026-10-02 — Confirmed upstream Storybook and the CI token gate; linked existing issues and recorded S1/S2 provenance prerequisites. Code, dependencies, and CI remain unchanged.
- 2026-10-02 — Translated the specification into English, aligned risk/compliance sections with the Open Mercato template, and updated the master backlog anchor; no functional requirements changed.
- 2026-10-02 — Corrected the Storybook configuration and generated-output paths to `packages/ui/.storybook/`; the addon and `test: 'todo'` line references were confirmed against upstream develop.
- 2026-10-04 — Added two rows to the state matrix for the supplement defined in the master specification: user-agent settings (forced colors) and authoring components. The sidecar's criteria IDs may hold supplement identifiers, and a new supplement failure in the changed scope fails the run in the same way as an A/AA violation once such a check exists. E-mail and document templates stay outside Storybook and are covered by the master specification's A11Y-DOC family. No runner, dependency, or CI change is made by this revision.
