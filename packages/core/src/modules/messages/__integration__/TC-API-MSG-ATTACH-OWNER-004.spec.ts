import { expect, test } from '@playwright/test'
import { setRoleAclFeatures } from '@open-mercato/core/helpers/integration/authFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import {
  OWNER_ACCESS_FEATURES,
  ownerPolicyRequest,
  readAttachmentRowInDb,
  withAttachmentOwnerFixture,
} from '@open-mercato/core/helpers/integration/attachmentAccessFixtures'
import { composeMessageWithToken, deleteMessageIfExists } from './helpers'

export const integrationMeta = { dependsOnModules: ['documents'] }

type MessageAttachments = { attachments?: Array<{ id: string }> }

const MESSAGE_FEATURES = ['messages.view', 'messages.compose', 'messages.attach_files']

async function countRepliesInDb(parentMessageId: string): Promise<number> {
  return withClient(async (client) => {
    const result = await client.query<{ count: string }>(
      'select count(*)::text as count from messages where parent_message_id = $1',
      [parentMessageId],
    )
    return Number(result.rows[0]?.count ?? 0)
  })
}

/**
 * TC-API-MSG-ATTACH-OWNER-004: replying and updating a draft apply the same
 * attachment owner policy as compose and draft linking. A user who cannot open
 * a document is refused with 403 when a reply or a draft update carries one of
 * its files in `attachmentIds`: no reply is created, nothing is linked to the
 * draft and the file stays on the document unchanged. A document editor
 * attaches the same kind of file through both paths and it moves to the reply
 * or the draft.
 */
test.describe('TC-API-MSG-ATTACH-OWNER-004: reply and draft update honor attachment owner policies', () => {
  test('refuses a reply carrying a file of a document the caller cannot open', async ({ request }) => {
    test.slow()
    await withAttachmentOwnerFixture(request, async (fixture) => {
      await setRoleAclFeatures(request, fixture.admin, {
        roleId: fixture.roleId,
        features: [...OWNER_ACCESS_FEATURES, ...MESSAGE_FEATURES],
      })
      const editable = await fixture.document('reply-editable')
      await fixture.share(editable, 'editor')
      const refusedFile = await fixture.upload(editable, 'reply-refused')
      const allowedFile = await fixture.upload(editable, 'reply-allowed')
      const refusedBefore = await readAttachmentRowInDb(refusedFile)
      const recipientToken = await fixture.recipient.refreshToken()
      const unsharedToken = await fixture.unshared.refreshToken()
      const messages: Array<{ id: string; token: string }> = []

      try {
        const original = await composeMessageWithToken(request, recipientToken, {
          recipients: [{ userId: fixture.unshared.id, type: 'to' }],
          subject: `${fixture.prefix}-reply-original`,
          body: 'Original body',
          sendViaEmail: false,
        })
        messages.push({ id: original, token: recipientToken })

        const denied = await ownerPolicyRequest('POST', `/api/messages/${original}/reply`, unsharedToken, {
          body: 'Reply with a protected file',
          sendViaEmail: false,
          attachmentIds: [refusedFile],
        })
        expect(denied.status, 'a reply carrying a file the caller cannot open is refused').toBe(403)
        expect(await countRepliesInDb(original), 'the refused reply is not created').toBe(0)
        expect(await readAttachmentRowInDb(refusedFile), 'the refused file stays on the document unchanged').toEqual(refusedBefore)

        const allowed = await ownerPolicyRequest<{ id?: string }>('POST', `/api/messages/${original}/reply`, recipientToken, {
          body: 'Reply with a shared file',
          sendViaEmail: false,
          recipients: [{ userId: fixture.unshared.id, type: 'to' }],
          attachmentIds: [allowedFile],
        })
        expect(allowed.status, 'the document editor replies with its file').toBe(201)
        const replyId = allowed.body?.id
        expect(typeof replyId).toBe('string')
        messages.push({ id: replyId!, token: recipientToken })
        expect(await readAttachmentRowInDb(allowedFile)).toMatchObject({ entity_id: 'messages:message', record_id: replyId })
      } finally {
        for (const message of messages.reverse()) await deleteMessageIfExists(request, message.token, message.id)
      }
    })
  })

  test('refuses a draft update carrying a file of a document the caller cannot open', async ({ request }) => {
    test.slow()
    await withAttachmentOwnerFixture(request, async (fixture) => {
      await setRoleAclFeatures(request, fixture.admin, {
        roleId: fixture.roleId,
        features: [...OWNER_ACCESS_FEATURES, ...MESSAGE_FEATURES],
      })
      const editable = await fixture.document('draft-update-editable')
      await fixture.share(editable, 'editor')
      const refusedFile = await fixture.upload(editable, 'draft-update-refused')
      const allowedFile = await fixture.upload(editable, 'draft-update-allowed')
      const refusedBefore = await readAttachmentRowInDb(refusedFile)
      const recipientToken = await fixture.recipient.refreshToken()
      const unsharedToken = await fixture.unshared.refreshToken()
      const drafts: Array<{ id: string; token: string }> = []

      try {
        const deniedDraft = await composeMessageWithToken(request, unsharedToken, {
          isDraft: true,
          recipients: [{ userId: fixture.recipient.id, type: 'to' }],
          subject: `${fixture.prefix}-draft-update-denied`,
          body: 'Draft body',
        })
        drafts.push({ id: deniedDraft, token: unsharedToken })
        const denied = await ownerPolicyRequest('PATCH', `/api/messages/${deniedDraft}`, unsharedToken, {
          subject: `${fixture.prefix}-draft-update-denied-edited`,
          attachmentIds: [refusedFile],
        })
        expect(denied.status, 'a draft update carrying a file the caller cannot open is refused').toBe(403)
        const deniedAttachments = await ownerPolicyRequest<MessageAttachments>('GET', `/api/messages/${deniedDraft}/attachments`, unsharedToken)
        expect(deniedAttachments.body?.attachments ?? [], 'nothing is linked to the refused draft').toEqual([])
        expect(await readAttachmentRowInDb(refusedFile), 'the refused file stays on the document unchanged').toEqual(refusedBefore)

        const allowedDraft = await composeMessageWithToken(request, recipientToken, {
          isDraft: true,
          recipients: [{ userId: fixture.unshared.id, type: 'to' }],
          subject: `${fixture.prefix}-draft-update-allowed`,
          body: 'Draft body',
        })
        drafts.push({ id: allowedDraft, token: recipientToken })
        const allowed = await ownerPolicyRequest('PATCH', `/api/messages/${allowedDraft}`, recipientToken, {
          subject: `${fixture.prefix}-draft-update-allowed-edited`,
          attachmentIds: [allowedFile],
        })
        expect(allowed.status, 'the document editor attaches its file through a draft update').toBe(200)
        expect(await readAttachmentRowInDb(allowedFile)).toMatchObject({ entity_id: 'messages:message', record_id: allowedDraft })
      } finally {
        for (const draft of drafts) await deleteMessageIfExists(request, draft.token, draft.id)
      }
    })
  })
})
