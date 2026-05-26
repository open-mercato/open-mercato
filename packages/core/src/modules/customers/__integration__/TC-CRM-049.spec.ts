import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createCompanyFixture,
  createPersonFixture,
  deleteEntityIfExists,
} from '@open-mercato/core/helpers/integration/crmFixtures'

/**
 * TC-CRM-049: Numeric / JSON-primitive display names round-trip as strings (issue #1734).
 *
 * Before the encryption layer fix, display names that happened to be valid JSON
 * primitives (purely numeric like "123", "true", "null", "false") were
 * round-tripped through the tenant-data encryption pipeline as their parsed
 * type — `JSON.parse("123") === 123` (number) — which crashed the company
 * (and person) detail page at `displayName.trim()`.
 *
 * This test exercises the full create → fetch → render path for a few
 * adversarial display-name shapes and asserts that:
 *   1. the API GET response keeps the value as a string,
 *   2. the v2 detail page mounts without the runtime overlay, and
 *   3. the rendered header shows the entered text.
 */
test.describe('TC-CRM-049: numeric and JSON-primitive display names render safely', () => {
  const adversarialDisplayNames = ['123', 'true', 'null', 'false', '00042']

  for (const displayName of adversarialDisplayNames) {
    test(`company detail page renders for displayName "${displayName}"`, async ({ page, request }) => {
      test.slow()

      let token: string | null = null
      let companyId: string | null = null

      try {
        token = await getAuthToken(request, 'admin')
        companyId = await createCompanyFixture(
          request,
          token,
          `${displayName}-QA-CRM049-${Date.now()}-co`,
        )

        // Update so the actual display_name in storage equals the adversarial value.
        const updateResponse = await apiRequest(request, 'PUT', '/api/customers/companies', {
          token,
          data: { id: companyId, displayName },
        })
        expect(updateResponse.ok(), 'PUT companies should succeed for adversarial name').toBeTruthy()

        const detailResponse = await apiRequest(request, 'GET', `/api/customers/companies/${companyId}`, {
          token,
        })
        expect(detailResponse.ok(), 'GET company detail should succeed').toBeTruthy()
        const detailJson = await detailResponse.json()
        expect(typeof detailJson?.company?.displayName).toBe('string')
        expect(detailJson?.company?.displayName).toBe(displayName)

        await login(page, 'admin')
        const consoleErrors: string[] = []
        page.on('console', (msg) => {
          if (msg.type() === 'error') consoleErrors.push(msg.text())
        })
        const pageErrors: string[] = []
        page.on('pageerror', (err) => {
          pageErrors.push(err.message)
        })

        await page.goto(`/backend/customers/companies-v2/${companyId}`, {
          waitUntil: 'domcontentloaded',
        })
        // The Save button only renders once the detail loads successfully (no error overlay).
        await expect(page.getByRole('button', { name: /save/i }).first()).toBeVisible({
          timeout: 15_000,
        })

        // Header must show the literal adversarial text — nothing should have been coerced.
        await expect(page.getByText(displayName, { exact: true }).first()).toBeVisible({
          timeout: 5_000,
        })

        const trimErrors = [...consoleErrors, ...pageErrors].filter((line) =>
          /displayName\.trim is not a function|displayName.*trim/.test(line),
        )
        expect(trimErrors, 'no displayName.trim() runtime errors').toEqual([])
      } finally {
        await deleteEntityIfExists(request, token, '/api/customers/companies', companyId)
      }
    })
  }

  test('person detail page renders for numeric displayName', async ({ page, request }) => {
    test.slow()

    let token: string | null = null
    let personId: string | null = null
    const stamp = Date.now()
    const numericDisplayName = '777'

    try {
      token = await getAuthToken(request, 'admin')
      personId = await createPersonFixture(request, token, {
        firstName: 'QA',
        lastName: `TC049-${stamp}`,
        displayName: `placeholder-${stamp}`,
      })

      const updateResponse = await apiRequest(request, 'PUT', '/api/customers/people', {
        token,
        data: { id: personId, displayName: numericDisplayName },
      })
      expect(updateResponse.ok(), 'PUT people should succeed').toBeTruthy()

      const detailResponse = await apiRequest(request, 'GET', `/api/customers/people/${personId}`, {
        token,
      })
      expect(detailResponse.ok()).toBeTruthy()
      const detailJson = await detailResponse.json()
      expect(typeof detailJson?.person?.displayName).toBe('string')
      expect(detailJson?.person?.displayName).toBe(numericDisplayName)

      await login(page, 'admin')
      const pageErrors: string[] = []
      page.on('pageerror', (err) => {
        pageErrors.push(err.message)
      })
      await page.goto(`/backend/customers/people-v2/${personId}`, { waitUntil: 'domcontentloaded' })
      await expect(page.getByRole('button', { name: /save/i }).first()).toBeVisible({
        timeout: 15_000,
      })
      const trimErrors = pageErrors.filter((line) => /displayName\.trim/.test(line))
      expect(trimErrors).toEqual([])
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/people', personId)
    }
  })
})
