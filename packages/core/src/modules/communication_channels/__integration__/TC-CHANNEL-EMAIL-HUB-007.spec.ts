import path from 'node:path'
import { createHash } from 'node:crypto'
import { config as loadEnv } from 'dotenv'
import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/authFixtures'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { deleteAttachmentIfExists, uploadAttachmentFixture } from '@open-mercato/core/helpers/integration/attachmentsFixtures'
import {
  deleteChannelIfExists,
  isChannelSeedingAvailable,
  listCapturedSystemEmails,
  seedConnectedChannel,
  type CapturedTestSeedEmail,
} from '@open-mercato/core/helpers/integration/communicationChannelsFixtures'
import { drainIntegrationQueue } from '@open-mercato/core/helpers/integration/queue'

/**
 * TC-CHANNEL-EMAIL-HUB-005 — send-as-user with attachments (#7098, #6261).
 *
 * A file from the attachments module is sent through a connected mailbox: the
 * facade validates the reference, the delivery worker reads the bytes and the
 * network-free test-seed adapter records a digest of what it was handed. A
 * channel whose adapter does not share files, and a reference naming the wrong
 * owner, are refused before any message is composed.
 *
 * A connected channel can only be provisioned through the env-gated test-seed
 * fixture, so the suite skips when `OM_ENABLE_TEST_CHANNEL_SEEDING` is off.
 */

const APP_ROOT = process.env.OM_TEST_APP_ROOT?.trim()
  ? path.resolve(process.env.OM_TEST_APP_ROOT as string)
  : path.resolve(process.cwd(), 'apps/mercato')

if (!process.env.OM_TEST_APP_ROOT?.trim()) {
  loadEnv({ path: path.resolve(APP_ROOT, '.env') })
  process.env.QUEUE_BASE_DIR = path.resolve(APP_ROOT, '.mercato/queue')
}

const OUTBOUND_QUEUE = 'communication-channels-outbound'
const OWNER_ENTITY_ID = 'attachments:library'

async function waitForCapture(
  request: Parameters<typeof apiRequest>[0],
  token: string,
  subject: string,
): Promise<CapturedTestSeedEmail | undefined> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    await drainIntegrationQueue(OUTBOUND_QUEUE, { appRoot: APP_ROOT })
    const captured = (await listCapturedSystemEmails(request, token)).find((item) => item.metadata?.subject === subject)
    if (captured) return captured
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  return undefined
}

test.describe('TC-CHANNEL-EMAIL-HUB-005: send-as-user with attachments', () => {
  test('delivers the attached file bytes through the mailbox adapter', async ({ request }) => {
    test.slow()
    const stamp = Date.now()
    let token: string | null = null
    let channelId: string | null = null
    let attachmentId: string | null = null

    try {
      token = await getAuthToken(request)
      test.skip(!(await isChannelSeedingAvailable(request, token)), 'OM_ENABLE_TEST_CHANNEL_SEEDING is not enabled.')

      channelId = await seedConnectedChannel(request, token, {
        displayName: `Attachment mailbox ${stamp}`,
        externalIdentifier: `attachments-${stamp}@example.com`,
      })
      const recordId = `hub-005-${stamp}`
      const bytes = Buffer.from(`%PDF-1.4\n% order ${stamp}\n`, 'utf-8')
      const uploaded = await uploadAttachmentFixture(request, token, {
        entityId: OWNER_ENTITY_ID,
        recordId,
        fileName: `order-${stamp}.pdf`,
        mimeType: 'application/pdf',
        buffer: bytes,
      })
      attachmentId = uploaded.id

      const subject = `Order with attachment ${stamp}`
      const response = await apiRequest(request, 'POST', '/api/communication_channels/send-as-user', {
        token,
        data: {
          userChannelId: channelId,
          to: [`buyer-${stamp}@example.com`],
          subject,
          body: { plain: 'Please find the order attached.' },
          attachments: [
            {
              kind: 'attachment',
              attachmentId,
              owner: { entityId: OWNER_ENTITY_ID, recordId },
              filename: `Order ${stamp}.pdf`,
            },
          ],
        },
      })
      expect(response.status(), 'send-as-user with an attachment should be accepted').toBe(202)

      const captured = await waitForCapture(request, token, subject)
      expect(captured, 'the test-seed adapter should have captured the delivery').toBeTruthy()
      expect(captured!.content.attachments).toEqual([
        {
          fileName: `Order ${stamp}.pdf`,
          mimeType: 'application/pdf',
          fileSize: bytes.byteLength,
          sha256: createHash('sha256').update(bytes).digest('hex'),
        },
      ])
      expect(captured!.metadata ?? {}).not.toHaveProperty('outboundAttachments')
    } finally {
      await deleteChannelIfExists(request, token, channelId)
      await deleteAttachmentIfExists(request, token, attachmentId)
    }
  })

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
      const recordId = `hub-005-chat-${stamp}`
      const uploaded = await uploadAttachmentFixture(request, token, {
        entityId: OWNER_ENTITY_ID,
        recordId,
        fileName: `note-${stamp}.txt`,
        mimeType: 'text/plain',
        buffer: Buffer.from('note'),
      })
      attachmentId = uploaded.id

      const response = await apiRequest(request, 'POST', '/api/communication_channels/send-as-user', {
        token,
        data: {
          userChannelId: channelId,
          to: [`buyer-${stamp}@example.com`],
          subject: `Unsupported ${stamp}`,
          body: { plain: 'x' },
          attachments: [{ kind: 'attachment', attachmentId, owner: { entityId: OWNER_ENTITY_ID, recordId } }],
        },
      })
      expect(response.status()).toBe(422)
      const body = await readJsonSafe<{ code?: string }>(response)
      expect(body?.code).toBe('attachments_unsupported')
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
        recordId: `hub-005-owner-${stamp}`,
        fileName: `owned-${stamp}.pdf`,
        mimeType: 'application/pdf',
        buffer: Buffer.from('%PDF-1.4\n'),
      })
      attachmentId = uploaded.id

      const response = await apiRequest(request, 'POST', '/api/communication_channels/send-as-user', {
        token,
        data: {
          userChannelId: channelId,
          to: [`buyer-${stamp}@example.com`],
          subject: `Wrong owner ${stamp}`,
          body: { plain: 'x' },
          attachments: [
            { kind: 'attachment', attachmentId, owner: { entityId: OWNER_ENTITY_ID, recordId: `someone-else-${stamp}` } },
          ],
        },
      })
      expect(response.status()).toBe(422)
      const body = await readJsonSafe<{ code?: string }>(response)
      expect(body?.code).toBe('attachment_not_found')
    } finally {
      await deleteChannelIfExists(request, token, channelId)
      await deleteAttachmentIfExists(request, token, attachmentId)
    }
  })
})
