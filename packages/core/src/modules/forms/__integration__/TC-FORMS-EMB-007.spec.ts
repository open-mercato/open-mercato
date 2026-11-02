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
  type PublishedFormFixture,
} from '@open-mercato/core/helpers/integration/formsFixtures'

/**
 * TC-FORMS-EMB-007: the embed-policy endpoint returns the allowlist for an
 * embeddable distribution and fails closed for everything else.
 *
 * This endpoint decides which third-party origins may frame `/embed/:slug`, so
 * "fails closed" is the whole point: an unknown slug, a non-embeddable
 * distribution and a customer-auth-gated one must all answer
 * `frame-ancestors 'none'` — and, critically, must answer 200 rather than 500,
 * because a 5xx here is what a caller would have to interpret and could plausibly
 * mis-handle as "no policy, allow".
 *
 * `isEmbeddable` deliberately ignores the availability WINDOW (`opensAt` /
 * `closesAt` / the response cap) while still requiring `status === 'active'`, so
 * an expired-but-active distribution keeps its framing permission and the iframe
 * can load and render its own "unavailable" state. That distinction is asserted
 * below rather than assumed, because tightening it would silently break the
 * graceful-expiry path.
 */
test.describe('TC-FORMS-EMB-007: embed framing policy', () => {
  test('serves the allowlist when embeddable and frame-ancestors none otherwise', async ({ request }) => {
    test.setTimeout(150_000)

    let adminToken: string | null = null
    const forms: PublishedFormFixture[] = []
    const distributionIds: string[] = []

    try {
      adminToken = await getAuthToken(request, 'admin')

      const make = async (
        name: string,
        input: Parameters<typeof createDistributionFixture>[3],
      ) => {
        const published = await createPublishedFormFixture(request, adminToken as string, { name })
        forms.push(published)
        const distribution = await createDistributionFixture(
          request,
          adminToken as string,
          published.formId,
          input,
        )
        distributionIds.push(distribution.id)
        return distribution
      }

      const embeddable = await make('QA EMB007 embeddable', {
        mode: 'open',
        settings: {
          embed: { enabled: true, allowedDomains: ['https://www.acme.com'], autoResize: true },
        },
      })
      const notEmbeddable = await make('QA EMB007 plain', { mode: 'open' })
      const authGated = await make('QA EMB007 auth gated', {
        mode: 'open',
        requireCustomerAuth: true,
        settings: {
          embed: { enabled: true, allowedDomains: ['https://www.acme.com'], autoResize: true },
        },
      })
      const expired = await make('QA EMB007 expired', {
        mode: 'open',
        closesAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        settings: {
          embed: { enabled: true, allowedDomains: ['https://www.acme.com'], autoResize: true },
        },
      })

      await withCredentialIsolatedRequest(async (anonymous) => {
        const readPolicy = async (slug: string) => {
          const response = await anonymous.get(`/api/forms/public/distributions/${slug}/embed-policy`)
          const body = await readJsonSafe<{ frame_ancestors?: string; embeddable?: boolean }>(response)
          expect(
            response.status(),
            `embed-policy for ${slug} must answer 200, never a 5xx (got ${response.status()}: ${JSON.stringify(body)})`,
          ).toBe(200)
          return body
        }

        const allowed = await readPolicy(embeddable.publicSlug as string)
        expect(allowed?.embeddable, 'an opted-in open distribution is embeddable').toBe(true)
        expect(
          allowed?.frame_ancestors,
          'the directive names exactly the allowlisted origin',
        ).toBe('frame-ancestors https://www.acme.com')

        const plain = await readPolicy(notEmbeddable.publicSlug as string)
        expect(plain?.embeddable, 'a distribution that never opted in is not embeddable').toBe(false)
        expect(plain?.frame_ancestors, 'a non-embeddable distribution fails closed').toBe(
          "frame-ancestors 'none'",
        )

        const gated = await readPolicy(authGated.publicSlug as string)
        expect(
          gated?.embeddable,
          'requireCustomerAuth disqualifies a distribution from framing even when embed is enabled',
        ).toBe(false)
        expect(gated?.frame_ancestors, 'the auth-gated distribution fails closed').toBe(
          "frame-ancestors 'none'",
        )

        // An expired-but-active distribution keeps framing permission: the
        // policy endpoint checks `status`, not the availability window, so the
        // iframe can still load and explain itself. Contrast with
        // TC-FORMS-DIST-002, where the same distribution 410s on start.
        const expiredPolicy = await readPolicy(expired.publicSlug as string)
        expect(
          expiredPolicy?.embeddable,
          'an expired but still-active distribution remains framable so the iframe can render its own notice',
        ).toBe(true)
        expect(expiredPolicy?.frame_ancestors).toBe('frame-ancestors https://www.acme.com')

        const unknown = await readPolicy('qa-emb007-not-a-real-slug')
        expect(unknown?.embeddable, 'an unknown slug is not embeddable').toBe(false)
        expect(unknown?.frame_ancestors, 'an unknown slug fails closed rather than erroring').toBe(
          "frame-ancestors 'none'",
        )
      })
    } finally {
      for (const id of distributionIds) {
        await deleteDistributionIfExists(request, adminToken, id)
      }
      for (const form of forms) {
        await deleteFormIfExists(request, adminToken, form.formId)
      }
    }
  })
})
