import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken, withCredentialIsolatedRequest } from '@open-mercato/core/helpers/integration/api'
import {
  createCustomerUserFixture,
  deleteCustomerUserFixture,
  portalCookieHeaders,
  portalLogin,
} from '@open-mercato/core/helpers/integration/customerAccountsFixtures'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  buildFileFieldFormSchema,
  buildTinyPngBytes,
  createPublishedFormFixture,
  deleteFormIfExists,
  forkDraftFixture,
  portalCall,
  publicUploadAttachment,
  publishVersionFixture,
  updateDraftFixture,
} from '@open-mercato/core/helpers/integration/formsFixtures'

test.describe('TC-FORMS-ATT-005: public attachments enforce pinned field roles', () => {
  test('keeps reviewer-only bytes private and permits read-only downloads on a shared submission', async ({ request }) => {
    const stamp = randomUUID()
    let adminToken: string | null = null
    let formId: string | null = null
    const customerIds: string[] = []

    try {
      adminToken = await getAuthToken(request, 'admin')
      const { tenantId } = getTokenContext(adminToken)
      const schema = buildFileFieldFormSchema()
      const roles = ['admin', 'participant', 'reviewer']
      schema['x-om-roles'] = roles
      const properties = schema.properties as Record<string, Record<string, unknown>>
      properties.scan['x-om-editable-by'] = ['reviewer']
      properties.scan['x-om-visible-to'] = ['reviewer']
      properties.shared_scan = {
        ...properties.scan,
        'x-om-visible-to': ['participant', 'reviewer'],
      }
      const published = await createPublishedFormFixture(request, adminToken, { schema, roles })
      formId = published.formId

      const participant = await createCustomerUserFixture(request, adminToken, {
        email: `qa-att005-participant-${stamp}@test.local`,
        displayName: 'Attachment participant',
      })
      customerIds.push(participant.id)
      const reviewer = await createCustomerUserFixture(request, adminToken, {
        email: `qa-att005-reviewer-${stamp}@test.local`,
        displayName: 'Attachment reviewer',
      })
      customerIds.push(reviewer.id)

      await withCredentialIsolatedRequest(async (participantRequest) => {
        await withCredentialIsolatedRequest(async (reviewerRequest) => {
          const participantCookies = portalCookieHeaders(await portalLogin(participantRequest, {
            email: participant.email, password: participant.password, tenantId,
          }))
          const reviewerCookies = portalCookieHeaders(await portalLogin(reviewerRequest, {
            email: reviewer.email, password: reviewer.password, tenantId,
          }))
          const start = await portalCall(participantRequest, 'POST', '/api/forms/form-submissions', {
            cookies: participantCookies,
            data: { form_key: published.formKey, subject_type: 'customer', subject_id: participant.id },
          })
          expect(start.status()).toBe(201)
          const started = await readJsonSafe<{ submission: { id: string } }>(start)
          const submissionId = started!.submission.id
          const assign = await apiRequest(request, 'POST', `/api/forms/submissions/${submissionId}/actors`, {
            token: adminToken!,
            data: { user_id: reviewer.id, role: 'reviewer' },
          })
          expect(assign.status()).toBeLessThan(300)

          const bytes = buildTinyPngBytes()
          const uploadInput = {
            submissionId, fieldKey: 'scan', filename: 'private-scan.png', contentType: 'image/png', bytes,
          }
          const allowedUpload = await publicUploadAttachment(reviewerRequest, {
            ...uploadInput, headers: reviewerCookies,
          })
          expect(allowedUpload.status()).toBe(201)
          const stored = await readJsonSafe<{ id: string }>(allowedUpload)
          const attachmentPath = `/api/forms/public/submissions/${submissionId}/attachments/${stored!.id}`
          const allowedDownload = await portalCall(reviewerRequest, 'GET', attachmentPath, { cookies: reviewerCookies })
          expect(allowedDownload.status()).toBe(200)
          expect(await allowedDownload.body()).toEqual(bytes)

          const newerSchema = structuredClone(schema)
          const newerProperties = newerSchema.properties as Record<string, Record<string, unknown>>
          newerProperties.scan['x-om-editable-by'] = ['participant', 'reviewer']
          newerProperties.scan['x-om-visible-to'] = ['participant', 'reviewer']
          const newerVersionId = await forkDraftFixture(request, adminToken!, formId!)
          await updateDraftFixture(request, adminToken!, formId!, newerVersionId, { schema: newerSchema, roles })
          await publishVersionFixture(request, adminToken!, formId!, newerVersionId)

          const deniedUpload = await publicUploadAttachment(participantRequest, {
            ...uploadInput, headers: participantCookies,
          })
          expect(deniedUpload.status()).toBe(404)
          expect(await readJsonSafe(deniedUpload)).toEqual({ error: 'NOT_FOUND' })
          const deniedDownload = await portalCall(participantRequest, 'GET', attachmentPath, { cookies: participantCookies })
          expect(deniedDownload.status()).toBe(404)
          const denial = await readJsonSafe(deniedDownload)
          expect(denial).toEqual({ error: 'NOT_FOUND' })
          const missingDownload = await portalCall(participantRequest, 'GET',
            `/api/forms/public/submissions/${submissionId}/attachments/${randomUUID()}`, { cookies: participantCookies })
          expect(missingDownload.status()).toBe(404)
          expect(await readJsonSafe(missingDownload)).toEqual(denial)

          const sharedUpload = await publicUploadAttachment(reviewerRequest, {
            ...uploadInput, fieldKey: 'shared_scan', headers: reviewerCookies,
          })
          expect(sharedUpload.status()).toBe(201)
          const shared = await readJsonSafe<{ id: string }>(sharedUpload)
          const sharedDownload = await portalCall(participantRequest, 'GET',
            `/api/forms/public/submissions/${submissionId}/attachments/${shared!.id}`, { cookies: participantCookies })
          expect(sharedDownload.status()).toBe(200)
          expect(await sharedDownload.body()).toEqual(bytes)
          const readOnlyUpload = await publicUploadAttachment(participantRequest, {
            ...uploadInput, fieldKey: 'shared_scan', headers: participantCookies,
          })
          expect(readOnlyUpload.status()).toBe(404)
        })
      })
    } finally {
      await deleteFormIfExists(request, adminToken, formId)
      for (const customerId of customerIds.reverse()) {
        await deleteCustomerUserFixture(request, adminToken, customerId)
      }
    }
  })
})
