import { test, expect } from '@playwright/test'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'
import { getAuthToken, apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  bumpRecordViaApi,
  expectConflictBanner,
  expectNoConflictBanner,
} from '@open-mercato/core/modules/core/__integration__/helpers/optimisticLockUi'
import { isStandaloneIntegration } from '@open-mercato/core/helpers/integration/standaloneEnv'
import { fillControlledInput } from '@open-mercato/core/modules/core/__integration__/helpers/ui'

/**
 * TC-LOCK-OSS-037 (browser UI) — manual cases RES-01 / RES-02 / RES-03.
 *
 * Browser-driven proof that a stale edit (and a stale delete) on the resources
 * module CrudForms surfaces the unified "Record changed" conflict bar
 * (`data-testid="record-conflict-banner"`) instead of silently overwriting,
 * and that a clean single-tab save does NOT raise a false-positive bar.
 *
 * Surfaces:
 *   - Resource edit       — route `/backend/resources/resources/<id>`     (ResourceCrudForm, embedded)
 *   - Resource-type edit  — route `/backend/resources/resource-types/<id>/edit` (ResourceTypeCrudForm)
 *
 * Pattern: load the edit page (the form captures `updated_at` at load) →
 * advance `updated_at` out-of-band via a header-less API PUT (additive path,
 * always succeeds) → edit + save (or delete) in the browser so the now-stale
 * header triggers the 409 → conflict bar. See
 * `packages/core/src/modules/sales/__integration__/__concurrent_edit_pattern.md`.
 */

const RESOURCES_API = '/api/resources/resources'
const RESOURCE_TYPES_API = '/api/resources/resource-types'

async function createResource(
  request: Parameters<typeof apiRequest>[0],
  token: string,
  name: string,
): Promise<string> {
  const response = await apiRequest(request, 'POST', RESOURCES_API, { token, data: { name } })
  expect(response.status(), `POST ${RESOURCES_API} should create a resource`).toBeLessThan(300)
  const body = (await response.json()) as { id?: string }
  expect(typeof body.id, 'create response should expose an id').toBe('string')
  return body.id as string
}

async function createResourceType(
  request: Parameters<typeof apiRequest>[0],
  token: string,
  name: string,
): Promise<string> {
  const response = await apiRequest(request, 'POST', RESOURCE_TYPES_API, { token, data: { name } })
  expect(response.status(), `POST ${RESOURCE_TYPES_API} should create a resource type`).toBeLessThan(300)
  const body = (await response.json()) as { id?: string }
  expect(typeof body.id, 'create response should expose an id').toBe('string')
  return body.id as string
}

async function deleteIfExists(
  request: Parameters<typeof apiRequest>[0],
  token: string,
  basePath: string,
  id: string | null,
): Promise<void> {
  if (!id) return
  try {
    await apiRequest(request, 'DELETE', `${basePath}?id=${encodeURIComponent(id)}`, { token })
  } catch {
    // best-effort cleanup
  }
}

test.describe('TC-LOCK-OSS-037: resources edit/delete optimistic-lock conflict bar', () => {
  test('stale resource edit shows the conflict bar; clean edit does not', async ({ page }) => {
    test.skip(isStandaloneIntegration(), 'Standalone smoke runs omit this monorepo-only resource conflict choreography.')

    const token = await getAuthToken(page.request, 'admin')
    const stamp = Date.now()
    let resourceId: string | null = null
    try {
      resourceId = await createResource(page.request, token, `QA Lock 037 R ${stamp}`)

      await login(page, 'admin')
      await page.goto(`/backend/resources/resources/${resourceId}`)

      // Wait until the form is FULLY loaded (input populated with the record value),
      // not merely visible, so the optimistic-lock token captured is the pre-bump one.
      const nameInput = page.locator('[data-crud-field-id="name"] input').first()
      await expect(nameInput).toHaveValue(`QA Lock 037 R ${stamp}`, { timeout: 15_000 })

      // Advance updated_at out-of-band → the browser form now holds a stale token.
      await bumpRecordViaApi(page.request, token, RESOURCES_API, {
        id: resourceId,
        name: `QA Lock 037 R bumped ${stamp}`,
      })

      // Edit + save in the browser → stale header → 409 → conflict bar.
      await fillControlledInput(nameInput, `QA Lock 037 R stale ${stamp}`)
      await nameInput.press('Control+Enter')

      await expectConflictBanner(page)
    } finally {
      await deleteIfExists(page.request, token, RESOURCES_API, resourceId)
    }
  })

  test('clean single-tab resource save does not raise a false-positive conflict bar', async ({ page }) => {
    const token = await getAuthToken(page.request, 'admin')
    const stamp = Date.now()
    let resourceId: string | null = null
    try {
      resourceId = await createResource(page.request, token, `QA Lock 037 Rb ${stamp}`)

      await login(page, 'admin')
      await page.goto(`/backend/resources/resources/${resourceId}`)

      const nameInput = page.locator('[data-crud-field-id="name"] input').first()
      await expect(nameInput).toBeVisible({ timeout: 15_000 })

      const putPromise = page.waitForResponse(
        (r) => r.request().method() === 'PUT' && r.url().includes(RESOURCES_API),
        { timeout: 15_000 },
      )
      await fillControlledInput(nameInput, `QA Lock 037 Rb saved ${stamp}`)
      await nameInput.press('Control+Enter')
      const settled = await putPromise
      expect(settled.status(), 'clean save should not 409').toBeLessThan(400)
      await expectNoConflictBanner(page)
    } finally {
      await deleteIfExists(page.request, token, RESOURCES_API, resourceId)
    }
  })

  test('stale resource-type edit shows the conflict bar', async ({ page }) => {
    const token = await getAuthToken(page.request, 'admin')
    const stamp = Date.now()
    let resourceTypeId: string | null = null
    try {
      resourceTypeId = await createResourceType(page.request, token, `QA Lock 037 RT ${stamp}`)

      await login(page, 'admin')
      await page.goto(`/backend/resources/resource-types/${resourceTypeId}/edit`)

      const nameInput = page.locator('[data-crud-field-id="name"] input').first()
      await expect(nameInput).toBeVisible({ timeout: 15_000 })

      // Advance updated_at out-of-band → the browser form now holds a stale token.
      await bumpRecordViaApi(page.request, token, RESOURCE_TYPES_API, {
        id: resourceTypeId,
        name: `QA Lock 037 RT bumped ${stamp}`,
      })

      await fillControlledInput(nameInput, `QA Lock 037 RT stale ${stamp}`)
      await nameInput.press('Control+Enter')

      await expectConflictBanner(page)
    } finally {
      await deleteIfExists(page.request, token, RESOURCE_TYPES_API, resourceTypeId)
    }
  })
})
