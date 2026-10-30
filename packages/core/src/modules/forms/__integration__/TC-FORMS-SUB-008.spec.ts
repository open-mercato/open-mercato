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
  readAccessAudit,
  waitForAutosaveWindow,
} from '@open-mercato/core/helpers/integration/formsFixtures'

/**
 * TC-FORMS-SUB-008: anonymize needs the exact typed confirmation, tombstones
 * every sensitive answer across every revision, and keeps the audit skeleton.
 *
 * GDPR erasure is irreversible, so the confirmation gate is a safety interlock,
 * not paperwork: the body must be exactly `{ confirm: 'DELETE' }` — an empty body
 * and a lowercase `'delete'` are both refused, which is what stops a
 * copy-pasted curl or a mis-wired UI from erasing a record.
 *
 * The erasure assertions are the substance. `x-om-sensitive` fields must be
 * replaced by the tombstone in EVERY revision (the append-only chain means the
 * old value survives in history otherwise — erasing only the current revision
 * would look correct on the detail page and still leak through the export), the
 * non-sensitive answers must survive (erasure is scoped, not a delete), and
 * `submitMetadata` must lose the participant's IP and user-agent.
 */
test.describe('TC-FORMS-SUB-008: anonymize a submission', () => {
  test('refuses a wrong confirmation, then tombstones only the sensitive answers', async ({ request }) => {
    test.setTimeout(180_000)

    const stamp = `${Date.now()}-${randomUUID().slice(0, 8)}`
    const sensitiveAnswer = `QA SUB008 SENSITIVE ${stamp}`
    const publicAnswer = `QA SUB008 public ${stamp}`

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

        // Two autosaves so the sensitive value exists in more than one revision —
        // erasing only the newest would pass a single-revision test.
        await waitForAutosaveWindow()
        const firstSave = await publicAutosave(anonymous, {
          submissionId: run.submissionId,
          accessToken: run.accessToken,
          baseRevisionId: run.revisionId,
          patch: { full_name: publicAnswer, diagnosis: sensitiveAnswer },
          clientIp: run.clientIp,
        })
        expect(
          firstSave.status(),
          `the first autosave should succeed (got ${firstSave.status()}: ${await firstSave.text()})`,
        ).toBe(200)
        const firstSaved = await readJsonSafe<{ revision?: { id?: string }; access_token?: string }>(firstSave)

        await waitForAutosaveWindow()
        const secondSave = await publicAutosave(anonymous, {
          submissionId: run.submissionId,
          accessToken: firstSaved?.access_token ?? run.accessToken,
          baseRevisionId: firstSaved!.revision!.id as string,
          patch: { consented: true },
          clientIp: run.clientIp,
        })
        expect(secondSave.status(), 'the second autosave should succeed').toBe(200)
        const secondSaved = await readJsonSafe<{ revision?: { id?: string }; access_token?: string }>(secondSave)

        const submitRes = await publicSubmit(anonymous, {
          submissionId: run.submissionId,
          accessToken: secondSaved?.access_token ?? run.accessToken,
          baseRevisionId: secondSaved!.revision!.id as string,
          clientIp: run.clientIp,
        })
        expect(submitRes.status(), 'the submit should succeed').toBe(200)
        const submitted = await readJsonSafe<{ submission?: { submitMetadata?: Record<string, unknown> | null } }>(
          submitRes,
        )
        expect(submitted?.submission?.submitMetadata?.ip, 'the submit recorded the participant ip').toBe(
          run.clientIp,
        )

        const anonymizePath = `/api/forms/submissions/${run.submissionId}/anonymize`

        for (const [label, body] of [
          ['an empty body', {}],
          ['a lowercase confirmation', { confirm: 'delete' }],
          ['a near-miss confirmation', { confirm: 'DELETE ' }],
        ] as Array<[string, Record<string, unknown>]>) {
          const response = await apiRequest(request, 'POST', anonymizePath, {
            token: adminToken as string,
            data: body,
          })
          const responseBody = await readJsonSafe<{ error?: string }>(response)
          expect(
            response.status(),
            `${label} must be refused with 422 (got ${response.status()}: ${JSON.stringify(responseBody)})`,
          ).toBe(422)
          expect(responseBody?.error, `${label} names the confirmation requirement`).toBe(
            'forms.errors.confirmation_required',
          )
        }

        // The refused attempts changed nothing.
        const beforeRes = await apiRequest(request, 'GET', `/api/forms/submissions/${run.submissionId}`, {
          token: adminToken as string,
        })
        const before = await readJsonSafe<{
          submission?: { anonymizedAt?: string | null }
          decoded_data?: Record<string, unknown>
        }>(beforeRes)
        expect(before?.submission?.anonymizedAt, 'the refused attempts did not anonymize').toBeNull()
        expect(before?.decoded_data?.diagnosis, 'the sensitive answer is still intact').toBe(sensitiveAnswer)

        const auditBefore = await readAccessAudit(request, adminToken as string, run.submissionId)

        const anonymizeRes = await apiRequest(request, 'POST', anonymizePath, {
          token: adminToken as string,
          data: { confirm: 'DELETE' },
        })
        const anonymized = await readJsonSafe<{
          submissionId?: string
          revisionsAnonymized?: number
          anonymizedAt?: string
        }>(anonymizeRes)
        expect(
          anonymizeRes.status(),
          `the exact confirmation should be accepted (got ${anonymizeRes.status()}: ${JSON.stringify(anonymized)})`,
        ).toBe(200)
        expect(anonymized?.submissionId).toBe(run.submissionId)
        expect(anonymized?.anonymizedAt, 'the response stamps when erasure happened').toBeTruthy()
        expect(
          typeof anonymized?.revisionsAnonymized === 'number' && anonymized.revisionsAnonymized >= 1,
          'at least the revisions carrying the sensitive value were rewritten',
        ).toBe(true)

        const afterRes = await apiRequest(request, 'GET', `/api/forms/submissions/${run.submissionId}`, {
          token: adminToken as string,
        })
        const after = await readJsonSafe<{
          submission?: { anonymizedAt?: string | null; submitMetadata?: Record<string, unknown> | null }
          decoded_data?: Record<string, unknown>
        }>(afterRes)
        expect(afterRes.status(), 'an anonymized submission is still readable').toBe(200)
        expect(after?.submission?.anonymizedAt, 'the submission records the erasure').toBeTruthy()
        expect(after?.decoded_data?.diagnosis, 'the sensitive answer is tombstoned').toBe('__anonymized__')
        expect(after?.decoded_data?.full_name, 'the non-sensitive answer survives erasure').toBe(publicAnswer)
        expect(after?.decoded_data?.consented, 'other non-sensitive answers survive too').toBe(true)
        expect(
          after?.submission?.submitMetadata?.ip,
          'the participant ip is cleared from the submit metadata',
        ).toBeUndefined()
        expect(
          after?.submission?.submitMetadata?.userAgent,
          'the participant user-agent is cleared from the submit metadata',
        ).toBeUndefined()
        expect(
          after?.submission?.submitMetadata?.anonymized_at,
          'the submit metadata is replaced by the erasure marker',
        ).toBeTruthy()

        // Erasure reaches EVERY revision, not just the current one.
        const timelineRes = await apiRequest(
          request,
          'GET',
          `/api/forms/submissions/${run.submissionId}/revisions`,
          { token: adminToken as string },
        )
        const timeline = await readJsonSafe<{ revisions?: Array<{ id: string; anonymizedAt: string | null }> }>(
          timelineRes,
        )
        const revisions = timeline?.revisions ?? []
        expect(revisions.length, 'the revision chain is not truncated by erasure').toBe(3)
        expect(
          revisions.filter((revision) => revision.anonymizedAt !== null).length,
          'the revisions that held the sensitive value are marked anonymized',
        ).toBe(anonymized?.revisionsAnonymized)

        // The export is the other decryption boundary — it must not leak either.
        const exportRes = await apiRequest(
          request,
          'GET',
          `/api/forms/submissions/${run.submissionId}/export`,
          { token: adminToken as string },
        )
        expect(exportRes.status(), 'the export of an anonymized submission still works').toBe(200)
        const exportText = await exportRes.text()
        expect(
          exportText,
          'the sensitive value must be gone from the export, not merely hidden on the detail page',
        ).not.toContain(sensitiveAnswer)
        expect(exportText, 'the non-sensitive answer is still exportable').toContain(publicAnswer)

        // The audit skeleton survives erasure — who looked is not personal data
        // of the subject and is the evidence the erasure itself is auditable.
        const auditAfter = await readAccessAudit(request, adminToken as string, run.submissionId)
        expect(
          auditAfter.length >= auditBefore.length,
          'erasure does not delete the access-audit trail',
        ).toBe(true)
        expect(
          auditAfter.some((row) => row.accessPurpose === 'anonymize'),
          'the erasure itself is recorded in the audit trail',
        ).toBe(true)
      })
    } finally {
      await deleteDistributionIfExists(request, adminToken, distributionId)
      await deleteFormIfExists(request, adminToken, formId)
    }
  })
})
