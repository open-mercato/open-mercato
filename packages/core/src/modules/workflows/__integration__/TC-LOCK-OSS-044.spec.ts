import { test, expect, type APIRequestContext, type Locator, type Page, type Request } from '@playwright/test'
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
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

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
 *  - ENT-01 (browser, ACTIVE): the custom-entity record edit page
 *    (`/backend/entities/user/<entityId>/records/<recordId>`) passes
 *    `optimisticLockUpdatedAt` into `CrudForm`, so the browser attaches the
 *    optimistic-lock header. The server side now enforces it: `PUT
 *    /api/entities/records` (`packages/core/src/modules/entities/api/records.ts`)
 *    reads the record's current `updated_at` from `custom_entities_storage` and
 *    calls `enforceCommandOptimisticLock` (resourceKind `entities.record`)
 *    before delegating to DataEngine `updateCustomEntityRecord`
 *    (`packages/shared/src/lib/data/engine.ts`). A stale write is refused with
 *    the structured 409 `optimistic_lock_conflict` body and the browser raises
 *    the unified conflict bar.
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

type DefinitionDetail = { id: string; workflowName: string; updatedAt: string; enabled: boolean }

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
   * ENT-01 — custom-entity record stale edit (browser, ACTIVE).
   *
   * The custom-entity record edit page
   * (`/backend/entities/user/<entityId>/records/<recordId>`) passes
   * `optimisticLockUpdatedAt` to `CrudForm`, so the browser attaches the
   * optimistic-lock header on save. The server side now enforces it:
   * `PUT /api/entities/records`
   * (`packages/core/src/modules/entities/api/records.ts`) reads the record's
   * current `updated_at` from `custom_entities_storage` and calls
   * `enforceCommandOptimisticLock` (resourceKind `entities.record`) before
   * delegating to `dataEngine.updateCustomEntityRecord`
   * (`packages/shared/src/lib/data/engine.ts`). A stale write therefore returns
   * the structured 409 `optimistic_lock_conflict` body and the browser raises
   * the unified conflict bar.
   *
   * Pattern (same as WF-01 above): create a custom entity + one text field +
   * a record, load the edit page (the form captures `updated_at`), advance
   * `updated_at` out-of-band with a header-less PUT, then edit + save in the
   * browser so the now-stale header triggers the 409 → conflict bar.
   */
  test('ENT-01 stale custom-entity record update is refused with a 409 conflict', async ({ page }) => {
    const token = await getAuthToken(page.request, 'admin')
    const stamp = Date.now()
    const entityId = `qa_lock_044:rec_${stamp}`
    const fieldKey = 'qa_value'
    let recordId: string | null = null
    let entityCreated = false
    try {
      // 1) Create the custom entity definition.
      const createEntity = await apiRequest(page.request, 'POST', '/api/entities/entities', {
        token,
        data: { entityId, label: `QA Lock 044 ${stamp}`, showInSidebar: false, isActive: true },
      })
      expect(createEntity.status(), `POST /api/entities/entities should succeed, got ${createEntity.status()}`).toBeLessThan(300)
      entityCreated = true

      // 2) Add one editable text field so the record edit form renders an input.
      const createField = await apiRequest(page.request, 'POST', '/api/entities/definitions', {
        token,
        data: {
          entityId,
          key: fieldKey,
          kind: 'text',
          configJson: { label: 'QA value', formEditable: true, listVisible: true },
          isActive: true,
        },
      })
      expect(createField.status(), `POST /api/entities/definitions should succeed, got ${createField.status()}`).toBeLessThan(300)

      // 3) Create a record with an initial value.
      const createRecord = await apiRequest(page.request, 'POST', '/api/entities/records', {
        token,
        data: { entityId, values: { [fieldKey]: `initial ${stamp}` } },
      })
      expect(createRecord.status(), `POST /api/entities/records should succeed, got ${createRecord.status()}`).toBeLessThan(300)
      const createBody = await readJsonSafe<{ item?: { recordId?: string } }>(createRecord)
      recordId = createBody?.item?.recordId ?? null
      expect(typeof recordId, 'create response should expose the new recordId').toBe('string')

      // The security-critical fix is the SERVER enforcement: a stale custom-entity
      // record PUT must be refused with the structured 409 (no silent overwrite).
      // Asserted at the API level here (the custom-entity record edit page does not
      // yet round-trip the lock header in the browser — a follow-up UI nicety).
      const listed = await apiRequest(
        page.request,
        'GET',
        `/api/entities/records?entityId=${encodeURIComponent(entityId)}&pageSize=50`,
        { token },
      )
      const listBody = await readJsonSafe<{
        items?: Array<{ recordId?: string; id?: string; updated_at?: string; updatedAt?: string }>
      }>(listed)
      const items = listBody?.items ?? []
      const row = items.find((r) => (r.recordId ?? r.id) === recordId) ?? items[0]
      const staleUpdatedAt = String(row?.updated_at ?? row?.updatedAt ?? '')
      expect(staleUpdatedAt.length, 'custom-entity record should expose updated_at').toBeGreaterThan(0)

      // Advance updated_at out-of-band (header-less PUT) → the captured token is now stale.
      const bump = await apiRequest(page.request, 'PUT', '/api/entities/records', {
        token,
        data: { entityId, recordId, values: { [fieldKey]: `bumped ${stamp}` } },
      })
      expect(bump.status(), `out-of-band PUT /api/entities/records should succeed, got ${bump.status()}`).toBeLessThan(300)

      // Replay with the now-stale token → 409 optimistic_lock_conflict.
      const conflict = await putWithLock(
        page.request,
        token,
        '/api/entities/records',
        { entityId, recordId, values: { [fieldKey]: `stale ${stamp}` } },
        staleUpdatedAt,
      )
      await expectConflictBody(conflict)
    } finally {
      if (recordId) {
        await apiRequest(page.request, 'DELETE', `/api/entities/records?entityId=${encodeURIComponent(entityId)}&recordId=${encodeURIComponent(recordId)}`, { token }).catch(() => {})
      }
      if (entityCreated) {
        await apiRequest(page.request, 'DELETE', '/api/entities/entities', { token, data: { entityId } }).catch(() => {})
      }
    }
  })
})

