/**
 * TC-UMES-006: SPEC-042 + SPEC-043 showcase
 *
 * Covers:
 * - Multi-ID query parameter on CRUD list route (`ids`)
 * - Reactive notification handlers dispatching without opening notification panel
 */
import { test, expect } from '@playwright/test'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'
import { getAuthToken, apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { createPersonFixture, deleteEntityIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures'

test.describe('TC-UMES-006: SPEC-042 + SPEC-043', () => {
  let adminToken = ''

  test.beforeAll(async ({ request }) => {
    adminToken = await getAuthToken(request, 'admin')
  })

  test('multi-id probe and reactive notification handler work on next phases page', async ({ page, request }) => {
    let personIdA: string | null = null
    let personIdB: string | null = null

    try {
      personIdA = await createPersonFixture(request, adminToken, {
        firstName: `QA-UMES-42A-${Date.now()}`,
        lastName: 'MultiId',
        displayName: `QA UMES 42 A ${Date.now()}`,
      })
      personIdB = await createPersonFixture(request, adminToken, {
        firstName: `QA-UMES-42B-${Date.now()}`,
        lastName: 'MultiId',
        displayName: `QA UMES 42 B ${Date.now()}`,
      })

      await login(page, 'admin')
      await page.goto('/backend/umes-next-phases')
      await page.waitForLoadState('domcontentloaded')

      const idsInput = page.getByTestId('phase-next-ids-input')
      await idsInput.fill(`${personIdA},${personIdB}`)
      await page.getByTestId('phase-next-run-probe').click()

      await expect(page.getByTestId('phase-next-probe-status')).toContainText('probeStatus=ok', { timeout: 15_000 })
      await expect(page.getByTestId('phase-next-probe-status')).toContainText('"allHaveExampleNamespace":true')

      const filtered = await apiRequest(
        request,
        'GET',
        `/api/customers/people?ids=${encodeURIComponent(`${personIdA},${personIdB}`)}&pageSize=50`,
        { token: adminToken },
      )
      expect(filtered.ok()).toBeTruthy()
      const filteredBody = await filtered.json()
      const filteredItems = Array.isArray(filteredBody?.items) ? filteredBody.items : []
      const filteredIds = filteredItems.map((item: { id?: string }) => item.id).filter(Boolean)
      expect(filteredIds).toContain(personIdA)
      expect(filteredIds).toContain(personIdB)

      await page.getByTestId('phase-next-emit-notification').click()
      await expect(page.getByTestId('phase-next-emit-status')).toContainText('emitStatus=ok', { timeout: 10_000 })

      await expect(page.getByTestId('phase-next-handled-notifications')).toContainText('[', { timeout: 15_000 })
      await expect(page.getByTestId('phase-next-handled-notifications')).not.toContainText('[]', { timeout: 15_000 })
    } finally {
      await deleteEntityIfExists(request, adminToken, '/api/customers/people', personIdA)
      await deleteEntityIfExists(request, adminToken, '/api/customers/people', personIdB)
    }
  })
})

test.describe('TC-UMES-006: transformFormData applyToForm opt-in', () => {
  test('TC-UMES-E20: default path — transformed payload does not update visible form fields', async ({ page }) => {
    await login(page, 'admin')
    await page.goto('/backend/umes-handlers')
    await page.waitForLoadState('domcontentloaded')
    await expect(page.getByTestId('widget-transform-form-data')).toBeVisible()

    const titleInput = page.locator('[data-crud-field-id="title"] input').first()
    await titleInput.fill('  spaces around  ')
    await page.keyboard.press('Tab')

    await page.locator('form button[type="submit"]').first().click()

    await expect
      .poll(async () => page.getByTestId('phase-c-submit-result').textContent(), { timeout: 8_000 })
      .toContain('"title":"spaces around"')

    await expect(titleInput).toHaveValue('  spaces around  ')
  })

  test('TC-UMES-E21: opt-in path — applyToForm: true reflects transformed values back into visible form fields', async ({ page }) => {
    await login(page, 'admin')
    await page.goto('/backend/umes-handlers')
    await page.waitForLoadState('domcontentloaded')
    await expect(page.getByTestId('widget-transform-form-data')).toBeVisible()

    const noteInput = page.locator('[data-crud-field-id="note"] input').first()
    await noteInput.fill('transform: make me uppercase')
    await page.keyboard.press('Tab')

    await page.locator('form button[type="submit"]').first().click()

    await expect
      .poll(async () => page.getByTestId('phase-c-submit-result').textContent(), { timeout: 8_000 })
      .toContain('"note":"MAKE ME UPPERCASE"')

    await expect(noteInput).toHaveValue('MAKE ME UPPERCASE')
  })
})
