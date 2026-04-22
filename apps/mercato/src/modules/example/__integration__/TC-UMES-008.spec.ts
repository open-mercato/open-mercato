/**
 * TC-UMES-008: SPEC-042 + SPEC-043 showcase
 *
 * Covers:
 * - Multi-ID query parameter on CRUD list route (`ids`)
 * - Reactive notification handlers dispatching without opening notification panel
 */
import { test, expect } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { getAuthToken, apiRequest } from '@open-mercato/core/helpers/integration/api'
import { createPersonFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'

test.describe('TC-UMES-008: SPEC-042 + SPEC-043', () => {
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
