import { expect, test } from '@playwright/test'
import {
  getAuthToken,
  withCredentialIsolatedRequest,
} from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createDistributionFixture,
  createPublishedFormFixture,
  deleteDistributionIfExists,
  deleteFormIfExists,
  startPublicSubmission,
  uniqueClientIp,
} from '@open-mercato/core/helpers/integration/formsFixtures'

/**
 * TC-FORMS-DIST-003: a `requireCustomerAuth` distribution refuses to mint an
 * anonymous access token.
 *
 * 409 `CUSTOMER_AUTH_REQUIRED` is not a generic denial — it is the signal the
 * renderer uses to bounce the visitor to the portal login instead of showing an
 * error. The load-bearing assertion is the absence of `access_token`: a 409 that
 * still handed out a token would let an anonymous caller run a form its owner
 * marked as requiring a signed-in customer.
 */
test.describe('TC-FORMS-DIST-003: requireCustomerAuth distribution', () => {
  test('refuses an anonymous start with 409 and mints no access token', async ({ request }) => {
    test.slow()

    let adminToken: string | null = null
    let formId: string | null = null
    let distributionId: string | null = null

    try {
      adminToken = await getAuthToken(request, 'admin')
      const published = await createPublishedFormFixture(request, adminToken, { name: 'QA DIST003' })
      formId = published.formId

      const distribution = await createDistributionFixture(request, adminToken, formId, {
        mode: 'open',
        requireCustomerAuth: true,
      })
      distributionId = distribution.id
      const slug = distribution.publicSlug
      expect(slug, 'even an auth-gated distribution mints a slug').toBeTruthy()

      await withCredentialIsolatedRequest(async (anonymous) => {
        // The context read is still allowed — the renderer needs the schema to
        // draw the "please sign in" state — but it advertises the requirement.
        const contextRes = await anonymous.get(`/api/forms/public/distributions/${slug}`)
        expect(
          contextRes.status(),
          `the context read should still resolve (got ${contextRes.status()}: ${await contextRes.text()})`,
        ).toBe(200)
        const context = await readJsonSafe<{ requires_customer_auth?: boolean }>(contextRes)
        expect(
          context?.requires_customer_auth,
          'the public context advertises that a customer session is required',
        ).toBe(true)

        const startResult = await startPublicSubmission(anonymous, {
          slug: slug as string,
          clientIp: uniqueClientIp(),
        })
        expect(
          startResult.status,
          `the anonymous start must be 409 (got ${startResult.status}: ${JSON.stringify(startResult.body)})`,
        ).toBe(409)
        expect(startResult.body.error, 'the refusal names the customer-auth requirement').toBe(
          'CUSTOMER_AUTH_REQUIRED',
        )
        expect(
          startResult.body.access_token,
          'a customer-auth-gated distribution must never mint an anonymous access token',
        ).toBeUndefined()
        expect(startResult.body.submission, 'the refused start created no submission').toBeUndefined()
      })

      // Nothing was started against the form.
      const listRes = await request.get(`/api/forms/${formId}/submissions`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      })
      expect(listRes.status(), 'the admin inbox read should succeed').toBe(200)
      const list = await readJsonSafe<{ total?: number }>(listRes)
      expect(list?.total, 'the refused anonymous start left no submission behind').toBe(0)
    } finally {
      await deleteDistributionIfExists(request, adminToken, distributionId)
      await deleteFormIfExists(request, adminToken, formId)
    }
  })
})
