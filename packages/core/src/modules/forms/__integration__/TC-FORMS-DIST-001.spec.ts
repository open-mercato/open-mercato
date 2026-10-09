import { expect, test } from '@playwright/test'
import {
  apiRequest,
  getAuthToken,
  withCredentialIsolatedRequest,
} from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createDistributionFixture,
  createPublishedFormFixture,
  deleteDistributionIfExists,
  deleteFormIfExists,
} from '@open-mercato/core/helpers/integration/formsFixtures'

/**
 * TC-FORMS-DIST-001: an open distribution mints a public slug that resolves
 * anonymously.
 *
 * The slug is the bearer of access for the whole open-link flow, so the two
 * halves that matter are that `POST` mints one and that an anonymous caller can
 * redeem it. The anonymous half issues from a credential-isolated context — with
 * the shared jar, "no auth needed" would be proven by a replayed admin session.
 */
test.describe('TC-FORMS-DIST-001: open distribution creation and public resolution', () => {
  test('mints a public slug, lists the distribution, and serves it anonymously', async ({ request }) => {
    test.slow()

    let adminToken: string | null = null
    let formId: string | null = null
    let distributionId: string | null = null

    try {
      adminToken = await getAuthToken(request, 'admin')
      const published = await createPublishedFormFixture(request, adminToken, { name: 'QA DIST001' })
      formId = published.formId

      const distribution = await createDistributionFixture(request, adminToken, formId, {
        mode: 'open',
        title: 'QA DIST001 public link',
        defaultLocale: 'en',
      })
      distributionId = distribution.id
      expect(distribution.publicSlug, 'an open distribution must mint a public slug').toBeTruthy()

      const detail = await apiRequest(request, 'GET', `/api/forms/distributions/${distributionId}`, {
        token: adminToken,
      })
      expect(detail.status(), 'the distribution detail read should return 200').toBe(200)
      const detailBody = await readJsonSafe<{
        formId?: string
        mode?: string
        status?: string
        publicSlug?: string | null
        requireCustomerAuth?: boolean
        responseCount?: number
        maxResponses?: number | null
      }>(detail)
      expect(detailBody?.formId, 'the distribution belongs to the form').toBe(formId)
      expect(detailBody?.mode).toBe('open')
      expect(detailBody?.status, 'a fresh distribution is active').toBe('active')
      expect(detailBody?.publicSlug, 'the detail read exposes the slug').toBe(distribution.publicSlug)
      expect(detailBody?.requireCustomerAuth, 'an open distribution defaults to anonymous').toBe(false)
      expect(detailBody?.responseCount, 'no responses yet').toBe(0)
      expect(detailBody?.maxResponses, 'no cap was requested').toBeNull()

      const listRes = await apiRequest(request, 'GET', `/api/forms/${formId}/distributions`, {
        token: adminToken,
      })
      expect(listRes.status(), 'the per-form distribution list should return 200').toBe(200)
      const list = await readJsonSafe<{ items?: Array<{ id: string }>; total?: number }>(listRes)
      expect(list?.total, 'the form has exactly one distribution').toBe(1)
      expect((list?.items ?? []).map((item) => item.id), 'the list contains our distribution').toEqual([distributionId])

      await withCredentialIsolatedRequest(async (anonymous) => {
        const publicRes = await anonymous.get(`/api/forms/public/distributions/${distribution.publicSlug}`)
        expect(
          publicRes.status(),
          `the public slug should resolve anonymously (got ${publicRes.status()}: ${await publicRes.text()})`,
        ).toBe(200)
        const context = await readJsonSafe<{
          distribution_id?: string
          form?: { key?: string }
          schema?: Record<string, unknown>
          ui_schema?: Record<string, unknown>
          fieldIndex?: Record<string, unknown>
          default_locale?: string
          embed?: unknown
        }>(publicRes)
        expect(context?.distribution_id, 'the public context names the distribution').toBe(distributionId)
        expect(context?.form?.key, 'the public context names the form key').toBe(published.formKey)
        expect(Object.keys(context?.fieldIndex ?? {}), 'the field index carries the schema fields').toContain('full_name')
        expect(context?.default_locale, 'the public context echoes the distribution locale').toBe('en')
        expect(context?.embed, 'embedding was not enabled, so there is no embed hint').toBeNull()

        // An unknown slug must not resolve, and must not 500.
        const unknownRes = await anonymous.get('/api/forms/public/distributions/qa-dist001-not-a-real-slug')
        expect(unknownRes.status(), 'an unknown slug is a 404').toBe(404)
        expect((await readJsonSafe<{ error?: string }>(unknownRes))?.error).toBe('NOT_FOUND')
      })
    } finally {
      await deleteDistributionIfExists(request, adminToken, distributionId)
      await deleteFormIfExists(request, adminToken, formId)
    }
  })
})
