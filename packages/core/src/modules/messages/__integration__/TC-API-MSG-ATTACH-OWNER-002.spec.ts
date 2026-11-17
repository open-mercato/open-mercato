import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { setRoleAclFeatures } from '@open-mercato/core/helpers/integration/authFixtures'
import {
  OWNER_ACCESS_FEATURES,
  ownerPolicyRequest,
  readAttachmentRowInDb,
  withAttachmentOwnerFixture,
} from '@open-mercato/core/helpers/integration/attachmentAccessFixtures'
import { composeMessageWithToken, deleteMessageIfExists } from './helpers'

export const integrationMeta = { dependsOnModules: ['documents'] }

type MessageAttachments = { attachments?: Array<{ id: string }> }

const ATTACHMENT_ACCESS_DENIED = 'You cannot attach one or more of these files.'
const MESSAGE_FEATURES = ['messages.view', 'messages.compose', 'messages.attach_files']

/**
 * TC-API-MSG-ATTACH-OWNER-002: Messages linking never moves an attachment of
 * another organization or tenant, and honors revoked owner access. Copies of a
 * library file and of a Documents file in a second organization and in a second
 * tenant are ignored by draft linking and by composing with their library
 * record: nothing is linked and every foreign row is unchanged. A document
 * editor links one of its files, loses the share, and is then refused with 403
 * for the next file, which stays on the document unchanged.
 */
test.describe('TC-API-MSG-ATTACH-OWNER-002: message linking across scopes and after revocation', () => {
  test('ignores attachments of another organization or tenant', async ({ request }) => {
    test.slow()
    await withAttachmentOwnerFixture(request, async (fixture) => {
      await setRoleAclFeatures(request, fixture.admin, {
        roleId: fixture.roleId,
        features: [...OWNER_ACCESS_FEATURES, ...MESSAGE_FEATURES],
      })
      const editable = await fixture.document('foreign-editable')
      await fixture.share(editable, 'editor')
      const libraryFile = await fixture.upload(randomUUID(), 'foreign-library', { entityId: 'attachments:library' })
      const documentFile = await fixture.upload(editable, 'foreign-document')
      const foreignRecordId = randomUUID()
      const foreign = [
        await fixture.foreignCopy(libraryFile, 'organization', { recordId: foreignRecordId }),
        await fixture.foreignCopy(libraryFile, 'tenant', { recordId: foreignRecordId }),
        await fixture.foreignCopy(documentFile, 'organization', { recordId: editable }),
        await fixture.foreignCopy(documentFile, 'tenant', { recordId: editable }),
      ]
      const before = await Promise.all(foreign.map((row) => readAttachmentRowInDb(row.id)))
      const recipientToken = await fixture.recipient.refreshToken()
      const drafts: string[] = []

      try {
        const draft = await composeMessageWithToken(request, recipientToken, {
          isDraft: true,
          recipients: [{ userId: fixture.unshared.id, type: 'to' }],
          subject: `${fixture.prefix}-foreign-draft`,
          body: 'Draft body',
        })
        drafts.push(draft)
        const linked = await ownerPolicyRequest('POST', `/api/messages/${draft}/attachments`, recipientToken, {
          attachmentIds: foreign.map((row) => row.id),
        })
        expect(linked.status, 'unknown ids are ignored, as for any id outside the caller scope').toBe(200)
        const draftAttachments = await ownerPolicyRequest<MessageAttachments>('GET', `/api/messages/${draft}/attachments`, recipientToken)
        expect(draftAttachments.status).toBe(200)
        expect(draftAttachments.body?.attachments ?? [], 'no foreign row is linked').toEqual([])

        const composed = await ownerPolicyRequest<{ id?: string }>('POST', '/api/messages', recipientToken, {
          recipients: [{ userId: fixture.unshared.id, type: 'to' }],
          subject: `${fixture.prefix}-foreign-compose`,
          body: 'Message body',
          sendViaEmail: false,
          isDraft: true,
          attachmentRecordId: foreignRecordId,
        })
        expect(composed.status).toBe(201)
        const composedId = composed.body?.id
        expect(typeof composedId).toBe('string')
        drafts.push(composedId!)
        const composedAttachments = await ownerPolicyRequest<MessageAttachments>('GET', `/api/messages/${composedId}/attachments`, recipientToken)
        expect(composedAttachments.body?.attachments ?? [], 'no foreign library row is linked').toEqual([])

        const after = await Promise.all(foreign.map((row) => readAttachmentRowInDb(row.id)))
        expect(after, 'foreign rows are unchanged').toEqual(before)
      } finally {
        for (const id of drafts) await deleteMessageIfExists(request, recipientToken, id)
      }
    })
  })

  test('refuses a file once the document share is revoked', async ({ request }) => {
    test.slow()
    await withAttachmentOwnerFixture(request, async (fixture) => {
      await setRoleAclFeatures(request, fixture.admin, {
        roleId: fixture.roleId,
        features: [...OWNER_ACCESS_FEATURES, ...MESSAGE_FEATURES],
      })
      const editable = await fixture.document('revoked-editable')
      const editorShare = await fixture.share(editable, 'editor')
      const linkedFile = await fixture.upload(editable, 'revoked-linked')
      const keptFile = await fixture.upload(editable, 'revoked-kept')
      const keptBefore = await readAttachmentRowInDb(keptFile)
      const recipientToken = await fixture.recipient.refreshToken()
      const drafts: string[] = []

      try {
        const draft = await composeMessageWithToken(request, recipientToken, {
          isDraft: true,
          recipients: [{ userId: fixture.unshared.id, type: 'to' }],
          subject: `${fixture.prefix}-revoked-draft`,
          body: 'Draft body',
        })
        drafts.push(draft)
        const allowed = await ownerPolicyRequest('POST', `/api/messages/${draft}/attachments`, recipientToken, {
          attachmentIds: [linkedFile],
        })
        expect(allowed.status, 'the editor links a file of the document').toBe(200)
        expect(await readAttachmentRowInDb(linkedFile)).toMatchObject({ entity_id: 'messages:message', record_id: draft })

        await fixture.unshare(editable, editorShare)
        const denied = await ownerPolicyRequest('POST', `/api/messages/${draft}/attachments`, recipientToken, {
          attachmentIds: [keptFile],
        })
        expect(denied.status, 'the revoked editor cannot link the next file').toBe(403)
        expect(denied.body?.error, 'the refusal names the attachment owner policy').toBe(ATTACHMENT_ACCESS_DENIED)
        expect(await readAttachmentRowInDb(keptFile), 'the refused file stays on the document unchanged').toEqual(keptBefore)
        const draftAttachments = await ownerPolicyRequest<MessageAttachments>('GET', `/api/messages/${draft}/attachments`, recipientToken)
        expect(draftAttachments.body?.attachments?.map((item) => item.id)).toEqual([linkedFile])
      } finally {
        for (const id of drafts) await deleteMessageIfExists(request, recipientToken, id)
      }
    })
  })
})
