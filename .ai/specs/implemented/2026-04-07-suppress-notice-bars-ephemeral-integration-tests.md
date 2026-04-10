# Suppress Notice Bars During Ephemeral Integration Tests

| Field | Value |
|-------|-------|
| Status | Draft |
| Scope | OSS |
| Owner | CLI / App Shell / QA |
| Related Issues | [#1137](https://github.com/open-mercato/open-mercato/issues/1137) |
| Related Guides | `packages/cli/AGENTS.md`, `packages/create-app/AGENTS.md`, `.ai/qa/AGENTS.md`, `packages/ui/AGENTS.md` |
| Related Specs | `SPEC-027-2026-02-16-integration-testing-automation.md`, `2026-03-25-safe-build-dev-coexistence.md` |

## TLDR

Implement option 1 from issue [#1137](https://github.com/open-mercato/open-mercato/issues/1137): when the app is started by the ephemeral integration runner, set `OM_INTEGRATION_TEST=true` and skip rendering `GlobalNoticeBars` entirely. This removes the bottom-fixed demo and cookie banners from ephemeral Playwright runs without requiring per-test cookie setup, while keeping normal runtime behavior unchanged for local dev, production, and non-ephemeral testing.

## Overview

Ephemeral integration runs boot the full app with `DEMO_MODE=true` by default. That causes `GlobalNoticeBars` to render two bottom-fixed banners:

- demo environment notice
- cookie notice

Those banners are valid product behavior, but they are hostile to Playwright because they can intercept clicks on dialog and page actions near the bottom of the viewport. The current mitigation is fragmented:

- core Playwright login helper pre-sets the acknowledgement cookies
- custom standalone-app login helpers may not use that helper
- any test that navigates before helper login still sees the banners

This spec adopts the simplest upstream proposal: treat ephemeral integration runtime as a first-class app mode and suppress the notice bars at render time whenever `OM_INTEGRATION_TEST=true`.

## Problem Statement

The current implementation couples test reliability to client-side cookie seeding instead of the runtime mode that created the problem.

Concrete current behavior:

- [`apps/mercato/src/components/GlobalNoticeBars.tsx`](/Users/mariuszlewczuk/Projects/omML/apps/mercato/src/components/GlobalNoticeBars.tsx) shows the demo notice when `demoModeEnabled` is true and `om_demo_notice_ack` is absent.
- The same component shows the cookie notice when `om_cookie_notice_ack` is absent.
- [`packages/create-app/template/src/components/GlobalNoticeBars.tsx`](/Users/mariuszlewczuk/Projects/omML/packages/create-app/template/src/components/GlobalNoticeBars.tsx) mirrors the same behavior for standalone apps.
- [`packages/core/src/helpers/integration/auth.ts`](/Users/mariuszlewczuk/Projects/omML/packages/core/src/helpers/integration/auth.ts) works around the problem by setting both cookies before login.
- [`packages/cli/src/lib/testing/integration.ts`](/Users/mariuszlewczuk/Projects/omML/packages/cli/src/lib/testing/integration.ts) already provides a dedicated ephemeral runtime environment and already injects `OM_TEST_MODE=1`, but the app shell does not currently use a dedicated notice-suppression flag.

This creates four issues:

1. Test reliability depends on using the exact shared login helper.
2. Standalone apps can reproduce the bug even when the monorepo helper path is healthy.
3. Tests that interact with the UI before login or outside helper-managed flows still hit the overlays.
4. The workaround lives at the test layer even though the behavior is specific to the ephemeral integration runtime.

## Proposed Solution

Implement option 1 from issue `#1137` exactly:

1. The ephemeral integration runner sets `OM_INTEGRATION_TEST=true` for the app process.
2. The app shell derives `noticeBarsEnabled = process.env.OM_INTEGRATION_TEST !== 'true'`.
3. When notice bars are disabled, `GlobalNoticeBars` is not rendered at all.
4. Normal notice behavior remains unchanged outside ephemeral integration mode.

This is intentionally narrower than broader “test mode” behavior:

- do not change `DEMO_MODE`
- do not auto-write acknowledgement cookies
- do not change banner styling or pointer-events rules
- do not suppress `DemoFeedbackWidget` unless a separate issue requires it

The result is deterministic and runtime-owned: the app started by `mercato test:integration` behaves in a Playwright-safe way without requiring every test suite to remember a cookie bootstrap step.

## Architecture

### 1. Runtime flag ownership

Use a dedicated env var named in the upstream issue:

- `OM_INTEGRATION_TEST=true`

The env var is additive and scoped to ephemeral integration runtime only.

It should be injected in both ephemeral environment paths in [`packages/cli/src/lib/testing/integration.ts`](/Users/mariuszlewczuk/Projects/omML/packages/cli/src/lib/testing/integration.ts):

- fresh ephemeral environment startup
- reusable environment reconstruction via `buildReusableEnvironment()`

This keeps first-run behavior and test-command reuse behavior aligned for environments that were originally started by a CLI version that already exported `OM_INTEGRATION_TEST=true`.

Important reuse constraint:

- `buildReusableEnvironment()` only reconstructs the command environment for Playwright and helper commands
- it does not retrofit new env vars into an already-running app process
- persisted ephemeral environments created before this change may therefore need a rebuild before they gain notice-bar suppression

Implementation stance:

- reuse is supported only for environments originally started by the updated CLI
- older persisted ephemeral environments may continue without suppression until rebuilt

### 2. App-shell suppression point

The authoritative suppression point should be the root app layout, not the test helper layer.

Affected shell files:

- [`apps/mercato/src/app/layout.tsx`](/Users/mariuszlewczuk/Projects/omML/apps/mercato/src/app/layout.tsx)
- [`packages/create-app/template/src/app/layout.tsx`](/Users/mariuszlewczuk/Projects/omML/packages/create-app/template/src/app/layout.tsx)
- [`apps/mercato/src/components/AppProviders.tsx`](/Users/mariuszlewczuk/Projects/omML/apps/mercato/src/components/AppProviders.tsx)
- template equivalents where prop shape is mirrored

Recommended shape:

- compute `integrationTestModeEnabled` in the root layout from `process.env.OM_INTEGRATION_TEST === 'true'`
- pass an additive prop such as `noticeBarsEnabled` or `suppressGlobalNoticeBars` into `AppProviders`
- render `GlobalNoticeBars` only when enabled

This is preferable to letting `GlobalNoticeBars` mount and immediately return `null` because:

- the root layout owns server-side runtime mode decisions
- the provider tree remains explicit about shell behavior
- standalone template parity is easier to review

### 3. Component contract

`GlobalNoticeBars` remains the product component for normal runtime behavior. No cookie names, dismissal semantics, or visible copy change.

Only its mount condition changes:

- before: mounted for all app sessions
- after: mounted for all app sessions except ephemeral integration mode

### 4. Template parity

Because this behavior affects app shell wiring, the create-app template must be updated in the same change per [`packages/create-app/AGENTS.md`](/Users/mariuszlewczuk/Projects/omML/packages/create-app/AGENTS.md).

Required parity targets:

- root layout env read
- provider prop shape
- `GlobalNoticeBars` mount condition

### 5. Test helper cleanup stance

The existing cookie acknowledgement helper in [`packages/core/src/helpers/integration/auth.ts`](/Users/mariuszlewczuk/Projects/omML/packages/core/src/helpers/integration/auth.ts) may remain as a backward-compatible safety net. This spec does not require removing it in the same change.

That keeps the implementation low-risk:

- runtime-level fix solves the root issue
- helper-level cookie seeding can remain for resilience and for non-ephemeral local runs

## Data Models

No database changes.

No entity, migration, or persistence changes.

New runtime contract:

- `OM_INTEGRATION_TEST=true` indicates the app is running inside the ephemeral integration environment started by Open Mercato CLI tooling.

## API Contracts

No HTTP API route URLs or payloads change.

No OpenAPI updates are required.

CLI/runtime contract additions:

- ephemeral integration runtime exports `OM_INTEGRATION_TEST=true`
- app-shell rendering reads that env var and suppresses `GlobalNoticeBars`

Affected UI paths:

- `/login`
- `/backend`
- backend dialogs and forms reached during Playwright flows where bottom-fixed banners currently intercept clicks
- equivalent standalone-app routes generated from the create-app template

Affected API/readiness paths used during verification:

- `POST /api/auth/login`
- any existing module APIs exercised by Playwright scenarios that were previously blocked by banner interception

## Verification

### Unit / component checks

- add or update app-shell tests to verify `GlobalNoticeBars` is not rendered when `OM_INTEGRATION_TEST=true`
- verify normal runtime still mounts `GlobalNoticeBars` when `OM_INTEGRATION_TEST` is absent
- no dedicated new notice-bar integration spec is required for this change

### Integration coverage

Key UI coverage to validate:

- `/login` in ephemeral mode does not render the cookie banner
- `/login` in ephemeral mode with `DEMO_MODE=true` does not render the demo notice
- a backend flow with a bottom-aligned dialog action succeeds without manual cookie seeding
- standalone template ephemeral integration flow inherits the same suppression behavior

Coverage strategy for this change:

- rely on an app-shell assertion for `GlobalNoticeBars` mount suppression in integration mode
- rely on existing broad login and dialog Playwright flows to confirm the overlays no longer interfere
- do not introduce a dedicated notice-bar-specific end-to-end regression file unless implementation reveals a gap in existing coverage

Recommended execution paths:

- targeted Playwright run against a monorepo integration test that clicks near the bottom of a dialog
- `yarn test:create-app:integration` or equivalent standalone parity check after template sync

Regression checks:

- normal `yarn dev` behavior still shows notice bars when cookies are absent
- non-ephemeral integration runs using explicit `BASE_URL` are unaffected unless they deliberately set `OM_INTEGRATION_TEST=true`

## Risks & Impact Review

| Risk | Severity | Affected Area | Mitigation | Residual Risk |
|------|----------|---------------|------------|---------------|
| Env var set only for fresh ephemeral runs but not reused environments | Medium | Reused ephemeral QA loop | Inject the flag in both fresh-start and `buildReusableEnvironment()` paths | Low |
| Monorepo fix lands without template sync | High | Standalone apps | Update template root layout and provider wiring in the same change | Low |
| Overloading existing `OM_TEST_MODE` instead of the issue-specific flag creates ambiguous future behavior | Medium | CLI/app runtime semantics | Use dedicated `OM_INTEGRATION_TEST` as proposed upstream; keep `OM_TEST_MODE` unchanged | Low |
| Suppressing all notice bars could hide legitimate product regressions in ephemeral tests | Low | UI coverage expectations | Limit suppression strictly to ephemeral integration runtime; leave local dev and manual QA unchanged | Low |
| Future tests rely on banner absence outside ephemeral mode | Low | Test design discipline | Document that suppression is runtime-specific, not global test behavior | Low |

## Backward Compatibility

This change is additive and does not alter frozen or stable contract surfaces:

- no route changes
- no API response changes
- no event ID changes
- no ACL feature changes
- no generated file contract changes

The only new contract is an internal runtime env flag used by CLI-managed ephemeral integration flows.

## Final Compliance Report

| Check | Result | Notes |
|-------|--------|-------|
| Spec includes TLDR | Pass | Present |
| Spec includes Overview | Pass | Present |
| Spec includes Problem Statement | Pass | Present |
| Spec includes Proposed Solution | Pass | Present |
| Spec includes Architecture | Pass | Present |
| Spec includes Data Models | Pass | No schema changes |
| Spec includes API Contracts | Pass | No HTTP contract changes; runtime env contract documented |
| Spec includes Risks & Impact Review | Pass | Risk table included |
| Integration coverage listed | Pass | Key UI paths and verification commands described |
| Backward compatibility reviewed | Pass | Additive-only runtime behavior |

## Changelog

- 2026-04-07: Initial draft created for issue `#1137`, scoped to option 1 only (`OM_INTEGRATION_TEST=true` suppresses `GlobalNoticeBars` during ephemeral integration runs).