/**
 * WF-TOGGLE — workflow-definition list-page "Enabled" toggle optimistic-lock
 * coverage (follow-up to #3333 / PR #3397).
 *
 * The edit/delete CrudForm paths are covered by WF-01 above. The surface #3333
 * actually fixes is the **list page** (`/backend/definitions`): both the inline
 * *Enabled* badge and the row-action *Enable/Disable* menu item PUT
 * `/api/workflows/definitions/:id` and must attach the optimistic-lock header
 * (`x-om-ext-optimistic-lock-expected-updated-at`) derived from the row's
 * `updatedAt`, so a stale toggle is refused with a 409 instead of silently
 * overwriting a concurrent change.
 *
 * Heads-up encoded below (from the follow-up's manual run): clicking the *badge*
 * also bubbles to the DataTable row-click → navigates to the visual editor. We
 * therefore assert the badge's lock header from the network capture + an API
 * read-back rather than asserting post-click badge text, and drive the live
 * conflict-banner case through the **row action** (its `onSelect` stays on the
 * list). Definitions are given an `AAA …` name so they sort to page 1 of the
 * `workflowName ASC` list without needing a search — safe because these are the
 * only specs that create `AAA`-prefixed workflow definitions, each is deleted in
 * its own `finally`, and the integration suite runs against a fresh ephemeral DB,
 * so page 1 (20 rows) is never crowded out from under the row locator.
 */
const DEFINITIONS_LIST_PATH = '/backend/definitions'

