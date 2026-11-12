import { randomUUID } from 'node:crypto'
import { inflateSync } from 'node:zlib'
import { expect, test, type APIResponse } from '@playwright/test'
import { apiRequest, getAuthToken, withCredentialIsolatedRequest } from '@open-mercato/core/helpers/integration/api'
import {
  createCustomerUserFixture,
  deleteCustomerUserFixture,
  portalCookieHeaders,
  portalLogin,
} from '@open-mercato/core/helpers/integration/customerAccountsFixtures'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createPublishedFormFixture,
  deleteFormIfExists,
  portalCall,
  waitForAutosaveWindow,
} from '@open-mercato/core/helpers/integration/formsFixtures'

/**
 * TC-FORMS-PDF-016: the participant PDF carries only the answers the
 * participant's role may read, like the JSON read of the same submission;
 * staff keep the full canonical snapshot.
 *
 * Fixture: a three-role form (admin / participant / reviewer). Customer A
 * starts it on the portal (auto-assigned `participant`), staff assign customer
 * B as `reviewer`, B fills the reviewer-only note, A submits. The participant
 * PDF is fetched first (before any staff read, so the canonical snapshot is
 * stored only if the on-submit job already produced it) and again after the
 * staff route has certainly stored it. Neither participant read may change the
 * stored snapshot link. The staff PDF containing the reviewer note is the
 * positive control for the text probe.
 *
 * Text probe: pdf-lib flate-encodes content streams and writes Helvetica text
 * as hex strings, so the probe inflates every stream and looks for the hex
 * form of a short uppercase ASCII marker.
 */

function pdfContains(bytes: Buffer, text: string): boolean {
  const raw = bytes.toString('latin1')
  const decoded: string[] = [raw]
  let cursor = 0
  for (;;) {
    const start = raw.indexOf('stream', cursor)
    if (start < 0) break
    const bodyStart = raw[start + 6] === '\r' ? start + 8 : start + 7
    const end = raw.indexOf('endstream', bodyStart)
    if (end < 0) break
    cursor = end + 9
    try {
      decoded.push(inflateSync(bytes.subarray(bodyStart, end)).toString('latin1'))
    } catch {
      continue
    }
  }
  const haystack = decoded.join('\n')
  const hex = Buffer.from(text, 'latin1').toString('hex')
  return haystack.includes(`(${text})`) || haystack.toLowerCase().includes(`<${hex}>`)
}

async function readPdf(response: APIResponse, label: string): Promise<Buffer> {
  expect(response.status(), `${label} should return 200 (got ${response.status()})`).toBe(200)
  expect(response.headers()['content-type'] ?? '', `${label} is a PDF`).toContain('application/pdf')
  const bytes = await response.body()
  expect(bytes.subarray(0, 5).toString('ascii'), `${label} body starts with %PDF-`).toBe('%PDF-')
  return bytes
}

function buildRoleSplitSchema(): Record<string, unknown> {
  return {
    type: 'object',
    'x-om-roles': ['admin', 'participant', 'reviewer'],
    'x-om-default-actor-role': 'participant',
    'x-om-sections': [
      { key: 'answers', title: { en: 'Answers' }, fieldKeys: ['full_name', 'reviewer_note'] },
    ],
    properties: {
      full_name: {
        type: 'string',
        minLength: 1,
        maxLength: 200,
        'x-om-type': 'text',
        'x-om-label': { en: 'Full name' },
        'x-om-editable-by': ['participant'],
        'x-om-visible-to': ['admin', 'participant', 'reviewer'],
      },
      reviewer_note: {
        type: 'string',
        maxLength: 2000,
        'x-om-type': 'textarea',
        'x-om-label': { en: 'Reviewer note' },
        'x-om-editable-by': ['reviewer'],
        'x-om-visible-to': ['admin', 'reviewer'],
      },
    },
    required: ['full_name'],
  }
}

