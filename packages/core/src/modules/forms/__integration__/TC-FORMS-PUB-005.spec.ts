import { expect, test } from '@playwright/test'
import {
  getAuthToken,
  withCredentialIsolatedRequest,
} from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createAnonymousRunFixture,
  deleteDistributionIfExists,
  deleteFormIfExists,
  publicAutosave,
  publicSubmit,
  waitForAutosaveWindow,
} from '@open-mercato/core/helpers/integration/formsFixtures'

/**
 * TC-FORMS-PUB-005: a submitted submission cannot be submitted again.
 *
 * Idempotence matters here beyond tidiness: a second submit that went through
 * would re-stamp `submittedAt`, re-fire `forms.submission.submitted`, and (on a
 * personal distribution) burn a second slot against the response cap. Asserting
 * the original `submittedAt` survives is what proves the guard runs before any
 * state change rather than after.
 *
 * The sibling guard — refusing an AUTOSAVE after submit — is genuinely missing
 * from the module and lives in TC-FORMS-PUB-006 as a skipped case. This spec
 * deliberately does not assert it, so that fixing the defect does not have to
 * touch this file.
 */
test.describe('TC-FORMS-PUB-005: double submit', () => {
  test('refuses a second submit with INVALID_STATUS and keeps the original submittedAt', async ({ request }) => {
    test.setTimeout(120_000)

    let adminToken: string | null = null
    let formId: string | null = null
    let distributionId: string | null = null

    try {
      adminToken = await getAuthToken(request, 'admin')

      await withCredentialIsolatedRequest(async (anonymous) => {
        const run = await createAnonymousRunFixture(request, anonymous, adminToken as string)
        formId = run.formId
        distributionId = run.distributionId

        await waitForAutosaveWindow()
        const saveRes = await publicAutosave(anonymous, {
          submissionId: run.submissionId,
          accessToken: run.accessToken,
          baseRevisionId: run.revisionId,
          patch: { full_name: 'Jane Once' },
          clientIp: run.clientIp,
        })
        expect(saveRes.status(), 'the pre-submit autosave should succeed').toBe(200)
        const saved = await readJsonSafe<{ revision?: { id?: string }; access_token?: string }>(saveRes)
        const revisionId = saved!.revision!.id as string
        const token = saved?.access_token ?? run.accessToken

        const firstSubmit = await publicSubmit(anonymous, {
          submissionId: run.submissionId,
          accessToken: token,
          baseRevisionId: revisionId,
          clientIp: run.clientIp,
        })
        const firstBody = await readJsonSafe<{ submission?: { status?: string; submittedAt?: string } }>(firstSubmit)
        expect(
          firstSubmit.status(),
          `the first submit should succeed (got ${firstSubmit.status()}: ${JSON.stringify(firstBody)})`,
        ).toBe(200)
        expect(firstBody?.submission?.status).toBe('submitted')
        const originalSubmittedAt = firstBody?.submission?.submittedAt
        expect(originalSubmittedAt, 'the first submit stamped submittedAt').toBeTruthy()

        const secondSubmit = await publicSubmit(anonymous, {
          submissionId: run.submissionId,
          accessToken: token,
          baseRevisionId: revisionId,
          clientIp: run.clientIp,
        })
        const secondBody = await readJsonSafe<{ error?: string }>(secondSubmit)
        expect(
          secondSubmit.status(),
          `the second submit should be 422 (got ${secondSubmit.status()}: ${JSON.stringify(secondBody)})`,
        ).toBe(422)
        expect(secondBody?.error, 'the second submit is refused on status').toBe('INVALID_STATUS')

        // NOTE: the post-submit autosave guard is NOT asserted here. It is a real
        // module defect, covered (skipped) by TC-FORMS-PUB-006 —
        // `SubmissionService.save()` rejects `archived` but not `submitted`, so a
        // participant can keep rewriting a submitted submission. Asserting the
        // current 200 here would pin the bug.

        const readRes = await anonymous.get(`/api/forms/public/submissions/${run.submissionId}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        const view = await readJsonSafe<{
          submission?: { status?: string; submittedAt?: string }
          decoded_data?: Record<string, unknown>
        }>(readRes)
        expect(view?.submission?.status, 'the submission is still submitted exactly once').toBe('submitted')
        expect(
          view?.submission?.submittedAt,
          'the rejected second submit did not re-stamp submittedAt',
        ).toBe(originalSubmittedAt)
        expect(view?.decoded_data?.full_name, 'the submitted answer is the one that was submitted').toBe('Jane Once')
      })
    } finally {
      await deleteDistributionIfExists(request, adminToken, distributionId)
      await deleteFormIfExists(request, adminToken, formId)
    }
  })
})
