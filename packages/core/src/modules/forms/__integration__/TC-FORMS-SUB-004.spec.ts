import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import {
  apiRequest,
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
 * TC-FORMS-SUB-004: reopen is the audited way back into a submitted submission.
 *
 * Both halves of the transition are asserted, and the order matters: the submit
 * must first make the participant's autosave impossible, and the reopen must then
 * make it possible again. Asserting only the post-reopen success would pass on a
 * submission that was never locked in the first place — which is precisely the
 * defect TC-FORMS-PUB-006 records for the autosave path, so the "before" half is
 * checked against the SUBMIT route, which does have the guard.
 */
test.describe('TC-FORMS-SUB-004: reopen a submitted submission', () => {
  test('locks the submission on submit and unlocks it on reopen', async ({ request }) => {
    test.setTimeout(180_000)

    const stamp = `${Date.now()}-${randomUUID().slice(0, 8)}`
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
        const firstSave = await publicAutosave(anonymous, {
          submissionId: run.submissionId,
          accessToken: run.accessToken,
          baseRevisionId: run.revisionId,
          patch: { full_name: `QA SUB004 before ${stamp}` },
          clientIp: run.clientIp,
        })
        expect(firstSave.status(), 'the pre-submit autosave should succeed').toBe(200)
        const firstSaved = await readJsonSafe<{ revision?: { id?: string }; access_token?: string }>(firstSave)
        let revisionId = firstSaved!.revision!.id as string
        let accessToken = firstSaved?.access_token ?? run.accessToken

        const submitRes = await publicSubmit(anonymous, {
          submissionId: run.submissionId,
          accessToken,
          baseRevisionId: revisionId,
          clientIp: run.clientIp,
        })
        expect(
          submitRes.status(),
          `the submit should succeed (got ${submitRes.status()}: ${await submitRes.text()})`,
        ).toBe(200)

        // Before reopen: the submission is locked against a further submit.
        const lockedSubmit = await publicSubmit(anonymous, {
          submissionId: run.submissionId,
          accessToken,
          baseRevisionId: revisionId,
          clientIp: run.clientIp,
        })
        const lockedBody = await readJsonSafe<{ error?: string }>(lockedSubmit)
        expect(
          lockedSubmit.status(),
          `a submitted submission refuses a further submit (got ${lockedSubmit.status()}: ${JSON.stringify(lockedBody)})`,
        ).toBe(422)
        expect(lockedBody?.error).toBe('INVALID_STATUS')

        const reopenRes = await apiRequest(
          request,
          'POST',
          `/api/forms/submissions/${run.submissionId}/reopen`,
          { token: adminToken as string, data: {} },
        )
        const reopened = await readJsonSafe<{ submission?: { status?: string; submittedAt?: string | null } }>(
          reopenRes,
        )
        expect(
          reopenRes.status(),
          `reopen should succeed (got ${reopenRes.status()}: ${JSON.stringify(reopened)})`,
        ).toBe(200)
        expect(reopened?.submission?.status, 'reopen moves the submission to reopened').toBe('reopened')

        // After reopen: the participant can save again, and then submit again.
        await waitForAutosaveWindow()
        const afterSave = await publicAutosave(anonymous, {
          submissionId: run.submissionId,
          accessToken,
          baseRevisionId: revisionId,
          patch: { full_name: `QA SUB004 after ${stamp}` },
          clientIp: run.clientIp,
        })
        const afterSaved = await readJsonSafe<{
          revision?: { id?: string; revisionNumber?: number }
          access_token?: string
        }>(afterSave)
        expect(
          afterSave.status(),
          `the post-reopen autosave should succeed (got ${afterSave.status()}: ${JSON.stringify(afterSaved)})`,
        ).toBe(200)
        expect(afterSaved?.revision?.revisionNumber, 'the post-reopen save appends revision 3').toBe(3)
        revisionId = afterSaved!.revision!.id as string
        accessToken = afterSaved?.access_token ?? accessToken

        const resubmit = await publicSubmit(anonymous, {
          submissionId: run.submissionId,
          accessToken,
          baseRevisionId: revisionId,
          clientIp: run.clientIp,
        })
        const resubmitted = await readJsonSafe<{ submission?: { status?: string } }>(resubmit)
        expect(
          resubmit.status(),
          `the post-reopen submit should succeed (got ${resubmit.status()}: ${JSON.stringify(resubmitted)})`,
        ).toBe(200)
        expect(resubmitted?.submission?.status, 'the reopened submission can be submitted again').toBe('submitted')

        // Reopening is not a reset: the whole history survives.
        const timelineRes = await apiRequest(
          request,
          'GET',
          `/api/forms/submissions/${run.submissionId}/revisions`,
          { token: adminToken as string },
        )
        const timeline = await readJsonSafe<{ revisions?: Array<{ revisionNumber: number }> }>(timelineRes)
        expect(
          (timeline?.revisions ?? []).map((entry) => entry.revisionNumber),
          'reopen preserves the append-only chain rather than truncating it',
        ).toEqual([1, 2, 3])

        // Reopening a submission that is not submitted is refused.
        const badReopen = await apiRequest(
          request,
          'POST',
          `/api/forms/submissions/${run.submissionId}/reopen`,
          { token: adminToken as string, data: {} },
        )
        expect(badReopen.status(), 'a submitted submission can be reopened').toBe(200)
        const secondBadReopen = await apiRequest(
          request,
          'POST',
          `/api/forms/submissions/${run.submissionId}/reopen`,
          { token: adminToken as string, data: {} },
        )
        const secondBadBody = await readJsonSafe<{ error?: string }>(secondBadReopen)
        expect(
          secondBadReopen.status(),
          `reopening an already-reopened submission is refused (got ${secondBadReopen.status()}: ${JSON.stringify(secondBadBody)})`,
        ).toBe(422)
        expect(secondBadBody?.error).toBe('INVALID_STATUS')
      })
    } finally {
      await deleteDistributionIfExists(request, adminToken, distributionId)
      await deleteFormIfExists(request, adminToken, formId)
    }
  })
})