test.describe('TC-FORMS-PDF-016: participant PDF is role-sliced like the JSON read', () => {
  test('participant PDF omits reviewer-only answers; staff PDF keeps them', async ({ request }) => {
    test.setTimeout(180_000)

    const stamp = `${Date.now()}-${randomUUID().slice(0, 8)}`
    const marker = randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()
    const participantMarker = `PART${marker}`
    const reviewerMarker = `RVW${marker}`
    let adminToken: string | null = null
    let formId: string | null = null
    let participantId: string | null = null
    let reviewerId: string | null = null

    try {
      adminToken = await getAuthToken(request, 'admin')
      const { tenantId } = getTokenContext(adminToken)

      const published = await createPublishedFormFixture(request, adminToken, {
        name: `QA PDF016 ${stamp}`,
        schema: buildRoleSplitSchema(),
        uiSchema: {},
        roles: ['admin', 'participant', 'reviewer'],
      })
      formId = published.formId

      const participant = await createCustomerUserFixture(request, adminToken, {
        email: `qa-forms-pdf016-p-${stamp}@test.local`,
        displayName: `QA PDF016 participant ${stamp}`,
      })
      participantId = participant.id
      const reviewer = await createCustomerUserFixture(request, adminToken, {
        email: `qa-forms-pdf016-r-${stamp}@test.local`,
        displayName: `QA PDF016 reviewer ${stamp}`,
      })
      reviewerId = reviewer.id

      await withCredentialIsolatedRequest(async (participantRequest) => {
        await withCredentialIsolatedRequest(async (reviewerRequest) => {
          const participantCookies = portalCookieHeaders(
            await portalLogin(participantRequest, {
              email: participant.email,
              password: participant.password,
              tenantId,
            }),
          )
          const reviewerCookies = portalCookieHeaders(
            await portalLogin(reviewerRequest, {
              email: reviewer.email,
              password: reviewer.password,
              tenantId,
            }),
          )

          const startRes = await portalCall(participantRequest, 'POST', '/api/forms/form-submissions', {
            cookies: participantCookies,
            data: { form_key: published.formKey, subject_type: 'customer', subject_id: participant.id },
          })
          const started = await readJsonSafe<{
            submission?: { id?: string }
            revision?: { id?: string }
          }>(startRes)
          expect(startRes.status(), `portal start should return 201 (got ${startRes.status()})`).toBe(201)
          const submissionId = started!.submission!.id as string
          let revisionId = started!.revision!.id as string

          await waitForAutosaveWindow()
          const participantSave = await portalCall(
            participantRequest,
            'PATCH',
            `/api/forms/form-submissions/${submissionId}`,
            {
              cookies: participantCookies,
              data: { base_revision_id: revisionId, patch: { full_name: participantMarker } },
            },
          )
          expect(participantSave.status(), 'participant autosave should return 200').toBe(200)
          revisionId = (await readJsonSafe<{ revision?: { id?: string } }>(participantSave))!.revision!.id as string

          const assignRes = await apiRequest(request, 'POST', `/api/forms/submissions/${submissionId}/actors`, {
            token: adminToken!,
            data: { user_id: reviewer.id, role: 'reviewer' },
          })
          expect(
            assignRes.status(),
            `assigning the reviewer actor should succeed (got ${assignRes.status()}: ${await assignRes.text()})`,
          ).toBeLessThan(300)

          await waitForAutosaveWindow()
          const reviewerSave = await portalCall(
            reviewerRequest,
            'PATCH',
            `/api/forms/form-submissions/${submissionId}`,
            {
              cookies: reviewerCookies,
              data: { base_revision_id: revisionId, patch: { reviewer_note: reviewerMarker } },
            },
          )
          expect(
            reviewerSave.status(),
            `reviewer autosave should return 200 (got ${reviewerSave.status()}: ${await reviewerSave.text()})`,
          ).toBe(200)
          revisionId = (await readJsonSafe<{ revision?: { id?: string } }>(reviewerSave))!.revision!.id as string

          const submitRes = await portalCall(
            participantRequest,
            'POST',
            `/api/forms/form-submissions/${submissionId}/submit`,
            { cookies: participantCookies, data: { base_revision_id: revisionId } },
          )
          expect(submitRes.status(), `participant submit should return 200 (got ${submitRes.status()})`).toBe(200)

          const jsonRead = await portalCall(participantRequest, 'GET', `/api/forms/form-submissions/${submissionId}`, {
            cookies: participantCookies,
          })
          expect(jsonRead.status()).toBe(200)
          const view = await readJsonSafe<{ decoded_data?: Record<string, unknown> }>(jsonRead)
          expect(view?.decoded_data?.full_name).toBe(participantMarker)
          expect(view?.decoded_data, 'the JSON read hides the reviewer-only answer').not.toHaveProperty('reviewer_note')

          const readStoredSnapshotId = async (): Promise<string | null> => {
            const response = await portalCall(participantRequest, 'GET', `/api/forms/form-submissions/${submissionId}`, {
              cookies: participantCookies,
            })
            expect(response.status()).toBe(200)
            const body = await readJsonSafe<{ submission?: { pdfSnapshotAttachmentId?: string | null } }>(response)
            return body?.submission?.pdfSnapshotAttachmentId ?? null
          }

          const publicPdfPath = `/api/forms/public/submissions/${submissionId}/pdf`

          const snapshotIdBeforeParticipantRead = await readStoredSnapshotId()
          const firstParticipantPdf = await readPdf(
            await portalCall(participantRequest, 'GET', publicPdfPath, { cookies: participantCookies }),
            'participant PDF (first)',
          )
          expect(pdfContains(firstParticipantPdf, participantMarker), 'participant sees their own answer').toBe(true)
          expect(
            pdfContains(firstParticipantPdf, reviewerMarker),
            'participant PDF must not contain the reviewer-only answer',
          ).toBe(false)
          expect(
            await readStoredSnapshotId(),
            'the first participant PDF read stores and links nothing',
          ).toBe(snapshotIdBeforeParticipantRead)

          const staffPdf = await readPdf(
            await apiRequest(request, 'GET', `/api/forms/submissions/${submissionId}/pdf`, { token: adminToken! }),
            'staff PDF',
          )
          expect(pdfContains(staffPdf, participantMarker), 'staff PDF carries the participant answer').toBe(true)
          expect(pdfContains(staffPdf, reviewerMarker), 'staff PDF carries the reviewer-only answer').toBe(true)
          const storedSnapshotId = await readStoredSnapshotId()
          expect(storedSnapshotId, 'the staff read stores the canonical snapshot').not.toBeNull()

          const secondParticipantPdf = await readPdf(
            await portalCall(participantRequest, 'GET', publicPdfPath, { cookies: participantCookies }),
            'participant PDF (after canonical stored)',
          )
          expect(pdfContains(secondParticipantPdf, reviewerMarker)).toBe(false)
          expect(
            await readStoredSnapshotId(),
            'a participant PDF read never replaces the canonical snapshot link',
          ).toBe(storedSnapshotId)

          const staffPdfAgain = await readPdf(
            await apiRequest(request, 'GET', `/api/forms/submissions/${submissionId}/pdf`, { token: adminToken! }),
            'staff PDF (again)',
          )
          expect(staffPdfAgain.equals(staffPdf), 'the canonical snapshot is immutable').toBe(true)

          const reviewerPdf = await readPdf(
            await portalCall(reviewerRequest, 'GET', publicPdfPath, { cookies: reviewerCookies }),
            'reviewer PDF',
          )
          expect(pdfContains(reviewerPdf, reviewerMarker)).toBe(true)
          expect(pdfContains(reviewerPdf, participantMarker)).toBe(true)
        })
      })
    } finally {
      await deleteCustomerUserFixture(request, adminToken, reviewerId)
      await deleteCustomerUserFixture(request, adminToken, participantId)
      await deleteFormIfExists(request, adminToken, formId)
    }
  })
})
