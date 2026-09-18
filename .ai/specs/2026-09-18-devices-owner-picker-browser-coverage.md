# Browser-level coverage for the device owner picker and owner column

## 📝 TLDR

`TC-DEV-009` covers the `/api/auth/users` batch owner lookup at the API level only; it never opens a browser `page`. #5617 shipped two user-facing surfaces on top of that lookup — the `combobox` owner field on *Register device* and the batched owner-column resolution on the devices list/detail pages — with no automated regression net; both were verified by hand during that PR's QA. This spec adds one Playwright browser-level integration test, `TC-DEV-010`, closing that gap and pinning the picker's current contract (`allowCustomValues: false`, `devices.admin` `dependsOn: ['auth.users.list']`) so a future regression of either surface fails CI instead of requiring another manual QA pass.

## 📝 Problem Statement

- The owner picker and owner column are the only two devices-admin UI surfaces #5617 touched, and both were exercised solely through manual QA (see the PR's [review comment](https://github.com/open-mercato/open-mercato/pull/5617#issuecomment-5418609832)).
- The picker's contract changed late in #5617: `allowCustomValues` went from implicitly-allowed to `false`, gated on `devices.admin` declaring `dependsOn: ['auth.users.list']`. The earlier manual QA run recorded the paste-an-id escape hatch working; that behavior is now intentionally gone, and nothing in the suite asserts the new, correct behavior.
- Without a browser-level test, a regression in `resolveDeviceUserOptions` batching, the combobox's `allowCustomValues` handling, or the ACL-degradation fallback would only surface again through manual QA.

## 📝 Proposed Solution

Add a single new Playwright spec, `TC-DEV-010.spec.ts`, under `packages/core/src/modules/devices/__integration__/`, following the existing `TC-DEV-00x` naming and structure (see `TC-DEV-001.spec.ts`, `TC-DEV-009.spec.ts`). It drives the `page` fixture (unlike API-only `TC-DEV-009`) through the six scenario steps from the issue: full-admin picker success, rejection of an out-of-list value, owner-column resolution (including pagination), the ACL-degraded case, and teardown.

**Alternative considered:** extend `TC-DEV-009.spec.ts` in place instead of adding a new file. Rejected — `TC-DEV-009` is deliberately API-only (`request` fixture, no `page`); mixing a browser-driven scenario into it would blur that file's scope and its existing name/comment ("the devices admin surface identifies a device owner by name, not by UUID"). A new numbered test case keeps `TC-DEV-009` unchanged and gives the browser scenario its own regression identity, consistent with how the module already numbers cases per surface.

## 📝 Architecture

No production code changes. This is a test-only addition:

- **New file:** `packages/core/src/modules/devices/__integration__/TC-DEV-010.spec.ts`.
- **Reused helpers:** `packages/core/src/modules/core/__integration__/helpers/authFixtures.ts` for user/role fixtures (`createUserFixture`, role-with-features helpers, cleanup helpers), and the shared Playwright `page`/`request` fixtures already used by `TC-DEV-001.spec.ts` for backend UI flows.
- **Surfaces under test:** `/backend/devices/create` (combobox field), `/backend/devices` (list, owner column, pagination), `/backend/devices/[id]` (detail header), and the ACL-degraded variant of the list.
- **No changes** to `devices.admin`'s ACL declaration, `resolveDeviceUserOptions`, `ComboboxInput`, or any other runtime code — the spec exists to lock in behavior already shipped in #5617.

## 📝 Data Model

No schema or entity changes. Test fixtures only, all created and torn down within the test:

- Two users with distinct display names in the token's org (for the picker's disambiguation-by-email scenario).
- A third user carrying only a role granted `devices.admin` **without** `auth.users.list` (for the degradation scenario).
- A role granted `devices.admin` without `auth.users.list`.
- One or more devices, registered via the API (not the form) so an owner can be set without ever appearing in a picker search — needed to exercise the owner-column resolution path independent of the picker.

All fixtures are created via `authFixtures.ts` helpers and the devices admin API, and deleted in a `finally` block (devices first, then users, then the role), per `.ai/qa/AGENTS.md`.

## 📝 API Contracts

No API changes. The test exercises existing endpoints as a consumer:

- `POST /api/devices/admin/devices` (or the equivalent create-device admin route) to register a device with an owner directly via API for the owner-column scenario.
- `GET /api/auth/users` (already covered at the API level by `TC-DEV-009`) — exercised indirectly here through the UI's combobox search and the list's batched owner resolution, not asserted on directly.
- `DELETE` endpoints for devices, users, and the role, used in teardown.

## 📝 UI/UX

Six scenario steps, each independently assertable, matching the issue verbatim:

