import { expect, test, type APIRequestContext } from '@playwright/test'
import {
  apiRequestWithSelectedOrg,
  createOrganizationFixture,
  deleteOrganizationIfExists,
  getAuthToken,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { deleteAttachmentIfExists, uploadAttachmentFixture } from '@open-mercato/core/helpers/integration/attachmentsFixtures'
import {
  deleteChannelIfExists,
  isChannelSeedingAvailable,
  seedConnectedChannel,
} from '@open-mercato/core/helpers/integration/communicationChannelsFixtures'

/**
 * TC-CHANNEL-EMAIL-HUB-008 — send-as-user refuses attachments it may not send
 * (#7098).
 *
 * Every refusal happens before a message is composed and answers 422 with a
 * stable `code`: a channel whose adapter does not share files, a file named
 * with the wrong owner, a file from another organization (reported exactly
 * like a missing one) and a file type the mailbox does not send.
 *
 * A connected channel can only be provisioned through the env-gated test-seed
 * fixture, so the suite skips when `OM_ENABLE_TEST_CHANNEL_SEEDING` is off.
 */

const OWNER_ENTITY_ID = 'attachments:library'

type AttachmentRef = { kind: 'attachment'; attachmentId: string; owner: { entityId: string; recordId: string } }

async function sendWithAttachments(
  request: APIRequestContext,
  token: string,
  input: { channelId: string; stamp: number; attachments: AttachmentRef[] },
): Promise<{ status: number; code?: string }> {
  const response = await apiRequest(request, 'POST', '/api/communication_channels/send-as-user', {
    token,
    data: {
      userChannelId: input.channelId,
      to: [`buyer-${input.stamp}@example.com`],
      subject: `Refused attachment ${input.stamp}`,
      body: { plain: 'x' },
      attachments: input.attachments,
    },
  })
  const body = await readJsonSafe<{ code?: string }>(response)
  return { status: response.status(), code: body?.code }
}

test.describe('TC-CHANNEL-EMAIL-HUB-008: send-as-user refuses attachments it may not send', () => {
  test('refuses attachments on a channel whose adapter does not share files', async ({ request }) => {
    const stamp = Date.now()
    let token: string | null = null
    let channelId: string | null = null
    let attachmentId: string | null = null

    try {
      token = await getAuthToken(request)
      test.skip(!(await isChannelSeedingAvailable(request, token)), 'OM_ENABLE_TEST_CHANNEL_SEEDING is not enabled.')

      channelId = await seedConnectedChannel(request, token, {
        displayName: `Chat channel ${stamp}`,
        providerFlavor: 'chat',
      })
      const recordId = `hub-008-chat-${stamp}`
      const uploaded = await uploadAttachmentFixture(request, token, {
        entityId: OWNER_ENTITY_ID,
        recordId,
        fileName: `note-${stamp}.txt`,
        mimeType: 'text/plain',
        buffer: Buffer.from('note'),
      })
      attachmentId = uploaded.id

      const result = await sendWithAttachments(request, token, {
        channelId,
        stamp,
        attachments: [{ kind: 'attachment', attachmentId, owner: { entityId: OWNER_ENTITY_ID, recordId } }],
      })
      expect(result).toEqual({ status: 422, code: 'attachments_unsupported' })
    } finally {
      await deleteChannelIfExists(request, token, channelId)
      await deleteAttachmentIfExists(request, token, attachmentId)
    }
  })

  test('refuses a file referenced with the wrong owner without revealing it exists', async ({ request }) => {
    const stamp = Date.now()
    let token: string | null = null
    let channelId: string | null = null
    let attachmentId: string | null = null

    try {
      token = await getAuthToken(request)
      test.skip(!(await isChannelSeedingAvailable(request, token)), 'OM_ENABLE_TEST_CHANNEL_SEEDING is not enabled.')

      channelId = await seedConnectedChannel(request, token, {
        displayName: `Owner check ${stamp}`,
        externalIdentifier: `owner-${stamp}@example.com`,
      })
      const uploaded = await uploadAttachmentFixture(request, token, {
        entityId: OWNER_ENTITY_ID,
        recordId: `hub-008-owner-${stamp}`,
        fileName: `owned-${stamp}.pdf`,
        mimeType: 'application/pdf',
        buffer: Buffer.from('%PDF-1.4\n'),
      })
      attachmentId = uploaded.id

      const result = await sendWithAttachments(request, token, {
        channelId,
        stamp,
        attachments: [
          { kind: 'attachment', attachmentId, owner: { entityId: OWNER_ENTITY_ID, recordId: `someone-else-${stamp}` } },
        ],
      })
      expect(result).toEqual({ status: 422, code: 'attachment_not_found' })
    } finally {
      await deleteChannelIfExists(request, token, channelId)
      await deleteAttachmentIfExists(request, token, attachmentId)
    }
  })

  test('refuses a file from another organization exactly like a missing one', async ({ request }) => {
    const stamp = Date.now()
    let token: string | null = null
    let channelId: string | null = null
    let otherOrgId: string | null = null
    let attachmentId: string | null = null

    try {
      token = await getAuthToken(request, 'admin')
      test.skip(!(await isChannelSeedingAvailable(request, token)), 'OM_ENABLE_TEST_CHANNEL_SEEDING is not enabled.')

      channelId = await seedConnectedChannel(request, token, {
        displayName: `Org check ${stamp}`,
        externalIdentifier: `org-${stamp}@example.com`,
      })
      otherOrgId = await createOrganizationFixture(request, token, { name: `HUB-008 other org ${stamp}` })
      const recordId = `hub-008-org-${stamp}`
      const uploaded = await uploadAttachmentFixture(request, token, {
        entityId: OWNER_ENTITY_ID,
        recordId,
        fileName: `other-org-${stamp}.pdf`,
        mimeType: 'application/pdf',
        buffer: Buffer.from('%PDF-1.4\n% other organization\n'),
        selectedOrgId: otherOrgId,
      })
      attachmentId = uploaded.id

      const result = await sendWithAttachments(request, token, {
        channelId,
        stamp,
        attachments: [{ kind: 'attachment', attachmentId, owner: { entityId: OWNER_ENTITY_ID, recordId } }],
      })
      expect(result).toEqual({ status: 422, code: 'attachment_not_found' })
    } finally {
      await deleteChannelIfExists(request, token, channelId)
      if (token && attachmentId && otherOrgId) {
        await apiRequestWithSelectedOrg(request, 'DELETE', `/api/attachments?id=${encodeURIComponent(attachmentId)}`, {
          token,
          selectedOrgId: otherOrgId,
        }).catch(() => undefined)
      }
      await deleteOrganizationIfExists(request, token, otherOrgId)
    }
  })

  test('refuses a file type the mailbox does not send', async ({ request }) => {
    const stamp = Date.now()
    let token: string | null = null
    let channelId: string | null = null
    let attachmentId: string | null = null

    try {
      token = await getAuthToken(request)
      test.skip(!(await isChannelSeedingAvailable(request, token)), 'OM_ENABLE_TEST_CHANNEL_SEEDING is not enabled.')

      channelId = await seedConnectedChannel(request, token, {
        displayName: `Type check ${stamp}`,
        externalIdentifier: `type-${stamp}@example.com`,
      })
      const recordId = `hub-008-type-${stamp}`
      const uploaded = await uploadAttachmentFixture(request, token, {
        entityId: OWNER_ENTITY_ID,
        recordId,
        fileName: `rates-${stamp}.json`,
        mimeType: 'application/json',
        buffer: Buffer.from('{"rate":1}'),
      })
      attachmentId = uploaded.id

      const result = await sendWithAttachments(request, token, {
        channelId,
        stamp,
        attachments: [{ kind: 'attachment', attachmentId, owner: { entityId: OWNER_ENTITY_ID, recordId } }],
      })
      expect(result).toEqual({ status: 422, code: 'attachment_type_not_allowed' })
    } finally {
      await deleteChannelIfExists(request, token, channelId)
      await deleteAttachmentIfExists(request, token, attachmentId)
    }
  })
})
