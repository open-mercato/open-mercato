import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { ownerPolicyRequest, type OwnerAccessList } from '@open-mercato/core/helpers/integration/attachmentAccessFixtures'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { getTokenContext } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  INBOUND_EMAIL_ENTITY_ID,
  WEBHOOK_SPEC_TIMEOUT_MS,
  cleanupInboundEmails,
  createInboundTracker,
  readEmailAttachmentRows,
  receiveInboundEmail,
  resolveInboxAddress,
  skipUnlessResendStubAvailable,
  uniqueRunId,
} from './helpers/inboundAttachments'

export const integrationMeta = { dependsOnModules: ['example', 'attachments', 'ai_assistant', 'messages'] }

type ReadAttachmentResponse = { result?: { found?: boolean; attachmentId?: string } }

/**
 * TC-INBOX-ATT-005: a same-organization role that holds the attachment, AI and Messages features
 * but not `inbox_ops.proposals.view` cannot see, download, delete, move, read through the AI tools
 * or link to a Messages draft an inbound attachment, which stays owned by the email. The AI chat
 * path is covered by a unit test: without an LLM key `/api/ai_assistant/ai/chat` stops earlier.
 * Spec: .ai/specs/2026-10-25-inbox-ops-inbound-attachments.md
 */
test.describe('TC-INBOX-ATT-005: inbound attachments are hidden from colleagues without inbox access', () => {
  test('refuses every attachment path to a role without inbox_ops.proposals.view', async ({ request }) => {
    test.setTimeout(WEBHOOK_SPEC_TIMEOUT_MS)
    await skipUnlessResendStubAvailable()
    const admin = await getAuthToken(request, 'admin')
    const scope = getTokenContext(admin)
    const tracker = createInboundTracker()
    const run = uniqueRunId('TC-INBOX-ATT-005')
    let roleId: string | null = null
    let userId: string | null = null
    let draftId: string | null = null
    let colleague: string | null = null
    try {
      const received = await receiveInboundEmail(request, admin, tracker, {
        to: await resolveInboxAddress(request, admin),
        subject: `Invoice ${run}`,
        text: 'Invoice attached.',
        attachments: [{ filename: `${run}-invoice.txt`, contentType: 'text/plain', content: 'confidential invoice' }],
      })
      const [attachmentId] = received.email.attachmentIds ?? []
      expect(attachmentId).toBeTruthy()

      roleId = await createRoleFixture(request, admin, { name: run, tenantId: scope.tenantId })
      await setRoleAclFeatures(request, admin, {
        roleId,
        features: [
          'attachments.view',
          'attachments.manage',
          'ai_assistant.view',
          'messages.compose',
          'messages.attach_files',
          'messages.view',
        ],
      })
      const email = `${run}@example.com`
      const password = `Inbox1!${randomUUID()}`
      userId = await createUserFixture(request, admin, {
        email,
        password,
        organizationId: scope.organizationId,
        roles: [roleId],
        name: 'Colleague without inbox access',
      })
      colleague = await getAuthToken(request, email, password)

      const library = await ownerPolicyRequest<OwnerAccessList>(
        'GET',
        `/api/attachments/library?search=${encodeURIComponent(run)}&pageSize=50`,
        colleague,
      )
      expect(library.status).toBe(200)
      expect(library.body?.items.map((item) => item.id)).not.toContain(attachmentId)

      const recordList = await ownerPolicyRequest<OwnerAccessList>(
        'GET',
        `/api/attachments?entityId=${encodeURIComponent(INBOUND_EMAIL_ENTITY_ID)}&recordId=${received.emailId}`,
        colleague,
      )
      expect(recordList.status).toBe(200)
      expect(recordList.body?.items ?? []).toEqual([])

      expect((await ownerPolicyRequest('GET', `/api/attachments/file/${attachmentId}`, colleague)).status).toBe(404)

      // Without the read feature the resolver answers 404 even for managed actions, so the id is
      // not revealed as an inbox attachment.
      const deleted = await ownerPolicyRequest('DELETE', `/api/attachments?id=${attachmentId}`, colleague)
      expect(deleted.status).toBe(404)
      const moved = await ownerPolicyRequest('POST', '/api/attachments/transfer', colleague, {
        entityId: INBOUND_EMAIL_ENTITY_ID,
        attachmentIds: [attachmentId],
        fromRecordId: received.emailId,
        toRecordId: randomUUID(),
      })
      expect(moved.status).toBe(404)

      const deniedRead = await ownerPolicyRequest<ReadAttachmentResponse>('POST', '/api/ai_assistant/tools/execute', colleague, {
        toolName: 'attachments.read_attachment',
        args: { attachmentId },
      })
      expect(deniedRead.status).toBe(200)
      expect(deniedRead.body?.result?.found).toBe(false)
      const allowedRead = await ownerPolicyRequest<ReadAttachmentResponse>('POST', '/api/ai_assistant/tools/execute', admin, {
        toolName: 'attachments.read_attachment',
        args: { attachmentId },
      })
      expect(allowedRead.status).toBe(200)
      expect(allowedRead.body?.result?.found).toBe(true)

      const draft = await ownerPolicyRequest<{ id?: string }>('POST', '/api/messages', colleague, {
        isDraft: true,
        recipients: [],
        subject: `Draft ${run}`,
        body: 'Forwarding the invoice',
        sendViaEmail: false,
      })
      expect(draft.status).toBe(201)
      draftId = draft.body?.id ?? null
      expect(draftId).toBeTruthy()
      const linked = await ownerPolicyRequest<{ error?: string }>('POST', `/api/messages/${draftId}/attachments`, colleague, {
        attachmentIds: [attachmentId],
      })
      expect(linked.status).toBe(403)
      expect(linked.body?.error).toBe('You cannot attach one or more of these files.')

      const rows = await readEmailAttachmentRows(received.emailId)
      expect(rows.map((row) => ({ id: row.id, entityId: row.entity_id }))).toEqual([
        { id: attachmentId, entityId: INBOUND_EMAIL_ENTITY_ID },
      ])
      expect((await ownerPolicyRequest('GET', `/api/attachments/file/${attachmentId}`, admin)).status).toBe(200)
    } finally {
      if (draftId && colleague) await ownerPolicyRequest('DELETE', `/api/messages/${draftId}`, colleague).catch(() => undefined)
      await deleteUserIfExists(request, admin, userId)
      await deleteRoleIfExists(request, admin, roleId)
      await cleanupInboundEmails(request, admin, tracker)
    }
  })
})
