import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { ownerPolicyRequest, type OwnerAccessList } from '@open-mercato/core/helpers/integration/attachmentAccessFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import {
  INBOUND_EMAIL_ENTITY_ID,
  WEBHOOK_SPEC_TIMEOUT_MS,
  cleanupInboundEmails,
  createInboundTracker,
  fetchInboxEmail,
  receiveInboundEmail,
  resolveInboxAddress,
  skipUnlessResendStubAvailable,
  uniqueRunId,
} from './helpers/inboundAttachments'

export const integrationMeta = { dependsOnModules: ['example', 'attachments'] }

/**
 * TC-INBOX-ATT-007: deleting the email releases its attachments. The deny set alone would already
 * hide the files from the routes, so the database is checked too: no attachment row of the email
 * remains, `attachments_released_at` is set and the ledger rows are `released` with their file
 * name and extracted text cleared.
 * Spec: .ai/specs/2026-10-25-inbox-ops-inbound-attachments.md
 */
test.describe('TC-INBOX-ATT-007: deleting an inbound email releases its attachments', () => {
  test('removes the files and clears the ledger', async ({ request }) => {
    test.setTimeout(WEBHOOK_SPEC_TIMEOUT_MS)
    await skipUnlessResendStubAvailable()
    const admin = await getAuthToken(request, 'admin')
    const tracker = createInboundTracker()
    const run = uniqueRunId('TC-INBOX-ATT-007')
    try {
      const received = await receiveInboundEmail(request, admin, tracker, {
        to: await resolveInboxAddress(request, admin),
        subject: `Delivery note ${run}`,
        text: 'Delivery notes attached.',
        attachments: [
          { filename: `${run}-note-1.txt`, contentType: 'text/plain', content: 'delivery note one' },
          { filename: `${run}-note-2.txt`, contentType: 'text/plain', content: 'delivery note two' },
        ],
      })
      const attachmentIds = received.email.attachmentIds ?? []
      expect(attachmentIds).toHaveLength(2)
      const ledgerBefore = await withClient(async (client) => (await client.query<{ file_name: string | null; extracted_text: string | null }>(
        'select file_name, extracted_text from inbox_email_attachments where inbox_email_id = $1',
        [received.emailId],
      )).rows)
      expect(ledgerBefore.every((row) => row.file_name !== null && row.extracted_text !== null)).toBe(true)

      const deleted = await apiRequest(request, 'DELETE', `/api/inbox_ops/emails/${received.emailId}`, { token: admin })
      expect(deleted.status()).toBe(200)

      for (const attachmentId of attachmentIds) {
        expect((await ownerPolicyRequest('GET', `/api/attachments/file/${attachmentId}`, admin)).status).toBe(404)
      }
      const recordList = await ownerPolicyRequest<OwnerAccessList>(
        'GET',
        `/api/attachments?entityId=${encodeURIComponent(INBOUND_EMAIL_ENTITY_ID)}&recordId=${received.emailId}`,
        admin,
      )
      expect(recordList.status).toBe(200)
      expect(recordList.body?.items ?? []).toEqual([])
      expect((await fetchInboxEmail(request, admin, received.emailId)).status).toBe(404)

      const state = await withClient(async (client) => {
        const files = await client.query<{ id: string }>(
          `select id from attachments
            where id = any($1::uuid[])
               or (entity_id = $2 and record_id = $3)
               or storage_metadata @> $4::jsonb`,
          [attachmentIds, INBOUND_EMAIL_ENTITY_ID, received.emailId, JSON.stringify({ assignments: [{ type: INBOUND_EMAIL_ENTITY_ID, id: received.emailId }] })],
        )
        const email = await client.query<{ released: boolean; deleted: boolean }>(
          `select attachments_released_at is not null as released, deleted_at is not null as deleted
             from inbox_emails where id = $1`,
          [received.emailId],
        )
        const ledger = await client.query<{ status: string; file_name: string | null; extracted_text: string | null }>(
          'select status, file_name, extracted_text from inbox_email_attachments where inbox_email_id = $1',
          [received.emailId],
        )
        return { files: files.rows, email: email.rows[0], ledger: ledger.rows }
      })
      expect(state.files).toEqual([])
      expect(state.email).toEqual({ released: true, deleted: true })
      expect(state.ledger).toHaveLength(2)
      expect(state.ledger).toEqual(state.ledger.map(() => ({ status: 'released', file_name: null, extracted_text: null })))
    } finally {
      await cleanupInboundEmails(request, admin, tracker)
    }
  })
})
