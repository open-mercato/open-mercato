import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import {
  apiRequest,
  getAuthToken,
  withCredentialIsolatedRequest,
} from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  buildFileFieldFormSchema,
  buildTinyPngBytes,
  createDistributionFixture,
  createInvitationsFixture,
  createPublishedFormFixture,
  deleteDistributionIfExists,
  deleteFormIfExists,
  listFormSubmissions,
  listInvitations,
  publicAutosave,
  readDistribution,
  publicRead,
  publicSubmit,
  publicUploadAttachment,
  startPublicSubmissionOrThrow,
  uniqueClientIp,
  waitForAutosaveWindow,
} from '@open-mercato/core/helpers/integration/formsFixtures'

/**
 * TC-FORMS-INV-015: revoking an invitation ends the access tokens already minted for it.
 *
 * The raw invitation link is refused once revoked (TC-FORMS-INV-012), but a respondent who
 * already exchanged it for a submission access token kept full access: the bearer was checked
 * only for signature and expiry, every autosave re-issued a fresh one, and submit flipped the
 * revoked invitation back to `submitted`. Every public route that accepts the token is probed
 * with both the original and the autosave-refreshed token after the revoke; a control
 * invitation proves the same calls succeed while the invitation is live and that a submitted
 * respondent can still read their submission and PDF until the invitation is revoked.
 */

type JsonRecord = Record<string, unknown>

async function readInvitationRow(
  request: APIRequestContext,
  adminToken: string,
  distributionId: string,
  invitationId: string,
): Promise<JsonRecord | undefined> {
  const listed = await listInvitations(request, adminToken, distributionId)
  return (listed?.items ?? []).find((item) => item.id === invitationId)
}

async function readSubmissionStatus(
  request: APIRequestContext,
  adminToken: string,
  formId: string,
  submissionId: string,
): Promise<string | undefined> {
  const response = await listFormSubmissions(request, adminToken, formId)
  const body = await readJsonSafe<{ items?: JsonRecord[] }>(response)
  const row = (body?.items ?? []).find((item) => item.id === submissionId)
  return row?.status as string | undefined
}

async function expectUnauthorized(label: string, response: { status(): number; text(): Promise<string> }) {
  const text = await response.text()
  expect.soft(response.status(), `${label} must be refused after revoke (got ${response.status()}: ${text.slice(0, 200)})`).toBe(401)
  expect.soft(text, `${label} must not hand out a credential`).not.toContain('access_token')
}

