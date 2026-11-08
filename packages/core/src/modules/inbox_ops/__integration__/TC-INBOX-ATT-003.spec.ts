import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  WEBHOOK_SPEC_TIMEOUT_MS,
  cleanupInboundEmails,
  createInboundTracker,
  fetchInboxEmail,
  listEmailAttachmentParts,
  receiveInboundEmail,
  resolveInboxAddress,
  skipUnlessResendStubAvailable,
  uniqueRunId,
} from './helpers/inboundAttachments'

export const integrationMeta = { dependsOnModules: ['example', 'attachments'] }

const WINDOWS_EXECUTABLE = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(126, 0x90)])

/**
 * TC-INBOX-ATT-003: an executable part is recorded as `skipped` with `dangerous_executable` in the
 * attachment list; the email and its other part are stored (D14).
 * Spec: .ai/specs/2026-10-25-inbox-ops-inbound-attachments.md
 */
test.describe('TC-INBOX-ATT-003: executable inbound parts are skipped', () => {
  test('skips the executable and stores the email and its other part', async ({ request }) => {
    test.setTimeout(WEBHOOK_SPEC_TIMEOUT_MS)
    await skipUnlessResendStubAvailable()
    const admin = await getAuthToken(request, 'admin')
    const tracker = createInboundTracker()
    const run = uniqueRunId('TC-INBOX-ATT-003')
    try {
      const received = await receiveInboundEmail(request, admin, tracker, {
        to: await resolveInboxAddress(request, admin),
        subject: `Installer ${run}`,
        text: 'Run the attached installer.',
        attachments: [
          { filename: `${run}-setup.exe`, contentType: 'application/x-msdownload', content: WINDOWS_EXECUTABLE },
          { filename: `${run}-readme.txt`, contentType: 'text/plain', content: 'read me first' },
        ],
      })

      const parts = await listEmailAttachmentParts(request, admin, received.emailId)
      expect(parts).toHaveLength(2)
      const executable = parts.find((part) => part.fileName === `${run}-setup.exe`)
      const readme = parts.find((part) => part.fileName === `${run}-readme.txt`)
      expect(executable).toMatchObject({
        fileName: `${run}-setup.exe`,
        status: 'skipped',
        reason: 'dangerous_executable',
        attachmentId: null,
        url: null,
      })
      expect(readme).toMatchObject({ fileName: `${run}-readme.txt`, status: 'stored', reason: null })

      const detail = await fetchInboxEmail(request, admin, received.emailId)
      expect(detail.status).toBe(200)
      expect(detail.email?.attachmentsStatus).toBe('completed')
      expect(readme?.attachmentId).toBeTruthy()
      expect(detail.email?.attachmentIds).toEqual([readme?.attachmentId])
    } finally {
      await cleanupInboundEmails(request, admin, tracker)
    }
  })
})
