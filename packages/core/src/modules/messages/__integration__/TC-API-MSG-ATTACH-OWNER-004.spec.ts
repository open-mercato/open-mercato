import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
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
 * TC-API-MSG-ATTACH-OWNER-004: composing with `attachmentIds`, replying (with
 * `attachmentIds` or a library `attachmentRecordId`) and updating a draft apply
 * the same attachment owner policy as draft linking. A user who cannot open a
 * document is refused with 403 when one of these carries a file of it: no
 * message or reply is created, a refused draft update leaves the draft's
 * subject and already linked files as they were, and the protected file stays
 * where it was, unchanged. A document editor attaches the same kind of file
 * through each path and it moves to the new message, the reply or the draft.
 */
test.describe('TC-API-MSG-ATTACH-OWNER-004: compose, reply and draft update honor attachment owner policies', () => {
  test('refuses a message composed with a file of a document the caller cannot open', async ({ request }) => {
    test.slow()
    await withAttachmentOwnerFixture(request, async (fixture) => {
      await setRoleAclFeatures(request, fixture.admin, {
        roleId: fixture.roleId,
        features: [...OWNER_ACCESS_FEATURES, ...MESSAGE_FEATURES],
      })
      const editable = await fixture.document('compose-editable')
      await fixture.share(editable, 'editor')
      const refusedFile = await fixture.upload(editable, 'compose-refused')
      const allowedFile = await fixture.upload(editable, 'compose-allowed')
      const refusedBefore = await readAttachmentRowInDb(refusedFile)
      const recipientToken = await fixture.recipient.refreshToken()
      const unsharedToken = await fixture.unshared.refreshToken()
      const messages: Array<{ id: string; token: string }> = []

      try {
        const subject = `${fixture.prefix}-compose-refused`
        const denied = await ownerPolicyRequest<{ id?: string }>('POST', '/api/messages', unsharedToken, {
          recipients: [{ userId: fixture.recipient.id, type: 'to' }],
          subject,
          body: 'Message with a protected file',
          sendViaEmail: false,
          attachmentIds: [refusedFile],
        })
        if (denied.body?.id) messages.push({ id: denied.body.id, token: unsharedToken })
        expect(denied.status, 'composing with a file the caller cannot open is refused').toBe(403)
        const created = await withClient(async (client) => (
          await client.query<{ count: string }>('select count(*)::text as count from messages where sender_user_id = $1', [fixture.unshared.id])
        ).rows[0]?.count)
        expect(created, 'the refused message is not created').toBe('0')
        expect(await readAttachmentRowInDb(refusedFile), 'the refused file stays on the document unchanged').toEqual(refusedBefore)

        const allowed = await ownerPolicyRequest<{ id?: string }>('POST', '/api/messages', recipientToken, {
          recipients: [{ userId: fixture.unshared.id, type: 'to' }],
          subject: `${fixture.prefix}-compose-allowed`,
          body: 'Message with a shared file',
          sendViaEmail: false,
          attachmentIds: [allowedFile],
        })
        expect(allowed.status, 'the document editor composes with its file').toBe(201)
        const messageId = allowed.body?.id
        expect(typeof messageId).toBe('string')
        messages.push({ id: messageId!, token: recipientToken })
        expect(await readAttachmentRowInDb(allowedFile)).toMatchObject({ entity_id: 'messages:message', record_id: messageId })
      } finally {
        for (const message of messages) await deleteMessageIfExists(request, message.token, message.id)
      }
    })
  })

  test('refuses a reply linking a library record that carries a protected file', async ({ request }) => {
    test.slow()
    await withAttachmentOwnerFixture(request, async (fixture) => {
      await setRoleAclFeatures(request, fixture.admin, {
        roleId: fixture.roleId,
        features: [...OWNER_ACCESS_FEATURES, ...MESSAGE_FEATURES],
      })
      const editable = await fixture.document('reply-record-editable')
      await fixture.share(editable, 'editor')
      const refusedRecordId = randomUUID()
      const refusedFile = await fixture.upload(refusedRecordId, 'reply-record-refused', {
        entityId: 'attachments:library',
        assignments: [{ type: 'documents:document', id: editable }],
      })
      const allowedRecordId = randomUUID()
      const allowedFile = await fixture.upload(allowedRecordId, 'reply-record-allowed', {
        entityId: 'attachments:library',
        assignments: [{ type: 'documents:document', id: editable }],
      })
      const refusedBefore = await readAttachmentRowInDb(refusedFile)
      const recipientToken = await fixture.recipient.refreshToken()
      const unsharedToken = await fixture.unshared.refreshToken()
      const messages: Array<{ id: string; token: string }> = []

      try {
        const original = await composeMessageWithToken(request, recipientToken, {
          recipients: [{ userId: fixture.unshared.id, type: 'to' }],
          subject: `${fixture.prefix}-reply-record-original`,
          body: 'Original body',
          sendViaEmail: false,
        })
        messages.push({ id: original, token: recipientToken })

        const denied = await ownerPolicyRequest('POST', `/api/messages/${original}/reply`, unsharedToken, {
          body: 'Reply with a protected library record',
          sendViaEmail: false,
          attachmentRecordId: refusedRecordId,
        })
        expect(denied.status, 'a reply linking a library record with a protected file is refused').toBe(403)
        expect(await countRepliesInDb(original), 'the refused reply is not created').toBe(0)
        expect(await readAttachmentRowInDb(refusedFile), 'the refused file stays in the library unchanged').toEqual(refusedBefore)

        const allowed = await ownerPolicyRequest<{ id?: string }>('POST', `/api/messages/${original}/reply`, recipientToken, {
          body: 'Reply with a shared library record',
          sendViaEmail: false,
          recipients: [{ userId: fixture.unshared.id, type: 'to' }],
          attachmentRecordId: allowedRecordId,
        })
        expect(allowed.status, 'the document editor replies with the library record').toBe(201)
        const replyId = allowed.body?.id
        expect(typeof replyId).toBe('string')
        messages.push({ id: replyId!, token: recipientToken })
        expect(await readAttachmentRowInDb(allowedFile)).toMatchObject({ entity_id: 'messages:message', record_id: replyId })
      } finally {
        for (const message of messages.reverse()) await deleteMessageIfExists(request, message.token, message.id)
      }
    })
  })

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
      const keptFile = await fixture.upload(randomUUID(), 'draft-update-kept', { entityId: 'attachments:library' })
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
        const kept = await ownerPolicyRequest('POST', `/api/messages/${deniedDraft}/attachments`, unsharedToken, {
          attachmentIds: [keptFile],
        })
        expect(kept.status, 'an unprotected file is linked to the draft first').toBe(200)
        const keptBefore = await readAttachmentRowInDb(keptFile)
        const denied = await ownerPolicyRequest('PATCH', `/api/messages/${deniedDraft}`, unsharedToken, {
          subject: `${fixture.prefix}-draft-update-denied-edited`,
          attachmentIds: [refusedFile],
        })
        expect(denied.status, 'a draft update carrying a file the caller cannot open is refused').toBe(403)
        const deniedDetail = await ownerPolicyRequest<{ subject?: string }>('GET', `/api/messages/${deniedDraft}`, unsharedToken)
        expect(deniedDetail.body?.subject, 'the refused update leaves the subject as it was').toBe(`${fixture.prefix}-draft-update-denied`)
        const deniedAttachments = await ownerPolicyRequest<MessageAttachments>('GET', `/api/messages/${deniedDraft}/attachments`, unsharedToken)
        expect(deniedAttachments.body?.attachments?.map((item) => item.id) ?? [], 'the already linked file stays on the draft and nothing else is linked').toEqual([keptFile])
        expect(await readAttachmentRowInDb(keptFile), 'the already linked file is unchanged').toEqual(keptBefore)
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
