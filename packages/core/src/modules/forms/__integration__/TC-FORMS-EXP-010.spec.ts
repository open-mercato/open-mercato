import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import {
  apiRequest,
  getAuthToken,
  withCredentialIsolatedRequest,
} from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  buildSensitiveFormSchema,
  createAnonymousRunFixture,
  deleteDistributionIfExists,
  deleteFormIfExists,
  publicAutosave,
  publicSubmit,
  waitForAutosaveWindow,
} from '@open-mercato/core/helpers/integration/formsFixtures'

type ExportedAnswer = {
  fieldKey: string
  label: string
  type: string
  sensitive: boolean
  value: unknown
}

type ExportedSubmission = {
  submissionId: string
  formKey: string
  formName: string
  formVersionId: string
  versionNumber: number
  status: string
  subjectType: string
  subjectId: string
  submittedAt: string | null
  updatedAt: string
  anonymizedAt: string | null
  currentRevisionId: string | null
  currentRevisionNumber: number | null
  answers: ExportedAnswer[]
  attachments: Array<{ attachmentId: string; fieldKey: string; kind: string }>
}

/**
 * TC-FORMS-EXP-010: the single-submission GDPR export is a complete, portable,
 * human-readable document.
 *
 * This is the Article 15/20 deliverable, so "complete" is the requirement, not
 * "non-empty": it must carry the decrypted answers with their human labels and
 * declared types, the version the answers were given against (answers without
 * their pinned schema are not interpretable), and the lifecycle timestamps.
 *
 * Two negative properties matter as much. Attachments are referenced by id and
 * never inlined, so an export stays a document rather than a blob dump. And the
 * `content-disposition` attachment header is what makes a browser download it
 * rather than render it — the decrypted answers of a data subject must not end up
 * in a tab.
 */
test.describe('TC-FORMS-EXP-010: single-submission GDPR export', () => {
  test('exports decrypted answers with labels, types and the pinned version', async ({ request }) => {
    test.setTimeout(180_000)

    const stamp = `${Date.now()}-${randomUUID().slice(0, 8)}`
    const nameAnswer = `QA EXP010 name ${stamp}`
    const sensitiveAnswer = `QA EXP010 sensitive ${stamp}`

    let adminToken: string | null = null
    let formId: string | null = null
    let distributionId: string | null = null

    try {
      adminToken = await getAuthToken(request, 'admin')

      await withCredentialIsolatedRequest(async (anonymous) => {
        const run = await createAnonymousRunFixture(request, anonymous, adminToken as string, {
          schema: buildSensitiveFormSchema(),
        })
        formId = run.formId
        distributionId = run.distributionId

        await waitForAutosaveWindow()
        const saveRes = await publicAutosave(anonymous, {
          submissionId: run.submissionId,
          accessToken: run.accessToken,
          baseRevisionId: run.revisionId,
          patch: { full_name: nameAnswer, diagnosis: sensitiveAnswer, consented: true },
          clientIp: run.clientIp,
        })
        expect(
          saveRes.status(),
          `the autosave should succeed (got ${saveRes.status()}: ${await saveRes.text()})`,
        ).toBe(200)
        const saved = await readJsonSafe<{ revision?: { id?: string }; access_token?: string }>(saveRes)

        const submitRes = await publicSubmit(anonymous, {
          submissionId: run.submissionId,
          accessToken: saved?.access_token ?? run.accessToken,
          baseRevisionId: saved!.revision!.id as string,
          clientIp: run.clientIp,
        })
        expect(submitRes.status(), 'the submit should succeed').toBe(200)

        const exportRes = await apiRequest(
          request,
          'GET',
          `/api/forms/submissions/${run.submissionId}/export`,
          { token: adminToken as string },
        )
        const raw = await exportRes.text()
        expect(
          exportRes.status(),
          `the export should return 200 (got ${exportRes.status()}: ${raw.slice(0, 300)})`,
        ).toBe(200)

        const headers = exportRes.headers()
        expect(headers['content-type'], 'the export is JSON').toContain('application/json')
        expect(
          headers['content-disposition'],
          'the export is served as a download, not rendered in a tab',
        ).toContain('attachment')
        expect(
          headers['content-disposition'],
          'the filename identifies the submission',
        ).toContain(run.submissionId)

        const document = JSON.parse(raw) as ExportedSubmission

        expect(document.submissionId).toBe(run.submissionId)
        expect(document.formKey, 'the export names the form key').toBe(run.formKey)
        expect(document.formName, 'the export names the form').toBeTruthy()
        expect(document.formVersionId, 'the export pins the version the answers were given against').toBe(
          run.versionId,
        )
        expect(document.versionNumber, 'the export names the version number').toBe(1)
        expect(document.status, 'the export records the lifecycle status').toBe('submitted')
        expect(document.submittedAt, 'the export records when it was submitted').toBeTruthy()
        expect(document.updatedAt, 'the export records when it last changed').toBeTruthy()
        expect(document.anonymizedAt, 'this submission has not been erased').toBeNull()
        expect(document.currentRevisionNumber, 'the export names the revision it rendered').toBe(2)
        expect(document.subjectType, 'the export names the subject type').toBeTruthy()
        expect(document.subjectId, 'the export names the subject id').toBeTruthy()

        const byKey = new Map(document.answers.map((answer) => [answer.fieldKey, answer]))
        // The export projects ANSWERED fields only — `notes` was left blank and
        // is absent rather than present-with-null. That is the right call for a
        // portability document (it reports what the subject actually gave), and
        // it is pinned here so a future "include every declared field" change is
        // a deliberate decision rather than a silent shape drift.
        expect(
          [...byKey.keys()].sort(),
          'the export covers exactly the answered fields',
        ).toEqual(['consented', 'diagnosis', 'full_name'].sort())
        expect(byKey.has('notes'), 'an unanswered field is omitted, not exported as null').toBe(false)

        const name = byKey.get('full_name') as ExportedAnswer
        expect(name.value, 'the export carries the decrypted answer').toBe(nameAnswer)
        expect(name.label, 'the export carries the human label, not the field key').toBe('Full name')
        expect(name.type, 'the export carries the declared field type').toBe('text')
        expect(name.sensitive, 'full_name is not marked sensitive').toBe(false)

        const diagnosis = byKey.get('diagnosis') as ExportedAnswer
        expect(
          diagnosis.value,
          'a sensitive answer IS included — Article 15 is about giving the subject their own data',
        ).toBe(sensitiveAnswer)
        expect(diagnosis.sensitive, 'the export flags the field as sensitive').toBe(true)
        expect(diagnosis.label).toBe('Diagnosis')

        const consented = byKey.get('consented') as ExportedAnswer
        expect(consented.value, 'a boolean answer round-trips as a boolean').toBe(true)
        expect(consented.type).toBe('boolean')

        // Attachments are referenced, never inlined — no attachments here, so the
        // shape is what is asserted.
        expect(Array.isArray(document.attachments), 'the export carries an attachments array').toBe(true)
        expect(document.attachments.length, 'this submission uploaded nothing').toBe(0)

        // The unauthenticated case, from a jar that never saw a login.
        const anonymousExport = await anonymous.get(
          `/api/forms/submissions/${run.submissionId}/export`,
        )
        expect(anonymousExport.status(), 'the export route rejects an anonymous caller').toBe(401)
        expect(
          await anonymousExport.text(),
          'a rejected export leaks no answer',
        ).not.toContain(nameAnswer)
      })
    } finally {
      await deleteDistributionIfExists(request, adminToken, distributionId)
      await deleteFormIfExists(request, adminToken, formId)
    }
  })
})
