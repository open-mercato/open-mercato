import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createCustomerUserFixture,
  deleteCustomerUserFixture,
  portalLogin,
} from '@open-mercato/core/helpers/integration/customerAccountsFixtures'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  AUTOSAVE_MIN_INTERVAL_MS,
  createPublishedFormFixture,
  deleteFormIfExists,
  listFormSubmissions,
} from '@open-mercato/core/helpers/integration/formsFixtures'
import { fillControlledInput } from '@open-mercato/core/helpers/integration/ui'

/**
 * TC-FORMS-PORTAL-002: a signed-in customer can fill and submit the form in the
 * browser, and the answer reaches the admin inbox.
 *
 * The portal catch-all supplies route parameters through the component's
 * `params` prop. The field is located by its observed textbox role and accessible
 * name. The wait before advancing is not flake
 * padding — `SubmissionService.save()` throttles saves to one per
 * `FORMS_AUTOSAVE_INTERVAL_MS / 2` (5s) measured from the revision `start` wrote
 * at page load, and the runner flushes dirty fields as part of `submit()`.
 * Clicking through faster than that floor makes the flush answer 429, which the
 * runner swallows into its save indicator; the submit then succeeds against
 * revision 1 and the typed answer is silently lost.
 */
test.describe('TC-FORMS-PORTAL-002: signed-in customer submits the portal form', () => {
  test('renders the published form, submits it, and the answer lands in the admin inbox', async ({ page, request }) => {
    test.setTimeout(180_000)

    const stamp = `${Date.now()}-${randomUUID().slice(0, 8)}`
    const answer = `QA PORTAL002 ${stamp}`

    let adminToken: string | null = null
    let formId: string | null = null
    let customerId: string | null = null

    try {
      adminToken = await getAuthToken(request, 'admin')
      const { tenantId, organizationId } = getTokenContext(adminToken)

      const orgRes = await apiRequest(
        request,
        'GET',
        `/api/directory/organizations?view=manage&ids=${encodeURIComponent(organizationId)}&tenantId=${encodeURIComponent(tenantId)}`,
        { token: adminToken },
      )
      const orgBody = await readJsonSafe<{ items?: Array<{ slug?: string | null }> }>(orgRes)
      const orgSlug = orgBody?.items?.[0]?.slug ?? null
      expect(orgSlug, 'the organization should expose a portal slug').toBeTruthy()

      const published = await createPublishedFormFixture(request, adminToken, { name: `QA PORTAL002 ${stamp}` })
      formId = published.formId

      const customer = await createCustomerUserFixture(request, adminToken, {
        email: `qa-forms-portal002-${stamp}@test.local`,
        displayName: `QA Portal002 ${stamp}`,
      })
      customerId = customer.id

      const session = await portalLogin(request, {
        email: customer.email,
        password: customer.password,
        tenantId,
      })

      const baseUrl = process.env.BASE_URL || 'http://localhost:3000'
      await page.context().addCookies([
        { name: 'customer_auth_token', value: session.authToken, url: baseUrl, sameSite: 'Lax' },
        { name: 'customer_session_token', value: session.sessionToken, url: baseUrl, sameSite: 'Lax' },
      ])

      await page.goto(`/${orgSlug}/portal/forms/${published.formKey}`, { waitUntil: 'domcontentloaded' })

      // The signed-in customer is NOT bounced to the login.
      expect(page.url(), 'the signed-in customer stays on the form route').toContain(
        `/portal/forms/${published.formKey}`,
      )
      await expect(
        page.getByRole('navigation', { name: 'Portal navigation' }),
        'the form uses the parent portal shell instead of rendering nested portal chrome',
      ).toHaveCount(1)

      const nameField = page.getByRole('textbox', { name: 'Full name', exact: true })
      await expect(nameField, 'the schema field renders with its x-om-label as the accessible name').toBeVisible({
        timeout: 60_000,
      })
      await fillControlledInput(nameField, answer)
      await expect(nameField, 'the typed value is held by the controlled input').toHaveValue(answer)

      // Let the server-side autosave floor elapse so the submit-time flush lands.
      await page.waitForTimeout(AUTOSAVE_MIN_INTERVAL_MS + 800)

      await page.getByRole('button', { name: 'Review answers' }).click()
      await expect(
        page.getByRole('button', { name: 'Submit', exact: true }),
        'the review step offers the submit action',
      ).toBeVisible({ timeout: 15_000 })
      await page.getByRole('button', { name: 'Submit', exact: true }).click()

      await expect(
        page.getByText('Thank you!'),
        'submitting reaches the completion screen',
      ).toBeVisible({ timeout: 30_000 })

      // The UI claim is only worth as much as the server state behind it.
      const inboxRes = await listFormSubmissions(request, adminToken, formId, { pageSize: 100 })
      expect(inboxRes.status(), 'the admin inbox read should succeed').toBe(200)
      const inbox = await readJsonSafe<{ items?: Array<{ id: string; status: string }>; total?: number }>(inboxRes)
      expect(inbox?.total, 'the portal run produced exactly one submission').toBe(1)
      const row = inbox!.items![0]
      expect(row.status, 'the admin inbox sees it as submitted').toBe('submitted')

      const detailRes = await apiRequest(request, 'GET', `/api/forms/submissions/${row.id}`, {
        token: adminToken,
      })
      expect(detailRes.status(), 'the admin detail read should succeed').toBe(200)
      const detail = await readJsonSafe<{ decoded_data?: Record<string, unknown> }>(detailRes)
      expect(
        detail?.decoded_data?.full_name,
        'the value typed in the browser is the value stored server-side',
      ).toBe(answer)
    } finally {
      await deleteCustomerUserFixture(request, adminToken, customerId)
      await deleteFormIfExists(request, adminToken, formId)
    }
  })
})
