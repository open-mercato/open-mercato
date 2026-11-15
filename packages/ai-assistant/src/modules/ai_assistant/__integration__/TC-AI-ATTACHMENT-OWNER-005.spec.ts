import { expect, test } from '@playwright/test'
import { setRoleAclFeatures } from '@open-mercato/core/helpers/integration/authFixtures'
import {
  OWNER_ACCESS_FEATURES,
  ownerPolicyRequest,
  readAttachmentRowInDb,
  withAttachmentOwnerFixture,
} from '@open-mercato/core/helpers/integration/attachmentAccessFixtures'

export const integrationMeta = { dependsOnModules: ['documents'] }

type ReadAttachmentResponse = {
  success?: boolean
  result?: { found?: boolean; attachmentId?: string }
}

type ListAttachmentsResponse = {
  success?: boolean
  result?: { items?: Array<{ id: string }> }
}

/**
 * TC-AI-ATTACHMENT-OWNER-005: revoking owner access takes effect on the next AI
 * tool call. A user reads a Documents file through a share; once the share is
 * revoked, `attachments.read_attachment` answers `found: false` and the record
 * listing is empty. An API key whose role loses its role share is refused
 * first, while the user keeps access through their own share until it is
 * revoked too. The file row is unchanged by the refused reads.
 */
test('TC-AI-ATTACHMENT-OWNER-005: AI attachment tools refuse a file once owner access is revoked', async ({ request }) => {
  test.slow()
  await withAttachmentOwnerFixture(request, async (fixture) => {
    await setRoleAclFeatures(request, fixture.admin, {
      roleId: fixture.roleId,
      features: [...OWNER_ACCESS_FEATURES, 'ai_assistant.view'],
    })
    const document = await fixture.document('revoked')
    const userShare = await fixture.share(document, 'viewer')
    const roleShare = await fixture.share(document, 'viewer', 'role', fixture.roleId)
    const file = await fixture.upload(document, 'revoked-ai')
    const key = await fixture.key()
    const recipientToken = await fixture.recipient.refreshToken()
    const before = await readAttachmentRowInDb(file)

    const read = (token: string, scheme: 'Bearer' | 'ApiKey' = 'Bearer') => ownerPolicyRequest<ReadAttachmentResponse>(
      'POST', '/api/ai_assistant/tools/execute', token,
      { toolName: 'attachments.read_attachment', args: { attachmentId: file } }, scheme,
    )
    const list = (token: string, scheme: 'Bearer' | 'ApiKey' = 'Bearer') => ownerPolicyRequest<ListAttachmentsResponse>(
      'POST', '/api/ai_assistant/tools/execute', token,
      { toolName: 'attachments.list_record_attachments', args: { entityType: 'documents:document', recordId: document } }, scheme,
    )

    expect((await read(recipientToken)).body?.result?.found, 'the shared user reads the file').toBe(true)
    expect((await list(recipientToken)).body?.result?.items?.map((item) => item.id)).toEqual([file])
    expect((await read(key.secret, 'ApiKey')).body?.result?.found, 'the key reads the file through its role share').toBe(true)

    await fixture.unshare(document, roleShare)
    const revokedKeyRead = await read(key.secret, 'ApiKey')
    expect(revokedKeyRead.status).toBe(200)
    expect(revokedKeyRead.body?.result, 'the role share no longer applies to the key').toEqual({ found: false, attachmentId: file })
    expect((await list(key.secret, 'ApiKey')).body?.result?.items ?? []).toEqual([])
    expect((await read(recipientToken)).body?.result?.found, 'the user share still applies').toBe(true)

    await fixture.unshare(document, userShare)
    const revokedRead = await read(recipientToken)
    expect(revokedRead.status).toBe(200)
    expect(revokedRead.body?.result, 'no share applies to the user any more').toEqual({ found: false, attachmentId: file })
    expect((await list(recipientToken)).body?.result?.items ?? []).toEqual([])

    expect(await readAttachmentRowInDb(file), 'the refused reads leave the row unchanged').toEqual(before)
  })
})
