import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { createUserFixture, deleteUserIfExists } from '@open-mercato/core/helpers/integration/authFixtures'
import { expectId, getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  composeInternalMessage,
  deleteMessageIfExists,
  replyToMessageWithToken,
  selectRecipientFromComposer,
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
  test('rejects malformed message IDs before querying storage', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const detailPath = '/api/messages/not-a-message-id'
    const requests = [
      ['GET', detailPath],
      ['PATCH', detailPath],
      ['DELETE', detailPath],
      ['GET', `${detailPath}/attachments`],
      ['POST', `${detailPath}/attachments`],
      ['DELETE', `${detailPath}/attachments`],
      ['POST', `${detailPath}/reply`],
      ['POST', `${detailPath}/forward`],
      ['GET', `${detailPath}/forward-preview`],
    ] as const

    for (const [method, path] of requests) {
      const response = await apiRequest(request, method, path, { token })
      expect(response.status(), `${method} ${path}`).toBe(404)
    }
  })

  test('without attachments the compose form sends messages and saves drafts', async ({ page, request }, testInfo) => {
    test.skip(await isAttachmentsModuleEnabled(request), 'Requires an app without the optional attachments module')
    const token = await getAuthToken(request, 'admin')
    const { organizationId } = getTokenScope(token)
    const fixtureId = randomUUID()
    const email = `qa-message-${fixtureId}@example.com`
    const recipientId = await createUserFixture(request, token, {
      email,
      password: `Message1!${fixtureId}`,
      organizationId,
      roles: [],
    })
    const createdIds: string[] = []

    try {
      await login(page, 'admin')
      for (const action of ['Save draft', 'Send']) {
        const loadingAttachments = page.waitForResponse((response) => response.request().method() === 'GET'
          && new URL(response.url()).pathname === '/api/attachments')
        await page.goto('/backend/messages/compose')
        await expect(page.getByRole('button', { name: action, exact: true })).toBeVisible()
        expect((await loadingAttachments).status()).toBe(404)
        await expect(page.getByText('Attachments', { exact: true })).toHaveCount(0)
        await expect(page.getByRole('alert').filter({ hasText: /not found/i })).toHaveCount(0)
        await page.getByRole('textbox', { name: 'Subject', exact: true }).fill(`${action} ${fixtureId}`)
        await page.getByPlaceholder('Write your message...').fill('Message without attachments')
        if (action === 'Send') await selectRecipientFromComposer(page.getByRole('main'), email)
        if (action === 'Send' && process.env.PW_CAPTURE_SCREENSHOTS === '1') {
          await page.screenshot({ path: testInfo.outputPath('compose-without-attachments.png'), fullPage: true })
        }

        const saving = page.waitForResponse((response) => response.request().method() === 'POST'
          && new URL(response.url()).pathname === '/api/messages')
        await page.getByRole('button', { name: action, exact: true }).click()
        const response = await saving
        expect(response.status()).toBe(201)
        const result = await response.json() as { id?: string }
        createdIds.push(expectId(result.id, 'The persisted message has an ID'))
      }
    } finally {
      for (const id of createdIds) await deleteMessageIfExists(request, token, id)
      await deleteUserIfExists(request, token, recipientId)
    }
  })

  test('without attachments a forward from the conversation composer is persisted', async ({ page, request }) => {
    test.skip(await isAttachmentsModuleEnabled(request), 'Requires an app without the optional attachments module')
    const fixture = await composeInternalMessage(request, { subject: `QA forward ${randomUUID()}` })
    let forwardedId: string | null = null

    try {
      await login(page, 'admin')
      await page.goto(`/backend/messages/${fixture.messageId}`)
      await page.getByRole('button', { name: 'Conversation actions', exact: true }).hover()
      await page.getByRole('menuitem', { name: 'Forward all', exact: true }).click()
      await page.getByPlaceholder('Review and edit forwarded content...').fill('Forwarded without attachments')
      await selectRecipientFromComposer(page.getByRole('main'), 'employee@acme.com')

      const forwarding = page.waitForResponse((response) => response.request().method() === 'POST'
        && new URL(response.url()).pathname === `/api/messages/${fixture.messageId}/forward`)
      await page.getByRole('button', { name: 'Forward', exact: true }).click()
      const response = await forwarding
      expect(response.status()).toBe(201)
      const result = await response.json() as { id?: string }
      forwardedId = expectId(result.id, 'The forwarded message has an ID')
    } finally {
      await deleteMessageIfExists(request, fixture.senderToken, forwardedId)
      await deleteMessageIfExists(request, fixture.senderToken, fixture.messageId)
    }
  })

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
