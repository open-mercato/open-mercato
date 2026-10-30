import { expect, test } from '@playwright/test'
import {
  getAuthToken,
  withCredentialIsolatedRequest,
} from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createAnonymousRunFixture,
  createDistributionFixture,
  createPublishedFormFixture,
  deleteDistributionIfExists,
  deleteFormIfExists,
  publicAutosave,
  publicRead,
  publicSubmit,
  startPublicSubmissionOrThrow,
  uniqueClientIp,
  waitForAutosaveWindow,
} from '@open-mercato/core/helpers/integration/formsFixtures'

/**
 * TC-FORMS-PUB-003: a submission access token is required, and it authorizes
 * exactly one submission.
 *
 * `verifyAccessToken` binds the token to a `(submissionId, invitationId, role)`
 * triple and `resolveRuntimePrincipal` asserts the token's submission matches the
 * route's before trusting anything — so submission B's token must not move
 * submission A. The no-bearer case is the one that needs the isolated context: a
 * shared jar would replay a session and the assertion would pass vacuously.
 *
 * All three rejections are 401 rather than 403: `resolveRuntimePrincipal` returns
 * `null` for a present-but-invalid bearer and deliberately does NOT fall through
 * to customer-session auth, so the route cannot tell "wrong credential" from "no
 * credential" — and should not, since either way nothing is authorized.
 */
test.describe('TC-FORMS-PUB-003: access token presence and scope', () => {
  test('rejects a missing, garbage and foreign access token on every write route', async ({ request }) => {
    test.setTimeout(150_000)

    let adminToken: string | null = null
    let formId: string | null = null
    let distributionId: string | null = null
    let secondFormId: string | null = null
    let secondDistributionId: string | null = null

    try {
      adminToken = await getAuthToken(request, 'admin')

      await withCredentialIsolatedRequest(async (anonymous) => {
        const runA = await createAnonymousRunFixture(request, anonymous, adminToken as string)
        formId = runA.formId
        distributionId = runA.distributionId

        // A second, independent submission so we have a valid-but-foreign token.
        const publishedB = await createPublishedFormFixture(request, adminToken as string, { name: 'QA PUB003 B' })
        secondFormId = publishedB.formId
        const distributionB = await createDistributionFixture(
          request,
          adminToken as string,
          publishedB.formId,
          { mode: 'open' },
        )
        secondDistributionId = distributionB.id
        const runB = await startPublicSubmissionOrThrow(anonymous, {
          slug: distributionB.publicSlug as string,
          clientIp: uniqueClientIp(),
        })
        expect(runB.accessToken, 'submission B minted its own token').toBeTruthy()
        expect(runB.accessToken, 'the two tokens differ').not.toBe(runA.accessToken)

        const cases: Array<{ label: string; token: string | null }> = [
          { label: 'no bearer at all', token: null },
          { label: 'a garbage bearer', token: 'not-a-valid-access-token' },
          { label: "submission B's valid token", token: runB.accessToken },
        ]

        await waitForAutosaveWindow()

        for (const { label, token } of cases) {
          const saveRes = await publicAutosave(anonymous, {
            submissionId: runA.submissionId,
            accessToken: token,
            baseRevisionId: runA.revisionId,
            patch: { full_name: `should never land via ${label}` },
            clientIp: runA.clientIp,
          })
          expect(
            saveRes.status(),
            `autosave with ${label} must be 401 (got ${saveRes.status()}: ${await saveRes.text()})`,
          ).toBe(401)

          const submitRes = await publicSubmit(anonymous, {
            submissionId: runA.submissionId,
            accessToken: token,
            baseRevisionId: runA.revisionId,
            clientIp: runA.clientIp,
          })
          expect(submitRes.status(), `submit with ${label} must be 401`).toBe(401)

          const readRes = await publicRead(anonymous, {
            submissionId: runA.submissionId,
            accessToken: token,
          })
          expect(readRes.status(), `read with ${label} must be 401`).toBe(401)
          const readBody = await readJsonSafe<{ decoded_data?: unknown }>(readRes)
          expect(readBody?.decoded_data, `a rejected read with ${label} must not leak answers`).toBeUndefined()
        }

        // Submission A is untouched: still a draft on revision 1.
        const ownRead = await publicRead(anonymous, {
          submissionId: runA.submissionId,
          accessToken: runA.accessToken,
        })
        expect(ownRead.status(), "submission A's own token still works").toBe(200)
        const view = await readJsonSafe<{
          submission?: { status?: string; currentRevisionId?: string }
          decoded_data?: Record<string, unknown>
        }>(ownRead)
        expect(view?.submission?.status, 'the rejected submits left A as a draft').toBe('draft')
        expect(view?.submission?.currentRevisionId, 'the rejected saves appended nothing').toBe(runA.revisionId)
        expect(
          JSON.stringify(view?.decoded_data ?? {}),
          'none of the rejected patches persisted',
        ).not.toContain('should never land')
      })
    } finally {
      await deleteDistributionIfExists(request, adminToken, distributionId)
      await deleteDistributionIfExists(request, adminToken, secondDistributionId)
      await deleteFormIfExists(request, adminToken, formId)
      await deleteFormIfExists(request, adminToken, secondFormId)
    }
  })
})