test.describe('TC-FORMS-INV-015: revoked invitations end issued access tokens', () => {
  test('old and refreshed tokens are refused on every public route after revoke', async ({ request }) => {
    test.setTimeout(240_000)

    const stamp = `${Date.now()}-${randomUUID().slice(0, 8)}`
    const bytes = buildTinyPngBytes()
    let adminToken: string | null = null
    let formId: string | null = null
    let distributionId: string | null = null

    try {
      adminToken = await getAuthToken(request, 'admin')
      const published = await createPublishedFormFixture(request, adminToken, {
        name: `QA INV015 ${stamp}`,
        schema: buildFileFieldFormSchema({ accept: ['image/png'], maxSizeBytes: 4096 }),
      })
      formId = published.formId

      const distribution = await createDistributionFixture(request, adminToken, formId, { mode: 'personal' })
      distributionId = distribution.id

      const [revoked, control] = await createInvitationsFixture(request, adminToken, distributionId, [
        { ref: `qa-inv015-revoked-${stamp}` },
        { ref: `qa-inv015-control-${stamp}` },
      ])
      expect(revoked.rawToken, 'the revoked invitation minted a raw token').toBeTruthy()
      expect(control.rawToken, 'the control invitation minted a raw token').toBeTruthy()

      await withCredentialIsolatedRequest(async (anonymous) => {
        const clientIp = uniqueClientIp()
        const started = await startPublicSubmissionOrThrow(anonymous, {
          token: revoked.rawToken as string,
          clientIp,
        })
        const submissionId = started.submissionId

        const uploadRes = await publicUploadAttachment(anonymous, {
          submissionId,
          accessToken: started.accessToken,
          fieldKey: 'scan',
          filename: 'qa-inv015.png',
          contentType: 'image/png',
          bytes,
          headers: { 'x-forwarded-for': clientIp },
        })
        const uploaded = await readJsonSafe<{ id?: string }>(uploadRes)
        expect(uploadRes.status(), `the live token uploads (got ${uploadRes.status()})`).toBe(201)
        const attachmentId = uploaded?.id as string

        await waitForAutosaveWindow()
        const saveRes = await publicAutosave(anonymous, {
          submissionId,
          accessToken: started.accessToken,
          baseRevisionId: started.revisionId,
          patch: { full_name: 'Before Revoke' },
          clientIp,
        })
        const saved = await readJsonSafe<{ revision?: { id?: string }; access_token?: string }>(saveRes)
        expect(saveRes.status(), `the live token autosaves (got ${saveRes.status()})`).toBe(200)
        const refreshedToken = saved?.access_token as string
        expect(refreshedToken, 'autosave re-issues a token while the invitation is live').toBeTruthy()
        const currentRevisionId = saved?.revision?.id as string

        const revokeRes = await apiRequest(
          request,
          'DELETE',
          `/api/forms/distributions/${distributionId}/invitations/${revoked.id}`,
          { token: adminToken as string },
        )
        expect(revokeRes.status(), `revoking should return 200 (got ${revokeRes.status()})`).toBe(200)
        const responsesBefore = (await readDistribution(request, adminToken as string, distributionId as string))
          ?.responseCount
        expect(typeof responsesBefore, 'the distribution exposes its response counter').toBe('number')

        for (const [label, token] of [
          ['original token', started.accessToken],
          ['refreshed token', refreshedToken],
        ] as const) {
          const headers = { 'x-forwarded-for': uniqueClientIp() }
          await expectUnauthorized(`${label}: GET`, await publicRead(anonymous, { submissionId, accessToken: token, headers }))
          await waitForAutosaveWindow()
          await expectUnauthorized(
            `${label}: PATCH`,
            await publicAutosave(anonymous, {
              submissionId,
              accessToken: token,
              baseRevisionId: currentRevisionId,
              patch: { full_name: 'After Revoke' },
              clientIp: uniqueClientIp(),
            }),
          )
          await expectUnauthorized(
            `${label}: upload`,
            await publicUploadAttachment(anonymous, {
              submissionId,
              accessToken: token,
              fieldKey: 'scan',
              filename: 'qa-inv015-after.png',
              contentType: 'image/png',
              bytes,
              headers,
            }),
          )
          await expectUnauthorized(
            `${label}: attachment download`,
            await anonymous.fetch(`/api/forms/public/submissions/${submissionId}/attachments/${attachmentId}`, {
              method: 'GET',
              headers: { ...headers, Authorization: `Bearer ${token}` },
            }),
          )
          await expectUnauthorized(
            `${label}: PDF`,
            await anonymous.fetch(`/api/forms/public/submissions/${submissionId}/pdf`, {
              method: 'GET',
              headers: { ...headers, Authorization: `Bearer ${token}` },
            }),
          )
          await expectUnauthorized(
            `${label}: submit`,
            await publicSubmit(anonymous, {
              submissionId,
              accessToken: token,
              baseRevisionId: currentRevisionId,
              clientIp: uniqueClientIp(),
            }),
          )
        }

        const revokedRow = await readInvitationRow(request, adminToken as string, distributionId as string, revoked.id)
        expect.soft(revokedRow?.status, 'the refused submit must not resurrect the invitation').toBe('revoked')
        expect.soft(revokedRow?.submittedAt ?? null, 'the revoked invitation was never submitted').toBeNull()
        expect.soft(
          await readSubmissionStatus(request, adminToken as string, formId as string, submissionId),
          'the revoked respondent could not finalize the submission',
        ).toBe('draft')
        expect.soft(
          (await readDistribution(request, adminToken as string, distributionId as string))?.responseCount,
          'a refused submit must not consume a response slot',
        ).toBe(responsesBefore)
      })

      await withCredentialIsolatedRequest(async (anonymous) => {
        const clientIp = uniqueClientIp()
        const started = await startPublicSubmissionOrThrow(anonymous, {
          token: control.rawToken as string,
          clientIp,
        })
        const submissionId = started.submissionId

        await waitForAutosaveWindow()
        const saveRes = await publicAutosave(anonymous, {
          submissionId,
          accessToken: started.accessToken,
          baseRevisionId: started.revisionId,
          patch: { full_name: 'Control Carla' },
          clientIp,
        })
        const saved = await readJsonSafe<{ revision?: { id?: string }; access_token?: string }>(saveRes)
        expect(saveRes.status(), 'a live invitation still autosaves').toBe(200)
        expect(saved?.access_token, 'a live invitation still gets a refreshed token').toBeTruthy()
        const token = saved?.access_token as string

        const submitRes = await publicSubmit(anonymous, {
          submissionId,
          accessToken: token,
          baseRevisionId: saved?.revision?.id as string,
          clientIp,
        })
        expect(submitRes.status(), `a live invitation still submits (got ${submitRes.status()})`).toBe(200)

        const readAfterSubmit = await publicRead(anonymous, {
          submissionId,
          accessToken: token,
          headers: { 'x-forwarded-for': uniqueClientIp() },
        })
        expect(readAfterSubmit.status(), 'a submitted respondent can still read their submission').toBe(200)

        const pdfAfterSubmit = await anonymous.fetch(`/api/forms/public/submissions/${submissionId}/pdf`, {
          method: 'GET',
          headers: { 'x-forwarded-for': uniqueClientIp(), Authorization: `Bearer ${token}` },
        })
        expect(pdfAfterSubmit.status(), 'a submitted respondent can still download their PDF').toBe(200)

        expect(
          (await readInvitationRow(request, adminToken as string, distributionId as string, control.id))?.status,
        ).toBe('submitted')

        const revokeRes = await apiRequest(
          request,
          'DELETE',
          `/api/forms/distributions/${distributionId}/invitations/${control.id}`,
          { token: adminToken as string },
        )
        expect(revokeRes.status()).toBe(200)

        await expectUnauthorized(
          'submitted-then-revoked GET',
          await publicRead(anonymous, {
            submissionId,
            accessToken: token,
            headers: { 'x-forwarded-for': uniqueClientIp() },
          }),
        )
        expect(
          (await readInvitationRow(request, adminToken as string, distributionId as string, control.id))?.status,
        ).toBe('revoked')
      })
    } finally {
      await deleteDistributionIfExists(request, adminToken, distributionId)
      await deleteFormIfExists(request, adminToken, formId)
    }
  })
})
