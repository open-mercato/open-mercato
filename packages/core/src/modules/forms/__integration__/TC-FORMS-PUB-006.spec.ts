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
 * TC-FORMS-PUB-006: an autosave after submit must be refused.
 *
 * SKIPPED — MODULE DEFECT, not a test defect.
 *
 * `SubmissionService.save()` (packages/core/src/modules/forms/services/
 * submission-service.ts, the guard block at the top of the transaction) rejects
 * only `status === 'archived'`:
 *
 *     if (submission.status === 'archived') {
 *       throw new SubmissionServiceError('INVALID_STATUS', 'Submission is archived.', 422)
 *     }
 *
 * There is no `submitted` arm, while `submit()` and `reopen()` both have one. So
 * a participant holding a still-valid access token can keep appending revisions
 * to an ALREADY SUBMITTED submission and silently rewrite their answers after
 * the fact.
 *
 * Observed on the ephemeral lane at this commit:
 *   PATCH /api/forms/public/submissions/:id  (submission already `submitted`)
 *   → 200 { revision: { revisionNumber: 3, changeSource: 'user', … } }
 *   expected → 422 { error: 'INVALID_STATUS' }
 *
 * Why it matters beyond tidiness: `runtime-helpers.ts` documents the submitted
 * record as "tamper-evident" — a version-pinned schema plus append-only
 * encrypted revisions plus server-derived submit metadata, together forming the
 * signed record behind the PDF snapshot and the GDPR export. A post-submit write
 * breaks that claim: `submittedAt` and `submitMetadata` keep pointing at the
 * original submit while the answers move underneath them, and the PDF snapshot
 * (rendered lazily on first read) can therefore capture content the signer never
 * submitted. The reopen flow exists precisely so that re-editing is an audited,
 * `forms.submissions.manage`-gated transition — this bypasses it.
 *
 * Suggested fix (one arm, alongside the existing archived check):
 *   if (submission.status === 'submitted') {
 *     throw new SubmissionServiceError('INVALID_STATUS', 'Submission already submitted.', 422)
 *   }
 * Then delete the `test.skip` below. The spec is written against the intended
 * behaviour and needs no other change.
 */
test.describe('TC-FORMS-PUB-006: autosave after submit', () => {
  // Unskipped: save() now rejects a post-submit autosave with 422 INVALID_STATUS.

  test('refuses an autosave once the submission is submitted', async ({ request }) => {
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
          patch: { full_name: 'Jane Submitted' },
          clientIp: run.clientIp,
        })
        expect(saveRes.status(), 'the pre-submit autosave should succeed').toBe(200)
        const saved = await readJsonSafe<{ revision?: { id?: string }; access_token?: string }>(saveRes)
        const revisionId = saved!.revision!.id as string
        const token = saved?.access_token ?? run.accessToken

        const submitRes = await publicSubmit(anonymous, {
          submissionId: run.submissionId,
          accessToken: token,
          baseRevisionId: revisionId,
          clientIp: run.clientIp,
        })
        expect(submitRes.status(), 'the submit should succeed').toBe(200)

        await waitForAutosaveWindow()
        const postSubmitSave = await publicAutosave(anonymous, {
          submissionId: run.submissionId,
          accessToken: token,
          baseRevisionId: revisionId,
          patch: { full_name: 'Jane Rewritten After Submit' },
          clientIp: run.clientIp,
        })
        const postSubmitBody = await readJsonSafe<{ error?: string }>(postSubmitSave)
        expect(
          postSubmitSave.status(),
          `a post-submit autosave must be refused (got ${postSubmitSave.status()}: ${JSON.stringify(postSubmitBody)})`,
        ).toBe(422)
        expect(postSubmitBody?.error, 'the refusal is reported on status').toBe('INVALID_STATUS')

        const readRes = await anonymous.get(`/api/forms/public/submissions/${run.submissionId}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        const view = await readJsonSafe<{
          submission?: { currentRevisionId?: string }
          decoded_data?: Record<string, unknown>
        }>(readRes)
        expect(
          view?.submission?.currentRevisionId,
          'the refused post-submit write appended no revision',
        ).toBe(revisionId)
        expect(
          view?.decoded_data?.full_name,
          'the submitted answers are immutable until an audited reopen',
        ).toBe('Jane Submitted')
      })
    } finally {
      await deleteDistributionIfExists(request, adminToken, distributionId)
      await deleteFormIfExists(request, adminToken, formId)
    }
  })
})
