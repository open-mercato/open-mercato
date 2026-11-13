import { randomUUID } from 'node:crypto'
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
  readSubmissionRevisions,
  waitForAutosaveWindow,
} from '@open-mercato/core/helpers/integration/formsFixtures'

/**
 * TC-FORMS-SUB-003: the revision timeline is append-only and carries no answer
 * payload.
 *
 * The revision chain is the audit trail behind the GDPR export and the PDF
 * snapshot, so two things must hold. It must actually grow — a coalescing or
 * in-place-update regression would destroy the history while every other test
 * still passed. And the timeline projection must expose only metadata
 * (`revisionNumber`, `changedFieldKeys`, who/when), because it is served to any
 * `forms.view` holder while the answers themselves are gated behind the detail
 * and export routes.
 *
 * Each autosave changes a DIFFERENT field so `changedFieldKeys` is verifiable
 * per revision rather than merely non-empty.
 */
test.describe('TC-FORMS-SUB-003: submission revision timeline', () => {
  test('appends one revision per autosave and never serves answer values', async ({ request }) => {
    test.setTimeout(180_000)

    const stamp = `${Date.now()}-${randomUUID().slice(0, 8)}`
    const nameAnswer = `QA SUB003 name ${stamp}`
    const notesAnswer = `QA SUB003 notes ${stamp}`

    let adminToken: string | null = null
    let formId: string | null = null
    let distributionId: string | null = null

    try {
      adminToken = await getAuthToken(request, 'admin')

      await withCredentialIsolatedRequest(async (anonymous) => {
        const run = await createAnonymousRunFixture(request, anonymous, adminToken as string)
        formId = run.formId
        distributionId = run.distributionId

        let baseRevisionId = run.revisionId
        const saves: Array<{ patch: Record<string, unknown>; changed: string }> = [
          { patch: { full_name: nameAnswer }, changed: 'full_name' },
          { patch: { notes: notesAnswer }, changed: 'notes' },
          { patch: { full_name: `${nameAnswer} v2` }, changed: 'full_name' },
        ]

        for (const [index, save] of saves.entries()) {
          await waitForAutosaveWindow()
          const response = await publicAutosave(anonymous, {
            submissionId: run.submissionId,
            accessToken: run.accessToken,
            baseRevisionId,
            patch: save.patch,
            changeSummary: `autosave ${index + 1}`,
            clientIp: run.clientIp,
          })
          const body = await readJsonSafe<{
            revision?: { id?: string; revisionNumber?: number; changedFieldKeys?: string[] }
          }>(response)
          expect(
            response.status(),
            `autosave ${index + 1} should succeed (got ${response.status()}: ${JSON.stringify(body)})`,
          ).toBe(200)
          expect(body?.revision?.revisionNumber, `autosave ${index + 1} appends the next revision`).toBe(index + 2)
          expect(
            body?.revision?.changedFieldKeys,
            `autosave ${index + 1} records the field it changed`,
          ).toEqual([save.changed])
          baseRevisionId = body!.revision!.id as string
        }

        const timelineRes = await readSubmissionRevisions(request, adminToken as string, run.submissionId)
        const timeline = await readJsonSafe<{
          submission?: { currentRevisionId?: string }
          revisions?: Array<{
            id: string
            revisionNumber: number
            changedFieldKeys: string[]
            savedAt: string | null
            savedByRole: string | null
            changeSource: string
            changeSummary: string | null
          }>
        }>(timelineRes)
        expect(
          timelineRes.status(),
          `the revisions read should return 200 (got ${timelineRes.status()}: ${JSON.stringify(timeline)})`,
        ).toBe(200)

        const revisions = timeline?.revisions ?? []
        expect(revisions.length, 'revision 1 from start plus three autosaves').toBe(4)
        expect(
          revisions.map((entry) => entry.revisionNumber),
          'the timeline is a contiguous, monotonic chain',
        ).toEqual([1, 2, 3, 4])
        expect(timeline?.submission?.currentRevisionId, 'the submission points at the newest revision').toBe(
          revisions[3].id,
        )

        expect(revisions[0].changeSource, 'the start revision is system-written').toBe('system')
        expect(revisions[0].changedFieldKeys, 'the start revision changed nothing').toEqual([])
        expect(revisions[1].changedFieldKeys).toEqual(['full_name'])
        expect(revisions[2].changedFieldKeys).toEqual(['notes'])
        expect(revisions[3].changedFieldKeys).toEqual(['full_name'])
        for (const [index, revision] of revisions.slice(1).entries()) {
          expect(revision.changeSource, `autosave revision ${index + 2} is user-written`).toBe('user')
          expect(revision.savedByRole, `autosave revision ${index + 2} records the acting role`).toBe('participant')
          expect(revision.savedAt, `autosave revision ${index + 2} is timestamped`).toBeTruthy()
          expect(revision.changeSummary, `autosave revision ${index + 2} keeps its summary`).toBe(
            `autosave ${index + 1}`,
          )
        }

        // The timeline is metadata only: no decrypted answers, no ciphertext.
        const serialized = JSON.stringify(timeline ?? {})
        expect(serialized, 'the timeline must not carry the decrypted name answer').not.toContain(nameAnswer)
        expect(serialized, 'the timeline must not carry the decrypted notes answer').not.toContain(notesAnswer)
        for (const revision of revisions) {
          expect(
            Object.prototype.hasOwnProperty.call(revision, 'data'),
            'the timeline must not carry the encrypted revision payload either',
          ).toBe(false)
        }
      })
    } finally {
      await deleteDistributionIfExists(request, adminToken, distributionId)
      await deleteFormIfExists(request, adminToken, formId)
    }
  })
})
