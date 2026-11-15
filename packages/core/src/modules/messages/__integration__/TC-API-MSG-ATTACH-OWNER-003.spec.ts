import { expect, test, type APIRequestContext } from '@playwright/test'
import { setRoleAclFeatures } from '@open-mercato/core/helpers/integration/authFixtures'
import {
  OWNER_ACCESS_FEATURES,
  ownerPolicyRequest,
  readAttachmentRowInDb,
  withAttachmentOwnerFixture,
  type AttachmentOwnerFixture,
  type AttachmentRowSnapshot,
} from '@open-mercato/core/helpers/integration/attachmentAccessFixtures'
import { composeMessageWithToken, deleteMessageIfExists } from './helpers'

export const integrationMeta = { dependsOnModules: ['documents'] }

type MessageAttachments = { attachments?: Array<{ id: string }> }
type Contender = { token: string; draft: string }

const MESSAGE_FEATURES = ['messages.view', 'messages.compose', 'messages.attach_files']

async function draftFor(
  request: APIRequestContext, fixture: AttachmentOwnerFixture, token: string, recipientId: string, label: string, drafts: Contender[],
): Promise<Contender> {
  const draft = await composeMessageWithToken(request, token, {
    isDraft: true,
    recipients: [{ userId: recipientId, type: 'to' }],
    subject: `${fixture.prefix}-${label}`,
    body: 'Draft body',
  })
  const contender = { token, draft }
  drafts.push(contender)
  return contender
}

function link(contender: Contender, attachmentId: string) {
  return ownerPolicyRequest('POST', `/api/messages/${contender.draft}/attachments`, contender.token, { attachmentIds: [attachmentId] })
}

async function linkedIds(contender: Contender): Promise<string[]> {
  const response = await ownerPolicyRequest<MessageAttachments>('GET', `/api/messages/${contender.draft}/attachments`, contender.token)
  expect(response.status).toBe(200)
  return response.body?.attachments?.map((item) => item.id) ?? []
}

function movedTo(before: AttachmentRowSnapshot | null, draft: string): AttachmentRowSnapshot {
  expect(before).not.toBeNull()
  return { ...before!, entity_id: 'messages:message', record_id: draft }
}

/**
 * TC-API-MSG-ATTACH-OWNER-003: outcomes of concurrent links of one protected
 * file, whatever order the requests run in. A document editor and a user
 * who cannot edit the document race to link the same file into their own
 * drafts: the editor gets 200, the other 403, and the file ends on the editor's
 * draft with every other column unchanged. Retries repeat the same outcome. Two
 * editors racing both succeed and the file ends on exactly one of the drafts,
 * never partially moved.
 */
test.describe('TC-API-MSG-ATTACH-OWNER-003: concurrent message links of a protected file', () => {
  test('an allowed and a denied contender race for the same file', async ({ request }) => {
    test.slow()
    await withAttachmentOwnerFixture(request, async (fixture) => {
      await setRoleAclFeatures(request, fixture.admin, {
        roleId: fixture.roleId,
        features: [...OWNER_ACCESS_FEATURES, ...MESSAGE_FEATURES],
      })
      const editable = await fixture.document('race-editable')
      await fixture.share(editable, 'editor')
      const file = await fixture.upload(editable, 'race-mixed')
      const before = await readAttachmentRowInDb(file)
      const drafts: Contender[] = []

      try {
        const editor = await draftFor(request, fixture, await fixture.recipient.refreshToken(), fixture.unshared.id, 'race-editor', drafts)
        const denied = await draftFor(request, fixture, await fixture.unshared.refreshToken(), fixture.recipient.id, 'race-denied', drafts)

        const [editorLink, deniedLink] = await Promise.all([link(editor, file), link(denied, file)])
        expect(editorLink.status, 'the editor links the file').toBe(200)
        expect(deniedLink.status, 'the user who cannot edit the document is refused').toBe(403)
        expect(await readAttachmentRowInDb(file), 'the file moved only onto the editor draft').toEqual(movedTo(before, editor.draft))
        expect(await linkedIds(editor)).toEqual([file])
        expect(await linkedIds(denied)).toEqual([])

        const [editorRetry, deniedRetry] = await Promise.all([link(editor, file), link(denied, file)])
        expect(editorRetry.status, 'relinking an already linked file is a no-op').toBe(200)
        expect(deniedRetry.status, 'the refusal repeats').toBe(403)
        expect(await readAttachmentRowInDb(file)).toEqual(movedTo(before, editor.draft))
        expect(await linkedIds(editor)).toEqual([file])
        expect(await linkedIds(denied)).toEqual([])
      } finally {
        for (const contender of drafts) await deleteMessageIfExists(request, contender.token, contender.draft)
      }
    })
  })

  test('two allowed contenders race for the same file', async ({ request }) => {
    test.slow()
    await withAttachmentOwnerFixture(request, async (fixture) => {
      await setRoleAclFeatures(request, fixture.admin, {
        roleId: fixture.roleId,
        features: [...OWNER_ACCESS_FEATURES, ...MESSAGE_FEATURES],
      })
      const editable = await fixture.document('race-allowed')
      await fixture.share(editable, 'editor')
      const file = await fixture.upload(editable, 'race-allowed')
      const before = await readAttachmentRowInDb(file)
      const drafts: Contender[] = []

      try {
        const editor = await draftFor(request, fixture, await fixture.recipient.refreshToken(), fixture.unshared.id, 'race-editor', drafts)
        const owner = await draftFor(request, fixture, fixture.admin, fixture.recipient.id, 'race-owner', drafts)

        const results = await Promise.all([link(editor, file), link(owner, file)])
        expect(results.map((result) => result.status), 'both editors may move the file').toEqual([200, 200])
        const holders: Contender[] = []
        for (const contender of [editor, owner]) {
          const ids = await linkedIds(contender)
          expect(ids.length).toBeLessThanOrEqual(1)
          if (ids.includes(file)) holders.push(contender)
        }
        expect(holders, 'the file ends on exactly one draft').toHaveLength(1)
        const [holder] = holders
        expect(await readAttachmentRowInDb(file), 'the move is complete, not partial').toEqual(movedTo(before, holder.draft))

        const retry = await link(holder, file)
        expect(retry.status, 'the holder relinking is a no-op').toBe(200)
        expect(await readAttachmentRowInDb(file)).toEqual(movedTo(before, holder.draft))
      } finally {
        for (const contender of drafts) await deleteMessageIfExists(request, contender.token, contender.draft)
      }
    })
  })
})
