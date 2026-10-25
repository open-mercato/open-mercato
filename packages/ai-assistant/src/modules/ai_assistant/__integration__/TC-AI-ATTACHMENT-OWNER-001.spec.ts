import { expect, test } from '@playwright/test'
import { setRoleAclFeatures } from '@open-mercato/core/helpers/integration/authFixtures'
import {
  OWNER_ACCESS_FEATURES,
  ownerPolicyRequest,
  withAttachmentOwnerFixture,
} from '@open-mercato/core/helpers/integration/attachmentAccessFixtures'

export const integrationMeta = { dependsOnModules: ['documents'] }

type ReadAttachmentResponse = {
  success?: boolean
  result?: { found?: boolean; extractedText?: string | null }
  error?: string
}

type ListAttachmentsResponse = {
  success?: boolean
  result?: { items?: Array<{ id: string }>; total?: number }
}

/**
 * TC-AI-ATTACHMENT-OWNER-001: the `attachments.*` AI tools apply attachment owner
 * policies (#6726). A same-organization user who holds `attachments.view` but
 * cannot open a document must not read or list that document's files through
 * the AI tools; a user the document is shared with still can. An API key is
 * evaluated as the key: it reads only documents shared with its role.
 */
test('TC-AI-ATTACHMENT-OWNER-001: AI attachment tools refuse files of documents the caller cannot open', async ({ request }) => {
  await withAttachmentOwnerFixture(request, async (fixture) => {
    await setRoleAclFeatures(request, fixture.admin, {
      roleId: fixture.roleId,
      features: [...OWNER_ACCESS_FEATURES, 'ai_assistant.view'],
    })
    const hiddenFile = await fixture.upload(fixture.hidden, 'hidden-ai')
    const visibleFile = await fixture.upload(fixture.visible, 'visible-ai')
    const unsharedToken = await fixture.unshared.refreshToken()
    const recipientToken = await fixture.recipient.refreshToken()

    const deniedRead = await ownerPolicyRequest<ReadAttachmentResponse>('POST', '/api/ai_assistant/tools/execute', unsharedToken, {
      toolName: 'attachments.read_attachment',
      args: { attachmentId: hiddenFile, includeExtractedText: true },
    })
    expect(deniedRead.status).toBe(200)
    expect(deniedRead.body?.result).toEqual({ found: false, attachmentId: hiddenFile })

    const deniedList = await ownerPolicyRequest<ListAttachmentsResponse>('POST', '/api/ai_assistant/tools/execute', unsharedToken, {
      toolName: 'attachments.list_record_attachments',
      args: { entityType: 'documents:document', recordId: fixture.hidden },
    })
    expect(deniedList.status).toBe(200)
    expect(deniedList.body?.result?.items ?? []).toEqual([])

    const allowedRead = await ownerPolicyRequest<ReadAttachmentResponse>('POST', '/api/ai_assistant/tools/execute', recipientToken, {
      toolName: 'attachments.read_attachment',
      args: { attachmentId: visibleFile },
    })
    expect(allowedRead.status).toBe(200)
    expect(allowedRead.body?.result?.found).toBe(true)

    const key = await fixture.key()
    const keyDenied = await ownerPolicyRequest<ReadAttachmentResponse>('POST', '/api/ai_assistant/tools/execute', key.secret, {
      toolName: 'attachments.read_attachment',
      args: { attachmentId: hiddenFile },
    }, 'ApiKey')
    expect(keyDenied.status).toBe(200)
    expect(keyDenied.body?.result).toEqual({ found: false, attachmentId: hiddenFile })

    const keyDocument = await fixture.document('key-shared')
    await fixture.share(keyDocument, 'viewer', 'role', fixture.roleId)
    const keyFile = await fixture.upload(keyDocument, 'key-shared-ai')
    const keyAllowed = await ownerPolicyRequest<ReadAttachmentResponse>('POST', '/api/ai_assistant/tools/execute', key.secret, {
      toolName: 'attachments.read_attachment',
      args: { attachmentId: keyFile },
    }, 'ApiKey')
    expect(keyAllowed.status).toBe(200)
    expect(keyAllowed.body?.result?.found).toBe(true)
  })
})
