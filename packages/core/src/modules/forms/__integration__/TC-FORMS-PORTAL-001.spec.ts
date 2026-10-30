import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createPublishedFormFixture,
  deleteFormIfExists,
} from '@open-mercato/core/helpers/integration/formsFixtures'

/**
 * TC-FORMS-PORTAL-001: the portal form page is not reachable without a customer
 * session.
 *
 * `frontend/[orgSlug]/portal/forms/[key]/page.meta.ts` declares
 * `requireCustomerAuth: true`, and the `(frontend)` catch-all is what enforces it
 * server-side. The page itself is a client component that would happily mount
 * with `user === undefined`, so the guard is the only thing standing between an
 * anonymous visitor and the form shell — a regression in the catch-all's route
 * matching would not show up anywhere else.
 *
 * The assertion is on the landing URL rather than on absent content: a page that
 * rendered the shell and then client-side redirected would still "not show the
 * form", while having briefly served it.
 */
test.describe('TC-FORMS-PORTAL-001: portal form page requires a customer session', () => {
  test('redirects an anonymous visitor to the portal login', async ({ page, request }) => {
    test.slow()

    const stamp = `${Date.now()}-${randomUUID().slice(0, 8)}`
    let adminToken: string | null = null
    let formId: string | null = null

    try {
      adminToken = await getAuthToken(request, 'admin')
      const { tenantId, organizationId } = getTokenContext(adminToken)

      const orgRes = await apiRequest(
        request,
        'GET',
        `/api/directory/organizations?view=manage&ids=${encodeURIComponent(organizationId)}&tenantId=${encodeURIComponent(tenantId)}`,
        { token: adminToken },
      )
      expect(orgRes.ok(), 'the organization lookup should succeed').toBeTruthy()
      const orgBody = await readJsonSafe<{ items?: Array<{ slug?: string | null }> }>(orgRes)
      const orgSlug = orgBody?.items?.[0]?.slug ?? null
      expect(orgSlug, 'the organization should expose a portal slug').toBeTruthy()

      const published = await createPublishedFormFixture(request, adminToken, { name: `QA PORTAL001 ${stamp}` })
      formId = published.formId

      // No portal cookies on this browser context at all.
      await page.context().clearCookies()
      await page.goto(`/${orgSlug}/portal/forms/${published.formKey}`, { waitUntil: 'domcontentloaded' })

      await page.waitForURL(new RegExp(`/${orgSlug}/portal/login`), { timeout: 15_000 })
      expect(page.url(), 'an anonymous visitor lands on the portal login').toContain(
        `/${orgSlug}/portal/login`,
      )
      expect(page.url(), 'the visitor is not left on the form route').not.toContain(
        `/portal/forms/${published.formKey}`,
      )

      // And the form itself was never painted.
      await expect(
        page.getByPlaceholder('Full name'),
        'the form field must not be rendered to an anonymous visitor',
      ).toHaveCount(0)
    } finally {
      await deleteFormIfExists(request, adminToken, formId)
    }
  })
})
