import { test, expect, type APIRequestContext } from '@playwright/test'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'
import { getAuthToken, apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  buildMinimalDefinitionPayload,
  createWorkflowDefinitionFixture,
  deleteWorkflowDefinitionIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/workflowsFixtures'
import {
  putWithLock,
  expectConflictBody,
  expectConflictBanner,
  expectNoConflictBanner,
} from '@open-mercato/core/modules/core/__integration__/helpers/optimisticLockUi'
import { fillControlledInput } from '@open-mercato/core/modules/core/__integration__/helpers/ui'
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'

/**
 * TC-LOCK-OSS-044 — workflows definition + custom-entity record + checkout
 * optimistic-lock coverage (manual cases WF-01, ENT-01, CHK-01/02).
 *
 * Surfaces and how each is exercised:
 *
 *  - WF-01 stale paths (browser + API, ACTIVE): the workflow-definition edit
 *    page (`/backend/definitions/<id>`) is a `CrudForm` that captures the
 *    definition's `updatedAt` at load and replays it on save via the
 *    optimistic-lock header (`x-om-ext-optimistic-lock-expected-updated-at`).
 *    The `workflows.definition` `createGenericOptimisticLockReader` is now
 *    registered at module-DI load time in `workflows/di.ts` (top-level, like
 *    sales/customers), so it is in the global reader store before any
 *    request-scoped `crudMutationGuardService` snapshots
 *    `getAllOptimisticLockReaders()`. Previously the reader was only registered
 *    as a side-effect of importing the definition route module, so it was absent
 *    from that snapshot and the guard short-circuited (no reader → no
 *    enforcement) — a stale `PUT` returned 200 and overwrote the record. With the
 *    reader wired at DI load time the stale write is refused with a structured
 *    409 `optimistic_lock_conflict` body and the browser raises the unified
 *    conflict bar.
 *
 *  - WF-01 clean path (browser, ACTIVE): the clean single-tab save on the same
 *    edit page is asserted to succeed (<400) and to NOT raise a false-positive
 *    conflict bar. This stays active and proves the happy-path edit flow works.
 *
 *  - ENT-01 (browser, test.fixme — PRODUCT GAP): the custom-entity record edit
 *    page (`/backend/entities/user/<entityId>/records/<recordId>`) passes
 *    `optimisticLockUpdatedAt` into `CrudForm`, so the browser DOES attach the
 *    optimistic-lock header. But the server side does NOT enforce it: the
 *    update flows through `PUT /api/entities/records`
 *    (`packages/core/src/modules/entities/api/records.ts`) → DataEngine
 *    `updateCustomEntityRecord` (`packages/shared/src/lib/data/engine.ts`),
 *    neither of which registers an optimistic-lock reader for
 *    `entities.records` nor calls `validateCrudMutationGuard` /
 *    `enforceCommandOptimisticLock`. A stale write therefore returns 200 with
 *    no 409 and no conflict bar. Per the PRODUCT-BUG rule this surface is marked
 *    `test.fixme` (skipped, so the file still runs green) rather than patching
 *    product code. See the header comment on that test for the exact gap.
 *
 *  - CHK-01 / CHK-02 (NOT APPLICABLE on OSS): the brief references a checkout
 *    "pay link / template" guarded by `enforceCommandOptimisticLock`. On this
 *    OSS build there is no such command route — the only "checkout" surface in
 *    `workflows` is the demo frontend at `workflows/frontend/checkout-demo`
 *    (a sample workflow runner, not a lock-enforced mutation route), and a
 *    repo-wide grep for `enforceCommandOptimisticLock` under any `*checkout*`
 *    path returns nothing. There is no reachable checkout lock surface to test,
 *    so CHK-01/02 are intentionally not implemented; the WF-01 and ENT-01
 *    coverage above stands in their place.
 *
 * Pattern (per `optimisticLockUi.ts`): load the edit page (form captures
 * `updatedAt`), advance `updatedAt` out-of-band with a header-less PUT, then
 * replay the now-stale write → 409 → conflict bar.
 */

const DEFINITIONS_BASE = '/api/workflows/definitions'

type DefinitionDetail = { id: string; workflowName: string; updatedAt: string }

async function readDefinition(
  request: APIRequestContext,
  token: string,
  definitionId: string,
): Promise<DefinitionDetail> {
  const response = await apiRequest(request, 'GET', `${DEFINITIONS_BASE}/${definitionId}`, { token })
  expect(response.status(), `GET ${DEFINITIONS_BASE}/${definitionId} should be 200`).toBe(200)
  const body = await readJsonSafe<{ data?: DefinitionDetail }>(response)
  const data = body?.data
  expect(typeof data?.id, 'definition detail should include an id').toBe('string')
  expect(typeof data?.updatedAt, 'definition detail should expose updatedAt').toBe('string')
  return data as DefinitionDetail
}

/**
 * Advance the definition's `updated_at` out-of-band via a header-less PUT
 * (the additive path always succeeds and bumps `updated_at`).
 */
async function bumpDefinition(
  request: APIRequestContext,
  token: string,
  definitionId: string,
  workflowName: string,
): Promise<void> {
  const response = await apiRequest(request, 'PUT', `${DEFINITIONS_BASE}/${definitionId}`, {
    token,
    data: { workflowName },
  })
  expect(
    response.status(),
    `out-of-band PUT ${DEFINITIONS_BASE}/${definitionId} should succeed (additive path), got ${response.status()}`,
  ).toBeLessThan(300)
}

test.describe('TC-LOCK-OSS-044: workflows definition + custom-entity optimistic-lock', () => {
  // The `workflows.definition` optimistic-lock reader is now registered at
  // module-DI load time in `workflows/di.ts`, so it is present in the global
  // reader store before any request-scoped `crudMutationGuardService` snapshots
  // `getAllOptimisticLockReaders()`. A stale save is refused with a 409 and the
  // browser raises the unified conflict bar.
  test('WF-01 stale workflow-definition edit shows the conflict bar', async ({ page }) => {
    const token = await getAuthToken(page.request, 'admin')
    const stamp = Date.now()
    let definitionId: string | null = null
    try {
      definitionId = await createWorkflowDefinitionFixture(
        page.request,
        token,
        buildMinimalDefinitionPayload(stamp, '-044a'),
      )

      await login(page, 'admin')
      await page.goto(`/backend/definitions/${definitionId}`)

      // The edit page is a CrudForm; it captures `updatedAt` at load. The
      // workflow name renders as a plain text input.
      const nameInput = page.locator('[data-crud-field-id="workflowName"] input').first()
      await expect(nameInput).toBeVisible({ timeout: 15_000 })

      // Advance updated_at out-of-band → the browser form now holds a stale token.
      await bumpDefinition(page.request, token, definitionId, `QA Lock 044 bumped ${stamp}`)

      // Edit + save in the browser → stale header → 409 → conflict bar.
      await fillControlledInput(nameInput, `QA Lock 044 stale ${stamp}`)
      await nameInput.press('Control+Enter')

      await expectConflictBanner(page)
    } finally {
      await deleteWorkflowDefinitionIfExists(page.request, token, definitionId)
    }
  })

  test('WF-01 clean single-tab workflow-definition save does not raise a false-positive bar', async ({ page }) => {
    const token = await getAuthToken(page.request, 'admin')
    const stamp = Date.now()
    let definitionId: string | null = null
    try {
      definitionId = await createWorkflowDefinitionFixture(
        page.request,
        token,
        buildMinimalDefinitionPayload(stamp, '-044b'),
      )

      await login(page, 'admin')
      await page.goto(`/backend/definitions/${definitionId}`)

      const nameInput = page.locator('[data-crud-field-id="workflowName"] input').first()
      await expect(nameInput).toBeVisible({ timeout: 15_000 })

      const putPromise = page.waitForResponse(
        (response) =>
          response.request().method() === 'PUT' &&
          response.url().includes(`${DEFINITIONS_BASE}/${definitionId}`),
        { timeout: 15_000 },
      )
      await fillControlledInput(nameInput, `QA Lock 044 clean ${stamp}`)
      await nameInput.press('Control+Enter')
      const settled = await putPromise
      expect(settled.status(), 'clean save should not 409').toBeLessThan(400)
      await expectNoConflictBanner(page)
    } finally {
      await deleteWorkflowDefinitionIfExists(page.request, token, definitionId)
    }
  })

  // Same fix as the browser case above: with the reader registered at module-DI
  // load time, a PUT carrying a stale expected-`updatedAt` header returns the
  // structured 409 `optimistic_lock_conflict` body instead of overwriting.
  test('WF-01 stale workflow-definition write is refused with a 409 conflict (API contract)', async ({ page }) => {
    const token = await getAuthToken(page.request, 'admin')
    const stamp = Date.now()
    let definitionId: string | null = null
    try {
      definitionId = await createWorkflowDefinitionFixture(
        page.request,
        token,
        buildMinimalDefinitionPayload(stamp, '-044c'),
      )

      const before = await readDefinition(page.request, token, definitionId)
      const staleUpdatedAt = before.updatedAt

      // Advance updated_at out-of-band so the captured token is now stale.
      await bumpDefinition(page.request, token, definitionId, `QA Lock 044 bumped ${stamp}`)

      // Replay the now-stale write with the original token → 409.
      const conflict = await putWithLock(
        page.request,
        token,
        `${DEFINITIONS_BASE}/${definitionId}`,
        { workflowName: `QA Lock 044 stale ${stamp}` },
        staleUpdatedAt,
      )
      await expectConflictBody(conflict)
    } finally {
      await deleteWorkflowDefinitionIfExists(page.request, token, definitionId)
    }
  })

  /**
   * ENT-01 — PRODUCT GAP (test.fixme).
   *
   * The custom-entity record edit page passes `optimisticLockUpdatedAt` to
   * `CrudForm`, so the browser attaches the optimistic-lock header on save. The
   * server side does NOT honor it: `PUT /api/entities/records`
   * (`packages/core/src/modules/entities/api/records.ts`) performs the update
   * straight through `dataEngine.updateCustomEntityRecord`
   * (`packages/shared/src/lib/data/engine.ts`) with no registered
   * optimistic-lock reader for `entities.records` and no
   * `validateCrudMutationGuard` / `enforceCommandOptimisticLock` call. A stale
   * write therefore returns 200 with no 409 and no conflict bar.
   *
   * Fixing this requires product changes (register a reader for the
   * `custom_entities_storage` doc + thread the guard through the records route),
   * which is out of scope for a test. Marked `test.fixme` so the file still runs
   * green; flip to an active browser conflict-bar test once the route enforces
   * the lock.
   */
  test.fixme('ENT-01 stale custom-entity record edit shows the conflict bar', async () => {
    // Intentionally empty: the records PUT route does not enforce the
    // optimistic-lock header, so there is no 409/conflict-bar behavior to
    // assert yet. See the block comment above for the exact route + gap.
  })
})