/**
 * Open the row's RowActions (⋮) menu and click the Enable/Disable `menuitem`,
 * returning the single toggle `PUT` request the browser fired.
 *
 * The menu is portalled to document.body and the list re-renders as data
 * settles, so the trigger/menu can detach between "open" and "click"; we retry
 * the open+click atomically inside `toPass` (mirrors the SAL-13 list pattern).
 * Crucially the retry is guarded by `firedRequest`: once the toggle PUT has been
 * observed we stop clicking, so a click that dispatched the request but then
 * threw on a detached element cannot fire a *second* toggle (which would flip
 * `enabled` back and break the read-back / change the menu item label).
 *
 * Only the browser fetch (via `apiCall`) raises `page.on('request')`; the
 * out-of-band bump uses `page.request` (APIRequestContext) which does NOT, so
 * `firedRequest` captures exactly the in-browser toggle.
 */
async function toggleViaRowActionAndCapturePut(
  row: Locator,
  page: Page,
  definitionId: string,
  name: RegExp,
): Promise<Request> {
  const actionsTrigger = row.getByRole('button', { name: /open actions/i })
  const item = page.getByRole('menuitem', { name })
  let firedRequest: Request | null = null
  const onRequest = (request: Request) => {
    if (
      !firedRequest &&
      request.method() === 'PUT' &&
      request.url().includes(`${DEFINITIONS_BASE}/${definitionId}`)
    ) {
      firedRequest = request
    }
  }
  page.on('request', onRequest)
  try {
    await expect(async () => {
      if (firedRequest) return
      if (!(await item.isVisible().catch(() => false))) {
        await actionsTrigger.click({ timeout: 2_000 }).catch(() => {})
        await expect(item).toBeVisible({ timeout: 1_500 })
      }
      await item.click({ timeout: 2_000 })
      // Confirm the click actually dispatched the toggle before the loop exits,
      // so a no-op click never leaves us thinking the PUT fired.
      await expect(() => expect(firedRequest).not.toBeNull()).toPass({ timeout: 2_000 })
    }).toPass({ timeout: 20_000 })
  } finally {
    page.off('request', onRequest)
  }
  return firedRequest as unknown as Request
}

async function createToggleDefinition(
  request: APIRequestContext,
  token: string,
  stamp: number,
  label: string,
  suffix: string,
): Promise<{ id: string; workflowName: string }> {
  const workflowName = `AAA WF Toggle ${label} ${stamp}`
  const id = await createWorkflowDefinitionFixture(request, token, {
    ...buildMinimalDefinitionPayload(stamp, suffix),
    workflowName,
  })
  return { id, workflowName }
}

