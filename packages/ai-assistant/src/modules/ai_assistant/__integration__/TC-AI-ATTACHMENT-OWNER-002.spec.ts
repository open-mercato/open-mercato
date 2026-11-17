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

/**
 * TC-AI-ATTACHMENT-OWNER-002: a key-authenticated call is evaluated as the key,
 * never as the user who created it. The key's role cannot open the hidden
 * document, so the key cannot read its file through the AI tools even though the
 * administrator who created the key can; a document shared with the key's role
 * stays readable.
 */
test('TC-AI-ATTACHMENT-OWNER-002: AI attachment tools evaluate an API key as the key, not its creator', async ({ request }) => {
  await withAttachmentOwnerFixture(request, async (fixture) => {
    await setRoleAclFeatures(request, fixture.admin, {
      roleId: fixture.roleId,
      features: [...OWNER_ACCESS_FEATURES, 'ai_assistant.view'],
    })
    const hiddenFile = await fixture.upload(fixture.hidden, 'hidden-key')

    const creatorRead = await ownerPolicyRequest<ReadAttachmentResponse>('POST', '/api/ai_assistant/tools/execute', fixture.admin, {
      toolName: 'attachments.read_attachment',
      args: { attachmentId: hiddenFile },
    })
    expect(creatorRead.status).toBe(200)
    expect(creatorRead.body?.result?.found).toBe(true)

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
