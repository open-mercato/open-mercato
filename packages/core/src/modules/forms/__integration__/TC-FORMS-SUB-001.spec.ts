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
  listFormSubmissions,
  publicSubmit,
  startPublicSubmissionOrThrow,
  uniqueClientIp,
} from '@open-mercato/core/helpers/integration/formsFixtures'

/**
 * TC-FORMS-SUB-001: the admin submissions inbox paginates, filters by status and
 * caps `pageSize`.
 *
 * The inbox is the only place an operator sees responses, so a pagination bug
 * here silently hides them. `pageSize` is `.max(100).default(25)` on its own
 * `querySchema` with `safeParse`, so the over-cap probe can pin `422
 * VALIDATION_FAILED` exactly — unlike the `GET /api/forms` probe, whose route
 * uses a throwing `parse`.
 *
 * Three submissions are started and only two submitted, so the status filter has
 * something real to exclude.
 */
test.describe('TC-FORMS-SUB-001: admin submissions inbox', () => {
  test('paginates, filters by status and refuses pageSize above 100', async ({ request }) => {
    test.setTimeout(150_000)

    let adminToken: string | null = null
    let formId: string | null = null
    let distributionId: string | null = null

    try {
      adminToken = await getAuthToken(request, 'admin')
      const published = await createPublishedFormFixture(request, adminToken, { name: 'QA SUB001' })
      formId = published.formId

      const distribution = await createDistributionFixture(request, adminToken, formId, { mode: 'open' })
      distributionId = distribution.id
      const slug = distribution.publicSlug as string

      const submittedIds: string[] = []
      let draftId = ''

      await withCredentialIsolatedRequest(async (anonymous) => {
        for (let index = 0; index < 3; index += 1) {
          const clientIp = uniqueClientIp()
          const run = await startPublicSubmissionOrThrow(anonymous, { slug, clientIp })
          if (index < 2) {
            const submitRes = await publicSubmit(anonymous, {
              submissionId: run.submissionId,
              accessToken: run.accessToken,
              baseRevisionId: run.revisionId,
              clientIp,
            })
            expect(
              submitRes.status(),
              `submit ${index} should succeed (got ${submitRes.status()}: ${await submitRes.text()})`,
            ).toBe(200)
            submittedIds.push(run.submissionId)
          } else {
            draftId = run.submissionId
          }
        }
      })

      const defaultRes = await listFormSubmissions(request, adminToken, formId)
      expect(defaultRes.status(), 'the inbox read should return 200').toBe(200)
      const defaults = await readJsonSafe<{
        items?: Array<{ id: string; status: string }>
        total?: number
        page?: number
        pageSize?: number
      }>(defaultRes)
      expect(defaults?.page, 'page defaults to 1').toBe(1)
      expect(defaults?.pageSize, 'pageSize defaults to 25').toBe(25)
      expect(defaults?.total, 'all three submissions are counted').toBe(3)
      expect(defaults?.items?.length, 'all three fit on the default page').toBe(3)

      // Pagination really pages: sizes of 1 across three pages cover the set
      // exactly once, with no repeats and no gaps.
      const seen: string[] = []
      for (const page of [1, 2, 3]) {
        const pageRes = await listFormSubmissions(request, adminToken, formId, { page, pageSize: 1 })
        expect(pageRes.status(), `page ${page} should return 200`).toBe(200)
        const body = await readJsonSafe<{ items?: Array<{ id: string }>; total?: number; page?: number }>(pageRes)
        expect(body?.page, `page ${page} echoes the request`).toBe(page)
        expect(body?.total, `page ${page} reports the unpaged total`).toBe(3)
        expect(body?.items?.length, `page ${page} holds exactly one row`).toBe(1)
        seen.push(body!.items![0].id)
      }
      expect(new Set(seen).size, 'paging visits each submission exactly once').toBe(3)
      expect(
        seen.sort(),
        'paging covers the same set the unpaged read returned',
      ).toEqual([...submittedIds, draftId].sort())

      const submittedOnly = await listFormSubmissions(request, adminToken, formId, {
        status: 'submitted',
        pageSize: 100,
      })
      expect(submittedOnly.status(), 'the status-filtered read should return 200').toBe(200)
      const submittedBody = await readJsonSafe<{ items?: Array<{ id: string; status: string }>; total?: number }>(
        submittedOnly,
      )
      expect(submittedBody?.total, 'only the two submitted rows match').toBe(2)
      expect(
        (submittedBody?.items ?? []).map((item) => item.id).sort(),
        'the draft is excluded by status=submitted',
      ).toEqual([...submittedIds].sort())
      for (const item of submittedBody?.items ?? []) {
        expect(item.status, 'every returned row matches the filter').toBe('submitted')
      }

      const overCap = await listFormSubmissions(request, adminToken, formId, { pageSize: 101 })
      const overCapBody = await readJsonSafe<{ error?: string }>(overCap)
      expect(
        overCap.status(),
        `pageSize=101 should be refused with 422 (got ${overCap.status()}: ${JSON.stringify(overCapBody)})`,
      ).toBe(422)
      expect(overCapBody?.error, 'the over-cap query is a validation failure').toBe('VALIDATION_FAILED')

      const badStatus = await listFormSubmissions(request, adminToken, formId, { status: 'not_a_status' })
      expect(badStatus.status(), 'an unknown status value is refused rather than ignored').toBe(422)
    } finally {
      await deleteDistributionIfExists(request, adminToken, distributionId)
      await deleteFormIfExists(request, adminToken, formId)
    }
  })
})
