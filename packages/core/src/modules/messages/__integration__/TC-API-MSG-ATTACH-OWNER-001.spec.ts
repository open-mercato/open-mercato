import { expect, test } from '@playwright/test'
import { setRoleAclFeatures } from '@open-mercato/core/helpers/integration/authFixtures'
import {
  OWNER_ACCESS_FEATURES,
  ownerPolicyRequest,
  withAttachmentOwnerFixture,
} from '@open-mercato/core/helpers/integration/attachmentAccessFixtures'
import { composeMessageWithToken, deleteMessageIfExists } from './helpers'

export const integrationMeta = { dependsOnModules: ['documents'] }

/**
 * TC-API-MSG-ATTACH-OWNER-001: linking attachments to a draft applies attachment
 * owner policies (#6726). Linking re-parents a file onto the message, so the
 * caller needs `reassign` rights on the file's owner: a user who cannot edit a
 * document cannot pull its file into a message, while a document editor can.
 */
test('TC-API-MSG-ATTACH-OWNER-001: draft linking refuses files of documents the caller cannot edit', async ({ request }) => {
  await withAttachmentOwnerFixture(request, async (fixture) => {
    await setRoleAclFeatures(request, fixture.admin, {
      roleId: fixture.roleId,
      features: [...OWNER_ACCESS_FEATURES, 'messages.view', 'messages.compose', 'messages.attach_files'],
    })
    const editable = await fixture.document('editable')
    await fixture.share(editable, 'editor')
    const hiddenFile = await fixture.upload(fixture.hidden, 'hidden-message')
    const editableFile = await fixture.upload(editable, 'editable-message')
    const unsharedToken = await fixture.unshared.refreshToken()
    const recipientToken = await fixture.recipient.refreshToken()
    const drafts: Array<{ id: string; token: string }> = []

    try {
      const unsharedDraft = await composeMessageWithToken(request, unsharedToken, {
        isDraft: true,
        recipients: [{ userId: fixture.recipient.id, type: 'to' }],
        subject: `${fixture.prefix}-unshared-draft`,
        body: 'Draft body',
      })
      drafts.push({ id: unsharedDraft, token: unsharedToken })
      const denied = await ownerPolicyRequest('POST', `/api/messages/${unsharedDraft}/attachments`, unsharedToken, {
        attachmentIds: [hiddenFile],
      })
      expect(denied.status).toBe(403)

      const hiddenStillOnDocument = await ownerPolicyRequest<{ items?: Array<{ id: string }> }>(
        'GET', `/api/attachments?entityId=documents:document&recordId=${fixture.hidden}`, fixture.admin,
      )
      expect(hiddenStillOnDocument.body?.items?.some((item) => item.id === hiddenFile)).toBe(true)

      const editorDraft = await composeMessageWithToken(request, recipientToken, {
        isDraft: true,
        recipients: [{ userId: fixture.unshared.id, type: 'to' }],
        subject: `${fixture.prefix}-editor-draft`,
        body: 'Draft body',
      })
      drafts.push({ id: editorDraft, token: recipientToken })
      const allowed = await ownerPolicyRequest('POST', `/api/messages/${editorDraft}/attachments`, recipientToken, {
        attachmentIds: [editableFile],
      })
      expect(allowed.status).toBe(200)
    } finally {
      for (const draft of drafts) await deleteMessageIfExists(request, draft.token, draft.id)
    }
  })
})
