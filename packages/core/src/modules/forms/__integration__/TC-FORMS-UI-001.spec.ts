import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import {
  createFormFixture,
  deleteFormIfExists,
} from '@open-mercato/core/helpers/integration/formsFixtures'

/**
 * TC-FORMS-UI-001: the backend forms list renders real data and is feature-gated.
 *
 * `backend/forms/page.meta.ts` declares `requireFeatures: ['forms.view']`, and
 * the backend shell enforces it. The gate half is why this is P0: the list is the
 * entry point to every other forms screen, and a page that rendered for a user
 * without the feature would expose form names — tenant data — before any API call
 * got a chance to 403.
 *
 * The unauthorized user is the seeded `employee`, not a throwaway role: `setup.ts`
 * grants the six forms features to `admin` only, so `employee` is the real
 * out-of-the-box unauthorized staff account (verified independently — its
 * `GET /api/forms` answers 403). Using it also means the gate is tested on the
 * same ACL shape a fresh tenant actually ships with.
 *
 * The render half asserts an API-created form appears by name, so it proves the
 * page is bound to `/api/forms` rather than merely mounting.
 */
test.describe('TC-FORMS-UI-001: backend forms list page', () => {
  test('lists an API-created form for an admin and shows nothing to an employee', async ({ page, request }) => {
    test.slow()

    const stamp = `${Date.now()}-${randomUUID().slice(0, 8)}`
    const formName = `QA UI001 ${stamp}`

    let adminToken: string | null = null
    let formId: string | null = null

    try {
      adminToken = await getAuthToken(request, 'admin')

      const form = await createFormFixture(request, adminToken, { name: formName })
      formId = form.id

      await login(page, 'admin')
      await page.goto('/backend/forms', { waitUntil: 'domcontentloaded' })

      await expect(
        page.getByRole('heading', { name: 'Forms' }).first(),
        'the forms list page renders its heading',
      ).toBeVisible({ timeout: 30_000 })

      // The row comes from `/api/forms`, so seeing it proves the binding.
      await expect(
        page.getByText(formName, { exact: false }).first(),
        'the API-created form appears in the list',
      ).toBeVisible({ timeout: 30_000 })
      await expect(
        page.getByText(form.key, { exact: false }).first(),
        'the list shows the form key alongside the name',
      ).toBeVisible({ timeout: 30_000 })

      // Sanity: the employee really is unauthorized at the API layer, so a clean
      // UI below is a gate and not an empty-data coincidence.
      const employeeToken = await getAuthToken(request, 'employee')
      const employeeApi = await apiRequest(request, 'GET', '/api/forms', { token: employeeToken })
      expect(employeeApi.status(), 'the employee role holds no forms feature').toBe(403)

      await page.context().clearCookies()
      await login(page, 'employee')
      await page.goto('/backend/forms', { waitUntil: 'domcontentloaded' })

      await expect(
        page.getByText(formName, { exact: false }),
        'a user without forms.view must never see a form name',
      ).toHaveCount(0)
      await expect(
        page.getByText(form.key, { exact: false }),
        'a user without forms.view must never see a form key either',
      ).toHaveCount(0)
    } finally {
      await deleteFormIfExists(request, adminToken, formId)
    }
  })
})