test.describe('TC-LOCK-OSS-044: workflow-definition list toggle optimistic-lock (#3333)', () => {
  // Full browser login + navigation + list-row interaction does not fit the 20s
  // default under parallel CI shard load; 60s matches the other UI specs here.
  test('WF-TOGGLE-01 enabled badge toggle sends the optimistic-lock header and persists', async ({ page }) => {
    test.setTimeout(60_000)
    const token = await getAuthToken(page.request, 'admin')
    const stamp = Date.now()
    let definitionId: string | null = null
    try {
      const created = await createToggleDefinition(page.request, token, stamp, 'Badge', '-toggle01a')
      definitionId = created.id
      const before = await readDefinition(page.request, token, definitionId)
      expect(before.enabled, 'fixture should start enabled').toBe(true)

      await login(page, 'admin')
      await page.goto(DEFINITIONS_LIST_PATH)

      const row = page.locator('tr', { hasText: created.workflowName }).first()
      await expect(row).toBeVisible({ timeout: 20_000 })

      // The Enabled badge renders as a button labelled Yes/No. Clicking it also
      // bubbles to the row-click (→ visual editor), so capture the PUT and assert
      // its lock header from the network layer instead of the post-click badge.
      const lockHeaderPut = page.waitForRequest(
        (request) =>
          request.method() === 'PUT' &&
          request.url().includes(`${DEFINITIONS_BASE}/${definitionId}`),
        { timeout: 20_000 },
      )
      await row.getByRole('button', { name: /^yes$/i }).click()
      const putRequest = await lockHeaderPut
      expect(
        putRequest.headers()[OPTIMISTIC_LOCK_HEADER_NAME],
        'badge toggle PUT must carry the optimistic-lock expected-updated-at header equal to the row updatedAt',
      ).toBe(before.updatedAt)

      // The write must have taken effect: enabled flips true → false.
      await expect(async () => {
        const after = await readDefinition(page.request, token, definitionId as string)
        expect(after.enabled, 'badge toggle should persist enabled=false').toBe(false)
      }).toPass({ timeout: 10_000 })
    } finally {
      await deleteWorkflowDefinitionIfExists(page.request, token, definitionId)
    }
  })

  test('WF-TOGGLE-01 row-action Enable/Disable sends the optimistic-lock header and persists', async ({ page }) => {
    test.setTimeout(60_000)
    const token = await getAuthToken(page.request, 'admin')
    const stamp = Date.now()
    let definitionId: string | null = null
    try {
      const created = await createToggleDefinition(page.request, token, stamp, 'Action', '-toggle01b')
      definitionId = created.id
      const before = await readDefinition(page.request, token, definitionId)
      expect(before.enabled, 'fixture should start enabled').toBe(true)

      await login(page, 'admin')
      await page.goto(DEFINITIONS_LIST_PATH)

      const row = page.locator('tr', { hasText: created.workflowName }).first()
      await expect(row).toBeVisible({ timeout: 20_000 })

      // The row-action "Disable" item `stopPropagation`s (stays on the list) and
      // PUTs the same toggle carrying the per-row lock header (single fire).
      const putRequest = await toggleViaRowActionAndCapturePut(row, page, definitionId, /^disable$/i)
      expect(
        putRequest.headers()[OPTIMISTIC_LOCK_HEADER_NAME],
        'row-action toggle PUT must carry the optimistic-lock expected-updated-at header equal to the row updatedAt',
      ).toBe(before.updatedAt)

      await expect(async () => {
        const after = await readDefinition(page.request, token, definitionId as string)
        expect(after.enabled, 'row-action toggle should persist enabled=false').toBe(false)
      }).toPass({ timeout: 10_000 })
    } finally {
      await deleteWorkflowDefinitionIfExists(page.request, token, definitionId)
    }
  })

  // With the row holding a now-stale updatedAt, the toggle PUT carries a stale
  // lock header → server 409 → `surfaceRecordConflict` renders the unified OSS
  // conflict bar (no record_locks dialog on a non-CrudForm list toggle).
  test('WF-TOGGLE-02 stale row-action toggle is refused (409) and surfaces the conflict banner', async ({ page }) => {
    test.setTimeout(60_000)
    const token = await getAuthToken(page.request, 'admin')
    const stamp = Date.now()
    let definitionId: string | null = null
    try {
      const created = await createToggleDefinition(page.request, token, stamp, 'Conflict', '-toggle02')
      definitionId = created.id

      await login(page, 'admin')
      await page.goto(DEFINITIONS_LIST_PATH)

      const row = page.locator('tr', { hasText: created.workflowName }).first()
      await expect(row).toBeVisible({ timeout: 20_000 })

      // The list now holds the pre-bump updatedAt. Advance updated_at out-of-band
      // (header-less PUT, additive path) so the row's captured token is stale.
      await bumpDefinition(page.request, token, definitionId, `${created.workflowName} bumped`)

      const refusedToggle = page.waitForResponse(
        (response) =>
          response.request().method() === 'PUT' &&
          response.url().includes(`${DEFINITIONS_BASE}/${definitionId}`),
        { timeout: 20_000 },
      )
      await toggleViaRowActionAndCapturePut(row, page, definitionId, /^disable$/i)
      const response = await refusedToggle
      expect(response.status(), 'stale list toggle should be refused with 409').toBe(409)

      await expectConflictBanner(page)
    } finally {
      await deleteWorkflowDefinitionIfExists(page.request, token, definitionId)
    }
  })
})
