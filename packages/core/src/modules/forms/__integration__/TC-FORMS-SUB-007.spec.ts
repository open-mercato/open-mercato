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
  readAccessAudit,
  waitForAutosaveWindow,
} from '@open-mercato/core/helpers/integration/formsFixtures'

/**
 * TC-FORMS-SUB-007: the access-audit chain records staff reads and exports, and
 * reading the audit is not itself auditable.
 *
 * This is the guard the GDPR story rests on: who looked at this person's answers,
 * and when. Two properties make or break it.
 *
 * It must record. A staff read must add exactly one `view` row and an `export`
 * exactly one `export` row — not zero (the trail is a lie) and not several (the
 * trail is unreadable).
 *
 * It must not record ITSELF. `GET …/access-audit` does a bare `em.find` with no
 * `auditAccess` hook, deliberately: if reading the log appended to the log, the
 * table would grow without bound on every refresh and the operator inspecting it
 * would pollute the evidence they are inspecting.
 *
 * Rows carry no answer payload — the audit is readable by any `forms.view`
 * holder, so it must stay metadata.
 */
test.describe('TC-FORMS-SUB-007: submission access audit', () => {
  test('records reads and exports, and reading the audit records nothing', async ({ request }) => {
    test.setTimeout(180_000)

    const stamp = `${Date.now()}-${randomUUID().slice(0, 8)}`
    const answer = `QA SUB007 answer ${stamp}`

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
        const saved = await readJsonSafe<{ revision?: { id?: string }; access_token?: string }>(saveRes)
        const submitRes = await publicSubmit(anonymous, {
          submissionId: run.submissionId,
          accessToken: saved?.access_token ?? run.accessToken,
          baseRevisionId: saved!.revision!.id as string,
          clientIp: run.clientIp,
        })
        expect(submitRes.status(), 'the submit should succeed').toBe(200)

        // Participant activity is `surface: 'runtime'` and is deliberately NOT
        // audited — only staff reads are.
        const afterRuntime = await readAccessAudit(request, adminToken as string, run.submissionId)
        const runtimeOnlyCount = afterRuntime.length
        expect(
          runtimeOnlyCount,
          'the participant filling in their own form does not generate staff-access rows',
        ).toBe(0)

        // A staff REVISIONS read is audited as a `view`. Note the detail route is
        // NOT — `getCurrent` hard-codes `surface: 'runtime'` even when the admin
        // route calls it, so the DI hook drops it. That gap is recorded as the
        // skipped TC-FORMS-SUB-018; using the revisions read here keeps this case
        // asserting the property it exists for without pinning that bug.
        const revisionsRes = await apiRequest(
          request,
          'GET',
          `/api/forms/submissions/${run.submissionId}/revisions`,
          { token: adminToken as string },
        )
        expect(revisionsRes.status(), 'the staff revisions read should succeed').toBe(200)
        const afterView = await readAccessAudit(request, adminToken as string, run.submissionId)
        expect(
          afterView.length,
          `a staff revisions read appends exactly one row (had ${runtimeOnlyCount}, now ${afterView.length})`,
        ).toBe(runtimeOnlyCount + 1)
        expect(afterView[0]?.accessPurpose, 'the staff read is recorded as a view').toBe('view')
        expect(afterView[0]?.accessedBy, 'the row names who looked').toBeTruthy()
        expect(afterView[0]?.accessedAt, 'the row is timestamped').toBeTruthy()

        // Reading the audit twice must not move the count.
        const firstAuditRead = await readAccessAudit(request, adminToken as string, run.submissionId)
        const secondAuditRead = await readAccessAudit(request, adminToken as string, run.submissionId)
        expect(
          secondAuditRead.length,
          'reading the audit log does not append to the audit log',
        ).toBe(firstAuditRead.length)
        expect(firstAuditRead.length, 'the audit read left the count where the view read put it').toBe(
          afterView.length,
        )

        const beforeExport = secondAuditRead.length

        const exportRes = await apiRequest(
          request,
          'GET',
          `/api/forms/submissions/${run.submissionId}/export`,
          { token: adminToken as string },
        )
        expect(
          exportRes.status(),
          `the export should succeed (got ${exportRes.status()}: ${await exportRes.text()})`,
        ).toBe(200)

        const afterExport = await readAccessAudit(request, adminToken as string, run.submissionId)
        expect(
          afterExport.length,
          `an export appends exactly one row (had ${beforeExport}, now ${afterExport.length})`,
        ).toBe(beforeExport + 1)
        const exportRows = afterExport.filter((row) => row.accessPurpose === 'export')
        expect(exportRows.length, 'exactly one row is tagged as an export').toBe(1)

        // Every row is metadata only.
        const serialized = JSON.stringify(afterExport)
        expect(serialized, 'audit rows must not carry the decrypted answer').not.toContain(answer)
        for (const row of afterExport) {
          expect(
            Object.keys(row).sort(),
            'the audit projection is a fixed metadata shape',
          ).toEqual(['accessPurpose', 'accessedAt', 'accessedBy', 'id', 'ip', 'revisionId'].sort())
        }
      })
    } finally {
      await deleteDistributionIfExists(request, adminToken, distributionId)
      await deleteFormIfExists(request, adminToken, formId)
    }
  })
})
