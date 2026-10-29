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
  patchDistribution,
  publicSubmit,
  startPublicSubmission,
  startPublicSubmissionOrThrow,
  uniqueClientIp,
  type PublishedFormFixture,
} from '@open-mercato/core/helpers/integration/formsFixtures'

/**
 * TC-FORMS-DIST-002: every way a distribution can stop serving yields 410 GONE
 * on both the public context read and the start.
 *
 * `assertDistributionAvailable` has four independent arms — status, `opensAt`,
 * `closesAt` and the response cap — and each one is a separate way a live public
 * link goes dark. Covering only `closed` would leave a paused or expired
 * distribution free to keep minting submissions.
 *
 * The non-`active` cases additionally carry `details.status`, which is what lets
 * a renderer tell "paused, come back later" from "closed for good".
 */
test.describe('TC-FORMS-DIST-002: unavailable distributions return 410', () => {
  test('closed, paused, not-yet-open, expired and capped all answer GONE', async ({ request }) => {
    test.setTimeout(180_000)

    let adminToken: string | null = null
    const forms: PublishedFormFixture[] = []
    const distributionIds: string[] = []

    const makeOpenDistribution = async (
      name: string,
      input: Parameters<typeof createDistributionFixture>[3] = {},
    ) => {
      const published = await createPublishedFormFixture(request, adminToken as string, { name })
      forms.push(published)
      const distribution = await createDistributionFixture(
        request,
        adminToken as string,
        published.formId,
        { mode: 'open', ...input },
      )
      distributionIds.push(distribution.id)
      expect(distribution.publicSlug, `${name} should mint a slug`).toBeTruthy()
      return distribution
    }

    try {
      adminToken = await getAuthToken(request, 'admin')

      await withCredentialIsolatedRequest(async (anonymous) => {
        const assertGone = async (
          label: string,
          slug: string,
          expectedDetailStatus?: 'paused' | 'closed',
        ) => {
          const contextRes = await anonymous.get(`/api/forms/public/distributions/${slug}`)
          const contextBody = await readJsonSafe<{ error?: string; details?: { status?: string } | null }>(contextRes)
          expect(
            contextRes.status(),
            `${label}: the public context read must be 410 (got ${contextRes.status()}: ${JSON.stringify(contextBody)})`,
          ).toBe(410)
          expect(contextBody?.error, `${label}: the context read reports GONE`).toBe('GONE')
          if (expectedDetailStatus) {
            expect(
              contextBody?.details?.status,
              `${label}: a non-active distribution reports its status so the renderer can explain itself`,
            ).toBe(expectedDetailStatus)
          }

          const startResult = await startPublicSubmission(anonymous, { slug, clientIp: uniqueClientIp() })
          expect(
            startResult.status,
            `${label}: start must be 410 (got ${startResult.status}: ${JSON.stringify(startResult.body)})`,
          ).toBe(410)
          expect(startResult.body.error, `${label}: start reports GONE`).toBe('GONE')
          expect(startResult.accessToken, `${label}: a refused start must mint no access token`).toBeFalsy()
        }

        // 1) Closed.
        const closed = await makeOpenDistribution('QA DIST002 closed')
        const closeRes = await patchDistribution(request, adminToken as string, closed.id, { status: 'closed' })
        expect(closeRes.status(), 'closing the distribution should return 200').toBe(200)
        await assertGone('closed', closed.publicSlug as string, 'closed')

        // 2) Paused.
        const paused = await makeOpenDistribution('QA DIST002 paused')
        const pauseRes = await patchDistribution(request, adminToken as string, paused.id, { status: 'paused' })
        expect(pauseRes.status(), 'pausing the distribution should return 200').toBe(200)
        await assertGone('paused', paused.publicSlug as string, 'paused')

        // 3) Not yet open — `opensAt` in the future.
        const future = new Date(Date.now() + 60 * 60 * 1000).toISOString()
        const notYetOpen = await makeOpenDistribution('QA DIST002 not yet open', { opensAt: future })
        await assertGone('not yet open', notYetOpen.publicSlug as string)

        // 4) Expired — `closesAt` in the past.
        const past = new Date(Date.now() - 60 * 60 * 1000).toISOString()
        const expired = await makeOpenDistribution('QA DIST002 expired', { closesAt: past })
        await assertGone('expired', expired.publicSlug as string)

        // 5) Response cap reached. The cap is consumed by a real submit, so this
        // arm also proves `reserveResponseSlot` increments `responseCount`.
        const capped = await makeOpenDistribution('QA DIST002 capped', { maxResponses: 1 })
        const cappedSlug = capped.publicSlug as string
        const clientIp = uniqueClientIp()
        const run = await startPublicSubmissionOrThrow(anonymous, { slug: cappedSlug, clientIp })
        const submitRes = await publicSubmit(anonymous, {
          submissionId: run.submissionId,
          accessToken: run.accessToken,
          baseRevisionId: run.revisionId,
          clientIp,
        })
        expect(
          submitRes.status(),
          `the first submit against the capped distribution should succeed (got ${submitRes.status()}: ${await submitRes.text()})`,
        ).toBe(200)
        await assertGone('capped', cappedSlug)
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
