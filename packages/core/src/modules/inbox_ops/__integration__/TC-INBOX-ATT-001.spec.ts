import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { ownerPolicyRequest, type OwnerAccessList } from '@open-mercato/core/helpers/integration/attachmentAccessFixtures'
import { deleteAttachmentIfExists, uploadAttachmentFixture } from '@open-mercato/core/helpers/integration/attachmentsFixtures'
import { getTokenContext } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  INBOUND_EMAIL_ENTITY_ID,
  WEBHOOK_SPEC_TIMEOUT_MS,
  cleanupInboundEmails,
  createInboundTracker,
  listEmailAttachmentParts,
  readEmailAttachmentRows,
  receiveInboundEmail,
  resolveInboxAddress,
  skipUnlessResendStubAvailable,
  uniqueRunId,
} from './helpers/inboundAttachments'

export const integrationMeta = { dependsOnModules: ['example', 'attachments'] }

/**
 * TC-INBOX-ATT-001: a Resend email with two files stores two scoped Attachment rows owned by the
 * email, fills `attachmentIds`, lists both parts as `stored`, leaves `Attachment.content` empty,
 * and keeps the files out of the shared library while the record-scoped list returns them.
 * Spec: .ai/specs/2026-10-25-inbox-ops-inbound-attachments.md
 */
test.describe('TC-INBOX-ATT-001: Resend attachments are stored as files owned by the email', () => {
  test('stores both parts as private attachments of the email, hidden from the library', async ({ request }) => {
    test.setTimeout(WEBHOOK_SPEC_TIMEOUT_MS)
    await skipUnlessResendStubAvailable()
    const admin = await getAuthToken(request, 'admin')
    const scope = getTokenContext(admin)
    const tracker = createInboundTracker()
    const run = uniqueRunId('TC-INBOX-ATT-001')
    let controlId: string | null = null
    try {
      const offer = `Offer ${run}: 3 x Premium Widget at 50 EUR`
      const lines = 'sku,qty,price\nPW-1,3,50\n'
      const received = await receiveInboundEmail(request, admin, tracker, {
        to: await resolveInboxAddress(request, admin),
        subject: `Offer ${run}`,
        text: 'Please find our offer attached.',
        attachments: [
          { filename: `${run}-offer.txt`, contentType: 'text/plain', content: offer },
          { filename: `${run}-lines.csv`, contentType: 'text/csv', content: lines },
        ],
      })

      const attachmentIds = received.email.attachmentIds ?? []
      expect(attachmentIds).toHaveLength(2)

      const parts = await listEmailAttachmentParts(request, admin, received.emailId)
      expect(parts.map((part) => part.status)).toEqual(['stored', 'stored'])
      expect(parts.map((part) => part.fileName).sort()).toEqual([`${run}-lines.csv`, `${run}-offer.txt`])
      expect(parts.map((part) => part.partKey).sort()).toEqual(received.attachments.map((attachment) => `resend:${attachment.id}`).sort())
      const offerPart = parts.find((part) => part.fileName === `${run}-offer.txt`)
      for (const part of parts) {
        expect(attachmentIds).toContain(part.attachmentId)
        expect(part.url).toBe(`/api/attachments/file/${part.attachmentId}`)
        expect(part.reason).toBeNull()
      }

      const rows = await readEmailAttachmentRows(received.emailId)
      expect(rows.map((row) => row.id).sort()).toEqual([...attachmentIds].sort())
      for (const row of rows) {
        expect(row.entity_id).toBe(INBOUND_EMAIL_ENTITY_ID)
        expect(row.partition_code).toBe('privateAttachments')
        expect(row.tenant_id).toBe(scope.tenantId)
        expect(row.organization_id).toBe(scope.organizationId)
        expect(row.content ?? '').toBe('')
      }

      const recordList = await ownerPolicyRequest<OwnerAccessList>(
        'GET',
        `/api/attachments?entityId=${encodeURIComponent(INBOUND_EMAIL_ENTITY_ID)}&recordId=${received.emailId}`,
        admin,
      )
      expect(recordList.status).toBe(200)
      expect(recordList.body?.items.map((item) => item.id).sort()).toEqual([...attachmentIds].sort())

      const download = await ownerPolicyRequest('GET', `/api/attachments/file/${offerPart?.attachmentId}`, admin)
      expect(download.status).toBe(200)
      expect(download.bytes.toString('utf8')).toBe(offer)

      const control = await uploadAttachmentFixture(request, admin, {
        entityId: 'attachments:library',
        recordId: randomUUID(),
        fileName: `${run}-control.txt`,
        mimeType: 'text/plain',
        buffer: Buffer.from('library control file'),
      })
      controlId = control.id
      const library = await ownerPolicyRequest<OwnerAccessList>(
        'GET',
        `/api/attachments/library?search=${encodeURIComponent(run)}&pageSize=50`,
        admin,
      )
      expect(library.status).toBe(200)
      const libraryIds = library.body?.items.map((item) => item.id) ?? []
      expect(libraryIds).toContain(controlId)
      for (const attachmentId of attachmentIds) expect(libraryIds).not.toContain(attachmentId)
    } finally {
      await deleteAttachmentIfExists(request, admin, controlId)
      await cleanupInboundEmails(request, admin, tracker)
    }
  })
})
