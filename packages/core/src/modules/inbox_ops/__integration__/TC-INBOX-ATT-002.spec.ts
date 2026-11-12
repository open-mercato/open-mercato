import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { ownerPolicyRequest } from '@open-mercato/core/helpers/integration/attachmentAccessFixtures'
import {
  INGEST_QUEUE,
  WEBHOOK_SPEC_TIMEOUT_MS,
  cleanupInboundEmails,
  createInboundTracker,
  findInboundEmailIds,
  listEmailAttachmentParts,
  postResendEmailReceived,
  readEmailAttachmentRows,
  receiveInboundEmail,
  resolveInboxAddress,
  skipUnlessResendStubAvailable,
  uniqueRunId,
} from './helpers/inboundAttachments'
import { drainIntegrationQueue } from '@open-mercato/core/helpers/integration/queue'

export const integrationMeta = { dependsOnModules: ['example', 'attachments'] }

/**
 * TC-INBOX-ATT-002: a redelivered webhook creates no second email and no second file; two
 * attachment-only emails with the same sender, subject and attachment metadata but different
 * bytes, Message-IDs and attachment ids are both kept, each with its own stored file (D13).
 * Spec: .ai/specs/2026-10-25-inbox-ops-inbound-attachments.md
 */
test.describe('TC-INBOX-ATT-002: deduplication of inbound mail with attachments', () => {
  test('ignores a redelivery and keeps two look-alike attachment-only emails apart', async ({ request }) => {
    test.setTimeout(WEBHOOK_SPEC_TIMEOUT_MS)
    await skipUnlessResendStubAvailable()
    const admin = await getAuthToken(request, 'admin')
    const tracker = createInboundTracker()
    const run = uniqueRunId('TC-INBOX-ATT-002')
    try {
      const to = await resolveInboxAddress(request, admin)
      const first = await receiveInboundEmail(request, admin, tracker, {
        to,
        subject: `Redelivery ${run}`,
        text: 'Order attached.',
        attachments: [{ filename: `${run}-order.txt`, contentType: 'text/plain', content: 'order 1' }],
      })
      const filesBefore = await readEmailAttachmentRows(first.emailId)
      expect(filesBefore).toHaveLength(1)

      const from = `Redelivery ${run} <supplier@tc-inbox-att.example.test>`
      expect(await postResendEmailReceived({ providerEmailId: first.providerEmailId, to, from })).toBe(200)
      await drainIntegrationQueue(INGEST_QUEUE)
      expect(await findInboundEmailIds(admin, first.providerEmailId)).toEqual([first.emailId])
      expect((await readEmailAttachmentRows(first.emailId)).map((row) => row.id)).toEqual(filesBefore.map((row) => row.id))
      expect(await listEmailAttachmentParts(request, admin, first.emailId)).toHaveLength(1)

      const sender = `Look-alike ${run} <offers@tc-inbox-att.example.test>`
      const subject = `Offer ${run}`
      const lookAlike = (content: string) => ({
        to,
        from: sender,
        subject,
        text: '',
        attachments: [{ filename: 'offer.csv', contentType: 'text/csv', content }],
      })
      const left = await receiveInboundEmail(request, admin, tracker, lookAlike('sku,qty\nAAA,1\n'))
      const right = await receiveInboundEmail(request, admin, tracker, lookAlike('sku,qty\nBBB,2\n'))

      expect(left.emailId).not.toBe(right.emailId)
      expect(left.messageId).not.toBe(right.messageId)
      expect(left.attachments[0].id).not.toBe(right.attachments[0].id)
      expect(left.attachments[0].size).toBe(right.attachments[0].size)

      const contents: string[] = []
      for (const email of [left, right]) {
        const parts = await listEmailAttachmentParts(request, admin, email.emailId)
        expect(parts.map((part) => part.status)).toEqual(['stored'])
        expect(email.email.attachmentIds).toEqual([parts[0].attachmentId])
        const download = await ownerPolicyRequest('GET', `/api/attachments/file/${parts[0].attachmentId}`, admin)
        expect(download.status).toBe(200)
        contents.push(download.bytes.toString('utf8'))
      }
      expect(contents).toEqual(['sku,qty\nAAA,1\n', 'sku,qty\nBBB,2\n'])
    } finally {
      await cleanupInboundEmails(request, admin, tracker)
    }
  })
})
