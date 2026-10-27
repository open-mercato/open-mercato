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
  readAccessAudit,
  waitForAutosaveWindow,
} from '@open-mercato/core/helpers/integration/formsFixtures'

/**
 * TC-FORMS-SUB-018: the admin submission DETAIL read must be access-audited.
 *
 * SKIPPED — MODULE DEFECT, not a test defect.
 *
 * `SubmissionService.getCurrent()` hard-codes `surface: 'runtime'` on its
 * `auditAccess` call (packages/core/src/modules/forms/services/
 * submission-service.ts, the call just before it returns the view), while
 * `listRevisions()` correctly passes `surface: 'admin'`. The DI hook in `di.ts`
 * drops anything that is not `admin`:
 *
 *     auditAccess: async (args) => {
 *       if (args.surface !== 'admin') return
 *       …
 *     }
 *
 * `GET /api/forms/submissions/:submissionId` calls `getCurrent` with
 * `viewerRole: 'admin'` and the staff `auth.sub`, so the read is unambiguously a
 * staff read — but it is reported as `runtime` and therefore never recorded.
 *
 * Observed on the ephemeral lane at this commit:
 *   GET /api/forms/submissions/:id   (as admin, 200, decrypted answers in body)
 *   then GET …/access-audit          -> { items: [] }
 *   expected -> one row with access_purpose 'view'
 *
 * Why it matters: this is the *primary* staff read — the submission drawer an
 * operator opens to look at someone's answers, and the only admin surface that
 * returns `decoded_data` in full. The audit table exists to answer "who looked at
 * this data subject's answers, and when"; today it answers that for exports, for
 * attachment downloads and for the revisions timeline, but not for the read
 * people actually use. An operator can read every submission in the organization
 * and leave no trace, which undercuts the GDPR accountability story the rest of
 * the module is built around (`forms.submissions.export`/`…anonymize` are
 * separate features precisely so those actions are attributable).
 *
 * Suggested fix: pass the surface in rather than hard-coding it — `getCurrent`
 * already knows whether it was called from an admin route (its callers supply
 * `viewerRole`/`viewerUserId`), so add a `surface: 'admin' | 'runtime'` argument
 * and have `api/submissions/[submissionId]/route.ts` pass `'admin'` while the
 * public/portal routes keep `'runtime'`. Then delete the `test.skip` below and
 * restore the detail-read assertion in TC-FORMS-SUB-007's comment.
 */
test.describe('TC-FORMS-SUB-018: admin submission detail is audited', () => {
  // Unskipped: getCurrent now takes an explicit `surface`, and the admin detail route passes 'admin'.

  test('appends one view row when a staff user opens the submission detail', async ({ request }) => {
    test.setTimeout(150_000)

    const stamp = `${Date.now()}-${randomUUID().slice(0, 8)}`
    const answer = `QA SUB018 answer ${stamp}`

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
          patch: { full_name: answer },
          clientIp: run.clientIp,
        })
        expect(saveRes.status(), 'the participant autosave should succeed').toBe(200)

        const before = await readAccessAudit(request, adminToken as string, run.submissionId)

        const detailRes = await apiRequest(request, 'GET', `/api/forms/submissions/${run.submissionId}`, {
          token: adminToken as string,
        })
        expect(detailRes.status(), 'the staff detail read should succeed').toBe(200)
        const detail = await readJsonSafe<{ decoded_data?: Record<string, unknown> }>(detailRes)
        expect(
          detail?.decoded_data?.full_name,
          'the detail read really did return the decrypted answer',
        ).toBe(answer)

        const after = await readAccessAudit(request, adminToken as string, run.submissionId)
        expect(
          after.length,
          `the staff detail read must append exactly one audit row (had ${before.length}, now ${after.length})`,
        ).toBe(before.length + 1)
        expect(after[0]?.accessPurpose, 'the detail read is recorded as a view').toBe('view')
        expect(after[0]?.accessedBy, 'the row names the staff user who looked').toBeTruthy()
      })
    } finally {
      await deleteDistributionIfExists(request, adminToken, distributionId)
      await deleteFormIfExists(request, adminToken, formId)
    }
  })
})
