import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  composeInternalMessage,
  deleteMessageIfExists,
  replyToMessageWithToken,
} from './helpers'

export const integrationMeta = { dependsOnModules: ['messages'] }

type ListItem = { id?: unknown; hasAttachments?: unknown; attachmentCount?: unknown }

async function isAttachmentsModuleEnabled(request: APIRequestContext): Promise<boolean> {
  const token = await getAuthToken(request, 'superadmin')
  const probe = await apiRequest(request, 'GET', '/api/attachments/library?pageSize=1', { token })
  return probe.status() !== 404
}

async function pollListedMessage(
  request: APIRequestContext,
  token: string,
  messageId: string,
  query: string,
): Promise<ListItem | undefined> {
  let attempt = 0
  let found: ListItem | undefined
  await expect
    .poll(
      async () => {
        const pageSize = 20 + (attempt++ % 60)
        const response = await apiRequest(request, 'GET', `/api/messages?${query}&pageSize=${pageSize}`, { token })
        expect(response.status(), 'message list must answer 200').toBe(200)
        const body = await readJsonSafe<{ items?: ListItem[] }>(response)
        found = body?.items?.find((item) => item.id === messageId)
        return found !== undefined
      },
      { timeout: 10_000, message: `message ${messageId} should be listed for ${query}` },
    )
    .toBe(true)
  return found
}

test.describe('TC-MSG-9201: messages keep working without the attachments module', () => {
  test('inbox list, compose and reply succeed and list items report attachment counts', async ({ request }) => {
    const subject = `QA 9201 inbox ${Date.now()}`
    let messageId: string | null = null
    let replyId: string | null = null
    let senderToken: string | null = null
    let recipientToken: string | null = null

    try {
      const composed = await composeInternalMessage(request, { subject })
      messageId = composed.messageId
      senderToken = composed.senderToken
      recipientToken = composed.recipientToken

      const listed = await pollListedMessage(
        request,
        recipientToken,
        messageId,
        `folder=inbox&search=${encodeURIComponent(subject)}`,
      )
      expect(typeof listed?.attachmentCount).toBe('number')
      expect(typeof listed?.hasAttachments).toBe('boolean')

      replyId = await replyToMessageWithToken(request, recipientToken, messageId, `Reply to ${subject}`)
      const replyDetail = await apiRequest(request, 'GET', `/api/messages/${replyId}`, { token: recipientToken })
      expect(replyDetail.status()).toBe(200)

      const attachments = await apiRequest(request, 'GET', `/api/messages/${messageId}/attachments`, {
        token: senderToken,
      })
      expect(attachments.status()).toBe((await isAttachmentsModuleEnabled(request)) ? 200 : 404)
    } finally {
      await deleteMessageIfExists(request, recipientToken, replyId)
      await deleteMessageIfExists(request, senderToken, messageId)
    }
  })

  test('without attachments list counts are 0 and the attachments route answers a translated 404', async ({ request }) => {
    test.skip(await isAttachmentsModuleEnabled(request), 'Requires an app without the optional attachments module')

    const subject = `QA 9201 no attachments ${Date.now()}`
    let messageId: string | null = null
    let senderToken: string | null = null
    let recipientToken: string | null = null

    try {
      const composed = await composeInternalMessage(request, { subject })
      messageId = composed.messageId
      senderToken = composed.senderToken
      recipientToken = composed.recipientToken

      const listed = await pollListedMessage(
        request,
        recipientToken,
        messageId,
        `folder=inbox&search=${encodeURIComponent(subject)}`,
      )
      expect(listed?.attachmentCount).toBe(0)
      expect(listed?.hasAttachments).toBe(false)

      const withAttachments = await apiRequest(
        request,
        'GET',
        `/api/messages?folder=inbox&hasAttachments=true&search=${encodeURIComponent(subject)}`,
        { token: recipientToken },
      )
      expect(withAttachments.status()).toBe(200)
      const withAttachmentsBody = await readJsonSafe<{ items?: ListItem[] }>(withAttachments)
      expect((withAttachmentsBody?.items ?? []).map((item) => item.id)).not.toContain(messageId)

      await pollListedMessage(
        request,
        recipientToken,
        messageId,
        `folder=inbox&hasAttachments=false&search=${encodeURIComponent(subject)}`,
      )

      const attachments = await apiRequest(request, 'GET', `/api/messages/${messageId}/attachments`, {
        token: senderToken,
      })
      expect(attachments.status()).toBe(404)
      const body = await readJsonSafe<{ error?: unknown }>(attachments)
      expect(typeof body?.error).toBe('string')
      expect(String(body?.error).length).toBeGreaterThan(0)
      expect(String(body?.error)).not.toBe('messages.errors.attachmentsUnavailable')
    } finally {
      await deleteMessageIfExists(request, senderToken, messageId)
    }
  })
})