1. **Setup** — via `authFixtures.ts`: two users with distinct display names in the token's org; a role granted `devices.admin` without `auth.users.list`, plus a third user carrying only that role.
2. **Picker (full admin)** — on `/backend/devices/create`, the owner field is labelled `devices.form.userId`, described by `devices.form.userIdHint`, and carries `role="combobox"`. Type a partial name (using `pressSequentially` after confirming hydration via `inputValue()` — see Driver gotcha below), assert exactly one `role="option"` containing both name and email. Select it, fill `deviceId`, submit, assert the redirect and the `devices.form.success.created` flash message.
3. **Out-of-list values are rejected** — type a raw UUID that no search returned, blur, and assert the input does not retain it (`ComboboxInput.confirmSelection` reverts when `allowCustomValues` is false) and that the form cannot be submitted with it.
4. **Owner column** — with a device whose owner never appeared in a picker search (registered via API), assert every User cell on `/backend/devices` resolves to a display label and none matches `/^[0-9a-f]{8}-[0-9a-f]{4}-/i`, repeated past page 1. Then assert the detail page header (`/backend/devices/[id]`) shows the display name.
5. **Degradation** — with the `devices.admin`-only role (no `auth.users.list`), assert `/backend/devices` renders (URL does not redirect to `/login`) with User cells falling back to bare ids, and that the picker returns zero options. Do not attempt a successful registration under this role — that path is intentionally blocked by the ACL dependency.
6. **Teardown** — delete every device, then the users, then the role, in a `finally`.

**Driver gotcha (must be baked into the implementation):** `CrudForm` is a controlled client component. Calling `locator.fill()` before hydration sets the DOM value directly and React then wipes it on hydration, producing a false negative where the picker appears to return nothing because nothing was ever actually typed (this happened twice during #5617's manual QA). The test must wait for hydration, type using `pressSequentially`, and assert `inputValue()` reflects the typed text before asserting on the suggestion list.

## 📝 Edge Cases & Failure Scenarios

- **Pagination boundary (step 4):** the owner-column assertion must hold on pages beyond page 1, since the regression this test targets is specifically in the batched `resolveDeviceUserOptions` lookup, which is most likely to break under multi-page owner sets.
- **Combobox not yet hydrated:** covered by the Driver gotcha — asserting `inputValue()` before trusting the option list prevents a false pass/fail from a race with hydration.
- **Flaky selection due to same-named users:** the setup deliberately uses users with distinct display names, and the picker assertion checks for exactly one option containing both name and email, so ambiguity is structurally ruled out rather than asserted away.
- **Teardown failure:** cleanup runs in a `finally` so a mid-test assertion failure still deletes fixtures; if a delete itself fails, it should not mask the original test failure (log and continue, consistent with sibling specs' patterns).
- **Test order/isolation:** all fixtures are uniquely suffixed (per existing `uniqueSuffix()` convention in `TC-DEV-009.spec.ts`) so the test is safe to retry and run in parallel with others.

## 📝 Risks & Impact Review

- **Blast radius:** none on production code — this is a new test file only. Risk is limited to CI runtime (one more browser-driven Playwright test) and potential flakiness if hydration timing isn't handled per the Driver gotcha.
- **No migration or compatibility concerns** — no schema, API, or contract changes.
- **Rollback:** deleting or skipping the new spec file fully reverts this change; no other code depends on it.

## 📋 Phasing

Single phase — one self-contained test file with no dependencies on other in-flight work.

- **Phase 1:** Add `TC-DEV-010.spec.ts` covering all six scenario steps.

## 📋 Implementation Plan

### Phase 1: Add browser-level owner picker and owner column coverage

1. **Step 1 — Scaffold the spec file and fixtures.** Create `packages/core/src/modules/devices/__integration__/TC-DEV-010.spec.ts` with `test.describe('TC-DEV-010: ...')`, import `authFixtures.ts` helpers, and implement setup (two named users, a `devices.admin`-without-`auth.users.list` role, a third user with only that role) and a `finally` teardown that deletes devices, users, and the role. Verifiable by running the file and confirming setup/teardown pass with the scenario body stubbed to a no-op assertion.
2. **Step 2 — Picker success path (steps 2–3 from the scenario).** On `/backend/devices/create`, implement the hydration-safe typing helper (wait for hydration, `pressSequentially`, assert `inputValue()`), assert the single matching `role="option"` with name+email, complete registration, and assert the success flash. Then assert the out-of-list UUID is rejected (input reverts, form blocked). Verifiable: test passes against the current `#5617`-shipped behavior; briefly reverting `allowCustomValues: false` locally should fail the rejection assertion, confirming it actually pins the contract.
3. **Step 3 — Owner column and detail page (scenario step 4).** Register a device via the API with an owner never seen by a picker search; assert list-page User cells never match a raw-UUID pattern, across pagination; assert the detail page shows the display name. Verifiable: test passes; temporarily reverting `resolveDeviceUserOptions` to return raw ids should fail this step.
4. **Step 4 — Degradation path (scenario step 5).** Authenticate as the `devices.admin`-only user, assert `/backend/devices` renders without redirecting to `/login`, User cells fall back to bare ids, and the picker returns zero options. Verifiable: test passes under current ACL wiring.
5. **Step 5 — Full suite run and CI wiring check.** Run `yarn test:integration` (or the ephemeral variant) to confirm `TC-DEV-010` passes deterministically and does not affect `TC-DEV-001`/`TC-DEV-009`/`TC-DEV-005`/`TC-DEV-006`/`TC-DEV-007`. Confirm the module's `Validation Commands` in `.ai/qa/AGENTS.md` pick this file up (`npx playwright test --config .ai/qa/tests/playwright.config.ts devices`).
