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
  waitForAutosaveWindow,
} from '@open-mercato/core/helpers/integration/formsFixtures'

/**
 * TC-FORMS-PUB-002: replaying a stale `base_revision_id` on autosave is a 409
 * `STALE_BASE`.
 *
 * Submission answer writes use their append-only revision id as the concurrency
 * token. The module's separately user-editable Form, FormVersion, and
 * FormDistribution aggregates use the standard updated-at header contract.
 *
 * The 409 body carries `details.currentRevisionId`, which is what a client needs
 * to re-base; asserting it keeps the recovery path part of the contract.
 */
test.describe('TC-FORMS-PUB-002: stale base revision on autosave', () => {
  test('answers 409 STALE_BASE and names the current revision', async ({ request }) => {
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
        const firstSave = await publicAutosave(anonymous, {
          submissionId: run.submissionId,
          accessToken: run.accessToken,
          baseRevisionId: run.revisionId,
          patch: { full_name: 'First writer' },
          clientIp: run.clientIp,
        })
        const firstBody = await readJsonSafe<{ revision?: { id?: string; revisionNumber?: number } }>(firstSave)
        expect(
          firstSave.status(),
          `the first autosave should succeed (got ${firstSave.status()}: ${JSON.stringify(firstBody)})`,
        ).toBe(200)
        expect(firstBody?.revision?.revisionNumber, 'the first autosave is revision 2').toBe(2)
        const currentRevisionId = firstBody!.revision!.id as string

        // Replay revision 1 — the base the first writer already consumed.
        await waitForAutosaveWindow()
        const staleSave = await publicAutosave(anonymous, {
          submissionId: run.submissionId,
          accessToken: run.accessToken,
          baseRevisionId: run.revisionId,
          patch: { full_name: 'Second writer clobbering' },
          clientIp: run.clientIp,
        })
        const staleBody = await readJsonSafe<{
          error?: string
          details?: { currentRevisionId?: string } | null
        }>(staleSave)
        expect(
          staleSave.status(),
          `replaying a consumed base revision should be 409 (got ${staleSave.status()}: ${JSON.stringify(staleBody)})`,
        ).toBe(409)
        expect(staleBody?.error, 'the conflict is reported as STALE_BASE').toBe('STALE_BASE')
        expect(
          staleBody?.details?.currentRevisionId,
          'the conflict names the revision the client must re-base onto',
        ).toBe(currentRevisionId)

        // The rejected write did not land: the first writer's value survives and
        // no third revision was appended.
        const readRes = await anonymous.get(`/api/forms/public/submissions/${run.submissionId}`, {
          headers: { Authorization: `Bearer ${run.accessToken}` },
        })
        expect(readRes.status(), 'the submission is still readable').toBe(200)
        const view = await readJsonSafe<{
          submission?: { currentRevisionId?: string }
          revision?: { revisionNumber?: number }
          decoded_data?: Record<string, unknown>
        }>(readRes)
        expect(view?.submission?.currentRevisionId, 'the stale write did not advance the chain').toBe(currentRevisionId)
        expect(view?.revision?.revisionNumber, 'the revision number did not advance').toBe(2)
        expect(view?.decoded_data?.full_name, 'the first writer’s value survived').toBe('First writer')
      })
    } finally {
      await deleteDistributionIfExists(request, adminToken, distributionId)
      await deleteFormIfExists(request, adminToken, formId)
    }
  })
})
